import type { APIRoute } from 'astro'
import { z } from 'zod'
import { analyzeReply, generateReplyDraft } from '../../../../../../lead-engine/services/replyCopilot.js'
import { updateConversationStatus } from '../../../../../../lead-engine/repositories/conversations.js'
import { recordActivity } from '../../../../../../lead-engine/repositories/activity.js'
import { ACTIVITY } from '../../../../../../lead-engine/domain/activity.js'
import {
  actorEmail,
  handleRoute,
  jsonResponse,
  readValidatedBody,
  requireDatabase,
} from '../../../../../../lead-engine/schemas/route'
import { withAdmin } from '../../../../../../lib/adminGuard'

export const prerender = false

const replyActionSchema = z.object({
  action: z.enum(['analyze', 'draft', 'resolve']),
  variant: z
    .enum(['regenerate', 'shorter', 'more_technical', 'explain_solution', 'suggest_call', 'no_cta'])
    .nullish(),
  conversationId: z.string().trim().max(64).optional(),
})

/**
 * The reply copilot's actions.
 *
 * Analyse, draft, and mark resolved. Nothing here sends: `draft` produces text
 * on a screen, and getting it into a mailbox is a separate, explicit push to
 * Zoho Drafts followed by a person pressing Send.
 */
const unguardedPOST: APIRoute = async (context) =>
  handleRoute(async () => {
    const database = requireDatabase()
    if (!database.ok) return database.response

    const body = await readValidatedBody(context.request, replyActionSchema)
    if (!body.ok) return body.response

    const messageId = context.params.messageId!
    const email = actorEmail(context)

    if (body.data.action === 'analyze') {
      const result = await analyzeReply(database.env, messageId, {})
      if (result.status !== 'ok') {
        return jsonResponse({ error: result.reason || `Analysis did not complete (${result.status}).`, status: result.status }, 502)
      }
      return jsonResponse(result)
    }

    if (body.data.action === 'draft') {
      const result = await generateReplyDraft(database.env, messageId, {
        variant: body.data.variant ?? null,
        actorEmail: email,
      })

      if (result.status === 'blocked') {
        return jsonResponse({ error: 'This contact is suppressed.', entry: result.entry }, 409)
      }
      if (result.status === 'not_ready') return jsonResponse({ error: result.reason }, 409)
      if (result.status !== 'ok') {
        return jsonResponse({ error: result.reason || `The model could not produce a usable draft (${result.status}).` }, 502)
      }

      return jsonResponse({ draft: result.draft, violations: result.violations })
    }

    // resolve
    if (!body.data.conversationId) return jsonResponse({ error: 'A conversationId is required.' }, 400)

    await updateConversationStatus(database.env.DB, body.data.conversationId, 'resolved')
    await recordActivity(database.env.DB, {
      conversationId: body.data.conversationId,
      eventType: ACTIVITY.NOTE_ADDED,
      actor: 'human',
      actorEmail: email,
      summary: 'Marked the conversation resolved.',
    })

    return jsonResponse({ ok: true })
  })

// Authenticated per handler as well as by src/middleware.ts; see src/lib/adminGuard.ts.
export const POST = withAdmin(unguardedPOST)

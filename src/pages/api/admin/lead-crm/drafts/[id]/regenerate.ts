import type { APIRoute } from 'astro'
import { getDraft } from '../../../../../../lead-engine/repositories/drafts.js'
import { generateOutreachDraft } from '../../../../../../lead-engine/services/outreach.js'
import { generateReplyDraft } from '../../../../../../lead-engine/services/replyCopilot.js'
import { draftVariantSchema } from '../../../../../../lead-engine/schemas/index'
import {
  actorEmail,
  handleRoute,
  jsonResponse,
  notFound,
  readValidatedBody,
  requireDatabase,
} from '../../../../../../lead-engine/schemas/route'
import { withAdmin } from '../../../../../../lib/adminGuard'

export const prerender = false

/**
 * Regenerates a draft, optionally with a variant.
 *
 * The variant strings map to instructions in the versioned prompt files, so
 * what "Make Shorter" actually asks the model is in Git rather than in a button
 * handler — and every regeneration is recorded as its own AI run with the
 * variant on it.
 */
const unguardedPOST: APIRoute = async (context) =>
  handleRoute(async () => {
    const database = requireDatabase()
    if (!database.ok) return database.response

    const body = await readValidatedBody(context.request, draftVariantSchema)
    if (!body.ok) return body.response

    const draft = await getDraft(database.env.DB, context.params.id!)
    if (!draft) return notFound(context.request, 'Draft not found.')

    const email = actorEmail(context)
    const variant = body.data.variant ?? 'regenerate'

    const result =
      draft.kind === 'reply'
        ? await generateReplyDraft(database.env, draft.inReplyToMessageId!, { variant, actorEmail: email })
        : await generateOutreachDraft(database.env, draft.leadId, { variant, actorEmail: email })

    if (result.status === 'blocked') {
      return jsonResponse({ error: 'This lead is not ready for outreach.', blockers: 'blockers' in result ? result.blockers : [] }, 409)
    }
    if (result.status !== 'ok') {
      return jsonResponse({ error: result.reason || `The model could not produce a usable draft (${result.status}).` }, 502)
    }

    return jsonResponse({ draft: result.draft, violations: result.violations })
  })

// Authenticated per handler as well as by src/middleware.ts; see src/lib/adminGuard.ts.
export const POST = withAdmin(unguardedPOST)

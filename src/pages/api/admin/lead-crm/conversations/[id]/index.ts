import type { APIRoute } from 'astro'
import { z } from 'zod'
import {
  getConversation,
  listMessages,
  updateConversationStatus,
} from '../../../../../../lead-engine/repositories/conversations.js'
import { getLead } from '../../../../../../lead-engine/repositories/leads.js'
import {
  handleRoute,
  jsonResponse,
  notFound,
  readValidatedBody,
  requireDatabase,
} from '../../../../../../lead-engine/schemas/route'
import { withAdmin } from '../../../../../../lib/adminGuard'

export const prerender = false

const statusSchema = z.object({
  status: z.enum(['open', 'awaiting_reply', 'needs_attention', 'resolved', 'closed']),
})

/**
 * One conversation and every message in it, oldest first.
 *
 * Messages are returned exactly as stored. Nothing in this system edits a
 * historical message — the conversation view is a record of what was actually
 * said, which is what makes it worth reading before replying.
 */
const unguardedGET: APIRoute = async ({ params, request }) =>
  handleRoute(async () => {
    const database = requireDatabase()
    if (!database.ok) return database.response

    const conversation = await getConversation(database.env.DB, params.id!)
    if (!conversation) return notFound(request, 'Conversation not found.')

    const [messages, lead] = await Promise.all([
      listMessages(database.env.DB, params.id!),
      getLead(database.env.DB, conversation.leadId),
    ])

    return jsonResponse({ conversation, messages, lead })
  })

const unguardedPATCH: APIRoute = async (context) =>
  handleRoute(async () => {
    const database = requireDatabase()
    if (!database.ok) return database.response

    const body = await readValidatedBody(context.request, statusSchema)
    if (!body.ok) return body.response

    await updateConversationStatus(database.env.DB, context.params.id!, body.data.status)
    return jsonResponse({ ok: true, status: body.data.status })
  })

// Authenticated per handler as well as by src/middleware.ts; see src/lib/adminGuard.ts.
export const GET = withAdmin(unguardedGET)
export const PATCH = withAdmin(unguardedPATCH)

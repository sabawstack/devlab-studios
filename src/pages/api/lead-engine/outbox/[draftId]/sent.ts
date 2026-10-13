import type { APIRoute } from 'astro'
import { z } from 'zod'
import { authorizeOutboxRequest } from '../../../../../lead-engine/outbox/auth.js'
import { confirmSent } from '../../../../../lead-engine/services/outbox.js'
import {
  handleRoute,
  jsonResponse,
  readValidatedBody,
  requireDatabase,
} from '../../../../../lead-engine/schemas/route'

export const prerender = false

const sentSchema = z.object({
  providerMessageId: z.string().trim().max(400).optional().nullable(),
  sentAt: z.string().trim().max(64).optional().nullable(),
})

/**
 * The external sender reporting that it transmitted a message.
 *
 * This is the ONLY thing that moves a lead to `CONTACTED` on the automated
 * path, and it is also what the daily cap counts — confirmations are the
 * ground truth, because a draft collected and never transmitted consumed
 * nothing real.
 *
 * Idempotent on the draft id. A sender that retries after a timeout must not
 * record a second send, or the cap would under-count and the timeline would
 * claim a prospect was mailed twice.
 */
export const POST: APIRoute = async (context) =>
  handleRoute(async () => {
    const database = requireDatabase()
    if (!database.ok) return database.response

    const auth = await authorizeOutboxRequest(database.env, context.request)
    if (!auth.ok) return auth.response

    const body = await readValidatedBody(context.request, sentSchema)
    if (!body.ok) return body.response

    const result = await confirmSent(database.env, context.params.draftId!, {
      providerMessageId: body.data.providerMessageId ?? null,
      sentAt: body.data.sentAt ?? null,
    })

    return jsonResponse(result)
  })

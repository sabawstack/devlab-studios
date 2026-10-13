import type { APIRoute } from 'astro'
import { z } from 'zod'
import { authorizeBearerRequest } from '../../../../../lead-engine/outbox/auth.js'
import { markFailed } from '../../../../../mailbox/repositories/outbound.js'
import {
  handleRoute,
  jsonResponse,
  readValidatedBody,
  requireDatabase,
} from '../../../../../lead-engine/schemas/route'

export const prerender = false

const failedSchema = z.object({
  error: z.string().trim().max(1000).optional().nullable(),
  /**
   * Whether the reply should go back in the queue.
   *
   * Defaults to FALSE, and that default is the important part. A reply that
   * silently re-queues forever mails the same person repeatedly the moment a
   * fault clears — so the transmitter has to assert that a failure was
   * transient before we will try again. A `failed` row is visible in the CMS
   * and a person decides.
   */
  retryable: z.boolean().default(false),
})

/**
 * The transmitter reporting that a reply could not be sent.
 *
 * WITHOUT THIS, A FAILED REPLY IS INDISTINGUISHABLE FROM ONE STILL IN THE
 * QUEUE. The thread would show a reply was written, nothing would show it never
 * left, and the prospect's silence would read as disinterest rather than as our
 * own outage.
 */
export const POST: APIRoute = async (context) =>
  handleRoute(async () => {
    const database = requireDatabase()
    if (!database.ok) return database.response

    const auth = await authorizeBearerRequest(database.env, context.request, 'MAILBOX_OUTBOX_TOKEN')
    if (!auth.ok) return auth.response

    const body = await readValidatedBody(context.request, failedSchema)
    if (!body.ok) return body.response

    const result = await markFailed(database.env.DB, context.params.outboundId!, {
      error: body.data.error ?? null,
      retryable: body.data.retryable,
    })

    return jsonResponse(result)
  })

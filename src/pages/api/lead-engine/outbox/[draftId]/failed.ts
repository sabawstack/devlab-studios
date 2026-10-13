import type { APIRoute } from 'astro'
import { z } from 'zod'
import { authorizeOutboxRequest } from '../../../../../lead-engine/outbox/auth.js'
import { recordTransmissionFailure } from '../../../../../lead-engine/services/outbox.js'
import {
  handleRoute,
  jsonResponse,
  readValidatedBody,
  requireDatabase,
} from '../../../../../lead-engine/schemas/route'

export const prerender = false

const failureSchema = z.object({
  error: z.string().trim().max(1000).optional().nullable(),
  /**
   * Whether the transmitter believes the fault was temporary.
   *
   * RECORDED, NOT ACTED ON. The draft stays marked exported and is not
   * re-offered, which is the same under-send-rather-than-double-send rule the
   * collection endpoint is built around: a send that reported failure may still
   * have reached an MTA, and re-offering it risks mailing a stranger twice.
   */
  retryable: z.boolean().default(false),
  failedAt: z.string().trim().max(40).optional().nullable(),
})

/**
 * The transmitter could not put a message on the wire.
 *
 * SEPARATE FROM `/bounced`, AND THE SEPARATION IS THE POINT. A bounce is the
 * recipient's mail system refusing a message that reached it; this is our own
 * side failing before it ever left — nodemailer not importable, Postfix down,
 * the CMS unreachable, a runtime error.
 *
 * The workflow previously reported every send-node error to `/bounced` with
 * `kind: 'hard'`, which permanently suppresses the address and moves the lead
 * to NO_CONTACT. That meant a missing npm module on the n8n container would
 * have quietly destroyed prospects — and the more broken the infrastructure,
 * the more of them. Nothing on this route suppresses anything.
 *
 * `/bounced` remains for what it was always for: an actual SMTP rejection or an
 * asynchronous DSN that proves permanent delivery failure.
 */
export const POST: APIRoute = async (context) =>
  handleRoute(async () => {
    const database = requireDatabase()
    if (!database.ok) return database.response

    const auth = await authorizeOutboxRequest(database.env, context.request)
    if (!auth.ok) return auth.response

    const body = await readValidatedBody(context.request, failureSchema)
    if (!body.ok) return body.response

    return jsonResponse(
      await recordTransmissionFailure(database.env, context.params.draftId!, {
        error: body.data.error ?? null,
        retryable: body.data.retryable,
        failedAt: body.data.failedAt ?? null,
      }),
    )
  })

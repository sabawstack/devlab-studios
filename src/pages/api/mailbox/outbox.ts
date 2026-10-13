import type { APIRoute } from 'astro'
import { authorizeBearerRequest } from '../../../lead-engine/outbox/auth.js'
import { collectQueued } from '../../../mailbox/repositories/outbound.js'
import { renderCollectedBatch } from '../../../mailbox/services/outboxBatch.js'
import { checkRateLimit, clientIp, rateLimitedResponse } from '../../../worker/rateLimit.js'
import { handleRoute, jsonResponse, requireDatabase } from '../../../lead-engine/schemas/route'

export const prerender = false

const COLLECT_WINDOW_MS = 60_000
const COLLECT_MAX_REQUESTS = 30

/**
 * Hands queued replies to the configured external sender.
 *
 * Outside `/api/admin/` because an automation cannot hold a browser session, so
 * it carries its own bearer-token gate which FAILS CLOSED when unconfigured —
 * the same arrangement as the lead engine's outbox, using the same constant-
 * time comparison rather than a second copy of it.
 *
 * WHAT IT RETURNS, AND WHY IT IS SHAPED THIS WAY. Each item carries a complete
 * RFC 5322 message in `raw` and the SMTP envelope separately in `envelope`. The
 * transmitter's whole job is `MAIL FROM`, `RCPT TO`, `DATA`.
 *
 * That split is not decoration. The envelope sender is a per-message VERP
 * address and is NOT derivable from the message — that is the entire point of
 * VERP — and the message carries `Message-ID`, `In-Reply-To` and `References`
 * that decide whether the reply threads in the recipient's client. n8n's
 * built-in Send Email node can set none of those: its own documentation states
 * it "does not support setting headers like In-Reply-To and References", and it
 * derives MAIL FROM from the From: header with no override. Handing it fields
 * to assemble would have produced replies that do not thread and bounces that
 * correlate to nothing.
 *
 * A collected reply is never offered twice. If the transmitter dies between
 * collecting and sending, that reply goes unsent and sits in the CMS for a
 * person — rather than being mailed twice, which is unrecoverable.
 */
export const GET: APIRoute = async (context) =>
  handleRoute(async () => {
    const database = requireDatabase()
    if (!database.ok) return database.response

    const auth = await authorizeBearerRequest(database.env, context.request, 'MAILBOX_OUTBOX_TOKEN')
    if (!auth.ok) return auth.response

    // Rate limited even though authenticated: a misconfigured schedule polling
    // every second would otherwise hammer D1 all day.
    const rate = await checkRateLimit(database.env, 'mailbox-outbox', clientIp(context.request), {
      limit: COLLECT_MAX_REQUESTS,
      windowMs: COLLECT_WINDOW_MS,
    })
    if (rate.limited) {
      return rateLimitedResponse('Too many outbox requests. Try again shortly.', rate.retryAfterSeconds)
    }

    const limit = Number(new URL(context.request.url).searchParams.get('limit'))
    const collected = await collectQueued(database.env.DB, {
      limit: Number.isFinite(limit) ? limit : undefined,
    })

    return jsonResponse({
      // One unrenderable row (an attachment gone from R2) is marked failed with
      // its reason and left out; the rest of the batch is still delivered.
      // Throwing here instead would strand every row already marked collected.
      messages: await renderCollectedBatch(database.env, collected.filter(Boolean)),
      sent: false,
      instruction:
        'Nothing has been sent. Submit each `raw` message using its `envelope`, then POST to ' +
        '/api/mailbox/outbox/{id}/sent — or /failed if it could not be transmitted.',
    })
  })

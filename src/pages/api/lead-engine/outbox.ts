import type { APIRoute } from 'astro'
import { authorizeOutboxRequest } from '../../../lead-engine/outbox/auth.js'
import { collectOutbox } from '../../../lead-engine/services/outbox.js'
import { checkRateLimit, clientIp, rateLimitedResponse } from '../../../worker/rateLimit.js'
import { handleRoute, jsonResponse, requireDatabase } from '../../../lead-engine/schemas/route'

export const prerender = false

const COLLECT_WINDOW_MS = 60_000
const COLLECT_MAX_REQUESTS = 10

/**
 * Hands approved drafts to the configured external sender.
 *
 * This route is deliberately NOT under `/api/admin/`, because an automation
 * cannot hold a browser session — so it carries its own bearer-token gate,
 * which fails closed when unconfigured. See `lead-engine/outbox/auth.js`.
 *
 * Nothing here sends. It returns message bodies; something outside this
 * application transmits them and calls the `/sent` route back. Every
 * compliance gate — suppression re-checked at this moment, AI content
 * safeguards — runs before a message is handed over, on this side of the
 * boundary where it is testable.
 *
 * A collected draft is never offered twice. If the sender dies before
 * transmitting, that message goes unsent rather than being mailed twice.
 */
export const GET: APIRoute = async (context) =>
  handleRoute(async () => {
    const database = requireDatabase()
    if (!database.ok) return database.response

    const auth = await authorizeOutboxRequest(database.env, context.request)
    if (!auth.ok) return auth.response

    // Rate limited even though it is authenticated: a misconfigured schedule
    // polling every second would walk the pipeline on every call.
    const rate = await checkRateLimit(database.env, 'lead-outbox', clientIp(context.request), {
      limit: COLLECT_MAX_REQUESTS,
      windowMs: COLLECT_WINDOW_MS,
    })
    if (rate.limited) {
      return rateLimitedResponse('Too many outbox requests. Try again shortly.', rate.retryAfterSeconds)
    }

    const limit = Number(new URL(context.request.url).searchParams.get('limit'))
    const result = await collectOutbox(database.env, {
      limit: Number.isFinite(limit) ? limit : undefined,
    })

    return jsonResponse({
      ...result,
      // Said explicitly in the payload, because the caller is a machine and
      // this is the one place the contract could be misread.
      sent: false,
      instruction:
        'Nothing has been sent. Transmit each message, then POST to /api/lead-engine/outbox/{draftId}/sent.',
    })
  })

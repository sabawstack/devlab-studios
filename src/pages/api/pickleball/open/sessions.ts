import type { APIRoute } from 'astro'
import { getEnv } from '../../../../lib/env'
import { OPEN_SESSION_TURNSTILE_ACTION } from '../../../../lib/pickleball/open/constants'
import { generatePublicCode } from '../../../../lib/pickleball/open/codes'
import { buildInitialState } from '../../../../lib/pickleball/open/create'
import { createSessionSchema } from '../../../../lib/schemas/pickleball/open/createSession'
import { randomBase64Url, sha256Base64Url } from '../../../../lib/pickleball/webCrypto.js'
import { createOpenSession } from '../../../../worker/repositories/pickleball/open/openSessions'
import { checkRateLimit, clientIp, rateLimitedResponse } from '../../../../worker/rateLimit.js'
import { verifyTurnstileToken } from '../../../../worker/turnstile.js'
import { apiErrorResponse, jsonResponse } from '../../../../worker/utils/responses.js'

const CREATE_LIMIT = 10
const DAY_MS = 86_400_000

export const POST: APIRoute = async ({ request }) => {
  const env = getEnv()
  try {
    // Fails CLOSED (spec §10): anonymous creation without a working limiter
    // is an open spam relay, unlike a read endpoint briefly not counting.
    if (!env.RATE_LIMITER) {
      await request.arrayBuffer().catch(() => {})
      return jsonResponse({ error: 'Starting sessions is temporarily unavailable. Try again shortly.' }, 503)
    }
    const rate = await checkRateLimit(env, 'open-create', clientIp(request), { limit: CREATE_LIMIT, windowMs: DAY_MS })
    if (rate.limited) {
      await request.arrayBuffer().catch(() => {})
      return rateLimitedResponse('That is a lot of sessions for one day. Try again tomorrow.', rate.retryAfterSeconds)
    }

    const parsed = createSessionSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return jsonResponse({ error: 'Check the session details and try again.' }, 400)

    const hostname = new URL(request.url).hostname
    const isLocal = hostname === 'localhost' || hostname === '127.0.0.1'
    const verification = await verifyTurnstileToken(env.TURNSTILE_SECRET_KEY, parsed.data.turnstileToken, clientIp(request), {
      expectedHostname: hostname,
      expectedAction: OPEN_SESSION_TURNSTILE_ACTION,
      allowMissingSecret: isLocal,
    })
    if (!verification.ok) {
      const unavailable = verification.reason === 'configuration-missing' || verification.reason === 'verification-request-failed'
      return jsonResponse({ error: unavailable ? 'Verification is unavailable. Try again shortly.' : 'Verification failed. Please try again.' }, unavailable ? 503 : 400)
    }

    const hostKey = randomBase64Url(16)
    const hostKeyHash = await sha256Base64Url(hostKey)
    const { name, hostDisplayName, location, courtCount, settings, players } = parsed.data
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const state = buildInitialState(
        { name, hostDisplayName, location: location ?? null, courtCount, settings, players: players.map((p) => ({ name: p.name, skill: p.skill ?? null, duprId: p.duprId ?? null })) },
        { now: new Date().toISOString(), newId: () => crypto.randomUUID(), publicCode: generatePublicCode(), sessionId: crypto.randomUUID() },
      )
      try {
        await createOpenSession(env.PICKLEBALL_DB, state, hostKeyHash)
        return jsonResponse({ code: state.publicCode, hostKey }, 201)
      } catch (error) {
        const collision = error instanceof Error && /UNIQUE/i.test(error.message)
        if (!collision || attempt === 2) throw error
      }
    }
    return jsonResponse({ error: 'Could not start the session. Try again.' }, 500)
  } catch (error) {
    return apiErrorResponse(error)
  }
}

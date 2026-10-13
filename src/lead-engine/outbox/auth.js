/**
 * Bearer-token auth for the outbox endpoints.
 *
 * These routes live OUTSIDE `/api/admin/`, so the admin session gate in
 * src/middleware.ts does not cover them. An external automation cannot hold a
 * browser session, so they carry their own token check — and because this is a
 * new authentication surface on an endpoint that hands out prospect email
 * addresses and message bodies, it is written to fail closed in every direction.
 *
 * FAILS CLOSED WHEN UNCONFIGURED. With `LEAD_OUTBOX_TOKEN` unset the endpoints
 * refuse every request. The alternative — treating "no token configured" as
 * "no auth required" — would mean a deploy that forgot the secret silently
 * published the outbox to the internet.
 *
 * The comparison is constant-time. A naive `===` leaks the token one byte at a
 * time to anyone willing to measure, and this token authorizes reading contact
 * details for every lead in the pipeline.
 */

import { clientIp, peekRateLimit, rateLimitedResponse, recordRateLimitFailure } from '../../worker/rateLimit.js'

/** Minimum length worth accepting. A short token is a guessable one. */
const MIN_TOKEN_LENGTH = 32

/**
 * The public answer for a deployment without a usable token. Deliberately the
 * same for "unset" and "too short", and naming no variable: an unauthenticated
 * caller learns nothing about how the deployment is configured. The operator
 * gets the specifics from the log line `authorizeBearer` writes.
 */
export const NOT_CONFIGURED_MESSAGE = 'This endpoint is not configured.'

/** Failed bearer attempts allowed per client IP per window, across all outbox routes. */
export const AUTH_FAILURE_LIMIT = 10
export const AUTH_FAILURE_WINDOW_MS = 10 * 60_000
const AUTH_FAILURE_BUCKET = 'outbox-auth-failure'

/**
 * Compares two strings without an early exit.
 *
 * Length is compared first and separately, which does leak the length — that
 * is unavoidable without hashing and is not sensitive here.
 *
 * @param {string} a
 * @param {string} b
 */
export function timingSafeEqual(a, b) {
  const left = String(a ?? '')
  const right = String(b ?? '')
  if (left.length !== right.length) return false

  let difference = 0
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }

  return difference === 0
}

/**
 * Reads a bearer token from the Authorization header.
 *
 * @param {Request} request
 * @returns {string}
 */
export function readBearerToken(request) {
  const header = request?.headers?.get?.('authorization') || ''
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match ? match[1].trim() : ''
}

/**
 * Whether this request carries the bearer token named by `variable`.
 *
 * Parameterized by variable name so the mailbox's outbox endpoints
 * (MAILBOX_OUTBOX_TOKEN) reuse this exact check rather than shipping a second
 * copy. Two hand-written constant-time comparisons in one codebase is one more
 * than should exist — the copy is the one that eventually gets "simplified"
 * back to `===`.
 *
 * @param {Env} env
 * @param {Request} request
 * @param {string} variable the env var holding the expected token
 * @returns {{ ok: true } | { ok: false, status: number, error: string }}
 */
export function authorizeBearer(env, request, variable) {
  const expected = String(env?.[variable] ?? '').trim()

  if (!expected) {
    // 503, not 401: the caller's credentials are not the problem, and saying
    // "unauthorized" would send an operator hunting for a token that the
    // deployment never had. The variable is named in the LOG, not the body.
    logConfigProblem(variable, 'unset')
    return { ok: false, status: 503, error: NOT_CONFIGURED_MESSAGE }
  }

  if (expected.length < MIN_TOKEN_LENGTH) {
    logConfigProblem(variable, `shorter than ${MIN_TOKEN_LENGTH} characters`)
    return { ok: false, status: 503, error: NOT_CONFIGURED_MESSAGE }
  }

  if (!timingSafeEqual(readBearerToken(request), expected)) {
    return { ok: false, status: 401, error: 'Unauthorized.' }
  }

  return { ok: true }
}

function logConfigProblem(variable, problem) {
  console.error(JSON.stringify({ event: 'outbox.auth_not_configured', variable, problem }))
}

/**
 * `authorizeBearer` for a route, with failed attempts logged and limited.
 *
 * A 401 is logged (no token material — only the route and the client IP) and
 * counted against the caller's IP. Once an IP has failed AUTH_FAILURE_LIMIT
 * times in the window it gets 429 BEFORE its token is even compared, so the
 * endpoint cannot be used as a guessing oracle. Successful calls are never
 * counted. The limiter fails open (see worker/rateLimit.js) — the token check
 * itself is what keeps the endpoint closed.
 *
 * @param {Env} env
 * @param {Request} request
 * @param {string} variable
 * @returns {Promise<{ ok: true } | { ok: false, response: Response }>}
 */
export async function authorizeBearerRequest(env, request, variable) {
  const ip = clientIp(request)

  const throttled = await peekRateLimit(env, AUTH_FAILURE_BUCKET, ip, { limit: AUTH_FAILURE_LIMIT })
  if (throttled.limited) {
    return {
      ok: false,
      response: rateLimitedResponse('Too many failed attempts. Try again later.', throttled.retryAfterSeconds),
    }
  }

  const auth = authorizeBearer(env, request, variable)
  if (auth.ok) return { ok: true }

  if (auth.status === 401) {
    let path = ''
    try {
      path = new URL(request.url).pathname
    } catch {
      path = ''
    }
    console.warn(JSON.stringify({ event: 'outbox.auth_failed', path, ip }))
    await recordRateLimitFailure(env, AUTH_FAILURE_BUCKET, ip, { windowMs: AUTH_FAILURE_WINDOW_MS })
  }

  return {
    ok: false,
    response: new Response(JSON.stringify({ error: auth.error }), {
      status: auth.status,
      headers: { 'content-type': 'application/json' },
    }),
  }
}

/**
 * Whether this request may use the lead engine's outbox.
 *
 * @param {Env} env
 * @param {Request} request
 * @returns {{ ok: true } | { ok: false, status: number, error: string }}
 */
export function authorizeOutbox(env, request) {
  return authorizeBearer(env, request, 'LEAD_OUTBOX_TOKEN')
}

/**
 * `authorizeOutbox` with failed attempts logged and limited.
 *
 * @param {Env} env
 * @param {Request} request
 */
export function authorizeOutboxRequest(env, request) {
  return authorizeBearerRequest(env, request, 'LEAD_OUTBOX_TOKEN')
}

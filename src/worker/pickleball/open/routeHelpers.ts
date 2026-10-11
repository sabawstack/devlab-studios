import { normalizePublicCode } from '../../../lib/pickleball/open/codes'
import { checkRateLimit, clientIp, rateLimitedResponse } from '../../rateLimit.js'
import { jsonResponse } from '../../utils/responses.js'
import type { DoResult } from './OpenSessionDO'

/**
 * Per-IP limit on the host routes, checked before the host key is. The
 * per-session command limit is counted inside the DO only once the key is
 * valid, so this is what stops one address hammering a code it found on a QR
 * board. Returns the 429 to send, or null. The caller drains any body first.
 */
export async function hostIpLimited(env: Env, request: Request): Promise<Response | null> {
  const rate = await checkRateLimit(env, 'open-host-ip', clientIp(request), { limit: 120, windowMs: 60_000 })
  return rate.limited ? rateLimitedResponse('Too many requests. Try again shortly.', rate.retryAfterSeconds) : null
}

export function openSessionStub(env: Env, code: string) {
  return env.OPEN_SESSION.get(env.OPEN_SESSION.idFromName(code))
}

export function codeFrom(params: Record<string, string | undefined>): string | null {
  return normalizePublicCode(params.code ?? '')
}

export function hostKeyFrom(request: Request): string | null {
  const key = request.headers.get('X-Host-Key')
  return key && key.length <= 128 ? key : null
}

export function doResponse<T>(result: DoResult<T>): Response {
  if (result.status === 429) return rateLimitedResponse('Slow down a little and try again.', result.retryAfterSeconds ?? 0)
  return jsonResponse(result.body, result.status)
}

export const notFound = (): Response => jsonResponse({ error: 'Session not found.' }, 404)

/**
 * The only error text an anonymous caller may see. A numeric 4xx `status` on an
 * Error is something our own code set on purpose; everything else (D1, Durable
 * Object RPC, runtime) is logged and replaced with a generic message.
 */
export function openErrorResponse(error: unknown, route: string): Response {
  const status = error instanceof Error ? (error as Error & { status?: unknown }).status : undefined
  if (error instanceof Error && typeof status === 'number' && status >= 400 && status <= 499) {
    return jsonResponse({ error: error.message }, status)
  }
  console.log(JSON.stringify({ event: 'pickleball_open.error', route, error: error instanceof Error ? error.message : 'unknown' }))
  return jsonResponse({ error: 'Something went wrong. Try again.' }, 500)
}

/**
 * Self check-in is anonymous, so each address is limited before the DO is
 * reached. 30 per 10 minutes, not fewer: a whole venue often shares one
 * address on its Wi-Fi. The DO adds a per-session cap on top. Fails CLOSED
 * like session creation: without a working limiter, anonymous writes are
 * refused. The caller drains any body first.
 */
export async function checkInIpLimited(env: Env, request: Request): Promise<Response | null> {
  if (!env.RATE_LIMITER) return jsonResponse({ error: 'Check-in is temporarily unavailable. Try again shortly.' }, 503)
  const rate = await checkRateLimit(env, 'open-checkin-ip', clientIp(request), { limit: 30, windowMs: 10 * 60_000 })
  return rate.limited ? rateLimitedResponse('Too many check-ins from this network. Try again in a few minutes.', rate.retryAfterSeconds) : null
}

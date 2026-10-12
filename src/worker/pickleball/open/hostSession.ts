// Who the signed-in host is (spec §9.1). The devlab_pb_host cookie holds an
// opaque random token, never the host id itself: only its SHA-256 is stored
// (host_logins), so a database leak yields no usable cookie, signing out
// really ends the login, and deleting an account ends every login at once
// (cascade). No signing secret is needed, so nothing here depends on
// PICKLEBALL_SESSION_SECRET, which belongs to the app Phase 5 retires.
import { randomBase64Url, sha256Base64Url } from '../../../lib/pickleball/webCrypto.js'
import { createHostLogin, deleteHostLogin, findHostByLogin, LOGIN_TTL_MS, type HostRecord } from '../../repositories/pickleball/open/hosts'
import { checkRateLimit, clientIp, rateLimitedResponse } from '../../rateLimit.js'
import { jsonResponse } from '../../utils/responses.js'
import { clearCookieHeader, cookieFrom, HOST_COOKIE, HOST_COOKIE_PATH, isSecure, setCookieHeader } from './hostCookies'

type HostEnv = Pick<Env, 'PICKLEBALL_DB' | 'RATE_LIMITER'>

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,128}$/

function loginToken(request: Request): string | null {
  const token = cookieFrom(request, HOST_COOKIE)
  return token && TOKEN_PATTERN.test(token) ? token : null
}

/** The signed-in host, or null when the cookie is missing, malformed, expired, signed out or its account deleted. */
export async function currentHost(env: HostEnv, request: Request, now = new Date().toISOString()): Promise<HostRecord | null> {
  const token = loginToken(request)
  return token ? findHostByLogin(env.PICKLEBALL_DB, await sha256Base64Url(token), now) : null
}

/** Starts a login for this browser. Returns the Set-Cookie header to send. */
export async function beginHostLogin(env: HostEnv, request: Request, hostId: string, now = new Date().toISOString()): Promise<string> {
  const token = randomBase64Url(32)
  await createHostLogin(env.PICKLEBALL_DB, { tokenHash: await sha256Base64Url(token), hostId, now })
  return setCookieHeader(HOST_COOKIE, token, { path: HOST_COOKIE_PATH, maxAgeSeconds: Math.floor(LOGIN_TTL_MS / 1000), secure: isSecure(request) })
}

/** The Set-Cookie header that removes this browser's login cookie. */
export function clearHostCookieHeader(request: Request): string {
  return clearCookieHeader(HOST_COOKIE, { path: HOST_COOKIE_PATH, secure: isSecure(request) })
}

/** The SHA-256 of this browser's login token, or null when it holds none (a sign-in replaces that login). */
export async function currentLoginHash(request: Request): Promise<string | null> {
  const token = loginToken(request)
  return token ? sha256Base64Url(token) : null
}

/** Ends this browser's login, if any. Returns the Set-Cookie header that clears it. */
export async function endHostLogin(env: HostEnv, request: Request): Promise<string> {
  const hash = await currentLoginHash(request)
  if (hash) await deleteHostLogin(env.PICKLEBALL_DB, hash)
  return clearHostCookieHeader(request)
}

export const signInFirst = (): Response => jsonResponse({ error: 'Sign in with Google first.' }, 401)

/**
 * Per-IP limit on the host-account routes (me, sessions, reopen, sign-out).
 * 120 per minute: a club's Wi-Fi is one address. Fails open like every
 * read-mostly limiter here; the routes behind it need a valid login anyway.
 */
export async function hostAccountIpLimited(env: HostEnv, request: Request): Promise<Response | null> {
  const rate = await checkRateLimit(env, 'open-host-account', clientIp(request), { limit: 120, windowMs: 60_000 })
  return rate.limited ? rateLimitedResponse('Too many requests. Try again shortly.', rate.retryAfterSeconds) : null
}

/** Per-IP limit on starting a sign-in (and the test login): 20 per 10 minutes. Google's callback is not counted again. */
export async function signInIpLimited(env: HostEnv, request: Request): Promise<Response | null> {
  const rate = await checkRateLimit(env, 'open-host-signin', clientIp(request), { limit: 20, windowMs: 10 * 60_000 })
  return rate.limited ? rateLimitedResponse('Too many sign-in attempts. Try again in a few minutes.', rate.retryAfterSeconds) : null
}

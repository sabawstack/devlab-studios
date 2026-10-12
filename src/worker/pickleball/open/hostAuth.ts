// Google sign-in for hosts (spec §9.1). Reuses oauth.js (PKCE), the one file of
// the old app that Phase 5 keeps (§12). The callback path is the one already
// registered with Google, /api/pickleball/auth/google/callback; callback.ts
// hands every host sign-in to finishHostSignIn below.
import { normalizePublicCode } from '../../../lib/pickleball/open/codes'
import { constantTimeEqual } from '../../../lib/pickleball/open/secrets'
import { randomBase64Url } from '../../../lib/pickleball/webCrypto.js'
import { deleteHostLogin, upsertHost } from '../../repositories/pickleball/open/hosts'
import { buildGoogleAuthorizationUrl, exchangeGoogleCode, fetchGoogleProfile, generatePkcePair } from '../oauth.js'
import { clearCookieHeader, cookieFrom, HOST_OAUTH_COOKIE, HOST_OAUTH_COOKIE_PATH, isSecure, setCookieHeader } from './hostCookies'
import { beginHostLogin, currentLoginHash, signInIpLimited } from './hostSession'

/** How a sign-in ended, added to the return path as ?signin=… for the page to explain. */
export type SignInResult = 'ok' | 'cancelled' | 'unverified' | 'failed' | 'busy' | 'unavailable'

export const CALLBACK_PATH = '/api/pickleball/auth/google/callback'
export const DEFAULT_RETURN_PATH = '/pickleball/my-sessions'
const STASH_MAX_AGE_SECONDS = 600
// wrangler.jsonc once shipped this literal until real credentials existed (see auth/google/start.ts).
const CLIENT_ID_PLACEHOLDER = 'REPLACE_ME'

/**
 * replaces: the SHA-256 of the login this browser already had when the sign-in
 * started (the start route is under the login cookie's path; the callback is
 * not). The new login cookie overwrites it, so its row is deleted on success.
 */
interface Stash { verifier: string; state: string; returnTo: string; optIn: boolean; replaces: string | null }

/** The old operator app's in-flight cookie (auth/google/start.ts), deleted in Phase 5. */
export const LEGACY_OAUTH_COOKIE = 'devlab_pb_oauth'
const LOGIN_HASH_PATTERN = /^[A-Za-z0-9_-]{43}$/

type AuthEnv = Pick<Env, 'PICKLEBALL_DB' | 'RATE_LIMITER' | 'GOOGLE_OAUTH_CLIENT_ID' | 'GOOGLE_OAUTH_CLIENT_SECRET' | 'PICKLEBALL_OAUTH_REDIRECT_BASE_URL'>

export interface GoogleDeps {
  exchange: typeof exchangeGoogleCode
  profile: typeof fetchGoogleProfile
}
const GOOGLE: GoogleDeps = { exchange: exchangeGoogleCode, profile: fetchGoogleProfile }

/**
 * Where a sign-in may send the browser back to: a session's board or console,
 * or My sessions. Anything else (another site, another path, a query string)
 * falls back to My sessions, so the return path can never be an open redirect.
 */
export function safeReturnPath(raw: unknown): string {
  if (raw === DEFAULT_RETURN_PATH) return raw
  const match = typeof raw === 'string' ? /^\/pickleball\/s\/([A-Za-z0-9]{10})$/.exec(raw) : null
  const code = match ? normalizePublicCode(match[1]) : null
  return code && code === match?.[1] ? `/pickleball/s/${code}` : DEFAULT_RETURN_PATH
}

export function withSignInResult(path: string, result: SignInResult): string {
  return `${path}?signin=${result}`
}

function configured(env: AuthEnv): boolean {
  const id = env.GOOGLE_OAUTH_CLIENT_ID
  return Boolean(id && id !== CLIENT_ID_PLACEHOLDER && env.GOOGLE_OAUTH_CLIENT_SECRET && env.PICKLEBALL_OAUTH_REDIRECT_BASE_URL)
}

function redirect(location: string, cookies: string[]): Response {
  const headers = new Headers({ Location: location, 'Cache-Control': 'no-store' })
  for (const cookie of cookies) headers.append('Set-Cookie', cookie)
  return new Response(null, { status: 302, headers })
}

/** GET /api/pickleball/open/host/sign-in?return=…&optIn=1 → Google. */
export async function startHostSignIn(env: AuthEnv, request: Request): Promise<Response> {
  const url = new URL(request.url)
  const returnTo = safeReturnPath(url.searchParams.get('return'))
  if (await signInIpLimited(env, request)) return redirect(withSignInResult(returnTo, 'busy'), [])
  if (!configured(env)) return redirect(withSignInResult(returnTo, 'unavailable'), [])

  const { verifier, challenge } = await generatePkcePair()
  const state = randomBase64Url(24)
  const google = new URL(buildGoogleAuthorizationUrl({
    clientId: env.GOOGLE_OAUTH_CLIENT_ID,
    redirectUri: `${env.PICKLEBALL_OAUTH_REDIRECT_BASE_URL}${CALLBACK_PATH}`,
    state,
    codeChallenge: challenge,
    scopes: ['openid', 'email', 'profile'],
  }))
  // A shared phone at the court: let the host pick which Google account.
  google.searchParams.set('prompt', 'select_account')
  const stash: Stash = { verifier, state, returnTo, optIn: url.searchParams.get('optIn') === '1', replaces: await currentLoginHash(request) }
  return redirect(google.toString(), [
    setCookieHeader(HOST_OAUTH_COOKIE, encodeURIComponent(JSON.stringify(stash)), {
      path: HOST_OAUTH_COOKIE_PATH, maxAgeSeconds: STASH_MAX_AGE_SECONDS, secure: isSecure(request),
    }),
  ])
}

function readStash(request: Request): Stash | null {
  try {
    const value = JSON.parse(decodeURIComponent(cookieFrom(request, HOST_OAUTH_COOKIE) ?? '')) as Partial<Stash>
    if (typeof value.verifier !== 'string' || typeof value.state !== 'string') return null
    const replaces = typeof value.replaces === 'string' && LOGIN_HASH_PATTERN.test(value.replaces) ? value.replaces : null
    return { verifier: value.verifier, state: value.state, returnTo: safeReturnPath(value.returnTo), optIn: value.optIn === true, replaces }
  } catch {
    return null
  }
}

/** True while a host sign-in is in flight in this browser. */
export function hasHostSignInPending(request: Request): boolean {
  return cookieFrom(request, HOST_OAUTH_COOKIE) !== null
}

/**
 * Whether Google's callback belongs to a host sign-in: when its own in-flight
 * cookie is present, or when neither flow's is (an expired attempt then lands
 * on My sessions with "sign-in failed" rather than the old app's JSON error).
 */
export function hostOwnsCallback(request: Request): boolean {
  return hasHostSignInPending(request) || cookieFrom(request, LEGACY_OAUTH_COOKIE) === null
}

/**
 * Google's redirect back. Every outcome is a redirect to the page the host
 * started from with ?signin=…, never a raw error body. Only a verified Google
 * email is ever stored: the export is mailed to it (spec §9.6).
 */
export async function finishHostSignIn(env: AuthEnv, request: Request, deps: GoogleDeps = GOOGLE): Promise<Response> {
  const url = new URL(request.url)
  const stash = readStash(request)
  const returnTo = stash?.returnTo ?? DEFAULT_RETURN_PATH
  const clear = clearCookieHeader(HOST_OAUTH_COOKIE, { path: HOST_OAUTH_COOKIE_PATH, secure: isSecure(request) })
  const back = (result: SignInResult, extra: string[] = []) => redirect(withSignInResult(returnTo, result), [clear, ...extra])

  // Google sends state back with an error too: an error is only "cancelled" for the sign-in this browser started.
  const stateMatches = stash !== null && constantTimeEqual(url.searchParams.get('state') ?? '', stash.state)
  if (!stateMatches) return back('failed')
  if (url.searchParams.get('error')) return back('cancelled')
  const code = url.searchParams.get('code')
  if (!code) return back('failed')
  // The per-IP sign-in limit is counted once, when the sign-in starts.
  if (!configured(env)) return back('unavailable')

  try {
    const { accessToken } = await deps.exchange({
      code, codeVerifier: stash.verifier,
      clientId: env.GOOGLE_OAUTH_CLIENT_ID, clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      redirectUri: `${env.PICKLEBALL_OAUTH_REDIRECT_BASE_URL}${CALLBACK_PATH}`,
    })
    const profile = await deps.profile(accessToken)
    if (!profile.emailVerified || !profile.sub || !profile.email) return back('unverified')
    const now = new Date().toISOString()
    const email = String(profile.email).trim().toLowerCase()
    const host = await upsertHost(env.PICKLEBALL_DB, {
      googleSub: String(profile.sub), email,
      displayName: String(profile.name || email).trim().slice(0, 80) || email,
      marketingOptIn: stash.optIn,
    }, { now, newId: () => crypto.randomUUID() })
    // Always, whoever it belonged to: the new cookie overwrites it, so the old row could never be used again.
    if (stash.replaces) await deleteHostLogin(env.PICKLEBALL_DB, stash.replaces)
    return back('ok', [await beginHostLogin(env, request, host.id, now)])
  } catch (error) {
    // The reason is for the logs only; the host just sees "sign-in failed".
    console.log(JSON.stringify({ event: 'pickleball_open.host_signin_failed', error: error instanceof Error ? error.message : 'unknown' }))
    return back('failed')
  }
}

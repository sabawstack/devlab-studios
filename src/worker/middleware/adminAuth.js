import { jsonResponse } from '../utils/responses'
import {
  checkRateLimit,
  clearRateLimit,
  clientIp,
  peekRateLimit,
  rateLimitedResponse,
  recordRateLimitFailure,
} from '../rateLimit.js'
import { getAdminSessionRevocationState, revokeAdminSession } from '../repositories/adminSessions.js'
import {
  getAdminCredential,
  getPasswordChangedAtSeconds,
  upsertAdminCredential,
} from '../repositories/adminCredentials.js'

const SESSION_COOKIE = 'devlab_admin_session'
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 8
const PASSWORD_HASH_PREFIX = 'pbkdf2_sha256'
// Retired July 2026. `sha256`/`sha256hex` were single-round salted SHA-256,
// added as a workaround while Workers' PBKDF2 iteration cap was being pinned
// down and superseded once 100,000 iterations was confirmed to work on the
// real runtime (see scripts/cms/hash-admin-password.mjs). A single SHA-256
// round is crackable at billions of guesses/sec on a commodity GPU, so these
// are no longer accepted — but they're still recognised, so a credential
// left on the old format reports a precise configuration error instead of
// failing as a plain "invalid password" nobody could diagnose.
const RETIRED_PASSWORD_HASH_PREFIXES = new Set(['sha256', 'sha256hex'])
const LOGIN_WINDOW_MS = 15 * 60 * 1000
const LOGIN_MAX_ATTEMPTS = 8
// Per source address across ALL accounts, so spraying is bounded too.
const LOGIN_MAX_ATTEMPTS_PER_IP = 20
// Per ACCOUNT across all addresses. The two limits above are both keyed on
// the source IP, so an attacker with many addresses got unlimited guesses at
// the one known owner email. Counts FAILURES only (a correct login clears it),
// and reaching the ceiling locks the account for a fixed period -- including
// against the right password, which is what makes it a lockout rather than a
// throttle. The trade-off is deliberate: an attacker can keep the owner locked
// out, but can no longer keep guessing.
const LOGIN_ACCOUNT_FAILURE_LIMIT = 10
const LOGIN_ACCOUNT_LOCK_MS = 15 * 60 * 1000
const LOGIN_FAILURE_BUCKET = 'admin-login-account-failures'
const LOGIN_LOCK_BUCKET = 'admin-login-account-lock'
/** One message for every throttled/locked outcome, so none says which limit (or account) tripped. */
const LOGIN_THROTTLED_MESSAGE = 'Too many login attempts. Try again later.'

function textBytes(value) {
  return new TextEncoder().encode(value)
}

function bytesToBase64Url(bytes) {
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function base64UrlToBytes(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return bytes
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false

  let mismatch = 0
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left[index] ^ right[index]
  }

  return mismatch === 0
}

function parseCookies(cookieHeader) {
  return String(cookieHeader || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const separatorIndex = part.indexOf('=')
      if (separatorIndex === -1) return cookies

      const name = part.slice(0, separatorIndex).trim()
      const value = part.slice(separatorIndex + 1).trim()
      cookies[name] = value
      return cookies
    }, {})
}

function getCookieOptions(c, maxAge = SESSION_MAX_AGE_SECONDS) {
  const url = new URL(c.req.url)
  const secure = url.protocol === 'https:' ? '; Secure' : ''
  return `Path=/; HttpOnly; SameSite=Strict${secure}; Max-Age=${maxAge}`
}

function clearSessionCookie(c) {
  return `${SESSION_COOKIE}=; ${getCookieOptions(c, 0)}`
}

function getConfiguredAdmins(env) {
  if (env.ADMIN_USERS) {
    try {
      const users = JSON.parse(env.ADMIN_USERS)
      if (Array.isArray(users)) {
        return users
          .map((user) => ({
            email: String(user.email || '').trim().toLowerCase(),
            passwordHash: String(user.passwordHash || '').trim(),
            role: String(user.role || 'admin').trim() || 'admin',
          }))
          .filter((user) => user.email && user.passwordHash)
      }
    } catch {
      return []
    }
  }

  const email = String(env.ADMIN_EMAIL || '').trim().toLowerCase()
  const passwordHash = String(env.ADMIN_PASSWORD_HASH || '').trim()
  if (!email || !passwordHash) return []

  return [{ email, passwordHash, role: 'owner' }]
}

/** The only accepted work factor. Workers caps PBKDF2 deriveBits at 100,000. */
const PASSWORD_HASH_ITERATIONS = 100000
const PASSWORD_HASH_BYTES = 32

/**
 * The credential actually in force for an email: the CMS-managed one if it
 * exists, otherwise the environment credential.
 *
 * Resolution order is the safety property. A missing row, an unmigrated
 * database or an unreachable D1 all fall through to the env credential, so the
 * only way to be locked out is to remove BOTH — which is why the env secret is
 * documented as a permanent bootstrap rather than a migration step.
 */
async function resolveAdmin(env, email) {
  const normalized = String(email || '').trim().toLowerCase()
  if (!normalized) return null

  const stored = await getAdminCredential(env.DB, normalized)
  if (stored) return stored

  return getConfiguredAdmins(env).find((user) => user.email === normalized) || null
}

async function importPasswordKey(password) {
  return crypto.subtle.importKey('raw', textBytes(password), 'PBKDF2', false, ['deriveBits'])
}

/**
 * Produces a credential in exactly the format verifyPassword accepts.
 *
 * This lives beside verifyPassword on purpose. scripts/cms/hash-admin-password.mjs
 * builds the same format with node's pbkdf2Sync and its own base64url encoder,
 * and nothing structurally held the two implementations together — which is the
 * class of mismatch that locked the owner out of production in September 2026.
 * The in-app path must not become a third implementation, so it shares this one.
 */
export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await importPasswordKey(password)
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PASSWORD_HASH_ITERATIONS },
    key,
    PASSWORD_HASH_BYTES * 8,
  )

  return [
    PASSWORD_HASH_PREFIX,
    PASSWORD_HASH_ITERATIONS,
    bytesToBase64Url(salt),
    bytesToBase64Url(new Uint8Array(bits)),
  ].join('$')
}

/**
 * Verified against when the email is unknown, so an unknown address costs the
 * same PBKDF2 work as a known one and response time does not reveal which
 * emails are admins. Random per isolate and never matches anything.
 */
let dummyPasswordHashPromise
function dummyPasswordHash() {
  if (!dummyPasswordHashPromise) {
    const randomPassword = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(24)))
    dummyPasswordHashPromise = hashPassword(randomPassword)
  }
  return dummyPasswordHashPromise
}

/** True for a credential stored in one of the retired weak formats. */
function usesRetiredHashFormat(storedHash) {
  return RETIRED_PASSWORD_HASH_PREFIXES.has(String(storedHash || '').split('$')[0])
}

async function verifyPassword(password, storedHash) {
  const [prefix, iterationsValue, saltValue, hashValue] = String(storedHash || '').split('$')

  const iterations = Number(iterationsValue)

  if (prefix !== PASSWORD_HASH_PREFIX || !Number.isInteger(iterations) || iterations < 100000 || !saltValue || !hashValue) {
    return false
  }

  const key = await importPasswordKey(password)
  const expectedHash = base64UrlToBytes(hashValue)
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: base64UrlToBytes(saltValue),
      iterations,
    },
    key,
    expectedHash.length * 8,
  )

  return constantTimeEqual(new Uint8Array(derivedBits), expectedHash)
}

async function getSessionSigningKey(secret) {
  return crypto.subtle.importKey('raw', textBytes(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

async function signSessionPayload(payload, secret) {
  const encodedPayload = bytesToBase64Url(textBytes(JSON.stringify(payload)))
  const key = await getSessionSigningKey(secret)
  const signature = await crypto.subtle.sign('HMAC', key, textBytes(encodedPayload))

  return `v1.${encodedPayload}.${bytesToBase64Url(new Uint8Array(signature))}`
}

async function verifySessionToken(token, secret) {
  const [version, encodedPayload, encodedSignature] = String(token || '').split('.')
  if (version !== 'v1' || !encodedPayload || !encodedSignature) return null

  const key = await getSessionSigningKey(secret)
  const isValid = await crypto.subtle.verify(
    'HMAC',
    key,
    base64UrlToBytes(encodedSignature),
    textBytes(encodedPayload),
  )

  if (!isValid) return null

  try {
    const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(encodedPayload)))
    if (!payload.exp || Date.now() >= payload.exp * 1000) return null
    return payload
  } catch {
    return null
  }
}

function getSessionSecret(env) {
  return String(env.ADMIN_SESSION_SECRET || '').trim()
}

/**
 * Resolves the auth mode, and never resolves to something weaker than what
 * is actually configured.
 *
 * This used to fall back to 'cloudflare-access' whenever no session secret or
 * admin user was configured — which, combined with requireAdmin's old
 * header-trust branch, meant a missing ADMIN_SESSION_SECRET silently turned
 * into "anyone who sets a cf-access-authenticated-user-email header is an
 * admin". Misconfiguration must fail closed, so an unconfigured environment
 * now resolves to 'unconfigured' and is refused outright.
 */
function getAdminAuthMode(env) {
  const configuredMode = String(env.ADMIN_AUTH_MODE || '').trim().toLowerCase()
  if (configuredMode) return configuredMode

  return getSessionSecret(env) && getConfiguredAdmins(env).length > 0
    ? 'password'
    : 'unconfigured'
}

function getClientIp(c) {
  return c.req.header('cf-connecting-ip')
    || c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
    || 'unknown'
}

// Brute-force protection now goes through a Durable Object rather than a
// module-scope Map. The Map version did not work: Workers give every isolate
// its own memory, so 12 sequential wrong-password attempts from one IP were
// measured against production and all 12 returned 401 with the limit set to 8.
// See src/worker/RateLimiterDO.ts.
const LOGIN_BUCKET = 'admin-login'

/**
 * Counts one failed login against the account and, once the account reaches
 * LOGIN_ACCOUNT_FAILURE_LIMIT inside the window, locks it for
 * LOGIN_ACCOUNT_LOCK_MS. The lock is its own bucket so it lasts the full period
 * from the moment it trips, rather than ending whenever the oldest failure in
 * the window happens to expire.
 */
async function recordAccountLoginFailure(env, accountKey) {
  await recordRateLimitFailure(env, LOGIN_FAILURE_BUCKET, accountKey, { windowMs: LOGIN_WINDOW_MS })
  const failures = await peekRateLimit(env, LOGIN_FAILURE_BUCKET, accountKey, { limit: LOGIN_ACCOUNT_FAILURE_LIMIT })
  if (!failures.limited) return

  await recordRateLimitFailure(env, LOGIN_LOCK_BUCKET, accountKey, { windowMs: LOGIN_ACCOUNT_LOCK_MS })
  await clearRateLimit(env, LOGIN_FAILURE_BUCKET, accountKey)
  // The email itself is deliberately not logged: the key may be an attacker's
  // guess, and the log is not the place to collect them.
  console.warn(JSON.stringify({
    event: 'admin_login_account_locked',
    failures: LOGIN_ACCOUNT_FAILURE_LIMIT,
    lockMinutes: LOGIN_ACCOUNT_LOCK_MS / 60000,
  }))
}

export async function handleAdminLogin(c) {
  if (getAdminAuthMode(c.env) === 'disabled') {
    return jsonResponse({ error: 'Admin password login is disabled.' }, 400)
  }

  const sessionSecret = getSessionSecret(c.env)
  const admins = getConfiguredAdmins(c.env)
  if (!sessionSecret || admins.length === 0) {
    return jsonResponse({ error: 'Admin login is not configured.' }, 503)
  }

  let payload
  try {
    payload = await c.req.json()
  } catch {
    return jsonResponse({ error: 'Invalid login payload.' }, 400)
  }

  const email = String(payload.email || '').trim().toLowerCase()
  const password = String(payload.password || '')
  const loginKey = `${getClientIp(c)}:${email || 'unknown'}`

  // Counted on every attempt, not only on failures, so an attacker cannot
  // avoid the limit by pipelining requests before any of them resolve.
  // TWO limits, because they stop different attacks. The ip:email one stops
  // guessing a password for a known account. On its own it is trivially
  // sidestepped by password SPRAYING -- one guess each against many addresses
  // from the same host lands on a fresh counter every time, which a first
  // draft of the test for this accidentally demonstrated. The ip-only limit is
  // the one that catches that, set higher so a shared office address running
  // into it takes real effort.
  for (const [identity, limit] of [[loginKey, LOGIN_MAX_ATTEMPTS], [clientIp(c.req.raw), LOGIN_MAX_ATTEMPTS_PER_IP]]) {
    const rate = await checkRateLimit(c.env, LOGIN_BUCKET, identity, { limit, windowMs: LOGIN_WINDOW_MS })
    if (rate.limited) {
      return rateLimitedResponse(LOGIN_THROTTLED_MESSAGE, rate.retryAfterSeconds)
    }
  }

  const accountKey = email || 'unknown'
  const lock = await peekRateLimit(c.env, LOGIN_LOCK_BUCKET, accountKey, { limit: 1 })
  if (lock.limited) {
    return rateLimitedResponse(LOGIN_THROTTLED_MESSAGE, lock.retryAfterSeconds)
  }

  const admin = await resolveAdmin(c.env, email)

  // Reported as the server-configuration fault it is, rather than as a
  // credential failure. This is unreachable unless a stored hash was never
  // migrated off the retired weak formats, and in that case an undiagnosable
  // "invalid email or password" would be far worse than naming the cause.
  if (admin && usesRetiredHashFormat(admin.passwordHash)) {
    return jsonResponse({
      error: 'This account\'s stored password hash uses a retired format that is no longer accepted. Re-generate it with `npm run cms:hash-admin-password` and update the ADMIN_PASSWORD_HASH / ADMIN_USERS secret.',
    }, 503)
  }

  // Always derive: an unknown email is checked against a dummy hash so it
  // takes as long as a known one (no user enumeration by timing).
  const passwordMatches = await verifyPassword(password, admin ? admin.passwordHash : await dummyPasswordHash())
  const isValidPassword = Boolean(admin) && passwordMatches

  if (!isValidPassword) {
    await recordAccountLoginFailure(c.env, accountKey)
    return jsonResponse({ error: 'Invalid email or password.' }, 401)
  }

  await clearRateLimit(c.env, LOGIN_BUCKET, loginKey)
  await clearRateLimit(c.env, LOGIN_FAILURE_BUCKET, accountKey)

  const now = Math.floor(Date.now() / 1000)
  const token = await signSessionPayload({
    sub: admin.email,
    email: admin.email,
    role: admin.role,
    // Identifies this specific token so logout can revoke exactly it,
    // without invalidating the admin's other sessions.
    jti: crypto.randomUUID(),
    iat: now,
    exp: now + SESSION_MAX_AGE_SECONDS,
  }, sessionSecret)

  return jsonResponse(
    { ok: true, email: admin.email, role: admin.role, mode: 'password' },
    200,
    { 'Set-Cookie': `${SESSION_COOKIE}=${token}; ${getCookieOptions(c)}` },
  )
}

/**
 * Bounds how fast the current password can be guessed through this endpoint.
 * The route already requires a valid session, so this is not authentication —
 * it stops a stolen session being used to brute-force the existing password in
 * order to change it.
 */
const PASSWORD_CHANGE_BUCKET = 'admin-password-change'
const PASSWORD_CHANGE_WINDOW_MS = 15 * 60 * 1000
const PASSWORD_CHANGE_MAX_ATTEMPTS = 10
/** Matches the floor in scripts/cms/hash-admin-password.mjs. */
export const MIN_ADMIN_PASSWORD_LENGTH = 12

/**
 * Changes the signed-in admin's own password.
 *
 * Runs behind requireAdmin, so `adminEmail` is already an authenticated
 * identity — the current password is required on top of that, so possession of
 * a session is not by itself enough to replace the credential.
 */
export async function handleAdminPasswordChange(c) {
  if (getAdminAuthMode(c.env) !== 'password') {
    return jsonResponse({ error: 'Password changes are not available in this environment.' }, 400)
  }

  const sessionSecret = getSessionSecret(c.env)
  if (!sessionSecret) {
    return jsonResponse({ error: 'Admin session secret is not configured.' }, 503)
  }

  if (!c.env.DB) {
    return jsonResponse({ error: 'The database is unavailable, so the password cannot be changed right now.' }, 503)
  }

  const email = String(c.get('adminEmail') || '').trim().toLowerCase()
  if (!email) {
    return jsonResponse({ error: 'Admin login is required.' }, 401)
  }

  let payload
  try {
    payload = await c.req.json()
  } catch {
    return jsonResponse({ error: 'Invalid request payload.' }, 400)
  }

  const rate = await checkRateLimit(c.env, PASSWORD_CHANGE_BUCKET, email, {
    limit: PASSWORD_CHANGE_MAX_ATTEMPTS,
    windowMs: PASSWORD_CHANGE_WINDOW_MS,
  })
  if (rate.limited) {
    return rateLimitedResponse('Too many password change attempts. Try again later.', rate.retryAfterSeconds)
  }

  const currentPassword = String(payload.currentPassword || '')
  const newPassword = String(payload.newPassword || '')
  const confirmPassword = String(payload.confirmPassword || '')

  const admin = await resolveAdmin(c.env, email)
  if (!admin) {
    return jsonResponse({ error: 'No credential is configured for this account.' }, 503)
  }

  // A retired hash cannot be verified, so the current password can never be
  // confirmed and the change would fail as "wrong password" with no way to
  // diagnose it. Name the real cause, exactly as login does.
  if (usesRetiredHashFormat(admin.passwordHash)) {
    return jsonResponse({
      error: 'The stored password hash for this account uses a retired format. Re-generate it with `npm run cms:hash-admin-password` and update the ADMIN_PASSWORD_HASH secret before changing it here.',
    }, 503)
  }

  if (!(await verifyPassword(currentPassword, admin.passwordHash))) {
    return jsonResponse({ error: 'Your current password is incorrect.', field: 'currentPassword' }, 400)
  }

  if (newPassword.length < MIN_ADMIN_PASSWORD_LENGTH) {
    return jsonResponse({
      error: `Use a new password of at least ${MIN_ADMIN_PASSWORD_LENGTH} characters.`,
      field: 'newPassword',
    }, 400)
  }

  if (newPassword !== confirmPassword) {
    return jsonResponse({ error: 'The new passwords do not match.', field: 'confirmPassword' }, 400)
  }

  if (newPassword === currentPassword) {
    return jsonResponse({ error: 'The new password must be different from the current one.', field: 'newPassword' }, 400)
  }

  const passwordHash = await hashPassword(newPassword)

  // Not wrapped in a catch: if this write fails the operator must be told, or
  // they will believe their password changed when it did not.
  await upsertAdminCredential(c.env.DB, { email, passwordHash, role: admin.role || 'owner' })

  // Every existing token for this account is now older than password_changed_at
  // and will be refused, INCLUDING this browser's. Issue a fresh one so the
  // operator is not signed out by succeeding.
  const now = Math.floor(Date.now() / 1000)
  const token = await signSessionPayload({
    sub: email,
    email,
    role: admin.role || 'owner',
    jti: crypto.randomUUID(),
    iat: now,
    exp: now + SESSION_MAX_AGE_SECONDS,
  }, sessionSecret)

  await clearRateLimit(c.env, PASSWORD_CHANGE_BUCKET, email)

  return jsonResponse(
    { ok: true, email, signedOutOtherSessions: true },
    200,
    { 'Set-Cookie': `${SESSION_COOKIE}=${token}; ${getCookieOptions(c)}` },
  )
}

export async function handleAdminLogout(c) {
  // Clearing the cookie is not signing out: the token is self-contained and
  // stays valid until `exp`, so a captured copy kept working for up to 8
  // hours after the admin clicked "Log out". Record it as revoked as well.
  const sessionSecret = getSessionSecret(c.env)
  if (sessionSecret) {
    const cookies = parseCookies(c.req.header('Cookie'))
    const session = await verifySessionToken(cookies[SESSION_COOKIE], sessionSecret)

    if (session?.jti && session?.exp) {
      await revokeAdminSession(c.env.DB, {
        jti: session.jti,
        adminEmail: session.email || null,
        expiresAt: new Date(session.exp * 1000).toISOString(),
      })
    }
  }

  return jsonResponse(
    { ok: true },
    200,
    { 'Set-Cookie': clearSessionCookie(c) },
  )
}

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * ADMIN_AUTH_MODE=disabled makes every caller an admin, so a mistyped var in a
 * deployed environment would open the whole CMS. It is honoured only for a
 * request to a loopback host AND with the explicit local-only opt-in
 * ADMIN_AUTH_DISABLED_LOCAL_ONLY=true -- neither of which a request to the
 * preview or production hostname can satisfy.
 */
function isDisabledModeAllowed(c) {
  if (String(c.env.ADMIN_AUTH_DISABLED_LOCAL_ONLY || '').trim() !== 'true') return false
  try {
    return LOOPBACK_HOSTNAMES.has(new URL(c.req.url).hostname)
  } catch {
    return false
  }
}

export async function requireAdmin(c, next) {
  const authMode = getAdminAuthMode(c.env)

  if (authMode === 'disabled') {
    if (!isDisabledModeAllowed(c)) {
      console.error(JSON.stringify({ event: 'admin_auth_disabled_refused', outcome: 'failure' }))
      return jsonResponse({ error: 'Admin authentication is not configured for this environment.' }, 503)
    }
    c.set('adminEmail', 'admin-auth-disabled')
    c.set('adminAuthMode', 'disabled')
    return next()
  }

  if (authMode === 'password') {
    const sessionSecret = getSessionSecret(c.env)
    if (!sessionSecret) {
      return jsonResponse({ error: 'Admin session secret is not configured.' }, 503)
    }

    const cookies = parseCookies(c.req.header('Cookie'))
    const session = await verifySessionToken(cookies[SESSION_COOKIE], sessionSecret)
    if (session?.email) {
      // A signed, unexpired token is not sufficient on its own — it may have
      // been explicitly signed out. See repositories/adminSessions.js.
      // Fails CLOSED: if the revocation list cannot be read, a signed-out
      // token would otherwise be accepted for as long as D1 is unhealthy.
      const revocation = await getAdminSessionRevocationState(c.env.DB, session.jti)
      if (revocation === 'unknown') {
        return jsonResponse({ error: 'Your admin session could not be verified right now. Try again shortly.' }, 503)
      }
      if (revocation === 'revoked') {
        return jsonResponse({ error: 'This admin session has been signed out.' }, 401)
      }

      // Changing the password signs out everywhere. A token minted before the
      // change is refused, so if the password was rotated BECAUSE it leaked,
      // the session an attacker already holds dies at that moment rather than
      // surviving for the rest of its 8-hour life. Comparing one timestamp
      // costs nothing per token, unlike tracking every issued jti.
      const passwordChangedAt = await getPasswordChangedAtSeconds(c.env.DB, session.email)
      if (passwordChangedAt > 0 && Number(session.iat || 0) < passwordChangedAt) {
        return jsonResponse({ error: 'Your password changed. Please sign in again.' }, 401)
      }

      c.set('adminEmail', session.email)
      c.set('adminRole', session.role || 'admin')
      c.set('adminAuthMode', 'password')
      return next()
    }

    return jsonResponse({ error: 'Admin login is required.' }, 401)
  }

  // Anything else — including 'cloudflare-access' and 'unconfigured' — is
  // refused. The old 'cloudflare-access' branch authenticated purely on the
  // `cf-access-authenticated-user-email` request header without verifying
  // the signed `Cf-Access-Jwt-Assertion` that accompanies it, so any caller
  // able to set that header was an admin. ADMIN_AUTH_MODE is 'password' in
  // both deployed environments (wrangler.jsonc), so nothing relied on it.
  // Reinstating the mode means verifying that JWT against Access's JWKS.
  return jsonResponse({ error: 'Admin authentication is not configured for this environment.' }, 503)
}

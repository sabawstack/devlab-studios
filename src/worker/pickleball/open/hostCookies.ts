// Cookies for Google-verified hosts (spec §9.1). Self-contained on purpose:
// the old app's session.js is deleted in Phase 5 (§12), and nothing here may
// depend on it.

/** The signed-in host's login token: opaque, random, only its SHA-256 is stored (host_logins). */
export const HOST_COOKIE = 'devlab_pb_host'
/** The PKCE verifier, state and return path while Google sign-in is in flight. */
export const HOST_OAUTH_COOKIE = 'devlab_pb_host_oauth'
/** Only the open-play API ever reads the login cookie, so the browser sends it nowhere else. */
export const HOST_COOKIE_PATH = '/api/pickleball/open'
/** Only the Google callback reads the in-flight cookie. */
export const HOST_OAUTH_COOKIE_PATH = '/api/pickleball/auth/google'

export function parseCookies(header: string | null): Record<string, string> {
  const cookies: Record<string, string> = {}
  for (const part of (header ?? '').split(';')) {
    const index = part.indexOf('=')
    if (index < 1) continue
    const name = part.slice(0, index).trim()
    const value = part.slice(index + 1).trim()
    if (name && !(name in cookies)) cookies[name] = value
  }
  return cookies
}

export function cookieFrom(request: Request, name: string): string | null {
  return parseCookies(request.headers.get('Cookie'))[name] ?? null
}

interface CookieOptions {
  path: string
  maxAgeSeconds: number
  /** False only on plain-http local development. */
  secure: boolean
}

/**
 * HttpOnly (no script can read it), SameSite=Lax (sent on the top-level
 * navigation back from Google and from a link in an email, never on a
 * cross-site POST, which is half of the CSRF defence; sameOrigin.ts is the
 * other half), Secure on https.
 */
export function setCookieHeader(name: string, value: string, { path, maxAgeSeconds, secure }: CookieOptions): string {
  return [`${name}=${value}`, `Path=${path}`, `Max-Age=${maxAgeSeconds}`, 'HttpOnly', 'SameSite=Lax', ...(secure ? ['Secure'] : [])].join('; ')
}

export function clearCookieHeader(name: string, { path, secure }: Omit<CookieOptions, 'maxAgeSeconds'>): string {
  return setCookieHeader(name, '', { path, maxAgeSeconds: 0, secure })
}

export function isSecure(request: Request): boolean {
  return new URL(request.url).protocol === 'https:'
}

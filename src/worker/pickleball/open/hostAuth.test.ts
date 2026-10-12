import { describe, expect, it, vi } from 'vitest'
import { createSqliteD1 } from '../../repositories/pickleball/open/testing/sqliteD1'
import { finishHostSignIn, hasHostSignInPending, safeReturnPath, startHostSignIn, type GoogleDeps } from './hostAuth'
import { currentHost } from './hostSession'

const MIGRATIONS = ['0016_open_sessions', '0017_open_captains', '0018_open_tournaments', '0019_hosts'].map((m) => `migrations/pickleball/${m}.sql`)
const BASE = 'https://www.devlabstudios.com'

function makeEnv(overrides: Partial<Env> = {}) {
  const { d1, raw } = createSqliteD1(MIGRATIONS)
  const env = {
    PICKLEBALL_DB: d1, GOOGLE_OAUTH_CLIENT_ID: 'client-id', GOOGLE_OAUTH_CLIENT_SECRET: 'secret',
    PICKLEBALL_OAUTH_REDIRECT_BASE_URL: BASE, ...overrides,
  } as unknown as Env
  return { env, raw }
}

const setCookies = (response: Response) => response.headers.getSetCookie()
const cookieValue = (header: string) => header.split(';')[0]

async function started(env: Env, query = '?return=/pickleball/s/ABCDE23456&optIn=1', cookie: string | null = null) {
  const response = await startHostSignIn(env, new Request(`${BASE}/api/pickleball/open/host/sign-in${query}`, { headers: cookie ? { Cookie: cookie } : {} }))
  const google = new URL(response.headers.get('Location') ?? '')
  return { response, google, stash: cookieValue(setCookies(response)[0]), state: google.searchParams.get('state') ?? '' }
}

function callback(stash: string | null, query: string) {
  return new Request(`${BASE}/api/pickleball/auth/google/callback${query}`, { headers: stash ? { Cookie: stash } : {} })
}

const google = (profile: Partial<Awaited<ReturnType<GoogleDeps['profile']>>> = {}): GoogleDeps => ({
  exchange: vi.fn().mockResolvedValue({ accessToken: 'token' }),
  profile: vi.fn().mockResolvedValue({ sub: 'g-123', email: 'Mo@Example.com', emailVerified: true, name: 'Mo', picture: '', ...profile }),
})

describe('safeReturnPath', () => {
  it('allows only a session page or My sessions', () => {
    expect(safeReturnPath('/pickleball/s/ABCDE23456')).toBe('/pickleball/s/ABCDE23456')
    expect(safeReturnPath('/pickleball/my-sessions')).toBe('/pickleball/my-sessions')
    for (const bad of ['https://evil.example', '//evil.example', '/pickleball/s/ABCDE23456?x=1', '/pickleball/s/abcde23456', '/pickleball/s/ABCDE2345I', '/admin', null, 42]) {
      expect(safeReturnPath(bad), String(bad)).toBe('/pickleball/my-sessions')
    }
  })
})

describe('startHostSignIn', () => {
  it('sends the host to Google with PKCE, the registered callback and an account picker', async () => {
    const { env } = makeEnv()
    const { response, google: url, stash } = await started(env)
    expect(response.status).toBe(302)
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(url.searchParams.get('redirect_uri')).toBe(`${BASE}/api/pickleball/auth/google/callback`)
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('scope')).toBe('openid email profile')
    expect(url.searchParams.get('prompt')).toBe('select_account')
    expect(stash.startsWith('devlab_pb_host_oauth=')).toBe(true)
    expect(setCookies(response)[0]).toContain('Path=/api/pickleball/auth/google; Max-Age=600; HttpOnly; SameSite=Lax; Secure')
  })

  it('goes straight back with ?signin=unavailable when Google is not configured', async () => {
    const { env } = makeEnv({ GOOGLE_OAUTH_CLIENT_ID: 'REPLACE_ME' })
    const response = await startHostSignIn(env, new Request(`${BASE}/api/pickleball/open/host/sign-in?return=/pickleball/s/ABCDE23456`))
    expect(response.headers.get('Location')).toBe('/pickleball/s/ABCDE23456?signin=unavailable')
    expect(response.headers.getSetCookie()).toEqual([])
  })
})

describe('finishHostSignIn', () => {
  it('creates the host with the opt-in they ticked, signs them in and returns them to their session', async () => {
    const { env, raw } = makeEnv()
    const { stash, state } = await started(env)
    const deps = google()
    const response = await finishHostSignIn(env, callback(stash, `?code=abc&state=${state}`), deps)
    expect(response.headers.get('Location')).toBe('/pickleball/s/ABCDE23456?signin=ok')
    const [clearStash, login] = setCookies(response)
    expect(clearStash).toContain('devlab_pb_host_oauth=; Path=/api/pickleball/auth/google; Max-Age=0')
    expect(login).toMatch(/^devlab_pb_host=/)
    expect(deps.exchange).toHaveBeenCalledWith(expect.objectContaining({ code: 'abc', redirectUri: `${BASE}/api/pickleball/auth/google/callback` }))
    const host = await currentHost(env, new Request(`${BASE}/api/pickleball/open/host/me`, { headers: { Cookie: cookieValue(login) } }))
    expect(host).toMatchObject({ googleSub: 'g-123', email: 'mo@example.com', displayName: 'Mo', marketingOptIn: true })
    expect((raw.prepare('SELECT COUNT(*) AS n FROM hosts').get() as { n: number }).n).toBe(1)
  })

  it('opt-in stays off when the box was not ticked', async () => {
    const { env } = makeEnv()
    const { stash, state } = await started(env, '?return=/pickleball/my-sessions')
    const response = await finishHostSignIn(env, callback(stash, `?code=abc&state=${state}`), google())
    expect(response.headers.get('Location')).toBe('/pickleball/my-sessions?signin=ok')
    const host = await currentHost(env, new Request(`${BASE}/x`, { headers: { Cookie: cookieValue(setCookies(response)[1]) } }))
    expect(host?.marketingOptIn).toBe(false)
  })

  it('refuses an unverified Google email and stores nothing', async () => {
    const { env, raw } = makeEnv()
    const { stash, state } = await started(env)
    const response = await finishHostSignIn(env, callback(stash, `?code=abc&state=${state}`), google({ emailVerified: false }))
    expect(response.headers.get('Location')).toBe('/pickleball/s/ABCDE23456?signin=unverified')
    expect(setCookies(response)).toHaveLength(1)
    expect((raw.prepare('SELECT COUNT(*) AS n FROM hosts').get() as { n: number }).n).toBe(0)
  })

  it('a wrong state, a missing stash, a cancelled consent and a Google failure each say so', async () => {
    const { env } = makeEnv()
    const { stash, state } = await started(env)
    expect((await finishHostSignIn(env, callback(stash, '?code=abc&state=forged'), google())).headers.get('Location')).toBe('/pickleball/s/ABCDE23456?signin=failed')
    expect((await finishHostSignIn(env, callback(null, `?code=abc&state=${state}`), google())).headers.get('Location')).toBe('/pickleball/my-sessions?signin=failed')
    expect((await finishHostSignIn(env, callback(stash, `?error=access_denied&state=${state}`), google())).headers.get('Location')).toBe('/pickleball/s/ABCDE23456?signin=cancelled')
    // An error is only "cancelled" for the sign-in this browser started.
    expect((await finishHostSignIn(env, callback(stash, '?error=access_denied'), google())).headers.get('Location')).toBe('/pickleball/s/ABCDE23456?signin=failed')
    expect((await finishHostSignIn(env, callback(stash, '?error=access_denied&state=forged'), google())).headers.get('Location')).toBe('/pickleball/s/ABCDE23456?signin=failed')
    expect((await finishHostSignIn(env, callback(null, `?error=access_denied&state=${state}`), google())).headers.get('Location')).toBe('/pickleball/my-sessions?signin=failed')
    const broken: GoogleDeps = { exchange: vi.fn().mockRejectedValue(new Error('Google OAuth code exchange failed.')), profile: vi.fn() }
    expect((await finishHostSignIn(env, callback(stash, `?code=abc&state=${state}`), broken)).headers.get('Location')).toBe('/pickleball/s/ABCDE23456?signin=failed')
  })

  it('knows when a host sign-in is in flight', async () => {
    const { env } = makeEnv()
    const { stash } = await started(env)
    expect(hasHostSignInPending(callback(stash, ''))).toBe(true)
    expect(hasHostSignInPending(callback('devlab_pb_oauth=x', ''))).toBe(false)
  })

  it('keeps at most 80 characters of the Google name', async () => {
    const { env } = makeEnv()
    const { stash, state } = await started(env)
    const response = await finishHostSignIn(env, callback(stash, `?code=abc&state=${state}`), google({ name: `  ${'N'.repeat(100)}  ` }))
    const host = await currentHost(env, new Request(`${BASE}/x`, { headers: { Cookie: cookieValue(setCookies(response)[1]) } }))
    expect(host?.displayName).toBe('N'.repeat(80))
  })

  it('signing in again never changes the news choice the host already made', async () => {
    const { env } = makeEnv()
    const first = await started(env, '?return=/pickleball/my-sessions')
    await finishHostSignIn(env, callback(first.stash, `?code=abc&state=${first.state}`), google())
    const again = await started(env, '?return=/pickleball/my-sessions&optIn=1')
    const response = await finishHostSignIn(env, callback(again.stash, `?code=abc&state=${again.state}`), google())
    const host = await currentHost(env, new Request(`${BASE}/x`, { headers: { Cookie: cookieValue(setCookies(response)[1]) } }))
    expect(host?.marketingOptIn).toBe(false)
  })

  it('a new sign-in deletes the login this browser had before, whoever it belonged to', async () => {
    const { env, raw } = makeEnv()
    const first = await started(env)
    const firstLogin = cookieValue(setCookies(await finishHostSignIn(env, callback(first.stash, `?code=abc&state=${first.state}`), google()))[1])
    const again = await started(env, '?return=/pickleball/my-sessions', firstLogin)
    const response = await finishHostSignIn(env, callback(again.stash, `?code=abc&state=${again.state}`), google({ sub: 'g-other', email: 'bo@example.com' }))
    expect(await currentHost(env, new Request(`${BASE}/x`, { headers: { Cookie: firstLogin } }))).toBeNull()
    const host = await currentHost(env, new Request(`${BASE}/x`, { headers: { Cookie: cookieValue(setCookies(response)[1]) } }))
    expect(host?.email).toBe('bo@example.com')
    expect((raw.prepare('SELECT COUNT(*) AS n FROM host_logins').get() as { n: number }).n).toBe(1)
  })

  it('counts the per-IP sign-in limit only when a sign-in starts', async () => {
    const check = vi.fn().mockResolvedValue({ limited: true, retryAfterSeconds: 60 })
    const { env } = makeEnv({ RATE_LIMITER: { idFromName: (name: string) => name, get: () => ({ check }) } as unknown as Env['RATE_LIMITER'] })
    const { env: open } = makeEnv()
    const { stash, state } = await started(open)
    const busy = await startHostSignIn(env, new Request(`${BASE}/api/pickleball/open/host/sign-in?return=/pickleball/my-sessions`))
    expect(busy.headers.get('Location')).toBe('/pickleball/my-sessions?signin=busy')
    expect(check).toHaveBeenCalledTimes(1)
    const response = await finishHostSignIn({ ...env, PICKLEBALL_DB: open.PICKLEBALL_DB }, callback(stash, `?code=abc&state=${state}`), google())
    expect(response.headers.get('Location')).toBe('/pickleball/s/ABCDE23456?signin=ok')
    expect(check).toHaveBeenCalledTimes(1)
  })
})

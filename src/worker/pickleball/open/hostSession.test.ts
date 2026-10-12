import { describe, expect, it } from 'vitest'
import { createSqliteD1 } from '../../repositories/pickleball/open/testing/sqliteD1'
import { upsertHost } from '../../repositories/pickleball/open/hosts'
import { clearCookieHeader, cookieFrom, HOST_COOKIE, parseCookies, setCookieHeader } from './hostCookies'
import { beginHostLogin, currentHost, endHostLogin } from './hostSession'
import { crossSiteRefusal, isSameOrigin } from './sameOrigin'

const MIGRATIONS = ['0016_open_sessions', '0017_open_captains', '0018_open_tournaments', '0019_hosts'].map((m) => `migrations/pickleball/${m}.sql`)
const NOW = '2026-10-12T10:00:00.000Z'

async function setup() {
  const { d1, raw } = createSqliteD1(MIGRATIONS)
  const env = { PICKLEBALL_DB: d1 } as unknown as Pick<Env, 'PICKLEBALL_DB' | 'RATE_LIMITER'>
  const host = await upsertHost(d1, { googleSub: 'g1', email: 'mo@example.com', displayName: 'Mo', marketingOptIn: false }, { now: NOW, newId: () => 'h1' })
  return { env, raw, host }
}

const withCookie = (setCookie: string, url = 'https://www.devlabstudios.com/api/pickleball/open/host/me') =>
  new Request(url, { headers: { Cookie: setCookie.split(';')[0] } })

describe('host login', () => {
  it('a new login sets an HttpOnly, Lax, Secure cookie scoped to the open-play API that stores no host id', async () => {
    const { env, raw, host } = await setup()
    const header = await beginHostLogin(env, new Request('https://www.devlabstudios.com/x'), host.id, NOW)
    expect(header).toMatch(/^devlab_pb_host=[A-Za-z0-9_-]{43}; Path=\/api\/pickleball\/open; Max-Age=2592000; HttpOnly; SameSite=Lax; Secure$/)
    expect(header).not.toContain(host.id)
    const stored = raw.prepare('SELECT token_hash FROM host_logins').get() as { token_hash: string }
    expect(header).not.toContain(stored.token_hash)
    expect((await currentHost(env, withCookie(header), NOW))?.id).toBe(host.id)
  })

  it('plain-http local development gets no Secure flag', async () => {
    const { env, host } = await setup()
    expect(await beginHostLogin(env, new Request('http://localhost:8787/x'), host.id, NOW)).not.toContain('Secure')
  })

  it('a missing, malformed or unknown cookie is nobody', async () => {
    const { env } = await setup()
    expect(await currentHost(env, new Request('https://x.test/'), NOW)).toBeNull()
    expect(await currentHost(env, withCookie('devlab_pb_host=short'), NOW)).toBeNull()
    expect(await currentHost(env, withCookie(`devlab_pb_host=${'a'.repeat(43)}`), NOW)).toBeNull()
  })

  it('signing out ends that login only and clears the cookie', async () => {
    const { env, host } = await setup()
    const phone = await beginHostLogin(env, new Request('https://x.test/'), host.id, NOW)
    const laptop = await beginHostLogin(env, new Request('https://x.test/'), host.id, NOW)
    const cleared = await endHostLogin(env, withCookie(phone))
    expect(cleared).toContain('devlab_pb_host=; Path=/api/pickleball/open; Max-Age=0')
    expect(await currentHost(env, withCookie(phone), NOW)).toBeNull()
    expect((await currentHost(env, withCookie(laptop), NOW))?.id).toBe(host.id)
  })
})

describe('cookies', () => {
  it('parses the first value of each cookie and builds clear headers', () => {
    expect(parseCookies('a=1; b=2; a=3; junk; =x')).toEqual({ a: '1', b: '2' })
    expect(cookieFrom(new Request('https://x.test/', { headers: { Cookie: `${HOST_COOKIE}=tok` } }), HOST_COOKIE)).toBe('tok')
    expect(setCookieHeader('n', 'v', { path: '/p', maxAgeSeconds: 5, secure: false })).toBe('n=v; Path=/p; Max-Age=5; HttpOnly; SameSite=Lax')
    expect(clearCookieHeader('n', { path: '/p', secure: true })).toBe('n=; Path=/p; Max-Age=0; HttpOnly; SameSite=Lax; Secure')
  })
})

describe('same-origin guard', () => {
  const post = (headers: Record<string, string>) => new Request('https://www.devlabstudios.com/api/pickleball/open/host/me', { method: 'POST', headers })
  it('accepts this site and refuses any other, or a request that says nothing', () => {
    expect(isSameOrigin(post({ Origin: 'https://www.devlabstudios.com' }))).toBe(true)
    expect(isSameOrigin(post({ 'Sec-Fetch-Site': 'same-origin' }))).toBe(true)
    expect(isSameOrigin(post({ Origin: 'https://evil.example' }))).toBe(false)
    expect(isSameOrigin(post({ Origin: 'https://devlabstudios.com' }))).toBe(false)
    expect(isSameOrigin(post({ 'Sec-Fetch-Site': 'cross-site' }))).toBe(false)
    expect(isSameOrigin(post({}))).toBe(false)
    expect(crossSiteRefusal(post({ Origin: 'https://evil.example' }))?.status).toBe(403)
    expect(crossSiteRefusal(post({ Origin: 'https://www.devlabstudios.com' }))).toBeNull()
  })
})

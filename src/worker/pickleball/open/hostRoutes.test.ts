// Route-level checks for the host-account routes: the env gate on the test
// login, and the order PATCH …/host/me refuses in (cross-site, then signed
// out, then a bad body). getEnv() reads cloudflare:workers, mocked here.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSqliteD1 } from '../../repositories/pickleball/open/testing/sqliteD1'
import { createHostLogin, upsertHost } from '../../repositories/pickleball/open/hosts'
import { sha256Base64Url } from '../../../lib/pickleball/webCrypto.js'

const runtime = vi.hoisted(() => ({ env: {} as Record<string, unknown> }))
vi.mock('cloudflare:workers', () => ({
  get env() {
    return runtime.env
  },
}))

const { POST: testLogin } = await import('../../../pages/api/pickleball/open/host/test-login')
const { PATCH: patchMe } = await import('../../../pages/api/pickleball/open/host/me')

const MIGRATIONS = ['0016_open_sessions', '0017_open_captains', '0018_open_tournaments', '0019_hosts'].map((m) => `migrations/pickleball/${m}.sql`)
const BASE = 'https://www.devlabstudios.com'
const TOKEN = 'a-login-token-that-is-long-enough'

type Route = (context: never) => Response | Promise<Response>
const call = (route: Route, request: Request) => route({ request, params: {}, locals: {} } as never)

function request(path: string, method: string, body: string | null, headers: Record<string, string> = {}) {
  return new Request(`${BASE}${path}`, { method, body, headers: { 'Content-Type': 'application/json', ...headers } })
}

beforeEach(() => {
  runtime.env = { PICKLEBALL_DB: createSqliteD1(MIGRATIONS).d1 }
})

describe('POST /api/pickleball/open/host/test-login', () => {
  for (const flag of [undefined, 'false', '1', 'TRUE']) {
    it(`is not found when PICKLEBALL_TEST_AUTH_ENABLED is ${String(flag)}`, async () => {
      runtime.env = { ...runtime.env, PICKLEBALL_TEST_AUTH_ENABLED: flag }
      const response = await call(testLogin, request('/api/pickleball/open/host/test-login', 'POST', JSON.stringify({ email: 'mo@example.com' }), { Origin: BASE }))
      expect(response.status).toBe(404)
    })
  }

  it('signs in when the flag is exactly "true"', async () => {
    runtime.env = { ...runtime.env, PICKLEBALL_TEST_AUTH_ENABLED: 'true' }
    const response = await call(testLogin, request('/api/pickleball/open/host/test-login', 'POST', JSON.stringify({ email: 'mo@example.com' }), { Origin: BASE }))
    expect(response.status).toBe(200)
    expect(response.headers.get('Set-Cookie')).toMatch(/^devlab_pb_host=/)
  })
})

describe('PATCH /api/pickleball/open/host/me', () => {
  async function signedIn() {
    const db = runtime.env.PICKLEBALL_DB as D1Database
    const now = new Date().toISOString()
    const host = await upsertHost(db, { googleSub: 'g', email: 'mo@example.com', displayName: 'Mo', marketingOptIn: false }, { now, newId: () => 'h1' })
    await createHostLogin(db, { tokenHash: await sha256Base64Url(TOKEN), hostId: host.id, now })
    return { Origin: BASE, Cookie: `devlab_pb_host=${TOKEN}` }
  }
  const patch = (body: string, headers: Record<string, string>) => call(patchMe, request('/api/pickleball/open/host/me', 'PATCH', body, headers))
  const errorOf = async (response: Response) => ((await response.json()) as { error: string }).error

  it('refuses cross-site first, then a signed-out caller, then a bad body', async () => {
    const auth = await signedIn()
    const bad = JSON.stringify({ duprClubId: 'bad id!' })
    expect((await patch(bad, { ...auth, Origin: 'https://evil.example' })).status).toBe(403)
    expect((await patch(bad, { Origin: BASE })).status).toBe(401)
    const refused = await patch(bad, auth)
    expect(refused.status).toBe(400)
    expect(await errorOf(refused)).toBe('A DUPR Club ID is 3 to 20 letters, digits or dashes.')
  })

  it('names the field that was wrong', async () => {
    const auth = await signedIn()
    expect(await errorOf(await patch(JSON.stringify({ marketingOptIn: 'yes' }), auth))).toBe('The news choice must be true or false.')
    expect(await errorOf(await patch(JSON.stringify({}), auth))).toBe('Send a DUPR Club ID, a news choice, or both.')
    expect(await errorOf(await patch('not json', auth))).toBe('Send a DUPR Club ID, a news choice, or both.')
    const saved = await patch(JSON.stringify({ duprClubId: 'CLUB-1' }), auth)
    expect(saved.status).toBe(200)
    expect(((await saved.json()) as { host: { duprClubId: string } }).host.duprClubId).toBe('CLUB-1')
  })

  it('caps the body by what was read, not only by Content-Length', async () => {
    const auth = await signedIn()
    const big = JSON.stringify({ duprClubId: 'CLUB-1', pad: 'x'.repeat(2000) })
    const oversized = request('/api/pickleball/open/host/me', 'PATCH', big, auth)
    expect(oversized.headers.get('content-length')).toBeNull()
    expect((await call(patchMe, oversized)).status).toBe(413)
  })
})

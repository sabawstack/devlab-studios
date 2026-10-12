// Google-verified hosts and the DUPR export (spec §9), end to end against the
// real Worker, Durable Object and local D1. Google itself is replaced by the
// env-gated test login (spec §13): POST /api/pickleball/open/host/test-login
// answers only when PICKLEBALL_TEST_AUTH_ENABLED=true (.dev.vars), and with
// that flag on the export is never emailed: the response carries the outbox.
import { test, expect } from '@playwright/test'

const ROSTER = [
  { name: 'Ana', duprId: 'AAA111' }, { name: 'Ben', duprId: 'BBB222' }, { name: 'Cy', duprId: 'CCC333' },
  { name: 'Di', duprId: 'DDD444' }, { name: 'Eve' },
]

// Creation is limited per IP per day and the host routes per minute, and every
// local request shares one address, so each test claims its own (see open-play.spec.js).
const freshIp = () => `10.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 254) + 1}`
const testIp = new Map()
const ipFor = (key) => testIp.get(key) ?? testIp.set(key, freshIp()).get(key)
const uniqueEmail = (who) => `${who}-${crypto.randomUUID().slice(0, 8)}@example.com`

async function createSession(request, name = 'Saturday Social') {
  const response = await request.post('/api/pickleball/open/sessions', {
    headers: { 'cf-connecting-ip': freshIp() },
    data: { name, hostDisplayName: 'Coach Mo', courtCount: 1, settings: { mode: 'PADDLE_STACK', target: 11, scoringStyle: 'SIDEOUT' }, players: ROSTER },
  })
  expect(response.status()).toBe(201)
  return response.json()
}

/** Every write to a host route says where it came from, as a browser would. */
const writeHeaders = (baseURL, code, extra = {}) => ({ Origin: baseURL, 'cf-connecting-ip': ipFor(code), ...extra })

async function signIn(request, baseURL, email, key = email) {
  const response = await request.post('/api/pickleball/open/host/test-login', {
    headers: writeHeaders(baseURL, key), data: { email, name: 'Coach Mo' },
  })
  expect(response.status(), await response.text()).toBe(200)
  return (await response.json()).host
}

function command(request, code, hostKey, cmd) {
  return request.post(`/api/pickleball/open/s/${code}/commands`, {
    headers: { 'X-Host-Key': hostKey, 'cf-connecting-ip': ipFor(code) },
    data: { idempotencyKey: crypto.randomUUID(), command: cmd },
  })
}

async function ok(request, code, hostKey, cmd) {
  const response = await command(request, code, hostKey, cmd)
  expect(response.status(), `${cmd.type}: ${await response.text()}`).toBe(200)
  return (await response.json()).host
}

/** Plays one game on Court 1 with exactly these teams and score. */
async function play(request, code, hostKey, teamA, teamB, scoreA, scoreB) {
  let host = (await (await request.get(`/api/pickleball/open/s/${code}/host`, { headers: { 'X-Host-Key': hostKey, 'cf-connecting-ip': ipFor(code) } })).json())
  const id = (name) => host.players.find((p) => p.name === name).id
  const match = host.courts[0].match
  host = await ok(request, code, hostKey, { type: 'EDIT_PROPOSAL', matchId: match.id, teamA: teamA.map(id), teamB: teamB.map(id) })
  await ok(request, code, hostKey, { type: 'START_MATCH', matchId: match.id })
  return ok(request, code, hostKey, { type: 'RECORD_RESULT', matchId: match.id, winner: scoreA > scoreB ? 'A' : 'B', scoreA, scoreB })
}

const dupr = (request, code, hostKey, tz = 'UTC') =>
  request.get(`/api/pickleball/open/s/${code}/dupr?tz=${encodeURIComponent(tz)}`, { headers: { 'X-Host-Key': hostKey, 'cf-connecting-ip': ipFor(code) } })
const claim = (request, baseURL, code, hostKey, headers = {}) =>
  request.post(`/api/pickleball/open/s/${code}/claim`, { headers: writeHeaders(baseURL, code, { 'X-Host-Key': hostKey, ...headers }) })
const setClubId = (request, baseURL, key, duprClubId = '12345') =>
  request.patch('/api/pickleball/open/host/me', { headers: writeHeaders(baseURL, key), data: { duprClubId } })

/** A session linked to a freshly signed-in host with a Club ID and one exportable game. */
async function readyToExport(request, baseURL) {
  const session = await createSession(request)
  const email = uniqueEmail('mo')
  await signIn(request, baseURL, email, session.code)
  expect((await setClubId(request, baseURL, session.code)).status()).toBe(200)
  expect((await claim(request, baseURL, session.code, session.hostKey)).status()).toBe(200)
  await play(request, session.code, session.hostKey, ['Ana', 'Ben'], ['Cy', 'Di'], 11, 7)
  return { ...session, email }
}

test.describe('linking a session, and My sessions (API)', () => {
  test('a session is linked once: another account, a wrong host key and no sign-in are all refused', async ({ request, playwright, baseURL }) => {
    const { code, hostKey } = await readyToExport(request, baseURL)
    const other = await playwright.request.newContext({ baseURL })
    await signIn(other, baseURL, uniqueEmail('bo'), `${code}-bo`)
    expect((await setClubId(other, baseURL, `${code}-bo`)).status()).toBe(200)
    const taken = await claim(other, baseURL, code, hostKey)
    expect(taken.status()).toBe(409)
    expect((await taken.json()).error).toBe('This session is already linked to another Google account.')
    expect((await (await dupr(other, code, hostKey)).json()).claim).toBe('OTHER')

    expect((await claim(request, baseURL, code, 'not-the-host-key-at-all')).status()).toBe(403)
    const stranger = await playwright.request.newContext({ baseURL })
    expect((await claim(stranger, baseURL, code, hostKey)).status()).toBe(401)
    expect((await (await dupr(stranger, code, hostKey)).json())).toMatchObject({ host: null, claim: 'OTHER' })
    expect((await dupr(stranger, code, 'wrong-key-wrong-key')).status()).toBe(403)
    await other.dispose()
    await stranger.dispose()
  })

  test('My sessions lists linked sessions only, and reopens one with a new host link that leaves the old one working', async ({ request, playwright, baseURL }) => {
    const { code, hostKey } = await readyToExport(request, baseURL)
    const unlinked = await createSession(request, 'Not linked')
    const list = await (await request.get('/api/pickleball/open/host/sessions', { headers: { 'cf-connecting-ip': ipFor(code) } })).json()
    expect(list.sessions.map((s) => s.code)).toEqual([code])
    expect(list.sessions.map((s) => s.code)).not.toContain(unlinked.code)
    expect(list.sessions[0]).toMatchObject({ name: 'Saturday Social', kind: 'OPEN_PLAY', status: 'ACTIVE' })

    const reopened = await request.post(`/api/pickleball/open/host/sessions/${code}/reopen`, { headers: writeHeaders(baseURL, code) })
    expect(reopened.status()).toBe(201)
    const { hostKey: freshKey } = await reopened.json()
    expect(freshKey).not.toBe(hostKey)
    for (const key of [freshKey, hostKey]) {
      expect((await request.get(`/api/pickleball/open/s/${code}/host`, { headers: { 'X-Host-Key': key, 'cf-connecting-ip': ipFor(code) } })).status()).toBe(200)
    }
    expect((await command(request, code, freshKey, { type: 'SET_SELF_CHECK_IN', enabled: false })).status()).toBe(200)

    const other = await playwright.request.newContext({ baseURL })
    await signIn(other, baseURL, uniqueEmail('bo'), `${code}-bo`)
    expect((await other.post(`/api/pickleball/open/host/sessions/${code}/reopen`, { headers: writeHeaders(baseURL, `${code}-bo`) })).status()).toBe(403)
    expect((await (await other.get('/api/pickleball/open/host/sessions', { headers: { 'cf-connecting-ip': ipFor(`${code}-bo`) } })).json()).sessions).toEqual([])
    const stranger = await playwright.request.newContext({ baseURL })
    expect((await stranger.get('/api/pickleball/open/host/sessions')).status()).toBe(401)
    await other.dispose()
    await stranger.dispose()
  })

  test('a session has at most 10 extra host links', async ({ request, baseURL }) => {
    const { code } = await readyToExport(request, baseURL)
    const reopen = () => request.post(`/api/pickleball/open/host/sessions/${code}/reopen`, { headers: writeHeaders(baseURL, code) })
    for (let i = 0; i < 10; i += 1) expect((await reopen()).status()).toBe(201)
    const capped = await reopen()
    expect(capped.status()).toBe(409)
    expect((await capped.json()).error).toBe('This session already has 10 extra host links. Open it on a device you used before.')
  })

  test('sign-in never leaves the site except for Google, and the registered callback belongs to host sign-in', async ({ request }) => {
    const { code } = await createSession(request)
    const start = await request.get(`/api/pickleball/open/host/sign-in?return=/pickleball/s/${code}`, { maxRedirects: 0 })
    expect(start.status()).toBe(302)
    const location = start.headers()['location']
    if (location.startsWith('/')) {
      // No GOOGLE_OAUTH_CLIENT_SECRET in this environment: the host is sent straight back with a reason.
      expect(location).toBe(`/pickleball/s/${code}?signin=unavailable`)
    } else {
      const google = new URL(location)
      expect(google.origin + google.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
      expect(google.searchParams.get('redirect_uri')).toMatch(/\/api\/pickleball\/auth\/google\/callback$/)
    }
    const offsite = await request.get('/api/pickleball/open/host/sign-in?return=https://evil.example/', { maxRedirects: 0 })
    expect(offsite.headers()['location']).not.toContain('evil.example')

    const callback = await request.get('/api/pickleball/auth/google/callback?code=x&state=y', { maxRedirects: 0 })
    expect(callback.status()).toBe(302)
    expect(callback.headers()['location']).toBe('/pickleball/my-sessions?signin=failed')
  })
})

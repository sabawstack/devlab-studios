import { test, expect } from '@playwright/test'

const ROSTER = ['Ana', 'Ben', 'Carlo', 'Dina', 'Eli', 'Fay', 'Gio', 'Hana', 'Ivan']

// Creation is limited to 10 per IP per day, and under `wrangler dev` every request
// shares one address whose counter persists between runs. Each create therefore
// claims its own address (cf-connecting-ip is overwritten by the edge in production).
const freshIp = () => `10.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 254) + 1}`

export async function createSession(request, overrides = {}) {
  const response = await request.post('/api/pickleball/open/sessions', {
    headers: { 'cf-connecting-ip': freshIp() },
    data: {
      name: 'Sunday Open Play',
      hostDisplayName: 'Coach Mike',
      courtCount: 2,
      settings: { mode: 'PADDLE_STACK', target: 11, winnerOnly: false, scoringStyle: 'SIDEOUT' },
      players: ROSTER.map((name) => ({ name })),
      ...overrides,
    },
  })
  expect(response.status()).toBe(201)
  return response.json()
}

function command(request, code, hostKey, cmd, idempotencyKey = crypto.randomUUID()) {
  return request.post(`/api/pickleball/open/s/${code}/commands`, {
    headers: { 'X-Host-Key': hostKey },
    data: { idempotencyKey, command: cmd },
  })
}

test.describe('open play API', () => {
  test('create, then the public board shows proposals and nothing private', async ({ request }) => {
    const { code, hostKey } = await createSession(request)
    expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{10}$/)
    expect(hostKey.length).toBeGreaterThanOrEqual(20)

    const state = await (await request.get(`/api/pickleball/open/s/${code}/state`)).json()
    expect(state.courts.map((c) => c.state)).toEqual(['UP_NEXT', 'UP_NEXT'])
    expect(JSON.stringify(state)).not.toMatch(/hostKey|host_key|hash/i)
  })

  test('commands need the host key', async ({ request }) => {
    const { code } = await createSession(request)
    const denied = await command(request, code, 'wrong-key-wrong-key', { type: 'END_SESSION' })
    expect(denied.status()).toBe(403)
    const missing = await request.get(`/api/pickleball/open/s/${code}/host`)
    expect(missing.status()).toBe(403)
  })

  test('a game is saved once: replay returns the same answer, a second save is 409', async ({ request }) => {
    const { code, hostKey } = await createSession(request)
    const host = await (await request.get(`/api/pickleball/open/s/${code}/host`, { headers: { 'X-Host-Key': hostKey } })).json()
    const match = host.courts[0].match
    const save = { type: 'RECORD_RESULT', matchId: match.id, winner: 'A', scoreA: 11, scoreB: 7 }

    const first = await command(request, code, hostKey, save, 'same-key-123456')
    expect(first.status()).toBe(200)
    const replay = await command(request, code, hostKey, save, 'same-key-123456')
    expect(replay.status()).toBe(200)
    expect((await replay.json()).version).toBe((await first.json()).version)

    const again = await command(request, code, hostKey, save)
    expect(again.status()).toBe(409)

    const state = await (await request.get(`/api/pickleball/open/s/${code}/state`)).json()
    expect(state.recentResults).toHaveLength(1)
    expect(state.standings[0]).toMatchObject({ wins: 1, losses: 0 })
  })

  test('an impossible score is refused with a reason', async ({ request }) => {
    const { code, hostKey } = await createSession(request)
    const host = await (await request.get(`/api/pickleball/open/s/${code}/host`, { headers: { 'X-Host-Key': hostKey } })).json()
    const response = await command(request, code, hostKey, { type: 'RECORD_RESULT', matchId: host.courts[0].match.id, winner: 'A', scoreA: 12, scoreB: 9 })
    expect(response.status()).toBe(400)
    expect((await response.json()).error).toContain("can't end 12–9")
    // Both endings are accepted: sudden death on one court, win by 2 on the other.
    expect((await command(request, code, hostKey, { type: 'RECORD_RESULT', matchId: host.courts[0].match.id, winner: 'A', scoreA: 11, scoreB: 10 })).status()).toBe(200)
    expect((await command(request, code, hostKey, { type: 'RECORD_RESULT', matchId: host.courts[1].match.id, winner: 'B', scoreA: 10, scoreB: 12 })).status()).toBe(200)
  })

  test('results download as CSV, and delete removes the session for everyone', async ({ request, baseURL }) => {
    const { code, hostKey } = await createSession(request)
    const csv = await request.get(`/api/pickleball/open/s/${code}/results.csv`, { headers: { 'X-Host-Key': hostKey } })
    expect(csv.status()).toBe(200)
    expect(csv.headers()['content-type']).toContain('text/csv')
    expect(await csv.text()).toContain('Rank,Player')

    // A browser always sends Origin on DELETE; Astro's CSRF check rejects a bodyless request without one.
    const removed = await request.delete(`/api/pickleball/open/s/${code}/session`, { headers: { 'X-Host-Key': hostKey, Origin: baseURL } })
    expect(removed.status()).toBe(200)
    expect((await request.get(`/api/pickleball/open/s/${code}/state`)).status()).toBe(404)
  })

  test('bad input is a 400, an unknown code a 404', async ({ request }) => {
    const bad = await request.post('/api/pickleball/open/sessions', { headers: { 'cf-connecting-ip': freshIp() }, data: { name: '', courtCount: 99 } })
    expect(bad.status()).toBe(400)
    expect((await request.get('/api/pickleball/open/s/ZZZZZ22222/state')).status()).toBe(404)
    expect((await request.get('/api/pickleball/open/s/not-a-code/state')).status()).toBe(404)
  })
})

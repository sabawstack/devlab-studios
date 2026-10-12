// Free tournaments (spec §6): generate → edit → start → play to a champion for
// every format, plus the edits the draw refuses. API tests drive the real
// Worker and Durable Object; the screen tests drive the console and board.
import { test, expect } from '@playwright/test'

const NAMES = ['Ana', 'Ben', 'Cy', 'Di', 'Eva', 'Fin', 'Gus', 'Hal', 'Ivy', 'Jo', 'Kai', 'Lu', 'Max', 'Ned', 'Oz', 'Pia', 'Quin', 'Rae']

// Each create claims its own address: creation is limited to 10 per IP per day (see open-play.spec.js).
const freshIp = () => `10.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 254) + 1}`

async function createTournament(request, { players = 8, courtCount = 2, format = 'ROUND_ROBIN' } = {}) {
  const response = await request.post('/api/pickleball/open/sessions', {
    headers: { 'cf-connecting-ip': freshIp() },
    data: {
      name: 'Saturday Cup', hostDisplayName: 'Coach Mike', courtCount, kind: 'TOURNAMENT', tournament: { format },
      settings: { mode: 'PADDLE_STACK', target: 11, scoringStyle: 'SIDEOUT' },
      players: NAMES.slice(0, players).map((name, i) => ({ name, skill: 5 - (i % 5), duprId: 'AB12C3' })),
    },
  })
  expect(response.status()).toBe(201)
  return response.json()
}

// Host routes allow 120 requests a minute per address, and parallel tests share
// one local address, so every call in this file comes from its test's own address.
const testIp = new Map()
const ipFor = (code) => testIp.get(code) ?? testIp.set(code, freshIp()).get(code)

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

async function refused(request, code, hostKey, cmd) {
  const response = await command(request, code, hostKey, cmd)
  expect(response.status()).toBe(409)
  return (await response.json()).error
}

async function hostSnapshot(request, code, hostKey) {
  const response = await request.get(`/api/pickleball/open/s/${code}/host`, { headers: { 'X-Host-Key': hostKey, 'cf-connecting-ip': ipFor(code) } })
  expect(response.status()).toBe(200)
  return response.json()
}

/** Starts and saves the game on the first busy court (side A wins 11–6) until the tournament is over. */
async function playToChampion(request, code, hostKey) {
  let host = await hostSnapshot(request, code, hostKey)
  for (let guard = 0; guard < 80; guard += 1) {
    if (host.viewer.tournament.phase === 'FINISHED') return host
    const match = host.courts.map((c) => c.match).find(Boolean)
    expect(match, 'a free court always gets the next playable game').toBeTruthy()
    if (match.status === 'PROPOSED') await ok(request, code, hostKey, { type: 'START_MATCH', matchId: match.id })
    host = await ok(request, code, hostKey, { type: 'RECORD_RESULT', matchId: match.id, winner: 'A', scoreA: 11, scoreB: 6 })
  }
  throw new Error('the tournament did not finish')
}

test.describe('tournaments (API)', () => {
  for (const [format, players, pairing, seeding, games] of [
    ['ROUND_ROBIN', 8, 'RANDOM', 'RANDOM', 6],
    ['POOL_TO_BRACKET', 16, 'BALANCED', 'BY_SKILL', 15],
    ['SINGLE_ELIMINATION', 10, 'MANUAL', 'MANUAL', 4],
    ['DOUBLE_ELIMINATION', 8, 'BALANCED', 'RANDOM', 6],
  ]) {
    test(`${format}: generate, edit the draft, start, and play to a champion`, async ({ request }) => {
      const { code, hostKey } = await createTournament(request, { players, format })
      let host = await ok(request, code, hostKey, { type: 'GENERATE_DRAW', format, pairing, seeding })
      const t = host.viewer.tournament
      expect(t.phase).toBe('DRAFT')
      expect(t.fixtures).toHaveLength(games)
      expect(host.courts.every((c) => c.match === null)).toBe(true)

      // An unrestricted draft edit: two players in different pairs trade places.
      const [first, second] = t.pairs
      host = await ok(request, code, hostKey, { type: 'EDIT_DRAW', edit: { kind: 'SWAP_PLAYERS', playerIds: [first.playerIds[0], second.playerIds[0]] } })
      expect(host.viewer.tournament.pairs[0].playerIds).toEqual([second.playerIds[0], first.playerIds[1]])

      host = await ok(request, code, hostKey, { type: 'START_TOURNAMENT' })
      expect(host.courts.map((c) => c.fixtureLabel).every(Boolean)).toBe(true)

      const done = await playToChampion(request, code, hostKey)
      expect(done.viewer.tournament.fixtures.every((f) => f.status === 'FINISHED')).toBe(true)
      const board = await (await request.get(`/api/pickleball/open/s/${code}/state`)).json()
      expect(board.tournament.champion?.name).toMatch(/ & /)
      expect(JSON.stringify(board)).not.toMatch(/AB12C3|skill|duprId/)

      const csv = await (await request.get(`/api/pickleball/open/s/${code}/results.csv`, { headers: { 'X-Host-Key': hostKey, 'cf-connecting-ip': ipFor(code) } })).text()
      expect(csv).toContain('Game,Stage,Court')
      expect(csv).toContain('Rank,Pool,Pair,Played,Won,Lost')
    })
  }

  test('edits that break the draw are refused with the reason', async ({ request }) => {
    const { code, hostKey } = await createTournament(request, { players: 9 })
    let host = await ok(request, code, hostKey, { type: 'GENERATE_DRAW', format: 'ROUND_ROBIN', pairing: 'MANUAL', seeding: 'MANUAL' })
    const t = host.viewer.tournament
    const [g1, g2] = t.fixtures.filter((f) => f.roundNumber === 1)
    expect(await refused(request, code, hostKey, { type: 'EDIT_DRAW', edit: { kind: 'SET_OPPONENT', fixtureId: g1.id, side: 'B', entrantId: g2.entrantBId } }))
      .toMatch(/would play each other twice\.$/)
    expect(await refused(request, code, hostKey, { type: 'EDIT_DRAW', edit: { kind: 'MOVE_PAIR', entrantId: t.pairs[0].id, poolLabel: 'B' } }))
      .toBe('Only a draw with pools has pools to move between.')
    expect(await refused(request, code, hostKey, { type: 'START_TOURNAMENT' })).toBe('Ivy has no partner. Swap them into a pair, or put them on a break to keep them as a substitute.')
    expect(await refused(request, code, hostKey, { type: 'SET_MODE', mode: 'BALANCED' })).toBe('That is for open play. In a tournament the draw decides who plays whom.')

    const ivy = host.players.find((p) => p.name === 'Ivy')
    await ok(request, code, hostKey, { type: 'SET_PLAYER_STATUS', playerId: ivy.id, status: 'BREAK' })
    host = await ok(request, code, hostKey, { type: 'START_TOURNAMENT' })
    expect(await refused(request, code, hostKey, { type: 'EDIT_DRAW', edit: { kind: 'SWAP_PLAYERS', playerIds: [t.pairs[0].playerIds[0], t.pairs[1].playerIds[0]] } }))
      .toMatch(/^The draw is locked once the tournament starts\./)
    expect(await refused(request, code, hostKey, { type: 'GENERATE_DRAW', format: 'ROUND_ROBIN', pairing: 'RANDOM', seeding: 'RANDOM' })).toBe('The draw is locked once the tournament starts.')

    const game = host.courts[0].match
    await ok(request, code, hostKey, { type: 'START_MATCH', matchId: game.id })
    const pairOnCourt = host.viewer.tournament.pairs.find((p) => p.playerIds.includes(game.teamA[0]))
    expect(await refused(request, code, hostKey, { type: 'SUBSTITUTE_PLAYER', entrantId: pairOnCourt.id, outPlayerId: game.teamA[0], inPlayerId: ivy.id }))
      .toMatch(/are on court\. Substitute after their game\.$/)
    const later = host.viewer.tournament.fixtures.find((f) => f.roundNumber === 2)
    expect(await refused(request, code, hostKey, { type: 'SWAP_OPPONENTS', fixtureId: g1.id, side: 'B', otherFixtureId: later.id, otherSide: 'B' }))
      .toMatch(/same round|already started/)
    expect(await refused(request, code, hostKey, { type: 'SET_PLAYER_STATUS', playerId: game.teamA[0], status: 'LEFT' })).toMatch(/is playing|Substitute them first/)
  })

  test('a substitute takes a player’s place in a pair that is not on court', async ({ request }) => {
    const { code, hostKey } = await createTournament(request, { players: 9, courtCount: 1 })
    await ok(request, code, hostKey, { type: 'GENERATE_DRAW', format: 'ROUND_ROBIN', pairing: 'MANUAL', seeding: 'MANUAL' })
    let host = await hostSnapshot(request, code, hostKey)
    const ivy = host.players.find((p) => p.name === 'Ivy')
    await ok(request, code, hostKey, { type: 'SET_PLAYER_STATUS', playerId: ivy.id, status: 'BREAK' })
    host = await ok(request, code, hostKey, { type: 'START_TOURNAMENT' })
    const onCourt = new Set([...host.courts[0].match.teamA, ...host.courts[0].match.teamB])
    const resting = host.viewer.tournament.pairs.find((p) => !p.playerIds.some((id) => onCourt.has(id)))
    host = await ok(request, code, hostKey, { type: 'SUBSTITUTE_PLAYER', entrantId: resting.id, outPlayerId: resting.playerIds[1], inPlayerId: ivy.id })
    const after = host.viewer.tournament.pairs.find((p) => p.id === resting.id)
    expect(after.playerIds).toEqual([resting.playerIds[0], ivy.id])
    expect(host.players.find((p) => p.id === ivy.id).status).toBe('ACTIVE')
  })

  test('a court captain saves results on their tournament court, and nothing else', async ({ request }) => {
    const { code, hostKey } = await createTournament(request, { players: 8 })
    await ok(request, code, hostKey, { type: 'GENERATE_DRAW', format: 'SINGLE_ELIMINATION', pairing: 'MANUAL', seeding: 'MANUAL' })
    const host = await ok(request, code, hostKey, { type: 'START_TOURNAMENT' })
    const made = await request.post(`/api/pickleball/open/s/${code}/captains`, { headers: { 'X-Host-Key': hostKey, 'cf-connecting-ip': ipFor(code) }, data: { courtId: host.courts[0].id } })
    const { captainKey } = await made.json()
    const asCaptain = (cmd) => request.post(`/api/pickleball/open/s/${code}/commands`, {
      headers: { 'X-Captain-Key': captainKey }, data: { idempotencyKey: crypto.randomUUID(), command: cmd },
    })
    const view = await (await request.get(`/api/pickleball/open/s/${code}/captain`, { headers: { 'X-Captain-Key': captainKey } })).json()
    expect(view.court.fixtureLabel).toBe('Semi-final 1')
    const saved = await asCaptain({ type: 'RECORD_RESULT', matchId: host.courts[0].match.id, winner: 'B', scoreA: 9, scoreB: 11 })
    expect(saved.status()).toBe(200)
    // The final still waits for the other semi-final, so this court has nothing to play yet.
    expect((await saved.json()).captain.court.blocked).toBe('Waiting for a result that decides the next game.')
    expect((await asCaptain({ type: 'START_TOURNAMENT' })).status()).toBe(403)
    const board = await (await request.get(`/api/pickleball/open/s/${code}/state`)).json()
    expect(board.tournament.fixtures.find((f) => f.label === 'Final').nameA).not.toBeNull()
  })

  test('a retried Generate (same idempotency key) never draws again', async ({ request }) => {
    const { code, hostKey } = await createTournament(request, { players: 8 })
    const send = () => request.post(`/api/pickleball/open/s/${code}/commands`, {
      headers: { 'X-Host-Key': hostKey, 'cf-connecting-ip': ipFor(code) },
      data: { idempotencyKey: 'generate-once-1234', command: { type: 'GENERATE_DRAW', format: 'ROUND_ROBIN', pairing: 'RANDOM', seeding: 'RANDOM' } },
    })
    const first = await (await send()).json()
    const again = await (await send()).json()
    expect(again.version).toBe(first.version)
    expect(again.host.viewer.tournament.pairs).toEqual(first.host.viewer.tournament.pairs)
  })
})

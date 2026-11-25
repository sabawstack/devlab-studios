import { describe, expect, it } from 'vitest'
import { toHostSnapshot, toViewerSnapshot } from './snapshot'
import { DEFAULT_SETTINGS } from './types'
import { fillProposals } from './propose'
import { at, court, finished, player, sessionState } from './testing/fixtures'
import { createDriver } from './testing/reducerSim'

function state() {
  const base = sessionState({
    courts: [court('c1', 1), court('c2', 2), court('c3', 3, false)],
    players: ['a', 'b', 'c', 'd', 'e'].map((id, i) => player(id, { position: i, skill: 4, duprId: 'AB12C3' })),
    matches: [finished('m0', ['a', 'b'], ['c', 'd'], 'A', 11, 4, 1)],
  })
  return fillProposals(base, { now: at(20), newId: () => 'p1' })
}

describe('toViewerSnapshot', () => {
  it('never exposes skill, DUPR IDs, the session id or the host key hash', () => {
    const json = JSON.stringify(toViewerSnapshot(state()))
    expect(json).not.toContain('AB12C3')
    expect(json).not.toContain('skill')
    expect(json).not.toContain('"s1"')
    expect(json).not.toMatch(/hash|hostKey/i)
  })

  it('carries exactly the allowlisted top-level and settings keys, nothing else', () => {
    const viewer = toViewerSnapshot(state())
    expect(Object.keys(viewer).sort()).toEqual([
      'announcement', 'code', 'courts', 'endedAt', 'expiresAt', 'fairness', 'games', 'hostDisplayName', 'kind', 'name', 'nextUp', 'onBreak',
      'recentResults', 'roster', 'settings', 'standings', 'status', 'tournament', 'version', 'waiting',
    ])
    // SEC-01: every court carries exactly these keys (idle is a coarse reason, never the host's text).
    for (const c of viewer.courts) {
      expect(Object.keys(c).sort()).toEqual(['fixtureLabel', 'id', 'idle', 'label', 'startedAt', 'state', 'teamA', 'teamB'])
    }
    expect(Object.keys(viewer.settings).sort()).toEqual(['mode', 'selfCheckIn', 'target'])
    expect(Object.keys(viewer.fairness).sort()).toEqual(['longestWait', 'repeatedPartners', 'sitOutSpread'])
  })

  it('shows names on up-next courts, waiting-for-players and off courts', () => {
    const viewer = toViewerSnapshot(state())
    expect(viewer.courts.map((c) => c.state)).toEqual(['UP_NEXT', 'WAITING_FOR_PLAYERS', 'OFF'])
    expect(viewer.courts[0].teamA).toHaveLength(2)
    expect(viewer.waiting.map((w) => w.name)).toHaveLength(1)
    expect(viewer.recentResults[0]).toMatchObject({ scoreA: 11, scoreB: 4, winner: 'A' })
  })
})

describe('toHostSnapshot', () => {
  it('includes match ids per court and per-player games', () => {
    const host = toHostSnapshot(state())
    expect(host.courts[0].match?.status).toBe('PROPOSED')
    expect(host.players.find((p) => p.id === 'a')).toMatchObject({ games: 1, busy: expect.any(Boolean) })
  })
})

// SEC-01 for the queue fields (PB-QUEUE-06).
describe('nextUp and idle in the viewer snapshot', () => {
  function allPlaying(players = 14, courts = 2) {
    const driver = createDriver({ players, courts, mode: 'PADDLE_STACK', seed: 3 })
    for (const m of driver.state.matches.filter((x) => x.status === 'PROPOSED')) driver.run({ type: 'START_MATCH', matchId: m.id })
    return driver
  }

  it('names the four on deck with their court and teams, and only ids and names', () => {
    const viewer = toViewerSnapshot(allPlaying().state)
    expect(viewer.nextUp).not.toBeNull()
    expect(Object.keys(viewer.nextUp!).sort()).toEqual(['court', 'courtId', 'players', 'teamA', 'teamB'])
    expect(viewer.nextUp!.court).toMatch(/^Court \d+$/)
    expect(viewer.courts.find((c) => c.id === viewer.nextUp!.courtId)?.state).toBe('PLAYING')
    expect(viewer.nextUp!.players).toHaveLength(4)
    expect(viewer.nextUp!.players.map((p) => p.name)).toEqual([...viewer.nextUp!.teamA, ...viewer.nextUp!.teamB])
    for (const p of viewer.nextUp!.players) expect(Object.keys(p).sort()).toEqual(['id', 'name'])
    const onCourt = new Set(viewer.courts.flatMap((c) => [...c.teamA, ...c.teamB]))
    for (const p of viewer.nextUp!.players) expect(onCourt.has(p.name)).toBe(false)
    // On deck is not waiting: nobody is listed twice.
    const waiting = new Set(viewer.waiting.map((w) => w.id))
    for (const p of viewer.nextUp!.players) expect(waiting.has(p.id)).toBe(false)
  })

  it('no player is both on an up-next court and in nextUp', () => {
    const driver = allPlaying()
    const live = driver.state.matches.find((m) => m.status === 'IN_PROGRESS')!
    driver.run({ type: 'RECORD_RESULT', matchId: live.id, winner: 'A', scoreA: 11, scoreB: 3 })
    const viewer = toViewerSnapshot(driver.state)
    const upNext = viewer.courts.filter((c) => c.state === 'UP_NEXT').flatMap((c) => [...c.teamA, ...c.teamB])
    expect(upNext).toHaveLength(4)
    const named = new Set((viewer.nextUp?.players ?? []).map((p) => p.name))
    for (const name of upNext) expect(named.has(name)).toBe(false)
  })

  it('is null with a proposed game, a free court, fewer than four waiting, and an ended session', () => {
    expect(toViewerSnapshot(state()).nextUp).toBeNull() // a proposed game and a free court
    const few = allPlaying(11, 2)
    expect(toViewerSnapshot(few.state).waiting).toHaveLength(3)
    expect(toViewerSnapshot(few.state).nextUp).toBeNull()
    const ended = allPlaying()
    expect(toViewerSnapshot(ended.state).nextUp).not.toBeNull()
    ended.run({ type: 'END_SESSION' })
    expect(toViewerSnapshot(ended.state).nextUp).toBeNull()
  })

  it('idle is a coarse reason on free enabled courts only, and the host text never leaks', () => {
    const viewer = toViewerSnapshot(state())
    expect(viewer.courts.map((c) => c.idle)).toEqual([null, 'TOO_FEW_PLAYERS', null])
    const ruled = sessionState({
      courts: [court('c1', 1)],
      players: ['a', 'b', 'c', 'd'].map((id, i) => player(id, { position: i })),
      settings: { ...DEFAULT_SETTINGS, rules: [{ kind: 'APART', playerIds: ['a', 'b'] }] },
    })
    const blocked = toViewerSnapshot(ruled)
    expect(blocked.courts[0].idle).toBe('WAITING_FOR_HOST')
    const json = JSON.stringify(blocked)
    expect(json).not.toContain('rules')
    expect(json).not.toContain('keep-')
    // The host still gets its own explanation.
    expect(toHostSnapshot(ruled).courts[0].blocked).toMatch(/keep-together and keep-apart rules/)
  })
})


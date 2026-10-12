import { describe, expect, it } from 'vitest'
import { toHostSnapshot, toViewerSnapshot } from './snapshot'
import { fillProposals } from './propose'
import { at, court, finished, player, sessionState } from './testing/fixtures'

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
      'announcement', 'code', 'courts', 'expiresAt', 'fairness', 'hostDisplayName', 'kind', 'name', 'onBreak',
      'recentResults', 'roster', 'settings', 'standings', 'status', 'tournament', 'version', 'waiting',
    ])
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

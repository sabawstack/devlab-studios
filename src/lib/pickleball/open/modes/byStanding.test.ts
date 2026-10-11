// src/lib/pickleball/open/modes/byStanding.test.ts
import { describe, expect, it } from 'vitest'
import { proposeForCourt } from '../propose'
import { computeStandings } from '../standings'
import { at, court, finished, player, sessionState } from '../testing/fixtures'
import { DEFAULT_SETTINGS, type OpenMatch, type PairRule } from '../types'

/**
 * Two rounds on two courts. Standings afterwards:
 *   P1 2–0 (88%), P3 2–0 (75%), P2 2–0 (73%), P4 1–1, P5 1–1, P7 0–2, P6 0–2, P8 0–2.
 * Everyone came off court at minute 30 except P5, waiting since minute 25.
 */
function ranked(rules: PairRule[] = []) {
  const matches: OpenMatch[] = [
    finished('r1a', ['P1', 'P2'], ['P7', 'P8'], 'A', 11, 1, 1, 'c1'),
    finished('r1b', ['P3', 'P4'], ['P5', 'P6'], 'A', 11, 6, 2, 'c2'),
    finished('r2a', ['P1', 'P3'], ['P6', 'P8'], 'A', 11, 2, 15, 'c1'),
    finished('r2b', ['P2', 'P5'], ['P4', 'P7'], 'A', 11, 9, 16, 'c2'),
  ]
  return sessionState({
    settings: { ...DEFAULT_SETTINGS, mode: 'BY_STANDING', rules },
    courts: [court('c1', 1), court('c2', 2)],
    players: ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8'].map((id, i) => player(id, { position: i, waitingSince: id === 'P5' ? at(25) : at(30) })),
    matches,
  })
}

describe('by standing', () => {
  it('ranks by win rate, then points won', () => {
    const state = ranked()
    expect(computeStandings(state.players, state.matches).map((r) => r.playerId)).toEqual(['P1', 'P3', 'P2', 'P4', 'P5', 'P7', 'P6', 'P8'])
  })

  it('plays a window of 4 adjacent ranks holding the longest-waiting player, 1st + 4th vs 2nd + 3rd', () => {
    expect(proposeForCourt(ranked())).toEqual({ teamA: ['P5', 'P8'], teamB: ['P7', 'P6'] })
  })

  it('Skip moves to another window that still holds the longest-waiting player', () => {
    const p = proposeForCourt(ranked(), ['P5', 'P7', 'P6', 'P8'])!
    expect([...p.teamA, ...p.teamB]).toContain('P5')
    expect([...p.teamA, ...p.teamB].sort()).not.toEqual(['P5', 'P6', 'P7', 'P8'])
  })

  it('a keep-together pair is never split by the 1st + 4th rule', () => {
    const p = proposeForCourt(ranked([{ kind: 'TOGETHER', playerIds: ['P5', 'P7'] }]))!
    const team = p.teamA.includes('P5') ? p.teamA : p.teamB
    expect([...team].sort()).toEqual(['P5', 'P7'])
  })

  it('the sit-out guard outranks the standings', () => {
    const state = ranked()
    const withBench = { ...state, courts: [court('c1', 1)], players: [...state.players, player('Bench', { position: 20, waitingSince: at(0) })] }
    const p = proposeForCourt(withBench)!
    expect([...p.teamA, ...p.teamB]).toContain('Bench')
  })
})

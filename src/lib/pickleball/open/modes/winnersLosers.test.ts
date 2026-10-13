// src/lib/pickleball/open/modes/winnersLosers.test.ts
import { describe, expect, it } from 'vitest'
import { pairKey } from '../fairness'
import { proposeForCourt } from '../propose'
import { at, court, finished, player, sessionState } from '../testing/fixtures'
import { DEFAULT_SETTINGS, type OpenMatch } from '../types'
import { lastGames } from './shared'
import { shuffledSplits } from './winnersLosers'

const settings = { ...DEFAULT_SETTINGS, mode: 'WINNERS_LOSERS' as const }

/** Two finished courts: (A1,A2) beat (C1,C2) on c1; (B1,B2) beat (D1,D2) on c2. Everyone back at minute 20. */
function afterTwoCourts(extra: string[] = []) {
  const matches: OpenMatch[] = [
    { ...finished('m1', ['A1', 'A2'], ['C1', 'C2'], 'A', 11, 5, 5, 'c1'), finishedAt: at(20) },
    { ...finished('m2', ['B1', 'B2'], ['D1', 'D2'], 'A', 11, 7, 6, 'c2'), finishedAt: at(20) },
  ]
  const ids = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'D1', 'D2']
  return sessionState({
    settings,
    courts: [court('c1', 1), court('c2', 2)],
    players: [
      ...ids.map((id, i) => player(id, { position: i, waitingSince: at(20) })),
      ...extra.map((id, i) => player(id, { position: 10 + i, waitingSince: at(0) })),
    ],
    matches,
  })
}

describe('winners play winners', () => {
  it('tags each player W, L or N from their last game', () => {
    const tags = lastGames(afterTwoCourts(['New']))
    expect(tags.get('A1')).toEqual({ tag: 'W', teammate: 'A2' })
    expect(tags.get('D2')).toEqual({ tag: 'L', teammate: 'D1' })
    expect(tags.get('New')).toEqual({ tag: 'N', teammate: null })
  })

  it('a player back from a break is untagged', () => {
    const state = afterTwoCourts()
    const rested = { ...state, players: state.players.map((p) => (p.id === 'A1' ? { ...p, waitingSince: at(40) } : p)) }
    expect(lastGames(rested).get('A1')?.tag).toBe('N')
  })

  it('puts the four winners together and shuffles them: earlier partners become opponents', () => {
    const p = proposeForCourt(afterTwoCourts())!
    expect([...p.teamA, ...p.teamB].sort()).toEqual(['A1', 'A2', 'B1', 'B2'])
    const teams = [pairKey(...p.teamA), pairKey(...p.teamB)]
    expect(teams).not.toContain(pairKey('A1', 'A2'))
    expect(teams).not.toContain(pairKey('B1', 'B2'))
  })

  it('then the four losers, shuffled the same way', () => {
    const state = afterTwoCourts()
    const winnersOn: OpenMatch = { ...finished('w', ['A1', 'B1'], ['A2', 'B2'], 'A', null, null, 21, 'c1'), status: 'PROPOSED', winner: null, finishedAt: null, recordedBy: null }
    const p = proposeForCourt({ ...state, matches: [...state.matches, winnersOn] })!
    expect([...p.teamA, ...p.teamB].sort()).toEqual(['C1', 'C2', 'D1', 'D2'])
    expect([pairKey(...p.teamA), pairKey(...p.teamB)]).not.toContain(pairKey('C1', 'C2'))
  })

  it('a player forced in by the sit-out guard plays even if untagged', () => {
    // On one court, the two games since minute 0 are two rounds sat out: Waited is forced.
    const state = { ...afterTwoCourts(['Waited']), courts: [court('c1', 1)] }
    const p = proposeForCourt(state)!
    expect([...p.teamA, ...p.teamB]).toContain('Waited')
  })

  it('shuffles only two intact earlier teams', () => {
    const tags = lastGames(afterTwoCourts())
    expect(shuffledSplits(['A1', 'A2', 'B1', 'B2'], tags)).toHaveLength(2)
    expect(shuffledSplits(['A1', 'A2', 'B1', 'C1'], tags)).toEqual([])
  })

  it('fair first: winners who have played more wait while losers who have played less go on', () => {
    // One court. A and B won both their games (2 played); C, D, E and F lost their only game.
    const matches: OpenMatch[] = [
      finished('m1', ['A1', 'A2'], ['C1', 'C2'], 'A', 11, 3, 0),
      finished('m2', ['B1', 'B2'], ['D1', 'D2'], 'A', 11, 4, 20),
      finished('m3', ['A1', 'A2'], ['E1', 'E2'], 'A', 11, 5, 40),
      finished('m4', ['B1', 'B2'], ['F1', 'F2'], 'A', 11, 6, 60),
    ]
    const waited: Record<string, number> = { C: 10, D: 30, E: 50, F: 70, A: 50, B: 70 }
    const ids = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'D1', 'D2', 'E1', 'E2', 'F1', 'F2']
    const state = sessionState({
      settings,
      players: ids.map((id, i) => player(id, { position: i, waitingSince: at(waited[id[0]]) })),
      matches,
    })
    const p = proposeForCourt(state)!
    expect([...p.teamA, ...p.teamB].sort()).toEqual(['C1', 'C2', 'D1', 'D2'])
  })
})

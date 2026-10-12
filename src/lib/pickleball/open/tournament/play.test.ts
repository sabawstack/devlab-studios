import { describe, expect, it } from 'vitest'
import { makeCtx, playOut, refusal, run, tournamentSession } from '../testing/tournament'
import { champion } from './progress'
import type { TournamentFormat } from './types'

const CASES: Array<[TournamentFormat, number, number]> = [
  // format, players, games in the draw
  ['ROUND_ROBIN', 8, 6],
  ['POOL_TO_BRACKET', 16, 15],
  ['SINGLE_ELIMINATION', 10, 4],
  ['DOUBLE_ELIMINATION', 8, 6],
  // Byes and uneven groups: losers-bracket holes collapse, pools of 3 and 4 (or 2 and 3) still feed one bracket.
  ['SINGLE_ELIMINATION', 6, 2],
  ['DOUBLE_ELIMINATION', 10, 8],
  ['DOUBLE_ELIMINATION', 12, 10],
  ['POOL_TO_BRACKET', 10, 7],
  ['POOL_TO_BRACKET', 14, 12],
]

describe('a tournament plays from the draw to a champion', () => {
  for (const [format, players, games] of CASES) {
    it(`${format} with ${players} players: every game proposed to a free court, one champion`, () => {
      const ctx = makeCtx()
      let state = tournamentSession(players, 2, format)
      state = run(state, { type: 'GENERATE_DRAW', format, pairing: 'BALANCED', seeding: 'BY_SKILL' }, ctx(1))
      expect(state.tournament?.phase).toBe('DRAFT')
      expect(state.tournament?.fixtures).toHaveLength(games)
      expect(state.matches).toHaveLength(0) // nothing is proposed from a draft
      const ready = state.tournament!.fixtures.filter((f) => f.status === 'READY').length
      state = run(state, { type: 'START_TOURNAMENT' }, ctx(2))
      // Both courts get a game, unless byes leave only one game playable at the start.
      expect(state.matches.filter((m) => m.status === 'PROPOSED')).toHaveLength(Math.min(2, ready))
      state = playOut(state, ctx)
      const t = state.tournament!
      expect(t.phase).toBe('FINISHED')
      expect(t.fixtures.every((f) => f.status === 'FINISHED')).toBe(true)
      expect(state.matches.filter((m) => m.status === 'FINISHED')).toHaveLength(games)
      expect(champion(t, state.matches, state.players)).not.toBeNull()
    })
  }

  it('refuses to start with a player left over', () => {
    const ctx = makeCtx()
    let state = tournamentSession(9)
    state = run(state, { type: 'GENERATE_DRAW', format: 'ROUND_ROBIN', pairing: 'MANUAL', seeding: 'MANUAL' }, ctx(1))
    expect(refusal(state, { type: 'START_TOURNAMENT' }, ctx(2))).toBe('Ivy has no partner. Swap them into a pair, or put them on a break to keep them as a substitute.')
  })
})

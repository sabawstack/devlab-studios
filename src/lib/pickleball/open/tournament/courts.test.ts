import { describe, expect, it } from 'vitest'
import { makeCtx, run, tournamentSession } from '../testing/tournament'
import { proposeFixture, tournamentCourtNote, withoutStaleProposals } from './courts'

function started(players = 8, courts = 1) {
  const ctx = makeCtx()
  let state = run(tournamentSession(players, courts, 'SINGLE_ELIMINATION'), { type: 'GENERATE_DRAW', format: 'SINGLE_ELIMINATION', pairing: 'MANUAL', seeding: 'MANUAL' }, ctx(1))
  state = run(state, { type: 'START_TOURNAMENT' }, ctx(2))
  return { state, ctx }
}

describe('the tournament court loop', () => {
  it('proposes the earliest ready game whose pairs are free, with the fixture it plays', () => {
    const { state } = started(8, 1)
    const game = state.matches[0]
    const fixture = state.tournament!.fixtures.find((f) => f.id === game.fixtureId)!
    expect(fixture).toMatchObject({ roundNumber: 1, position: 0 })
    // With that game on court, the other semi-final is next.
    expect(proposeFixture(state)?.fixtureId).toBe(state.tournament!.fixtures.find((f) => f.roundNumber === 1 && f.position === 1)!.id)
  })

  it('withdraws a proposal the draw no longer backs', () => {
    const { state } = started(8, 1)
    const game = state.matches[0]
    const swapped = { ...state, tournament: { ...state.tournament!, fixtures: state.tournament!.fixtures.map((f) => (f.id === game.fixtureId ? { ...f, status: 'PENDING' as const } : f)) } }
    expect(withoutStaleProposals(swapped).matches).toHaveLength(0)
    expect(withoutStaleProposals(state)).toBe(state)
  })

  it('a free court says which game waits for a player on a break, and otherwise that it waits for a result', () => {
    const { ctx, state: first } = started(8, 2)
    let state = first
    expect(tournamentCourtNote(state)).toBe('Waiting for a result that decides the next game.')
    // Cy plays in semi-final 2 on court 2. A break withdraws that game, and the free court says why it waits.
    const second = state.matches.find((m) => m.courtId === 'c2')!
    state = run(state, { type: 'SET_PLAYER_STATUS', playerId: second.teamA[0], status: 'BREAK' }, ctx(3))
    expect(state.matches.some((m) => m.courtId === 'c2')).toBe(false)
    expect(tournamentCourtNote(state)).toBe('Semi-final 2 waits for Cy, who is on a break.')
  })
})

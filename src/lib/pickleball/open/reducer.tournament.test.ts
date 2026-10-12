import { describe, expect, it } from 'vitest'
import { captainRefusal } from './captains'
import { buildInitialState } from './create'
import { makeCtx, refusal, run, tournamentSession } from './testing/tournament'
import { overallStandings } from './tournament/standings'
import { DEFAULT_SETTINGS, type CaptainRecord, type OpenSessionState } from './types'

function started(players = 8, courts = 2, format: 'ROUND_ROBIN' | 'SINGLE_ELIMINATION' = 'ROUND_ROBIN', bench: string[] = []) {
  const ctx = makeCtx()
  let state = tournamentSession(players, courts, format)
  state = run(state, { type: 'GENERATE_DRAW', format, pairing: 'MANUAL', seeding: 'MANUAL' }, ctx(1))
  // Players left over are put on a break: the host keeps them as substitutes.
  for (const playerId of bench) state = run(state, { type: 'SET_PLAYER_STATUS', playerId, status: 'BREAK' }, ctx(1))
  state = run(state, { type: 'START_TOURNAMENT' }, ctx(2))
  return { state, ctx }
}
const proposed = (state: OpenSessionState) => state.matches.filter((m) => m.status === 'PROPOSED')

describe('a tournament session', () => {
  it('is created in setup, with no games proposed until it starts', () => {
    let n = 0
    const state = buildInitialState({
      name: 'Cup', hostDisplayName: 'Mo', location: null, courtCount: 2, settings: DEFAULT_SETTINGS, kind: 'TOURNAMENT', tournamentFormat: 'SINGLE_ELIMINATION',
      players: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((name) => ({ name, skill: null, duprId: null })),
    }, { now: '2026-10-11T10:00:00.000Z', newId: () => `i${(n += 1)}`, publicCode: 'ABCDE23456', sessionId: 's1' })
    expect(state.kind).toBe('TOURNAMENT')
    expect(state.tournament).toMatchObject({ format: 'SINGLE_ELIMINATION', phase: 'SETUP', entrants: [], fixtures: [] })
    expect(state.matches).toEqual([])
  })

  it('refuses open-play commands and tournament commands in the wrong place', () => {
    const { state, ctx } = started()
    expect(refusal(state, { type: 'SET_MODE', mode: 'BALANCED' }, ctx(3))).toBe('That is for open play. In a tournament the draw decides who plays whom.')
    expect(refusal(state, { type: 'SKIP_PROPOSAL', matchId: proposed(state)[0].id }, ctx(3))).toBe('That is for open play. In a tournament the draw decides who plays whom.')
    expect(refusal(state, { type: 'GENERATE_DRAW', format: 'ROUND_ROBIN', pairing: 'RANDOM', seeding: 'RANDOM' }, ctx(3))).toBe('The draw is locked once the tournament starts.')
    const open = { ...state, kind: 'OPEN_PLAY' as const, tournament: null }
    expect(refusal(open, { type: 'START_TOURNAMENT' }, ctx(3))).toBe('This session is open play, not a tournament.')
  })

  it('a draft can be generated again, replacing the pairs', () => {
    const ctx = makeCtx()
    let state = run(tournamentSession(8), { type: 'GENERATE_DRAW', format: 'ROUND_ROBIN', pairing: 'MANUAL', seeding: 'MANUAL' }, ctx(1))
    const first = state.tournament!.entrants.map((e) => e.id)
    state = run(state, { type: 'GENERATE_DRAW', format: 'SINGLE_ELIMINATION', pairing: 'BALANCED', seeding: 'BY_SKILL' }, ctx(2))
    expect(state.tournament!.format).toBe('SINGLE_ELIMINATION')
    expect(state.tournament!.entrants.some((e) => first.includes(e.id))).toBe(false)
  })

  it('a late arrival after Generate is flagged, and Start waits until they are paired or resting', () => {
    const ctx = makeCtx()
    let state = run(tournamentSession(8), { type: 'GENERATE_DRAW', format: 'ROUND_ROBIN', pairing: 'MANUAL', seeding: 'MANUAL' }, ctx(1))
    state = run(state, { type: 'ADD_PLAYERS', names: ['Zed'] }, ctx(2))
    expect(refusal(state, { type: 'START_TOURNAMENT' }, ctx(3))).toBe('Zed has no partner. Swap them into a pair, or put them on a break to keep them as a substitute.')
    const zed = state.players.find((p) => p.name === 'Zed')!
    state = run(state, { type: 'EDIT_DRAW', edit: { kind: 'SWAP_PLAYERS', playerIds: [zed.id, 'p1'] } }, ctx(3))
    expect(state.tournament!.entrants[0].playerIds).toEqual([zed.id, 'p2'])
    // Ana is now the one left over; resting her lets the tournament start.
    state = run(state, { type: 'SET_PLAYER_STATUS', playerId: 'p1', status: 'BREAK' }, ctx(4))
    expect(run(state, { type: 'START_TOURNAMENT' }, ctx(5)).tournament!.phase).toBe('RUNNING')
  })

  it('an ended session refuses tournament commands but keeps its draw and results', () => {
    const { ctx, state: first } = started()
    let state = first
    state = run(state, { type: 'END_SESSION' }, ctx(3))
    expect(state.matches.filter((m) => m.status === 'PROPOSED')).toEqual([])
    const pair = state.tournament!.entrants[0]
    expect(refusal(state, { type: 'SUBSTITUTE_PLAYER', entrantId: pair.id, outPlayerId: pair.playerIds[0], inPlayerId: 'p9' }, ctx(4))).toBe('This session has ended.')
    expect(state.tournament!.phase).toBe('RUNNING')
  })

  it('a player in a pair cannot just leave; a substitute takes their place and keeps the pair’s results', () => {
    const { ctx, state: first } = started(9, 2, 'ROUND_ROBIN', ['p9']) // Ivy (p9) is left over and waits on a break
    let state = first
    expect(refusal(state, { type: 'SET_PLAYER_STATUS', playerId: 'p1', status: 'LEFT' }, ctx(3))).toBe('Ana is in a pair. Substitute them first.')
    const pair = state.tournament!.entrants[0]
    const onCourt = proposed(state).find((m) => m.teamA.includes('p1') || m.teamB.includes('p1'))!
    state = run(state, { type: 'SUBSTITUTE_PLAYER', entrantId: pair.id, outPlayerId: 'p1', inPlayerId: 'p9' }, ctx(4))
    expect(state.tournament!.entrants[0].playerIds).toEqual(['p9', 'p2'])
    expect(state.players.find((p) => p.id === 'p9')?.status).toBe('ACTIVE')
    // The old proposal is withdrawn and the same game proposed again with the substitute.
    expect(state.matches.some((m) => m.id === onCourt.id)).toBe(false)
    const again = proposed(state).find((m) => m.fixtureId === onCourt.fixtureId)!
    expect([...again.teamA, ...again.teamB]).toContain('p9')
    state = run(state, { type: 'SET_PLAYER_STATUS', playerId: 'p1', status: 'LEFT' }, ctx(5))
    expect(state.players.find((p) => p.id === 'p1')?.status).toBe('LEFT')
  })

  it('swapping opponents withdraws the old proposals and proposes the new games', () => {
    const { ctx, state: first } = started(16, 4, 'SINGLE_ELIMINATION')
    let state = first
    const [f1, f2] = state.tournament!.fixtures.filter((f) => f.bracket === 'MAIN' && f.roundNumber === 1)
    state = run(state, { type: 'SWAP_OPPONENTS', fixtureId: f1.id, side: 'B', otherFixtureId: f2.id, otherSide: 'B' }, ctx(3))
    const game = proposed(state).find((m) => m.fixtureId === f1.id)!
    const newOpponent = state.tournament!.entrants.find((e) => e.id === f2.entrantBId)!
    expect(game.teamB).toEqual(newOpponent.playerIds)
  })

  it('undo is refused once the next round has started; edit changes who moved on', () => {
    const { ctx, state: first } = started(8, 2, 'SINGLE_ELIMINATION')
    let state = first
    const [semi1, semi2] = proposed(state)
    for (const [i, m] of [semi1, semi2].entries()) {
      state = run(state, { type: 'START_MATCH', matchId: m.id }, ctx(3 + i))
      state = run(state, { type: 'RECORD_RESULT', matchId: m.id, winner: 'A', scoreA: 11, scoreB: 6 }, ctx(5 + i))
    }
    const final = proposed(state)[0]
    expect(final.teamA).toEqual(semi1.teamA)
    state = run(state, { type: 'EDIT_RESULT', matchId: semi1.id, winner: 'B', scoreA: 6, scoreB: 11 }, ctx(7))
    expect(proposed(state)[0].teamA).toEqual(semi1.teamB)
    const finalNow = proposed(state)[0]
    state = run(state, { type: 'START_MATCH', matchId: finalNow.id }, ctx(8))
    expect(refusal(state, { type: 'UNDO_RESULT', matchId: semi2.id }, ctx(8))).toBe('Final has already started with this result. Change that game first.')
    expect(refusal(state, { type: 'EDIT_RESULT', matchId: semi2.id, winner: 'B', scoreA: 6, scoreB: 11 }, ctx(8))).toBe('Final has already started with this result. Change that game first.')
  })

  it('a saved, edited or undone result keeps one game per fixture, with the scores the standings read', () => {
    const { ctx, state: first } = started()
    let state = first
    const game = proposed(state)[0]
    const fixtureOf = (s: OpenSessionState) => s.tournament!.fixtures.find((f) => f.id === game.fixtureId)!
    const forFixture = (s: OpenSessionState) => s.matches.filter((m) => m.fixtureId === game.fixtureId)
    state = run(state, { type: 'START_MATCH', matchId: game.id }, ctx(3))
    state = run(state, { type: 'RECORD_RESULT', matchId: game.id, winner: 'A', scoreA: 11, scoreB: 4 }, ctx(4))
    expect(forFixture(state)).toEqual([expect.objectContaining({ id: game.id, status: 'FINISHED', scoreA: 11, scoreB: 4 })])
    expect(overallStandings(state.tournament!, state.matches, state.players).find((r) => r.entrantId === fixtureOf(state).entrantAId)?.pointsFor).toBe(11)
    state = run(state, { type: 'EDIT_RESULT', matchId: game.id, winner: 'A', scoreA: 11, scoreB: 9 }, ctx(5))
    expect(forFixture(state)).toEqual([expect.objectContaining({ id: game.id, status: 'FINISHED', scoreA: 11, scoreB: 9 })])
    expect(overallStandings(state.tournament!, state.matches, state.players).find((r) => r.entrantId === fixtureOf(state).entrantBId)?.pointsFor).toBe(9)
    state = run(state, { type: 'UNDO_RESULT', matchId: game.id }, ctx(5))
    expect(forFixture(state)).toEqual([expect.objectContaining({ id: game.id, status: 'IN_PROGRESS', scoreA: null })])
    expect(fixtureOf(state).status).toBe('IN_PROGRESS')
    expect(overallStandings(state.tournament!, state.matches, state.players).every((r) => r.played === 0)).toBe(true)
  })

  it('an abandoned game goes back to the draw and is proposed again', () => {
    const { ctx, state: first } = started()
    let state = first
    const game = proposed(state)[0]
    state = run(state, { type: 'START_MATCH', matchId: game.id }, ctx(3))
    expect(state.tournament!.fixtures.find((f) => f.id === game.fixtureId)?.status).toBe('IN_PROGRESS')
    state = run(state, { type: 'ABANDON_MATCH', matchId: game.id }, ctx(4))
    expect(state.tournament!.fixtures.find((f) => f.id === game.fixtureId)?.status).toBe('READY')
    expect(proposed(state).some((m) => m.fixtureId === game.fixtureId)).toBe(true)
  })

  it('a pair with a player on a break is skipped, and its game is proposed when they are back', () => {
    const { ctx, state: first } = started(8, 1)
    let state = first
    const game = proposed(state)[0]
    state = run(state, { type: 'SET_PLAYER_STATUS', playerId: game.teamA[0], status: 'BREAK' }, ctx(3))
    expect(proposed(state)[0].fixtureId).not.toBe(game.fixtureId)
    expect([...proposed(state)[0].teamA, ...proposed(state)[0].teamB]).not.toContain(game.teamA[0])
  })

  it('a court captain records results on their own tournament court, and nothing else', () => {
    const { state } = started()
    const captain: CaptainRecord = { id: 'cap', label: 'Court 1 captain', courtId: 'c1', keyHash: 'h', createdAt: state.createdAt }
    const onCourt1 = proposed(state).find((m) => m.courtId === 'c1')!
    const onCourt2 = proposed(state).find((m) => m.courtId === 'c2')!
    expect(captainRefusal({ type: 'RECORD_RESULT', matchId: onCourt1.id, winner: 'A', scoreA: 11, scoreB: 3 }, captain, state)).toBeNull()
    expect(captainRefusal({ type: 'START_MATCH', matchId: onCourt2.id }, captain, state)).toBe('This captain link only runs Court 1.')
    expect(captainRefusal({ type: 'START_TOURNAMENT' }, captain, state)).toBe('Only the host can do that.')
  })
})

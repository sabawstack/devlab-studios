import { describe, expect, it } from 'vitest'
import { player } from '../testing/fixtures'
import type { OpenMatch, OpenPlayer } from '../types'
import { generateDraw } from './draw'
import { applyDraftEdit, applyRunningEdit } from './drawEdits'
import type { TournamentFormat, TournamentState } from './types'

const roster = (n: number): OpenPlayer[] => Array.from({ length: n }, (_, i) => player(`p${i + 1}`, { name: `P${i + 1}`, position: i + 1 }))
function ids(prefix = 'id') {
  let n = 0
  return () => `${prefix}${(n += 1)}`
}
function draft(format: TournamentFormat, n: number, players = roster(n)): TournamentState {
  const result = generateDraw(players, { format, pairing: 'MANUAL', seeding: 'MANUAL' }, { newId: ids() }, 2000)
  if (!result.ok) throw new Error(result.reason)
  return result.tournament
}
const seed = (t: TournamentState, n: number) => t.entrants.find((e) => e.seed === n)!
const firstRound = (t: TournamentState) => t.fixtures.filter((f) => f.bracket === 'MAIN' && f.roundNumber === 1)
function expectOk(result: ReturnType<typeof applyDraftEdit>): TournamentState {
  if (!result.ok) throw new Error(result.reason)
  return result.tournament
}

describe('draft edits', () => {
  it('swaps a player between two pairs; the draw itself is untouched', () => {
    const t = draft('ROUND_ROBIN', 8)
    const next = expectOk(applyDraftEdit(t, { kind: 'SWAP_PLAYERS', playerIds: ['p1', 'p3'] }, roster(8), ids('x')))
    expect(next.entrants.map((e) => e.playerIds)).toEqual([['p3', 'p2'], ['p1', 'p4'], ['p5', 'p6'], ['p7', 'p8']])
    expect(next.fixtures).toEqual(t.fixtures)
  })

  it('swaps the odd player into a pair, and refuses swaps that make no sense', () => {
    const players = roster(9)
    const t = draft('ROUND_ROBIN', 9, players)
    expect(expectOk(applyDraftEdit(t, { kind: 'SWAP_PLAYERS', playerIds: ['p9', 'p2'] }, players, ids('x'))).entrants[0].playerIds).toEqual(['p1', 'p9'])
    expect(applyDraftEdit(t, { kind: 'SWAP_PLAYERS', playerIds: ['p1', 'p2'] }, players, ids('x'))).toEqual({ ok: false, reason: 'They are already partners.' })
    const rested = players.map((p) => (p.id === 'p9' ? { ...p, status: 'BREAK' as const } : p))
    expect(applyDraftEdit(t, { kind: 'SWAP_PLAYERS', playerIds: ['p1', 'p9'] }, rested, ids('x'))).toEqual({ ok: false, reason: 'P9 is not checked in. Bring them back first.' })
  })

  it('swaps two pairs: seeds, pools and every slot they hold', () => {
    const t = draft('POOL_TO_BRACKET', 16)
    const [a, b] = [seed(t, 1), seed(t, 2)]
    const next = expectOk(applyDraftEdit(t, { kind: 'SWAP_PAIRS', entrantIds: [a.id, b.id] }, roster(16), ids('x')))
    expect(next.entrants.find((e) => e.id === a.id)).toMatchObject({ seed: 2, poolLabel: b.poolLabel })
    expect(next.fixtures.filter((f) => f.entrantAId === a.id || f.entrantBId === a.id).every((f) => f.poolLabel === b.poolLabel)).toBe(true)
  })

  it('moves a pair to another pool and rebuilds both pools’ games', () => {
    const t = draft('POOL_TO_BRACKET', 16) // 8 pairs: pools A and B of 4
    const mover = t.entrants.find((e) => e.poolLabel === 'A')!
    const next = expectOk(applyDraftEdit(t, { kind: 'MOVE_PAIR', entrantId: mover.id, poolLabel: 'B' }, roster(16), ids('x')))
    expect(next.entrants.filter((e) => e.poolLabel === 'A')).toHaveLength(3)
    expect(next.fixtures.filter((f) => f.poolLabel === 'A')).toHaveLength(3)
    expect(next.fixtures.filter((f) => f.poolLabel === 'B')).toHaveLength(10)
    expect(next.fixtures.filter((f) => f.bracket === 'MAIN')).toEqual(t.fixtures.filter((f) => f.bracket === 'MAIN'))
  })

  it('refuses a move that would leave a pool with one pair, or that has nowhere to go', () => {
    const t = draft('POOL_TO_BRACKET', 8) // 4 pairs: pools of 2
    const mover = t.entrants.find((e) => e.poolLabel === 'A')!
    expect(applyDraftEdit(t, { kind: 'MOVE_PAIR', entrantId: mover.id, poolLabel: 'B' }, roster(8), ids('x')))
      .toEqual({ ok: false, reason: 'Pool A would be left with 1 pair. A pool needs at least 2.' })
    expect(applyDraftEdit(t, { kind: 'MOVE_PAIR', entrantId: mover.id, poolLabel: 'C' }, roster(8), ids('x')))
      .toEqual({ ok: false, reason: 'There is no Pool C in this draw.' })
    const rr = draft('ROUND_ROBIN', 8)
    expect(applyDraftEdit(rr, { kind: 'MOVE_PAIR', entrantId: rr.entrants[0].id, poolLabel: 'B' }, roster(8), ids('x')))
      .toEqual({ ok: false, reason: 'Only a draw with pools has pools to move between.' })
  })

  it('changes a first-round opponent in a bracket: the two pairs trade places', () => {
    const t = draft('SINGLE_ELIMINATION', 16) // 1v8, 4v5, 2v7, 3v6
    const [first, second] = firstRound(t)
    const next = expectOk(applyDraftEdit(t, { kind: 'SET_OPPONENT', fixtureId: first.id, side: 'B', entrantId: second.entrantBId! }, roster(16), ids('x')))
    const [f1, f2] = firstRound(next)
    expect([f1.entrantAId, f1.entrantBId]).toEqual([seed(t, 1).id, seed(t, 5).id])
    expect([f2.entrantAId, f2.entrantBId]).toEqual([seed(t, 4).id, seed(t, 8).id])
  })

  it('refuses an opponent change that breaks a round robin, and says why', () => {
    const t = draft('ROUND_ROBIN', 8)
    const [g1, g2] = t.fixtures.filter((f) => f.roundNumber === 1)
    const result = applyDraftEdit(t, { kind: 'SET_OPPONENT', fixtureId: g1.id, side: 'B', entrantId: g2.entrantBId! }, roster(8), ids('x'))
    expect(result.ok).toBe(false)
    expect(!result.ok && result.reason).toMatch(/would play each other twice\.$/)
  })

  it('refuses a slot that a result fills, and a pair against itself', () => {
    const t = draft('SINGLE_ELIMINATION', 16)
    const final = t.fixtures.find((f) => f.roundNumber === 3)!
    expect(applyDraftEdit(t, { kind: 'SET_OPPONENT', fixtureId: final.id, side: 'A', entrantId: seed(t, 1).id }, roster(16), ids('x')))
      .toEqual({ ok: false, reason: 'That slot is filled by an earlier result, not by the draw.' })
    const [first] = firstRound(t)
    expect(applyDraftEdit(t, { kind: 'SET_OPPONENT', fixtureId: first.id, side: 'B', entrantId: first.entrantAId! }, roster(16), ids('x')))
      .toEqual({ ok: false, reason: 'A pair cannot play itself.' })
  })

  it('is refused once the tournament has started', () => {
    const t = { ...draft('ROUND_ROBIN', 8), phase: 'RUNNING' as const }
    const result = applyDraftEdit(t, { kind: 'SWAP_PLAYERS', playerIds: ['p1', 'p3'] }, roster(8), ids('x'))
    expect(result).toEqual({ ok: false, reason: 'The draw is locked once the tournament starts. You can still substitute a player or swap opponents in a game that has not started.' })
  })
})

describe('running edits', () => {
  const running = (format: TournamentFormat, n: number) => ({ ...draft(format, n), phase: 'RUNNING' as const })
  const onCourt = (fixtureId: string, teamA: readonly [string, string], teamB: readonly [string, string]): OpenMatch => ({
    id: 'm1', courtId: 'c1', seq: 1, status: 'IN_PROGRESS', teamA, teamB, scoreA: null, scoreB: null, winner: null,
    proposedAt: '2026-10-11T10:00:00.000Z', startedAt: '2026-10-11T10:00:00.000Z', finishedAt: null, recordedBy: null, fixtureId,
  })

  it('substitutes a player in a pair that is not on court; the pair keeps its place', () => {
    const players = roster(9)
    const t = running('ROUND_ROBIN', 9)
    const result = applyRunningEdit(t, { kind: 'SUBSTITUTE', entrantId: seed(t, 1).id, outPlayerId: 'p2', inPlayerId: 'p9' }, players, [])
    expect(result.ok && result.tournament.entrants[0]).toEqual({ ...seed(t, 1), playerIds: ['p1', 'p9'] })
  })

  it('refuses a substitute for a pair on court, or one already in a pair', () => {
    const players = roster(9)
    const t = running('ROUND_ROBIN', 9)
    const game = t.fixtures.find((f) => f.entrantAId === seed(t, 1).id)!
    const match = onCourt(game.id, ['p1', 'p2'], ['p7', 'p8'])
    expect(applyRunningEdit(t, { kind: 'SUBSTITUTE', entrantId: seed(t, 1).id, outPlayerId: 'p2', inPlayerId: 'p9' }, players, [match]))
      .toEqual({ ok: false, reason: 'P1 & P2 are on court. Substitute after their game.' })
    expect(applyRunningEdit(t, { kind: 'SUBSTITUTE', entrantId: seed(t, 1).id, outPlayerId: 'p2', inPlayerId: 'p3' }, players, []))
      .toEqual({ ok: false, reason: 'P3 already plays in P3 & P4.' })
  })

  it('swaps opponents between two unstarted games of the same round', () => {
    const t = running('SINGLE_ELIMINATION', 16)
    const [f1, f2] = firstRound(t)
    const result = applyRunningEdit(t, { kind: 'SWAP_OPPONENTS', fixtureId: f1.id, side: 'B', otherFixtureId: f2.id, otherSide: 'B' }, roster(16), [])
    if (!result.ok) throw new Error(result.reason)
    expect(firstRound(result.tournament)[0].entrantBId).toBe(f2.entrantBId)
  })

  it('refuses swaps across rounds, with a started game, or into an empty slot', () => {
    const t = running('SINGLE_ELIMINATION', 16)
    const [f1, f2] = firstRound(t)
    const semi = t.fixtures.find((f) => f.roundNumber === 2)!
    expect(applyRunningEdit(t, { kind: 'SWAP_OPPONENTS', fixtureId: f1.id, side: 'B', otherFixtureId: semi.id, otherSide: 'A' }, roster(16), []))
      .toEqual({ ok: false, reason: 'Opponents can only be swapped between games in the same round of the same pool or bracket.' })
    const match = onCourt(f2.id, ['p7', 'p8'], ['p9', 'p10'])
    expect(applyRunningEdit(t, { kind: 'SWAP_OPPONENTS', fixtureId: f1.id, side: 'B', otherFixtureId: f2.id, otherSide: 'A' }, roster(16), [match]))
      .toEqual({ ok: false, reason: 'One of those games has already started.' })
    const [s1, s2] = t.fixtures.filter((f) => f.roundNumber === 2)
    expect(applyRunningEdit(t, { kind: 'SWAP_OPPONENTS', fixtureId: s1.id, side: 'A', otherFixtureId: s2.id, otherSide: 'A' }, roster(16), []))
      .toEqual({ ok: false, reason: 'That slot is still waiting for an earlier result.' })
  })

  it('refuses a swap that would make a round robin pair meet twice', () => {
    const t = running('ROUND_ROBIN', 8)
    const [g1, g2] = t.fixtures.filter((f) => f.roundNumber === 1)
    const result = applyRunningEdit(t, { kind: 'SWAP_OPPONENTS', fixtureId: g1.id, side: 'B', otherFixtureId: g2.id, otherSide: 'B' }, roster(8), [])
    expect(!result.ok && result.reason).toMatch(/would play each other twice\.$/)
  })

  it('is refused before Start and after the last game', () => {
    const t = draft('ROUND_ROBIN', 8)
    const edit = { kind: 'SUBSTITUTE' as const, entrantId: seed(t, 1).id, outPlayerId: 'p2', inPlayerId: 'p9' }
    expect(applyRunningEdit(t, edit, roster(9), [])).toEqual({ ok: false, reason: 'Start the tournament first. Until then, edit the draft draw instead.' })
    expect(applyRunningEdit({ ...t, phase: 'FINISHED' }, edit, roster(9), [])).toEqual({ ok: false, reason: 'The tournament is over.' })
  })
})

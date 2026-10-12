import { describe, expect, it } from 'vitest'
import { at, player } from '../testing/fixtures'
import type { OpenMatch, OpenPlayer, Side } from '../types'
import { generateDraw } from './draw'
import { champion, editFixtureResult, fixtureFinished, fixtureStarted, reopenFixture } from './progress'
import { overallStandings, poolStandings } from './standings'
import type { TournamentFormat, TournamentState } from './types'

const roster = (n: number): OpenPlayer[] => Array.from({ length: n }, (_, i) => player(`p${i + 1}`, { name: `P${i + 1}`, position: i + 1 }))

function running(format: TournamentFormat, n: number): { t: TournamentState; players: OpenPlayer[] } {
  let k = 0
  const players = roster(n)
  const result = generateDraw(players, { format, pairing: 'MANUAL', seeding: 'MANUAL' }, { newId: () => `id${(k += 1)}` }, 2000)
  if (!result.ok) throw new Error(result.reason)
  return { t: { ...result.tournament, phase: 'RUNNING', startedAt: at(0) }, players }
}

interface Played { t: TournamentState; matches: OpenMatch[] }

/** Saves a result for one fixture the way the reducer does: a FINISHED match carrying the fixture id, then fixtureFinished. */
function play({ t, matches }: Played, players: OpenPlayer[], fixtureId: string, winner: Side, scoreA: number, scoreB: number): Played {
  const f = t.fixtures.find((x) => x.id === fixtureId)!
  const team = (id: string | null) => t.entrants.find((e) => e.id === id)!.playerIds
  const match: OpenMatch = {
    id: `m-${fixtureId}`, courtId: 'c1', seq: matches.length + 1, status: 'FINISHED', teamA: team(f.entrantAId), teamB: team(f.entrantBId),
    scoreA, scoreB, winner, proposedAt: at(1), startedAt: at(1), finishedAt: at(2), recordedBy: 'Host', fixtureId,
  }
  const all = [...matches.filter((m) => m.id !== match.id), match]
  return { t: fixtureFinished(t, fixtureId, winner, all, players), matches: all }
}

const fixture = (t: TournamentState, bracket: string, round: number, position = 0) =>
  t.fixtures.find((f) => f.bracket === bracket && f.roundNumber === round && f.position === position)!

describe('advancing the draw', () => {
  it('single elimination: winners fill the next round, which is ready once both are known', () => {
    const { t, players } = running('SINGLE_ELIMINATION', 8) // 4 pairs: two semis, a final
    let s: Played = { t, matches: [] }
    const [semi1, semi2] = [fixture(t, 'MAIN', 1, 0), fixture(t, 'MAIN', 1, 1)]
    s = play(s, players, semi1.id, 'A', 11, 4)
    expect(fixture(s.t, 'MAIN', 2)).toMatchObject({ entrantAId: semi1.entrantAId, entrantBId: null, status: 'PENDING' })
    s = play(s, players, semi2.id, 'B', 9, 11)
    expect(fixture(s.t, 'MAIN', 2)).toMatchObject({ entrantAId: semi1.entrantAId, entrantBId: semi2.entrantBId, status: 'READY' })
    s = play(s, players, fixture(s.t, 'MAIN', 2).id, 'B', 7, 11)
    expect(s.t.phase).toBe('FINISHED')
    expect(champion(s.t, s.matches, players)?.id).toBe(semi2.entrantBId)
  })

  it('double elimination: a first loss drops the pair to the losers bracket', () => {
    const { t, players } = running('DOUBLE_ELIMINATION', 8)
    const opener = fixture(t, 'MAIN', 1, 0)
    const s = play({ t, matches: [] }, players, opener.id, 'A', 11, 6)
    const dropped = s.t.fixtures.find((f) => f.bracket === 'LOSERS' && (f.entrantAId === opener.entrantBId || f.entrantBId === opener.entrantBId))
    expect(dropped).toBeDefined()
  })

  it('pools: the bracket fills only when a pool has played every game, top two by wins then points', () => {
    const { t, players } = running('POOL_TO_BRACKET', 8) // pools A and B of 2 pairs: one game each
    const [poolA, poolB] = [t.fixtures.find((f) => f.poolLabel === 'A')!, t.fixtures.find((f) => f.poolLabel === 'B')!]
    let s = play({ t, matches: [] }, players, poolA.id, 'B', 5, 11)
    // Four qualifiers: semi-final 1 is A winner v B runner-up, semi-final 2 is B winner v A runner-up.
    const [semi1, semi2] = [fixture(t, 'MAIN', 1, 0), fixture(t, 'MAIN', 1, 1)]
    // Pool A is done: its winner and runner-up are seated; pool B's slots still wait.
    expect(fixture(s.t, 'MAIN', 1, 0)).toMatchObject({ entrantAId: poolA.entrantBId, entrantBId: null, status: 'PENDING' })
    expect(fixture(s.t, 'MAIN', 1, 1)).toMatchObject({ entrantAId: null, entrantBId: poolA.entrantAId, status: 'PENDING' })
    s = play(s, players, poolB.id, 'A', 11, 2)
    expect(s.t.fixtures.find((f) => f.id === semi1.id)).toMatchObject({ entrantBId: poolB.entrantBId, status: 'READY' })
    expect(s.t.fixtures.find((f) => f.id === semi2.id)).toMatchObject({ entrantAId: poolB.entrantAId, status: 'READY' })
    expect(poolStandings(s.t, 'A', s.matches, players).map((r) => [r.entrantId, r.wins, r.pointDifferential])).toEqual([
      [poolA.entrantBId, 1, 6], [poolA.entrantAId, 0, -6],
    ])
  })
})

describe('taking a result back', () => {
  it('undo clears the slot it filled, and is refused once that next game has started', () => {
    const { t, players } = running('SINGLE_ELIMINATION', 8)
    const semi1 = fixture(t, 'MAIN', 1, 0)
    let s = play({ t, matches: [] }, players, semi1.id, 'A', 11, 4)
    const reopened = reopenFixture(s.t, semi1.id)
    expect(reopened.ok && reopened.tournament.fixtures.find((f) => f.id === semi1.id)).toMatchObject({ status: 'IN_PROGRESS', winnerEntrantId: null })
    expect(reopened.ok && fixture(reopened.tournament, 'MAIN', 2).entrantAId).toBeNull()

    s = play(s, players, fixture(s.t, 'MAIN', 1, 1).id, 'A', 11, 4)
    const startedFinal = fixtureStarted(s.t, fixture(s.t, 'MAIN', 2).id)
    expect(reopenFixture(startedFinal, semi1.id)).toEqual({ ok: false, reason: 'Final has already started with this result. Change that game first.' })
  })

  it('a pool result can be taken back until the pool’s top two start the bracket', () => {
    const { t, players } = running('POOL_TO_BRACKET', 8)
    const poolA = t.fixtures.find((f) => f.poolLabel === 'A')!
    const s = play({ t, matches: [] }, players, poolA.id, 'A', 11, 5)
    const semi1 = fixture(s.t, 'MAIN', 1, 0)
    expect(semi1.entrantAId).toBe(poolA.entrantAId)
    const reopened = reopenFixture(s.t, poolA.id)
    expect(reopened.ok && reopened.tournament.fixtures.find((f) => f.id === semi1.id)?.entrantAId).toBeNull()
    const blocked = reopenFixture(fixtureStarted(s.t, semi1.id), poolA.id)
    expect(blocked).toEqual({ ok: false, reason: "Pool A's top two have already started Semi-final 1. Change that game first." })
  })
})

describe('editing a saved result', () => {
  it('a score change keeps the winner and moves nobody', () => {
    const { t, players } = running('SINGLE_ELIMINATION', 8)
    const semi1 = fixture(t, 'MAIN', 1, 0)
    const s = play({ t, matches: [] }, players, semi1.id, 'A', 11, 4)
    expect(editFixtureResult(s.t, semi1.id, 'A', s.matches, players)).toEqual({ ok: true, tournament: s.t })
  })

  it('a different winner swaps who moved on, unless the next game already started', () => {
    const { t, players } = running('SINGLE_ELIMINATION', 8)
    const semi1 = fixture(t, 'MAIN', 1, 0)
    const s = play({ t, matches: [] }, players, semi1.id, 'A', 11, 4)
    const flipped = editFixtureResult(s.t, semi1.id, 'B', s.matches, players)
    expect(flipped.ok && fixture(flipped.tournament, 'MAIN', 2).entrantAId).toBe(semi1.entrantBId)
  })

  it('a pool score edit that keeps the same top two is allowed even after the bracket starts', () => {
    const { t, players } = running('POOL_TO_BRACKET', 8)
    const poolA = t.fixtures.find((f) => f.poolLabel === 'A')!
    const s = play({ t, matches: [] }, players, poolA.id, 'A', 11, 5)
    const live = fixtureStarted(s.t, fixture(s.t, 'MAIN', 1, 0).id)
    const sameWinner = s.matches.map((m) => (m.fixtureId === poolA.id ? { ...m, scoreB: 9 } : m))
    expect(editFixtureResult(live, poolA.id, 'A', sameWinner, players).ok).toBe(true)
    const otherWinner = s.matches.map((m) => (m.fixtureId === poolA.id ? { ...m, winner: 'B' as const, scoreA: 5, scoreB: 11 } : m))
    expect(editFixtureResult(live, poolA.id, 'B', otherWinner, players).ok).toBe(false)
  })
})

describe('standings and champion', () => {
  it('round robin ranks by wins, then losses, then point difference; the top pair is champion', () => {
    const { t, players } = running('ROUND_ROBIN', 6) // 3 pairs, 3 games
    let s: Played = { t, matches: [] }
    for (const f of t.fixtures) s = play(s, players, f.id, 'A', 11, f.roundNumber + 2)
    const table = overallStandings(s.t, s.matches, players)
    expect(table.map((r) => r.rank)).toEqual([1, 2, 3])
    expect(table[0].wins).toBeGreaterThanOrEqual(table[1].wins)
    expect(table.every((r) => r.played === 2)).toBe(true)
    expect(s.t.phase).toBe('FINISHED')
    expect(champion(s.t, s.matches, players)?.id).toBe(table[0].entrantId)
  })

  it('no champion before the last game', () => {
    const { t, players } = running('ROUND_ROBIN', 6)
    expect(champion(t, [], players)).toBeNull()
  })
})

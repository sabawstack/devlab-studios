import { describe, expect, it } from 'vitest'
import { player } from '../testing/fixtures'
import { generateDraw, unpairedPlayers } from './draw'
import { fixtureLabel, sourceLabel } from './labels'
import { compareFixtures, sortEntrants } from './order'
import type { TournamentFormat } from './types'

const players = (n: number) => Array.from({ length: n }, (_, i) => player(`p${i + 1}`, { name: `P${i + 1}`, position: i + 1, skill: 5 - (i % 5) }))
const ids = () => {
  let n = 0
  return () => `id${(n += 1)}`
}
const draw = (format: TournamentFormat, n: number, max = 2000) =>
  generateDraw(players(n), { format, pairing: 'MANUAL', seeding: 'MANUAL' }, { newId: ids() }, max)

describe('generateDraw', () => {
  it('refuses random pairing or seeding, with a reason, when no random source was passed in', () => {
    const reason = 'Random pairing or seeding is not available right now. Try again, or pick another method.'
    expect(generateDraw(players(8), { format: 'ROUND_ROBIN', pairing: 'RANDOM', seeding: 'MANUAL' }, { newId: ids() }, 2000)).toEqual({ ok: false, reason })
    expect(generateDraw(players(8), { format: 'ROUND_ROBIN', pairing: 'MANUAL', seeding: 'RANDOM' }, { newId: ids() }, 2000)).toEqual({ ok: false, reason })
  })

  it('breaks a balanced-pairing skill tie by name in plain code-unit order, then by id', () => {
    const tied = [player('p1', { name: 'bea', position: 1, skill: 3 }), player('p2', { name: 'Zed', position: 2, skill: 3 }), player('p3', { name: 'Al', position: 3, skill: 3 }), player('p4', { name: 'Al', position: 4, skill: 3 })]
    const result = generateDraw(tied, { format: 'ROUND_ROBIN', pairing: 'BALANCED', seeding: 'MANUAL' }, { newId: ids() }, 2000)
    if (!result.ok) throw new Error(result.reason)
    // Order Al(p3), Al(p4), Zed, bea: uppercase sorts before lowercase; strongest pairs with weakest.
    expect(result.tournament.entrants.map((e) => e.playerIds)).toEqual([['p3', 'p1'], ['p4', 'p2']])
  })

  it('makes a draft with pairs in seed order and the generator fixtures, ids for keys', () => {
    const result = draw('SINGLE_ELIMINATION', 10)
    if (!result.ok) throw new Error(result.reason)
    const t = result.tournament
    expect(t.phase).toBe('DRAFT')
    expect(t.entrants.map((e) => [e.seed, e.playerIds])).toEqual([[1, ['p1', 'p2']], [2, ['p3', 'p4']], [3, ['p5', 'p6']], [4, ['p7', 'p8']], [5, ['p9', 'p10']]])
    expect(t.fixtures).toHaveLength(4) // n - 1, byes are not games
    const fixtureIds = new Set(t.fixtures.map((f) => f.id))
    for (const source of t.fixtures.flatMap((f) => [f.sourceA, f.sourceB]).filter(Boolean)) {
      expect(fixtureIds.has(String(source).replace(/^WINNER_OF:/, ''))).toBe(true)
    }
    expect([...t.fixtures].sort(compareFixtures)).toEqual(t.fixtures)
  })

  it('pools: every pair gets its pool label, and the bracket is fed by pool ranks', () => {
    const result = draw('POOL_TO_BRACKET', 16)
    if (!result.ok) throw new Error(result.reason)
    const t = result.tournament
    expect(t.entrants.map((e) => e.poolLabel)).toEqual(['A', 'B', 'B', 'A', 'A', 'B', 'B', 'A'])
    expect(t.fixtures.filter((f) => f.bracket === 'POOL')).toHaveLength(12)
    expect(t.fixtures.filter((f) => f.sourceA?.startsWith('POOL_RANK:')).map((f) => sourceLabel(t, f.sourceA))).toEqual(['Pool A winner', 'Pool B winner'])
  })

  it('refuses too few pairs, naming the minimum', () => {
    expect(draw('POOL_TO_BRACKET', 6)).toEqual({ ok: false, reason: 'Pools, then bracket needs at least 4 pairs (8 players).' })
    expect(draw('DOUBLE_ELIMINATION', 5)).toEqual({ ok: false, reason: 'Double elimination needs at least 3 pairs (6 players).' })
  })

  it('refuses a draw bigger than the session can hold', () => {
    expect(draw('ROUND_ROBIN', 40, 100)).toEqual({ ok: false, reason: 'That draw needs 190 games, more than this session can hold (100). Use pools, or fewer pairs.' })
    // Already pools: suggesting pools would be no help.
    const pools = draw('POOL_TO_BRACKET', 40, 10)
    expect(pools.ok).toBe(false)
    if (!pools.ok) expect(pools.reason).toMatch(/^That draw needs \d+ games, more than this session can hold \(10\)\. Use fewer pairs\.$/)
  })

  it('draws only checked-in players, and flags the odd one out', () => {
    const roster = [...players(9), player('p10', { name: 'Rested', position: 10, status: 'BREAK' })]
    const result = generateDraw(roster, { format: 'ROUND_ROBIN', pairing: 'MANUAL', seeding: 'MANUAL' }, { newId: ids() }, 2000)
    if (!result.ok) throw new Error(result.reason)
    expect(result.tournament.entrants).toHaveLength(4)
    expect(unpairedPlayers(result.tournament, roster).map((p) => p.name)).toEqual(['P9'])
  })
})

describe('labels', () => {
  it('names elimination rounds from the end', () => {
    const result = draw('SINGLE_ELIMINATION', 16) // 8 pairs: quarter-finals, semi-finals, final
    if (!result.ok) throw new Error(result.reason)
    const t = result.tournament
    expect([...new Set(t.fixtures.map((f) => fixtureLabel(t, f).replace(/ \d+$/, '')))]).toEqual(['Quarter-final', 'Semi-final', 'Final'])
    const semi = t.fixtures.find((f) => f.roundNumber === 2 && f.position === 0)!
    expect(fixtureLabel(t, semi)).toBe('Semi-final 1')
    const final = t.fixtures.find((f) => f.roundNumber === 3)!
    expect(sourceLabel(t, final.sourceA)).toBe('Winner of Semi-final 1')
  })

  it('names double elimination and pool rounds', () => {
    const de = draw('DOUBLE_ELIMINATION', 8)
    if (!de.ok) throw new Error(de.reason)
    expect(de.tournament.fixtures.map((f) => fixtureLabel(de.tournament, f))).toEqual([
      'Winners round 1 · Game 1', 'Winners round 1 · Game 2', 'Winners final', 'Grand final', 'Losers round 1', 'Losers final',
    ])
    const bigDe = draw('DOUBLE_ELIMINATION', 16)
    if (!bigDe.ok) throw new Error(bigDe.reason)
    const losersTwo = bigDe.tournament.fixtures.filter((f) => f.bracket === 'LOSERS' && f.roundNumber === 2).sort((a, b) => a.position - b.position)
    expect(losersTwo.map((f) => fixtureLabel(bigDe.tournament, f))).toEqual(['Losers round 2 · Game 1', 'Losers round 2 · Game 2'])
    const pools = draw('POOL_TO_BRACKET', 8)
    if (!pools.ok) throw new Error(pools.reason)
    expect(fixtureLabel(pools.tournament, pools.tournament.fixtures[0])).toBe('Pool A · Round 1')
    const bigPools = draw('POOL_TO_BRACKET', 16)
    if (!bigPools.ok) throw new Error(bigPools.reason)
    const poolGame = bigPools.tournament.fixtures.find((f) => f.poolLabel === 'A' && f.roundNumber === 1 && f.position === 1)!
    expect(fixtureLabel(bigPools.tournament, poolGame)).toBe('Pool A · Round 1 · Game 2')
    const rr = draw('ROUND_ROBIN', 8)
    if (!rr.ok) throw new Error(rr.reason)
    const rrGame = rr.tournament.fixtures.find((f) => f.roundNumber === 1 && f.position === 1)!
    expect(fixtureLabel(rr.tournament, rrGame)).toBe('Round 1 · Game 2')
  })
})

describe('canonical order', () => {
  it('breaks every remaining tie by id, and orders pool labels by plain code-unit order', () => {
    const base = { bracket: 'POOL' as const, roundNumber: 1, position: 0, entrantAId: null, entrantBId: null, sourceA: null, sourceB: null, winnerEntrantId: null, status: 'PENDING' as const }
    const fixtures = [{ ...base, id: 'b', poolLabel: 'a' }, { ...base, id: 'z', poolLabel: 'B' }, { ...base, id: 'a', poolLabel: 'B' }]
    expect([...fixtures].sort(compareFixtures).map((f) => f.id)).toEqual(['a', 'z', 'b'])
    const entrants = [{ id: 'y', playerIds: ['p1', 'p2'] as const, seed: 1, poolLabel: null }, { id: 'x', playerIds: ['p3', 'p4'] as const, seed: 1, poolLabel: null }]
    expect(sortEntrants(entrants).map((e) => e.id)).toEqual(['x', 'y'])
  })
})

import { describe, expect, it } from 'vitest'
import { player } from '../testing/fixtures'
import { generateDraw, unpairedPlayers } from './draw'
import { fixtureLabel, sourceLabel } from './labels'
import { compareFixtures } from './order'
import type { TournamentFormat } from './types'

const players = (n: number) => Array.from({ length: n }, (_, i) => player(`p${i + 1}`, { name: `P${i + 1}`, position: i + 1, skill: 5 - (i % 5) }))
const ids = () => {
  let n = 0
  return () => `id${(n += 1)}`
}
const draw = (format: TournamentFormat, n: number, max = 2000) =>
  generateDraw(players(n), { format, pairing: 'MANUAL', seeding: 'MANUAL' }, { newId: ids() }, max)

describe('generateDraw', () => {
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
      'Winners round 1 1', 'Winners round 1 2', 'Winners final', 'Grand final', 'Losers round 1', 'Losers final',
    ])
    const pools = draw('POOL_TO_BRACKET', 8)
    if (!pools.ok) throw new Error(pools.reason)
    expect(fixtureLabel(pools.tournament, pools.tournament.fixtures[0])).toBe('Pool A · Round 1')
  })
})

import { describe, expect, it } from 'vitest'
import { mulberry32 } from '../testing/simulate'
import { player } from '../testing/fixtures'
import { formPairs, pairSkill, seedPairs, shuffle } from './pairing'

const roster = (skills: Array<number | null>) => skills.map((skill, i) => player(`p${i + 1}`, { name: `P${i + 1}`, position: i + 1, skill }))
const seeded = (seed: number) => {
  const next = mulberry32(seed)
  return (max: number) => Math.floor(next() * max)
}

describe('shuffle', () => {
  it('returns a permutation and leaves the input alone', () => {
    const input = ['a', 'b', 'c', 'd', 'e']
    const out = shuffle(input, seeded(7))
    expect([...out].sort()).toEqual(input)
    expect(input).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('reaches every order of three items (Fisher–Yates, not a biased sort)', () => {
    const seen = new Set<string>()
    for (let seed = 1; seed <= 200; seed += 1) seen.add(shuffle(['a', 'b', 'c'], seeded(seed)).join(''))
    expect(seen.size).toBe(6)
  })
})

describe('formPairs', () => {
  it('random: neighbours after a shuffle, the last one flagged when the count is odd', () => {
    const result = formPairs(roster([3, 3, 3, 3, 3]), 'RANDOM', () => 0)
    expect(result.pairs).toHaveLength(2)
    expect(result.unpaired).toHaveLength(1)
    expect(new Set([...result.pairs.flat(), ...result.unpaired]).size).toBe(5)
  })

  it('random needs a random source', () => {
    expect(() => formPairs(roster([3, 3]), 'RANDOM')).toThrow(/random source/)
  })

  it('balanced: strongest with weakest (snake by skill), no skill counts as 3', () => {
    const result = formPairs(roster([5, 1, 4, 2, null, 3]), 'BALANCED')
    // By skill: p1 5, p3 4, p5 3 (none), p6 3, p4 2, p2 1. Ties by name: P5 before P6.
    expect(result.pairs).toEqual([['p1', 'p2'], ['p3', 'p4'], ['p5', 'p6']])
    expect(result.unpaired).toEqual([])
  })

  it('balanced: with an odd count, the middle player is the one left over', () => {
    expect(formPairs(roster([5, 4, 3, 2, 1]), 'BALANCED')).toEqual({ pairs: [['p1', 'p5'], ['p2', 'p4']], unpaired: ['p3'] })
  })

  it('manual: list order, 1st with 2nd', () => {
    expect(formPairs(roster([1, 2, 3, 4, 5]), 'MANUAL')).toEqual({ pairs: [['p1', 'p2'], ['p3', 'p4']], unpaired: ['p5'] })
  })
})

describe('seedPairs', () => {
  const players = roster([1, 1, 5, 5, 3, 3])
  const pairs = [['p1', 'p2'], ['p3', 'p4'], ['p5', 'p6']] as const

  it('by skill: highest mean pair skill first', () => {
    expect(pairSkill(['p3', 'p5'], players)).toBe(4)
    expect(seedPairs(pairs, 'BY_SKILL', players)).toEqual([['p3', 'p4'], ['p5', 'p6'], ['p1', 'p2']])
  })

  it('manual keeps formation order; random shuffles', () => {
    expect(seedPairs(pairs, 'MANUAL', players)).toEqual(pairs)
    expect(seedPairs(pairs, 'RANDOM', players, () => 0)).toEqual([['p3', 'p4'], ['p5', 'p6'], ['p1', 'p2']])
  })
})

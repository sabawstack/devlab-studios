import { describe, expect, it } from 'vitest'
import { expectedWinnerScore, isPossibleFinal, validateResult } from './scoreValidation'
import { DEFAULT_SETTINGS } from './types'

const to11 = DEFAULT_SETTINGS

describe('expectedWinnerScore (the pad\'s default reading)', () => {
  it('is the target below it (sudden death), then loser + 2 (deuce)', () => {
    expect(expectedWinnerScore(7, to11)).toBe(11)
    expect(expectedWinnerScore(10, to11)).toBe(11)
    expect(expectedWinnerScore(11, to11)).toBe(13)
    expect(expectedWinnerScore(13, to11)).toBe(15)
  })
})

describe('isPossibleFinal', () => {
  it('accepts both sudden death and win-by-2 endings, and nothing else', () => {
    expect(isPossibleFinal(11, 10, 11)).toBe(true) // sudden death
    expect(isPossibleFinal(12, 10, 11)).toBe(true) // win by 2
    expect(isPossibleFinal(12, 11, 11)).toBe(false)
    expect(isPossibleFinal(13, 10, 11)).toBe(false)
    expect(isPossibleFinal(15, 14, 15)).toBe(true)
  })
})

describe('validateResult', () => {
  it.each([
    ['A', 11, 7], ['B', 4, 11], ['A', 11, 10], ['A', 12, 10], ['A', 13, 11], ['B', 13, 15],
  ])('accepts %s %i-%i in a game to 11', (winner, scoreA, scoreB) => {
    expect(validateResult({ winner: winner as 'A' | 'B', scoreA, scoreB }, to11)).toEqual({ ok: true })
  })

  it.each([
    ['A', 12, 9], ['A', 13, 10], ['A', 12, 11], ['A', 10, 8], ['A', 7, 11], ['A', 11, 11], ['A', 100, 98], ['A', 11.5, 7],
  ])('rejects %s %s-%s in a game to 11', (winner, scoreA, scoreB) => {
    const result = validateResult({ winner: winner as 'A' | 'B', scoreA: Number(scoreA), scoreB: Number(scoreB) }, to11)
    expect(result.ok).toBe(false)
  })

  it('explains both accepted endings when it refuses', () => {
    const result = validateResult({ winner: 'A', scoreA: 12, scoreB: 9 }, to11)
    expect(result).toMatchObject({ ok: false })
    expect(!result.ok && result.reason).toContain("can't end 12–9")
  })

  it('a winner-only save (both scores null) is always allowed', () => {
    expect(validateResult({ winner: 'B', scoreA: null, scoreB: null }, to11)).toEqual({ ok: true })
  })

  it('half a score is refused', () => {
    expect(validateResult({ winner: 'A', scoreA: 11, scoreB: null }, to11).ok).toBe(false)
  })

  it('a winner-only session refuses scores', () => {
    const settings = { ...to11, winnerOnly: true }
    expect(validateResult({ winner: 'A', scoreA: 11, scoreB: 5 }, settings).ok).toBe(false)
    expect(validateResult({ winner: 'A', scoreA: null, scoreB: null }, settings)).toEqual({ ok: true })
  })
})

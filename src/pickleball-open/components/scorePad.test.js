import { describe, expect, it } from 'vitest'
import { resultFromPad, scorePadOptions } from './scorePad'

const settings = { target: 11, winnerOnly: false }

describe('score pad', () => {
  it('offers every losing score up to target - 1, then deuce scores', () => {
    expect(scorePadOptions(11).slice(0, 11)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(scorePadOptions(11)).toContain(13)
  })

  it('fills the winner score from the loser score, defaulting to sudden death', () => {
    expect(resultFromPad('A', 7, settings)).toEqual({ winner: 'A', scoreA: 11, scoreB: 7 })
    expect(resultFromPad('B', 10, settings)).toEqual({ winner: 'B', scoreA: 10, scoreB: 11 })
    expect(resultFromPad('A', 11, settings)).toEqual({ winner: 'A', scoreA: 13, scoreB: 11 })
  })

  it('a loser at target - 1 can be switched to win by 2 (12–10)', () => {
    expect(resultFromPad('B', 10, settings, true)).toEqual({ winner: 'B', scoreA: 10, scoreB: 12 })
    // the switch only matters at target - 1
    expect(resultFromPad('A', 7, settings, true)).toEqual({ winner: 'A', scoreA: 11, scoreB: 7 })
  })
})

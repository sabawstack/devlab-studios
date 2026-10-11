// src/lib/pickleball/open/standings.test.ts
import { describe, expect, it } from 'vitest'
import { computeStandings } from './standings'
import { finished, player } from './testing/fixtures'

const names = (rows: { name: string }[]) => rows.map((row) => row.name)

describe('computeStandings', () => {
  it('ranks by win rate, then point difference PER GAME (spec §5.3 example)', () => {
    // Ana: 11-2, 11-3, 11-5, 9-11 (+21 / 4 = +5.25). Leo: 11-9, 11-9, 12-10, 9-11 (+4 / 4 = +1).
    const players = ['Ana', 'Leo', 'x1', 'x2', 'x3', 'x4'].map((id) => player(id))
    const matches = [
      finished('a1', ['Ana', 'x1'], ['x2', 'x3'], 'A', 11, 2, 1),
      finished('a2', ['Ana', 'x1'], ['x2', 'x3'], 'A', 11, 3, 2),
      finished('a3', ['Ana', 'x1'], ['x2', 'x3'], 'A', 11, 5, 3),
      finished('a4', ['Ana', 'x1'], ['x2', 'x3'], 'B', 9, 11, 4),
      finished('l1', ['Leo', 'x4'], ['x2', 'x3'], 'A', 11, 9, 5),
      finished('l2', ['Leo', 'x4'], ['x2', 'x3'], 'A', 11, 9, 6),
      finished('l3', ['Leo', 'x4'], ['x2', 'x3'], 'A', 12, 10, 7),
      finished('l4', ['Leo', 'x4'], ['x2', 'x3'], 'B', 9, 11, 8),
    ]
    const rows = computeStandings(players, matches)
    const ana = rows.find((row) => row.name === 'Ana')!
    expect(ana).toMatchObject({ played: 4, wins: 3, losses: 1, winRate: 0.75, avgDiff: 5.25, rank: 1 })
    expect(rows.indexOf(ana)).toBeLessThan(rows.findIndex((row) => row.name === 'Leo'))
  })

  it('compares per game, not totals, when game counts differ', () => {
    // A: one game, +8 (11-3). B: two games, +5 each (total +10 beats A's +8, per-game +5 does not).
    // Distinct partners so nobody else shares A's or B's record.
    const players = ['A', 'B', 'p1', 'p2', 'o1', 'o2'].map((id) => player(id))
    const matches = [
      finished('m1', ['A', 'p1'], ['o1', 'o2'], 'A', 11, 3, 1),
      finished('m2', ['B', 'p2'], ['o1', 'o2'], 'A', 11, 6, 2),
      finished('m3', ['B', 'p2'], ['o1', 'o2'], 'A', 11, 6, 3),
    ]
    const order = names(computeStandings(players, matches))
    expect(order.indexOf('A')).toBeLessThan(order.indexOf('B'))
  })

  it('winner-only games count toward W/L but not toward point averages', () => {
    const rows = computeStandings([player('A'), player('B'), player('C'), player('D')], [
      finished('m1', ['A', 'B'], ['C', 'D'], 'A', null, null, 1),
      finished('m2', ['A', 'B'], ['C', 'D'], 'A', 11, 5, 2),
    ])
    expect(rows.find((row) => row.name === 'A')).toMatchObject({ played: 2, wins: 2, scoredGames: 1, avgDiff: 6, avgFor: 11 })
  })

  it('breaks a full tie by head-to-head when the tied players met', () => {
    // Zed and Amy both finish 1-1, 20 for and 20 against: identical on every
    // core key. Zed beat Amy in m1, so Zed ranks first even though "Amy"
    // sorts first by name.
    // Every other player appears once, so only Zed and Amy finish 1-1.
    const players = ['Zed', 'Amy', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y'].map((id) => player(id))
    const rows = computeStandings(players, [
      finished('m1', ['Zed', 'r'], ['Amy', 's'], 'A', 11, 9, 1),
      finished('m2', ['Amy', 't'], ['u', 'v'], 'A', 11, 9, 2),
      finished('m3', ['Zed', 'w'], ['x', 'y'], 'B', 9, 11, 3),
    ])
    expect(names(rows).filter((n) => n === 'Zed' || n === 'Amy')).toEqual(['Zed', 'Amy'])
  })

  it('falls back to name when tied players never met', () => {
    const players = ['Zed', 'Amy', 'r', 's', 't', 'u'].map((id) => player(id))
    const rows = computeStandings(players, [
      finished('m1', ['Zed', 'r'], ['s', 't'], 'A', 11, 5, 1),
      finished('m2', ['Amy', 'u'], ['s', 't'], 'A', 11, 5, 2),
    ])
    expect(names(rows).slice(0, 4)).toEqual(['Amy', 'r', 'u', 'Zed'])
  })

  it('lists unplayed players last and unranked, and drops players who left without playing', () => {
    const rows = computeStandings(
      [player('A'), player('B'), player('C'), player('D'), player('New'), player('Gone', { status: 'LEFT' })],
      [finished('m1', ['A', 'B'], ['C', 'D'], 'A', 11, 4, 1)],
    )
    expect(rows.at(-1)).toMatchObject({ name: 'New', played: 0, rank: null, winRate: null })
    expect(names(rows)).not.toContain('Gone')
  })

  it('ignores matches that are not finished', () => {
    const live = { ...finished('m1', ['A', 'B'], ['C', 'D'], 'A', 11, 4, 1), status: 'IN_PROGRESS' as const, winner: null }
    const rows = computeStandings(['A', 'B', 'C', 'D'].map((id) => player(id)), [live])
    expect(rows.every((row) => row.played === 0)).toBe(true)
  })
})

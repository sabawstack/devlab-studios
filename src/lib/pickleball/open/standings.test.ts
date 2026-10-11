// src/lib/pickleball/open/standings.test.ts
import { describe, expect, it } from 'vitest'
import { computeStandings } from './standings'
import { finished, player } from './testing/fixtures'

const names = (rows: { name: string }[]) => rows.map((row) => row.name)

describe('computeStandings', () => {
  it('ranks by win rate, then by the average share of points won per game (spec §5.3)', () => {
    // Ana: 11-2, 11-3, 11-5, 9-11 -> mean of 84.6/78.6/68.8/45.0 = 69.2%. Leo: 11-9, 11-9, 12-10, 9-11 -> 52.4%.
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
    expect(ana).toMatchObject({ played: 4, wins: 3, losses: 1, winRate: 0.75, pointsFor: 42, pointsAgainst: 21, rank: 1 })
    expect(ana.pointsPct).toBeCloseTo((11 / 13 + 11 / 14 + 11 / 16 + 9 / 20) / 4, 10)
    expect(rows.indexOf(ana)).toBeLessThan(rows.findIndex((row) => row.name === 'Leo'))
  })

  it('matches the documented OPI worked example: per-game shares averaged, each game counting equally', () => {
    // docs/pickleball/opi-methodology.md: 11-7, 9-11, 11-5 -> 58.287...% (a pooled 31 of 54 would be 57.4%).
    const players = ['X', 'x1', 'o1', 'o2'].map((id) => player(id))
    const rows = computeStandings(players, [
      finished('m1', ['X', 'x1'], ['o1', 'o2'], 'A', 11, 7, 1),
      finished('m2', ['X', 'x1'], ['o1', 'o2'], 'A', 9, 11, 2),
      finished('m3', ['X', 'x1'], ['o1', 'o2'], 'A', 11, 5, 3),
    ].map((m, i) => (i === 1 ? { ...m, winner: 'B' as const } : m)))
    expect(rows.find((row) => row.name === 'X')!.pointsPct! * 100).toBeCloseTo(58.287037037037045, 10)
  })

  it('compares the share of points, not the margin, so games to 11 and to 21 are comparable', () => {
    // P won 21-13 (+8, 61.8%). Q won 11-4 (+7, 73.3%). A margin ranks P first; the percentage ranks Q first.
    const players = ['P', 'Q', 'p1', 'q1', 'o1', 'o2'].map((id) => player(id))
    const matches = [
      finished('m1', ['P', 'p1'], ['o1', 'o2'], 'A', 21, 13, 1),
      finished('m2', ['Q', 'q1'], ['o1', 'o2'], 'A', 11, 4, 2),
    ]
    const order = names(computeStandings(players, matches))
    expect(order.indexOf('Q')).toBeLessThan(order.indexOf('P'))
  })

  it('does not reward playing more games: a percentage, not a points total', () => {
    // A: one game 11-3 (78.6%). B: two games 11-8, 11-8 (22 of 38, 57.9%) - more points in total, lower share.
    const players = ['A', 'B', 'p1', 'p2', 'o1', 'o2'].map((id) => player(id))
    const matches = [
      finished('m1', ['A', 'p1'], ['o1', 'o2'], 'A', 11, 3, 1),
      finished('m2', ['B', 'p2'], ['o1', 'o2'], 'A', 11, 8, 2),
      finished('m3', ['B', 'p2'], ['o1', 'o2'], 'A', 11, 8, 3),
    ]
    const order = names(computeStandings(players, matches))
    expect(order.indexOf('A')).toBeLessThan(order.indexOf('B'))
  })

  it('a legacy result saved without a score counts toward W/L but not toward the points share', () => {
    const rows = computeStandings([player('A'), player('B'), player('C'), player('D')], [
      finished('m1', ['A', 'B'], ['C', 'D'], 'A', null, null, 1),
      finished('m2', ['A', 'B'], ['C', 'D'], 'A', 11, 5, 2),
    ])
    const a = rows.find((row) => row.name === 'A')!
    expect(a).toMatchObject({ played: 2, wins: 2, scoredGames: 1, pointsFor: 11, pointsAgainst: 5 })
    expect(a.pointsPct).toBeCloseTo(11 / 16, 10)
  })

  it('has no points share for a player whose only results were saved without a score', () => {
    const rows = computeStandings([player('A'), player('B'), player('C'), player('D')], [
      finished('m1', ['A', 'B'], ['C', 'D'], 'A', null, null, 1),
    ])
    expect(rows.find((row) => row.name === 'A')).toMatchObject({ played: 1, pointsPct: null, rank: 1 })
  })

  it('breaks a full tie by head-to-head when the tied players met', () => {
    // Zed and Amy both finish 1-1, 20 of 40 points (50%): identical on every
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

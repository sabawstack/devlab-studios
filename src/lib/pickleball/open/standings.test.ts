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

  describe('place (ties share it)', () => {
    const places = (rows: { name: string; place: number | null }[]) => Object.fromEntries(rows.map((row) => [row.name, row.place]))

    it('is the rank when nobody is tied', () => {
      const rows = computeStandings(['A', 'B', 'C', 'D'].map((id) => player(id)), [
        finished('m1', ['A', 'B'], ['C', 'D'], 'A', 11, 4, 1),
        finished('m2', ['A', 'C'], ['B', 'D'], 'A', 11, 6, 2),
      ])
      expect(rows.map((row) => [row.name, row.rank, row.place])).toEqual([['A', 1, 1], ['B', 2, 2], ['C', 3, 3], ['D', 4, 4]])
    })

    it('is shared by players level on win %, points won % and who never met (1, 2, 2, 4)', () => {
      // A wins both. Zed and Amy each win once 11-5 against s/t, and never meet: tied on every key.
      const players = ['A', 'b', 'Zed', 'Amy', 's', 't', 'u', 'v'].map((id) => player(id))
      const rows = computeStandings(players, [
        finished('m1', ['A', 'b'], ['u', 'v'], 'A', 11, 0, 1),
        finished('m2', ['A', 'Zed'], ['s', 't'], 'A', 11, 5, 2),
        finished('m3', ['b', 'Amy'], ['s', 't'], 'A', 11, 5, 3),
      ])
      // A and b (2-0, same share, team-mates) share 1st; Zed and Amy share 3rd; the next place is 5th.
      const p = places(rows)
      expect([p.A, p.b, p.Zed]).toEqual([1, 1, 3])
      expect(p.Zed).toBe(p.Amy)
      expect(rows.filter((row) => row.place === p.Zed)).toHaveLength(2)
      const next = rows.find((row) => row.played > 0 && (row.place ?? 0) > (p.Zed ?? 0))
      expect(next?.place).toBe((p.Zed ?? 0) + 2)
    })

    it('is not shared when head-to-head separates the tied players', () => {
      const players = ['Zed', 'Amy', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y'].map((id) => player(id))
      const rows = computeStandings(players, [
        finished('m1', ['Zed', 'r'], ['Amy', 's'], 'A', 11, 9, 1),
        finished('m2', ['Amy', 't'], ['u', 'v'], 'A', 11, 9, 2),
        finished('m3', ['Zed', 'w'], ['x', 'y'], 'B', 9, 11, 3),
      ])
      const zed = rows.find((row) => row.name === 'Zed')
      const amy = rows.find((row) => row.name === 'Amy')
      expect(zed?.place).toBe(zed?.rank)
      expect(amy?.place).toBe(amy?.rank)
      expect(zed?.place).not.toBe(amy?.place)
    })

    it('is null for a player with no games', () => {
      const rows = computeStandings([player('A'), player('B'), player('C'), player('D'), player('New')], [finished('m1', ['A', 'B'], ['C', 'D'], 'A', 11, 4, 1)])
      expect(rows.find((row) => row.name === 'New')?.place).toBeNull()
      // A and B both 1-0 with the same share, team-mates who never faced each other: both 1st.
      expect(places(rows)).toMatchObject({ A: 1, B: 1, C: 3, D: 3 })
    })
  })
})

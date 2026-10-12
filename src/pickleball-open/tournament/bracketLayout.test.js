import { describe, expect, it } from 'vitest'
import { toViewerSnapshot } from '../../lib/pickleball/open/snapshot'
import { makeCtx, run, tournamentSession } from '../../lib/pickleball/open/testing/tournament'
import { drawSections, nextGames } from './bracketLayout'

function view(format, players, courts = 1) {
  const ctx = makeCtx()
  let state = run(tournamentSession(players, courts, format), { type: 'GENERATE_DRAW', format, pairing: 'MANUAL', seeding: 'MANUAL' }, ctx(1))
  state = run(state, { type: 'START_TOURNAMENT' }, ctx(2))
  return toViewerSnapshot(state).tournament
}

describe('drawSections', () => {
  it('pools first, then the bracket by round', () => {
    const sections = drawSections(view('POOL_TO_BRACKET', 16))
    expect(sections.map((s) => [s.title, s.kind])).toEqual([['Pool A', 'pool'], ['Pool B', 'pool'], ['Bracket', 'bracket']])
    expect(sections[2].rounds.map((r) => [r.title, r.games.length])).toEqual([['Semi-final', 2], ['Final', 1]])
    expect(sections[0].rounds.map((r) => r.title)).toEqual(['Pool A · Round 1', 'Pool A · Round 2', 'Pool A · Round 3'])
    // A round with one game keeps its number: pools of two pairs.
    expect(drawSections(view('POOL_TO_BRACKET', 8))[0].rounds.map((r) => r.title)).toEqual(['Pool A · Round 1'])
  })

  it('double elimination shows both brackets; round robin lists its rounds', () => {
    expect(drawSections(view('DOUBLE_ELIMINATION', 8)).map((s) => s.title)).toEqual(['Winners bracket', 'Losers bracket'])
    const rr = drawSections(view('ROUND_ROBIN', 8))
    expect(rr).toHaveLength(1)
    expect(rr[0]).toMatchObject({ title: 'Games', kind: 'rounds' })
    expect(rr[0].rounds.map((r) => r.title)).toEqual(['Round 1', 'Round 2', 'Round 3'])
  })
})

describe('nextGames', () => {
  it('lists ready games that have no court yet, earliest round first', () => {
    const t = view('ROUND_ROBIN', 8, 1)
    const next = nextGames(t)
    expect(next.every((f) => f.status === 'READY' && f.court === null)).toBe(true)
    expect(next[0].roundNumber).toBe(1)
    expect(nextGames(null)).toEqual([])
  })
})

import { describe, expect, it } from 'vitest'
import { resultsCsv } from './resultsCsv'
import { toCaptainSnapshot, toHostSnapshot, toViewerSnapshot } from './snapshot'
import { makeCtx, playOut, run, tournamentSession } from './testing/tournament'
import type { CaptainRecord } from './types'

function cup() {
  const ctx = makeCtx()
  let state = tournamentSession(8, 2, 'SINGLE_ELIMINATION')
  state = { ...state, players: state.players.map((p) => ({ ...p, duprId: 'AB12C3' })) }
  state = run(state, { type: 'GENERATE_DRAW', format: 'SINGLE_ELIMINATION', pairing: 'MANUAL', seeding: 'MANUAL' }, ctx(1))
  return { state, ctx }
}

describe('tournament snapshots', () => {
  it('the viewer sees pairs, the draw and standings by name, and nothing private', () => {
    const { state } = cup()
    const viewer = toViewerSnapshot(state)
    expect(viewer.kind).toBe('TOURNAMENT')
    const t = viewer.tournament!
    expect(t).toMatchObject({ format: 'SINGLE_ELIMINATION', formatLabel: 'Single elimination', phase: 'DRAFT', champion: null })
    expect(t.pairs.map((p) => p.name)).toEqual(['Ana & Ben', 'Cy & Di', 'Eva & Fin', 'Gus & Hal'])
    expect(t.fixtures.map((f) => f.label)).toEqual(['Semi-final 1', 'Semi-final 2', 'Final'])
    expect(t.fixtures[2]).toMatchObject({ nameA: null, waitingA: 'Winner of Semi-final 1', waitingB: 'Winner of Semi-final 2', placedA: false, placedB: false })
    expect(t.fixtures[0]).toMatchObject({ placedA: true, placedB: true })
    const json = JSON.stringify(viewer)
    for (const banned of ['AB12C3', 'skill', 'duprId', 'hash']) expect(json).not.toContain(banned)
  })

  it('a free court says where the tournament is; a playing court names its game', () => {
    const { state, ctx } = cup()
    expect(toHostSnapshot(state).courts[0].blocked).toBe('Courts fill once you start the tournament.')
    const started = run(state, { type: 'START_TOURNAMENT' }, ctx(2))
    const host = toHostSnapshot(started)
    expect(host.courts.map((c) => c.fixtureLabel)).toEqual(['Semi-final 1', 'Semi-final 2'])
    expect(toViewerSnapshot(started).courts.map((c) => c.fixtureLabel)).toEqual(['Semi-final 1', 'Semi-final 2'])
    expect(host.viewer.tournament!.fixtures[0].court).toEqual({ label: 'Court 1', live: false })
    const captain: CaptainRecord = { id: 'cap', label: 'Court 2 captain', courtId: 'c2', keyHash: 'h', createdAt: started.createdAt }
    expect(toCaptainSnapshot(started, captain).court.fixtureLabel).toBe('Semi-final 2')
  })

  it('names the champion once the final is saved, and the results CSV lists stages and pair standings', () => {
    const { state, ctx } = cup()
    const done = playOut(run(state, { type: 'START_TOURNAMENT' }, ctx(2)), ctx)
    const t = toViewerSnapshot(done).tournament!
    expect(t.phase).toBe('FINISHED')
    expect(t.champion?.name).toBe('Ana & Ben')
    expect(t.standings[0]).toMatchObject({ name: 'Ana & Ben', wins: 2, losses: 0 })
    const csv = resultsCsv(done).split('\r\n')
    expect(csv[0]).toBe('Game,Stage,Court,Started,Finished,Pair A,Pair B,Score A,Score B,Winner')
    expect(csv[3]).toMatch(/^3,Final,Court \d,/)
    expect(csv).toContain('Rank,Pool,Pair,Played,Won,Lost,Points for,Points against,Point difference')
    expect(csv.find((line) => line.startsWith('1,All,'))).toMatch(/^1,All,Ana & Ben,2,2,0,/)
  })

  it('a free court names the game that waits for a player on a break', () => {
    const { state, ctx } = cup()
    let running = run(state, { type: 'START_TOURNAMENT' }, ctx(2))
    const second = running.matches.find((m) => m.courtId === 'c2')!
    running = run(running, { type: 'SET_PLAYER_STATUS', playerId: second.teamA[0], status: 'BREAK' }, ctx(3))
    expect(toHostSnapshot(running).courts.find((c) => c.id === 'c2')?.blocked).toBe('Semi-final 2 waits for Cy, who is on a break.')
  })

  it('the tournament CSV neutralises a formula-like pair name and escapes its quotes and comma', () => {
    const { state: drafted, ctx } = cup()
    const named = { ...drafted, players: drafted.players.map((p) => (p.id === 'p1' ? { ...p, name: '=HYPERLINK("x","y"),z' } : p)) }
    const done = playOut(run(named, { type: 'START_TOURNAMENT' }, ctx(2)), ctx)
    const csv = resultsCsv(done)
    expect(csv).toContain(`"'=HYPERLINK(""x"",""y""),z & Ben"`)
    expect(csv).not.toMatch(/(^|,)=HYPERLINK/m)
    const tabbed = { ...done, players: done.players.map((p) => (p.id === 'p1' ? { ...p, name: '	=1+1' } : p)) }
    expect(resultsCsv(tabbed)).toContain(`"'	=1+1 & Ben"`)
  })
})

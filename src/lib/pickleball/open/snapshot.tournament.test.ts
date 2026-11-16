import { describe, expect, it } from 'vitest'
import { resultsCsv } from './resultsCsv'
import { toCaptainSnapshot, toHostSnapshot, toViewerSnapshot } from './snapshot'
import { makeCtx, playOut, run, tournamentSession } from './testing/tournament'
import { proposeFixture } from './tournament/courts'
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

// PB-TOURNAMENT-01: "Coming up" from the server's own fixture order and busy rules.
describe('tournament comingUp', () => {
  function roundRobin() {
    const ctx = makeCtx()
    let state = tournamentSession(16, 2, 'ROUND_ROBIN')
    state = run(state, { type: 'GENERATE_DRAW', format: 'ROUND_ROBIN', pairing: 'MANUAL', seeding: 'MANUAL' }, ctx(1))
    return { state, ctx }
  }

  it('is empty before the start, and carries exactly fixtureId and held', () => {
    const { state, ctx } = roundRobin()
    expect(toViewerSnapshot(state).tournament!.comingUp).toEqual([])
    const started = run(state, { type: 'START_TOURNAMENT' }, ctx(2))
    const coming = toViewerSnapshot(started).tournament!.comingUp
    expect(coming.length).toBeGreaterThan(0)
    for (const entry of coming) expect(Object.keys(entry).sort()).toEqual(['fixtureId', 'held'])
  })

  it('leaves out games already on a court and marks games whose pair is playing or on a break', () => {
    const { state, ctx } = roundRobin()
    const started = run(state, { type: 'START_TOURNAMENT' }, ctx(2))
    const t = toViewerSnapshot(started).tournament!
    const onCourt = new Set(t.fixtures.filter((f) => f.court).map((f) => f.id))
    expect(t.comingUp.some((c) => onCourt.has(c.fixtureId))).toBe(false)
    const playingPairs = new Set(t.fixtures.filter((f) => f.court).flatMap((f) => [f.entrantAId, f.entrantBId]))
    for (const entry of t.comingUp) {
      const f = t.fixtures.find((x) => x.id === entry.fixtureId)!
      const busy = playingPairs.has(f.entrantAId) || playingPairs.has(f.entrantBId)
      expect(entry.held).toBe(busy ? 'PAIR_PLAYING' : null)
    }
    // A player of a free pair goes on a break: that pair's games are held ON_BREAK.
    const free = t.comingUp.find((c) => c.held === null)!
    const pair = t.pairs.find((p) => p.id === t.fixtures.find((f) => f.id === free.fixtureId)!.entrantAId)!
    const away = run(started, { type: 'SET_PLAYER_STATUS', playerId: pair.playerIds[0], status: 'BREAK' }, ctx(3))
    const held = toViewerSnapshot(away).tournament!.comingUp.find((c) => c.fixtureId === free.fixtureId)
    expect(held?.held).toBe('ON_BREAK')
  })

  it('the first game not held is always the one the next free court takes', () => {
    const ctx = makeCtx()
    for (const [format, players] of [['ROUND_ROBIN', 12], ['POOL_TO_BRACKET', 16], ['DOUBLE_ELIMINATION', 8]] as const) {
      let state = tournamentSession(players, 2, format)
      state = run(state, { type: 'GENERATE_DRAW', format, pairing: 'MANUAL', seeding: 'MANUAL' }, ctx(1))
      state = run(state, { type: 'START_TOURNAMENT' }, ctx(2))
      let minute = 3
      for (let guard = 0; guard < 200; guard += 1) {
        const next = toViewerSnapshot(state).tournament!.comingUp.find((c) => c.held === null)?.fixtureId ?? null
        expect(proposeFixture(state)?.fixtureId ?? null).toBe(next)
        const live = state.matches.find((m) => m.status === 'PROPOSED' || m.status === 'IN_PROGRESS')
        if (!live) break
        if (live.status === 'PROPOSED') state = run(state, { type: 'START_MATCH', matchId: live.id }, ctx((minute += 1)))
        state = run(state, { type: 'RECORD_RESULT', matchId: live.id, winner: 'A', scoreA: 11, scoreB: 7 }, ctx((minute += 1)))
      }
    }
  })
})

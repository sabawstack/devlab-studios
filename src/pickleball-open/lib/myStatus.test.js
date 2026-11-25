// src/pickleball-open/lib/myStatus.test.js
import { describe, expect, it } from 'vitest'
import { myStatus, statusLine, statusText } from './myStatus'

const viewer = {
  roster: [{ id: 'a', name: 'Ana' }, { id: 'b', name: 'Ben' }, { id: 'c', name: 'Cyd' }, { id: 'd', name: 'Dex' }],
  courts: [
    { label: 'Court 1', state: 'PLAYING', teamA: ['Ana', 'x'], teamB: ['y', 'z'] },
    { label: 'Court 3', state: 'UP_NEXT', teamA: ['Ben', 'x'], teamB: ['y', 'z'] },
  ],
  waiting: [{ id: 'q', name: 'Q' }, { id: 'c', name: 'Cyd' }],
  onBreak: [{ id: 'd', name: 'Dex' }],
  nextUp: null,
}

describe('myStatus', () => {
  it('finds where a viewer is', () => {
    expect(myStatus(viewer, 'a')).toEqual({ kind: 'PLAYING', court: 'Court 1' })
    expect(myStatus(viewer, 'b')).toEqual({ kind: 'UP_NEXT', court: 'Court 3' })
    // PB-QUEUE-02: no place number. The waiting list is a priority order, not a promise.
    expect(myStatus(viewer, 'c')).toEqual({ kind: 'WAITING' })
    expect(myStatus(viewer, 'd')).toEqual({ kind: 'BREAK' })
    expect(myStatus(viewer, 'zz')).toEqual({ kind: 'NONE' })
  })

  it('is NEXT_FOUR, with the court, only when the server put the player on deck', () => {
    const fixed = { ...viewer, nextUp: { court: 'Court 1', players: [{ id: 'c', name: 'Cyd' }, { id: 'q', name: 'Q' }] } }
    expect(myStatus(fixed, 'c')).toEqual({ kind: 'NEXT_FOUR', court: 'Court 1' })
    // A confirmed call wins over everything else.
    expect(myStatus({ ...fixed, nextUp: { players: [{ id: 'b', name: 'Ben' }] } }, 'b')).toEqual({ kind: 'UP_NEXT', court: 'Court 3' })
  })
})

describe('myStatus in a tournament', () => {
  const tournament = {
    format: 'SINGLE_ELIMINATION',
    phase: 'RUNNING',
    pairs: [{ id: 'e1', playerIds: ['c', 'q'] }, { id: 'e2', playerIds: ['b', 'x'] }, { id: 'e3', playerIds: ['k', 'l'] }],
    fixtures: [
      { label: 'Semi-final 1', bracket: 'MAIN', entrantAId: 'e1', entrantBId: 'e3', status: 'FINISHED', winner: 'A' },
      { label: 'Final', bracket: 'MAIN', entrantAId: 'e1', entrantBId: null, status: 'PENDING', winner: null },
    ],
  }
  const cup = { ...viewer, tournament, roster: [...viewer.roster, { id: 'k', name: 'Kit' }] }

  it('names the next game instead of a place in line, and says when a pair is done', () => {
    expect(myStatus(cup, 'c')).toEqual({ kind: 'NEXT_GAME', label: 'Final' })
    expect(myStatus(cup, 'k')).toEqual({ kind: 'DONE' })
    expect(myStatus(cup, 'b')).toEqual({ kind: 'UP_NEXT', court: 'Court 3' })
    expect(myStatus({ ...cup, tournament: { ...tournament, phase: 'DRAFT' } }, 'c')).toEqual({ kind: 'NONE' })
  })
})

// A pair's games are only "done" once it can no longer play: the tournament is over or the pair is out.
const game = (label, bracket, entrantAId, entrantBId, status = 'READY', winner = null) => ({ label, bracket, entrantAId, entrantBId, status, winner })
const board = (tournament) => ({
  roster: [{ id: 'a1', name: 'A1' }, { id: 'b1', name: 'B1' }, { id: 'c1', name: 'C1' }, { id: 'd1', name: 'D1' }],
  courts: [], waiting: [], onBreak: [],
  tournament: { phase: 'RUNNING', ...tournament, pairs: [{ id: 'A', playerIds: ['a1', 'a2'] }, { id: 'B', playerIds: ['b1', 'b2'] }, { id: 'C', playerIds: ['c1', 'c2'] }, { id: 'D', playerIds: ['d1', 'd2'] }] },
})

describe('myStatus once a pair has no game placed', () => {
  it('pools into a bracket: waits for the pools, then is out only if it did not qualify', () => {
    const pools = [
      game('Pool A · Round 1 · Game 1', 'POOL', 'A', 'B', 'FINISHED', 'A'),
      game('Pool A · Round 1 · Game 2', 'POOL', 'C', 'D', 'READY'),
    ]
    const semis = [game('Semi-final 1', 'MAIN', null, null, 'PENDING'), game('Final', 'MAIN', null, null, 'PENDING')]
    const running = board({ format: 'POOL_TO_BRACKET', fixtures: [...pools, ...semis] })
    expect(myStatus(running, 'a1')).toEqual({ kind: 'WAITING_POOLS' })
    expect(myStatus(running, 'b1')).toEqual({ kind: 'WAITING_POOLS' })
    const resolved = board({
      format: 'POOL_TO_BRACKET',
      fixtures: [pools[0], { ...pools[1], status: 'FINISHED', winner: 'A' }, game('Semi-final 1', 'MAIN', 'A', 'C', 'READY'), semis[1]],
    })
    expect(myStatus(resolved, 'a1')).toEqual({ kind: 'NEXT_GAME', label: 'Semi-final 1' })
    expect(myStatus(resolved, 'b1')).toEqual({ kind: 'DONE' })
  })

  it('double elimination: one loss waits for its losers-bracket slot, two losses are out', () => {
    const fixtures = [
      game('Winners round 1 · Game 1', 'MAIN', 'A', 'B', 'FINISHED', 'A'),
      game('Winners round 1 · Game 2', 'MAIN', 'C', 'D', 'FINISHED', 'A'),
      game('Losers round 1 · Game 1', 'LOSERS', 'B', 'D', 'FINISHED', 'A'),
      game('Losers final', 'LOSERS', null, null, 'PENDING'),
      game('Winners final', 'MAIN', 'A', 'C', 'IN_PROGRESS'),
    ]
    const cup = board({ format: 'DOUBLE_ELIMINATION', fixtures })
    expect(myStatus(cup, 'a1')).toEqual({ kind: 'NEXT_GAME', label: 'Winners final' })
    expect(myStatus(cup, 'b1')).toEqual({ kind: 'WAITING_RESULTS' })
    expect(myStatus(cup, 'd1')).toEqual({ kind: 'DONE' })
    expect(myStatus(board({ format: 'DOUBLE_ELIMINATION', fixtures, phase: 'FINISHED' }), 'b1')).toEqual({ kind: 'DONE' })
  })

  it('single elimination: a bye is not a loss', () => {
    const cup = board({
      format: 'SINGLE_ELIMINATION',
      fixtures: [game('Quarter-final 1', 'MAIN', 'A', null, 'BYE', 'A'), game('Semi-final 1', 'MAIN', null, 'B', 'PENDING')],
    })
    expect(myStatus(cup, 'a1')).toEqual({ kind: 'WAITING_RESULTS' })
  })
})

describe('statusLine: the shared vocabulary', () => {
  it('uses one label per state', () => {
    expect(statusLine({ kind: 'PLAYING', court: 'Court 2' })).toBe('Playing · Court 2')
    expect(statusLine({ kind: 'UP_NEXT', court: 'Court 2' })).toBe('Up next · Court 2 · walk on now')
    expect(statusLine({ kind: 'NEXT_FOUR', court: 'Court 1' })).toBe('Next four · Court 1 · get ready')
    // An older server sent no court: the line still reads.
    expect(statusLine({ kind: 'NEXT_FOUR' })).toBe('Next four · get ready')
    expect(statusLine({ kind: 'WAITING' })).toBe('Waiting · order can change')
    expect(statusLine({ kind: 'BREAK' })).toBe('On break')
    expect(statusLine({ kind: 'NONE' })).toBeNull()
  })

  it('never promises a place in line', () => {
    for (const kind of ['WAITING', 'NEXT_FOUR']) expect(statusLine({ kind, place: 3 })).not.toMatch(/#|\d/)
  })

  // PB-REALTIME-02: on data that may be stale, nothing tells the player to walk on.
  it('drops the instruction and says "Last known" when freshness is unknown', () => {
    expect(statusLine({ kind: 'UP_NEXT', court: 'Court 2' }, { fresh: false, lastKnown: '10:42' })).toBe('Last known (10:42): Up next · Court 2')
    expect(statusLine({ kind: 'NEXT_FOUR', court: 'Court 1' }, { fresh: false, lastKnown: '10:42' })).toBe('Last known (10:42): Next four · Court 1')
    expect(statusLine({ kind: 'PLAYING', court: 'Court 1' }, { fresh: false, lastKnown: '10:42' })).toBe('Last known (10:42): Playing · Court 1')
  })
})

describe('statusText: the personal hello', () => {
  it('greets the player by first name in front of the shared line', () => {
    expect(statusText({ kind: 'WAITING' }, 'Ana Cruz')).toBe('Hi Ana. Waiting · order can change')
    expect(statusText({ kind: 'UP_NEXT', court: 'Court 2' }, 'Ana')).toBe('Hi Ana. Up next · Court 2 · walk on now')
    expect(statusText({ kind: 'PLAYING', court: 'Court 2' }, 'Ana')).toBe('Hi Ana. Playing · Court 2')
    expect(statusText({ kind: 'BREAK' }, '  Ana  ')).toBe('Hi Ana. On break')
    expect(statusText({ kind: 'NEXT_FOUR', court: 'Court 1' }, 'Ana')).toBe('Hi Ana. Next four · Court 1 · get ready')
  })

  it('prefixes the tournament statuses the same way', () => {
    expect(statusText({ kind: 'NEXT_GAME', label: 'Semi-final 1' }, 'Ben')).toBe('Hi Ben. Your next game: Semi-final 1')
    expect(statusText({ kind: 'WAITING_POOLS' }, 'Ben')).toBe('Hi Ben. Waiting for the pools to finish')
    expect(statusText({ kind: 'WAITING_RESULTS' }, 'Ben')).toBe('Hi Ben. Waiting for other results to set your next game')
    expect(statusText({ kind: 'DONE' }, 'Ben')).toBe('Hi Ben. Your games are done. Thanks for playing!')
  })

  it('has nothing to say when the player is not placed', () => {
    expect(statusText({ kind: 'NONE' }, 'Ana')).toBeNull()
  })
})

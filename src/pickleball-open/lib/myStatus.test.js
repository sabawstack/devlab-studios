// src/pickleball-open/lib/myStatus.test.js
import { describe, expect, it } from 'vitest'
import { myStatus } from './myStatus'

const viewer = {
  roster: [{ id: 'a', name: 'Ana' }, { id: 'b', name: 'Ben' }, { id: 'c', name: 'Cyd' }, { id: 'd', name: 'Dex' }],
  courts: [
    { label: 'Court 1', state: 'PLAYING', teamA: ['Ana', 'x'], teamB: ['y', 'z'] },
    { label: 'Court 3', state: 'UP_NEXT', teamA: ['Ben', 'x'], teamB: ['y', 'z'] },
  ],
  waiting: [{ id: 'q', name: 'Q' }, { id: 'c', name: 'Cyd' }],
  onBreak: [{ id: 'd', name: 'Dex' }],
}

describe('myStatus', () => {
  it('finds where a viewer is', () => {
    expect(myStatus(viewer, 'a')).toEqual({ kind: 'PLAYING', court: 'Court 1' })
    expect(myStatus(viewer, 'b')).toEqual({ kind: 'UP_NEXT', court: 'Court 3' })
    expect(myStatus(viewer, 'c')).toEqual({ kind: 'WAITING', place: 2 })
    expect(myStatus(viewer, 'd')).toEqual({ kind: 'BREAK' })
    expect(myStatus(viewer, 'zz')).toEqual({ kind: 'NONE' })
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

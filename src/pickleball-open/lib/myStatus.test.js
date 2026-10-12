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
    phase: 'RUNNING',
    pairs: [{ id: 'e1', playerIds: ['c', 'q'] }, { id: 'e2', playerIds: ['b', 'x'] }, { id: 'e3', playerIds: ['k', 'l'] }],
    fixtures: [
      { label: 'Semi-final 1', entrantAId: 'e1', entrantBId: 'e3', status: 'FINISHED' },
      { label: 'Final', entrantAId: 'e1', entrantBId: null, status: 'PENDING' },
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

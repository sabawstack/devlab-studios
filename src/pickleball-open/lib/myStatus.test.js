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

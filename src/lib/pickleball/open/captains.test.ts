// src/lib/pickleball/open/captains.test.ts
import { describe, expect, it } from 'vitest'
import type { OpenCommand } from '../../schemas/pickleball/open/commands'
import { captainLabel, captainRefusal, findCaptain } from './captains'
import { court, finished, sessionState } from './testing/fixtures'
import type { CaptainRecord, OpenMatch } from './types'

const captain: CaptainRecord = { id: 'cap1', label: 'Court 1 captain', courtId: 'c1', keyHash: 'hash-1', createdAt: '2026-10-11T10:00:00.000Z' }
const onC1: OpenMatch = { ...finished('m1', ['a', 'b'], ['c', 'd'], 'A', null, null), status: 'PROPOSED', winner: null, finishedAt: null, recordedBy: null }
const onC2: OpenMatch = { ...onC1, id: 'm2', courtId: 'c2' }
const state = sessionState({ courts: [court('c1', 1), court('c2', 2)], matches: [onC1, onC2] })

describe('captainRefusal', () => {
  it('lets a captain start, edit, skip and score their own court', () => {
    for (const command of [
      { type: 'START_MATCH', matchId: 'm1' },
      { type: 'SKIP_PROPOSAL', matchId: 'm1' },
      { type: 'EDIT_PROPOSAL', matchId: 'm1', teamA: ['a', 'b'], teamB: ['c', 'd'] },
      { type: 'RECORD_RESULT', matchId: 'm1', winner: 'A', scoreA: 11, scoreB: 2 },
      { type: 'UNDO_RESULT', matchId: 'm1' },
      { type: 'EDIT_RESULT', matchId: 'm1', winner: 'B', scoreA: 2, scoreB: 11 },
    ] satisfies OpenCommand[]) {
      expect(captainRefusal(command, captain, state), command.type).toBeNull()
    }
  })

  it('refuses another court', () => {
    expect(captainRefusal({ type: 'START_MATCH', matchId: 'm2' }, captain, state)).toBe('This captain link only runs Court 1.')
  })

  it('refuses every host-only command', () => {
    for (const command of [
      { type: 'END_SESSION' },
      { type: 'ADD_PLAYERS', names: ['Zed'] },
      { type: 'SET_MODE', mode: 'BALANCED' },
      { type: 'ABANDON_MATCH', matchId: 'm1' },
      { type: 'SET_PLAYER_STATUS', playerId: 'a', status: 'LEFT' },
      { type: 'ADD_RULE', rule: { kind: 'APART', playerIds: ['a', 'b'] } },
      { type: 'SET_SELF_CHECK_IN', enabled: false },
    ] satisfies OpenCommand[]) {
      expect(captainRefusal(command, captain, state), command.type).toBe('Only the host can do that.')
    }
  })
})

describe('captainLabel / findCaptain', () => {
  it('names links after their court and numbers a second one', () => {
    expect(captainLabel(state, 'c1', [])).toBe('Court 1 captain')
    expect(captainLabel(state, 'c1', [captain])).toBe('Court 1 captain 2')
    expect(captainLabel(state, 'c1', [], '  Maria\u0007 ')).toBe('Maria')
  })

  it('finds a captain by key hash only', () => {
    expect(findCaptain([captain], 'hash-1')).toBe(captain)
    expect(findCaptain([captain], 'hash-2')).toBeNull()
    expect(findCaptain([], 'hash-1')).toBeNull()
  })
})

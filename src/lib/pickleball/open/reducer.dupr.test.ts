import { describe, expect, it } from 'vitest'
import { commandSchema, type OpenCommand } from '../../schemas/pickleball/open/commands'
import { captainRefusal } from './captains'
import { applyCommand, finalizeCommand } from './reducer'
import { at, court, player, sessionState } from './testing/fixtures'
import type { CommandContext, OpenSessionState } from './types'

let n = 0
const ctx = (minute: number): CommandContext => ({ now: at(minute), newId: () => `n${(n += 1)}` })

function run(state: OpenSessionState, command: OpenCommand): OpenSessionState {
  const result = applyCommand(state, command, ctx(1))
  if (!result.ok) throw new Error(result.error)
  return finalizeCommand(result.state, ctx(1))
}

function fail(state: OpenSessionState, command: OpenCommand) {
  const result = applyCommand(state, command, ctx(1))
  if (result.ok) throw new Error('expected a failure')
  return result
}

const base = () => sessionState({
  courts: [court('c1', 1)],
  players: [player('a', { name: 'Ana', duprId: 'AAA111' }), player('b', { name: 'Ben' })],
})

describe('SET_PLAYER_DUPR_ID', () => {
  it('sets an uppercased ID, clears it with null, and works after the session ends', () => {
    const set = run(base(), { type: 'SET_PLAYER_DUPR_ID', playerId: 'b', duprId: 'bbb222' })
    expect(set.players.find((p) => p.id === 'b')?.duprId).toBe('BBB222')
    const ended = run(set, { type: 'END_SESSION' })
    const cleared = run(ended, { type: 'SET_PLAYER_DUPR_ID', playerId: 'b', duprId: null })
    expect(cleared.players.find((p) => p.id === 'b')?.duprId).toBeNull()
  })

  it('refuses an ID another player already has, and an unknown player', () => {
    expect(fail(base(), { type: 'SET_PLAYER_DUPR_ID', playerId: 'b', duprId: 'aaa111' })).toMatchObject({ status: 409, error: 'Ana already has DUPR ID AAA111.' })
    expect(fail(base(), { type: 'SET_PLAYER_DUPR_ID', playerId: 'zz', duprId: 'CCC333' }).status).toBe(404)
  })

  it('setting a player’s own ID again is allowed', () => {
    expect(run(base(), { type: 'SET_PLAYER_DUPR_ID', playerId: 'a', duprId: 'AAA111' }).players[0].duprId).toBe('AAA111')
  })

  it('accepts only 6 letters or digits', () => {
    expect(commandSchema.safeParse({ type: 'SET_PLAYER_DUPR_ID', playerId: 'a', duprId: ' ab12c3 ' }).success).toBe(true)
    for (const bad of ['AB12C', 'AB12C34', 'AB-12C', '']) {
      expect(commandSchema.safeParse({ type: 'SET_PLAYER_DUPR_ID', playerId: 'a', duprId: bad }).success, bad).toBe(false)
    }
  })

  it('is the host’s alone: a captain is refused', () => {
    const captain = { id: 'cap', label: 'Court 1 captain', courtId: 'c1', keyHash: 'h', createdAt: at(0) }
    expect(captainRefusal({ type: 'SET_PLAYER_DUPR_ID', playerId: 'b', duprId: 'BBB222' }, captain, base())).toBe('Only the host can do that.')
  })
})

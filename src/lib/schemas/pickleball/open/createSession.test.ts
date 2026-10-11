import { describe, expect, it } from 'vitest'
import { commandSchema } from './commands'
import { createSessionSchema } from './createSession'

const base = { name: 'Sunday', hostDisplayName: 'Mike', courtCount: 2, players: [] }

describe('createSessionSchema', () => {
  it('accepts all four stacking modes and an optional self check-in switch', () => {
    for (const mode of ['PADDLE_STACK', 'WINNERS_LOSERS', 'BY_STANDING', 'BALANCED']) {
      expect(createSessionSchema.safeParse({ ...base, settings: { mode, target: 11, scoringStyle: 'SIDEOUT' } }).success, mode).toBe(true)
    }
    expect(createSessionSchema.safeParse({ ...base, settings: { mode: 'BALANCED', target: 21, scoringStyle: 'RALLY', selfCheckIn: false } }).success).toBe(true)
    expect(createSessionSchema.safeParse({ ...base, settings: { mode: 'KING_OF_THE_COURT', target: 11, scoringStyle: 'SIDEOUT' } }).success).toBe(false)
  })
})

describe('commandSchema', () => {
  it('parses the Phase 2 commands and rejects bad shapes', () => {
    expect(commandSchema.safeParse({ type: 'SET_MODE', mode: 'BY_STANDING' }).success).toBe(true)
    expect(commandSchema.safeParse({ type: 'SET_MODE', mode: 'RANDOM' }).success).toBe(false)
    expect(commandSchema.safeParse({ type: 'ADD_RULE', rule: { kind: 'APART', playerIds: ['a', 'b'] } }).success).toBe(true)
    expect(commandSchema.safeParse({ type: 'ADD_RULE', rule: { kind: 'APART', playerIds: ['a'] } }).success).toBe(false)
    expect(commandSchema.safeParse({ type: 'SET_PLAYER_SKILL', playerId: 'a', skill: 9 }).success).toBe(false)
    expect(commandSchema.safeParse({ type: 'SET_SELF_CHECK_IN', enabled: false }).success).toBe(true)
  })
})

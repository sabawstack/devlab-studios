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

describe('tournament schemas (Phase 3)', () => {
  const settings = { mode: 'PADDLE_STACK', target: 11, scoringStyle: 'SIDEOUT' }

  it('a session can be a tournament with a format; a client that sends neither gets open play', () => {
    expect(createSessionSchema.safeParse({ ...base, settings, kind: 'TOURNAMENT', tournament: { format: 'POOL_TO_BRACKET' } }).success).toBe(true)
    expect(createSessionSchema.safeParse({ ...base, settings }).success).toBe(true)
    expect(createSessionSchema.safeParse({ ...base, settings, kind: 'LEAGUE' }).success).toBe(false)
    expect(createSessionSchema.safeParse({ ...base, settings, kind: 'TOURNAMENT', tournament: { format: 'SWISS' } }).success).toBe(false)
  })

  it('a tournament must send its format, and open play must not send one', () => {
    expect(createSessionSchema.safeParse({ ...base, settings, kind: 'TOURNAMENT' }).success).toBe(false)
    expect(createSessionSchema.safeParse({ ...base, settings, kind: 'OPEN_PLAY', tournament: { format: 'ROUND_ROBIN' } }).success).toBe(false)
    expect(createSessionSchema.safeParse({ ...base, settings, tournament: { format: 'ROUND_ROBIN' } }).success).toBe(false)
    expect(createSessionSchema.safeParse({ ...base, settings, kind: 'OPEN_PLAY' }).success).toBe(true)
  })

  it('parses the tournament commands and rejects bad shapes', () => {
    expect(commandSchema.safeParse({ type: 'GENERATE_DRAW', format: 'DOUBLE_ELIMINATION', pairing: 'BALANCED', seeding: 'BY_SKILL' }).success).toBe(true)
    expect(commandSchema.safeParse({ type: 'GENERATE_DRAW', format: 'ROUND_ROBIN', pairing: 'SNAKE', seeding: 'RANDOM' }).success).toBe(false)
    expect(commandSchema.safeParse({ type: 'EDIT_DRAW', edit: { kind: 'MOVE_PAIR', entrantId: 'e1', poolLabel: 'B' } }).success).toBe(true)
    expect(commandSchema.safeParse({ type: 'EDIT_DRAW', edit: { kind: 'MOVE_PAIR', entrantId: 'e1', poolLabel: 'Z' } }).success).toBe(false)
    expect(commandSchema.safeParse({ type: 'EDIT_DRAW', edit: { kind: 'SET_OPPONENT', fixtureId: 'f1', side: 'C', entrantId: 'e2' } }).success).toBe(false)
    expect(commandSchema.safeParse({ type: 'SWAP_OPPONENTS', fixtureId: 'f1', side: 'A', otherFixtureId: 'f2', otherSide: 'B' }).success).toBe(true)
    expect(commandSchema.safeParse({ type: 'SUBSTITUTE_PLAYER', entrantId: 'e1', outPlayerId: 'p1' }).success).toBe(false)
    expect(commandSchema.safeParse({ type: 'START_TOURNAMENT' }).success).toBe(true)
  })
})

import { describe, expect, it } from 'vitest'
import { applyCommand, finalizeCommand } from './reducer'
import { at, court, player, sessionState } from './testing/fixtures'
import type { OpenCommand } from '../../schemas/pickleball/open/commands'
import type { CommandContext, OpenSessionState } from './types'

let n = 0
const ctx = (minute: number, actor?: string): CommandContext => ({ now: at(minute), newId: () => `n${(n += 1)}`, actor })

function run(state: OpenSessionState, command: OpenCommand, minute = 1): OpenSessionState {
  const result = applyCommand(state, command, ctx(minute))
  if (!result.ok) throw new Error(result.error)
  return finalizeCommand(result.state, ctx(minute))
}

function fail(state: OpenSessionState, command: OpenCommand) {
  const result = applyCommand(state, command, ctx(1))
  if (result.ok) throw new Error('expected a failure')
  return result
}

function twoCourts(): OpenSessionState {
  const base = sessionState({
    courts: [court('c1', 1), court('c2', 2)],
    players: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].map((id, i) => player(id, { position: i })),
  })
  return finalizeCommand(base, ctx(0))
}

describe('SET_MODE', () => {
  it('changes the mode for the next proposal only: nothing proposed or playing is rewritten', () => {
    const start = twoCourts()
    const [first, second] = start.matches
    const started = run(start, { type: 'START_MATCH', matchId: first.id })
    const switched = run(started, { type: 'SET_MODE', mode: 'WINNERS_LOSERS' }, 2)
    expect(switched.settings.mode).toBe('WINNERS_LOSERS')
    expect(switched.matches.find((m) => m.id === first.id)).toMatchObject({ status: 'IN_PROGRESS', teamA: first.teamA, teamB: first.teamB })
    expect(switched.matches.find((m) => m.id === second.id)).toMatchObject({ status: 'PROPOSED', teamA: second.teamA, teamB: second.teamB })
    const saved = run(switched, { type: 'RECORD_RESULT', matchId: first.id, winner: 'A', scoreA: 11, scoreB: 3 }, 12)
    expect(saved.matches.filter((m) => m.status === 'PROPOSED')).toHaveLength(2)
  })
})

describe('keep-together / keep-apart rules', () => {
  it('adding a rule withdraws a proposal that breaks it, and the court is proposed again within the rule', () => {
    const start = twoCourts()
    const proposed = start.matches[0]
    const [x] = proposed.teamA
    const outsider = 'j'
    const next = run(start, { type: 'ADD_RULE', rule: { kind: 'TOGETHER', playerIds: [x, outsider] } })
    expect(next.matches.some((m) => m.id === proposed.id)).toBe(false)
    const withX = next.matches.find((m) => m.status === 'PROPOSED' && [...m.teamA, ...m.teamB].includes(x))
    expect(withX).toBeDefined()
    const team = withX!.teamA.includes(x) ? withX!.teamA : withX!.teamB
    expect(team).toContain(outsider)
  })

  it('refuses contradictions, second partners, players who left; a repeat is harmless', () => {
    const together = run(twoCourts(), { type: 'ADD_RULE', rule: { kind: 'TOGETHER', playerIds: ['a', 'b'] } })
    expect(fail(together, { type: 'ADD_RULE', rule: { kind: 'APART', playerIds: ['b', 'a'] } }).error).toBe('b and a already have the opposite rule. Remove it first.')
    expect(fail(together, { type: 'ADD_RULE', rule: { kind: 'TOGETHER', playerIds: ['a', 'c'] } }).error).toBe('a already has a keep-together partner.')
    expect(fail(together, { type: 'ADD_RULE', rule: { kind: 'APART', playerIds: ['c', 'c'] } }).status).toBe(400)
    const left = run(together, { type: 'SET_PLAYER_STATUS', playerId: 'j', status: 'LEFT' })
    expect(fail(left, { type: 'ADD_RULE', rule: { kind: 'APART', playerIds: ['c', 'j'] } }).error).toBe('j has left the session.')
    const again = applyCommand(together, { type: 'ADD_RULE', rule: { kind: 'TOGETHER', playerIds: ['b', 'a'] } }, ctx(2))
    expect(again.ok && again.state.settings.rules).toHaveLength(1)
  })

  it('a returning player re-activates their rules: a proposal that now breaks one is withdrawn and re-proposed', () => {
    const players = ['a', 'b', 'x', 'y', 'z', 'w'].map((id, i) => player(id, { position: i }))
    const together = run(finalizeCommand(sessionState({ players }), ctx(0)), { type: 'ADD_RULE', rule: { kind: 'TOGETHER', playerIds: ['a', 'b'] } })
    const onBreak = run(together, { type: 'SET_PLAYER_STATUS', playerId: 'b', status: 'BREAK' })
    const before = onBreak.matches.find((m) => m.status === 'PROPOSED')
    expect(before).toBeDefined()
    expect([...before!.teamA, ...before!.teamB]).toContain('a')
    expect([...before!.teamA, ...before!.teamB]).not.toContain('b')
    const back = run(onBreak, { type: 'SET_PLAYER_STATUS', playerId: 'b', status: 'ACTIVE' })
    expect(back.matches.some((m) => m.id === before!.id)).toBe(false)
    const again = back.matches.find((m) => m.status === 'PROPOSED')
    expect(again).toBeDefined()
    const team = again!.teamA.includes('a') ? again!.teamA : again!.teamB
    expect([...again!.teamA, ...again!.teamB]).toContain('a')
    expect(team).toContain('b')
  })

  it('removes a rule regardless of player order, and 404s an unknown one', () => {
    const apart = run(twoCourts(), { type: 'ADD_RULE', rule: { kind: 'APART', playerIds: ['a', 'b'] } })
    expect(run(apart, { type: 'REMOVE_RULE', rule: { kind: 'APART', playerIds: ['b', 'a'] } }).settings.rules).toEqual([])
    expect(fail(apart, { type: 'REMOVE_RULE', rule: { kind: 'TOGETHER', playerIds: ['a', 'b'] } }).status).toBe(404)
  })

  it('a host edit that breaks a rule is refused with the rule in words', () => {
    const oneCourt = finalizeCommand(sessionState({ players: ['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) => player(id, { position: i })) }), ctx(0))
    const start = run(oneCourt, { type: 'ADD_RULE', rule: { kind: 'APART', playerIds: ['a', 'b'] } })
    const match = start.matches.find((m) => m.status === 'PROPOSED')!
    const result = fail(start, { type: 'EDIT_PROPOSAL', matchId: match.id, teamA: ['a', 'b'], teamB: ['c', 'd'] })
    expect(result).toMatchObject({ status: 409, error: 'a and b are kept apart. Remove that rule first.' })
  })

  it('caps rules at 32 per session', () => {
    const many = Array.from({ length: 32 }, (_, i) => ({ kind: 'APART' as const, playerIds: [`x${i}`, `y${i}`] as const }))
    const full = { ...twoCourts(), settings: { ...twoCourts().settings, rules: many } }
    expect(fail(full, { type: 'ADD_RULE', rule: { kind: 'APART', playerIds: ['a', 'b'] } }).error).toBe('A session can have at most 32 rules.')
  })
})

describe('settings commands', () => {
  it('turns self check-in off and on, and sets a skill rounded to 2 decimals', () => {
    const off = run(twoCourts(), { type: 'SET_SELF_CHECK_IN', enabled: false })
    expect(off.settings.selfCheckIn).toBe(false)
    const skilled = run(off, { type: 'SET_PLAYER_SKILL', playerId: 'a', skill: 3.456 })
    expect(skilled.players.find((p) => p.id === 'a')?.skill).toBe(3.46)
    expect(run(skilled, { type: 'SET_PLAYER_SKILL', playerId: 'a', skill: null }).players.find((p) => p.id === 'a')?.skill).toBeNull()
    expect(fail(skilled, { type: 'SET_PLAYER_SKILL', playerId: 'zz', skill: 2 }).status).toBe(404)
  })
})

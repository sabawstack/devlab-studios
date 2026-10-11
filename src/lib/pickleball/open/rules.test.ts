// src/lib/pickleball/open/rules.test.ts
import { describe, expect, it } from 'vitest'
import { activeRules, keepsRules, NO_RULES, pickFour, ruleViolation } from './rules'
import { fillProposals, proposalBlocker, proposeForCourt } from './propose'
import { at, player, sessionState } from './testing/fixtures'
import { DEFAULT_SETTINGS, type OpenPlayer, type PairRule } from './types'

function withRules(rules: PairRule[], ids = ['a', 'b', 'c', 'd', 'e', 'f'], overrides: Record<string, Partial<OpenPlayer>> = {}) {
  return sessionState({
    settings: { ...DEFAULT_SETTINGS, rules },
    players: ids.map((id, i) => player(id, { position: i, ...overrides[id] })),
  })
}

describe('activeRules', () => {
  it('pairs keep-together partners only while both are active', () => {
    const rules: PairRule[] = [{ kind: 'TOGETHER', playerIds: ['a', 'b'] }, { kind: 'TOGETHER', playerIds: ['c', 'd'] }]
    const active = activeRules(withRules(rules, undefined, { d: { status: 'BREAK' } }))
    expect(active.partnerOf.get('a')).toBe('b')
    expect(active.partnerOf.get('b')).toBe('a')
    expect(active.partnerOf.has('c')).toBe(false)
  })
})

describe('pickFour', () => {
  const rules = (list: PairRule[]) => activeRules(withRules(list))

  it('takes the first four in order when no rule applies', () => {
    expect(pickFour(['a', 'b', 'c', 'd', 'e'], NO_RULES)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('brings a keep-together partner in at the first member’s place', () => {
    expect(pickFour(['a', 'b', 'c', 'e', 'f', 'd'], rules([{ kind: 'TOGETHER', playerIds: ['b', 'd'] }]))).toEqual(['a', 'b', 'd', 'c'])
  })

  it('never seats a keep-apart pair together', () => {
    expect(pickFour(['a', 'b', 'c', 'd', 'e'], rules([{ kind: 'APART', playerIds: ['a', 'c'] }]))).toEqual(['a', 'b', 'd', 'e'])
  })

  it('backtracks when the greedy choice leaves one seat for a pair', () => {
    // a + (b,c) leaves one seat that (d,e) cannot fill; (b,c) + (d,e) works.
    const list: PairRule[] = [{ kind: 'TOGETHER', playerIds: ['b', 'c'] }, { kind: 'TOGETHER', playerIds: ['d', 'e'] }]
    expect(pickFour(['a', 'b', 'c', 'd', 'e'], rules(list))).toEqual(['b', 'c', 'd', 'e'])
  })

  it('skips a player whose partner is busy, so they wait for them', () => {
    const list: PairRule[] = [{ kind: 'TOGETHER', playerIds: ['a', 'f'] }]
    expect(pickFour(['a', 'b', 'c', 'd', 'e'], rules(list))).toEqual(['b', 'c', 'd', 'e'])
  })

  it('returns null when no four keeps the rules', () => {
    expect(pickFour(['a', 'b', 'c', 'd'], rules([{ kind: 'APART', playerIds: ['a', 'b'] }]))).toBeNull()
  })

  it('Skip offers another four, or the same four when there is no other', () => {
    expect(pickFour(['a', 'b', 'c', 'd', 'e'], NO_RULES, ['a', 'b', 'c', 'd'])).toEqual(['a', 'b', 'c', 'e'])
    expect(pickFour(['a', 'b', 'c', 'd'], NO_RULES, ['a', 'b', 'c', 'd'])).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('keepsRules / ruleViolation', () => {
  it('names the rule a host edit would break', () => {
    const state = withRules([{ kind: 'TOGETHER', playerIds: ['a', 'b'] }, { kind: 'APART', playerIds: ['c', 'd'] }])
    expect(ruleViolation(['a', 'c'], ['b', 'e'], state)).toBe('a and b always play together. Remove that rule first.')
    expect(ruleViolation(['a', 'b'], ['c', 'd'], state)).toBe('c and d are kept apart. Remove that rule first.')
    expect(ruleViolation(['a', 'b'], ['c', 'e'], state)).toBeNull()
    expect(keepsRules(['a', 'b'], ['c', 'e'], activeRules(state))).toBe(true)
  })
})

describe('proposals with rules', () => {
  it('a player whose keep-together partner is on break still plays', () => {
    const state = withRules([{ kind: 'TOGETHER', playerIds: ['a', 'b'] }], ['a', 'b', 'c', 'd', 'e'], { b: { status: 'BREAK' } })
    const p = proposeForCourt(state)!
    expect([...p.teamA, ...p.teamB].sort()).toEqual(['a', 'c', 'd', 'e'])
  })

  it('leaves the court unproposed, with a reason, rather than break a rule', () => {
    const state = withRules([{ kind: 'APART', playerIds: ['a', 'b'] }, { kind: 'APART', playerIds: ['c', 'd'] }], ['a', 'b', 'c', 'd'])
    const filled = fillProposals(state, { now: at(1), newId: () => 'm1' })
    expect(filled.matches).toHaveLength(0)
    expect(proposalBlocker(filled)).toMatch(/keep-together and keep-apart rules/)
    expect(proposalBlocker(withRules([], ['a', 'b', 'c']))).toBeNull()
  })
})

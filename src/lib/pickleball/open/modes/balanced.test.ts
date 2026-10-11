// src/lib/pickleball/open/modes/balanced.test.ts
import { describe, expect, it } from 'vitest'
import { pairKey } from '../fairness'
import { proposeForCourt } from '../propose'
import { finished, player, sessionState } from '../testing/fixtures'
import { DEFAULT_SETTINGS } from '../types'
import { NEUTRAL_STRENGTH, strength } from './balanced'

const settings = { ...DEFAULT_SETTINGS, mode: 'BALANCED' as const }
const team = (p: { teamA: readonly string[]; teamB: readonly string[] }, id: string) => (p.teamA.includes(id) ? p.teamA : p.teamB)

describe('balanced', () => {
  it('uses the entered skill, then today’s win rate on a 1–5 scale, then neutral', () => {
    expect(strength(player('a', { skill: 4.5 }), undefined)).toBe(4.5)
    const row = { winRate: 0.75 } as Parameters<typeof strength>[1]
    expect(strength(player('b'), row)).toBe(4)
    expect(strength(player('c'), undefined)).toBe(NEUTRAL_STRENGTH)
  })

  it('pairs the strongest with the weakest so the summed skills are closest', () => {
    const state = sessionState({
      settings,
      players: [player('s5', { skill: 5, position: 1 }), player('s4', { skill: 4, position: 2 }), player('s2', { skill: 2, position: 3 }), player('s1', { skill: 1, position: 4 })],
    })
    expect([...team(proposeForCourt(state)!, 's5')].sort()).toEqual(['s1', 's5'])
  })

  it('breaks a tie in balance by avoiding a repeated partnership', () => {
    const state = sessionState({
      settings,
      players: ['a', 'b', 'c', 'd'].map((id, i) => player(id, { skill: 3, position: i })),
      matches: [finished('m1', ['a', 'b'], ['c', 'd'], 'A', 11, 4), finished('m2', ['a', 'c'], ['b', 'd'], 'A', 11, 4, 20)],
    })
    const p = proposeForCourt(state)!
    expect([pairKey(...p.teamA), pairKey(...p.teamB)].sort()).toEqual([pairKey('a', 'd'), pairKey('b', 'c')].sort())
  })

  it('a keep-together pair is kept even when another split balances better', () => {
    const state = sessionState({
      settings: { ...settings, rules: [{ kind: 'TOGETHER', playerIds: ['s5', 's4'] }] },
      players: [player('s5', { skill: 5, position: 1 }), player('s4', { skill: 4, position: 2 }), player('s2', { skill: 2, position: 3 }), player('s1', { skill: 1, position: 4 })],
    })
    expect([...team(proposeForCourt(state)!, 's5')].sort()).toEqual(['s4', 's5'])
  })
})

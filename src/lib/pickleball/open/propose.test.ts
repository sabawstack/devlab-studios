import { describe, expect, it } from 'vitest'
import { fillProposals, proposeForCourt } from './propose'
import { pairingHistory } from './fairness'
import { splitTeams } from './modes/paddleStack'
import { at, court, finished, player, sessionState } from './testing/fixtures'
import type { OpenSessionState, CommandContext } from './types'

function ctxAt(minute: number): CommandContext {
  let n = 0
  return { now: at(minute), newId: () => `id-${minute}-${(n += 1)}` }
}

describe('splitTeams', () => {
  it('never re-pairs earlier partners when another split avoids it', () => {
    const history = pairingHistory([finished('m1', ['A', 'B'], ['C', 'D'], 'A', 11, 5)])
    const { teamA, teamB } = splitTeams(['A', 'B', 'C', 'D'], history)
    expect(teamA.join('') === 'AB' || teamB.join('') === 'AB').toBe(false)
    expect(teamA.join('') === 'CD' || teamB.join('') === 'CD').toBe(false)
  })

  it('prefers the only partner-free split even when it has far more opponent repeats', () => {
    const history = pairingHistory([
      finished('p1', ['A', 'B'], ['X', 'Y'], 'A', 11, 5),
      finished('p2', ['C', 'D'], ['X', 'Y'], 'A', 11, 5),
      finished('p3', ['A', 'C'], ['X', 'Y'], 'A', 11, 5),
      ...Array.from({ length: 150 }, (_, i) => finished(`o${i}`, ['A', 'X'], ['B', 'Y'], 'A', 11, 5)),
      ...Array.from({ length: 150 }, (_, i) => finished(`q${i}`, ['D', 'X'], ['C', 'Y'], 'A', 11, 5)),
    ])
    const { teamA, teamB } = splitTeams(['A', 'B', 'C', 'D'], history)
    const teams = [teamA.join(''), teamB.join('')].map((t) => t.split('').sort().join('')).sort()
    expect(teams).toEqual(['AD', 'BC'])
  })
})

describe('proposeForCourt / fillProposals', () => {
  it('fills every free enabled court and leaves busy courts alone', () => {
    const state = sessionState({
      courts: [court('c1', 1), court('c2', 2), court('c3', 3, false)],
      players: Array.from({ length: 10 }, (_, i) => player(`p${i}`, { position: i })),
    })
    const next = fillProposals(state, ctxAt(1))
    expect(next.matches.map((m) => m.courtId)).toEqual(['c1', 'c2'])
    expect(new Set(next.matches.flatMap((m) => [...m.teamA, ...m.teamB])).size).toBe(8)
    expect(fillProposals(next, ctxAt(2)).matches).toHaveLength(2)
  })

  it('proposes nothing with fewer than 4 available players, or once the session ended', () => {
    const three = sessionState({ players: ['a', 'b', 'c'].map((id) => player(id)) })
    expect(proposeForCourt(three)).toBeNull()
    const ended = sessionState({ status: 'ENDED', players: ['a', 'b', 'c', 'd'].map((id) => player(id)) })
    expect(proposeForCourt(ended)).toBeNull()
  })

  it('skipping a proposal offers a different four when possible', () => {
    const state = sessionState({ players: ['a', 'b', 'c', 'd', 'e'].map((id, i) => player(id, { position: i })) })
    const first = proposeForCourt(state)!
    const four = [...first.teamA, ...first.teamB]
    const second = proposeForCourt(state, four)!
    expect([...second.teamA, ...second.teamB].sort()).not.toEqual([...four].sort())
  })

  it('never seats a player on break or who left', () => {
    const state = sessionState({
      players: [player('a'), player('b'), player('c'), player('d', { status: 'BREAK' }), player('e', { status: 'LEFT' }), player('f')],
    })
    const p = proposeForCourt(state)!
    expect([...p.teamA, ...p.teamB].sort()).toEqual(['a', 'b', 'c', 'f'])
  })
})

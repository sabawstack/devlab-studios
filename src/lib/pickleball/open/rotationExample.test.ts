// src/lib/pickleball/open/rotationExample.test.ts
import { describe, expect, it } from 'vitest'
import { rotationExample } from './rotationExample'
import type { StackingMode } from './types'

describe('rotationExample', () => {
  it.each<StackingMode>(['PADDLE_STACK', 'WINNERS_LOSERS', 'BY_STANDING', 'BALANCED'])(
    '%s: 14 players on 3 courts, 12 play each round, 2 sit out, nobody sits out twice in a row',
    (mode) => {
      const rounds = rotationExample(4, mode)
      expect(rounds).toHaveLength(4)
      for (const round of rounds) {
        expect(round.courts).toHaveLength(3)
        expect(round.sittingOut).toHaveLength(2)
      }
      for (let i = 1; i < rounds.length; i += 1) {
        for (const name of rounds[i].sittingOut) expect(rounds[i - 1].sittingOut).not.toContain(name)
      }
    },
  )

  it('winners play winners: round 2 has a court of four round-1 winners, previous partners split', () => {
    const [first, second] = rotationExample(2, 'WINNERS_LOSERS')
    const winningTeams = first.courts.map((c) => (c.winner === 'A' ? c.teamA : c.teamB))
    const winners = new Set(winningTeams.flat())
    const allWinners = second.courts.find((c) => [...c.teamA, ...c.teamB].every((name) => winners.has(name)))
    expect(allWinners).toBeDefined()
    for (const pair of winningTeams) {
      expect([allWinners!.teamA, allWinners!.teamB].some((t) => pair.every((name) => t.includes(name)))).toBe(false)
    }
  })
})

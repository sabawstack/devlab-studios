// src/lib/pickleball/open/modes/modes.property.test.ts
import { describe, expect, it } from 'vitest'
import { pairKey } from '../fairness'
import { simulate } from '../testing/simulate'
import type { PairRule, StackingMode } from '../types'

// Each mode task appends its mode here.
const MODES: StackingMode[] = ['PADDLE_STACK']

describe('paddle stack (property)', () => {
  it.each([[5, 1], [12, 1], [14, 3], [20, 2], [24, 2], [40, 4], [96, 8]])(
    'with %i players on %i courts, games played never spread by more than 1 after each round',
    (players, courts) => {
      for (const seed of [1, 2, 3]) {
        const { state } = simulate({ players, courts, rounds: 30, seed })
        const games = state.players.map((p) => state.matches.filter((m) => m.status === 'FINISHED' && (m.teamA.includes(p.id) || m.teamB.includes(p.id))).length)
        expect(Math.max(...games) - Math.min(...games)).toBeLessThanOrEqual(1)
      }
    },
    30_000,
  )
})

describe.each(MODES)('%s (property)', (mode) => {
  it.each([[5, 1], [8, 2], [12, 1], [14, 3], [20, 2], [24, 2], [40, 4], [96, 8]])(
    'with %i players on %i courts nobody is on two courts at once',
    (players, courts) => {
      for (const seed of [1, 2, 3]) {
        for (const round of simulate({ players, courts, rounds: 20, seed, mode, skills: true }).rounds) {
          const seated = round.flatMap((m) => [...m.teamA, ...m.teamB])
          expect(new Set(seated).size).toBe(seated.length)
        }
      }
    },
    30_000,
  )

  it.each([[12, 1], [14, 3], [24, 2], [36, 3], [96, 8]])(
    'with ≤ 12 players per court (%i on %i), nobody sits out more than 2 rounds in a row',
    (players, courts) => {
      for (const seed of [1, 2, 3, 4, 5]) {
        expect(simulate({ players, courts, rounds: 30, seed, mode, skills: true }).maxSatOut).toBeLessThanOrEqual(2)
      }
    },
    30_000,
  )

  it('never breaks a keep-together or keep-apart rule, and nobody is starved', () => {
    const rules: PairRule[] = [
      { kind: 'TOGETHER', playerIds: ['p0', 'p1'] },
      { kind: 'TOGETHER', playerIds: ['p4', 'p7'] },
      { kind: 'APART', playerIds: ['p2', 'p3'] },
      { kind: 'APART', playerIds: ['p0', 'p5'] },
      { kind: 'APART', playerIds: ['p7', 'p9'] },
    ]
    for (const seed of [1, 2, 3, 4]) {
      const { rounds } = simulate({ players: 14, courts: 3, rounds: 25, seed, mode, rules })
      for (const match of rounds.flat()) {
        const four = [...match.teamA, ...match.teamB]
        for (const rule of rules) {
          const [a, b] = rule.playerIds
          if (rule.kind === 'APART') expect(four.includes(a) && four.includes(b), `${a} and ${b} on one court`).toBe(false)
          else if (four.includes(a) || four.includes(b)) {
            const team = match.teamA.includes(a) ? match.teamA : match.teamB
            expect(team.includes(b), `${a} without ${b}`).toBe(true)
          }
        }
      }
      const games = new Map<string, number>()
      for (const match of rounds.flat()) for (const id of [...match.teamA, ...match.teamB]) games.set(id, (games.get(id) ?? 0) + 1)
      expect(games.size).toBe(14)
    }
  })

  // Balanced deliberately ranks skill balance above partner rotation (spec §5.2:
  // repeated partners only break ties), so it has no repeat bound here.
  it.runIf(mode !== 'BALANCED')('partners repeat only rarely over a long session', () => {
    const { rounds } = simulate({ players: 16, courts: 2, rounds: 12, seed: 9, mode, skills: true })
    const counts = new Map<string, number>()
    for (const m of rounds.flat()) for (const team of [m.teamA, m.teamB]) counts.set(pairKey(...team), (counts.get(pairKey(...team)) ?? 0) + 1)
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(mode === 'BY_STANDING' ? 3 : 2)
  })
})

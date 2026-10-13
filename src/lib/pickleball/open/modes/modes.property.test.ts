// src/lib/pickleball/open/modes/modes.property.test.ts
import { describe, expect, it } from 'vitest'
import { pairKey } from '../fairness'
import { mulberry32, simulate } from '../testing/simulate'
import type { OpenMatch, PairRule, StackingMode } from '../types'

// Each mode task appends its mode here.
const MODES: StackingMode[] = ['PADDLE_STACK', 'WINNERS_LOSERS', 'BY_STANDING', 'BALANCED']

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

describe('paddle stack partner rotation (property)', () => {
  it('8 players on 2 courts repeat a partnership at most twice over 6 rounds', () => {
    const { rounds } = simulate({ players: 8, courts: 2, rounds: 6, seed: 7 })
    const counts = new Map<string, number>()
    for (const m of rounds.flat()) for (const team of [m.teamA, m.teamB]) counts.set(pairKey(...team), (counts.get(pairKey(...team)) ?? 0) + 1)
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(2)
  })
})

/** 40 random sessions: 5–60 players on 1–16 courts (seeded, so a failure is reproducible). */
const SESSIONS = (() => {
  const random = mulberry32(2026)
  return Array.from({ length: 40 }, (_, i) => ({ players: 5 + Math.floor(random() * 56), courts: 1 + Math.floor(random() * 16), seed: 100 + i }))
})()

describe.each(MODES)('%s fair rotation (property)', (mode) => {
  it('games played never spread by more than 1, and nobody with more games is seated while someone with fewer waits', () => {
    for (const { players, courts, seed } of SESSIONS) {
      const result = simulate({ players, courts, rounds: 20, seed, mode, skills: true })
      const label = `${players} players on ${courts} courts, seed ${seed}`
      expect(result.maxSpread, label).toBeLessThanOrEqual(1)
      expect(result.unfairRounds, label).toBe(0)
      for (const round of result.rounds) {
        const seated = round.flatMap((m) => [...m.teamA, ...m.teamB])
        expect(new Set(seated).size, label).toBe(seated.length)
      }
    }
  }, 60_000)
})

/** W–W, L–L or mixed, from each player's previous result. */
type GameKind = 'W' | 'L' | 'x'

/** Each finished game in order: W (four winners), L (four losers) or x (mixed), from each player's previous result. */
function gameKinds(matches: readonly OpenMatch[]): GameKind[] {
  const finished = [...matches].filter((m) => m.status === 'FINISHED').sort((a, b) => a.seq - b.seq)
  const lastTag = new Map<string, 'W' | 'L'>()
  return finished.map((m) => {
    const tags = [...m.teamA, ...m.teamB].map((id) => lastTag.get(id))
    for (const id of m.teamA) lastTag.set(id, m.winner === 'A' ? 'W' : 'L')
    for (const id of m.teamB) lastTag.set(id, m.winner === 'B' ? 'W' : 'L')
    return tags.every((t) => t === 'W') ? 'W' : tags.every((t) => t === 'L') ? 'L' : 'x'
  })
}

describe('winners play winners at every player count (owner report)', () => {
  // cycle = rounds for everyone to play once; sitting out cycle - 1 rounds is
  // unavoidable, and winners mode may add one round (never below 3).
  it.each([[12, 1], [14, 1], [16, 1], [20, 1], [32, 2], [48, 3]])(
    '%i players on %i courts, 30 rounds a court: losers never fall behind, and winners and losers games both happen',
    (players, courts) => {
      const cycle = Math.ceil(players / (4 * courts))
      for (const seed of [1, 2, 3, 4, 5]) {
        const { state, maxSpread, unfairRounds, maxSatOut } = simulate({ players, courts, rounds: 30, seed, mode: 'WINNERS_LOSERS' })
        expect(maxSpread).toBeLessThanOrEqual(1)
        expect(unfairRounds).toBe(0)
        expect(maxSatOut).toBeLessThanOrEqual(Math.max(3, cycle))
        const kinds = gameKinds(state.matches)
        expect(kinds.filter((k) => k === 'W').length).toBeGreaterThan(0)
        expect(kinds.filter((k) => k === 'L').length).toBeGreaterThan(0)
      }
    },
    30_000,
  )

  it('12 players on 1 court alternate: a winners game and a losers game between every mixed game', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const kinds = gameKinds(simulate({ players: 12, courts: 1, rounds: 30, seed, mode: 'WINNERS_LOSERS' }).state.matches)
      // The first three games are everyone's first; after that no two mixed games run back to back.
      expect(kinds.slice(3).join('')).not.toContain('xx')
      expect(kinds.slice(3).join('')).toMatch(/^(WLx)+(W|WL)?$/)
    }
  })
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

  // Winners play winners lets a winners or losers game go ahead of a player
  // forced after 2 rounds in the same games tier (at 12 players a court the
  // guard would otherwise freeze the same four together for the whole
  // session); a player out for 3 rounds is always seated, so its bound is 3.
  const sitOutBound = mode === 'WINNERS_LOSERS' ? 3 : 2
  it.each([[12, 1], [14, 3], [24, 2], [36, 3], [96, 8]])(
    `with ≤ 12 players per court (%i on %i), nobody sits out more than ${sitOutBound} rounds in a row`,
    (players, courts) => {
      for (const seed of [1, 2, 3, 4, 5]) {
        expect(simulate({ players, courts, rounds: 30, seed, mode, skills: true }).maxSatOut).toBeLessThanOrEqual(sitOutBound)
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
          else {
            expect(four.includes(a), `${a} and ${b} not both present`).toBe(four.includes(b))
            if (four.includes(a)) expect(match.teamA.includes(a) ? match.teamA.includes(b) : match.teamB.includes(b), `${a} without ${b}`).toBe(true)
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

// src/lib/pickleball/open/testing/simulate.ts
// Test-only. Plays synchronous rounds through the real engine: every free
// court is proposed, every court starts, every court finishes with a random
// valid score. Never imported by application code.
import { fillProposals } from '../propose'
import { at, court, player, sessionState } from './fixtures'
import type { CommandContext, OpenMatch, OpenSessionState, PairRule, StackingMode } from '../types'

/** Deterministic PRNG so a failure is reproducible from its seed. */
export function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function ctxAt(minute: number): CommandContext {
  let n = 0
  return { now: at(minute), newId: () => `id-${minute}-${(n += 1)}` }
}

export interface SimulationOptions {
  players: number
  courts: number
  rounds: number
  seed: number
  mode?: StackingMode
  rules?: readonly PairRule[]
  /** Give players skills 1–5 in turn (for balanced teams). */
  skills?: boolean
}

export interface SimulationResult {
  state: OpenSessionState
  /** Most consecutive rounds any available player sat out. */
  maxSatOut: number
  /** Every round's games, as started. */
  rounds: OpenMatch[][]
}

export function simulate({ players, courts, rounds, seed, mode = 'PADDLE_STACK', rules = [], skills = false }: SimulationOptions): SimulationResult {
  const random = mulberry32(seed)
  let state: OpenSessionState = sessionState({
    settings: { mode, target: 11, scoringStyle: 'SIDEOUT', selfCheckIn: true, rules },
    courts: Array.from({ length: courts }, (_, i) => court(`c${i}`, i + 1)),
    players: Array.from({ length: players }, (_, i) => player(`p${i}`, { position: i, skill: skills ? 1 + (i % 5) : null })),
  })
  let minute = 0
  let maxSatOut = 0
  const played: OpenMatch[][] = []
  const streak = new Map(state.players.map((p) => [p.id, 0]))
  for (let round = 0; round < rounds; round += 1) {
    minute += 1
    state = fillProposals(state, ctxAt(minute))
    minute += 1
    state = {
      ...state,
      matches: state.matches.map((m): OpenMatch => (m.status === 'PROPOSED' ? { ...m, status: 'IN_PROGRESS', startedAt: at(minute) } : m)),
    }
    const live = state.matches.filter((m) => m.status === 'IN_PROGRESS')
    played.push(live)
    const playing = new Set(live.flatMap((m) => [...m.teamA, ...m.teamB]))
    for (const p of state.players) {
      const next = playing.has(p.id) ? 0 : (streak.get(p.id) ?? 0) + 1
      streak.set(p.id, next)
      maxSatOut = Math.max(maxSatOut, next)
    }
    minute += 10
    state = {
      ...state,
      matches: state.matches.map((m): OpenMatch => {
        if (m.status !== 'IN_PROGRESS') return m
        const winner = random() < 0.5 ? 'A' : 'B'
        const loser = Math.floor(random() * 10)
        return {
          ...m, status: 'FINISHED', winner, finishedAt: at(minute), recordedBy: 'Host',
          scoreA: winner === 'A' ? 11 : loser, scoreB: winner === 'B' ? 11 : loser,
        }
      }),
      players: state.players.map((p) => (playing.has(p.id) ? { ...p, waitingSince: at(minute) } : p)),
    }
  }
  return { state, maxSatOut, rounds: played }
}

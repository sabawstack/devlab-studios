// src/lib/pickleball/open/testing/reducerSim.ts
// Test-only. Plays a session through the REAL command path: every change is
// an OpenCommand through applyCommand + finalizeCommand, exactly as the
// Durable Object runs it (simulate.ts calls fillProposals directly and skips
// the reducer). Games last different times, so courts free one at a time, as
// they do at a club. Never imported by application code.
import type { OpenCommand } from '../../../schemas/pickleball/open/commands'
import { applyCommand, finalizeCommand } from '../reducer'
import { at, court, player, sessionState } from './fixtures'
import { mulberry32 } from './simulate'
import type { CommandContext, OpenMatch, OpenSessionState, PairRule, Side, StackingMode } from '../types'

export interface DriverOptions {
  players: number
  courts: number
  mode: StackingMode
  seed: number
  rules?: readonly PairRule[]
  skills?: boolean
  /** Name prefix, so a long-name run can be built. */
  names?: (i: number) => string
}

export interface Driver {
  state: OpenSessionState
  /** Minutes since the session started; every command moves it forward. */
  minute: number
  random: () => number
  /** Applies one command at the current time; returns false when the reducer refused it. */
  run: (command: OpenCommand, advance?: number) => boolean
}

let idCounter = 0

export function ctxFor(minute: number): CommandContext {
  return { now: at(minute), newId: () => `m${(idCounter += 1)}`, actor: 'Host', random: (n: number) => Math.floor(Math.random() * n) }
}

/** Applies a command the way the Durable Object does: applyCommand, then finalizeCommand on success. */
export function step(state: OpenSessionState, command: OpenCommand, minute: number): OpenSessionState | null {
  const ctx = ctxFor(minute)
  const result = applyCommand(state, command, ctx)
  return result.ok ? finalizeCommand(result.state, ctx) : null
}

export function createDriver({ players, courts, mode, seed, rules = [], skills = false, names }: DriverOptions): Driver {
  const random = mulberry32(seed)
  const start = sessionState({
    settings: { mode, target: 11, scoringStyle: 'SIDEOUT', selfCheckIn: true, rules, announcement: '', endedAt: null },
    courts: Array.from({ length: courts }, (_, i) => court(`c${i}`, i + 1)),
    players: Array.from({ length: players }, (_, i) => player(`p${i}`, { name: names ? names(i) : `p${i}`, position: i, skill: skills ? 1 + (i % 5) : null })),
  })
  const driver: Driver = {
    // The session as the create route leaves it: proposals already made.
    state: finalizeCommand(start, ctxFor(0)),
    minute: 0,
    random,
    run(command, advance = 1) {
      driver.minute += advance
      const next = step(driver.state, command, driver.minute)
      if (!next) return false
      driver.state = next
      return true
    },
  }
  return driver
}

/** A valid final score for a game to `target`: sudden death most of the time, sometimes a deuce game. */
export function randomScore(random: () => number, target = 11): { winner: Side; scoreA: number; scoreB: number } {
  const winner: Side = random() < 0.5 ? 'A' : 'B'
  let win = target
  let lose = Math.floor(random() * target)
  if (random() < 0.15) {
    lose = target - 1 + Math.floor(random() * 4)
    win = lose + 2
  }
  return winner === 'A' ? { winner, scoreA: win, scoreB: lose } : { winner, scoreA: lose, scoreB: win }
}

/** Every valid final score for one winner, from the extremes inwards (for the property test). */
export function scoresFor(winner: Side, target = 11): Array<{ winner: Side; scoreA: number; scoreB: number }> {
  const finals: Array<[number, number]> = [[target, 0], [target, target - 1], [target, Math.floor(target / 2)], [target + 1, target - 1], [target + 5, target + 3]]
  return finals.map(([win, lose]) => (winner === 'A' ? { winner, scoreA: win, scoreB: lose } : { winner, scoreA: lose, scoreB: win }))
}

export const ids = (m: OpenMatch) => [...m.teamA, ...m.teamB]
export const setKey = (list: readonly string[]) => [...list].sort().join('|')

/**
 * The game that finishes next. Each started game is given a length when it
 * starts (8 to 16 minutes), so courts free one at a time.
 */
export class Clock {
  private ends = new Map<string, number>()
  constructor(private random: () => number) {}

  track(state: OpenSessionState, minute: number): void {
    for (const m of state.matches) {
      if (m.status === 'IN_PROGRESS' && !this.ends.has(m.id)) this.ends.set(m.id, minute + 8 + Math.floor(this.random() * 9))
    }
  }

  next(state: OpenSessionState): { match: OpenMatch; end: number } | null {
    let best: { match: OpenMatch; end: number } | null = null
    for (const m of state.matches) {
      if (m.status !== 'IN_PROGRESS') continue
      const end = this.ends.get(m.id) ?? Infinity
      if (!best || end < best.end) best = { match: m, end }
    }
    return best
  }
}

/** Starts every proposed game (players walk on as soon as they are called). */
export function startAll(driver: Driver): void {
  for (const m of driver.state.matches.filter((x) => x.status === 'PROPOSED')) driver.run({ type: 'START_MATCH', matchId: m.id }, 0)
}

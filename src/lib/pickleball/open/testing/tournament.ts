// src/lib/pickleball/open/testing/tournament.ts
// Test-only tournament builders. Never imported by application code.
import type { OpenCommand } from '../../../schemas/pickleball/open/commands'
import { applyCommand, finalizeCommand } from '../reducer'
import { emptyTournament, type RandomInt, type TournamentFormat } from '../tournament/types'
import type { CommandContext, OpenSessionState } from '../types'
import { at, court, player, sessionState } from './fixtures'

export const NAMES = ['Ana', 'Ben', 'Cy', 'Di', 'Eva', 'Fin', 'Gus', 'Hal', 'Ivy', 'Jo', 'Kai', 'Lu', 'Max', 'Ned', 'Oz', 'Pia', 'Quin', 'Rae', 'Sol', 'Tex']

/** Deterministic stand-in for crypto randomness: always picks the first option. */
export const firstPick: RandomInt = () => 0

/** A tournament session in SETUP with `count` players (skills 5,4,3,2,1 repeating) on `courts` courts. */
export function tournamentSession(count: number, courts = 2, format: TournamentFormat = 'ROUND_ROBIN'): OpenSessionState {
  return sessionState({
    kind: 'TOURNAMENT',
    courts: Array.from({ length: courts }, (_, i) => court(`c${i + 1}`, i + 1)),
    players: Array.from({ length: count }, (_, i) => player(`p${i + 1}`, { name: NAMES[i] ?? `P${i + 1}`, position: i + 1, skill: 5 - (i % 5) })),
    tournament: emptyTournament(format),
  })
}

export function makeCtx(): (minute: number) => CommandContext {
  let n = 0
  return (minute) => ({ now: at(minute), newId: () => `t${(n += 1)}`, random: firstPick })
}

/** Runs one command through the reducer exactly as the Durable Object does; throws on refusal. */
export function run(state: OpenSessionState, command: OpenCommand, ctx: CommandContext): OpenSessionState {
  const result = applyCommand(state, command, ctx)
  if (!result.ok) throw new Error(`${command.type}: ${result.error}`)
  return finalizeCommand(result.state, ctx)
}

/** The refusal text, or null if the command was accepted. */
export function refusal(state: OpenSessionState, command: OpenCommand, ctx: CommandContext): string | null {
  const result = applyCommand(state, command, ctx)
  return result.ok ? null : result.error
}

/** Starts and saves every proposed game, side A winning 11–(5 + seq % 5), until nothing is left to play. */
export function playOut(start: OpenSessionState, ctx: (minute: number) => CommandContext, fromMinute = 10): OpenSessionState {
  let state = start
  let minute = fromMinute
  for (let guard = 0; guard < 500; guard += 1) {
    const next = state.matches.find((m) => m.status === 'PROPOSED' || m.status === 'IN_PROGRESS')
    if (!next) return state
    minute += 1
    if (next.status === 'PROPOSED') state = run(state, { type: 'START_MATCH', matchId: next.id }, ctx(minute))
    minute += 1
    state = run(state, { type: 'RECORD_RESULT', matchId: next.id, winner: 'A', scoreA: 11, scoreB: 5 + (next.seq % 5) }, ctx(minute))
  }
  throw new Error('playOut did not finish')
}

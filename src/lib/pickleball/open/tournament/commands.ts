// src/lib/pickleball/open/tournament/commands.ts
// The tournament commands and the draw side of every game command. The
// reducer stays the one entry point (spec §3.4); it hands tournament work here.
import type { OpenCommand } from '../../../schemas/pickleball/open/commands'
import type { CommandResult } from '../reducer'
import { LIMITS, type CommandContext, type OpenMatch, type OpenSessionState } from '../types'
import { generateDraw, unpairedPlayers } from './draw'
import { applyDraftEdit, applyRunningEdit } from './drawEdits'
import { drawViolation } from './drawRules'
import { editFixtureResult, fixtureAbandoned, fixtureFinished, fixtureStarted, reopenFixture } from './progress'
import type { EditResult, TournamentState } from './types'

export type TournamentCommand = Extract<OpenCommand, { type: 'GENERATE_DRAW' | 'EDIT_DRAW' | 'START_TOURNAMENT' | 'SUBSTITUTE_PLAYER' | 'SWAP_OPPONENTS' }>

/** Open-play commands that have no meaning in a tournament: the draw decides who plays. */
export const OPEN_PLAY_ONLY: ReadonlySet<OpenCommand['type']> = new Set<OpenCommand['type']>([
  'SET_MODE', 'ADD_RULE', 'REMOVE_RULE', 'EDIT_PROPOSAL', 'SKIP_PROPOSAL',
])

const fail = (status: 400 | 404 | 409, error: string): CommandResult => ({ ok: false, status, error })
const withTournament = (state: OpenSessionState, tournament: TournamentState): OpenSessionState => ({ ...state, tournament })

function fromEdit(state: OpenSessionState, result: EditResult): CommandResult {
  return result.ok ? { ok: true, state: withTournament(state, result.tournament) } : fail(409, result.reason)
}

function startTournament(state: OpenSessionState, t: TournamentState, ctx: CommandContext): CommandResult {
  if (t.phase === 'SETUP') return fail(409, 'Generate the draw first.')
  if (t.phase !== 'DRAFT') return fail(409, 'The tournament has already started.')
  const loose = unpairedPlayers(t, state.players)
  if (loose.length) {
    const names = loose.map((p) => p.name).join(', ')
    return fail(409, `${names} ${loose.length === 1 ? 'has' : 'have'} no partner. Swap them into a pair, or put them on a break to keep them as a substitute.`)
  }
  const reason = drawViolation(t, t, state.players)
  if (reason) return fail(409, reason)
  return { ok: true, state: withTournament(state, { ...t, phase: 'RUNNING', startedAt: ctx.now }) }
}

export function applyTournamentCommand(state: OpenSessionState, command: TournamentCommand, ctx: CommandContext): CommandResult {
  const t = state.tournament
  if (state.kind !== 'TOURNAMENT' || !t) return fail(409, 'This session is open play, not a tournament.')
  if (state.status === 'ENDED') return fail(409, 'This session has ended.')
  switch (command.type) {
    case 'GENERATE_DRAW': {
      if (t.phase !== 'SETUP' && t.phase !== 'DRAFT') return fail(409, 'The draw is locked once the tournament starts.')
      const drawn = generateDraw(state.players, command, ctx, LIMITS.maxMatches - state.matches.length)
      return drawn.ok ? { ok: true, state: withTournament(state, drawn.tournament) } : fail(409, drawn.reason)
    }
    case 'EDIT_DRAW':
      return fromEdit(state, applyDraftEdit(t, command.edit, state.players, ctx.newId))
    case 'START_TOURNAMENT':
      return startTournament(state, t, ctx)
    case 'SUBSTITUTE_PLAYER': {
      const result = applyRunningEdit(t, { kind: 'SUBSTITUTE', ...command }, state.players, state.matches)
      if (!result.ok) return fail(409, result.reason)
      // A substitute on a break comes back: they are about to play.
      const players = state.players.map((p) => (p.id === command.inPlayerId && p.status === 'BREAK' ? { ...p, status: 'ACTIVE' as const, waitingSince: ctx.now } : p))
      return { ok: true, state: { ...withTournament(state, result.tournament), players } }
    }
    case 'SWAP_OPPONENTS':
      return fromEdit(state, applyRunningEdit(t, { kind: 'SWAP_OPPONENTS', ...command }, state.players, state.matches))
  }
}

export type MatchChange = 'START' | 'FINISH' | 'EDIT' | 'UNDO' | 'ABANDON'

/**
 * Keeps the draw in step with a game command the reducer has already applied
 * to `next`. Refuses (409, with the reason) an undo or edit that a later game
 * already depends on.
 */
export function syncFixture(next: OpenSessionState, match: OpenMatch, change: MatchChange): CommandResult {
  const t = next.tournament
  if (!t || !match.fixtureId) return { ok: true, state: next }
  const saved = next.matches.find((m) => m.id === match.id) ?? match
  switch (change) {
    case 'START':
      return { ok: true, state: withTournament(next, fixtureStarted(t, match.fixtureId)) }
    case 'ABANDON':
      return { ok: true, state: withTournament(next, fixtureAbandoned(t, match.fixtureId)) }
    case 'FINISH':
      return { ok: true, state: withTournament(next, fixtureFinished(t, match.fixtureId, saved.winner ?? 'A', next.matches, next.players)) }
    case 'UNDO':
      return fromEdit(next, reopenFixture(t, match.fixtureId))
    case 'EDIT':
      return fromEdit(next, editFixtureResult(t, match.fixtureId, saved.winner ?? 'A', next.matches, next.players))
  }
}

/** Why a tournament result can't be undone (a later game depends on it), checked before anything else. */
export function undoBlocker(state: OpenSessionState, match: OpenMatch): string | null {
  const t = state.tournament
  if (!t || !match.fixtureId) return null
  const reopened = reopenFixture(t, match.fixtureId)
  return reopened.ok ? null : reopened.reason
}

/** A player in a pair can't simply leave: the pair needs a substitute, or a new draft. */
export function leavingRefusal(state: OpenSessionState, playerId: string): string | null {
  const t = state.tournament
  if (!t) return null
  const entrant = t.entrants.find((e) => e.playerIds.includes(playerId))
  if (!entrant || t.phase === 'FINISHED') return null
  const name = state.players.find((p) => p.id === playerId)?.name ?? 'That player'
  return t.phase === 'RUNNING'
    ? `${name} is in a pair. Substitute them first.`
    : `${name} is in a pair. Swap them out of it in the draft, or generate the draw again.`
}

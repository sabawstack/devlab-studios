import type { OpenCommand } from '../../schemas/pickleball/open/commands'
import { busyPlayerIds, gamesPlayed, matchIncludes } from './fairness'
import { addProposal, fillProposals, proposeForCourt } from './propose'
import { cleanName } from './roster'
import { validateResult } from './scoreValidation'
import { addMs, LIMITS, type CommandContext, type OpenMatch, type OpenPlayer, type OpenSessionState, type Team } from './types'

type Failure = { ok: false; status: 400 | 404 | 409; error: string }
export type CommandResult = { ok: true; state: OpenSessionState } | Failure

const fail = (status: Failure['status'], error: string): Failure => ({ ok: false, status, error })
const ok = (state: OpenSessionState): CommandResult => ({ ok: true, state })

function withMatch(state: OpenSessionState, match: OpenMatch): OpenSessionState {
  return { ...state, matches: state.matches.map((m) => (m.id === match.id ? match : m)) }
}

function withoutMatches(state: OpenSessionState, drop: (m: OpenMatch) => boolean): OpenSessionState {
  return { ...state, matches: state.matches.filter((m) => !drop(m)) }
}

function withPlayers(state: OpenSessionState, ids: ReadonlySet<string>, patch: Partial<OpenPlayer>): OpenSessionState {
  return { ...state, players: state.players.map((p) => (ids.has(p.id) ? { ...p, ...patch } : p)) }
}

function minActiveGames(state: OpenSessionState, exceptId?: string): number {
  const games = state.players
    .filter((p) => p.status !== 'LEFT' && p.id !== exceptId)
    .map((p) => gamesPlayed(p, state.matches))
  return games.length ? Math.min(...games) : 0
}

/** Bring a returning player level with everyone else: raise their offset, never lower it. */
function returnLevel(state: OpenSessionState, target: OpenPlayer, ctx: CommandContext): OpenSessionState {
  const shortfall = minActiveGames(state, target.id) - gamesPlayed(target, state.matches)
  const patch: Partial<OpenPlayer> = {
    status: 'ACTIVE', waitingSince: ctx.now,
    gamesOffset: target.gamesOffset + Math.max(0, shortfall),
  }
  return withPlayers(state, new Set([target.id]), patch)
}

function nameTaken(state: OpenSessionState, name: string, exceptId?: string): boolean {
  const key = name.toLocaleLowerCase()
  return state.players.some((p) => p.id !== exceptId && p.name.toLocaleLowerCase() === key)
}

function addPlayers(state: OpenSessionState, rawNames: readonly string[], ctx: CommandContext): CommandResult {
  const offset = minActiveGames(state)
  let next = state
  let position = state.players.reduce((max, p) => Math.max(max, p.position), 0) + 1
  for (const name of rawNames.map(cleanName).filter(Boolean)) {
    const existing = next.players.find((p) => p.name.toLocaleLowerCase() === name.toLocaleLowerCase())
    if (existing) {
      if (existing.status !== 'ACTIVE') next = returnLevel(next, existing, ctx)
      continue
    }
    if (next.players.length >= LIMITS.maxPlayers) return fail(409, `A session can have at most ${LIMITS.maxPlayers} players.`)
    const added: OpenPlayer = {
      id: ctx.newId(), name, skill: null, duprId: null, status: 'ACTIVE',
      gamesOffset: offset, joinedAt: ctx.now, waitingSince: ctx.now, position,
    }
    position += 1
    next = { ...next, players: [...next.players, added] }
  }
  return ok(next)
}

function setPlayerStatus(state: OpenSessionState, playerId: string, status: OpenPlayer['status'], ctx: CommandContext): CommandResult {
  const target = state.players.find((p) => p.id === playerId)
  if (!target) return fail(404, 'Player not found.')
  if (target.status === status) return ok(state)
  const playing = state.matches.some((m) => m.status === 'IN_PROGRESS' && matchIncludes(m, playerId))
  if (status !== 'ACTIVE' && playing) return fail(409, `${target.name} is playing. Finish or abandon their game first.`)
  const cleared = status === 'ACTIVE' ? state : withoutMatches(state, (m) => m.status === 'PROPOSED' && matchIncludes(m, playerId))
  if (status === 'ACTIVE') return ok(returnLevel(cleared, target, ctx))
  return ok(withPlayers(cleared, new Set([playerId]), { status }))
}

function editProposal(state: OpenSessionState, matchId: string, teamA: Team, teamB: Team): CommandResult {
  const match = state.matches.find((m) => m.id === matchId)
  if (!match) return fail(404, 'Game not found.')
  if (match.status !== 'PROPOSED') return fail(409, 'Only a game that has not started can be edited.')
  const ids = [...teamA, ...teamB]
  if (new Set(ids).size !== 4) return fail(400, 'Pick four different players.')
  const busyElsewhere = busyPlayerIds(state.matches.filter((m) => m.id !== matchId))
  for (const id of ids) {
    const p = state.players.find((x) => x.id === id)
    if (!p) return fail(404, 'Player not found.')
    if (p.status !== 'ACTIVE') return fail(409, `${p.name} is not available.`)
    if (busyElsewhere.has(id)) return fail(409, `${p.name} is already on another court.`)
  }
  return ok(withMatch(state, { ...match, teamA, teamB }))
}

function recordResult(state: OpenSessionState, command: Extract<OpenCommand, { type: 'RECORD_RESULT' | 'EDIT_RESULT' }>, ctx: CommandContext): CommandResult {
  const match = state.matches.find((m) => m.id === command.matchId)
  if (!match) return fail(404, 'Game not found.')
  const editing = command.type === 'EDIT_RESULT'
  if (editing && match.status !== 'FINISHED') return fail(409, 'Only a saved result can be edited.')
  if (!editing && match.status === 'FINISHED') return fail(409, 'This game was already saved.')
  if (!editing && match.status !== 'PROPOSED' && match.status !== 'IN_PROGRESS') return fail(409, 'This game cannot be saved.')
  const check = validateResult({ winner: command.winner, scoreA: command.scoreA, scoreB: command.scoreB }, state.settings)
  if (!check.ok) return fail(400, check.reason)
  const saved: OpenMatch = {
    ...match, status: 'FINISHED', winner: command.winner, scoreA: command.scoreA, scoreB: command.scoreB,
    startedAt: match.startedAt ?? ctx.now, finishedAt: editing ? match.finishedAt : ctx.now,
  }
  const next = withMatch(state, saved)
  return ok(editing ? next : withPlayers(next, new Set([...match.teamA, ...match.teamB]), { waitingSince: ctx.now }))
}

function undoResult(state: OpenSessionState, matchId: string, ctx: CommandContext): CommandResult {
  const match = state.matches.find((m) => m.id === matchId)
  if (!match) return fail(404, 'Game not found.')
  if (match.status !== 'FINISHED' || !match.finishedAt) return fail(409, 'Only a saved result can be undone.')
  if (Date.parse(ctx.now) - Date.parse(match.finishedAt) > LIMITS.undoWindowMs) {
    return fail(409, 'The 2-minute undo has passed. Edit the result instead.')
  }
  if (state.matches.some((m) => m.id !== matchId && m.courtId === match.courtId && m.status === 'IN_PROGRESS')) {
    return fail(409, 'That court has already started its next game. Edit the result instead.')
  }
  const ids = [...match.teamA, ...match.teamB]
  const nowPlaying = state.matches.find((m) => m.id !== matchId && m.status === 'IN_PROGRESS' && ids.some((id) => matchIncludes(m, id)))
  if (nowPlaying) return fail(409, 'Someone from that game is already playing again. Edit the result instead.')
  const cleared = withoutMatches(state, (m) => m.status === 'PROPOSED' && (m.courtId === match.courtId || ids.some((id) => matchIncludes(m, id))))
  return ok(withMatch(cleared, { ...match, status: 'IN_PROGRESS', winner: null, scoreA: null, scoreB: null, finishedAt: null }))
}

export function applyCommand(state: OpenSessionState, command: OpenCommand, ctx: CommandContext): CommandResult {
  const ended = state.status === 'ENDED'
  switch (command.type) {
    case 'ADD_PLAYERS':
      return addPlayers(state, command.names, ctx)
    case 'SET_PLAYER_STATUS':
      return setPlayerStatus(state, command.playerId, command.status, ctx)
    case 'RENAME_PLAYER': {
      const target = state.players.find((p) => p.id === command.playerId)
      if (!target) return fail(404, 'Player not found.')
      const name = cleanName(command.name)
      if (!name) return fail(400, 'Enter a name.')
      if (nameTaken(state, name, target.id)) return fail(409, `${name} is already in this session.`)
      return ok(withPlayers(state, new Set([target.id]), { name }))
    }
    case 'SET_COURT_ENABLED': {
      const target = state.courts.find((c) => c.id === command.courtId)
      if (!target) return fail(404, 'Court not found.')
      const live = state.matches.some((m) => m.courtId === target.id && m.status === 'IN_PROGRESS')
      if (!command.enabled && live) return fail(409, `${target.label} has a game in progress.`)
      const cleared = command.enabled ? state : withoutMatches(state, (m) => m.courtId === target.id && m.status === 'PROPOSED')
      return ok({ ...cleared, courts: cleared.courts.map((c) => (c.id === target.id ? { ...c, enabled: command.enabled } : c)) })
    }
    case 'EDIT_PROPOSAL':
      if (ended) return fail(409, 'This session has ended.')
      return editProposal(state, command.matchId, command.teamA, command.teamB)
    case 'SKIP_PROPOSAL': {
      if (ended) return fail(409, 'This session has ended.')
      const match = state.matches.find((m) => m.id === command.matchId)
      if (!match) return fail(404, 'Game not found.')
      if (match.status !== 'PROPOSED') return fail(409, 'Only a game that has not started can be skipped.')
      const cleared = withoutMatches(state, (m) => m.id === match.id)
      const replacement = proposeForCourt(cleared, [...match.teamA, ...match.teamB])
      return ok(replacement ? addProposal(cleared, match.courtId, replacement, ctx) : cleared)
    }
    case 'START_MATCH': {
      if (ended) return fail(409, 'This session has ended.')
      const match = state.matches.find((m) => m.id === command.matchId)
      if (!match) return fail(404, 'Game not found.')
      if (match.status !== 'PROPOSED') return fail(409, 'This game has already started.')
      return ok(withMatch(state, { ...match, status: 'IN_PROGRESS', startedAt: ctx.now }))
    }
    case 'RECORD_RESULT':
    case 'EDIT_RESULT':
      return recordResult(state, command, ctx)
    case 'UNDO_RESULT':
      return undoResult(state, command.matchId, ctx)
    case 'ABANDON_MATCH': {
      const match = state.matches.find((m) => m.id === command.matchId)
      if (!match) return fail(404, 'Game not found.')
      if (match.status !== 'IN_PROGRESS') return fail(409, 'Only a game in progress can be abandoned.')
      const next = withMatch(state, { ...match, status: 'ABANDONED', finishedAt: ctx.now })
      return ok(withPlayers(next, new Set([...match.teamA, ...match.teamB]), { waitingSince: ctx.now }))
    }
    case 'END_SESSION':
      return ok({ ...withoutMatches(state, (m) => m.status === 'PROPOSED'), status: 'ENDED' })
  }
}

/** Every successful command: bump version, push expiry out 7 days, fill free courts. */
export function finalizeCommand(state: OpenSessionState, ctx: CommandContext): OpenSessionState {
  const touched: OpenSessionState = {
    ...state,
    version: state.version + 1,
    lastActivityAt: ctx.now,
    expiresAt: addMs(ctx.now, LIMITS.retentionMs),
  }
  return fillProposals(touched, ctx)
}

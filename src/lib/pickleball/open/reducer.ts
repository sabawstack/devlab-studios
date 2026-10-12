import type { OpenCommand } from '../../schemas/pickleball/open/commands'
import { cleanAnnouncement } from './announcement'
import { busyPlayerIds, gamesPlayed, matchIncludes, pairKey } from './fairness'
import { addProposal, fillProposals, proposeForCourt } from './propose'
import { cleanName } from './roster'
import { activeRules, keepsRules, ruleViolation } from './rules'
import { validateResult } from './scoreValidation'
import { applyTournamentCommand, leavingRefusal, OPEN_PLAY_ONLY, syncFixture, undoBlocker } from './tournament/commands'
import { withoutStaleProposals } from './tournament/courts'
import { addMs, LIMITS, type CommandContext, type OpenMatch, type OpenPlayer, type OpenSessionState, type PairRule, type Team } from './types'

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

export function minActiveGames(state: OpenSessionState, exceptId?: string): number {
  const games = state.players
    .filter((p) => p.status !== 'LEFT' && p.id !== exceptId)
    .map((p) => gamesPlayed(p, state.matches))
  return games.length ? Math.min(...games) : 0
}

/** Bring a returning player level with everyone else: raise their offset, never lower it. */
export function returnLevel(state: OpenSessionState, target: OpenPlayer, ctx: CommandContext): OpenSessionState {
  const shortfall = minActiveGames(state, target.id) - gamesPlayed(target, state.matches)
  const patch: Partial<OpenPlayer> = {
    status: 'ACTIVE', waitingSince: ctx.now,
    gamesOffset: target.gamesOffset + Math.max(0, shortfall),
  }
  const returned = withPlayers(state, new Set([target.id]), patch)
  // Rules involving the returning player are live again: withdraw any proposal that now breaks one.
  const active = activeRules(returned)
  return withoutMatches(returned, (m) => m.status === 'PROPOSED' && !keepsRules(m.teamA, m.teamB, active))
}

function nameTaken(state: OpenSessionState, name: string, exceptId?: string): boolean {
  const key = name.toLocaleLowerCase()
  return state.players.some((p) => p.id !== exceptId && p.name.toLocaleLowerCase() === key)
}

export interface NewPlayerDetails {
  skill: number | null
  duprId: string | null
}

export type AddOrReturn =
  | { outcome: 'added' | 'returned' | 'present'; state: OpenSessionState; player: OpenPlayer }
  | { outcome: 'full' }

/**
 * The one way a cleaned name joins a session: a name already on the list is
 * matched case-insensitively and, unless already ACTIVE, brought back level;
 * a new name is added level with whoever has played least (`offset` lets a
 * batch fix that level up front). A returning player is never blocked by the cap.
 */
export function addOrReturnPlayer(
  state: OpenSessionState, name: string, details: NewPlayerDetails, ctx: CommandContext, offset: number = minActiveGames(state),
): AddOrReturn {
  const existing = state.players.find((p) => p.name.toLocaleLowerCase() === name.toLocaleLowerCase())
  if (existing) {
    if (existing.status === 'ACTIVE') return { outcome: 'present', state, player: existing }
    const next = returnLevel(state, existing, ctx)
    return { outcome: 'returned', state: next, player: next.players.find((p) => p.id === existing.id) ?? existing }
  }
  if (state.players.length >= LIMITS.maxPlayers) return { outcome: 'full' }
  const added: OpenPlayer = {
    id: ctx.newId(), name, skill: details.skill, duprId: details.duprId, status: 'ACTIVE',
    gamesOffset: offset, joinedAt: ctx.now, waitingSince: ctx.now,
    position: state.players.reduce((max, p) => Math.max(max, p.position), 0) + 1,
  }
  return { outcome: 'added', state: { ...state, players: [...state.players, added] }, player: added }
}

function addPlayers(state: OpenSessionState, rawNames: readonly string[], ctx: CommandContext): CommandResult {
  const offset = minActiveGames(state)
  let next = state
  for (const name of rawNames.map(cleanName).filter(Boolean)) {
    const result = addOrReturnPlayer(next, name, { skill: null, duprId: null }, ctx, offset)
    if (result.outcome === 'full') return fail(409, `A session can have at most ${LIMITS.maxPlayers} players.`)
    next = result.state
  }
  return ok(next)
}

function setPlayerStatus(state: OpenSessionState, playerId: string, status: OpenPlayer['status'], ctx: CommandContext): CommandResult {
  const target = state.players.find((p) => p.id === playerId)
  if (!target) return fail(404, 'Player not found.')
  if (target.status === status) return ok(state)
  const playing = state.matches.some((m) => m.status === 'IN_PROGRESS' && matchIncludes(m, playerId))
  if (status !== 'ACTIVE' && playing) return fail(409, `${target.name} is playing. Finish or abandon their game first.`)
  const inPair = status === 'LEFT' ? leavingRefusal(state, playerId) : null
  if (inPair) return fail(409, inPair)
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
  const violation = ruleViolation(teamA, teamB, state)
  if (violation) return fail(409, violation)
  return ok(withMatch(state, { ...match, teamA, teamB }))
}

function sameRule(a: PairRule, b: PairRule): boolean {
  return a.kind === b.kind && pairKey(...a.playerIds) === pairKey(...b.playerIds)
}

function withRules(state: OpenSessionState, rules: readonly PairRule[]): OpenSessionState {
  return { ...state, settings: { ...state.settings, rules } }
}

function addRule(state: OpenSessionState, rule: PairRule): CommandResult {
  const [a, b] = rule.playerIds
  if (a === b) return fail(400, 'Pick two different players.')
  const pa = state.players.find((p) => p.id === a)
  const pb = state.players.find((p) => p.id === b)
  if (!pa || !pb) return fail(404, 'Player not found.')
  const gone = [pa, pb].find((p) => p.status === 'LEFT')
  if (gone) return fail(409, `${gone.name} has left the session.`)
  const rules = state.settings.rules
  if (rules.some((r) => sameRule(r, rule))) return ok(state)
  if (rules.length >= LIMITS.maxRules) return fail(409, `A session can have at most ${LIMITS.maxRules} rules.`)
  if (rules.some((r) => pairKey(...r.playerIds) === pairKey(a, b))) {
    return fail(409, `${pa.name} and ${pb.name} already have the opposite rule. Remove it first.`)
  }
  if (rule.kind === 'TOGETHER') {
    const taken = [pa, pb].find((p) => rules.some((r) => r.kind === 'TOGETHER' && r.playerIds.includes(p.id)))
    if (taken) return fail(409, `${taken.name} already has a keep-together partner.`)
  }
  const next = withRules(state, [...rules, { kind: rule.kind, playerIds: [a, b] }])
  const active = activeRules(next)
  // A game not yet started that now breaks a rule is withdrawn; finalizeCommand proposes again.
  return ok(withoutMatches(next, (m) => m.status === 'PROPOSED' && !keepsRules(m.teamA, m.teamB, active)))
}

function removeRule(state: OpenSessionState, rule: PairRule): CommandResult {
  const rules = state.settings.rules
  if (!rules.some((r) => sameRule(r, rule))) return fail(404, 'That rule is not set.')
  return ok(withRules(state, rules.filter((r) => !sameRule(r, rule))))
}

function recordResult(state: OpenSessionState, command: Extract<OpenCommand, { type: 'RECORD_RESULT' | 'EDIT_RESULT' }>, ctx: CommandContext): CommandResult {
  const match = state.matches.find((m) => m.id === command.matchId)
  if (!match) return fail(404, 'Game not found.')
  const editing = command.type === 'EDIT_RESULT'
  if (editing && match.status !== 'FINISHED') return fail(409, 'Only a saved result can be edited.')
  if (!editing && match.status === 'FINISHED') {
    return fail(409, match.recordedBy ? `This game was already saved by ${match.recordedBy}.` : 'This game was already saved.')
  }
  if (!editing && match.status !== 'PROPOSED' && match.status !== 'IN_PROGRESS') return fail(409, 'This game cannot be saved.')
  const check = validateResult({ winner: command.winner, scoreA: command.scoreA, scoreB: command.scoreB }, state.settings)
  if (!check.ok) return fail(400, check.reason)
  const saved: OpenMatch = {
    ...match, status: 'FINISHED', winner: command.winner, scoreA: command.scoreA, scoreB: command.scoreB,
    startedAt: match.startedAt ?? ctx.now, finishedAt: editing ? match.finishedAt : ctx.now, recordedBy: ctx.actor ?? 'Host',
  }
  const next = withMatch(state, saved)
  if (editing) return syncFixture(next, saved, 'EDIT')
  return syncFixture(withPlayers(next, new Set([...match.teamA, ...match.teamB]), { waitingSince: ctx.now }), saved, 'FINISH')
}

function undoResult(state: OpenSessionState, matchId: string, ctx: CommandContext): CommandResult {
  const match = state.matches.find((m) => m.id === matchId)
  if (!match) return fail(404, 'Game not found.')
  if (match.status !== 'FINISHED' || !match.finishedAt) return fail(409, 'Only a saved result can be undone.')
  if (Date.parse(ctx.now) - Date.parse(match.finishedAt) > LIMITS.undoWindowMs) {
    return fail(409, 'The 2-minute undo has passed. Edit the result instead.')
  }
  const dependent = undoBlocker(state, match)
  if (dependent) return fail(409, dependent)
  if (state.matches.some((m) => m.id !== matchId && m.courtId === match.courtId && m.status === 'IN_PROGRESS')) {
    return fail(409, 'That court has already started its next game. Edit the result instead.')
  }
  const ids = [...match.teamA, ...match.teamB]
  const nowPlaying = state.matches.find((m) => m.id !== matchId && m.status === 'IN_PROGRESS' && ids.some((id) => matchIncludes(m, id)))
  if (nowPlaying) return fail(409, 'Someone from that game is already playing again. Edit the result instead.')
  const cleared = withoutMatches(state, (m) => m.status === 'PROPOSED' && (m.courtId === match.courtId || ids.some((id) => matchIncludes(m, id))))
  const reopened = { ...match, status: 'IN_PROGRESS' as const, winner: null, scoreA: null, scoreB: null, finishedAt: null, recordedBy: null }
  return syncFixture(withMatch(cleared, reopened), reopened, 'UNDO')
}

export function applyCommand(state: OpenSessionState, command: OpenCommand, ctx: CommandContext): CommandResult {
  const ended = state.status === 'ENDED'
  if (state.kind === 'TOURNAMENT' && OPEN_PLAY_ONLY.has(command.type)) {
    return fail(409, 'That is for open play. In a tournament the draw decides who plays whom.')
  }
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
      const started = { ...match, status: 'IN_PROGRESS' as const, startedAt: ctx.now }
      return syncFixture(withMatch(state, started), started, 'START')
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
      return syncFixture(withPlayers(next, new Set([...match.teamA, ...match.teamB]), { waitingSince: ctx.now }), match, 'ABANDON')
    }
    case 'END_SESSION':
      return ok({ ...withoutMatches(state, (m) => m.status === 'PROPOSED'), status: 'ENDED' })
    case 'SET_MODE':
      // Applies to the next proposal only (spec §5.2): nothing proposed or playing is rewritten.
      return ok({ ...state, settings: { ...state.settings, mode: command.mode } })
    case 'SET_SELF_CHECK_IN':
      return ok({ ...state, settings: { ...state.settings, selfCheckIn: command.enabled } })
    case 'SET_ANNOUNCEMENT': {
      // Host only (not a captain command). Allowed after the end: a thank-you is often written then.
      const announcement = cleanAnnouncement(command.text)
      if (command.text.trim().length > LIMITS.maxAnnouncementLength) {
        return fail(400, `Keep the welcome message to ${LIMITS.maxAnnouncementLength} characters.`)
      }
      return ok({ ...state, settings: { ...state.settings, announcement } })
    }
    case 'SET_PLAYER_SKILL': {
      const target = state.players.find((p) => p.id === command.playerId)
      if (!target) return fail(404, 'Player not found.')
      const skill = command.skill === null ? null : Math.round(command.skill * 100) / 100
      return ok(withPlayers(state, new Set([target.id]), { skill }))
    }
    case 'SET_PLAYER_DUPR_ID': {
      // Allowed after the session ends: the DUPR export is often sent then (spec §9.3).
      const target = state.players.find((p) => p.id === command.playerId)
      if (!target) return fail(404, 'Player not found.')
      const duprId = command.duprId === null ? null : command.duprId.trim().toUpperCase()
      const holder = duprId ? state.players.find((p) => p.id !== target.id && p.duprId === duprId) : undefined
      if (holder) return fail(409, `${holder.name} already has DUPR ID ${duprId}.`)
      return ok(withPlayers(state, new Set([target.id]), { duprId }))
    }
    case 'ADD_RULE':
      return addRule(state, command.rule)
    case 'REMOVE_RULE':
      return removeRule(state, command.rule)
    case 'GENERATE_DRAW':
    case 'EDIT_DRAW':
    case 'START_TOURNAMENT':
    case 'SUBSTITUTE_PLAYER':
    case 'SWAP_OPPONENTS':
      return applyTournamentCommand(state, command, ctx)
  }
}

/** Bump the version and push expiry out 7 days (spec §8). */
export function touch(state: OpenSessionState, now: string): OpenSessionState {
  return { ...state, version: state.version + 1, lastActivityAt: now, expiresAt: addMs(now, LIMITS.retentionMs) }
}

/** Every successful command: touch, withdraw tournament proposals the draw no longer backs, then fill free courts. */
export function finalizeCommand(state: OpenSessionState, ctx: CommandContext): OpenSessionState {
  return fillProposals(withoutStaleProposals(touch(state, ctx.now)), ctx)
}

import { fillProposals } from './propose'
import { cleanName, type RosterEntry } from './roster'
import { addMs, LIMITS, type CommandContext, type OpenPlayer, type OpenSessionState, type SessionSettings } from './types'

export interface CreateSessionInput {
  name: string
  hostDisplayName: string
  location: string | null
  courtCount: number
  settings: SessionSettings
  players: readonly RosterEntry[]
}

function uniquePlayers(entries: readonly RosterEntry[], ctx: CommandContext): OpenPlayer[] {
  const seen = new Set<string>()
  return entries.reduce<OpenPlayer[]>((acc, entry) => {
    const name = cleanName(entry.name)
    const key = name.toLocaleLowerCase()
    if (!name || seen.has(key) || acc.length >= LIMITS.maxPlayers) return acc
    seen.add(key)
    return [...acc, {
      id: ctx.newId(), name, skill: entry.skill ?? null, duprId: entry.duprId ? entry.duprId.toUpperCase() : null,
      status: 'ACTIVE', gamesOffset: 0, joinedAt: ctx.now, waitingSince: ctx.now, position: acc.length + 1,
    }]
  }, [])
}

export function buildInitialState(
  input: CreateSessionInput,
  ctx: CommandContext & { publicCode: string; sessionId: string },
): OpenSessionState {
  const courtCount = Math.min(Math.max(1, Math.trunc(input.courtCount)), LIMITS.maxCourts)
  const state: OpenSessionState = {
    id: ctx.sessionId,
    publicCode: ctx.publicCode,
    kind: 'OPEN_PLAY',
    name: input.name.trim(),
    hostDisplayName: input.hostDisplayName.trim(),
    location: input.location?.trim() || null,
    status: 'ACTIVE',
    settings: input.settings,
    players: uniquePlayers(input.players, ctx),
    courts: Array.from({ length: courtCount }, (_, i) => ({ id: ctx.newId(), label: `Court ${i + 1}`, position: i + 1, enabled: true })),
    matches: [],
    version: 1,
    createdAt: ctx.now,
    lastActivityAt: ctx.now,
    expiresAt: addMs(ctx.now, LIMITS.retentionMs),
  }
  return fillProposals(state, ctx)
}

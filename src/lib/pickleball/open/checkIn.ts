// QR self check-in (spec §4.2): an anonymous player adds themselves. The same
// cleaning as a pasted roster applies, and nothing here can touch anyone else
// beyond bringing a player with the same name back from a break.
import { minActiveGames, returnLevel } from './reducer'
import { cleanName } from './roster'
import { LIMITS, type CommandContext, type OpenPlayer, type OpenSessionState } from './types'

export interface CheckInEntry {
  name: string
  skill: number | null
  duprId: string | null
}

export type CheckInResult =
  | { ok: true; state: OpenSessionState; playerId: string; name: string; alreadyCheckedIn: boolean }
  | { ok: false; status: 400 | 403 | 409; error: string }

const DUPR_ID = /^[A-Z0-9]{6}$/

export function applyCheckIn(state: OpenSessionState, entry: CheckInEntry, ctx: CommandContext): CheckInResult {
  if (!state.settings.selfCheckIn) return { ok: false, status: 403, error: 'Check-in is closed for this session. Ask the host to add you.' }
  if (state.status === 'ENDED') return { ok: false, status: 409, error: 'This session has ended.' }
  const name = cleanName(entry.name)
  if (!name) return { ok: false, status: 400, error: 'Enter your name.' }
  if (entry.skill !== null && !(Number.isInteger(entry.skill) && entry.skill >= 1 && entry.skill <= 5)) {
    return { ok: false, status: 400, error: 'Skill is a whole number from 1 to 5.' }
  }
  const duprId = entry.duprId ? entry.duprId.trim().toUpperCase() : null
  if (duprId !== null && !DUPR_ID.test(duprId)) return { ok: false, status: 400, error: 'A DUPR ID is 6 letters or digits.' }

  const existing = state.players.find((p) => p.name.toLocaleLowerCase() === name.toLocaleLowerCase())
  if (existing?.status === 'ACTIVE') return { ok: true, state, playerId: existing.id, name: existing.name, alreadyCheckedIn: true }
  if (existing) return { ok: true, state: returnLevel(state, existing, ctx), playerId: existing.id, name: existing.name, alreadyCheckedIn: false }
  if (state.players.length >= LIMITS.maxPlayers) return { ok: false, status: 409, error: 'This session is full.' }

  const added: OpenPlayer = {
    id: ctx.newId(), name, skill: entry.skill, duprId, status: 'ACTIVE',
    gamesOffset: minActiveGames(state), joinedAt: ctx.now, waitingSince: ctx.now,
    position: state.players.reduce((max, p) => Math.max(max, p.position), 0) + 1,
  }
  return { ok: true, state: { ...state, players: [...state.players, added] }, playerId: added.id, name, alreadyCheckedIn: false }
}

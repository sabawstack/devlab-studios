// QR self check-in (spec §4.2): an anonymous player adds themselves. The same
// cleaning as a pasted roster applies, and nothing here can touch anyone else
// beyond bringing a player with the same name back from a break.
import { addOrReturnPlayer } from './reducer'
import { cleanName } from './roster'
import type { CommandContext, OpenSessionState } from './types'

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

  const taken = state.players.find((p) => p.name.toLocaleLowerCase() === name.toLocaleLowerCase())
  if (taken?.status === 'LEFT') {
    return { ok: false, status: 409, error: 'The host took this name off the list. Ask the host to add you back.' }
  }
  const result = addOrReturnPlayer(state, name, { skill: entry.skill, duprId }, ctx)
  if (result.outcome === 'full') return { ok: false, status: 409, error: 'This session is full.' }
  return { ok: true, state: result.state, playerId: result.player.id, name: result.player.name, alreadyCheckedIn: result.outcome === 'present' }
}

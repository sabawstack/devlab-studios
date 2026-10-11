// src/lib/pickleball/open/captains.ts
// Court captains (spec §3.3, §5.4): a per-captain secret link scoped to ONE
// court. A captain may start, edit or skip that court's proposal, and record,
// undo or edit its results. Everything else is the host's.
import type { OpenCommand } from '../../schemas/pickleball/open/commands'
import { cleanName } from './roster'
import { constantTimeEqual } from './secrets'
import type { CaptainRecord, OpenSessionState } from './types'

export const CAPTAIN_COMMANDS: ReadonlySet<OpenCommand['type']> = new Set<OpenCommand['type']>([
  'START_MATCH', 'RECORD_RESULT', 'UNDO_RESULT', 'EDIT_RESULT', 'EDIT_PROPOSAL', 'SKIP_PROPOSAL',
])

/** Why this captain may not run this command, or null when they may. */
export function captainRefusal(command: OpenCommand, captain: CaptainRecord, state: OpenSessionState): string | null {
  if (!CAPTAIN_COMMANDS.has(command.type) || !('matchId' in command)) return 'Only the host can do that.'
  const match = state.matches.find((m) => m.id === command.matchId)
  if (!match) return null // the reducer answers 404
  if (match.courtId === captain.courtId) return null
  const label = state.courts.find((c) => c.id === captain.courtId)?.label ?? 'your court'
  return `This captain link only runs ${label}.`
}

/** "Court 2 captain", then "Court 2 captain 2" for a second link to the same court. */
export function captainLabel(state: OpenSessionState, courtId: string, existing: readonly CaptainRecord[], requested?: string): string {
  const cleaned = requested ? cleanName(requested) : ''
  if (cleaned) return cleaned
  const base = `${state.courts.find((c) => c.id === courtId)?.label ?? 'Court'} captain`
  const sameCourt = existing.filter((c) => c.courtId === courtId).length
  return sameCourt ? `${base} ${sameCourt + 1}` : base
}

/** The live captain whose key hashes to keyHash. Compares every record in constant time. */
export function findCaptain(captains: readonly CaptainRecord[], keyHash: string): CaptainRecord | null {
  return captains.reduce<CaptainRecord | null>((found, c) => (constantTimeEqual(c.keyHash, keyHash) ? c : found), null)
}

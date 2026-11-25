// Why an enabled court with no game has none, for every role's snapshot
// (PB-QUEUE-06). Read-only: nothing here proposes, reserves or reorders anyone.
//
// The next four are no longer predicted here: the server puts them on deck
// (propose.ts fillProposals, PB-QUEUE-09), so the snapshot reads them from the
// match itself. The host's own wording (proposalBlocker, tournamentCourtNote)
// stays host-only: it can reveal that pairing rules exist.
import { queueOrder } from './fairness'
import { tournamentIdle } from './tournament/courts'
import { LIMITS, type OpenSessionState } from './types'

export type CourtIdle =
  | 'TOO_FEW_PLAYERS'
  | 'WAITING_FOR_HOST'
  | 'TOURNAMENT_NOT_STARTED'
  | 'WAITING_FOR_RESULT'
  | 'PLAYER_ON_BREAK'
  | 'SESSION_OVER'

/** Why a free court is empty: the same checks, in the same order, as the host's blocker text. */
function idleReason(state: OpenSessionState, waiting: number): CourtIdle {
  if (state.status !== 'ACTIVE') return 'SESSION_OVER'
  if (state.kind === 'TOURNAMENT') return tournamentIdle(state)
  if (state.matches.length >= LIMITS.maxMatches) return 'WAITING_FOR_HOST'
  if (waiting < 4) return 'TOO_FEW_PLAYERS'
  // Four or more wait, but no four fit the keep-together/apart rules (proposalBlocker).
  return 'WAITING_FOR_HOST'
}

/** Why each enabled court with no game is empty. Courts that are off or have a game are absent. */
export function courtIdle(state: OpenSessionState): ReadonlyMap<string, CourtIdle> {
  const busy = new Set(state.matches.filter((m) => m.status === 'PROPOSED' || m.status === 'IN_PROGRESS').map((m) => m.courtId))
  const idle = new Map<string, CourtIdle>()
  const free = state.courts.filter((c) => c.enabled && !busy.has(c.id))
  if (free.length) {
    const reason = idleReason(state, queueOrder(state).length)
    for (const c of free) idle.set(c.id, reason)
  }
  return idle
}

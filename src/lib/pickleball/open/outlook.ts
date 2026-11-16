// What the queue will do next, for every role's snapshot (PB-QUEUE-06).
// Lives beside propose.ts and reads only what proposeForCourt reads.
//
// Read-only: nothing here proposes, reserves or reorders anyone, and no
// matchmaking rule lives here. It answers two questions about the state as it
// is now:
//
// - nextUp: the four players the server WILL propose when the next game ends,
//   only when the current state already fixes them, whichever side wins and by
//   any score. Otherwise null, and nobody is named. The contract is that
//   invariant, held against the real reducer in outlook.property.test.ts.
// - idle: why an enabled court with no game has none, as a coarse reason a
//   viewer may see. The host's own wording (proposalBlocker,
//   tournamentCourtNote) stays host-only: it can reveal that pairing rules exist.
import { gamesPlayed, pairingHistory, queueOrder, type QueueEntry } from './fairness'
import { byStandingUsesWindow } from './modes/byStanding'
import { fairPool, pickFresh, poolIds } from './modes/shared'
import { proposeForCourt } from './propose'
import { activeRules } from './rules'
import { compareCore, computeStandings } from './standings'
import { tournamentIdle } from './tournament/courts'
import { LIMITS, type OpenSessionState } from './types'

export type CourtIdle =
  | 'TOO_FEW_PLAYERS'
  | 'WAITING_FOR_HOST'
  | 'TOURNAMENT_NOT_STARTED'
  | 'WAITING_FOR_RESULT'
  | 'PLAYER_ON_BREAK'
  | 'SESSION_OVER'

export interface QueueOutlook {
  /** The next four, in queue order, or null when the state does not fix them yet. */
  nextUp: QueueEntry[] | null
  /** Why each enabled court with no game is empty. Courts that are off or have a game are absent. */
  idle: ReadonlyMap<string, CourtIdle>
}

function liveMatches(state: OpenSessionState) {
  return state.matches.filter((m) => m.status === 'PROPOSED' || m.status === 'IN_PROGRESS')
}

/** Why a free court is empty: the same checks, in the same order, as the host's blocker text. */
function idleReason(state: OpenSessionState, waiting: number): CourtIdle {
  if (state.status !== 'ACTIVE') return 'SESSION_OVER'
  if (state.kind === 'TOURNAMENT') return tournamentIdle(state)
  if (state.matches.length >= LIMITS.maxMatches) return 'WAITING_FOR_HOST'
  if (waiting < 4) return 'TOO_FEW_PLAYERS'
  // Four or more wait, but no four fit the keep-together/apart rules (proposalBlocker).
  return 'WAITING_FOR_HOST'
}

/** True when two of these players have played and tie on win rate and points share (head-to-head could then reorder them). */
function rankedTie(state: OpenSessionState, ids: ReadonlySet<string>): boolean {
  const rows = computeStandings(state.players, state.matches).filter((row) => ids.has(row.playerId) && row.played > 0)
  return rows.some((a, i) => rows.slice(i + 1).some((b) => compareCore(a, b) === 0))
}

/**
 * The four the server will propose after ANY live game ends, or null.
 *
 * Gate: open play, active, under the game cap; every enabled court is playing
 * and nothing is proposed; at least four wait; no keep-together pair is split
 * between court and queue; the fair pool over the waiting players resolves to
 * a games tier; and every player on court will have more games than that tier
 * once their game ends, so no finisher can enter the pool.
 *
 * Why that is enough: a result changes only the finishers' games, wait, win or
 * loss tag and standing. With every finisher above the pool's tier, the fair
 * pool, the meeting counts, the tags and sit-out counts the modes read, and so
 * the four they choose, are the same before and after the result.
 *
 * By standing also ranks the pool by today's standings, which the finishers'
 * results move. Their rows cannot reorder the candidates unless two
 * candidates tie (a finisher joining that tie can switch it between
 * head-to-head and name order), and the window search reads only the relative
 * order. Its rank-distance fallback reads absolute ranks, so it must not be in use.
 */
function fixedNextFour(state: OpenSessionState, queue: readonly QueueEntry[]): QueueEntry[] | null {
  if (state.kind !== 'OPEN_PLAY' || state.status !== 'ACTIVE' || state.matches.length >= LIMITS.maxMatches) return null
  const enabled = state.courts.filter((c) => c.enabled)
  if (enabled.length === 0 || queue.length < 4) return null
  const live = liveMatches(state)
  if (live.some((m) => m.status === 'PROPOSED')) return null
  const playing = new Set(live.map((m) => m.courtId))
  if (!enabled.every((c) => playing.has(c.id))) return null

  const rules = activeRules(state)
  const onCourt = new Set(live.flatMap((m) => [...m.teamA, ...m.teamB]))
  if (queue.some((e) => onCourt.has(rules.partnerOf.get(e.player.id) ?? ''))) return null

  const waiting = new Set(queue.map((e) => e.player.id))
  const pool = fairPool(queue, rules)
  if (!pickFresh(poolIds(pool), rules, waiting)) return null
  const due = [...pool.required, ...pool.optional]
  const tierGames = Math.max(...due.map((e) => e.games))
  const finisherCanEnter = state.players.some((p) => onCourt.has(p.id) && gamesPlayed(p, state.matches) + 1 <= tierGames)
  if (finisherCanEnter) return null

  if (state.settings.mode === 'BY_STANDING') {
    if (rankedTie(state, new Set(due.map((e) => e.player.id)))) return null
    if (!byStandingUsesWindow({ state, queue, history: pairingHistory(state.matches), rules })) return null
  }

  const proposal = proposeForCourt(state)
  if (!proposal) return null
  const four = new Set([...proposal.teamA, ...proposal.teamB])
  return [...four].every((id) => waiting.has(id)) ? queue.filter((e) => four.has(e.player.id)) : null
}

export function queueOutlook(state: OpenSessionState): QueueOutlook {
  const queue = queueOrder(state)
  const busyCourts = new Set(liveMatches(state).map((m) => m.courtId))
  const idle = new Map<string, CourtIdle>()
  const free = state.courts.filter((c) => c.enabled && !busyCourts.has(c.id))
  if (free.length) {
    const reason = idleReason(state, queue.length)
    for (const c of free) idle.set(c.id, reason)
  }
  return { nextUp: fixedNextFour(state, queue), idle }
}

// src/lib/pickleball/open/modes/shared.ts
// Helpers shared by the modes other than paddle stack.
import type { QueueEntry } from '../fairness'
import type { OpenMatch, OpenSessionState } from '../types'

/**
 * The other modes choose among the players most due to play, not the whole
 * queue: the forced sit-outs plus the next players in paddle-stack order,
 * DUE_WINDOW in all. Choosing from everyone would let winners (or the top of
 * the standings) go straight back on while others wait, which breaks the
 * "no more than 2 rounds out in a row" guarantee (spec §1, §5.2).
 */
export const DUE_WINDOW = 8

export function dueWindow(queue: readonly QueueEntry[]): QueueEntry[] {
  const forced = queue.filter((entry) => entry.forced).length
  return queue.slice(0, Math.max(DUE_WINDOW, forced))
}

export type ResultTag = 'W' | 'L' | 'N'

export interface LastGame {
  tag: ResultTag
  /** Partner in that game, when the tag is W or L. */
  teammate: string | null
}

const UNTAGGED: LastGame = { tag: 'N', teammate: null }

/**
 * Each player's tag from their last finished game (spec §5.2): W or L; N when
 * they have none, or became available again after it (back from a break, or
 * out of an abandoned game: "players return untagged", §5.1).
 */
export function lastGames(state: OpenSessionState): Map<string, LastGame> {
  const finished = state.matches
    .filter((m): m is OpenMatch & { finishedAt: string } => m.status === 'FINISHED' && m.finishedAt !== null && m.winner !== null)
    .sort((a, b) => Date.parse(a.finishedAt) - Date.parse(b.finishedAt) || a.seq - b.seq)
  const last = new Map<string, OpenMatch & { finishedAt: string }>()
  for (const m of finished) for (const id of [...m.teamA, ...m.teamB]) last.set(id, m)
  return new Map(state.players.map((p): [string, LastGame] => {
    const m = last.get(p.id)
    if (!m || Date.parse(m.finishedAt) < Date.parse(p.waitingSince)) return [p.id, UNTAGGED]
    const onA = m.teamA.includes(p.id)
    const team = onA ? m.teamA : m.teamB
    return [p.id, { tag: (m.winner === 'A') === onA ? 'W' : 'L', teammate: team[0] === p.id ? team[1] : team[0] }]
  }))
}

export function setKey(ids: readonly string[]): string {
  return [...ids].sort().join('|')
}

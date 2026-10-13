// src/lib/pickleball/open/modes/shared.ts
// Helpers shared by the modes other than paddle stack.
import type { QueueEntry } from '../fairness'
import { pickFour, type ActiveRules } from '../rules'
import type { OpenMatch, OpenSessionState } from '../types'

/**
 * Fair first, then mode: every mode other than paddle stack chooses its four
 * from the FAIR POOL, never from the whole queue.
 *
 * - `required`: every games-played tier below the last one taken; they go on
 *   before anyone in `optional`.
 * - `optional`: the last tier taken (all on the same games count), in queue
 *   order: the sit-out guard's forced players first, then longest wait. The
 *   mode chooses among them.
 *
 * Tiers are taken in queue order (fewest games first) until `pickFour` can
 * seat four within the keep-together/apart rules (and, after Skip, a four
 * other than the one skipped). So a player with more games is never picked
 * while one with fewer is left out, unless a rule makes that the only game
 * possible: a keep-together partner can pull their partner in from a higher
 * tier, and a keep-apart clash or an unavailable partner can hold a required
 * player back. When no tier fits, the whole queue is the pool (only the
 * skipped four, or nothing, can be left by then).
 */
export interface FairPool {
  required: QueueEntry[]
  optional: QueueEntry[]
}

/** The queue (already fewest games first) cut into runs of equal games played. */
function tiers(queue: readonly QueueEntry[]): QueueEntry[][] {
  return queue.reduce<QueueEntry[][]>((out, entry) => {
    const lastTier = out[out.length - 1]
    return lastTier && lastTier[0].games === entry.games
      ? [...out.slice(0, -1), [...lastTier, entry]]
      : [...out, [entry]]
  }, [])
}

export function fairPool(queue: readonly QueueEntry[], rules: ActiveRules, exclude?: readonly string[]): FairPool {
  const available = new Set(queue.map((e) => e.player.id))
  let required: QueueEntry[] = []
  for (const tier of tiers(queue)) {
    if (pickFresh([...required, ...tier].map((e) => e.player.id), rules, available, exclude)) return { required, optional: tier }
    required = [...required, ...tier]
  }
  return { required: [], optional: [...queue] }
}

/** The pool in seating preference: required first, then optional in the order given. */
export function poolIds(pool: FairPool, optional: readonly QueueEntry[] = pool.optional): string[] {
  return [...pool.required, ...optional].map((e) => e.player.id)
}

/** pickFour, but never the skipped four: null when that is the only one left. */
export function pickFresh(order: readonly string[], rules: ActiveRules, available: ReadonlySet<string>, exclude?: readonly string[]): string[] | null {
  const four = pickFour(order, rules, exclude, available)
  return four && (!exclude || setKey(four) !== setKey(exclude)) ? four : null
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

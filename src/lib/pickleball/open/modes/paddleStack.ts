import { pairKey, type PartnerHistory, type QueueEntry } from '../fairness'
import type { Team } from '../types'

export interface Proposal {
  teamA: Team
  teamB: Team
}

const SPLITS: ReadonlyArray<readonly [number, number, number, number]> = [
  [0, 1, 2, 3],
  [0, 2, 1, 3],
  [0, 3, 1, 2],
]

/**
 * Chooses the split of four with the fewest repeated partners; opponent repeats only break ties
 * (strict lexicographic, so a repeated partnership never beats a split that avoids it).
 */
export function splitTeams(four: readonly string[], history: PartnerHistory): Proposal {
  const scored = SPLITS.map(([a, b, c, d]) => {
    const teamA: Team = [four[a], four[b]]
    const teamB: Team = [four[c], four[d]]
    const partnerCost = (history.partners.get(pairKey(...teamA)) ?? 0) + (history.partners.get(pairKey(...teamB)) ?? 0)
    const opponentCost = teamA.reduce((sum, x) => sum + teamB.reduce((s, y) => s + (history.opponents.get(pairKey(x, y)) ?? 0), 0), 0)
    return { proposal: { teamA, teamB }, partnerCost, opponentCost }
  })
  return scored.reduce((best, next) => (
    next.partnerCost < best.partnerCost || (next.partnerCost === best.partnerCost && next.opponentCost < best.opponentCost) ? next : best
  )).proposal
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|')
}

export function proposePaddleStack(
  queue: readonly QueueEntry[],
  history: PartnerHistory,
  exclude?: readonly string[],
): Proposal | null {
  if (queue.length < 4) return null
  const first = queue.slice(0, 4).map((entry) => entry.player.id)
  const four = exclude && queue.length > 4 && sameSet(first, exclude)
    ? [...first.slice(0, 3), queue[4].player.id]
    : first
  return splitTeams(four, history)
}

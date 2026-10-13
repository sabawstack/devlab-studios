// src/lib/pickleball/open/modes/paddleStack.ts
import { pairKey, type PartnerHistory, type QueueEntry } from '../fairness'
import { honoursTogether, NO_RULES, pickFour, type ActiveRules } from '../rules'
import type { OpenSessionState, Team } from '../types'

export interface Proposal {
  teamA: Team
  teamB: Team
  /** Set only for a tournament game: the fixture this proposal plays. */
  fixtureId?: string
}

/** What every mode receives (built once per proposal by propose.ts). */
export interface ModeInput {
  state: OpenSessionState
  /** Available players in paddle-stack order: fewest games, then forced sit-outs, then longest wait (fairness.ts queueOrder). */
  queue: readonly QueueEntry[]
  history: PartnerHistory
  rules: ActiveRules
  /** Skip: the four just rejected. */
  exclude?: readonly string[]
}

export type ModeProposer = (input: ModeInput) => Proposal | null

/** The three ways to split four players into two teams. */
export function allSplits(four: readonly string[]): Proposal[] {
  const [a, b, c, d] = four
  return [
    { teamA: [a, b], teamB: [c, d] },
    { teamA: [a, c], teamB: [b, d] },
    { teamA: [a, d], teamB: [b, c] },
  ]
}

export function partnerCost(p: Proposal, history: PartnerHistory): number {
  return (history.partners.get(pairKey(...p.teamA)) ?? 0) + (history.partners.get(pairKey(...p.teamB)) ?? 0)
}

export function opponentCost(p: Proposal, history: PartnerHistory): number {
  return p.teamA.reduce((sum, x) => sum + p.teamB.reduce((s, y) => s + (history.opponents.get(pairKey(x, y)) ?? 0), 0), 0)
}

/**
 * The candidate with the fewest repeated partners; opponent repeats only break
 * ties (strict lexicographic, so a repeated partnership never beats a split that
 * avoids it). Candidates that would split a keep-together pair are dropped.
 * Returns null only when every candidate breaks a rule.
 */
export function bestSplit(candidates: readonly Proposal[], history: PartnerHistory, rules: ActiveRules = NO_RULES): Proposal | null {
  const scored = candidates
    .filter((p) => honoursTogether(p.teamA, p.teamB, rules))
    .map((proposal) => ({ proposal, partner: partnerCost(proposal, history), opponent: opponentCost(proposal, history) }))
  if (!scored.length) return null
  return scored.reduce((best, next) => (
    next.partner < best.partner || (next.partner === best.partner && next.opponent < best.opponent) ? next : best
  )).proposal
}

export function splitTeams(four: readonly string[], history: PartnerHistory, rules: ActiveRules = NO_RULES): Proposal {
  return bestSplit(allSplits(four), history, rules) ?? allSplits(four)[0]
}

export function proposePaddleStack({ queue, history, rules, exclude }: ModeInput): Proposal | null {
  const four = pickFour(queue.map((entry) => entry.player.id), rules, exclude)
  return four ? splitTeams(four, history, rules) : null
}

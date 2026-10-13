// src/lib/pickleball/open/modes/balanced.ts
// Balanced (spec §5.2): the four come from the fair pool (fewest games played,
// longest wait; see fairPool); the split minimises the difference in summed
// strength, and repeated partners break ties.
import { honoursTogether, pickFour } from '../rules'
import { computeStandings, type StandingRow } from '../standings'
import type { OpenPlayer } from '../types'
import { allSplits, opponentCost, partnerCost, splitTeams, type ModeInput, type Proposal } from './paddleStack'
import { fairPool, poolIds } from './shared'

/** The middle of the 1–5 self-report scale. */
export const NEUTRAL_STRENGTH = 3
const EPSILON = 1e-9

/**
 * The skill entered for the player (self-reported 1–5 at check-in, or a number
 * the host typed, such as a DUPR rating, up to 8); else today's win rate mapped
 * onto 1–5; else neutral. No rating is ever looked up anywhere.
 */
export function strength(player: OpenPlayer | undefined, row: StandingRow | undefined): number {
  if (player?.skill != null) return player.skill
  if (row?.winRate != null) return 1 + 4 * row.winRate
  return NEUTRAL_STRENGTH
}

export function proposeBalanced({ state, queue, history, rules, exclude }: ModeInput): Proposal | null {
  const four = pickFour(poolIds(fairPool(queue, rules, exclude)), rules, exclude, new Set(queue.map((e) => e.player.id)))
  if (!four) return null
  const rows = new Map(computeStandings(state.players, state.matches).map((row) => [row.playerId, row]))
  const power = (id: string) => strength(state.players.find((p) => p.id === id), rows.get(id))
  const scored = allSplits(four)
    .filter((p) => honoursTogether(p.teamA, p.teamB, rules))
    .map((proposal) => ({
      proposal,
      gap: Math.abs(power(proposal.teamA[0]) + power(proposal.teamA[1]) - power(proposal.teamB[0]) - power(proposal.teamB[1])),
      partner: partnerCost(proposal, history),
      opponent: opponentCost(proposal, history),
    }))
  if (!scored.length) return splitTeams(four, history, rules)
  return scored.reduce((best, next) => {
    if (next.gap < best.gap - EPSILON) return next
    if (next.gap > best.gap + EPSILON) return best
    return next.partner < best.partner || (next.partner === best.partner && next.opponent < best.opponent) ? next : best
  }).proposal
}

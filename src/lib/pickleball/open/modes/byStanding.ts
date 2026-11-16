// src/lib/pickleball/open/modes/byStanding.ts
// By standing (spec §5.2): rank the fair pool (fewest games played, longest
// wait; see fairPool) by today's standings, take the window of 4 adjacent
// ranks around the anchor (the first player who must go on: a lower games tier
// or an overdue sit-out; else the first in queue order: forced, then longest
// wait), and play 1st + 4th against 2nd + 3rd. Of the windows that qualify, the
// one whose four have met least wins (social.ts), then fewer repeat partners.
import { byWait, type QueueEntry } from '../fairness'
import { keepsRules, pickFour } from '../rules'
import { computeStandings } from '../standings'
import { opponentCost, partnerCost, splitTeams, type ModeInput, type Proposal } from './paddleStack'
import { fairPool, setKey } from './shared'
import { groupScore, meetings, splitPool } from './social'

/** 1st + 4th vs 2nd + 3rd of a rank-ordered four; the paddle-stack split if that would part a keep-together pair. */
function standingSplit(ranked: readonly string[], input: ModeInput): Proposal {
  const proposal: Proposal = { teamA: [ranked[0], ranked[3]], teamB: [ranked[1], ranked[2]] }
  return keepsRules(proposal.teamA, proposal.teamB, input.rules) ? proposal : splitTeams(ranked, input.history, input.rules)
}

function lexicographic(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return a[i] - b[i]
  return 0
}

/** Everything both the window search and the fallback read; null when fewer than four are due. */
function standingContext(input: ModeInput) {
  const { state, queue, rules, exclude } = input
  const pool = fairPool(queue, rules, exclude)
  const due = [...pool.required, ...pool.optional]
  if (due.length < 4) return null
  const rows = computeStandings(state.players, state.matches)
  const rankOf = new Map(rows.map((row, index) => [row.playerId, index]))
  const rank = (id: string) => rankOf.get(id) ?? rows.length
  const ranked = [...due].sort((a, b) => rank(a.player.id) - rank(b.player.id) || byWait(a, b))
  // Fairness outranks the standings: a window must seat every required player
  // (lower games tiers, then overdue sit-outs; see social.ts overdueAfter).
  const { required: must, rest } = splitPool(pool, state)
  const required = must.map((e) => e.player.id)
  const anchor: QueueEntry = must[0] ?? rest[0]
  return { rank, ranked, required, rest, anchor }
}

type StandingContext = NonNullable<ReturnType<typeof standingContext>>

/** The qualifying window of four adjacent ranks whose four have met least; null when none qualifies. */
function bestWindow(input: ModeInput, { ranked, required, anchor }: StandingContext): string[] | null {
  const { state, history, rules, exclude } = input
  const met = meetings(state)
  const at = ranked.indexOf(anchor)
  const banned = exclude ? setKey(exclude) : null

  let best: { ids: string[]; score: number[] } | null = null
  for (let start = Math.max(0, at - 3); start <= Math.min(at, ranked.length - 4); start += 1) {
    const window = ranked.slice(start, start + 4)
    const ids = window.map((e) => e.player.id)
    if (banned !== null && setKey(ids) === banned) continue
    if (required.slice(0, 4).some((id) => !ids.includes(id))) continue
    const proposal = standingSplit(ids, input)
    if (!keepsRules(proposal.teamA, proposal.teamB, rules)) continue
    const score = [
      groupScore(ids, met),
      partnerCost(proposal, history),
      opponentCost(proposal, history),
      start,
    ]
    if (!best || lexicographic(score, best.score) < 0) best = { ids, score }
  }
  return best?.ids ?? null
}

/**
 * True when the proposal would come from a standings window rather than the
 * rank-distance fallback. Read-only; used by outlook.ts, which can only say who
 * is next when the choice depends on relative ranks alone.
 */
export function byStandingUsesWindow(input: ModeInput): boolean {
  const context = standingContext(input)
  return context !== null && bestWindow(input, context) !== null
}

export function proposeByStanding(input: ModeInput): Proposal | null {
  const context = standingContext(input)
  if (!context) return null
  const window = bestWindow(input, context)
  if (window) return standingSplit(window, input)

  // No window seats every required player within the rules: required players
  // first, then the optional ones nearest in rank to the anchor.
  const { rank, required, rest, anchor } = context
  const anchorRank = rank(anchor.player.id)
  const nearest = [...rest].sort((a, b) => Math.abs(rank(a.player.id) - anchorRank) - Math.abs(rank(b.player.id) - anchorRank))
  const four = pickFour([...required, ...nearest.map((e) => e.player.id)], input.rules, input.exclude, new Set(input.queue.map((e) => e.player.id)))
  if (!four) return null
  return standingSplit([...four].sort((a, b) => rank(a) - rank(b)), input)
}

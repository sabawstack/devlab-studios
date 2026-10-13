// src/lib/pickleball/open/modes/byStanding.ts
// By standing (spec §5.2): rank the fair pool (fewest games played, longest
// wait; see fairPool) by today's standings, take the window of 4 adjacent
// ranks around the anchor (the first player who must go on: a lower games tier
// or a forced sit-out; else the longest-waiting in the pool), and play 1st +
// 4th against 2nd + 3rd.
import { byWait, type QueueEntry } from '../fairness'
import { keepsRules, pickFour } from '../rules'
import { computeStandings } from '../standings'
import { opponentCost, partnerCost, splitTeams, type ModeInput, type Proposal } from './paddleStack'
import { fairPool, setKey } from './shared'

/** 1st + 4th vs 2nd + 3rd of a rank-ordered four; the paddle-stack split if that would part a keep-together pair. */
function standingSplit(ranked: readonly string[], input: ModeInput): Proposal {
  const proposal: Proposal = { teamA: [ranked[0], ranked[3]], teamB: [ranked[1], ranked[2]] }
  return keepsRules(proposal.teamA, proposal.teamB, input.rules) ? proposal : splitTeams(ranked, input.history, input.rules)
}

function lexicographic(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return a[i] - b[i]
  return 0
}

export function proposeByStanding(input: ModeInput): Proposal | null {
  const { state, queue, history, rules, exclude } = input
  const pool = fairPool(queue, rules, exclude)
  const due = [...pool.required, ...pool.optional]
  if (due.length < 4) return null
  const rows = computeStandings(state.players, state.matches)
  const rankOf = new Map(rows.map((row, index) => [row.playerId, index]))
  const rank = (id: string) => rankOf.get(id) ?? rows.length
  const ranked = [...due].sort((a, b) => rank(a.player.id) - rank(b.player.id) || byWait(a, b))
  // Fairness outranks the standings: a window must seat every required player
  // (lower games tiers, then the sit-out guard's forced players).
  const must = [...pool.required, ...pool.optional.filter((e) => e.forced)]
  const required = must.map((e) => e.player.id)
  const anchor: QueueEntry = must[0] ?? [...pool.optional].sort(byWait)[0]
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
      window.reduce((sum, e) => sum + e.games, 0),
      partnerCost(proposal, history),
      opponentCost(proposal, history),
      start,
    ]
    if (!best || lexicographic(score, best.score) < 0) best = { ids, score }
  }
  if (best) return standingSplit(best.ids, input)

  // No window seats every required player within the rules: required players
  // first, then the optional ones nearest in rank to the anchor.
  const anchorRank = rank(anchor.player.id)
  const nearest = pool.optional.filter((e) => !e.forced).sort((a, b) => Math.abs(rank(a.player.id) - anchorRank) - Math.abs(rank(b.player.id) - anchorRank))
  const four = pickFour([...required, ...nearest.map((e) => e.player.id)], rules, exclude, new Set(queue.map((e) => e.player.id)))
  if (!four) return null
  return standingSplit([...four].sort((a, b) => rank(a) - rank(b)), input)
}

// src/lib/pickleball/open/modes/social.ts
// Social rotation: when the fair pool holds more players than a game needs
// (all on the same games count), every mode chooses the four that have met
// least, so the same group does not keep coming back together. Fairness is
// untouched: only players the fair pool already allows are considered.
import { pairKey, SIT_OUT_LIMIT, type QueueEntry } from '../fairness'
import { pickFour, type ActiveRules } from '../rules'
import type { OpenSessionState } from '../types'
import type { ModeInput } from './paddleStack'
import { fairPool, poolIds, setKey, type FairPool } from './shared'

/**
 * Candidates considered from the tier, in queue order (forced first, then
 * longest wait). C(12, 4) = 495 fours at most, so a proposal stays well under
 * a millisecond even at 128 players on 16 courts.
 */
export const SOCIAL_CANDIDATES = 12

/**
 * Rounds out in a row after which a player MUST go on. With P active players
 * on C courts a full rotation takes cycle = ceil(P / 4C) rounds, so sitting
 * out cycle - 1 rounds between games is unavoidable. The guard (2) or that
 * natural wait, whichever is longer, may be exceeded by one round so the mode
 * (winners and losers games) and the group mixing have room to work. A fixed
 * 2-round limit decides the whole session at 12 players a court: the four who
 * played first have always sat out 2 by the fourth game, so they would replay
 * together forever.
 */
export function overdueAfter(state: OpenSessionState): number {
  const players = state.players.filter((p) => p.status === 'ACTIVE').length
  const courts = Math.max(1, state.courts.filter((c) => c.enabled).length)
  return Math.max(SIT_OUT_LIMIT, Math.ceil(players / (4 * courts)) - 1)
}

/** How often each pair has shared a court (as partners or opponents), with each player's latest game. */
export interface Meetings {
  count: ReadonlyMap<string, number>
  /** pairKeys of players who were in each other's most recent game. */
  recent: ReadonlySet<string>
}

/** Built once per proposal from started and finished games; nothing shared is mutated. */
export function meetings(state: OpenSessionState): Meetings {
  const count = new Map<string, number>()
  const latest = new Map<string, { seq: number; ids: readonly string[] }>()
  for (const m of state.matches) {
    if (m.status !== 'IN_PROGRESS' && m.status !== 'FINISHED') continue
    const ids = [...m.teamA, ...m.teamB]
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) count.set(pairKey(ids[i], ids[j]), (count.get(pairKey(ids[i], ids[j])) ?? 0) + 1)
      const prev = latest.get(ids[i])
      if (!prev || m.seq > prev.seq) latest.set(ids[i], { seq: m.seq, ids })
    }
  }
  const recent = new Set<string>()
  for (const [id, game] of latest) for (const other of game.ids) if (other !== id) recent.add(pairKey(id, other))
  return { count, recent }
}

/** Repeats among a four: every earlier meeting of each pair, and their latest game together counts double. */
export function groupScore(four: readonly string[], met: Meetings): number {
  let score = 0
  for (let i = 0; i < four.length; i += 1) {
    for (let j = i + 1; j < four.length; j += 1) {
      const key = pairKey(four[i], four[j])
      score += (met.count.get(key) ?? 0) + (met.recent.has(key) ? 1 : 0)
    }
  }
  return score
}

function fitsRules(four: readonly string[], rules: ActiveRules): boolean {
  return four.every((x, i) => {
    const partner = rules.partnerOf.get(x)
    if (partner !== undefined && !four.includes(partner)) return false
    return four.slice(i + 1).every((y) => !rules.apart.has(pairKey(x, y)))
  })
}

/** Every way to choose `size` of `items`, in order (iterative: no intermediate arrays). */
function combinations<T>(items: readonly T[], size: number): T[][] {
  if (size > items.length) return []
  const out: T[][] = []
  const pick = Array.from({ length: size }, (_, i) => i)
  for (;;) {
    out.push(pick.map((i) => items[i]))
    let k = size - 1
    while (k >= 0 && pick[k] === items.length - size + k) k -= 1
    if (k < 0) return out
    pick[k] += 1
    for (let j = k + 1; j < size; j += 1) pick[j] = pick[j - 1] + 1
  }
}

export interface SocialChoice {
  /** Must all play (lower games tiers, overdue sit-outs). */
  required: readonly QueueEntry[]
  /** Who may fill the rest of the four, in preference order (forced first, then longest wait). */
  candidates: readonly QueueEntry[]
  /** Everyone else on the same games count (for the look-ahead); defaults to the candidates. */
  tier?: readonly QueueEntry[]
  rules: ActiveRules
  met: Meetings
  exclude?: readonly string[]
  /**
   * Candidates at or past this many rounds out are preferred over mixing
   * (leaving fewer of them out beats a lower repeat score). Winners mode uses
   * it so the longest-waiting winners and losers go before they turn overdue
   * and force a mixed game; the other modes leave it unset.
   */
  urgentAt?: number
}

/** Tiers this small are split with a look-ahead (C(8, 4) / 2 = 35 splits of what is left). */
export const LOOKAHEAD_TIER = 12

/** Pair weights (meetings, latest game doubled) among a few players, looked up by index. */
function pairMatrix(ids: readonly string[], met: Meetings): number[][] {
  return ids.map((x) => ids.map((y) => (x === y ? 0 : groupScore([x, y], met))))
}

function scoreOf(four: readonly number[], w: readonly number[][]): number {
  const [a, b, c, d] = four
  return w[a][b] + w[a][c] + w[a][d] + w[b][c] + w[b][d] + w[c][d]
}

/**
 * The lowest repeat score the players left behind can still reach: 0 when
 * they are not exactly one or two more games, else the best way to group them.
 * Without it, greedily taking the four who have met least leaves the four who
 * have met most for the tier's last game, which locks that group in.
 */
function leftoverScore(left: readonly number[], w: readonly number[][]): number {
  if (left.length === 4) return scoreOf(left, w)
  if (left.length !== 8) return 0
  const [first, ...others] = left
  let best = Infinity
  for (const trio of combinations(others, 3)) {
    const four = [first, ...trio]
    best = Math.min(best, scoreOf(four, w) + scoreOf(left.filter((i) => !four.includes(i)), w))
  }
  return best
}

/**
 * The four with every required player plus the candidates that have met each
 * other (and them) least, counting what that leaves for the tier's remaining
 * games when the tier is small; ties go to the longest-waiting. Only fours that
 * keep every rule within these players are considered, never the skipped four.
 * Returns null when none fits: the caller then falls back to pickFour, which
 * can pull a keep-together partner in from outside the pool.
 */
export function socialFour({ required, candidates, tier = candidates, rules, met, exclude, urgentAt }: SocialChoice): string[] | null {
  const base = required.slice(0, 4).map((e) => e.player.id)
  const banned = exclude ? setKey(exclude) : null
  const capped = candidates.slice(0, SOCIAL_CANDIDATES)
  const pool = capped.map((e) => e.player.id)
  const urgent = capped.map((e) => urgentAt !== undefined && e.satOut >= urgentAt)
  const urgentTotal = urgent.filter(Boolean).length
  const tierIds = [...new Set([...required, ...tier].map((e) => e.player.id))]
  const lookahead = tierIds.length <= LOOKAHEAD_TIER
  // Index layout: base first, then the pool, then the rest of the tier.
  const ids = [...new Set([...base, ...pool, ...(lookahead ? tierIds : [])])]
  const index = new Map(ids.map((id, i) => [id, i]))
  const w = pairMatrix(ids, met)
  const everyone = lookahead ? tierIds.map((id) => index.get(id)!) : []
  const baseIdx = base.map((id) => index.get(id)!)
  const poolIdx = pool.map((id) => index.get(id)!)
  const hasRules = rules.partnerOf.size > 0 || rules.apart.size > 0
  let best: { four: string[]; missed: number; score: number; wait: number } | null = null
  for (const combo of combinations(poolIdx.map((_, i) => i), 4 - base.length)) {
    const missed = urgentTotal - combo.filter((i) => urgent[i]).length
    if (best && missed > best.missed) continue
    const fourIdx = [...baseIdx, ...combo.map((i) => poolIdx[i])]
    const own = scoreOf(fourIdx, w)
    if (best && missed === best.missed && own > best.score) continue
    const four = fourIdx.map((i) => ids[i])
    if ((hasRules && !fitsRules(four, rules)) || (banned !== null && setKey(four) === banned)) continue
    const score = own + (lookahead ? leftoverScore(everyone.filter((i) => !fourIdx.includes(i)), w) : 0)
    const wait = combo.reduce((sum, i) => sum + i, 0)
    const better = !best || missed < best.missed
      || (missed === best.missed && (score < best.score || (score === best.score && wait < best.wait)))
    if (better) best = { four, missed, score, wait }
  }
  return best?.four ?? null
}

/** The fair pool split for social choice: who must play, and the rest of the tier to choose from. */
export function splitPool(pool: FairPool, state: OpenSessionState): { required: QueueEntry[]; overdue: QueueEntry[]; rest: QueueEntry[] } {
  const limit = overdueAfter(state)
  const overdue = pool.optional.filter((e) => e.satOut > limit)
  return { required: [...pool.required, ...overdue], overdue, rest: pool.optional.filter((e) => !overdue.includes(e)) }
}

/**
 * Fair first, then social: the four from the fair pool that have met least
 * (see socialFour); pickFour in queue order when no four fits the rules
 * inside the pool. Used by paddle stack and balanced.
 */
export function fairSocialFour({ state, queue, rules, exclude }: ModeInput): string[] | null {
  const pool = fairPool(queue, rules, exclude)
  const { required, overdue, rest } = splitPool(pool, state)
  return socialFour({ required, candidates: rest, rules, met: meetings(state), exclude })
    ?? pickFour(poolIds(pool, [...overdue, ...rest]), rules, exclude, new Set(queue.map((e) => e.player.id)))
}

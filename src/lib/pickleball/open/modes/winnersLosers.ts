// src/lib/pickleball/open/modes/winnersLosers.ts
// Winners play winners, losers play losers (spec §5.2), with the shuffle the
// owner chose: two winning teams (A1,A2) and (B1,B2) play A1+B1 vs A2+B2, so
// previous partners become opponents. Same for losers.
//
// Fair first, then mode: the four always come from the fair pool (fewest games
// played, longest wait), so winners never jump ahead of losers who have played
// less. Within the pool: four winners if there are four, else four losers,
// else a mixed game. On one court this alternates winners, losers, winners.
import { SIT_OUT_LIMIT } from '../fairness'
import { pickFour } from '../rules'
import { allSplits, bestSplit, splitTeams, type ModeInput, type Proposal } from './paddleStack'
import { fairPool, pickFresh, poolIds, setKey, type LastGame, lastGames, type ResultTag } from './shared'

const TAG_GAMES: readonly ResultTag[] = ['W', 'L']

/** The two shuffled splits when the four are two intact teams from their last games; otherwise none. */
export function shuffledSplits(four: readonly string[], last: ReadonlyMap<string, LastGame>): Proposal[] {
  const teammates = four.map((id) => last.get(id)?.teammate ?? null)
  if (teammates.some((mate) => mate === null || !four.includes(mate))) return []
  const previous = new Set(four.map((id, i) => setKey([id, teammates[i]!])))
  return allSplits(four).filter((p) => !previous.has(setKey(p.teamA)) && !previous.has(setKey(p.teamB)))
}

export function proposeWinnersLosers({ state, queue, history, rules, exclude }: ModeInput): Proposal | null {
  const last = lastGames(state)
  const tagOf = (id: string) => last.get(id)?.tag ?? 'N'
  const available = new Set(queue.map((e) => e.player.id))
  const pool = fairPool(queue, rules, exclude)
  // Queue order: forced sit-outs first, then longest wait. Within the tier a
  // player forced after 2 rounds out is preferred but does not stop a winners
  // or losers game (at 12 players a court that would freeze the same four
  // together forever); one who has sat out 3 rounds is required.
  const optional = pool.optional
  const overdue = optional.filter((e) => e.satOut > SIT_OUT_LIMIT)
  const firsts = [...pool.required, ...overdue]
  let four: string[] | null = null
  for (const tag of TAG_GAMES) {
    // A required player who does not carry this tag rules the game out: they go on first.
    if (firsts.some((e) => tagOf(e.player.id) !== tag)) continue
    const members = optional.filter((e) => tagOf(e.player.id) === tag)
    if (pool.required.length + members.length < 4) continue
    four = pickFresh(poolIds(pool, [...overdue, ...members.filter((e) => !overdue.includes(e))]), rules, available, exclude)
    if (four && four.every((id) => tagOf(id) === tag)) break
    four = null
  }
  four ??= pickFour(poolIds(pool, [...overdue, ...optional.filter((e) => !overdue.includes(e))]), rules, exclude, available)
  if (!four) return null
  return bestSplit(shuffledSplits(four, last), history, rules) ?? splitTeams(four, history, rules)
}

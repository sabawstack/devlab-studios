// src/lib/pickleball/open/modes/winnersLosers.ts
// Winners play winners, losers play losers (spec §5.2), with the shuffle the
// owner chose: two winning teams (A1,A2) and (B1,B2) play A1+B1 vs A2+B2, so
// previous partners become opponents. Same for losers.
import { byWait } from '../fairness'
import { pickFour } from '../rules'
import { allSplits, bestSplit, splitTeams, type ModeInput, type Proposal } from './paddleStack'
import { dueWindow, lastGames, setKey, type LastGame, type ResultTag } from './shared'

const POOLS: ReadonlyArray<readonly ResultTag[]> = [['W'], ['L'], ['L', 'N']]

/** The two shuffled splits when the four are two intact teams from their last games; otherwise none. */
export function shuffledSplits(four: readonly string[], last: ReadonlyMap<string, LastGame>): Proposal[] {
  const teammates = four.map((id) => last.get(id)?.teammate ?? null)
  if (teammates.some((mate) => mate === null || !four.includes(mate))) return []
  const previous = new Set(four.map((id, i) => setKey([id, teammates[i]!])))
  return allSplits(four).filter((p) => !previous.has(setKey(p.teamA)) && !previous.has(setKey(p.teamB)))
}

export function proposeWinnersLosers({ state, queue, history, rules, exclude }: ModeInput): Proposal | null {
  const last = lastGames(state)
  const due = dueWindow(queue)
  // The sit-out guard still applies: forced players come first in every pool.
  const forced = due.filter((e) => e.forced).map((e) => e.player.id)
  const available = new Set(queue.map((e) => e.player.id))
  const oldestFirst = due.filter((e) => !e.forced).sort(byWait)
  let four: string[] | null = null
  for (const pool of POOLS) {
    const members = oldestFirst.filter((e) => pool.includes(last.get(e.player.id)?.tag ?? 'N')).map((e) => e.player.id)
    if (forced.length + members.length < 4) continue
    four = pickFour([...forced, ...members], rules, exclude, available)
    if (four) break
  }
  four ??= pickFour(queue.map((e) => e.player.id), rules, exclude)
  if (!four) return null
  return bestSplit(shuffledSplits(four, last), history, rules) ?? splitTeams(four, history, rules)
}

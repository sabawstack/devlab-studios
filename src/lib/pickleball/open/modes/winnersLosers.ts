// src/lib/pickleball/open/modes/winnersLosers.ts
// Winners play winners, losers play losers (spec §5.2), with the shuffle the
// owner chose: two winning teams (A1,A2) and (B1,B2) play A1+B1 vs A2+B2, so
// previous partners become opponents. Same for losers.
//
// Fair first, then mode: the four always come from the fair pool (fewest games
// played), so winners never jump ahead of losers who have played less. Within
// the pool: four winners if there are four, else four losers, else a mixed
// game; each time the four who have met least (social.ts), then longest wait.
// On one court winners and losers games take turns.
import { pickFour } from '../rules'
import { allSplits, bestSplit, splitTeams, type ModeInput, type Proposal } from './paddleStack'
import { fairPool, poolIds, setKey, type LastGame, lastGames, type ResultTag } from './shared'
import { meetings, overdueAfter, socialFour, splitPool } from './social'

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
  // Required: lower games tiers, and anyone overdue (social.ts overdueAfter).
  // A forced player is otherwise only preferred, so a winners or losers game
  // can still go ahead of them. Within each game type the four who have met
  // least are chosen (socialFour).
  const { required, overdue, rest } = splitPool(pool, state)
  const met = meetings(state)
  // Anyone one more round from overdue goes first among their own kind.
  const urgentAt = overdueAfter(state)
  let four: string[] | null = null
  for (const tag of TAG_GAMES) {
    // A required player who does not carry this tag rules the game out: they go on first.
    if (required.some((e) => tagOf(e.player.id) !== tag)) continue
    const members = rest.filter((e) => tagOf(e.player.id) === tag)
    if (required.length + members.length < 4) continue
    four = socialFour({ required, candidates: members, tier: rest, rules, met, exclude, urgentAt })
    if (four) break
  }
  four ??= socialFour({ required, candidates: rest, rules, met, exclude, urgentAt })
    ?? pickFour(poolIds(pool, [...overdue, ...rest]), rules, exclude, available)
  if (!four) return null
  return bestSplit(shuffledSplits(four, last), history, rules) ?? splitTeams(four, history, rules)
}

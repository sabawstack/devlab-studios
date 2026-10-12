// One canonical order for entrants and fixtures. The repository reads rows
// back in exactly this order (no order column is stored), so memory and a
// reload from D1 always agree, and nextPlayableFixture's ties are stable.
import type { FixtureBracket, TournamentEntrant, TournamentFixture } from './types'

/** Plain code-unit order (pool labels are A–H): matches SQLite's BINARY collation, unlike localeCompare. */
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

const BRACKET_RANK: Record<FixtureBracket, number> = { POOL: 0, MAIN: 1, LOSERS: 2 }

/** Same order as the SQL: bracket (POOL, MAIN, LOSERS), pool label (null first), round, position, id. */
export function compareFixtures(a: TournamentFixture, b: TournamentFixture): number {
  return BRACKET_RANK[a.bracket] - BRACKET_RANK[b.bracket]
    || byText(a.poolLabel ?? '', b.poolLabel ?? '')
    || a.roundNumber - b.roundNumber
    || a.position - b.position
    || byText(a.id, b.id)
}

export function sortFixtures(fixtures: readonly TournamentFixture[]): TournamentFixture[] {
  return [...fixtures].sort(compareFixtures)
}

export function sortEntrants(entrants: readonly TournamentEntrant[]): TournamentEntrant[] {
  return [...entrants].sort((a, b) => a.seed - b.seed || byText(a.id, b.id))
}

export const FIXTURE_ORDER_SQL = `CASE bracket WHEN 'POOL' THEN 0 WHEN 'MAIN' THEN 1 ELSE 2 END, COALESCE(pool_label, ''), round_number, position, id`

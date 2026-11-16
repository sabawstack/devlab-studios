// src/pickleball-open/tournament/bracketLayout.js
// How the draw is laid out on screen: pools first (side by side on wide
// screens), then the bracket by round, then the losers bracket. Pure, so the
// grouping is unit-tested and the components only render it.

function byRound(fixtures) {
  const rounds = new Map()
  for (const f of fixtures) rounds.set(f.roundNumber, [...(rounds.get(f.roundNumber) ?? []), f])
  return [...rounds.entries()]
    .sort(([a], [b]) => a - b)
    .map(([round, games]) => ({ round, title: games[0].round, games: [...games].sort((a, b) => a.position - b.position) }))
}

/** [{ key, label?, title, kind: 'pool' | 'rounds' | 'bracket', rounds: [{ round, title, games }] }]; label is the pool letter. */
export function drawSections(tournament) {
  if (!tournament) return []
  const pools = [...new Set(tournament.fixtures.filter((f) => f.bracket === 'POOL').map((f) => f.poolLabel))].sort()
  const main = tournament.fixtures.filter((f) => f.bracket === 'MAIN')
  const losers = tournament.fixtures.filter((f) => f.bracket === 'LOSERS')
  const isRoundRobin = tournament.format === 'ROUND_ROBIN'
  return [
    ...pools.map((label) => ({ key: `pool-${label}`, label, title: `Pool ${label}`, kind: 'pool', rounds: byRound(tournament.fixtures.filter((f) => f.poolLabel === label)) })),
    ...(main.length
      ? [{ key: 'main', title: isRoundRobin ? 'Games' : tournament.format === 'DOUBLE_ELIMINATION' ? 'Winners bracket' : 'Bracket', kind: isRoundRobin ? 'rounds' : 'bracket', rounds: byRound(main) }]
      : []),
    ...(losers.length ? [{ key: 'losers', title: 'Losers bracket', kind: 'bracket', rounds: byRound(losers) }] : []),
  ]
}

/**
 * Games ready to play with no court yet, in the order free courts take them,
 * each with `held` ('PAIR_PLAYING' | 'ON_BREAK' | null). A lookup into the
 * server's own list (tournament.comingUp, PB-TOURNAMENT-01): the order and the
 * busy and break rules are the server's, never recomputed here.
 */
export function nextGames(tournament, limit = 4) {
  if (!tournament || tournament.phase !== 'RUNNING') return []
  const byId = new Map(tournament.fixtures.map((f) => [f.id, f]))
  return (tournament.comingUp ?? [])
    .map(({ fixtureId, held }) => (byId.has(fixtureId) ? { ...byId.get(fixtureId), held } : null))
    .filter(Boolean)
    .slice(0, limit)
}

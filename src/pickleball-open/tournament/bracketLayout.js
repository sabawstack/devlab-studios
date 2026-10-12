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

/** Games ready to play with no court yet, earliest round first: the order free courts take them in. */
export function nextGames(tournament, limit = 4) {
  if (!tournament || tournament.phase !== 'RUNNING') return []
  return tournament.fixtures
    .filter((f) => f.status === 'READY' && !f.court)
    .sort((a, b) => a.roundNumber - b.roundNumber || a.position - b.position)
    .slice(0, limit)
}

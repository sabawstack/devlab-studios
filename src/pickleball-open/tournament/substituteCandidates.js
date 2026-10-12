// src/pickleball-open/tournament/substituteCandidates.js
// Who can come on as a substitute: checked-in players in no pair, those on a
// break first (they are the likeliest reason to substitute), then the rest,
// each group by name. A pair is on court while one of its players is in a
// game in progress (a proposed game is not on court: spec §6.5).
const byName = (a, b) => a.name.localeCompare(b.name)

export function substituteCandidates(tournament, players) {
  const paired = new Set(tournament.pairs.flatMap((p) => p.playerIds))
  const free = players.filter((p) => p.status !== 'LEFT' && !paired.has(p.id))
  return [...free.filter((p) => p.status === 'BREAK').sort(byName), ...free.filter((p) => p.status !== 'BREAK').sort(byName)]
}

export function pairsOnCourt(tournament, playingIds) {
  return new Set(tournament.pairs.filter((p) => p.playerIds.some((id) => playingIds.has(id))).map((p) => p.id))
}

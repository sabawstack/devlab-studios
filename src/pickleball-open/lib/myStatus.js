// src/pickleball-open/lib/myStatus.js
/** A tournament player's next unplayed game, or that their games are done (spec §7 "You're up next"). */
function tournamentStatus(tournament, playerId) {
  const pair = tournament.pairs.find((p) => p.playerIds.includes(playerId))
  if (!pair || tournament.phase === 'SETUP' || tournament.phase === 'DRAFT') return { kind: 'NONE' }
  const next = tournament.fixtures.find((f) => (f.entrantAId === pair.id || f.entrantBId === pair.id) && f.status !== 'FINISHED' && f.status !== 'BYE')
  return next ? { kind: 'NEXT_GAME', label: next.label } : { kind: 'DONE' }
}

/** Where the player who picked "I'm …" on this phone is right now. */
export function myStatus(viewer, playerId) {
  const me = viewer?.roster?.find((p) => p.id === playerId)
  if (!me) return { kind: 'NONE' }
  for (const court of viewer.courts) {
    if (![...court.teamA, ...court.teamB].includes(me.name)) continue
    if (court.state === 'PLAYING') return { kind: 'PLAYING', court: court.label }
    if (court.state === 'UP_NEXT') return { kind: 'UP_NEXT', court: court.label }
  }
  if (viewer.onBreak.some((p) => p.id === playerId)) return { kind: 'BREAK' }
  if (viewer.tournament) return tournamentStatus(viewer.tournament, playerId)
  const place = viewer.waiting.findIndex((w) => w.id === playerId)
  if (place >= 0) return { kind: 'WAITING', place: place + 1 }
  return { kind: 'NONE' }
}

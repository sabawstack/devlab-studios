// src/pickleball-open/lib/myStatus.js
/** Where the player who picked "I'm …" on this phone is right now. */
export function myStatus(viewer, playerId) {
  const me = viewer?.roster?.find((p) => p.id === playerId)
  if (!me) return { kind: 'NONE' }
  for (const court of viewer.courts) {
    if (![...court.teamA, ...court.teamB].includes(me.name)) continue
    if (court.state === 'PLAYING') return { kind: 'PLAYING', court: court.label }
    if (court.state === 'UP_NEXT') return { kind: 'UP_NEXT', court: court.label }
  }
  const place = viewer.waiting.findIndex((w) => w.id === playerId)
  if (place >= 0) return { kind: 'WAITING', place: place + 1 }
  if (viewer.onBreak.some((p) => p.id === playerId)) return { kind: 'BREAK' }
  return { kind: 'NONE' }
}

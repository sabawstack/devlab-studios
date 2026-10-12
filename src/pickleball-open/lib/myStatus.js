// src/pickleball-open/lib/myStatus.js
const OVER = new Set(['FINISHED', 'BYE'])
/** Bracket losses a pair can take before it is out (pool games never knock a pair out). */
const LIVES = { SINGLE_ELIMINATION: 1, POOL_TO_BRACKET: 1, DOUBLE_ELIMINATION: 2 }

const plays = (f, pairId) => f.entrantAId === pairId || f.entrantBId === pairId
const lost = (f, pairId) => f.status === 'FINISHED' && f.winner !== null && f.winner !== undefined
  && (f.winner === 'A' ? f.entrantBId : f.entrantAId) === pairId

/** Whether a pair with no game placed can still play: it is only out once it cannot (spec §7 "You're up next"). */
function isOut(tournament, pairId) {
  const { fixtures, format } = tournament
  const bracketGames = fixtures.filter((f) => f.bracket !== 'POOL')
  const losses = bracketGames.filter((f) => lost(f, pairId)).length
  if (LIVES[format] && losses >= LIVES[format]) return true
  // Pools resolved and the pair was not drawn into the bracket: it did not qualify.
  if (format === 'POOL_TO_BRACKET') return !bracketGames.some((f) => plays(f, pairId))
  // Round robin: every game is drawn up front, so no game left means done.
  return format === 'ROUND_ROBIN'
}

/** A tournament player's next game, a wait for other results, or that their games are really done. */
function tournamentStatus(tournament, playerId) {
  const pair = tournament.pairs.find((p) => p.playerIds.includes(playerId))
  if (!pair || tournament.phase === 'SETUP' || tournament.phase === 'DRAFT') return { kind: 'NONE' }
  if (tournament.phase === 'FINISHED') return { kind: 'DONE' }
  const next = tournament.fixtures.find((f) => plays(f, pair.id) && !OVER.has(f.status))
  if (next) return { kind: 'NEXT_GAME', label: next.label }
  const poolsRunning = tournament.fixtures.some((f) => f.bracket === 'POOL' && !OVER.has(f.status))
  if (poolsRunning) return { kind: 'WAITING_POOLS' }
  return isOut(tournament, pair.id) ? { kind: 'DONE' } : { kind: 'WAITING_RESULTS' }
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

/** The status banner, greeting the player by first name ("Hi Ana! You're #3 in line"); null when there is nothing to say. */
export function statusText(status, name) {
  const first = String(name ?? '').trim().split(/\s+/)[0] || 'there'
  switch (status.kind) {
    case 'PLAYING': return `Hi ${first}, you're playing on ${status.court}`
    case 'UP_NEXT': return `Hi ${first}, you're up on ${status.court}: walk on`
    case 'WAITING': return `Hi ${first}! You're #${status.place} in line`
    case 'BREAK': return `Hi ${first}, you're on a break`
    case 'NEXT_GAME': return `Hi ${first}, your next game: ${status.label}`
    case 'WAITING_POOLS': return `Hi ${first}, waiting for the pools to finish`
    case 'WAITING_RESULTS': return `Hi ${first}, waiting for other results to set your next game`
    case 'DONE': return `Hi ${first}! Your games are done. Thanks for playing!`
    default: return null
  }
}

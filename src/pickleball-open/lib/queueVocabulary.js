// One vocabulary for the queue on every screen (PB-QUEUE-01): host, player
// board, TV and captain import these words from here and nowhere else.
//
//   Playing        match IN_PROGRESS          "Playing · Court 2"
//   Up next        match PROPOSED on a court  "Up next · Court 2 · walk on now"
//   Next four      viewer.nextUp non-null     "Next four · when a court opens"
//   Waiting        active, in no match        "Waiting · order can change"
//   On break       status BREAK               "On break"
//
// "Up next" means a confirmed call (a PROPOSED match on a court) and nothing
// else. The waiting list is a priority order, never a promise: no screen shows
// a place number. When the data may be stale (freshness unknown), nothing is
// phrased as an instruction to walk on (PB-REALTIME-02).

export const PLAYING = 'Playing'
export const UP_NEXT = 'Up next'
export const WALK_ON = 'walk on now'
export const NEXT_FOUR = 'Next four'
export const NEXT_FOUR_WHEN = 'when a court opens'
export const WAITING = 'Waiting'
export const WAITING_NOTE = 'order can change'
export const ON_BREAK = 'On break'

/** The rule, in words, wherever the waiting list is shown (PB-QUEUE-03). */
export const QUEUE_RULE = 'Fewest games go first. The next four are picked when a court opens.'
/** Every court is playing and the next four are not fixed yet. */
export const UNDECIDED = 'The next four are decided when a game ends.'

export const playingLabel = (court) => `${PLAYING} · ${court}`
/** A confirmed call. `fresh: false` drops the instruction: the call may have changed since. */
export const upNextLabel = (court, { fresh = true } = {}) => (fresh ? `${UP_NEXT} · ${court} · ${WALK_ON}` : `${UP_NEXT} · ${court}`)
export const nextFourLabel = () => `${NEXT_FOUR} · ${NEXT_FOUR_WHEN}`
export const waitingLabel = () => `${WAITING} · ${WAITING_NOTE}`

/** A court tile's state line; the court's own label is already on the tile. */
export function courtStateLabel(court, { fresh = true } = {}) {
  if (court.state === 'PLAYING') return PLAYING
  if (court.state === 'UP_NEXT') return fresh ? `${UP_NEXT} · ${WALK_ON}` : UP_NEXT
  if (court.state === 'OFF') return 'Off'
  return IDLE_LABEL[court.idle] ?? IDLE_LABEL.TOO_FEW_PLAYERS
}

/** Why an enabled court is empty (viewer.courts[].idle), in words a player can act on. */
export const IDLE_LABEL = {
  TOO_FEW_PLAYERS: 'Waiting for players',
  WAITING_FOR_HOST: 'Waiting for the host',
  TOURNAMENT_NOT_STARTED: 'Starts when the tournament starts',
  WAITING_FOR_RESULT: 'Waiting for a result',
  PLAYER_ON_BREAK: 'Waiting for a player on a break',
  SESSION_OVER: 'Session over',
}

/** Why a ready tournament game is not on a court yet (tournament.comingUp[].held). */
export const HELD_LABEL = {
  PAIR_PLAYING: 'Waits for a pair still playing',
  ON_BREAK: 'Waits for a player on a break',
}

/** True when every enabled court is playing (the moment the next four are picked when a game ends). */
export function allCourtsPlaying(viewer) {
  const enabled = viewer.courts.filter((c) => c.state !== 'OFF')
  return enabled.length > 0 && enabled.every((c) => c.state === 'PLAYING')
}

/** The line under the waiting list: why there is no next four yet, or null. */
export function waitingNote(viewer) {
  if (viewer.status !== 'ACTIVE' || viewer.kind === 'TOURNAMENT' || viewer.nextUp) return null
  return allCourtsPlaying(viewer) && viewer.waiting.length > 0 ? UNDECIDED : null
}

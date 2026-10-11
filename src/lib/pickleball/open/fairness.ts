import type { OpenMatch, OpenPlayer, OpenSessionState } from './types'

export const SIT_OUT_LIMIT = 2

export interface PartnerHistory {
  partners: ReadonlyMap<string, number>
  opponents: ReadonlyMap<string, number>
}

export interface QueueEntry {
  player: OpenPlayer
  games: number
  satOut: number
  forced: boolean
}

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

export function matchIncludes(match: OpenMatch, playerId: string): boolean {
  return match.teamA.includes(playerId) || match.teamB.includes(playerId)
}

export function gamesPlayed(player: OpenPlayer, matches: readonly OpenMatch[]): number {
  return player.gamesOffset + matches.filter((m) => m.status === 'FINISHED' && matchIncludes(m, player.id)).length
}

export function busyPlayerIds(matches: readonly OpenMatch[]): Set<string> {
  return new Set(
    matches
      .filter((m) => m.status === 'PROPOSED' || m.status === 'IN_PROGRESS')
      .flatMap((m) => [...m.teamA, ...m.teamB]),
  )
}

/** Rounds (started games per enabled court) the player has watched since they last became available. */
export function roundsSatOut(player: OpenPlayer, state: OpenSessionState): number {
  const courts = Math.max(1, state.courts.filter((c) => c.enabled).length)
  const since = Date.parse(player.waitingSince)
  const started = state.matches.filter(
    (m) => m.status !== 'PROPOSED' && Date.parse(m.proposedAt) > since && !matchIncludes(m, player.id),
  ).length
  return Math.floor(started / courts)
}

function increment(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1)
}

/** Builds fresh maps locally (copying per match is quadratic); nothing shared is mutated. */
export function pairingHistory(matches: readonly OpenMatch[]): PartnerHistory {
  const partners = new Map<string, number>()
  const opponents = new Map<string, number>()
  for (const m of matches) {
    if (m.status !== 'IN_PROGRESS' && m.status !== 'FINISHED') continue
    increment(partners, pairKey(m.teamA[0], m.teamA[1]))
    increment(partners, pairKey(m.teamB[0], m.teamB[1]))
    for (const a of m.teamA) for (const b of m.teamB) increment(opponents, pairKey(a, b))
  }
  return { partners, opponents }
}

export function byWait(a: QueueEntry, b: QueueEntry): number {
  return Date.parse(a.player.waitingSince) - Date.parse(b.player.waitingSince) || a.player.position - b.player.position
}

/** Per-session lookups built once per call; ranking is then O(players x matches) with small constants. */
function buildIndex(state: OpenSessionState) {
  const startedTimes: number[] = []
  const finishedGames = new Map<string, number>()
  const startedByPlayer = new Map<string, number[]>()
  for (const m of state.matches) {
    const ids = [...m.teamA, ...m.teamB]
    if (m.status === 'FINISHED') for (const id of ids) finishedGames.set(id, (finishedGames.get(id) ?? 0) + 1)
    if (m.status === 'PROPOSED') continue
    const t = Date.parse(m.proposedAt)
    startedTimes.push(t)
    for (const id of ids) {
      const list = startedByPlayer.get(id) ?? []
      list.push(t)
      startedByPlayer.set(id, list)
    }
  }
  return { startedTimes, finishedGames, startedByPlayer }
}

/** Available players in the order paddle stack would seat them. */
export function queueOrder(state: OpenSessionState): QueueEntry[] {
  const busy = busyPlayerIds(state.matches)
  const courts = Math.max(1, state.courts.filter((c) => c.enabled).length)
  const { startedTimes, finishedGames, startedByPlayer } = buildIndex(state)
  const after = (times: readonly number[], since: number) => times.filter((t) => t > since).length
  return state.players
    .filter((p) => p.status === 'ACTIVE' && !busy.has(p.id))
    .map((p) => {
      const since = Date.parse(p.waitingSince)
      const watched = after(startedTimes, since) - after(startedByPlayer.get(p.id) ?? [], since)
      const satOut = Math.floor(watched / courts)
      return { player: p, games: p.gamesOffset + (finishedGames.get(p.id) ?? 0), satOut, forced: satOut >= SIT_OUT_LIMIT }
    })
    .sort((a, b) => {
      if (a.forced !== b.forced) return a.forced ? -1 : 1
      if (a.forced) return byWait(a, b)
      return a.games - b.games || byWait(a, b)
    })
}

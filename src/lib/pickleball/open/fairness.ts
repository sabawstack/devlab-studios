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

/** Available players in the order paddle stack would seat them: fewest games, then forced sit-outs, then longest wait. */
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
    // Fair first: fewest games always goes first; within a games count the
    // sit-out guard's forced players lead, then longest wait. (Forced players
    // used to jump every games count, which let someone with more games play
    // while someone with fewer waited once a court had more than 12 players.)
    .sort((a, b) => a.games - b.games || Number(b.forced) - Number(a.forced) || byWait(a, b))
}

export interface FairnessSummary {
  /** Spec §5.5 "sit-out spread": most minus fewest games among active players (on break or left excluded). */
  sitOutSpread: number
  /** The available player waiting longest, if anyone is waiting. */
  longestWait: { playerId: string; name: string; since: string; rounds: number } | null
  /** Partnerships played more than once, counting every repeat (A+B three times counts 2). */
  repeatedPartners: number
}

export function fairnessSummary(state: OpenSessionState): FairnessSummary {
  const games = state.players.filter((p) => p.status === 'ACTIVE').map((p) => gamesPlayed(p, state.matches))
  const longest = [...queueOrder(state)].sort(byWait)[0]
  const repeats = [...pairingHistory(state.matches).partners.values()].reduce((sum, n) => sum + Math.max(0, n - 1), 0)
  return {
    sitOutSpread: games.length ? Math.max(...games) - Math.min(...games) : 0,
    longestWait: longest
      ? { playerId: longest.player.id, name: longest.player.name, since: longest.player.waitingSince, rounds: longest.satOut }
      : null,
    repeatedPartners: repeats,
  }
}

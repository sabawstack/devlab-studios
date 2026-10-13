// The final results screen (board, host console, TV), its share text and the
// board link's preview tags. Pure: built only from the allowlisted viewer
// snapshot, so it runs the same on a phone, the TV and the server.
//
// Open play ranks by the existing standings (win %, points won %, head-to-head,
// name); players still level share a place (1, 2, 2, 4). Tournaments: the
// final decides 1st and 2nd (round robin: the table); 3rd is the next pair in
// the table for round robin and pools, and the losers of the games that fed
// the final for knockouts (single elimination: both losing semi-finalists).
import type { ViewerSnapshot } from './snapshot'
import type { FixtureView, StandingView, TournamentView } from './tournament/view'

export interface ResultEntry {
  /** A player id (open play) or a pair's entrant id (tournaments). */
  id: string
  /** A player, or a pair as "Ana & Ben". */
  name: string
  place: number
  wins: number
  losses: number
  winRate: number | null
  pointsPct: number | null
}

export type Medal = '🥇' | '🥈' | '🥉'

export interface PodiumStep {
  place: 1 | 2 | 3
  medal: Medal
  /** More than one when tied; a tie for 3rd puts four people on the podium. */
  entries: ResultEntry[]
}

export interface FinalResults {
  kind: ViewerSnapshot['kind']
  name: string
  /** Steps in place order (1, 2, 3), only places someone holds. */
  podium: PodiumStep[]
  /** Everyone ranked below 3rd, in order. */
  rest: ResultEntry[]
  /** Players (pairs in a tournament) with no game: listed, never ranked. */
  didntPlay: string[]
  players: number
  games: number
  /** First game start to the end; null when either is unknown. */
  durationMs: number | null
  expiresAt: string
  /** Who won, for the live announcement ("Ana & Ben"); null when nobody did (no games, or a draw ended early). */
  champion: string | null
}

const MEDALS: Record<1 | 2 | 3, Medal> = { 1: '🥇', 2: '🥈', 3: '🥉' }
const DISPLAY_ORDER = [2, 1, 3] as const

/** The results screen replaces the courts once a session ends, or once a tournament has played every game. */
export function showsFinalResults(viewer: Pick<ViewerSnapshot, 'status' | 'tournament'>): boolean {
  return viewer.status === 'ENDED' || viewer.tournament?.phase === 'FINISHED'
}

function podiumAndRest(ranked: readonly ResultEntry[]): Pick<FinalResults, 'podium' | 'rest'> {
  const podium = ([1, 2, 3] as const)
    .map((place) => ({ place, medal: MEDALS[place], entries: ranked.filter((e) => e.place === place) }))
    .filter((step) => step.entries.length > 0)
  return { podium, rest: ranked.filter((e) => e.place > 3) }
}

function openPlayRanked(viewer: ViewerSnapshot): ResultEntry[] {
  return viewer.standings
    .filter((row) => row.played > 0 && row.place !== null)
    .map((row) => ({
      id: row.playerId, name: row.name, place: row.place as number, wins: row.wins, losses: row.losses,
      winRate: row.winRate, pointsPct: row.pointsPct,
    }))
}

function pairEntry(row: StandingView, place: number): ResultEntry {
  const points = row.pointsFor + row.pointsAgainst
  return {
    id: row.entrantId, name: row.name, place, wins: row.wins, losses: row.losses,
    winRate: row.played ? row.wins / row.played : null,
    pointsPct: points > 0 ? row.pointsFor / points : null,
  }
}

const loserOf = (f: FixtureView): string | null => (f.winner === 'A' ? f.entrantBId : f.winner === 'B' ? f.entrantAId : null)
const winnerOf = (f: FixtureView): string | null => (f.winner === 'A' ? f.entrantAId : f.winner === 'B' ? f.entrantBId : null)
const lastRound = (fixtures: readonly FixtureView[]) => fixtures.reduce((max, f) => Math.max(max, f.roundNumber), 0)

/** The decided final of a knockout (the grand final in double elimination), else null. */
function decidedFinal(t: TournamentView): FixtureView | null {
  if (t.format === 'ROUND_ROBIN') return null
  const main = t.fixtures.filter((f) => f.bracket === 'MAIN')
  const final = main.find((f) => f.roundNumber === lastRound(main))
  return final && final.status === 'FINISHED' && winnerOf(final) && loserOf(final) ? final : null
}

/** Knockouts: the losers of the games that fed the final (semi-finals; winners and losers finals), not already 1st or 2nd. */
function knockoutThirds(t: TournamentView, final: FixtureView, top: ReadonlySet<string>): string[] {
  const main = t.fixtures.filter((f) => f.bracket === 'MAIN')
  const losers = t.fixtures.filter((f) => f.bracket === 'LOSERS')
  const feeders = [
    ...main.filter((f) => f.roundNumber === final.roundNumber - 1),
    ...losers.filter((f) => f.roundNumber === lastRound(losers)),
  ].filter((f) => f.status === 'FINISHED')
  return [...new Set(feeders.map(loserOf).filter((id): id is string => id !== null && !top.has(id)))]
}

function tournamentRanked(t: TournamentView): ResultEntry[] {
  const played = t.standings.filter((row) => row.played > 0)
  const final = decidedFinal(t)
  if (!final) return played.map((row, i) => pairEntry(row, i + 1))
  const first = winnerOf(final) as string
  const second = loserOf(final) as string
  const top = new Set([first, second])
  const thirds = t.format === 'POOL_TO_BRACKET'
    ? played.filter((row) => !top.has(row.entrantId)).slice(0, 1).map((row) => row.entrantId)
    : knockoutThirds(t, final, top)
  const placed = new Map<string, number>([[first, 1], [second, 2], ...thirds.map((id) => [id, 3] as [string, number])])
  const byId = new Map(t.standings.map((row) => [row.entrantId, row]))
  const podium = [...placed].flatMap(([id, place]) => {
    const row = byId.get(id)
    return row ? [pairEntry(row, place)] : []
  })
  const rest = played.filter((row) => !placed.has(row.entrantId)).map((row, i) => pairEntry(row, placed.size + i + 1))
  return [...podium, ...rest]
}

function durationOf(viewer: ViewerSnapshot): number | null {
  const start = viewer.games.firstStartedAt
  // A tournament that finished every game but was not ended yet: its last game is the end.
  const end = viewer.endedAt ?? (viewer.tournament?.phase === 'FINISHED' ? viewer.games.lastFinishedAt : null)
  if (!start || !end) return null
  const ms = Date.parse(end) - Date.parse(start)
  return Number.isFinite(ms) && ms >= 0 ? ms : null
}

export function finalResults(viewer: ViewerSnapshot): FinalResults {
  const t = viewer.tournament
  const ranked = t ? tournamentRanked(t) : openPlayRanked(viewer)
  const { podium, rest } = podiumAndRest(ranked)
  const didntPlay = t
    ? t.standings.filter((row) => row.played === 0).map((row) => row.name)
    : viewer.standings.filter((row) => row.played === 0).map((row) => row.name)
  const firstPlace = podium.find((step) => step.place === 1)
  return {
    kind: viewer.kind,
    name: viewer.name,
    podium,
    rest,
    didntPlay,
    // A pair is two players.
    players: t ? ranked.length * 2 : ranked.length,
    games: viewer.games.count,
    durationMs: durationOf(viewer),
    expiresAt: viewer.expiresAt,
    // A tournament's champions only once the draw decided them (not when it was ended early).
    champion: t ? (t.champion?.name ?? null) : firstPlace ? firstPlace.entries.map((e) => e.name).join(', ') : null,
  }
}

/** Left to right on the podium: 2nd, 1st, 3rd (whichever exist). */
export function podiumDisplayOrder(podium: readonly PodiumStep[]): PodiumStep[] {
  return DISPLAY_ORDER.flatMap((place) => podium.filter((step) => step.place === place))
}

export function durationText(ms: number | null): string | null {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return null
  const minutes = Math.max(1, Math.round(ms / 60_000))
  if (minutes < 60) return `${minutes} min`
  const rest = minutes % 60
  return `${Math.floor(minutes / 60)} h${rest ? ` ${rest} min` : ''}`
}

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`

/** "8 players · 12 games · 1 h 30 min" (the duration only when known). */
export function summaryText(results: Pick<FinalResults, 'players' | 'games' | 'durationMs'>): string {
  const duration = durationText(results.durationMs)
  return [count(results.players, 'player'), count(results.games, 'game'), ...(duration ? [duration] : [])].join(' · ')
}

export const winLoss = (e: Pick<ResultEntry, 'wins' | 'losses'>): string => `${e.wins}–${e.losses}`

/** "4–2 · 53% pts": the record plus the share of points won (just the record when no game was scored). */
export const recordWithPoints = (e: Pick<ResultEntry, 'wins' | 'losses' | 'pointsPct'>): string =>
  e.pointsPct === null || e.pointsPct === undefined ? winLoss(e) : `${winLoss(e)} · ${Math.round(e.pointsPct * 100)}% pts`

/** For the Share results button: the podium with W–L, and the board link. */
export function shareText(results: FinalResults, boardUrl: string): string {
  const podium = results.podium
    .map((step) => `${step.medal} ${step.entries.map((e) => `${e.name} (${winLoss(e)})`).join(', ')}`)
    .join('  ')
  return [`🏆 ${results.name} — final standings`, ...(podium ? [podium] : []), `Full results: ${boardUrl}`].join('\n')
}

export interface PreviewMeta {
  title: string
  description: string
}

/** The board link's <title>, og:title and og:description. */
export function previewMeta(viewer: ViewerSnapshot): PreviewMeta {
  if (!showsFinalResults(viewer)) {
    return { title: `${viewer.name} · live board`, description: 'Live courts, queue and standings. No app needed.' }
  }
  const { podium } = finalResults(viewer)
  const description = podium.map((step) => `${step.medal} ${step.entries.map((e) => e.name).join(', ')}`).join(' · ')
  return { title: `Final standings · ${viewer.name}`, description: description || 'No games were saved in this session.' }
}

/** Columns for the TV's list below the podium: more players, more columns (up to four). */
export function tvRestColumns(rows: number): number {
  if (rows <= 8) return 1
  if (rows <= 16) return 2
  if (rows <= 36) return 3
  return 4
}

/**
 * Columns inside one podium step: a shared place sits side by side on a wider
 * step (two or three across, four as two by two, more in rows of three).
 */
export function podiumStepColumns(entries: number): number {
  if (entries <= 3) return Math.max(1, entries)
  return entries === 4 ? 2 : 3
}

export function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13
  const suffix = teen ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'
  return `${n}${suffix}`
}

/**
 * The personal line on an ended board for the player who picked their name:
 * where they (or their pair) finished, or thanks for coming without a game.
 * Null when nobody on the roster is picked.
 */
export function finishLine(viewer: ViewerSnapshot, playerId: string): string | null {
  const me = playerId ? viewer.roster.find((p) => p.id === playerId) : undefined
  if (!me) return null
  const hi = `Hi ${me.name.trim().split(/\s+/)[0] || 'there'}!`
  const results = finalResults(viewer)
  const ranked = [...results.podium.flatMap((step) => step.entries), ...results.rest]
  const t = viewer.tournament
  const ownId = t ? t.pairs.find((pair) => pair.playerIds.includes(playerId))?.id : playerId
  const mine = ranked.find((entry) => entry.id === ownId)
  if (!mine) return `${hi} Thanks for coming 👋`
  const tied = ranked.some((entry) => entry.id !== mine.id && entry.place === mine.place)
  if (t) {
    if (mine.place === 1 && t.champion?.entrantId === mine.id) return `${hi} Your pair won the tournament! 🏆`
    return `${hi} Your pair ${tied ? 'tied for' : 'finished'} ${ordinal(mine.place)}`
  }
  return `${hi} You ${tied ? 'tied for' : 'finished'} ${ordinal(mine.place)} of ${ranked.length} 🎉`
}

/** The TV podium shrinks in these steps until a big tie fits, never below the floor (names stay readable across a hall). */
export const TV_PODIUM_FIT = { step: 0.05, min: 0.75 } as const

/**
 * The TV podium's fit while it overflows its box: shrink a step at a time, down
 * to the floor; at the floor, lift its height cap so the top three still show
 * whole (the list below then shows fewer rows and counts the rest).
 */
export interface TvPodiumFit { scale: number; capped: boolean }

export function nextTvPodiumFit(fit: TvPodiumFit, overflowing: boolean): TvPodiumFit {
  if (!overflowing) return fit
  if (fit.scale > TV_PODIUM_FIT.min) {
    return { ...fit, scale: Math.max(TV_PODIUM_FIT.min, Math.round((fit.scale - TV_PODIUM_FIT.step) * 100) / 100) }
  }
  return fit.capped ? { ...fit, capped: false } : fit
}

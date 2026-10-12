// The DUPR club match-import CSV (spec §9.4). Pure: no I/O. The column layout
// is pinned to tests/fixtures/dupr-import-template.csv; if DUPR changes its
// template, the fixture and DUPR_COLUMNS change together.
import { csvText } from '../csv'
import type { OpenMatch, OpenPlayer, OpenSessionState } from '../types'

export const DUPR_COLUMNS = [
  'matchType', 'event', 'date',
  'playerA1', 'playerA1DuprId', 'playerA1ExternalId', 'playerA2', 'playerA2DuprId', 'playerA2ExternalId',
  'playerB1', 'playerB1DuprId', 'playerB1ExternalId', 'playerB2', 'playerB2DuprId', 'playerB2ExternalId',
  'teamAGame1', 'teamBGame1', 'teamAGame2', 'teamBGame2', 'teamAGame3', 'teamBGame3',
  'teamAGame4', 'teamBGame4', 'teamAGame5', 'teamBGame5',
  'location', 'scoreType',
] as const

/** DUPR IDs are 6 letters or digits, stored uppercased (spec §9.4). */
export const DUPR_ID_PATTERN = /^[A-Z0-9]{6}$/
/** DUPR rejects a game in which neither team reached 6 points. */
export const MIN_WINNING_POINTS = 6

export interface DuprSkip {
  /** The game's number in the results CSV: finished games in the order they were played. */
  game: number
  court: string
  /** "Ana & Ben 11–7 Cy & Di" */
  summary: string
  reason: string
}

export interface DuprExport {
  csv: string
  exported: number
  skipped: DuprSkip[]
  /** Players who would unblock a game by adding a DUPR ID, in roster order. */
  missingIds: Array<{ id: string; name: string }>
}

/** A valid IANA zone, or UTC. The zone comes from the host's own device. */
export function normalizeTimeZone(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 64) return 'UTC'
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })
    return value
  } catch {
    return 'UTC'
  }
}

/** YYYY-MM-DD of an instant in a time zone. */
export function localDate(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(iso))
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

/** "Ana", "Ana and Ben", "Ana, Ben and Cy". */
export function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

type Lookup = (id: string) => OpenPlayer | undefined

function teamNames(team: readonly string[], find: Lookup): string {
  return team.map((id) => find(id)?.name ?? '—').join(' & ')
}

function summary(match: OpenMatch, find: Lookup): string {
  const score = match.scoreA !== null && match.scoreB !== null ? ` ${match.scoreA}–${match.scoreB} ` : ' against '
  return `${teamNames(match.teamA, find)}${score}${teamNames(match.teamB, find)}`
}

const validId = (player: OpenPlayer | undefined): string | null =>
  player?.duprId && DUPR_ID_PATTERN.test(player.duprId) ? player.duprId : null

/** Why a game score cannot go to DUPR, or null when it can. Checked before the players. */
function scoreProblem(match: OpenMatch): string | null {
  if (match.scoreA === null || match.scoreB === null) return 'No score was saved.'
  if (match.scoreA === match.scoreB) return 'DUPR does not accept a tie.'
  if (Math.max(match.scoreA, match.scoreB) < MIN_WINNING_POINTS) return `DUPR needs one team to reach ${MIN_WINNING_POINTS} points.`
  return null
}

/** Why this finished game is left out of the export, or null when it goes in. */
export function skipReason(match: OpenMatch, find: Lookup): string | null {
  const score = scoreProblem(match)
  if (score) return score
  const players = [...match.teamA, ...match.teamB].map(find)
  if (match.teamA.length !== 2 || match.teamB.length !== 2 || players.some((p) => !p)) return 'DUPR needs four players in a doubles game.'
  const missing = players.filter((p) => !validId(p)).map((p) => (p as OpenPlayer).name)
  if (missing.length) return `${listNames(missing)} ${missing.length === 1 ? 'has' : 'have'} no DUPR ID.`
  const seen = new Map<string, string>()
  for (const p of players as OpenPlayer[]) {
    const id = validId(p) as string
    const first = seen.get(id)
    if (first) return `${first} and ${p.name} have the same DUPR ID.`
    seen.set(id, p.name)
  }
  return null
}

function row(state: OpenSessionState, match: OpenMatch, find: Lookup, timeZone: string): string {
  const cells = (id: string) => {
    const p = find(id) as OpenPlayer
    return [csvText(p.name), validId(p) as string, p.id]
  }
  const date = localDate(match.finishedAt ?? match.startedAt ?? match.proposedAt, timeZone)
  return [
    'D', csvText(state.name), date,
    ...cells(match.teamA[0]), ...cells(match.teamA[1]), ...cells(match.teamB[0]), ...cells(match.teamB[1]),
    String(match.scoreA), String(match.scoreB), '', '', '', '', '', '', '', '',
    csvText(state.location ?? ''), state.settings.scoringStyle,
  ].join(',')
}

/**
 * One row per finished game that DUPR will accept: a doubles game with a
 * score that is not a tie and in which a team reached 6, and four distinct,
 * valid DUPR IDs. Only game 1 is filled. No instruction rows (spec §9.4).
 */
export function buildDuprExport(state: OpenSessionState, { timeZone }: { timeZone: string }): DuprExport {
  const byId = new Map(state.players.map((p) => [p.id, p]))
  const find: Lookup = (id) => byId.get(id)
  const zone = normalizeTimeZone(timeZone)
  const games = state.matches.filter((m) => m.status === 'FINISHED').sort((a, b) => a.seq - b.seq)
  const rows: string[] = []
  const skipped: DuprSkip[] = []
  const missing = new Set<string>()
  games.forEach((match, index) => {
    const reason = skipReason(match, find)
    if (!reason) {
      rows.push(row(state, match, find, zone))
      return
    }
    skipped.push({
      game: index + 1, court: state.courts.find((c) => c.id === match.courtId)?.label ?? '', summary: summary(match, find), reason,
    })
    if (!scoreProblem(match)) for (const id of [...match.teamA, ...match.teamB]) if (!validId(find(id))) missing.add(id)
  })
  return {
    csv: [DUPR_COLUMNS.join(','), ...rows].join('\r\n'),
    exported: rows.length,
    skipped,
    missingIds: state.players.filter((p) => missing.has(p.id)).map((p) => ({ id: p.id, name: p.name })),
  }
}

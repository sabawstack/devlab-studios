import { computeStandings } from './standings'
import type { OpenSessionState } from './types'

// A cell opening with = + - @ is executed as a formula by Excel and Sheets.
// Player names are user input, so text cells are prefixed with ' to defuse that.
function text(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value
  return /[",\r\n]/.test(safe) || safe !== value ? `"${safe.replace(/"/g, '""')}"` : safe
}

function num(value: number | null, digits = 0): string {
  return value === null ? '' : value.toFixed(digits)
}

export function resultsCsv(state: OpenSessionState): string {
  const name = (id: string) => state.players.find((p) => p.id === id)?.name ?? ''
  const court = (id: string) => state.courts.find((c) => c.id === id)?.label ?? ''
  const games = state.matches
    .filter((m) => m.status === 'FINISHED')
    .sort((a, b) => a.seq - b.seq)
    .map((m, i) => [
      String(i + 1), text(court(m.courtId)), m.startedAt ?? '', m.finishedAt ?? '',
      text(m.teamA.map(name).join(' & ')), text(m.teamB.map(name).join(' & ')),
      num(m.scoreA), num(m.scoreB), m.winner ?? '',
    ].join(','))
  const standings = computeStandings(state.players, state.matches).map((row) => [
    row.rank === null ? '' : String(row.rank), text(row.name), String(row.played), String(row.wins), String(row.losses),
    row.winRate === null ? '' : (row.winRate * 100).toFixed(0), row.pointsPct === null ? '' : (row.pointsPct * 100).toFixed(1),
    row.scoredGames ? String(row.pointsFor) : '', row.scoredGames ? String(row.pointsAgainst) : '',
  ].join(','))
  return [
    'Game,Court,Started,Finished,Team A,Team B,Score A,Score B,Winner',
    ...games,
    '',
    'Rank,Player,Played,Won,Lost,Win %,Points won %,Points for,Points against',
    ...standings,
  ].join('\r\n')
}

// "Download results (CSV)" for a tournament (spec §8): every game with its
// stage, then the overall standings, then each pool's.
import { csvText } from '../csv'
import type { OpenSessionState } from '../types'
import { fixtureLabel, pairName } from './labels'
import { overallStandings, poolLabels, poolStandings, type PairStanding } from './standings'

function standingRows(rows: readonly PairStanding[], pool: string): string[] {
  return rows.map((row) => [
    String(row.rank), pool, csvText(row.displayName), String(row.played), String(row.wins), String(row.losses),
    String(row.pointsFor), String(row.pointsAgainst), String(row.pointDifferential),
  ].join(','))
}

export function tournamentResultsCsv(state: OpenSessionState): string {
  const t = state.tournament
  if (!t) return ''
  const { players, matches } = state
  const court = (id: string) => state.courts.find((c) => c.id === id)?.label ?? ''
  const pair = (entrantId: string | null) => {
    const entrant = t.entrants.find((e) => e.id === entrantId)
    return entrant ? pairName(entrant, players) : ''
  }
  const games = matches
    .filter((m) => m.status === 'FINISHED' && m.fixtureId)
    .sort((a, b) => a.seq - b.seq)
    .map((m, i) => {
      const f = t.fixtures.find((x) => x.id === m.fixtureId)
      return [
        String(i + 1), csvText(f ? fixtureLabel(t, f) : ''), csvText(court(m.courtId)), m.startedAt ?? '', m.finishedAt ?? '',
        csvText(pair(f?.entrantAId ?? null)), csvText(pair(f?.entrantBId ?? null)),
        m.scoreA === null ? '' : String(m.scoreA), m.scoreB === null ? '' : String(m.scoreB), m.winner ?? '',
      ].join(',')
    })
  const header = 'Rank,Pool,Pair,Played,Won,Lost,Points for,Points against,Point difference'
  return [
    'Game,Stage,Court,Started,Finished,Pair A,Pair B,Score A,Score B,Winner',
    ...games,
    '',
    header,
    ...standingRows(overallStandings(t, matches, players), 'All'),
    ...poolLabels(t).flatMap((label) => ['', header, ...standingRows(poolStandings(t, label, matches, players), label)]),
  ].join('\r\n')
}

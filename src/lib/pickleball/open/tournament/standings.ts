// src/lib/pickleball/open/tournament/standings.ts
// Pair standings per pool and overall (spec §6.7), ranked by the reused
// rankTournamentStandings: wins, losses, point differential, head-to-head.
// Points come from the saved games (every result carries a score).
import {
  rankTournamentStandings, type TournamentStandingsEntry, type TournamentStandingsInput,
} from '../../tournament/rankTournamentStandings'
import type { OpenMatch, OpenPlayer } from '../types'
import { pairName } from './labels'
import type { TournamentFixture, TournamentState } from './types'

export interface PairStanding extends TournamentStandingsEntry {
  played: number
  poolLabel: string | null
}

/** Raw tallies for every pair, over these fixtures only. */
export function standingsInputs(
  t: TournamentState, fixtures: readonly TournamentFixture[], matches: readonly OpenMatch[], players: readonly OpenPlayer[],
): Array<TournamentStandingsInput & { played: number }> {
  const scoreOf = new Map(matches.filter((m) => m.status === 'FINISHED' && m.fixtureId).map((m) => [m.fixtureId as string, m]))
  const rows = new Map(t.entrants.map((e) => [e.id, {
    entrantId: e.id, seed: e.seed, displayName: pairName(e, players), wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0, played: 0,
  }]))
  for (const f of fixtures) {
    if (f.status !== 'FINISHED' || !f.winnerEntrantId || !f.entrantAId || !f.entrantBId) continue
    const match = scoreOf.get(f.id)
    for (const [id, own, other] of [[f.entrantAId, match?.scoreA, match?.scoreB], [f.entrantBId, match?.scoreB, match?.scoreA]] as const) {
      const row = rows.get(id)
      if (!row) continue
      const won = f.winnerEntrantId === id
      rows.set(id, {
        ...row, played: row.played + 1, wins: row.wins + (won ? 1 : 0), losses: row.losses + (won ? 0 : 1),
        pointsFor: row.pointsFor + (own ?? 0), pointsAgainst: row.pointsAgainst + (other ?? 0),
      })
    }
  }
  return [...rows.values()]
}

function ranked(
  t: TournamentState, entrantIds: ReadonlySet<string>, fixtures: readonly TournamentFixture[], matches: readonly OpenMatch[], players: readonly OpenPlayer[],
): PairStanding[] {
  const inputs = standingsInputs(t, fixtures, matches, players).filter((row) => entrantIds.has(row.entrantId))
  const played = new Map(inputs.map((row) => [row.entrantId, row.played]))
  return rankTournamentStandings(inputs, [...fixtures]).map((row) => ({
    ...row, played: played.get(row.entrantId) ?? 0, poolLabel: t.entrants.find((e) => e.id === row.entrantId)?.poolLabel ?? null,
  }))
}

/** Every pair, every game. */
export function overallStandings(t: TournamentState, matches: readonly OpenMatch[], players: readonly OpenPlayer[]): PairStanding[] {
  return ranked(t, new Set(t.entrants.map((e) => e.id)), t.fixtures, matches, players)
}

/** One pool's pairs over that pool's games only (what decides who goes through). */
export function poolStandings(t: TournamentState, label: string, matches: readonly OpenMatch[], players: readonly OpenPlayer[]): PairStanding[] {
  const members = new Set(t.entrants.filter((e) => e.poolLabel === label).map((e) => e.id))
  return ranked(t, members, t.fixtures.filter((f) => f.bracket === 'POOL' && f.poolLabel === label), matches, players)
}

export function poolLabels(t: TournamentState): string[] {
  return [...new Set(t.entrants.map((e) => e.poolLabel).filter((label): label is string => label !== null))].sort()
}

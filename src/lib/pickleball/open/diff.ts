import type { TournamentEntrant, TournamentFixture, TournamentState } from './tournament/types'
import type { OpenCourt, OpenMatch, OpenPlayer, OpenSessionState } from './types'

export interface StateDiff {
  sessionChanged: boolean
  upsertPlayers: OpenPlayer[]
  upsertCourts: OpenCourt[]
  upsertMatches: OpenMatch[]
  deleteMatchIds: string[]
  /** The tournament's own row: format, pairing, seeding, phase, start time. */
  tournamentChanged: boolean
  upsertEntrants: TournamentEntrant[]
  deleteEntrantIds: string[]
  upsertFixtures: TournamentFixture[]
  deleteFixtureIds: string[]
}

function changed<T extends { id: string }>(prev: readonly T[], next: readonly T[]): T[] {
  const before = new Map(prev.map((row) => [row.id, JSON.stringify(row)]))
  return next.filter((row) => before.get(row.id) !== JSON.stringify(row))
}

function removed<T extends { id: string }>(prev: readonly T[], next: readonly T[]): string[] {
  const kept = new Set(next.map((row) => row.id))
  return prev.filter((row) => !kept.has(row.id)).map((row) => row.id)
}

const SESSION_FIELDS = ['name', 'hostDisplayName', 'location', 'status', 'settings', 'version', 'lastActivityAt', 'expiresAt'] as const

function tournamentRow(t: TournamentState | null): string {
  return t ? JSON.stringify([t.format, t.pairing, t.seeding, t.phase, t.startedAt]) : ''
}

export function diffState(prev: OpenSessionState, next: OpenSessionState): StateDiff {
  const before = prev.tournament
  const after = next.tournament
  return {
    sessionChanged: SESSION_FIELDS.some((field) => JSON.stringify(prev[field]) !== JSON.stringify(next[field])),
    upsertPlayers: changed(prev.players, next.players),
    upsertCourts: changed(prev.courts, next.courts),
    upsertMatches: changed(prev.matches, next.matches),
    deleteMatchIds: removed(prev.matches, next.matches),
    tournamentChanged: after !== null && tournamentRow(before) !== tournamentRow(after),
    upsertEntrants: changed(before?.entrants ?? [], after?.entrants ?? []),
    deleteEntrantIds: removed(before?.entrants ?? [], after?.entrants ?? []),
    upsertFixtures: changed(before?.fixtures ?? [], after?.fixtures ?? []),
    deleteFixtureIds: removed(before?.fixtures ?? [], after?.fixtures ?? []),
  }
}

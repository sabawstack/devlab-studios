import type { OpenCourt, OpenMatch, OpenPlayer, OpenSessionState } from './types'

export interface StateDiff {
  sessionChanged: boolean
  upsertPlayers: OpenPlayer[]
  upsertCourts: OpenCourt[]
  upsertMatches: OpenMatch[]
  deleteMatchIds: string[]
}

function changed<T extends { id: string }>(prev: readonly T[], next: readonly T[]): T[] {
  const before = new Map(prev.map((row) => [row.id, JSON.stringify(row)]))
  return next.filter((row) => before.get(row.id) !== JSON.stringify(row))
}

const SESSION_FIELDS = ['name', 'hostDisplayName', 'location', 'status', 'settings', 'version', 'lastActivityAt', 'expiresAt'] as const

export function diffState(prev: OpenSessionState, next: OpenSessionState): StateDiff {
  const nextMatchIds = new Set(next.matches.map((m) => m.id))
  return {
    sessionChanged: SESSION_FIELDS.some((field) => JSON.stringify(prev[field]) !== JSON.stringify(next[field])),
    upsertPlayers: changed(prev.players, next.players),
    upsertCourts: changed(prev.courts, next.courts),
    upsertMatches: changed(prev.matches, next.matches),
    deleteMatchIds: prev.matches.filter((m) => !nextMatchIds.has(m.id)).map((m) => m.id),
  }
}

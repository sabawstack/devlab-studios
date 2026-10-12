// src/lib/pickleball/open/testing/fixtures.ts
// Test-only builders. Never imported by application code.
import { DEFAULT_SETTINGS, type OpenCourt, type OpenMatch, type OpenPlayer, type OpenSessionState, type Side } from '../types'

export const T0 = '2026-10-11T10:00:00.000Z'

export function at(minutes: number): string {
  return new Date(Date.parse(T0) + minutes * 60_000).toISOString()
}

export function player(id: string, overrides: Partial<OpenPlayer> = {}): OpenPlayer {
  return { id, name: id, skill: null, duprId: null, status: 'ACTIVE', gamesOffset: 0, joinedAt: T0, waitingSince: T0, position: 0, ...overrides }
}

export function court(id: string, position: number, enabled = true): OpenCourt {
  return { id, label: `Court ${position}`, position, enabled }
}

export function finished(
  id: string, teamA: [string, string], teamB: [string, string], winner: Side,
  scoreA: number | null, scoreB: number | null, minute = 0, courtId = 'c1',
): OpenMatch {
  return {
    id, courtId, seq: minute, status: 'FINISHED', teamA, teamB, scoreA, scoreB, winner,
    proposedAt: at(minute), startedAt: at(minute), finishedAt: at(minute + 10), recordedBy: 'Host', fixtureId: null,
  }
}

export function sessionState(overrides: Partial<OpenSessionState> = {}): OpenSessionState {
  return {
    id: 's1', publicCode: 'ABCDE23456', kind: 'OPEN_PLAY', name: 'Sunday', hostDisplayName: 'Mike', location: null,
    status: 'ACTIVE', settings: DEFAULT_SETTINGS, players: [], courts: [court('c1', 1)], matches: [], tournament: null,
    version: 1, createdAt: T0, lastActivityAt: T0, expiresAt: at(7 * 24 * 60), ...overrides,
  }
}

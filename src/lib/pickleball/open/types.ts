export type StackingMode = 'PADDLE_STACK' | 'WINNERS_LOSERS' | 'BY_STANDING' | 'BALANCED'
export type TargetPoints = 11 | 15 | 21
export type ScoringStyle = 'SIDEOUT' | 'RALLY'

export interface SessionSettings {
  mode: StackingMode
  target: TargetPoints
  scoringStyle: ScoringStyle
}

export type PlayerStatus = 'ACTIVE' | 'BREAK' | 'LEFT'

export interface OpenPlayer {
  id: string
  name: string
  skill: number | null
  duprId: string | null
  status: PlayerStatus
  /** Games credited on arrival so a late player starts level (spec §4.4). */
  gamesOffset: number
  joinedAt: string
  /** When the player last became available to play. */
  waitingSince: string
  position: number
}

export interface OpenCourt {
  id: string
  label: string
  position: number
  enabled: boolean
}

export type MatchStatus = 'PROPOSED' | 'IN_PROGRESS' | 'FINISHED' | 'ABANDONED'
export type Team = readonly [string, string]
export type Side = 'A' | 'B'

export interface OpenMatch {
  id: string
  courtId: string
  seq: number
  status: MatchStatus
  teamA: Team
  teamB: Team
  scoreA: number | null
  scoreB: number | null
  winner: Side | null
  proposedAt: string
  startedAt: string | null
  finishedAt: string | null
}

export type SessionStatus = 'ACTIVE' | 'ENDED'

export interface OpenSessionState {
  id: string
  publicCode: string
  kind: 'OPEN_PLAY' | 'TOURNAMENT'
  name: string
  hostDisplayName: string
  location: string | null
  status: SessionStatus
  settings: SessionSettings
  players: readonly OpenPlayer[]
  courts: readonly OpenCourt[]
  matches: readonly OpenMatch[]
  version: number
  createdAt: string
  lastActivityAt: string
  expiresAt: string
}

export interface CommandContext {
  now: string
  newId: () => string
}

export const LIMITS = {
  maxCourts: 16,
  maxPlayers: 128,
  maxMatches: 2000,
  maxNameLength: 40,
  undoWindowMs: 120_000,
  retentionMs: 7 * 24 * 60 * 60 * 1000,
} as const

export const DEFAULT_SETTINGS: SessionSettings = {
  mode: 'PADDLE_STACK',
  target: 11,
  scoringStyle: 'SIDEOUT',
}

export function addMs(iso: string, ms: number): string {
  return new Date(Date.parse(iso) + ms).toISOString()
}

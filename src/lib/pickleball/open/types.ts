import type { RandomInt, TournamentState } from './tournament/types'

export type StackingMode = 'PADDLE_STACK' | 'WINNERS_LOSERS' | 'BY_STANDING' | 'BALANCED'
export type TargetPoints = 11 | 15 | 21
export type ScoringStyle = 'SIDEOUT' | 'RALLY'
export type RuleKind = 'TOGETHER' | 'APART'

/** A host-set hard constraint (spec §5.4): always partners, or never on the same court. */
export interface PairRule {
  kind: RuleKind
  playerIds: readonly [string, string]
}

export interface SessionSettings {
  mode: StackingMode
  target: TargetPoints
  scoringStyle: ScoringStyle
  /** Players may add themselves from the check-in link (spec §4.2). */
  selfCheckIn: boolean
  rules: readonly PairRule[]
  /** The welcome message on the board, check-in page and TV; empty means none. Plain text. */
  announcement: string
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
  /** Who saved the result: 'Host' or a captain's label. Null until saved. */
  recordedBy: string | null
  /** The tournament fixture this game plays (spec §6.6); null in open play. */
  fixtureId: string | null
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
  /** Set when kind is TOURNAMENT, null for open play. */
  tournament: TournamentState | null
  version: number
  createdAt: string
  lastActivityAt: string
  expiresAt: string
}

export interface CommandContext {
  now: string
  newId: () => string
  /** Who is acting: 'Host' or a captain's label. Treated as 'Host' when absent. */
  actor?: string
  /** Crypto randomness for random pairing and seeding; supplied by the Durable Object. */
  random?: RandomInt
}

/** A court captain link (spec §3.3). Only the SHA-256 of its secret is kept. */
export interface CaptainRecord {
  id: string
  label: string
  courtId: string
  keyHash: string
  createdAt: string
}

export const LIMITS = {
  maxCourts: 16,
  maxPlayers: 128,
  maxMatches: 2000,
  maxNameLength: 40,
  undoWindowMs: 120_000,
  retentionMs: 7 * 24 * 60 * 60 * 1000,
  maxRules: 32,
  maxCaptains: 32,
  maxAnnouncementLength: 140,
} as const

export const DEFAULT_SETTINGS: SessionSettings = {
  mode: 'PADDLE_STACK',
  target: 11,
  scoringStyle: 'SIDEOUT',
  selfCheckIn: true,
  rules: [],
  announcement: '',
}

export function addMs(iso: string, ms: number): string {
  return new Date(Date.parse(iso) + ms).toISOString()
}

// Doubles tournaments inside a free session (spec §6). The fixture shape is
// exactly the reused generator's (src/lib/pickleball/tournament/
// generateFixtures.ts), plus an id and a winner, so advanceBracket,
// resolvePoolQualifiers, nextPlayableFixture and rankTournamentStandings run
// on it unchanged.
import type { TournamentFormat } from '../../tournament/generateFixtures'

export type { TournamentFormat }
export type PairingMethod = 'RANDOM' | 'BALANCED' | 'MANUAL'
export type SeedingMethod = 'RANDOM' | 'BY_SKILL' | 'MANUAL'
/** SETUP: no draw yet. DRAFT: generated, freely editable. RUNNING: locked shape. FINISHED: every game played. */
export type TournamentPhase = 'SETUP' | 'DRAFT' | 'RUNNING' | 'FINISHED'
export type FixtureBracket = 'POOL' | 'MAIN' | 'LOSERS'
export type FixtureStatus = 'PENDING' | 'READY' | 'IN_PROGRESS' | 'FINISHED' | 'BYE'

/** A pair. Results belong to the pair, so a substitute keeps them (spec §6.5). */
export interface TournamentEntrant {
  id: string
  playerIds: readonly [string, string]
  seed: number
  poolLabel: string | null
}

export interface TournamentFixture {
  id: string
  bracket: FixtureBracket
  poolLabel: string | null
  roundNumber: number
  position: number
  entrantAId: string | null
  entrantBId: string | null
  /** WINNER_OF:<fixture id>, LOSER_OF:<fixture id> or POOL_RANK:<pool>:<rank>; null when placed at generation. */
  sourceA: string | null
  sourceB: string | null
  winnerEntrantId: string | null
  status: FixtureStatus
}

export interface TournamentState {
  format: TournamentFormat
  pairing: PairingMethod
  seeding: SeedingMethod
  phase: TournamentPhase
  startedAt: string | null
  entrants: readonly TournamentEntrant[]
  fixtures: readonly TournamentFixture[]
}

/** Draft edits (spec §6.4): unrestricted, each re-validated by drawEdits.ts. */
export type DraftEdit =
  | { kind: 'SWAP_PLAYERS'; playerIds: readonly [string, string] }
  | { kind: 'SWAP_PAIRS'; entrantIds: readonly [string, string] }
  | { kind: 'MOVE_PAIR'; entrantId: string; poolLabel: string }
  | { kind: 'SET_OPPONENT'; fixtureId: string; side: 'A' | 'B'; entrantId: string }

/** The only edits once the draw is locked (spec §6.5). */
export type RunningEdit =
  | { kind: 'SUBSTITUTE'; entrantId: string; outPlayerId: string; inPlayerId: string }
  | { kind: 'SWAP_OPPONENTS'; fixtureId: string; side: 'A' | 'B'; otherFixtureId: string; otherSide: 'A' | 'B' }

export type EditResult = { ok: true; tournament: TournamentState } | { ok: false; reason: string }

/** Injected randomness, so the engine stays pure: an integer in [0, maxExclusive). */
export type RandomInt = (maxExclusive: number) => number

export const TOURNAMENT_FORMATS: readonly TournamentFormat[] = ['ROUND_ROBIN', 'POOL_TO_BRACKET', 'SINGLE_ELIMINATION', 'DOUBLE_ELIMINATION']
export const PAIRING_METHODS: readonly PairingMethod[] = ['RANDOM', 'BALANCED', 'MANUAL']
export const SEEDING_METHODS: readonly SeedingMethod[] = ['RANDOM', 'BY_SKILL', 'MANUAL']
const PHASES: readonly TournamentPhase[] = ['SETUP', 'DRAFT', 'RUNNING', 'FINISHED']

export function emptyTournament(format: TournamentFormat = 'ROUND_ROBIN'): TournamentState {
  return { format, pairing: 'RANDOM', seeding: 'RANDOM', phase: 'SETUP', startedAt: null, entrants: [], fixtures: [] }
}

/** Stored values are text (no CHECK on these columns): anything unknown reads as the default. */
export function normalizePairing(value: unknown): PairingMethod {
  return PAIRING_METHODS.includes(value as PairingMethod) ? (value as PairingMethod) : 'RANDOM'
}
export function normalizeSeeding(value: unknown): SeedingMethod {
  return SEEDING_METHODS.includes(value as SeedingMethod) ? (value as SeedingMethod) : 'RANDOM'
}
export function normalizePhase(value: unknown): TournamentPhase {
  return PHASES.includes(value as TournamentPhase) ? (value as TournamentPhase) : 'SETUP'
}

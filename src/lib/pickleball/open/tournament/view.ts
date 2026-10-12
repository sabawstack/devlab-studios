// The tournament part of every snapshot (spec §7): an ALLOWLIST built field
// by field, like snapshot.ts. Pair and player names, ids, scores and court
// labels only: never a skill, a DUPR ID or anything secret.
import type { OpenSessionState, Side } from '../types'
import { unpairedPlayers } from './draw'
import { FORMAT_INFO } from './info'
import { fixtureLabel, pairName, roundLabel, sourceLabel } from './labels'
import { champion } from './progress'
import { overallStandings, poolLabels, poolStandings, type PairStanding } from './standings'
import type { FixtureBracket, FixtureStatus, PairingMethod, SeedingMethod, TournamentFormat, TournamentPhase } from './types'

export interface PairView {
  id: string
  name: string
  playerIds: [string, string]
  seed: number
  poolLabel: string | null
}

export interface StandingView {
  entrantId: string
  name: string
  rank: number
  played: number
  wins: number
  losses: number
  pointsFor: number
  pointsAgainst: number
  pointDifferential: number
}

export interface FixtureView {
  id: string
  bracket: FixtureBracket
  poolLabel: string | null
  roundNumber: number
  position: number
  /** "Semi-final 1", "Pool A · Round 2". */
  label: string
  /** The round alone: "Semi-final", "Pool A · Round 2". */
  round: string
  status: FixtureStatus
  entrantAId: string | null
  entrantBId: string | null
  nameA: string | null
  nameB: string | null
  /** What an empty side waits for: "Winner of Semi-final 1", "Pool B runner-up". */
  waitingA: string | null
  waitingB: string | null
  /** True when the draw placed this side; false when a result fills it (only placed sides can be swapped). */
  placedA: boolean
  placedB: boolean
  scoreA: number | null
  scoreB: number | null
  winner: Side | null
  /** The court this game is proposed to or playing on. */
  court: { label: string; live: boolean } | null
}

export interface TournamentView {
  format: TournamentFormat
  formatLabel: string
  phase: TournamentPhase
  pairing: PairingMethod
  seeding: SeedingMethod
  pairs: PairView[]
  /** Checked-in players in no pair: flagged in the draft (spec §6.1), substitutes once running. */
  unpaired: Array<{ id: string; name: string }>
  fixtures: FixtureView[]
  pools: Array<{ label: string; standings: StandingView[] }>
  standings: StandingView[]
  champion: { entrantId: string; name: string } | null
}

function standingView(row: PairStanding): StandingView {
  return {
    entrantId: row.entrantId, name: row.displayName, rank: row.rank, played: row.played, wins: row.wins, losses: row.losses,
    pointsFor: row.pointsFor, pointsAgainst: row.pointsAgainst, pointDifferential: row.pointDifferential,
  }
}

export function toTournamentView(state: OpenSessionState): TournamentView | null {
  const t = state.tournament
  if (!t) return null
  const { players, matches } = state
  const name = (entrantId: string | null) => {
    const entrant = entrantId ? t.entrants.find((e) => e.id === entrantId) : undefined
    return entrant ? pairName(entrant, players) : null
  }
  const courtLabel = (courtId: string) => state.courts.find((c) => c.id === courtId)?.label ?? ''
  const winnerEntrant = champion(t, matches, players)
  return {
    format: t.format,
    formatLabel: FORMAT_INFO[t.format].label,
    phase: t.phase,
    pairing: t.pairing,
    seeding: t.seeding,
    pairs: t.entrants.map((e) => ({ id: e.id, name: pairName(e, players), playerIds: [e.playerIds[0], e.playerIds[1]], seed: e.seed, poolLabel: e.poolLabel })),
    unpaired: unpairedPlayers(t, players).map((p) => ({ id: p.id, name: p.name })),
    fixtures: t.fixtures.map((f) => {
      const saved = matches.find((m) => m.fixtureId === f.id && m.status === 'FINISHED')
      const live = matches.find((m) => m.fixtureId === f.id && (m.status === 'PROPOSED' || m.status === 'IN_PROGRESS'))
      return {
        id: f.id, bracket: f.bracket, poolLabel: f.poolLabel, roundNumber: f.roundNumber, position: f.position,
        label: fixtureLabel(t, f), round: roundLabel(t.format, t.fixtures, f), status: f.status,
        entrantAId: f.entrantAId, entrantBId: f.entrantBId, nameA: name(f.entrantAId), nameB: name(f.entrantBId),
        waitingA: f.entrantAId ? null : sourceLabel(t, f.sourceA), waitingB: f.entrantBId ? null : sourceLabel(t, f.sourceB),
        placedA: f.sourceA === null, placedB: f.sourceB === null,
        scoreA: saved?.scoreA ?? null, scoreB: saved?.scoreB ?? null,
        winner: f.winnerEntrantId === null ? null : f.winnerEntrantId === f.entrantAId ? 'A' : 'B',
        court: live ? { label: courtLabel(live.courtId), live: live.status === 'IN_PROGRESS' } : null,
      }
    }),
    pools: poolLabels(t).map((label) => ({ label, standings: poolStandings(t, label, matches, players).map(standingView) })),
    standings: overallStandings(t, matches, players).map(standingView),
    champion: winnerEntrant ? { entrantId: winnerEntrant.id, name: pairName(winnerEntrant, players) } : null,
  }
}

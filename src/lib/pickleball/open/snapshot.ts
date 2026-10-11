// The viewer snapshot is an ALLOWLIST (spec §7): it is built field by field,
// never by spreading state, so a new column can never leak to the public
// board by accident. The captain snapshot is the same idea for one court.
import { busyPlayerIds, fairnessSummary, gamesPlayed, queueOrder, roundsSatOut, type FairnessSummary } from './fairness'
import { proposalBlocker } from './propose'
import { computeStandings, type StandingRow } from './standings'
import type { CaptainRecord, OpenMatch, OpenSessionState, Side, StackingMode } from './types'

export interface ViewerCourt {
  id: string
  label: string
  state: 'PLAYING' | 'UP_NEXT' | 'WAITING_FOR_PLAYERS' | 'OFF'
  teamA: string[]
  teamB: string[]
  startedAt: string | null
}

export interface ViewerSnapshot {
  code: string
  name: string
  hostDisplayName: string
  status: 'ACTIVE' | 'ENDED'
  expiresAt: string
  settings: { target: number; mode: StackingMode; selfCheckIn: boolean }
  version: number
  courts: ViewerCourt[]
  waiting: Array<{ id: string; name: string }>
  onBreak: Array<{ id: string; name: string }>
  roster: Array<{ id: string; name: string }>
  standings: StandingRow[]
  fairness: FairnessSummary
  recentResults: Array<{ matchId: string; courtLabel: string; teamA: string[]; teamB: string[]; scoreA: number | null; scoreB: number | null; winner: Side; finishedAt: string }>
}

export interface HostPlayer {
  id: string
  name: string
  status: 'ACTIVE' | 'BREAK' | 'LEFT'
  games: number
  satOut: number
  busy: boolean
  waitingSince: string
  skill: number | null
  duprId: string | null
}

export interface HostCourt {
  id: string
  label: string
  position: number
  enabled: boolean
  match: OpenMatch | null
  /** Why a free court has no proposal (a keep-together/apart rule), else null. */
  blocked: string | null
}

export interface HostCaptain {
  id: string
  label: string
  courtId: string
  courtLabel: string
  createdAt: string
}

export interface HostSnapshot {
  viewer: ViewerSnapshot
  players: HostPlayer[]
  courts: HostCourt[]
  finished: OpenMatch[]
  settings: OpenSessionState['settings']
  fairness: FairnessSummary
  captains: HostCaptain[]
}

export type CaptainPlayer = Omit<HostPlayer, 'skill' | 'duprId'>

export interface CaptainSnapshot {
  viewer: ViewerSnapshot
  captain: { id: string; label: string; courtId: string }
  court: HostCourt
  players: CaptainPlayer[]
  finished: OpenMatch[]
  settings: { mode: StackingMode; target: number; scoringStyle: OpenSessionState['settings']['scoringStyle'] }
}

function namesOf(state: OpenSessionState, ids: readonly string[]): string[] {
  return ids.map((id) => state.players.find((p) => p.id === id)?.name ?? '—')
}

function liveMatch(state: OpenSessionState, courtId: string): OpenMatch | null {
  return state.matches.find((m) => m.courtId === courtId && m.status === 'IN_PROGRESS')
    ?? state.matches.find((m) => m.courtId === courtId && m.status === 'PROPOSED')
    ?? null
}

export function toViewerSnapshot(state: OpenSessionState): ViewerSnapshot {
  const courts = [...state.courts].sort((a, b) => a.position - b.position)
  return {
    code: state.publicCode,
    name: state.name,
    hostDisplayName: state.hostDisplayName,
    status: state.status,
    expiresAt: state.expiresAt,
    settings: { target: state.settings.target, mode: state.settings.mode, selfCheckIn: state.settings.selfCheckIn },
    version: state.version,
    courts: courts.map((c) => {
      const match = c.enabled ? liveMatch(state, c.id) : null
      const courtState: ViewerCourt['state'] = !c.enabled ? 'OFF' : !match ? 'WAITING_FOR_PLAYERS' : match.status === 'IN_PROGRESS' ? 'PLAYING' : 'UP_NEXT'
      return {
        id: c.id, label: c.label, state: courtState,
        teamA: match ? namesOf(state, match.teamA) : [], teamB: match ? namesOf(state, match.teamB) : [],
        startedAt: match?.startedAt ?? null,
      }
    }),
    waiting: queueOrder(state).map((e) => ({ id: e.player.id, name: e.player.name })),
    onBreak: state.players.filter((p) => p.status === 'BREAK').map((p) => ({ id: p.id, name: p.name })),
    roster: state.players.filter((p) => p.status !== 'LEFT').map((p) => ({ id: p.id, name: p.name })),
    standings: computeStandings(state.players, state.matches),
    fairness: fairnessSummary(state),
    recentResults: state.matches
      .filter((m): m is OpenMatch & { winner: Side; finishedAt: string } => m.status === 'FINISHED' && m.winner !== null && m.finishedAt !== null)
      .sort((a, b) => Date.parse(b.finishedAt) - Date.parse(a.finishedAt) || b.seq - a.seq)
      .slice(0, 10)
      .map((m) => ({
        matchId: m.id, courtLabel: state.courts.find((c) => c.id === m.courtId)?.label ?? '',
        teamA: namesOf(state, m.teamA), teamB: namesOf(state, m.teamB),
        scoreA: m.scoreA, scoreB: m.scoreB, winner: m.winner, finishedAt: m.finishedAt,
      })),
  }
}

function hostCourts(state: OpenSessionState): HostCourt[] {
  const blocker = proposalBlocker(state)
  return [...state.courts].sort((a, b) => a.position - b.position).map((c) => {
    const match = c.enabled ? liveMatch(state, c.id) : null
    return { id: c.id, label: c.label, position: c.position, enabled: c.enabled, match, blocked: c.enabled && !match ? blocker : null }
  })
}

function captainPlayers(state: OpenSessionState): CaptainPlayer[] {
  const busy = busyPlayerIds(state.matches)
  return state.players.map((p) => ({
    id: p.id, name: p.name, status: p.status, games: gamesPlayed(p, state.matches),
    satOut: roundsSatOut(p, state), busy: busy.has(p.id), waitingSince: p.waitingSince,
  }))
}

export function toHostSnapshot(state: OpenSessionState, captains: readonly CaptainRecord[] = []): HostSnapshot {
  const viewer = toViewerSnapshot(state)
  return {
    viewer,
    players: captainPlayers(state).map((p, i) => ({ ...p, skill: state.players[i].skill, duprId: state.players[i].duprId })),
    courts: hostCourts(state),
    finished: state.matches.filter((m) => m.status === 'FINISHED').sort((a, b) => b.seq - a.seq),
    settings: state.settings,
    fairness: viewer.fairness,
    captains: captains.map((c) => ({
      id: c.id, label: c.label, courtId: c.courtId,
      courtLabel: state.courts.find((court) => court.id === c.courtId)?.label ?? '', createdAt: c.createdAt,
    })),
  }
}

export function toCaptainSnapshot(state: OpenSessionState, captain: CaptainRecord): CaptainSnapshot {
  const court = hostCourts(state).find((c) => c.id === captain.courtId)
    ?? { id: captain.courtId, label: '', position: 0, enabled: false, match: null, blocked: null }
  return {
    viewer: toViewerSnapshot(state),
    captain: { id: captain.id, label: captain.label, courtId: captain.courtId },
    court,
    players: captainPlayers(state),
    finished: state.matches.filter((m) => m.status === 'FINISHED' && m.courtId === captain.courtId).sort((a, b) => b.seq - a.seq),
    settings: { mode: state.settings.mode, target: state.settings.target, scoringStyle: state.settings.scoringStyle },
  }
}

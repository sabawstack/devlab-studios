// The viewer snapshot is an ALLOWLIST (spec §7): it is built field by field,
// never by spreading state, so a new column can never leak to the public
// board by accident.
import { busyPlayerIds, gamesPlayed, queueOrder, roundsSatOut } from './fairness'
import { computeStandings, type StandingRow } from './standings'
import type { OpenMatch, OpenSessionState, Side } from './types'

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
  settings: { target: number; winnerOnly: boolean; mode: string }
  version: number
  courts: ViewerCourt[]
  waiting: Array<{ id: string; name: string }>
  onBreak: Array<{ id: string; name: string }>
  roster: Array<{ id: string; name: string }>
  standings: StandingRow[]
  recentResults: Array<{ matchId: string; courtLabel: string; teamA: string[]; teamB: string[]; scoreA: number | null; scoreB: number | null; winner: Side; finishedAt: string }>
}

export interface HostPlayer {
  id: string
  name: string
  status: 'ACTIVE' | 'BREAK' | 'LEFT'
  games: number
  satOut: number
  busy: boolean
  skill: number | null
  duprId: string | null
}

export interface HostCourt {
  id: string
  label: string
  position: number
  enabled: boolean
  match: OpenMatch | null
}

export interface HostSnapshot {
  viewer: ViewerSnapshot
  players: HostPlayer[]
  courts: HostCourt[]
  finished: OpenMatch[]
  settings: OpenSessionState['settings']
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
    settings: { target: state.settings.target, winnerOnly: state.settings.winnerOnly, mode: state.settings.mode },
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

export function toHostSnapshot(state: OpenSessionState): HostSnapshot {
  const busy = busyPlayerIds(state.matches)
  return {
    viewer: toViewerSnapshot(state),
    players: state.players.map((p) => ({
      id: p.id, name: p.name, status: p.status, games: gamesPlayed(p, state.matches),
      satOut: roundsSatOut(p, state), busy: busy.has(p.id), skill: p.skill, duprId: p.duprId,
    })),
    courts: [...state.courts].sort((a, b) => a.position - b.position).map((c) => ({
      id: c.id, label: c.label, position: c.position, enabled: c.enabled, match: c.enabled ? liveMatch(state, c.id) : null,
    })),
    finished: state.matches.filter((m) => m.status === 'FINISHED').sort((a, b) => b.seq - a.seq),
    settings: state.settings,
  }
}

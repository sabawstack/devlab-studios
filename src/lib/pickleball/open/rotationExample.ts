// src/lib/pickleball/open/rotationExample.ts
// The /pickleball/rotation page's worked example is COMPUTED by the real
// engine at build time (spec §11), so the explanation can never describe a
// rotation the app does not actually produce.
import { fillProposals } from './propose'
import { DEFAULT_SETTINGS, type OpenMatch, type OpenSessionState } from './types'

export interface ExampleRound {
  round: number
  courts: Array<{ label: string; teamA: string[]; teamB: string[] }>
  sittingOut: string[]
}

const NAMES = ['Ana', 'Ben', 'Carlo', 'Dina', 'Eli', 'Fay', 'Gio', 'Hana', 'Ivan', 'Jun', 'Kat', 'Leo', 'Mia', 'Nico']
const T0 = Date.parse('2026-01-01T09:00:00.000Z')
const iso = (minute: number) => new Date(T0 + minute * 60_000).toISOString()

export function rotationExample(rounds = 4): ExampleRound[] {
  let n = 0
  const ctx = (minute: number) => ({ now: iso(minute), newId: () => `x${(n += 1)}` })
  let state: OpenSessionState = {
    id: 'example', publicCode: 'EXAMPLE234', kind: 'OPEN_PLAY', name: 'Example', hostDisplayName: 'Host', location: null,
    status: 'ACTIVE', settings: DEFAULT_SETTINGS, version: 1, createdAt: iso(0), lastActivityAt: iso(0), expiresAt: iso(10_000),
    players: NAMES.map((name, i) => ({ id: name, name, skill: null, duprId: null, status: 'ACTIVE', gamesOffset: 0, joinedAt: iso(0), waitingSince: iso(0), position: i + 1 })),
    courts: [1, 2, 3].map((p) => ({ id: `c${p}`, label: `Court ${p}`, position: p, enabled: true })),
    matches: [],
  }
  const out: ExampleRound[] = []
  let minute = 0
  for (let round = 1; round <= rounds; round += 1) {
    minute += 1
    state = fillProposals(state, ctx(minute))
    const live = state.matches.filter((m) => m.status === 'PROPOSED')
    const seated = new Set(live.flatMap((m) => [...m.teamA, ...m.teamB]))
    out.push({
      round,
      courts: live.map((m) => ({ label: state.courts.find((c) => c.id === m.courtId)!.label, teamA: [...m.teamA], teamB: [...m.teamB] })),
      sittingOut: NAMES.filter((name) => !seated.has(name)),
    })
    minute += 12
    state = {
      ...state,
      matches: state.matches.map((m): OpenMatch => (m.status === 'PROPOSED'
        ? { ...m, status: 'FINISHED', startedAt: iso(minute - 11), finishedAt: iso(minute), winner: m.seq % 2 ? 'A' : 'B', scoreA: 11, scoreB: 7 }
        : m)),
      players: state.players.map((p) => (seated.has(p.id) ? { ...p, waitingSince: iso(minute) } : p)),
    }
  }
  return out
}

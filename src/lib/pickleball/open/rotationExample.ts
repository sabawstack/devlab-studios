// src/lib/pickleball/open/rotationExample.ts
// The /pickleball/rotation page's worked examples are COMPUTED by the real
// engine at build time (spec §11), so the explanation can never describe a
// rotation the app does not actually produce.
import { fillProposals } from './propose'
import { DEFAULT_SETTINGS, type OpenMatch, type OpenSessionState, type StackingMode } from './types'

export interface ExampleRound {
  round: number
  courts: Array<{ label: string; teamA: string[]; teamB: string[]; winner: 'A' | 'B'; score: string }>
  sittingOut: string[]
}

const NAMES = ['Ana', 'Ben', 'Carlo', 'Dina', 'Eli', 'Fay', 'Gio', 'Hana', 'Ivan', 'Jun', 'Kat', 'Leo', 'Mia', 'Nico']
const SKILLS = [5, 4, 4, 3, 3, 3, 2, 2, 4, 3, 2, 5, 3, 1]
const T0 = Date.parse('2026-01-01T09:00:00.000Z')
const iso = (minute: number) => new Date(T0 + minute * 60_000).toISOString()

export function rotationExample(rounds = 4, mode: StackingMode = 'PADDLE_STACK'): ExampleRound[] {
  let n = 0
  const ctx = (minute: number) => ({ now: iso(minute), newId: () => `x${(n += 1)}` })
  let state: OpenSessionState = {
    id: 'example', publicCode: 'EXAMPLE234', kind: 'OPEN_PLAY', name: 'Example', hostDisplayName: 'Host', location: null,
    status: 'ACTIVE', settings: { ...DEFAULT_SETTINGS, mode }, version: 1, createdAt: iso(0), lastActivityAt: iso(0), expiresAt: iso(10_000), tournament: null,
    players: NAMES.map((name, i) => ({
      id: name, name, skill: mode === 'BALANCED' ? SKILLS[i] : null, duprId: null, status: 'ACTIVE',
      gamesOffset: 0, joinedAt: iso(0), waitingSince: iso(0), position: i + 1,
    })),
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
    minute += 12
    const results = live.map((m) => ({ id: m.id, winner: (m.seq % 2 ? 'A' : 'B') as 'A' | 'B', loser: 3 + (m.seq % 7) }))
    out.push({
      round,
      courts: live.map((m) => {
        const r = results.find((x) => x.id === m.id)!
        return { label: state.courts.find((c) => c.id === m.courtId)!.label, teamA: [...m.teamA], teamB: [...m.teamB], winner: r.winner, score: `11–${r.loser}` }
      }),
      sittingOut: NAMES.filter((name) => !seated.has(name)),
    })
    state = {
      ...state,
      matches: state.matches.map((m): OpenMatch => {
        const r = results.find((x) => x.id === m.id)
        if (!r) return m
        return {
          ...m, status: 'FINISHED', startedAt: iso(minute - 11), finishedAt: iso(minute), recordedBy: 'Host', winner: r.winner,
          scoreA: r.winner === 'A' ? 11 : r.loser, scoreB: r.winner === 'B' ? 11 : r.loser,
        }
      }),
      players: state.players.map((p) => (seated.has(p.id) ? { ...p, waitingSince: iso(minute) } : p)),
    }
  }
  return out
}

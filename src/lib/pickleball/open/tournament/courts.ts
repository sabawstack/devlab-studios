// src/lib/pickleball/open/tournament/courts.ts
// The court loop for a tournament (spec §6.6): whichever court frees gets the
// next READY fixture whose pairs aren't on court (the reused
// nextPlayableFixture). A pair with a player on a break is skipped until they
// are back.
import { nextPlayableFixture } from '../../tournament/nextPlayableFixture'
import { LIMITS, type OpenSessionState, type Team } from '../types'
import { fixtureLabel } from './labels'

export interface FixtureProposal {
  teamA: Team
  teamB: Team
  fixtureId: string
}

const sameTeam = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id) => b.includes(id))

export function proposeFixture(state: OpenSessionState): FixtureProposal | null {
  const t = state.tournament
  if (!t || t.phase !== 'RUNNING') return null
  const live = state.matches.filter((m) => m.status === 'PROPOSED' || m.status === 'IN_PROGRESS')
  const liveFixtures = new Set(live.map((m) => m.fixtureId).filter(Boolean))
  const livePlayers = new Set(live.flatMap((m) => [...m.teamA, ...m.teamB]))
  const ready = (id: string) => state.players.find((p) => p.id === id)?.status === 'ACTIVE' && !livePlayers.has(id)
  const busy = t.entrants.filter((e) => !e.playerIds.every(ready)).map((e) => e.id)
  const fixture = nextPlayableFixture(t.fixtures.filter((f) => !liveFixtures.has(f.id)), busy)
  if (!fixture) return null
  const a = t.entrants.find((e) => e.id === fixture.entrantAId)
  const b = t.entrants.find((e) => e.id === fixture.entrantBId)
  return a && b ? { teamA: a.playerIds, teamB: b.playerIds, fixtureId: fixture.id } : null
}

/**
 * Withdraws a proposed (not started) tournament game the draw no longer backs:
 * its fixture is no longer READY (a result was taken back), or its pairs or
 * players changed (an opponent swap or a substitute). finalizeCommand then
 * proposes again from the draw as it is now.
 */
export function withoutStaleProposals(state: OpenSessionState): OpenSessionState {
  const t = state.tournament
  if (!t) return state
  const keep = state.matches.filter((m) => {
    if (m.status !== 'PROPOSED' || !m.fixtureId) return true
    const f = t.fixtures.find((x) => x.id === m.fixtureId)
    const a = t.entrants.find((e) => e.id === f?.entrantAId)
    const b = t.entrants.find((e) => e.id === f?.entrantBId)
    return Boolean(f && f.status === 'READY' && a && b && sameTeam(a.playerIds, m.teamA) && sameTeam(b.playerIds, m.teamB))
  })
  return keep.length === state.matches.length ? state : { ...state, matches: keep }
}

/** The first ready game held back because one of its players is on a break, in words. */
function heldByBreak(state: OpenSessionState): string | null {
  const t = state.tournament
  if (!t) return null
  const live = new Set(state.matches.filter((m) => m.status === 'PROPOSED' || m.status === 'IN_PROGRESS').map((m) => m.fixtureId))
  for (const f of t.fixtures) {
    if (f.status !== 'READY' || live.has(f.id)) continue
    for (const entrantId of [f.entrantAId, f.entrantBId]) {
      const pair = t.entrants.find((e) => e.id === entrantId)
      const away = pair?.playerIds.map((id) => state.players.find((p) => p.id === id)).find((p) => p && p.status !== 'ACTIVE')
      if (away) return `${fixtureLabel(t, f)} waits for ${away.name}, who is on a break.`
    }
  }
  return null
}

/** What a free tournament court tells the host while it has nothing to play. */
export function tournamentCourtNote(state: OpenSessionState): string | null {
  const t = state.tournament
  if (!t) return null
  if (t.phase === 'SETUP') return 'Courts fill once you generate the draw and start the tournament.'
  if (t.phase === 'DRAFT') return 'Courts fill once you start the tournament.'
  if (t.phase === 'FINISHED') return 'The tournament is over.'
  // No new game can be proposed past the cap, whatever the draw says.
  if (state.matches.length >= LIMITS.maxMatches) return `This session has reached its ${LIMITS.maxMatches.toLocaleString('en-US')}-game limit.`
  return heldByBreak(state) ?? 'Waiting for a result that decides the next game.'
}

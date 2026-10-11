import { describe, expect, it } from 'vitest'
import { fillProposals, proposeForCourt } from './propose'
import { pairingHistory, pairKey } from './fairness'
import { splitTeams } from './modes/paddleStack'
import { at, court, finished, player, sessionState } from './testing/fixtures'
import type { OpenSessionState, CommandContext, OpenMatch } from './types'

function ctxAt(minute: number): CommandContext {
  let n = 0
  return { now: at(minute), newId: () => `id-${minute}-${(n += 1)}` }
}

describe('splitTeams', () => {
  it('never re-pairs earlier partners when another split avoids it', () => {
    const history = pairingHistory([finished('m1', ['A', 'B'], ['C', 'D'], 'A', 11, 5)])
    const { teamA, teamB } = splitTeams(['A', 'B', 'C', 'D'], history)
    expect(teamA.join('') === 'AB' || teamB.join('') === 'AB').toBe(false)
    expect(teamA.join('') === 'CD' || teamB.join('') === 'CD').toBe(false)
  })
})

describe('proposeForCourt / fillProposals', () => {
  it('fills every free enabled court and leaves busy courts alone', () => {
    const state = sessionState({
      courts: [court('c1', 1), court('c2', 2), court('c3', 3, false)],
      players: Array.from({ length: 10 }, (_, i) => player(`p${i}`, { position: i })),
    })
    const next = fillProposals(state, ctxAt(1))
    expect(next.matches.map((m) => m.courtId)).toEqual(['c1', 'c2'])
    expect(new Set(next.matches.flatMap((m) => [...m.teamA, ...m.teamB])).size).toBe(8)
    expect(fillProposals(next, ctxAt(2)).matches).toHaveLength(2)
  })

  it('proposes nothing with fewer than 4 available players, or once the session ended', () => {
    const three = sessionState({ players: ['a', 'b', 'c'].map((id) => player(id)) })
    expect(proposeForCourt(three)).toBeNull()
    const ended = sessionState({ status: 'ENDED', players: ['a', 'b', 'c', 'd'].map((id) => player(id)) })
    expect(proposeForCourt(ended)).toBeNull()
  })

  it('skipping a proposal offers a different four when possible', () => {
    const state = sessionState({ players: ['a', 'b', 'c', 'd', 'e'].map((id, i) => player(id, { position: i })) })
    const first = proposeForCourt(state)!
    const four = [...first.teamA, ...first.teamB]
    const second = proposeForCourt(state, four)!
    expect([...second.teamA, ...second.teamB].sort()).not.toEqual([...four].sort())
  })

  it('never seats a player on break or who left', () => {
    const state = sessionState({
      players: [player('a'), player('b'), player('c'), player('d', { status: 'BREAK' }), player('e', { status: 'LEFT' }), player('f')],
    })
    const p = proposeForCourt(state)!
    expect([...p.teamA, ...p.teamB].sort()).toEqual(['a', 'b', 'c', 'f'])
  })
})

// Deterministic PRNG so a failure is reproducible.
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Plays synchronous rounds: every court starts, then every court finishes. */
function playRounds(players: number, courts: number, rounds: number, seed: number) {
  const random = mulberry32(seed)
  let state: OpenSessionState = sessionState({
    courts: Array.from({ length: courts }, (_, i) => court(`c${i}`, i + 1)),
    players: Array.from({ length: players }, (_, i) => player(`p${i}`, { position: i })),
  })
  let minute = 0
  let maxSatOut = 0
  for (let round = 0; round < rounds; round += 1) {
    minute += 1
    state = fillProposals(state, ctxAt(minute))
    const proposed = state.matches.filter((m) => m.status === 'PROPOSED')
    // Invariant: nobody is in two live matches.
    const seated = proposed.flatMap((m) => [...m.teamA, ...m.teamB])
    expect(new Set(seated).size).toBe(seated.length)
    minute += 1
    state = {
      ...state,
      matches: state.matches.map((m): OpenMatch => (m.status === 'PROPOSED'
        ? { ...m, status: 'IN_PROGRESS', startedAt: at(minute) }
        : m)),
    }
    // Measure sit-outs for everyone not playing, right after the round starts.
    const playing = new Set(state.matches.filter((m) => m.status === 'IN_PROGRESS').flatMap((m) => [...m.teamA, ...m.teamB]))
    minute += 10
    state = {
      ...state,
      matches: state.matches.map((m): OpenMatch => (m.status === 'IN_PROGRESS'
        ? { ...m, status: 'FINISHED', winner: random() < 0.5 ? 'A' : 'B', finishedAt: at(minute) }
        : m)),
      players: state.players.map((p) => (playing.has(p.id) ? { ...p, waitingSince: at(minute) } : p)),
    }
    for (const p of state.players) {
      if (playing.has(p.id)) continue
      const satOutRounds = state.matches.filter((m) => Date.parse(m.proposedAt) > Date.parse(p.waitingSince) && m.status !== 'PROPOSED').length / courts
      maxSatOut = Math.max(maxSatOut, Math.floor(satOutRounds))
    }
  }
  return { state, maxSatOut }
}

describe('paddle stack fairness (property)', () => {
  it.each([
    [5, 1], [12, 1], [14, 3], [20, 2], [24, 2], [40, 4], [96, 8],
  ])('with %i players on %i courts, games played never spread by more than 1 after each round', (players, courts) => {
    for (const seed of [1, 2, 3]) {
      const { state } = playRounds(players, courts, 30, seed)
      const games = state.players.map((p) => state.matches.filter((m) => m.status === 'FINISHED' && (m.teamA.includes(p.id) || m.teamB.includes(p.id))).length)
      expect(Math.max(...games) - Math.min(...games)).toBeLessThanOrEqual(1)
    }
  })

  it.each([[12, 1], [14, 3], [24, 2], [96, 8]])('with ≤ 12 players per court (%i on %i), nobody sits out more than 2 rounds in a row', (players, courts) => {
    for (const seed of [1, 2, 3]) {
      expect(playRounds(players, courts, 30, seed).maxSatOut).toBeLessThanOrEqual(2)
    }
  })

  it('partners repeat only when the four have no unused split left', () => {
    const { state } = playRounds(8, 2, 6, 7)
    const counts = new Map<string, number>()
    for (const m of state.matches) for (const team of [m.teamA, m.teamB]) counts.set(pairKey(team[0], team[1]), (counts.get(pairKey(team[0], team[1])) ?? 0) + 1)
    // 8 players have 28 possible partnerships; 6 rounds x 2 courts x 2 teams = 24 teams.
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(2)
  })
})

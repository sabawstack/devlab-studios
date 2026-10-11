import { describe, expect, it } from 'vitest'
import { applyCommand, finalizeCommand } from './reducer'
import { fillProposals } from './propose'
import { at, court, player, sessionState } from './testing/fixtures'
import type { CommandContext, OpenSessionState } from './types'

function ctxAt(minute: number): CommandContext {
  let n = 0
  return { now: at(minute), newId: () => `n${minute}-${(n += 1)}` }
}

function ready(): OpenSessionState {
  const base = sessionState({
    courts: [court('c1', 1), court('c2', 2)],
    players: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'].map((id, i) => player(id, { position: i })),
  })
  return fillProposals(base, ctxAt(0))
}

function must(result: ReturnType<typeof applyCommand>): OpenSessionState {
  if (!result.ok) throw new Error(result.error)
  return result.state
}

const proposedOn = (state: OpenSessionState, courtId: string) =>
  state.matches.find((m) => m.courtId === courtId && m.status === 'PROPOSED')!

describe('applyCommand', () => {
  it('records a result from a proposed match (host forgot Start) and frees the court', () => {
    const state = ready()
    const match = proposedOn(state, 'c1')
    const next = must(applyCommand(state, { type: 'RECORD_RESULT', matchId: match.id, winner: 'A', scoreA: 11, scoreB: 7 }, ctxAt(12)))
    const saved = next.matches.find((m) => m.id === match.id)!
    expect(saved).toMatchObject({ status: 'FINISHED', scoreA: 11, scoreB: 7, winner: 'A', startedAt: at(12), finishedAt: at(12) })
    const finalized = finalizeCommand(next, ctxAt(12))
    expect(finalized.matches.filter((m) => m.courtId === 'c1' && m.status === 'PROPOSED')).toHaveLength(1)
    expect(finalized.version).toBe(state.version + 1)
  })

  it('refuses a second save of the same game (409), so it is never counted twice', () => {
    const state = ready()
    const match = proposedOn(state, 'c1')
    const once = must(applyCommand(state, { type: 'RECORD_RESULT', matchId: match.id, winner: 'A', scoreA: 11, scoreB: 7 }, ctxAt(12)))
    const twice = applyCommand(once, { type: 'RECORD_RESULT', matchId: match.id, winner: 'B', scoreA: 5, scoreB: 11 }, ctxAt(13))
    expect(twice).toMatchObject({ ok: false, status: 409 })
  })

  it('rejects an impossible score (400)', () => {
    const state = ready()
    const match = proposedOn(state, 'c1')
    expect(applyCommand(state, { type: 'RECORD_RESULT', matchId: match.id, winner: 'A', scoreA: 12, scoreB: 9 }, ctxAt(5))).toMatchObject({ ok: false, status: 400 })
  })

  it("undo within 2 minutes reopens the game and drops the court's next proposal", () => {
    const state = ready()
    const match = proposedOn(state, 'c1')
    const saved = finalizeCommand(must(applyCommand(state, { type: 'RECORD_RESULT', matchId: match.id, winner: 'A', scoreA: 11, scoreB: 7 }, ctxAt(12))), ctxAt(12))
    const undone = must(applyCommand(saved, { type: 'UNDO_RESULT', matchId: match.id }, ctxAt(13)))
    expect(undone.matches.find((m) => m.id === match.id)).toMatchObject({ status: 'IN_PROGRESS', scoreA: null, winner: null, finishedAt: null })
    expect(undone.matches.filter((m) => m.courtId === 'c1' && m.status === 'PROPOSED')).toHaveLength(0)
  })

  it('undo after 2 minutes is refused with a pointer to edit', () => {
    const state = ready()
    const match = proposedOn(state, 'c1')
    const saved = must(applyCommand(state, { type: 'RECORD_RESULT', matchId: match.id, winner: 'A', scoreA: 11, scoreB: 7 }, ctxAt(12)))
    expect(applyCommand(saved, { type: 'UNDO_RESULT', matchId: match.id }, ctxAt(15))).toMatchObject({ ok: false, status: 409 })
  })

  it('editing a finished result changes the score in place', () => {
    const state = ready()
    const match = proposedOn(state, 'c1')
    const saved = must(applyCommand(state, { type: 'RECORD_RESULT', matchId: match.id, winner: 'A', scoreA: 11, scoreB: 7 }, ctxAt(12)))
    const edited = must(applyCommand(saved, { type: 'EDIT_RESULT', matchId: match.id, winner: 'B', scoreA: 9, scoreB: 11 }, ctxAt(40)))
    expect(edited.matches.find((m) => m.id === match.id)).toMatchObject({ status: 'FINISHED', winner: 'B', scoreA: 9, scoreB: 11 })
  })

  it('putting a proposed player on break drops that proposal; a playing player cannot go on break', () => {
    const state = ready()
    const match = proposedOn(state, 'c1')
    const onBreak = must(applyCommand(state, { type: 'SET_PLAYER_STATUS', playerId: match.teamA[0], status: 'BREAK' }, ctxAt(1)))
    expect(onBreak.matches.find((m) => m.id === match.id)).toBeUndefined()
    const refilled = finalizeCommand(onBreak, ctxAt(1))
    const seated = refilled.matches.filter((m) => m.status === 'PROPOSED').flatMap((m) => [...m.teamA, ...m.teamB])
    expect(seated).not.toContain(match.teamA[0])

    const started = must(applyCommand(state, { type: 'START_MATCH', matchId: match.id }, ctxAt(1)))
    expect(applyCommand(started, { type: 'SET_PLAYER_STATUS', playerId: match.teamA[0], status: 'BREAK' }, ctxAt(2))).toMatchObject({ ok: false, status: 409 })
  })

  it('edit proposal: swaps in an available player and refuses a busy or unknown one', () => {
    const state = ready()
    const c1 = proposedOn(state, 'c1')
    const c2 = proposedOn(state, 'c2')
    const idle = state.players.find((p) => ![...c1.teamA, ...c1.teamB, ...c2.teamA, ...c2.teamB].includes(p.id))!
    const edited = must(applyCommand(state, { type: 'EDIT_PROPOSAL', matchId: c1.id, teamA: [idle.id, c1.teamA[1]], teamB: c1.teamB as [string, string] }, ctxAt(1)))
    expect(edited.matches.find((m) => m.id === c1.id)!.teamA[0]).toBe(idle.id)
    expect(applyCommand(state, { type: 'EDIT_PROPOSAL', matchId: c1.id, teamA: [c2.teamA[0], c1.teamA[1]], teamB: c1.teamB as [string, string] }, ctxAt(1))).toMatchObject({ ok: false, status: 409 })
    expect(applyCommand(state, { type: 'EDIT_PROPOSAL', matchId: c1.id, teamA: ['ghost', c1.teamA[1]], teamB: c1.teamB as [string, string] }, ctxAt(1))).toMatchObject({ ok: false, status: 404 })
    expect(applyCommand(state, { type: 'EDIT_PROPOSAL', matchId: c1.id, teamA: [c1.teamA[1], c1.teamA[1]], teamB: c1.teamB as [string, string] }, ctxAt(1))).toMatchObject({ ok: false, status: 400 })
  })

  it('skip proposal re-proposes a different four on the same court', () => {
    const state = ready()
    const c1 = proposedOn(state, 'c1')
    const skipped = must(applyCommand(state, { type: 'SKIP_PROPOSAL', matchId: c1.id }, ctxAt(1)))
    const replacement = proposedOn(skipped, 'c1')
    expect(replacement.id).not.toBe(c1.id)
    expect([...replacement.teamA, ...replacement.teamB].sort()).not.toEqual([...c1.teamA, ...c1.teamB].sort())
  })

  it('late arrivals start level with the least-played active player', () => {
    let state = ready()
    const c1 = proposedOn(state, 'c1')
    state = finalizeCommand(must(applyCommand(state, { type: 'RECORD_RESULT', matchId: c1.id, winner: 'A', scoreA: 11, scoreB: 3 }, ctxAt(10))), ctxAt(10))
    const c2 = proposedOn(state, 'c2')
    state = finalizeCommand(must(applyCommand(state, { type: 'RECORD_RESULT', matchId: c2.id, winner: 'A', scoreA: 11, scoreB: 3 }, ctxAt(11))), ctxAt(11))
    const added = must(applyCommand(state, { type: 'ADD_PLAYERS', names: ['Late', 'a'] }, ctxAt(12)))
    const late = added.players.find((p) => p.name === 'Late')!
    expect(late.gamesOffset).toBe(0) // player 'i' has still played 0, so the minimum is 0
    expect(added.players.filter((p) => p.name === 'a')).toHaveLength(1) // duplicate ignored
  })

  it('caps the roster at 128 players', () => {
    const full = sessionState({ players: Array.from({ length: 128 }, (_, i) => player(`p${i}`, { name: `P${i}` })) })
    expect(applyCommand(full, { type: 'ADD_PLAYERS', names: ['One more'] }, ctxAt(1))).toMatchObject({ ok: false, status: 409 })
  })

  it('disabling a court with a game in progress is refused; with a proposal, the proposal goes', () => {
    const state = ready()
    const c1 = proposedOn(state, 'c1')
    const off = must(applyCommand(state, { type: 'SET_COURT_ENABLED', courtId: 'c1', enabled: false }, ctxAt(1)))
    expect(off.matches.find((m) => m.id === c1.id)).toBeUndefined()
    const started = must(applyCommand(state, { type: 'START_MATCH', matchId: c1.id }, ctxAt(1)))
    expect(applyCommand(started, { type: 'SET_COURT_ENABLED', courtId: 'c1', enabled: false }, ctxAt(2))).toMatchObject({ ok: false, status: 409 })
  })

  it('ending the session removes proposals but keeps games in progress recordable', () => {
    const state = ready()
    const c1 = proposedOn(state, 'c1')
    const started = must(applyCommand(state, { type: 'START_MATCH', matchId: c1.id }, ctxAt(1)))
    const ended = finalizeCommand(must(applyCommand(started, { type: 'END_SESSION' }, ctxAt(2))), ctxAt(2))
    expect(ended.status).toBe('ENDED')
    expect(ended.matches.filter((m) => m.status === 'PROPOSED')).toHaveLength(0)
    expect(applyCommand(ended, { type: 'RECORD_RESULT', matchId: c1.id, winner: 'B', scoreA: 4, scoreB: 11 }, ctxAt(9)).ok).toBe(true)
  })

  it('returns 404 for an unknown match or player', () => {
    const state = ready()
    expect(applyCommand(state, { type: 'START_MATCH', matchId: 'nope' }, ctxAt(1))).toMatchObject({ ok: false, status: 404 })
    expect(applyCommand(state, { type: 'RENAME_PLAYER', playerId: 'nope', name: 'x' }, ctxAt(1))).toMatchObject({ ok: false, status: 404 })
  })
})

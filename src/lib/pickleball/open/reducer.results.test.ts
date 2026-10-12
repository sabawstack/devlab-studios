// What the final results screen needs from the engine: when the session
// ended, and the first and last game times and count, all public.
import { describe, expect, it } from 'vitest'
import { applyCommand, finalizeCommand } from './reducer'
import { fillProposals } from './propose'
import { toViewerSnapshot } from './snapshot'
import { at, court, finished, player, sessionState } from './testing/fixtures'
import type { CommandContext, OpenSessionState } from './types'

function ctxAt(minute: number): CommandContext {
  let n = 0
  return { now: at(minute), newId: () => `n${minute}-${(n += 1)}` }
}

function run(state: OpenSessionState, command: Parameters<typeof applyCommand>[1], minute: number): OpenSessionState {
  const result = applyCommand(state, command, ctxAt(minute))
  if (!result.ok) throw new Error(result.error)
  return finalizeCommand(result.state, ctxAt(minute))
}

function played(): OpenSessionState {
  return fillProposals(sessionState({
    courts: [court('c1', 1)],
    players: ['a', 'b', 'c', 'd', 'e'].map((id, i) => player(id, { position: i })),
    matches: [
      finished('m1', ['a', 'b'], ['c', 'd'], 'A', 11, 4, 5),
      finished('m2', ['a', 'c'], ['b', 'e'], 'B', 7, 11, 30),
    ],
  }), ctxAt(45))
}

describe('END_SESSION records when the session ended', () => {
  it('sets settings.endedAt to the time of the end, once', () => {
    const ended = run(played(), { type: 'END_SESSION' }, 90)
    expect(ended.settings.endedAt).toBe(at(90))
    // Anything later (a thank-you message, a DUPR ID) keeps the original end time.
    const later = run(ended, { type: 'SET_ANNOUNCEMENT', text: 'Thanks all!' }, 200)
    expect(later.settings.endedAt).toBe(at(90))
    expect(run(later, { type: 'END_SESSION' }, 300).settings.endedAt).toBe(at(90))
  })

  it('an active session has no end time', () => {
    expect(played().settings.endedAt).toBeNull()
  })
})

describe('the viewer snapshot carries the results timing (public data only)', () => {
  it('counts saved games and gives the first start and last finish', () => {
    const viewer = toViewerSnapshot(run(played(), { type: 'END_SESSION' }, 90))
    expect(viewer.games).toEqual({ count: 2, firstStartedAt: at(5), lastFinishedAt: at(40) })
    expect(viewer.endedAt).toBe(at(90))
  })

  it('is empty before any game', () => {
    const viewer = toViewerSnapshot(sessionState())
    expect(viewer.games).toEqual({ count: 0, firstStartedAt: null, lastFinishedAt: null })
    expect(viewer.endedAt).toBeNull()
  })

  it('places come with the standings', () => {
    const viewer = toViewerSnapshot(played())
    expect(viewer.standings.filter((row) => row.played > 0).every((row) => typeof row.place === 'number')).toBe(true)
  })
})

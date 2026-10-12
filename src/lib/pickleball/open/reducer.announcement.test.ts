import { describe, expect, it } from 'vitest'
import { commandSchema } from '../../schemas/pickleball/open/commands'
import { createSessionSchema } from '../../schemas/pickleball/open/createSession'
import { captainRefusal } from './captains'
import { applyCommand } from './reducer'
import { toCaptainSnapshot, toViewerSnapshot } from './snapshot'
import { at, court, sessionState } from './testing/fixtures'
import { emptyTournament } from './tournament/types'
import type { CaptainRecord, CommandContext, OpenSessionState } from './types'

const ctx: CommandContext = { now: at(5), newId: () => 'x' }
const withMessage = (text: string): OpenSessionState => sessionState({ settings: { ...sessionState().settings, announcement: text } })

function must(result: ReturnType<typeof applyCommand>): OpenSessionState {
  if (!result.ok) throw new Error(result.error)
  return result.state
}

describe('SET_ANNOUNCEMENT', () => {
  it('sets the welcome message, trimmed, and the viewer snapshot carries it', () => {
    const next = must(applyCommand(withMessage('Old'), { type: 'SET_ANNOUNCEMENT', text: '  Courts close at 9 🌙  ' }, ctx))
    expect(next.settings.announcement).toBe('Courts close at 9 🌙')
    expect(toViewerSnapshot(next).announcement).toBe('Courts close at 9 🌙')
  })

  it('an empty text clears the message', () => {
    const next = must(applyCommand(withMessage('Old'), { type: 'SET_ANNOUNCEMENT', text: '   ' }, ctx))
    expect(next.settings.announcement).toBe('')
    expect(toViewerSnapshot(next).announcement).toBe('')
  })

  it('refuses a message over 140 characters, even one that slipped past the schema', () => {
    const result = applyCommand(withMessage('Old'), { type: 'SET_ANNOUNCEMENT', text: 'a'.repeat(141) }, ctx)
    expect(result).toMatchObject({ ok: false, status: 400 })
  })

  it('works in a tournament and after the session ends', () => {
    const tournament = sessionState({ kind: 'TOURNAMENT', tournament: emptyTournament('ROUND_ROBIN') })
    expect(must(applyCommand(tournament, { type: 'SET_ANNOUNCEMENT', text: 'Good luck!' }, ctx)).settings.announcement).toBe('Good luck!')
    const ended = sessionState({ status: 'ENDED' })
    expect(must(applyCommand(ended, { type: 'SET_ANNOUNCEMENT', text: 'Thanks all' }, ctx)).settings.announcement).toBe('Thanks all')
  })

  it('is the host’s alone: a captain is refused', () => {
    const captain: CaptainRecord = { id: 'cap1', label: 'Court 1 captain', courtId: 'c1', keyHash: 'h', createdAt: at(0) }
    const state = sessionState({ courts: [court('c1', 1)] })
    expect(captainRefusal({ type: 'SET_ANNOUNCEMENT', text: 'Hi' }, captain, state)).toBe('Only the host can do that.')
    // A captain still reads the message through the public part of their snapshot.
    expect(toCaptainSnapshot(withMessage('Hello'), captain).viewer.announcement).toBe('Hello')
  })
})

describe('announcement schemas', () => {
  it('the command takes a string of at most 140 characters after trimming', () => {
    expect(commandSchema.safeParse({ type: 'SET_ANNOUNCEMENT', text: 'Hi 👋' }).success).toBe(true)
    expect(commandSchema.safeParse({ type: 'SET_ANNOUNCEMENT', text: '' }).success).toBe(true)
    expect(commandSchema.safeParse({ type: 'SET_ANNOUNCEMENT', text: `  ${'a'.repeat(140)}  ` }).success).toBe(true)
    expect(commandSchema.safeParse({ type: 'SET_ANNOUNCEMENT', text: 'a'.repeat(141) }).success).toBe(false)
    expect(commandSchema.safeParse({ type: 'SET_ANNOUNCEMENT', text: null }).success).toBe(false)
    expect(commandSchema.safeParse({ type: 'SET_ANNOUNCEMENT' }).success).toBe(false)
  })

  it('a new session may send its own message; an older client sends none', () => {
    const base = { name: 'Sunday', hostDisplayName: 'Mike', courtCount: 2, players: [] }
    const settings = { mode: 'PADDLE_STACK', target: 11, scoringStyle: 'SIDEOUT' }
    expect(createSessionSchema.safeParse({ ...base, settings }).success).toBe(true)
    expect(createSessionSchema.safeParse({ ...base, settings: { ...settings, announcement: 'Hi all' } }).success).toBe(true)
    expect(createSessionSchema.safeParse({ ...base, settings: { ...settings, announcement: 'a'.repeat(141) } }).success).toBe(false)
  })
})

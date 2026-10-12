import { describe, expect, it } from 'vitest'
import { buildInitialState } from './create'
import { DEFAULT_SETTINGS } from './types'

const ctx = () => {
  let n = 0
  return { now: '2026-10-11T10:00:00.000Z', newId: () => `id${(n += 1)}`, publicCode: 'ABCDE23456', sessionId: 's1' }
}

describe('buildInitialState', () => {
  it('creates labelled courts, cleaned unique players, first proposals and a 7-day expiry', () => {
    const state = buildInitialState({
      name: 'Sunday', hostDisplayName: 'Mike', location: null, courtCount: 2, settings: DEFAULT_SETTINGS,
      players: ['1. Ana', 'Ben', 'ben', 'Carlo', 'Dina', 'Eli', 'Fay', 'Gio', 'Hana', 'Ivan'].map((name) => ({ name, skill: null, duprId: null })),
    }, ctx())
    expect(state.courts.map((c) => c.label)).toEqual(['Court 1', 'Court 2'])
    expect(state.players.map((p) => p.name)).toEqual(['Ana', 'Ben', 'Carlo', 'Dina', 'Eli', 'Fay', 'Gio', 'Hana', 'Ivan'])
    expect(state.matches.filter((m) => m.status === 'PROPOSED')).toHaveLength(2)
    expect(state.expiresAt).toBe('2026-10-18T10:00:00.000Z')
    expect(state.version).toBe(1)
  })

  it('fills the default welcome message for open play and tournaments', () => {
    const base = { name: 'Sunday', hostDisplayName: 'Mike', location: null, courtCount: 1, settings: DEFAULT_SETTINGS, players: [] }
    expect(buildInitialState(base, ctx()).settings.announcement)
      .toBe('Welcome to Sunday! Check the board for your court, play fair and have fun.')
    expect(buildInitialState({ ...base, kind: 'TOURNAMENT', tournamentFormat: 'ROUND_ROBIN' }, ctx()).settings.announcement)
      .toBe('Welcome to Sunday! Check the board for your next game, and good luck!')
  })

  it('shortens the session name in the default so it stays within 140 characters', () => {
    const name = 'The Saturday Morning Mixed Doubles Social Ladder At Riverside '.repeat(2)
    const state = buildInitialState({ name, hostDisplayName: 'Mike', location: null, courtCount: 1, settings: DEFAULT_SETTINGS, players: [] }, ctx())
    expect(state.settings.announcement.length).toBeLessThanOrEqual(140)
    expect(state.settings.announcement).toMatch(/^Welcome to The Saturday Morning .*…! Check the board for your court, play fair and have fun\.$/)
  })

  it('keeps the host’s own message, cleaned, and an empty one means no message', () => {
    const base = { name: 'Sunday', hostDisplayName: 'Mike', location: null, courtCount: 1, settings: DEFAULT_SETTINGS, players: [] }
    expect(buildInitialState({ ...base, announcement: '  Bring water 💧\n' }, ctx()).settings.announcement).toBe('Bring water 💧')
    expect(buildInitialState({ ...base, announcement: '' }, ctx()).settings.announcement).toBe('')
  })

  it('caps players at 128', () => {
    const players = Array.from({ length: 140 }, (_, i) => ({ name: `P${i}`, skill: null, duprId: null }))
    const state = buildInitialState({ name: 'x', hostDisplayName: 'y', location: null, courtCount: 1, settings: DEFAULT_SETTINGS, players }, ctx())
    expect(state.players).toHaveLength(128)
  })
})

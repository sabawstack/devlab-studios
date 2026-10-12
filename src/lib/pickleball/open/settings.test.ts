import { describe, expect, it } from 'vitest'
import { normalizeSettings } from './settings'
import { DEFAULT_SETTINGS } from './types'

describe('normalizeSettings', () => {
  it('fills fields a Phase 1 session never stored, in a fixed key order', () => {
    const legacy = normalizeSettings({ mode: 'PADDLE_STACK', target: 15, scoringStyle: 'RALLY' })
    expect(legacy).toEqual({ mode: 'PADDLE_STACK', target: 15, scoringStyle: 'RALLY', selfCheckIn: true, rules: [], announcement: '', endedAt: null })
    expect(Object.keys(legacy)).toEqual(['mode', 'target', 'scoringStyle', 'selfCheckIn', 'rules', 'announcement', 'endedAt'])
  })

  it('a session from before the welcome message has no message; a stored one is cleaned and capped', () => {
    expect(normalizeSettings({ mode: 'BALANCED', target: 11 }).announcement).toBe('')
    expect(normalizeSettings({ ...DEFAULT_SETTINGS, announcement: '  Hi all 👋 ' }).announcement).toBe('Hi all 👋')
    expect(normalizeSettings({ ...DEFAULT_SETTINGS, announcement: 'x'.repeat(300) }).announcement).toHaveLength(140)
    expect(normalizeSettings({ ...DEFAULT_SETTINGS, announcement: 42 }).announcement).toBe('')
  })

  it('keeps a stored end time only when it is a real ISO date (sessions ended before it existed have none)', () => {
    expect(normalizeSettings({ mode: 'BALANCED' }).endedAt).toBeNull()
    expect(normalizeSettings({ ...DEFAULT_SETTINGS, endedAt: '2026-10-11T12:30:00.000Z' }).endedAt).toBe('2026-10-11T12:30:00.000Z')
    expect(normalizeSettings({ ...DEFAULT_SETTINGS, endedAt: 'yesterday' }).endedAt).toBeNull()
    expect(normalizeSettings({ ...DEFAULT_SETTINGS, endedAt: 42 }).endedAt).toBeNull()
  })

  it('keeps valid rules and drops malformed ones', () => {
    const settings = normalizeSettings({
      ...DEFAULT_SETTINGS,
      rules: [
        { kind: 'TOGETHER', playerIds: ['a', 'b'] },
        { kind: 'APART', playerIds: ['a', 'a'] },
        { kind: 'NEVER', playerIds: ['a', 'c'] },
        { kind: 'APART', playerIds: ['c'] },
        'junk',
      ],
    })
    expect(settings.rules).toEqual([{ kind: 'TOGETHER', playerIds: ['a', 'b'] }])
  })

  it('falls back to defaults for unknown values and non-objects', () => {
    expect(normalizeSettings({ mode: 'KING_OF_THE_COURT', target: 9, selfCheckIn: 'yes' })).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS)
  })
})

import { describe, expect, it } from 'vitest'
import { normalizeSettings } from './settings'
import { DEFAULT_SETTINGS } from './types'

describe('normalizeSettings', () => {
  it('fills fields a Phase 1 session never stored, in a fixed key order', () => {
    const legacy = normalizeSettings({ mode: 'PADDLE_STACK', target: 15, scoringStyle: 'RALLY' })
    expect(legacy).toEqual({ mode: 'PADDLE_STACK', target: 15, scoringStyle: 'RALLY', selfCheckIn: true, rules: [] })
    expect(Object.keys(legacy)).toEqual(['mode', 'target', 'scoringStyle', 'selfCheckIn', 'rules'])
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

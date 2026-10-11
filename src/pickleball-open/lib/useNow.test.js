import { describe, expect, it } from 'vitest'
import { minutesSince } from './useNow'

describe('minutesSince', () => {
  const now = Date.parse('2026-10-12T10:30:00.000Z')

  it('counts whole minutes', () => {
    expect(minutesSince('2026-10-12T10:00:00.000Z', now)).toBe(30)
    expect(minutesSince('2026-10-12T10:29:59.000Z', now)).toBe(0)
  })

  it('never goes negative or NaN', () => {
    expect(minutesSince('2026-10-12T11:00:00.000Z', now)).toBe(0)
    expect(minutesSince(null, now)).toBe(0)
    expect(minutesSince('not a date', now)).toBe(0)
  })
})

import { describe, expect, it } from 'vitest'
import { claimStateFor, DUPR_EXPORT_LIMIT, exportsLeft, exportWindowStart, hoursUntilNextExport, limitMessage } from './policy'

describe('claimStateFor', () => {
  it('is unclaimed, mine, or someone else’s (including when signed out)', () => {
    expect(claimStateFor(null, null)).toBe('UNCLAIMED')
    expect(claimStateFor(null, 'h1')).toBe('UNCLAIMED')
    expect(claimStateFor('h1', 'h1')).toBe('MINE')
    expect(claimStateFor('h1', 'h2')).toBe('OTHER')
    expect(claimStateFor('h1', null)).toBe('OTHER')
  })
})

describe('the 5-a-day limit', () => {
  const now = '2026-10-12T12:00:00.000Z'
  it('counts exports in the last 24 hours', () => {
    expect(DUPR_EXPORT_LIMIT).toBe(5)
    expect(exportWindowStart(now)).toBe('2026-10-11T12:00:00.000Z')
    expect(exportsLeft([])).toBe(5)
    expect(exportsLeft(['a', 'b', 'c', 'd', 'e', 'f'])).toBe(0)
  })

  it('says when the next export frees up', () => {
    const sent = ['2026-10-11T14:30:00.000Z', '2026-10-12T09:00:00.000Z']
    expect(hoursUntilNextExport(sent, now)).toBe(3)
    expect(hoursUntilNextExport(['2026-10-11T12:30:00.000Z'], now)).toBe(1)
    expect(limitMessage(sent, now)).toBe('A session can be sent to DUPR 5 times a day. Try again in about 3 hours.')
    expect(limitMessage(['2026-10-11T12:30:00.000Z'], now)).toBe('A session can be sent to DUPR 5 times a day. Try again in about 1 hour.')
  })
})

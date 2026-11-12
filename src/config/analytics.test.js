import { describe, expect, it } from 'vitest'
import { DEFAULT_ANALYTICS, resolveGaMeasurementId } from './analytics.js'

describe('resolveGaMeasurementId (OPS-05)', () => {
  it('defaults to today\'s id', () => {
    expect(resolveGaMeasurementId(undefined)).toBe(DEFAULT_ANALYTICS.gaMeasurementId)
    expect(resolveGaMeasurementId({})).toBe(DEFAULT_ANALYTICS.gaMeasurementId)
  })
  it('uses a stored valid id and refuses anything else', () => {
    expect(resolveGaMeasurementId({ gaMeasurementId: 'g-abc1234' })).toBe('G-ABC1234')
    expect(resolveGaMeasurementId({ gaMeasurementId: "G-X'><script>" })).toBe(DEFAULT_ANALYTICS.gaMeasurementId)
  })
  it('can be turned off', () => {
    expect(resolveGaMeasurementId({ enabled: false, gaMeasurementId: 'G-ABC1234' })).toBe('')
  })
})

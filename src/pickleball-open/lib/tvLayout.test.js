import { describe, expect, it } from 'vitest'
import { tvColumns, tvRows } from './tvLayout'

describe('tv layout', () => {
  it('fits every court count from 1 to 16 in at most 4 columns and 4 rows', () => {
    for (let n = 1; n <= 16; n += 1) {
      expect(tvColumns(n), `${n} courts`).toBeLessThanOrEqual(4)
      expect(tvRows(n), `${n} courts`).toBeLessThanOrEqual(4)
      expect(tvColumns(n) * tvRows(n)).toBeGreaterThanOrEqual(n)
    }
  })

  it('uses a square-ish grid for common counts', () => {
    expect([1, 2, 3, 4, 6, 8, 9, 12, 16].map((n) => `${tvColumns(n)}x${tvRows(n)}`))
      .toEqual(['1x1', '2x1', '3x1', '2x2', '3x2', '4x2', '3x3', '4x3', '4x4'])
  })

  it('clamps nonsense to one court', () => {
    expect(tvColumns(0)).toBe(1)
    expect(tvColumns(Number.NaN)).toBe(1)
    expect(tvColumns(40)).toBe(4)
  })
})

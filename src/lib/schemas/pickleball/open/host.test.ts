import { describe, expect, it } from 'vitest'
import { duprExportRequestSchema } from './host'

describe('duprExportRequestSchema', () => {
  it('accepts no zone, or a real IANA zone', () => {
    expect(duprExportRequestSchema.safeParse({}).success).toBe(true)
    expect(duprExportRequestSchema.safeParse({ timeZone: 'Asia/Manila' }).data).toEqual({ timeZone: 'Asia/Manila' })
    expect(duprExportRequestSchema.safeParse({ timeZone: 'UTC' }).success).toBe(true)
  })

  it('refuses a zone that is not one, rather than quietly dating games in UTC', () => {
    for (const timeZone of ['Mars/Olympus', '', 'x'.repeat(65), 42]) {
      expect(duprExportRequestSchema.safeParse({ timeZone }).success).toBe(false)
    }
  })
})

import { describe, expect, it } from 'vitest'
import { duprExportRequestSchema } from './host'

describe('duprExportRequestSchema', () => {
  it('keeps a real IANA zone', () => {
    expect(duprExportRequestSchema.safeParse({ timeZone: 'Asia/Manila' }).data).toEqual({ timeZone: 'Asia/Manila' })
    expect(duprExportRequestSchema.safeParse({ timeZone: 'UTC' }).data).toEqual({ timeZone: 'UTC' })
  })

  it('dates games in UTC for no zone or one it does not know, like GET …/dupr?tz=', () => {
    expect(duprExportRequestSchema.safeParse({}).data).toEqual({ timeZone: 'UTC' })
    for (const timeZone of ['Mars/Olympus', '', 'x'.repeat(65)]) {
      expect(duprExportRequestSchema.safeParse({ timeZone }).data, timeZone).toEqual({ timeZone: 'UTC' })
    }
  })

  it('refuses a zone that is not text, and a body that is not an object', () => {
    expect(duprExportRequestSchema.safeParse({ timeZone: 42 }).error?.issues[0].path).toEqual(['timeZone'])
    expect(duprExportRequestSchema.safeParse([]).success).toBe(false)
  })
})

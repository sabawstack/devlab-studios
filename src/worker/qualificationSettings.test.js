import { describe, expect, it, vi } from 'vitest'
import { loadQualificationSettings, QUALIFICATION_SETTINGS_KEY } from './inquiryService.js'
import { DEFAULT_QUALIFICATION_SETTINGS } from '../lib/leads/qualification'

const dbWith = (row) => ({
  prepare: (sql) => ({
    bind: (key) => ({
      first: async () => {
        expect(sql).toMatch(/FROM site_settings WHERE key = \?/)
        expect(key).toBe(QUALIFICATION_SETTINGS_KEY)
        return row
      },
    }),
  }),
})

describe('loadQualificationSettings (LEAD-04)', () => {
  it('uses the defaults when nothing is stored', async () => {
    expect(await loadQualificationSettings(dbWith(null))).toEqual(DEFAULT_QUALIFICATION_SETTINGS)
  })

  it('applies stored overrides', async () => {
    const settings = await loadQualificationSettings(dbWith({ value_json: JSON.stringify({ thresholds: { priority: 70 } }) }))
    expect(settings.thresholds.priority).toBe(70)
    expect(settings.thresholds.standard).toBe(55)
  })

  it('falls back to the defaults when the read fails, so no lead is lost', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const db = { prepare: () => ({ bind: () => ({ first: async () => { throw new Error('D1 down') } }) }) }
    expect(await loadQualificationSettings(db)).toEqual(DEFAULT_QUALIFICATION_SETTINGS)
    expect(log).toHaveBeenCalled()
    log.mockRestore()
  })
})

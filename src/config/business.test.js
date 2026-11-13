import { describe, expect, it } from 'vitest'
import { BUSINESS_DEFAULTS, businessHoursLine, replyWindowLine, resolveBusinessSettings } from './business.js'
import { siteSettingsContentSchema } from '../lib/schemas/legacyContentTypes'

// CMS-02: business settings live in site_settings (`site_business`), with the
// owner's 2026-11-13 decisions as the code defaults (spec Q-02, Q-04, Q-05).
describe('business settings defaults (owner decisions 2026-11-13)', () => {
  it('reply within one business day, Monday to Friday 9:00–18:00 Philippine time', () => {
    expect(BUSINESS_DEFAULTS).toMatchObject({ replyWindowDays: 1, businessHours: 'Monday to Friday, 9:00–18:00', timeZoneLabel: 'Philippine time (UTC+8)' })
  })

  it('the audit price line is "Quoted after a 30-minute call"', () => {
    expect(BUSINESS_DEFAULTS.auditPriceLine).toBe('Quoted after a 30-minute call')
  })

  it('email and form only: no scheduling or chat channel is set', () => {
    expect(BUSINESS_DEFAULTS).toMatchObject({ schedulingUrl: '', messengerUrl: '', whatsappUrl: '' })
  })
})

describe('resolveBusinessSettings', () => {
  it('uses the defaults when the row is absent or empty', () => {
    expect(resolveBusinessSettings(undefined)).toEqual(BUSINESS_DEFAULTS)
    expect(resolveBusinessSettings({ replyWindowDays: null, businessHours: '  ', auditPriceLine: '' })).toEqual(BUSINESS_DEFAULTS)
  })

  it('takes each stored value that is set, field by field', () => {
    expect(resolveBusinessSettings({ replyWindowDays: 2, auditPriceLine: 'From US$900' })).toEqual({ ...BUSINESS_DEFAULTS, replyWindowDays: 2, auditPriceLine: 'From US$900' })
  })

  it('drops a channel link that is not https', () => {
    expect(resolveBusinessSettings({ messengerUrl: 'javascript:alert(1)', whatsappUrl: 'https://wa.me/000' })).toMatchObject({ messengerUrl: '', whatsappUrl: 'https://wa.me/000' })
  })
})

describe('the sentences the pages and the receipt email use', () => {
  it('states the reply window in business days', () => {
    expect(replyWindowLine(BUSINESS_DEFAULTS)).toBe('within one business day')
    expect(replyWindowLine({ ...BUSINESS_DEFAULTS, replyWindowDays: 2 })).toBe('within 2 business days')
  })

  it('states the hours with the time zone', () => {
    expect(businessHoursLine(BUSINESS_DEFAULTS)).toBe('Monday to Friday, 9:00–18:00 Philippine time (UTC+8)')
  })
})

describe('admin validation of the business settings', () => {
  const parse = (business) => siteSettingsContentSchema.safeParse({ business })

  it('accepts the defaults and blanks', () => {
    expect(parse(BUSINESS_DEFAULTS).success).toBe(true)
    expect(parse({ replyWindowDays: null, schedulingUrl: '' }).success).toBe(true)
  })

  it('rejects a reply window outside 1–10 business days and non-https channel links', () => {
    expect(parse({ replyWindowDays: 0 }).success).toBe(false)
    expect(parse({ replyWindowDays: 11 }).success).toBe(false)
    expect(parse({ messengerUrl: 'http://m.me/x' }).success).toBe(false)
  })

  it('caps the free-text lines', () => {
    expect(parse({ auditPriceLine: 'x'.repeat(81) }).success).toBe(false)
  })
})

// Business settings shown to buyers (spec K.1, K.4; CMS-02): the reply window,
// hours and time zone, the scheduling and chat channels, and the audit price
// line. An admin changes them in Site Settings ("Business details"), stored in
// site_settings `site_business`; each unset field falls back to these
// defaults, which are the owner's decisions of 2026-11-13 (Q-02, Q-04, Q-05).
// No page, email or component hardcodes these values: they read
// resolveBusinessSettings() through loadSiteSettings().

export const BUSINESS_DEFAULTS = Object.freeze({
  /** Reply window in business days (Q-04). */
  replyWindowDays: 1,
  businessHours: 'Monday to Friday, 9:00–18:00',
  timeZoneLabel: 'Philippine time (UTC+8)',
  /** Email and form only (Q-05): a channel shows only once its link is set. */
  schedulingUrl: '',
  messengerUrl: '',
  whatsappUrl: '',
  /** Q-02: no published figure. */
  auditPriceLine: 'Quoted after a 30-minute call',
})

const TEXT_FIELDS = ['businessHours', 'timeZoneLabel', 'auditPriceLine']
const LINK_FIELDS = ['schedulingUrl', 'messengerUrl', 'whatsappUrl']

/** The stored row merged over the defaults, field by field; links must be https. */
export function resolveBusinessSettings(stored) {
  const row = stored && typeof stored === 'object' ? stored : {}
  const resolved = { ...BUSINESS_DEFAULTS }
  const days = Number(row.replyWindowDays)
  if (row.replyWindowDays != null && Number.isInteger(days) && days >= 1 && days <= 10) resolved.replyWindowDays = days
  for (const field of TEXT_FIELDS) {
    const value = String(row[field] ?? '').trim()
    if (value) resolved[field] = value
  }
  for (const field of LINK_FIELDS) {
    const value = String(row[field] ?? '').trim()
    resolved[field] = /^https:\/\/[^\s]+$/i.test(value) ? value : ''
  }
  return resolved
}

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']

/** "within one business day" / "within 2 business days". */
export function replyWindowLine(settings) {
  const days = settings.replyWindowDays
  return days === 1 ? `within ${NUMBER_WORDS[1]} business day` : `within ${days} business days`
}

/** "Monday to Friday, 9:00–18:00 Philippine time (UTC+8)". */
export function businessHoursLine(settings) {
  return `${settings.businessHours} ${settings.timeZoneLabel}`.trim()
}

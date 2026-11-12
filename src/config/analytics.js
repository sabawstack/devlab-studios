/**
 * Analytics settings (audit OPS-05). The Google Analytics 4 measurement id is
 * an admin setting (Site Settings → Analytics, stored in site_settings key
 * `site_analytics`) with today's id as the default. GA4 runs cookieless
 * (client_storage: none, anonymised IP); the privacy page says so.
 */
export const DEFAULT_ANALYTICS = { enabled: true, gaMeasurementId: 'G-MD3PL91M9G' }

export const GA_MEASUREMENT_ID_PATTERN = /^G-[A-Z0-9]{4,16}$/

/** The id to render, or '' for no analytics. Anything invalid falls back to the default. */
export function resolveGaMeasurementId(stored) {
  if (stored && stored.enabled === false) return ''
  const id = String(stored?.gaMeasurementId || '').trim().toUpperCase()
  return GA_MEASUREMENT_ID_PATTERN.test(id) ? id : DEFAULT_ANALYTICS.gaMeasurementId
}

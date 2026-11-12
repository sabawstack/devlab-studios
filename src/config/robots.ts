/**
 * Robots directives per public route (audit WEB-02 / SEO-06), in one place for
 * the `<meta name="robots">` tag and the `X-Robots-Tag` header.
 *
 * Kept out of search but still reachable and followed: the daily digest
 * (thin, changes daily), lead-magnet offer pages (form landing pages), the
 * crawler explainer, the maintenance and error pages, and the legacy landing
 * samples.
 */
const NOINDEX_EXACT = new Set(['/insights/daily', '/crawler', '/maintenance', '/404'])
const NOINDEX_PREFIXES = ['/offers/', '/landing-sample-']

export function isNoindexPath(path: string): boolean {
  const normalized = path.replace(/\/+$/, '') || '/'
  return NOINDEX_EXACT.has(normalized) || NOINDEX_PREFIXES.some((prefix) => normalized.startsWith(prefix))
}

export function robotsDirectiveFor(path: string): string {
  return isNoindexPath(path) ? 'noindex, follow' : 'index, follow'
}

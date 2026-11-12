/**
 * Script sources the pages may load, shared by the CSP response header
 * (src/lib/securityHeaders.ts) and Astro's per-page CSP <meta> (astro.config.mjs,
 * audit SEC-07). The <meta> adds a hash for every script Astro renders and no
 * 'unsafe-inline', so an inline script or event handler that Astro did not
 * render is blocked even though the header still lists 'unsafe-inline' for
 * older browsers' sake (a page must satisfy both policies).
 */
export const SCRIPT_SOURCES = [
  "'self'",
  'https://www.googletagmanager.com',
  'https://challenges.cloudflare.com',
  // Cloudflare Web Analytics, injected by the zone.
  'https://static.cloudflareinsights.com',
]

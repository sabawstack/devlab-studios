const LOCALHOST_HOSTNAMES = new Set(['localhost', '127.0.0.1'])

function buildContentSecurityPolicy(isLocalhost: boolean): string {
  const directives = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://challenges.cloudflare.com",
    "connect-src 'self' https://www.google-analytics.com https://region1.google-analytics.com https://analytics.google.com https://stats.g.doubleclick.net https://www.google.com https://www.googletagmanager.com https://challenges.cloudflare.com",
    "img-src 'self' data: https:",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "frame-src 'self' https://challenges.cloudflare.com",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ]

  /**
   * `upgrade-insecure-requests` is a no-op in production (served over real
   * HTTPS), but WebKit — unlike Chromium — does not treat `http://localhost`
   * as a secure context exempt from the upgrade: it rewrites every
   * subresource request to `https://localhost` and fails to connect since
   * `astro preview`/`wrangler dev` only speak plain HTTP. Omitting it for
   * local hosts is what lets the desktop-safari/mobile-safari Playwright
   * projects actually load styles and hydrate islands locally.
   */
  if (!isLocalhost) {
    directives.push('upgrade-insecure-requests')
  }

  return directives.join('; ')
}

function buildSecurityHeaders(isLocalhost: boolean): Record<string, string> {
  return {
    'Content-Security-Policy': buildContentSecurityPolicy(isLocalhost),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
  }
}

function robotsTagFor(pathname: string): string | null {
  if (pathname.startsWith('/admin') || pathname.startsWith('/api/admin/')) return 'noindex, nofollow'
  if (pathname.startsWith('/landing-sample-')) return 'noindex, follow'
  return null
}

/**
 * public/_headers only ever applies to responses served directly from the
 * static ASSETS binding. With output:'server', almost every real response —
 * every page, /admin, every /api/* route — is instead rendered by Astro and
 * passes through this middleware, so _headers never actually reached them
 * (confirmed by curling a built-and-served page: no CSP/HSTS/etc showed up).
 * This is the real enforcement point; _headers stays only as a redundant
 * safety net for the genuinely-static leftovers (robots.txt, /_astro/*, ...).
 */
export function applySecurityHeaders(response: Response, pathname: string, hostname: string): Response {
  // A WebSocket upgrade response (status 101, carrying Cloudflare's
  // Workers-Runtime-only `webSocket` property alongside it) cannot go
  // through `new Response(...)` below at all -- the Fetch spec's Response
  // constructor rejects any status outside 200-599, so reconstructing it
  // here throws a RangeError before the handshake ever reaches the client.
  // Even setting that aside, a plain `new Response(...)` would silently
  // drop the `webSocket` property, breaking the upgrade just as badly.
  // Security headers are meaningless on a 101 handshake response anyway, so
  // it passes through completely untouched. See src/worker/pickleball/open/
  // OpenSessionDO.ts's fetch() for the response this guards.
  if (response.status === 101) {
    return response
  }

  const headers = new Headers(response.headers)
  const isLocalhost = LOCALHOST_HOSTNAMES.has(hostname)

  for (const [name, value] of Object.entries(buildSecurityHeaders(isLocalhost))) {
    headers.set(name, value)
  }

  const robotsTag = robotsTagFor(pathname)
  if (robotsTag) {
    headers.set('X-Robots-Tag', robotsTag)
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

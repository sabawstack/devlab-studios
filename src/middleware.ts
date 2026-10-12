import { defineMiddleware } from 'astro:middleware'
import { requireAdmin } from './worker/middleware/adminAuth.js'
import { createHonoLikeContext } from './lib/honoShim.js'
import { getEnv } from './lib/env'
import { getSiteSetting } from './worker/repositories/content.js'
import { findRedirect } from './worker/repositories/redirects.js'
import { applySecurityHeaders } from './lib/securityHeaders'
import { drainRequestBody } from './lib/http'
import { requirePickleballSession } from './worker/pickleball/authContext.js'

const ADMIN_API_PREFIX = '/api/admin/'
const ADMIN_PUBLIC_ROUTES = new Set(['/api/admin/login', '/api/admin/logout'])
const PICKLEBALL_API_PREFIX = '/api/pickleball/'
const PICKLEBALL_PUBLIC_ROUTES = new Set([
  '/api/pickleball/auth/google/start',
  '/api/pickleball/auth/google/callback',
  '/api/pickleball/auth/session',
  '/api/pickleball/auth/logout',
  '/api/pickleball/auth/test-login',
  // Not actually unauthenticated -- switch-org.ts calls requirePickleballSession
  // itself, with the platform-admin-suspended-org allowance the blanket check
  // below doesn't know about (see authContext.js's allowSuspendedOrgForPlatformAdmin).
  // Excluded here the same way /auth/session already is, for the same reason:
  // the blanket check's plain 403 would otherwise re-lock out a platform admin
  // whose activeOrgId is the SUSPENDED org they're trying to switch away from.
  '/api/pickleball/auth/switch-org',
])
// The public polling fallback (Task 8) is, by definition, for an
// unauthenticated spectator whose socket is down -- it must be reachable
// without a session cookie, same as the public WebSocket channel already is
// by living outside this prefix entirely (/pickleball/rt/public/[code]).
// Dynamic [code] segments don't fit PICKLEBALL_PUBLIC_ROUTES' exact-match
// Set, so this is a prefix check instead; the route's own handler still
// does the real authorization (public_view_enabled + revoked-code 404).
const PICKLEBALL_PUBLIC_STATE_PREFIX = '/api/pickleball/public/'
// Free open play (spec 2026-10-11) has no login at all: its routes authorize
// with the session's host key inside the Durable Object, so the operator
// session gate below must never run for them.
const PICKLEBALL_OPEN_PREFIX = '/api/pickleball/open/'
// The org-invite accept route requires only a valid Google-authenticated
// session (via requireGoogleIdentity), never org membership -- by
// definition, the caller has no membership anywhere yet. It cannot go
// through the blanket requirePickleballSession gate below, so it's
// excluded the same way the public state-polling prefix is.
const PICKLEBALL_ORG_INVITE_ACCEPT_PREFIX = '/api/pickleball/auth/org-invites/'
// All 5 routes under this prefix authenticate exclusively via
// requirePlatformAdmin (Google identity + is_platform_admin), which -- unlike
// requirePickleballSession -- never looks at activeOrgId or organization
// status at all. Routing them through the blanket requirePickleballSession
// gate below first would 403 a platform admin whose own activeOrgId happens
// to point at a SUSPENDED org before their request ever reaches the route's
// own (correct, org-status-agnostic) check -- including on the
// .../reactivate call that's supposed to be how they recover from exactly
// that state. Excluded the same way the org-invite-accept prefix is, for the
// same reason: it cannot go through the blanket gate.
const PICKLEBALL_PLATFORM_ADMIN_PREFIX = '/api/pickleball/platform/'
const MAINTENANCE_PAGE = '/maintenance'
const MAINTENANCE_GATED_PATHS = new Set(['/', '/about', '/solutions', '/profile', '/insights'])

/**
 * Permanent renames of public routes.
 *
 * In code rather than the CMS `redirects` table on purpose: these are URLs
 * that have been published and linked to, and the D1 table is editable from
 * the admin's Redirects screen — one accidental delete there would turn an
 * externally-linked URL into a 404. A rename is an architectural fact, so it
 * lives with the architecture.
 *
 * Checked before routing, so the redirect does not depend on the destination
 * having 404'd first (unlike the CMS table, which is only consulted on a 404).
 */
const PERMANENT_PATH_REDIRECTS = new Map([
  // The nav, page title, SEO metadata and every internal label said
  // "Solutions" while the route said "services"; the CMS SEO record even
  // carried a canonical pointing at /solutions, which was a 404.
  ['/services', '/solutions'],
])

function isMaintenanceGated(pathname: string): boolean {
  return MAINTENANCE_GATED_PATHS.has(pathname) || pathname.startsWith('/insights/')
}

export const onRequest = defineMiddleware(async (context, next) => {
  const url = new URL(context.request.url)
  const forwardedProto = context.request.headers.get('x-forwarded-proto')
  const shouldUseWww = url.hostname === 'devlabstudios.com'
  const shouldUseHttps = url.hostname.endsWith('devlabstudios.com') && (url.protocol === 'http:' || forwardedProto === 'http')

  if (shouldUseWww || shouldUseHttps) {
    url.hostname = 'www.devlabstudios.com'
    url.protocol = 'https:'
    return applySecurityHeaders(Response.redirect(url.toString(), 301), url.pathname, url.hostname)
  }

  const renamedTo = PERMANENT_PATH_REDIRECTS.get(url.pathname.replace(/\/+$/, '') || '/')
  if (renamedTo) {
    const destination = new URL(renamedTo + url.search, url)
    return applySecurityHeaders(Response.redirect(destination.toString(), 301), url.pathname, url.hostname)
  }

  if (url.pathname.startsWith(ADMIN_API_PREFIX) && !ADMIN_PUBLIC_ROUTES.has(url.pathname)) {
    const honoContext = createHonoLikeContext(context.request, getEnv(), context.locals)
    let didContinue = false
    const result = await requireAdmin(honoContext, async () => {
      didContinue = true
      return undefined
    })

    if (!didContinue) {
      // The rejection never read the body — drain it before responding.
      await drainRequestBody(context.request)
      return applySecurityHeaders(result, url.pathname, url.hostname)
    }
  }

  if (
    url.pathname.startsWith(PICKLEBALL_API_PREFIX) &&
    !PICKLEBALL_PUBLIC_ROUTES.has(url.pathname) &&
    !url.pathname.startsWith(PICKLEBALL_PUBLIC_STATE_PREFIX) &&
    !url.pathname.startsWith(PICKLEBALL_OPEN_PREFIX) &&
    !url.pathname.startsWith(PICKLEBALL_ORG_INVITE_ACCEPT_PREFIX) &&
    !url.pathname.startsWith(PICKLEBALL_PLATFORM_ADMIN_PREFIX)
  ) {
    try {
      await requirePickleballSession(context.request, getEnv())
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unexpected error.'
      const rawStatus = error instanceof Error ? (error as Error & { status?: unknown }).status : undefined
      const status = typeof rawStatus === 'number' ? rawStatus : 500
      return applySecurityHeaders(
        new Response(JSON.stringify({ error: message }), { status }),
        url.pathname,
        url.hostname,
      )
    }
  }

  if (isMaintenanceGated(url.pathname) && url.pathname !== MAINTENANCE_PAGE) {
    const env = getEnv()
    const maintenanceMode = env.DB ? await getSiteSetting(env.DB, 'maintenance_mode', false) : false
    if (maintenanceMode) {
      return applySecurityHeaders(await next(MAINTENANCE_PAGE), url.pathname, url.hostname)
    }
  }

  const response = await next()

  // The admin's Redirects screen (D1 `redirects` table) only needs to be
  // consulted for paths nothing else already handled — so this only ever
  // runs on an actual 404, not on every request/asset.
  if (context.request.method === 'GET' && response.status === 404) {
    const env = getEnv()
    if (env.DB) {
      const redirect = await findRedirect(env.DB, url.pathname)
      if (redirect) {
        const destination = new URL(redirect.toPath, url)
        return applySecurityHeaders(Response.redirect(destination.toString(), redirect.statusCode), url.pathname, url.hostname)
      }
    }
  }

  return applySecurityHeaders(response, url.pathname, url.hostname)
})

import { defineMiddleware } from 'astro:middleware'
import { requireAdmin } from './worker/middleware/adminAuth.js'
import { createHonoLikeContext } from './lib/honoShim.js'
import { getEnv } from './lib/env'
import { findRedirectSafely, readMaintenanceMode } from './lib/publicGates'
import {
  asServed,
  bumpGeneration,
  cacheKeyUrl,
  forStorage,
  isCacheableRequest,
  isCacheEnabled,
  isStorableResponse,
  readGeneration,
  ttlSeconds,
} from './lib/cache/htmlCache'
import { applySecurityHeaders } from './lib/securityHeaders'
import { drainRequestBody } from './lib/http'
import { isAdminApiPath, routePath } from './lib/routePath'

const ADMIN_PUBLIC_ROUTES = new Set(['/api/admin/login', '/api/admin/logout'])
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
  // The delivery approach now lives on About (audit UX-10 / G.1).
  ['/process', '/about#how-we-work'],
  // Starter templates are no longer presented as work (audit WEB-07 / BUS-F04).
  ['/landing-sample-react', '/work'],
  ['/landing-sample-html', '/work'],
  ['/landing-sample-fullstack', '/work'],
  ['/landing-sample-local-service', '/work'],
  ['/landing-sample-ecommerce', '/work'],
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
    // The query string goes before any fragment in the target (`/about#how-we-work`).
    const destination = new URL(renamedTo, url)
    destination.search = url.search
    return applySecurityHeaders(Response.redirect(destination.toString(), 301), url.pathname, url.hostname)
  }

  // Security decisions use the path the router will actually match: Astro
  // decodes percent-escapes before routing, so the raw pathname is not enough
  // (`/api/%61dmin/...` used to skip this gate and still reach the route).
  const path = routePath(url.pathname)
  if (path === null) {
    await drainRequestBody(context.request)
    return applySecurityHeaders(new Response('Bad request', { status: 400 }), url.pathname, url.hostname)
  }

  if (isAdminApiPath(path) && !ADMIN_PUBLIC_ROUTES.has(path)) {
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

  if (isMaintenanceGated(path) && path !== MAINTENANCE_PAGE) {
    if (await readMaintenanceMode(getEnv().DB)) {
      return applySecurityHeaders(await next(MAINTENANCE_PAGE), url.pathname, url.hostname)
    }
  }

  // OPS-01: serve the business pages from the edge HTML cache when we can.
  // After the admin gate and the maintenance check, so neither is bypassed.
  const env = getEnv()
  const edgeCache = (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default
  let cacheKey: Request | null = null
  if (edgeCache && isCacheEnabled(env) && isCacheableRequest(context.request, path)) {
    const generation = await readGeneration(env.DB)
    if (generation !== null) {
      cacheKey = new Request(cacheKeyUrl(url, generation))
      const hit = await edgeCache.match(cacheKey).catch(() => undefined)
      if (hit) return applySecurityHeaders(asServed(hit, 'HIT'), url.pathname, url.hostname)
    }
  }

  const response = await next()

  // Any successful admin write may change what a public page shows: move the
  // HTML cache to a new generation so the next request renders afresh.
  if (isAdminApiPath(path) && !ADMIN_PUBLIC_ROUTES.has(path) && !['GET', 'HEAD'].includes(context.request.method) && response.ok) {
    const bump = bumpGeneration(env.DB).catch((error) => console.error('html cache generation bump failed', error))
    if (context.locals.cfContext) context.locals.cfContext.waitUntil(bump)
    else await bump
  }

  if (cacheKey && edgeCache && isStorableResponse(response)) {
    const store = edgeCache.put(cacheKey, forStorage(response.clone(), ttlSeconds(env))).catch((error) => console.error('html cache put failed', error))
    if (context.locals.cfContext) context.locals.cfContext.waitUntil(store)
    else await store
    return applySecurityHeaders(asServed(response, 'MISS'), url.pathname, url.hostname)
  }

  // The admin's Redirects screen (D1 `redirects` table) only needs to be
  // consulted for paths nothing else already handled — so this only ever
  // runs on an actual 404, not on every request/asset. A row matches its exact
  // path, or every path below it when its from_path ends in /* (findRedirect).
  if (context.request.method === 'GET' && response.status === 404) {
    const redirect = await findRedirectSafely(getEnv().DB, url.pathname)
    if (redirect) {
      const destination = new URL(redirect.toPath, url)
      return applySecurityHeaders(Response.redirect(destination.toString(), redirect.statusCode), url.pathname, url.hostname)
    }
  }

  return applySecurityHeaders(response, url.pathname, url.hostname)
})

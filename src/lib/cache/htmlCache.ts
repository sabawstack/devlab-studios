/**
 * Edge HTML cache for the public business pages (audit OPS-01).
 *
 * Every public page used to render server-side on every request with a chain
 * of D1 reads (2-11 s TTFB measured on 2026-11-12). Rendered HTML for the
 * cacheable routes is now kept in the Workers Cache API for a short TTL and
 * served from there.
 *
 * Freshness: the cache key carries a "generation" number (site_settings
 * `html_cache_generation`). Any successful admin write and the daily digest
 * bump it, so the next request renders afresh -- a CMS save shows within a
 * couple of seconds without purge-by-tag. The generation is memoised per
 * isolate for GENERATION_MEMO_MS.
 *
 * Never cached: anything that is not a GET to a listed route, a request with
 * a `preview` parameter (draft previews), an Authorization header, or a
 * response that is not a plain 200 HTML page, sets a cookie, or says
 * no-store/private. Turned off entirely with CACHE_HTML="false".
 */
import { getSiteSetting, setSiteSetting } from '../../worker/repositories/content.js'

export const GENERATION_KEY = 'html_cache_generation'
const GENERATION_MEMO_MS = 2_000
const DEFAULT_TTL_SECONDS = 300

/** Business pages and articles. Pickleball, the daily digest and operator surfaces are excluded. */
const CACHEABLE_EXACT = new Set(['/', '/solutions', '/work', '/insights', '/about', '/profile', '/products', '/contact', '/privacy', '/terms'])
/** Detail pages under these prefixes (service lines, write-ups, articles). */
const CACHEABLE_UNDER = ['/solutions/', '/work/', '/insights/']
const NEVER_UNDER = ['/insights/daily']

export function isCacheablePath(path: string): boolean {
  if (CACHEABLE_EXACT.has(path)) return true
  if (NEVER_UNDER.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) return false
  if (CACHEABLE_UNDER.some((prefix) => path.startsWith(prefix) && path.length > prefix.length)) return true
  return false
}

export function isCacheableRequest(request: Request, path: string): boolean {
  if (request.method !== 'GET') return false
  if (request.headers.has('Authorization')) return false
  if (new URL(request.url).searchParams.has('preview')) return false
  return isCacheablePath(path)
}

const TRACKING_PARAMS = /^(utm_[a-z]+|gclid|fbclid|msclkid|mc_cid|mc_eid|ref)$/i

/** The URL the cached copy is stored under: host + path + meaningful query + generation. */
export function cacheKeyUrl(url: URL, generation: number): string {
  const key = new URL(url.origin + url.pathname)
  const params = [...url.searchParams.entries()].filter(([name]) => !TRACKING_PARAMS.test(name)).sort(([a], [b]) => a.localeCompare(b))
  for (const [name, value] of params) key.searchParams.append(name, value)
  key.searchParams.set('__g', String(generation))
  return key.toString()
}

export function isStorableResponse(response: Response): boolean {
  if (response.status !== 200) return false
  if (!/^text\/html\b/i.test(response.headers.get('Content-Type') || '')) return false
  if (response.headers.has('Set-Cookie')) return false
  if (/\b(no-store|private)\b/i.test(response.headers.get('Cache-Control') || '')) return false
  return true
}

let memo: { value: number | null; at: number } | null = null

export function resetGenerationMemo() {
  memo = null
}

/** The current generation, or null when it cannot be read (then the cache is bypassed). */
export async function readGeneration(db: D1Database | undefined, now = Date.now()): Promise<number | null> {
  if (!db) return null
  if (memo && now - memo.at < GENERATION_MEMO_MS) return memo.value
  let value: number | null
  try {
    const stored = Number(await getSiteSetting(db, GENERATION_KEY, 0))
    value = Number.isFinite(stored) ? stored : 0
  } catch {
    value = null
  }
  memo = { value, at: now }
  return value
}

/** Invalidates every cached page by moving to a new generation. */
export async function bumpGeneration(db: D1Database | undefined): Promise<void> {
  if (!db) return
  const current = Number(await getSiteSetting(db, GENERATION_KEY, 0)) || 0
  await setSiteSetting(db, GENERATION_KEY, current + 1)
  resetGenerationMemo()
}

export function ttlSeconds(env: { HTML_CACHE_TTL_SECONDS?: string }): number {
  const configured = Number(env.HTML_CACHE_TTL_SECONDS)
  return Number.isInteger(configured) && configured >= 10 && configured <= 86_400 ? configured : DEFAULT_TTL_SECONDS
}

export function isCacheEnabled(env: { CACHE_HTML?: string }): boolean {
  return env.CACHE_HTML !== 'false'
}

/** A copy for the cache store (shared-cache TTL) and the header browsers get (always revalidate). */
export function forStorage(response: Response, ttl: number): Response {
  const stored = new Response(response.body, response)
  stored.headers.set('Cache-Control', `public, s-maxage=${ttl}`)
  stored.headers.set('X-DevLab-Cached-At', new Date().toISOString())
  return stored
}

export function asServed(response: Response, state: 'HIT' | 'MISS' | 'BYPASS'): Response {
  const served = new Response(response.body, response)
  served.headers.set('Cache-Control', 'public, max-age=0, must-revalidate')
  served.headers.set('X-DevLab-Cache', state)
  return served
}

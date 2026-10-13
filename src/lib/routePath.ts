// The path a request is actually routed by. Astro decodes percent-escapes
// before it picks a route, so every security decision in the middleware has
// to look at the decoded path too — checking the raw `url.pathname` let
// `/api/%61dmin/...` skip the admin gate while still running the admin route.

/** How many rounds of decoding to try; double-encoding is a known bypass. */
const MAX_DECODE_ROUNDS = 3

/**
 * Decoded, slash-collapsed path for security checks, or `null` when the path
 * cannot be decoded (malformed escapes) — callers must refuse those.
 */
export function routePath(pathname: string): string | null {
  let path = pathname
  for (let round = 0; round < MAX_DECODE_ROUNDS; round += 1) {
    let decoded: string
    try {
      decoded = decodeURIComponent(path)
    } catch {
      return null
    }
    if (decoded === path) break
    path = decoded
  }
  if (/%[0-9a-f]{2}/i.test(path)) return null
  // Backslashes and repeated slashes are normalised by some routers/proxies.
  return path.replace(/\\/g, '/').replace(/\/{2,}/g, '/')
}

/** True when the path is the admin API or below it, whatever its letter case. */
export function isAdminApiPath(path: string): boolean {
  const lower = path.toLowerCase()
  return lower === '/api/admin' || lower.startsWith('/api/admin/')
}

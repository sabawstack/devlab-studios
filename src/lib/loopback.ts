const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * True when the request was made to a loopback host (local dev or e2e).
 * A request to the production or preview hostname can never satisfy it, so a
 * test-only switch gated on this stays shut even if its env var is set on a
 * deployed Worker by mistake. Same rule as ADMIN_AUTH_DISABLED_LOCAL_ONLY in
 * src/worker/middleware/adminAuth.js.
 */
export function isLoopbackRequest(request: Request): boolean {
  try {
    return LOOPBACK_HOSTNAMES.has(new URL(request.url).hostname)
  } catch {
    return false
  }
}

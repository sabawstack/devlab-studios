/**
 * Consumes and discards a request body.
 *
 * Call this on any early-return path that answers a request WITHOUT reading
 * its body (a 401 from the admin gate, a 404 before validation, a POST whose
 * handler needs no input). `wrangler dev --local`'s keep-alive loopback proxy
 * corrupts the NEXT request replayed over the same connection when a response
 * ends with an unread body, which surfaces as the dev server dying with
 * "Network connection lost" and every later request failing with
 * ECONNREFUSED. See src/worker/utils/responses.js's forbiddenResponse() for
 * the reproduction that established this. Harmless in production.
 */
export async function drainRequestBody(request: Request): Promise<void> {
  await request.arrayBuffer().catch(() => {})
}

/**
 * The safety net behind drainRequestBody: called by src/middleware.ts on EVERY
 * response, so a route that answers without reading its body -- readBoundedJson's
 * 413 for an oversized payload, any early validation return -- cannot poison
 * the next request on wrangler dev's loopback proxy. Before this, one 413 test
 * made an unrelated test's POST fail with "Network connection lost" whenever
 * the two shared a pooled connection.
 *
 * No-op when the body is absent, already read, or being streamed by the route.
 */
export async function discardUnreadBody(request: Request): Promise<void> {
  const body = request.body
  if (!body || request.bodyUsed || body.locked) return
  // Read to the end rather than cancel(): cancelling was tried and does NOT
  // stop the proxy failing the next request. Chunks are dropped as they
  // arrive, so an oversized body is never buffered (unlike arrayBuffer()).
  const reader = body.getReader()
  try {
    while (!(await reader.read()).done) {
      // discard
    }
  } catch {
    // The client went away mid-body: there is nothing left to protect.
  } finally {
    reader.releaseLock()
  }
}

export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  const body = await request.json()
  return (body ?? {}) as Record<string, unknown>
}

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
}

export class NotFoundError extends Error {}

/**
 * Shared `catch (error) { ... }` body for admin write routes.
 *
 * Splits deliberate failures from unexpected ones, because they want opposite
 * treatment. An error carrying an explicit 4xx `status` was thrown on purpose
 * and its message is written FOR the admin — which field failed validation,
 * which conflict blocked the write — so it passes through verbatim. An
 * unexpected 5xx is the opposite: its message is whatever D1 or the runtime
 * happened to produce, which tells the admin nothing actionable while leaking
 * internal query text and table names. Those are logged server-side instead
 * (console.error being how logging reaches `wrangler tail` on Workers — see
 * worker/pickleball/SessionCoordinatorDO.ts) and answered generically.
 */
export function adminErrorResponse(
  error: unknown,
  fallback = 'Something went wrong while saving. Please try again.',
): Response {
  const rawStatus =
    error && typeof error === 'object' && 'status' in error ? Number((error as { status: unknown }).status) : 500
  const status = Number.isInteger(rawStatus) && rawStatus >= 400 && rawStatus <= 599 ? rawStatus : 500

  if (status < 500) {
    const message = error instanceof Error ? error.message : ''
    return jsonResponse({ error: message || fallback }, status)
  }

  console.error('[admin] unhandled error', error)
  return jsonResponse({ error: fallback }, 500)
}

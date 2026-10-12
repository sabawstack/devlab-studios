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
 * Reads off and drops a request body a route is refusing without reading --
 * LOCAL DEV / E2E ONLY, when the DRAIN_UNREAD_BODIES var is set (`.dev.vars`
 * and the Playwright wrangler dev command set it; deployed environments never
 * do). In production an abusive client could send a large or slow body, and a
 * 413 must not wait for it to arrive.
 *
 * Why it exists: under `wrangler dev`, a response sent while the request body
 * is unread made the NEXT request on the proxy's internal connection fail with
 * "Network connection lost" (a 500) -- one 413 test failed an unrelated test's
 * POST that way. Unlike drainRequestBody it never buffers: chunks are dropped
 * as they arrive.
 *
 * Called from readBoundedJson's 413 paths only. A blanket version in
 * src/middleware.ts (every response) was tried and made the pickleball suite
 * drop 2-9 requests per run, against 0 with it off, so it stays targeted.
 */
export async function discardUnreadBody(request: Request, env: { DRAIN_UNREAD_BODIES?: string } | undefined): Promise<void> {
  if (!env?.DRAIN_UNREAD_BODIES) return
  const body = request.body
  if (!body || request.bodyUsed || body.locked) return
  // Read to the end rather than cancel(): cancelling was tried and does NOT
  // stop the proxy failing the next request.
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

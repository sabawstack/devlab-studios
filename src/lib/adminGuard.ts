import type { APIContext, APIRoute } from 'astro'
import { requireAdmin } from '../worker/middleware/adminAuth.js'
import { createHonoLikeContext } from './honoShim.js'
import { getEnv } from './env'
import { drainRequestBody } from './http'

/**
 * Per-route authentication for every /api/admin/* handler, independent of
 * src/middleware.ts.
 *
 * The middleware gate is the primary check, but it is a path-prefix test, and
 * in October 2026 `/api/%61dmin/...` slipped past it (Astro decodes the path
 * before routing, the gate did not) and every admin handler then ran with no
 * session. Each handler now refuses on its own, so a future gate miss returns
 * 401 instead of executing.
 *
 * When the middleware already authenticated this request, `locals.adminEmail`
 * is set (only requireAdmin ever sets it; `locals` cannot be written by the
 * client), so the common path costs nothing extra. Otherwise the full session
 * check runs here, with the same rules -- so this is a second gate, not merely
 * an "is the first gate's flag set" check.
 *
 * src/lib/adminGuard.test.ts enumerates every file under src/pages/api/admin
 * and fails if a route handler is exported without this wrapper.
 */
/** Null when the request is an authenticated admin, otherwise the refusal to send. */
export async function assertAdmin(context: APIContext): Promise<Response | null> {
  if (context.locals.adminEmail && context.locals.adminAuthMode) return null

  const honoContext = createHonoLikeContext(context.request, getEnv(), context.locals)
  let authenticated = false
  const refusal = await requireAdmin(honoContext, async () => {
    authenticated = true
    return undefined
  })

  if (authenticated && context.locals.adminEmail) return null

  // The refusal never read the body; drain it as the middleware does.
  await drainRequestBody(context.request)
  return refusal instanceof Response
    ? refusal
    : new Response(JSON.stringify({ error: 'Admin login is required.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
}

/** Wraps an admin API handler so it runs only for an authenticated admin. */
export function withAdmin(handler: APIRoute): APIRoute {
  return async (context) => {
    const refusal = await assertAdmin(context)
    if (refusal) return refusal
    return handler(context)
  }
}

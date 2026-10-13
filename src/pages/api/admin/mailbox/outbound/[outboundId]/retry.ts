import type { APIRoute } from 'astro'
import { requeueOutbound } from '../../../../../../mailbox/repositories/outbound.js'
import { handleRoute, jsonResponse, requireDatabase } from '../../../../../../lead-engine/schemas/route'
import { withAdmin } from '../../../../../../lib/adminGuard'

export const prerender = false

/**
 * Puts a failed reply back in the queue.
 *
 * Deliberately a human action with no automatic counterpart. A submission that
 * reported failure may still have reached an MTA, and the system cannot tell
 * that case from one where nothing was transmitted — so it never retries on its
 * own. A person reading the actual error can tell, which is why this exists as
 * a button behind the admin session rather than as a timer.
 *
 * Only a `failed` row moves. `collected` is refused with a 409 precisely
 * because it is the ambiguous one.
 */
const unguardedPOST: APIRoute = async ({ params }) =>
  handleRoute(async () => {
    const database = requireDatabase()
    if (!database.ok) return database.response

    return jsonResponse({ outbound: await requeueOutbound(database.env.DB, params.outboundId!) })
  })

// Authenticated per handler as well as by src/middleware.ts; see src/lib/adminGuard.ts.
export const POST = withAdmin(unguardedPOST)

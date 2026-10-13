import type { APIRoute } from 'astro'
import { cancelOutbound } from '../../../../../../mailbox/repositories/outbound.js'
import { handleRoute, jsonResponse, requireDatabase } from '../../../../../../lead-engine/schemas/route'
import { withAdmin } from '../../../../../../lib/adminGuard'

export const prerender = false

/**
 * Withdraws a reply nobody has collected yet.
 *
 * Only while it is still `queued`. Once the transmitter has taken it we cannot
 * know whether it already reached an MTA, and telling someone a message was
 * cancelled when it may have been delivered is worse than admitting we do not
 * know — so that case is refused with a 409 rather than guessed at.
 */
const unguardedPOST: APIRoute = async ({ params }) =>
  handleRoute(async () => {
    const database = requireDatabase()
    if (!database.ok) return database.response

    return jsonResponse({ outbound: await cancelOutbound(database.env.DB, params.outboundId!) })
  })

// Authenticated per handler as well as by src/middleware.ts; see src/lib/adminGuard.ts.
export const POST = withAdmin(unguardedPOST)

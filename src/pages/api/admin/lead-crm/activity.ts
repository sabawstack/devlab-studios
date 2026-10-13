import type { APIRoute } from 'astro'
import { listActivity } from '../../../../lead-engine/repositories/activity.js'
import { handleRoute, jsonResponse, requireDatabase } from '../../../../lead-engine/schemas/route'
import { withAdmin } from '../../../../lib/adminGuard'

export const prerender = false

const unguardedGET: APIRoute = async ({ url }) =>
  handleRoute(async () => {
    const database = requireDatabase()
    if (!database.ok) return database.response

    const events = await listActivity(database.env.DB, {
      leadId: url.searchParams.get('leadId'),
      campaignId: url.searchParams.get('campaignId'),
      eventType: url.searchParams.get('eventType'),
      since: url.searchParams.get('since'),
      limit: Number(url.searchParams.get('limit')) || 100,
      offset: Number(url.searchParams.get('offset')) || 0,
    })

    return jsonResponse({ events })
  })

// Authenticated per handler as well as by src/middleware.ts; see src/lib/adminGuard.ts.
export const GET = withAdmin(unguardedGET)

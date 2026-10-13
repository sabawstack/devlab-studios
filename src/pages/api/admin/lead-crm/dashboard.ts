import type { APIRoute } from 'astro'
import { getDashboard } from '../../../../lead-engine/services/dashboard.js'
import { handleRoute, jsonResponse, requireDatabase } from '../../../../lead-engine/schemas/route'
import { withAdmin } from '../../../../lib/adminGuard'

export const prerender = false

const unguardedGET: APIRoute = async ({ url }) =>
  handleRoute(async () => {
    const database = requireDatabase()
    if (!database.ok) return database.response

    return jsonResponse(await getDashboard(database.env, { campaignId: url.searchParams.get('campaignId') }))
  })

// Authenticated per handler as well as by src/middleware.ts; see src/lib/adminGuard.ts.
export const GET = withAdmin(unguardedGET)

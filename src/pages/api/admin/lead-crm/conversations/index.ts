import type { APIRoute } from 'astro'
import { listConversations } from '../../../../../lead-engine/repositories/conversations.js'
import { handleRoute, jsonResponse, requireDatabase } from '../../../../../lead-engine/schemas/route'
import { withAdmin } from '../../../../../lib/adminGuard'

export const prerender = false

const unguardedGET: APIRoute = async ({ url }) =>
  handleRoute(async () => {
    const database = requireDatabase()
    if (!database.ok) return database.response

    const conversations = await listConversations(database.env.DB, {
      status: url.searchParams.get('status'),
      leadId: url.searchParams.get('leadId'),
      limit: Number(url.searchParams.get('limit')) || 50,
      offset: Number(url.searchParams.get('offset')) || 0,
    })

    return jsonResponse({ conversations })
  })

// Authenticated per handler as well as by src/middleware.ts; see src/lib/adminGuard.ts.
export const GET = withAdmin(unguardedGET)

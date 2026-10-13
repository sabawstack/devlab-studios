import type { APIRoute } from 'astro'
import { listLeads } from '../../../../../lead-engine/repositories/leads.js'
import { parseLeadFilters } from '../../../../../lead-engine/schemas/index'
import { handleRoute, jsonResponse, requireDatabase } from '../../../../../lead-engine/schemas/route'
import { withAdmin } from '../../../../../lib/adminGuard'

export const prerender = false

const unguardedGET: APIRoute = async ({ url }) =>
  handleRoute(async () => {
    const database = requireDatabase()
    if (!database.ok) return database.response

    const filters = parseLeadFilters(url)
    if (!filters.success) {
      // An unrecognized filter value is refused rather than silently ignored:
      // a typo that quietly returns the unfiltered list is worse than an error,
      // because the operator acts on what they see.
      return jsonResponse(
        {
          error: 'One or more filters are not valid.',
          issues: filters.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
        },
        422,
      )
    }

    return jsonResponse(await listLeads(database.env.DB, filters.data))
  })

// Authenticated per handler as well as by src/middleware.ts; see src/lib/adminGuard.ts.
export const GET = withAdmin(unguardedGET)

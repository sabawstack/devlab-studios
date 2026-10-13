import type { APIRoute } from 'astro'
import { listLeads } from '../../../../worker/repositories/leads.js'
import { getEnv } from '../../../../lib/env'
import { jsonResponse } from '../../../../lib/http'
import {
  INQUIRY_TYPES,
  PIPELINE_STATUSES,
  QUALIFICATION_RESULTS,
} from '../../../../lib/schemas/inquiry'
import { withAdmin } from '../../../../lib/adminGuard'

export const prerender = false

const DELIVERY_STATUSES = ['pending', 'delivered', 'failed']

/**
 * Only values from the known enums reach the repository. An unrecognized
 * filter is dropped rather than passed through — the repository binds its
 * parameters, so this is defence in depth rather than the only guard, but it
 * also stops a typo from silently returning an empty list.
 */
function allowed(value: string | null, options: readonly string[]): string | null {
  return value && options.includes(value) ? value : null
}

const unguardedGET: APIRoute = async ({ url }) => {
  const env = getEnv()
  if (!env.DB) return jsonResponse({ error: 'D1 DB binding is not configured.' }, 503)

  // SQLite treats a negative LIMIT as "no limit", so a requested value must
  // be clamped to a positive range — but an absent param must still fall
  // back to the default rather than being coerced to 0 (Number(null) is 0,
  // which is finite, so a naive isFinite guard let a missing param through
  // as an explicit "limit 1" instead of the intended default).
  const limitParam = url.searchParams.get('limit')
  const requestedLimit = limitParam === null ? NaN : Number(limitParam)
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 500) : 100

  const offsetParam = Number(url.searchParams.get('offset'))
  const offset = Number.isFinite(offsetParam) && offsetParam > 0 ? offsetParam : 0

  const search = url.searchParams.get('search')

  const leads = await listLeads(env.DB, {
    status: allowed(url.searchParams.get('status'), DELIVERY_STATUSES),
    inquiryType: allowed(url.searchParams.get('inquiryType'), INQUIRY_TYPES),
    pipelineStatus: allowed(url.searchParams.get('pipelineStatus'), PIPELINE_STATUSES),
    qualification: allowed(url.searchParams.get('qualification'), QUALIFICATION_RESULTS),
    assignedOwner: url.searchParams.get('assignedOwner') || null,
    search: search ? search.slice(0, 120) : null,
    includeArchived: url.searchParams.get('includeArchived') === 'true',
    limit,
    offset,
  })

  return jsonResponse(leads)
}

// Authenticated per handler as well as by src/middleware.ts; see src/lib/adminGuard.ts.
export const GET = withAdmin(unguardedGET)

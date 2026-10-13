import type { APIRoute } from 'astro'
import { listVersions } from '../../../../worker/repositories/contentVersions.js'
import { getEnv } from '../../../../lib/env'
import { jsonResponse } from '../../../../lib/http'
import { withAdmin } from '../../../../lib/adminGuard'

const unguardedGET: APIRoute = async ({ params, url }) => {
  const type = params.type as string
  const contentId = url.searchParams.get('id') || null

  const env = getEnv()
  if (!env.DB) return jsonResponse({ error: 'D1 DB binding is not configured.' }, 503)

  const versions = await listVersions(env.DB, type, contentId)
  return jsonResponse(versions)
}

// Authenticated per handler as well as by src/middleware.ts; see src/lib/adminGuard.ts.
export const GET = withAdmin(unguardedGET)

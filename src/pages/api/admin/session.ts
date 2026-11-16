import type { APIRoute } from 'astro'
import { withAdmin } from '../../../lib/adminGuard'
import { deploymentEnvironment } from '../../../lib/deploymentEnvironment'
import { getEnv } from '../../../lib/env'

const unguardedGET: APIRoute = ({ locals, url }) => {
  return new Response(JSON.stringify({
    ok: true,
    email: locals.adminEmail,
    role: locals.adminRole || 'admin',
    mode: locals.adminAuthMode || 'password',
    // ADMIN-09, additive: which deployment answered.
    environment: deploymentEnvironment(getEnv().DEPLOYMENT_ENV, url.hostname),
  }), {
    headers: { 'Content-Type': 'application/json' },
  })
}

// Authenticated per handler as well as by src/middleware.ts; see src/lib/adminGuard.ts.
export const GET = withAdmin(unguardedGET)

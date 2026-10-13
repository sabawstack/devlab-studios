import type { APIRoute } from 'astro'
import { withAdmin } from '../../../lib/adminGuard'

const unguardedGET: APIRoute = ({ locals }) => {
  return new Response(JSON.stringify({
    ok: true,
    email: locals.adminEmail,
    role: locals.adminRole || 'admin',
    mode: locals.adminAuthMode || 'password',
  }), {
    headers: { 'Content-Type': 'application/json' },
  })
}

// Authenticated per handler as well as by src/middleware.ts; see src/lib/adminGuard.ts.
export const GET = withAdmin(unguardedGET)

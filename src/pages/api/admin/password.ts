import type { APIRoute } from 'astro'
import { handleAdminPasswordChange } from '../../../worker/middleware/adminAuth.js'
import { createHonoLikeContext } from '../../../lib/honoShim'
import { logAuditFailure, recordAuditEvent } from '../../../worker/repositories/auditLog.js'
import { getEnv } from '../../../lib/env'
import { withAdmin } from '../../../lib/adminGuard'

export const prerender = false

/**
 * Changes the signed-in admin's own password.
 *
 * Behind the blanket `/api/admin/*` gate in src/middleware.ts, which has
 * already authenticated the caller and put their identity in `locals`. The
 * handler still requires the CURRENT password on top of that, so holding a
 * session is not by itself enough to replace the credential.
 */
const unguardedPOST: APIRoute = async ({ request, locals }) => {
  const env = getEnv()
  const honoContext = createHonoLikeContext(request, env, locals)
  const response = await handleAdminPasswordChange(honoContext)

  if (response.status === 200 && env.DB) {
    // Records THAT the password changed and by whom — never the password, the
    // hash, or any part of either.
    await recordAuditEvent(env.DB, {
      actorEmail: locals.adminEmail || null,
      action: 'update',
      entityType: 'admin_credentials',
      entityId: locals.adminEmail || null,
      metadata: { summary: 'Admin password changed; other sessions signed out.' },
    }).catch(logAuditFailure)
  }

  return response
}

// Authenticated per handler as well as by src/middleware.ts; see src/lib/adminGuard.ts.
export const POST = withAdmin(unguardedPOST)

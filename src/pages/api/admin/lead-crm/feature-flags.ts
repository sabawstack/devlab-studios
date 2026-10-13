import type { APIRoute } from 'astro'
import { getOperationalFlagState, updateOperationalFlag } from '../../../../lead-engine/config/operationalFlags.js'
import { featureFlagUpdateSchema } from '../../../../lead-engine/schemas/index'
import { recordAuditEvent } from '../../../../worker/repositories/auditLog.js'
import {
  actorEmail,
  handleRoute,
  jsonResponse,
  readValidatedBody,
  requireDatabase,
} from '../../../../lead-engine/schemas/route'
import { withAdmin } from '../../../../lib/adminGuard'

export const prerender = false

const unguardedGET: APIRoute = async () =>
  handleRoute(async () => {
    const database = requireDatabase()
    if (!database.ok) return database.response
    return jsonResponse(await getOperationalFlagState(database.env))
  })

const unguardedPUT: APIRoute = async (context) =>
  handleRoute(async () => {
    const database = requireDatabase()
    if (!database.ok) return database.response

    const body = await readValidatedBody(context.request, featureFlagUpdateSchema)
    if (!body.ok) return body.response

    const email = actorEmail(context)
    const state = await updateOperationalFlag(database.env, body.data.key, body.data.enabled, {
      actorEmail: email,
    })

    await recordAuditEvent(database.env.DB, {
      actorEmail: email,
      action: 'lead_feature_flag.update',
      entityType: 'lead_settings',
      entityId: body.data.key,
      metadata: { key: body.data.key, enabled: body.data.enabled },
    })

    return jsonResponse(state)
  })

// Authenticated per handler as well as by src/middleware.ts; see src/lib/adminGuard.ts.
export const GET = withAdmin(unguardedGET)
export const PUT = withAdmin(unguardedPUT)

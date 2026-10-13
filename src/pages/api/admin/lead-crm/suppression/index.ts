import type { APIRoute } from 'astro'
import { ACTIVITY } from '../../../../../lead-engine/domain/activity.js'
import { recordActivity } from '../../../../../lead-engine/repositories/activity.js'
import {
  addSuppression,
  listSuppression,
  removeSuppression,
} from '../../../../../lead-engine/repositories/suppression.js'
import { recordAuditEvent } from '../../../../../worker/repositories/auditLog.js'
import { suppressionRemovalSchema, suppressionSchema } from '../../../../../lead-engine/schemas/index'
import {
  actorEmail,
  handleRoute,
  jsonResponse,
  readValidatedBody,
  requireDatabase,
} from '../../../../../lead-engine/schemas/route'
import { withAdmin } from '../../../../../lib/adminGuard'

export const prerender = false

const unguardedGET: APIRoute = async ({ url }) =>
  handleRoute(async () => {
    const database = requireDatabase()
    if (!database.ok) return database.response

    const entries = await listSuppression(database.env.DB, {
      scope: url.searchParams.get('scope'),
      reason: url.searchParams.get('reason'),
      includeRemoved: url.searchParams.get('includeRemoved') === 'true',
      search: url.searchParams.get('search'),
      limit: Number(url.searchParams.get('limit')) || 100,
      offset: Number(url.searchParams.get('offset')) || 0,
    })

    return jsonResponse({ entries })
  })

const unguardedPOST: APIRoute = async (context) =>
  handleRoute(async () => {
    const database = requireDatabase()
    if (!database.ok) return database.response

    const body = await readValidatedBody(context.request, suppressionSchema)
    if (!body.ok) return body.response

    const email = actorEmail(context)
    const { entry, created } = await addSuppression(database.env.DB, {
      ...body.data,
      source: 'manual',
      createdBy: email,
    })

    if (created) {
      await recordActivity(database.env.DB, {
        leadId: body.data.leadId ?? null,
        eventType: ACTIVITY.SUPPRESSED,
        actor: 'human',
        actorEmail: email,
        summary: `Suppressed ${entry.scope} "${entry.value}" (${entry.reason.replace(/_/g, ' ')}).`,
        metadata: { scope: entry.scope, reason: entry.reason },
      })
    }

    await recordAuditEvent(database.env.DB, {
      actorEmail: email,
      action: 'lead_suppression.add',
      entityType: 'lead_suppression',
      entityId: entry.id,
      metadata: { scope: entry.scope, reason: entry.reason },
    })

    return jsonResponse({ entry, created }, created ? 201 : 200)
  })

/**
 * Removes a suppression entry.
 *
 * Privileged and audited. The row is retained with `removed_at`, `removed_by`
 * and the written reason rather than deleted, because "we stopped honouring
 * someone's request not to be contacted" is precisely the change that has to
 * remain visible afterwards. The repository requires the reason; this route
 * records who.
 */
const unguardedDELETE: APIRoute = async (context) =>
  handleRoute(async () => {
    const database = requireDatabase()
    if (!database.ok) return database.response

    const id = new URL(context.request.url).searchParams.get('id')
    if (!id) return jsonResponse({ error: 'A suppression entry id is required.' }, 400)

    const body = await readValidatedBody(context.request, suppressionRemovalSchema)
    if (!body.ok) return body.response

    const email = actorEmail(context)
    const entry = await removeSuppression(database.env.DB, id, { actorEmail: email, reason: body.data.reason })

    await recordActivity(database.env.DB, {
      leadId: entry.leadId,
      eventType: ACTIVITY.SUPPRESSION_REMOVED,
      actor: 'human',
      actorEmail: email,
      summary: `Removed the suppression on "${entry.value}": ${body.data.reason}`,
      metadata: { scope: entry.scope, reason: body.data.reason },
    })

    await recordAuditEvent(database.env.DB, {
      actorEmail: email,
      action: 'lead_suppression.remove',
      entityType: 'lead_suppression',
      entityId: id,
      metadata: { value: entry.value, scope: entry.scope, reason: body.data.reason },
    })

    return jsonResponse({ entry })
  })

// Authenticated per handler as well as by src/middleware.ts; see src/lib/adminGuard.ts.
export const GET = withAdmin(unguardedGET)
export const POST = withAdmin(unguardedPOST)
export const DELETE = withAdmin(unguardedDELETE)

import type { APIRoute } from 'astro'
import { getLead, updateLeadWorkflow } from '../../../../worker/repositories/leads.js'
import { listDeliveryAttempts } from '../../../../worker/repositories/deliveryAttempts.js'
import {
  getLeadAttribution,
  listLeadActivities,
  listLeadConsents,
  recordLeadActivity,
} from '../../../../worker/repositories/leadContext.js'
import { recordAuditEvent } from '../../../../worker/repositories/auditLog.js'
import { getEnv } from '../../../../lib/env'
import { adminErrorResponse, drainRequestBody, jsonResponse, readJsonBody } from '../../../../lib/http'
import { leadUpdateSchema } from '../../../../lib/schemas/inquiry'
import { withAdmin } from '../../../../lib/adminGuard'

export const prerender = false

/**
 * Both handlers run behind the blanket admin gate in src/middleware.ts —
 * every `/api/admin/*` path except login/logout goes through requireAdmin
 * before reaching a route. Authorization is never left to hidden navigation.
 */
async function loadDetail(db: D1Database, id: string) {
  const lead = await getLead(db, id)
  if (!lead) return null

  const [attempts, attribution, consents, activities] = await Promise.all([
    listDeliveryAttempts(db, id),
    getLeadAttribution(db, id),
    listLeadConsents(db, id),
    listLeadActivities(db, id),
  ])

  return { ...lead, attempts, attribution, consents, activities }
}

const unguardedGET: APIRoute = async ({ params }) => {
  const id = params.id as string
  const env = getEnv()
  if (!env.DB) return jsonResponse({ error: 'D1 DB binding is not configured.' }, 503)

  const detail = await loadDetail(env.DB, id)
  if (!detail) return jsonResponse({ error: 'Lead not found.' }, 404)

  return jsonResponse(detail)
}

/**
 * Updates the human workflow state only. The schema deliberately contains no
 * visitor-supplied field, so this endpoint cannot be used to rewrite what
 * someone actually submitted.
 */
const unguardedPATCH: APIRoute = async ({ params, request, locals }) => {
  const id = params.id as string
  const env = getEnv()
  if (!env.DB) {
    await drainRequestBody(request)
    return jsonResponse({ error: 'D1 DB binding is not configured.' }, 503)
  }

  try {
    // Read before the not-found check: an early return that leaves the body
    // unread breaks the next request under `wrangler dev --local`.
    const parsed = leadUpdateSchema.safeParse(await readJsonBody(request))

    const existing = await getLead(env.DB, id)
    if (!existing) return jsonResponse({ error: 'Lead not found.' }, 404)

    if (!parsed.success) {
      return jsonResponse({ error: parsed.error.issues[0]?.message || 'Invalid update.' }, 400)
    }

    await updateLeadWorkflow(env.DB, id, parsed.data)

    const changed = Object.keys(parsed.data)
    if (parsed.data.pipelineStatus && parsed.data.pipelineStatus !== existing.pipelineStatus) {
      await recordLeadActivity(env.DB, id, {
        activityType: 'status_change',
        status: 'ok',
        actor: locals.adminEmail || null,
        metadata: { from: existing.pipelineStatus, to: parsed.data.pipelineStatus },
      })
    }
    if (parsed.data.assignedOwner !== undefined && parsed.data.assignedOwner !== existing.assignedOwner) {
      await recordLeadActivity(env.DB, id, {
        activityType: 'assignment',
        status: 'ok',
        actor: locals.adminEmail || null,
        metadata: { assigned: Boolean(parsed.data.assignedOwner) },
      })
    }
    if (parsed.data.internalNotes !== undefined) {
      // Only that a note was written is recorded — never its text, which can
      // contain anything an operator typed about a real person.
      await recordLeadActivity(env.DB, id, {
        activityType: 'note',
        status: 'ok',
        actor: locals.adminEmail || null,
        metadata: { length: parsed.data.internalNotes.length },
      })
    }

    await recordAuditEvent(env.DB, {
      actorEmail: locals.adminEmail || null,
      action: 'update',
      entityType: 'leads',
      entityId: id,
      metadata: { summary: `Updated lead ${id} (${changed.join(', ') || 'no changes'}).`, fields: changed },
    })

    const detail = await loadDetail(env.DB, id)
    return jsonResponse(detail)
  } catch (error) {
    return adminErrorResponse(error)
  }
}

// Authenticated per handler as well as by src/middleware.ts; see src/lib/adminGuard.ts.
export const GET = withAdmin(unguardedGET)
export const PATCH = withAdmin(unguardedPATCH)

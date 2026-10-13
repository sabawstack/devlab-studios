import type { APIRoute } from 'astro'
import { getLead } from '../../../../../worker/repositories/leads.js'
import { listDeliveryAttempts } from '../../../../../worker/repositories/deliveryAttempts.js'
import {
  getLeadAttribution,
  listLeadActivities,
  listLeadConsents,
  recordLeadActivity,
} from '../../../../../worker/repositories/leadContext.js'
import { attemptLeadDelivery } from '../../../../../worker/leadDelivery.js'
import { recordAuditEvent } from '../../../../../worker/repositories/auditLog.js'
import { checkRateLimit, clientIp, rateLimitedResponse } from '../../../../../worker/rateLimit.js'
import { getEnv } from '../../../../../lib/env'
import { drainRequestBody, jsonResponse } from '../../../../../lib/http'
import { withAdmin } from '../../../../../lib/adminGuard'

export const prerender = false

/**
 * Retries are bounded per admin identity. The route already sits behind
 * requireAdmin (src/middleware.ts), so this is not an authentication control —
 * it stops an authenticated operator, or a stolen session, from turning the
 * Retry button into an outbound email amplifier.
 */
const RETRY_WINDOW_MS = 5 * 60 * 1000
const RETRY_MAX_ATTEMPTS = 10

const unguardedPOST: APIRoute = async ({ params, request, locals }) => {
  const id = params.id as string
  const env = getEnv()

  // This endpoint takes no input, but callers still send `{}` — drain it.
  await drainRequestBody(request)

  if (!env.DB) return jsonResponse({ error: 'D1 DB binding is not configured.' }, 503)

  const rate = await checkRateLimit(env, 'admin-lead-retry', locals.adminEmail || clientIp(request), {
    limit: RETRY_MAX_ATTEMPTS,
    windowMs: RETRY_WINDOW_MS,
  })
  if (rate.limited) {
    return rateLimitedResponse('Too many retries. Please wait before trying again.', rate.retryAfterSeconds)
  }

  const lead = await getLead(env.DB, id)
  if (!lead) return jsonResponse({ error: 'Lead not found.' }, 404)

  const result = await attemptLeadDelivery(env, lead)

  await recordLeadActivity(env.DB, id, {
    activityType: 'delivery_retry',
    status: result.ok ? 'ok' : 'failed',
    actor: locals.adminEmail || null,
    metadata: { targets: (result.results || []).map((entry) => ({ target: entry.target, ok: entry.ok })) },
  }).catch(() => {})

  await recordAuditEvent(env.DB, {
    actorEmail: locals.adminEmail || null,
    action: 'retry_delivery',
    entityType: 'leads',
    entityId: id,
    metadata: { summary: `${result.ok ? 'Retried' : 'Failed to retry'} lead delivery for ${id}.`, ok: result.ok },
  })

  const [updatedLead, attempts, attribution, consents, activities] = await Promise.all([
    getLead(env.DB, id),
    listDeliveryAttempts(env.DB, id),
    getLeadAttribution(env.DB, id),
    listLeadConsents(env.DB, id),
    listLeadActivities(env.DB, id),
  ])

  return jsonResponse({ ...updatedLead, attempts, attribution, consents, activities })
}

// Authenticated per handler as well as by src/middleware.ts; see src/lib/adminGuard.ts.
export const POST = withAdmin(unguardedPOST)

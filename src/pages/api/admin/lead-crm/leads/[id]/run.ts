import type { APIRoute } from 'astro'
import { z } from 'zod'
import { runJobNow } from '../../../../../../lead-engine/jobs/runner.js'
import { getLead } from '../../../../../../lead-engine/repositories/leads.js'
import { recordAuditEvent } from '../../../../../../worker/repositories/auditLog.js'
import {
  actorEmail,
  handleRoute,
  jsonResponse,
  notFound,
  readValidatedBody,
  requireDatabase,
} from '../../../../../../lead-engine/schemas/route'
import { withAdmin } from '../../../../../../lib/adminGuard'

export const prerender = false

const runSchema = z.object({
  step: z.enum(['lead_research', 'ai_review', 'outreach_draft']),
})

/**
 * Runs one pipeline step for one lead, now.
 *
 * Goes through the same `runJob` the background runner uses, so a manual run
 * and a scheduled one execute identical code — the only difference is who
 * decided to start it. That is what makes this button safe to use for
 * diagnosis: what it does is what the engine would have done.
 */
const unguardedPOST: APIRoute = async (context) =>
  handleRoute(async () => {
    const database = requireDatabase()
    if (!database.ok) return database.response

    const body = await readValidatedBody(context.request, runSchema)
    if (!body.ok) return body.response

    const leadId = context.params.id!
    const lead = await getLead(database.env.DB, leadId)
    if (!lead) return notFound(context.request, 'Lead not found.')

    const email = actorEmail(context)
    const outcome = await runJobNow(database.env, {
      jobType: body.data.step,
      leadId,
      campaignId: lead.campaignId,
      payload: { leadId },
    })

    await recordAuditEvent(database.env.DB, {
      actorEmail: email,
      action: `lead.run.${body.data.step}`,
      entityType: 'lead',
      entityId: leadId,
      metadata: { ok: outcome.ok, error: outcome.error },
    })

    // 200 either way: the request succeeded and the outcome is the payload. A
    // crawl that found a blocked site is not an API error.
    return jsonResponse(outcome)
  })

// Authenticated per handler as well as by src/middleware.ts; see src/lib/adminGuard.ts.
export const POST = withAdmin(unguardedPOST)

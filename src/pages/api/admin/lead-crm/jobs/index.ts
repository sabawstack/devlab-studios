import type { APIRoute } from 'astro'
import { z } from 'zod'
import { countJobsByStatus, listJobs, retryJob } from '../../../../../lead-engine/repositories/jobs.js'
import { drainJobs } from '../../../../../lead-engine/jobs/runner.js'
import { recordAuditEvent } from '../../../../../worker/repositories/auditLog.js'
import {
  actorEmail,
  handleRoute,
  jsonResponse,
  readValidatedBody,
  requireDatabase,
} from '../../../../../lead-engine/schemas/route'
import { withAdmin } from '../../../../../lib/adminGuard'

export const prerender = false

const jobActionSchema = z.object({
  action: z.enum(['retry', 'drain']),
  jobId: z.string().trim().max(64).optional(),
  limit: z.number().int().min(1).max(25).optional(),
})

const unguardedGET: APIRoute = async ({ url }) =>
  handleRoute(async () => {
    const database = requireDatabase()
    if (!database.ok) return database.response

    const [jobs, counts] = await Promise.all([
      listJobs(database.env.DB, {
        status: url.searchParams.get('status'),
        jobType: url.searchParams.get('jobType'),
        campaignId: url.searchParams.get('campaignId'),
        leadId: url.searchParams.get('leadId'),
        limit: Number(url.searchParams.get('limit')) || 50,
      }),
      countJobsByStatus(database.env.DB),
    ])

    return jsonResponse({ jobs, counts })
  })

/**
 * Retries a dead-lettered job, or drains a batch by hand.
 *
 * `drain` is the manual equivalent of a cron tick, bounded to 25 jobs. It
 * exists because the engine has to be operable before its schedules are armed —
 * the whole dry-run procedure depends on being able to push work through
 * without waiting for 22:00 UTC.
 */
const unguardedPOST: APIRoute = async (context) =>
  handleRoute(async () => {
    const database = requireDatabase()
    if (!database.ok) return database.response

    const body = await readValidatedBody(context.request, jobActionSchema)
    if (!body.ok) return body.response

    const email = actorEmail(context)

    if (body.data.action === 'retry') {
      if (!body.data.jobId) return jsonResponse({ error: 'A jobId is required.' }, 400)

      // Attempts are reset: a human deciding to retry is new information,
      // usually that whatever was broken has been fixed.
      const job = await retryJob(database.env.DB, body.data.jobId)
      await recordAuditEvent(database.env.DB, {
        actorEmail: email,
        action: 'lead_job.retry',
        entityType: 'lead_job',
        entityId: body.data.jobId,
        metadata: { jobType: job?.jobType },
      })

      return jsonResponse({ job })
    }

    const result = await drainJobs(database.env, { limit: body.data.limit ?? 10 })
    await recordAuditEvent(database.env.DB, {
      actorEmail: email,
      action: 'lead_job.drain',
      entityType: 'lead_job',
      entityId: null,
      metadata: result,
    })

    return jsonResponse(result)
  })

// Authenticated per handler as well as by src/middleware.ts; see src/lib/adminGuard.ts.
export const GET = withAdmin(unguardedGET)
export const POST = withAdmin(unguardedPOST)

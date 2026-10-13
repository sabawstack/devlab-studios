import type { APIRoute } from 'astro'
import { listLeads } from '../../../../worker/repositories/leads.js'
import { recordAuditEvent } from '../../../../worker/repositories/auditLog.js'
import { getEnv } from '../../../../lib/env'
import { jsonResponse } from '../../../../lib/http'
import { toCsv } from '../../../../lib/leads/csv'
import { INQUIRY_TYPES, PIPELINE_STATUSES, QUALIFICATION_RESULTS } from '../../../../lib/schemas/inquiry'
import { withAdmin } from '../../../../lib/adminGuard'

export const prerender = false

/**
 * Authorized CSV export of the lead inbox.
 *
 * Behind the blanket `/api/admin/*` auth gate. The message body is
 * deliberately NOT included: an export is routinely mailed around or dropped
 * into a shared drive, and the free-text field is the one most likely to hold
 * something a person would not expect to travel. It stays visible in the
 * admin detail panel, which is access-controlled.
 *
 * Every cell goes through the formula-injection-safe encoder in
 * src/lib/leads/csv.ts.
 */
const COLUMNS = [
  { key: 'createdAt', label: 'Created' },
  { key: 'inquiryType', label: 'Inquiry type' },
  { key: 'name', label: 'Name' },
  { key: 'email', label: 'Email' },
  { key: 'company', label: 'Company' },
  { key: 'website', label: 'Website' },
  { key: 'subject', label: 'Subject' },
  { key: 'timeline', label: 'Timeline' },
  { key: 'budgetRange', label: 'Budget range' },
  { key: 'teamSize', label: 'Team size' },
  { key: 'preferredContact', label: 'Preferred contact' },
  { key: 'qualification', label: 'Qualification' },
  { key: 'qualificationScore', label: 'Score' },
  { key: 'pipelineStatus', label: 'Pipeline status' },
  { key: 'assignedOwner', label: 'Owner' },
  { key: 'status', label: 'Delivery status' },
]

function allowed(value: string | null, options: readonly string[]): string | null {
  return value && options.includes(value) ? value : null
}

const unguardedGET: APIRoute = async ({ url, locals }) => {
  const env = getEnv()
  if (!env.DB) return jsonResponse({ error: 'D1 DB binding is not configured.' }, 503)

  const leads = await listLeads(env.DB, {
    inquiryType: allowed(url.searchParams.get('inquiryType'), INQUIRY_TYPES),
    pipelineStatus: allowed(url.searchParams.get('pipelineStatus'), PIPELINE_STATUSES),
    qualification: allowed(url.searchParams.get('qualification'), QUALIFICATION_RESULTS),
    includeArchived: url.searchParams.get('includeArchived') === 'true',
    limit: 500,
  })

  await recordAuditEvent(env.DB, {
    actorEmail: locals.adminEmail || null,
    action: 'export',
    entityType: 'leads',
    entityId: null,
    metadata: { summary: `Exported ${leads.length} lead(s) to CSV.`, count: leads.length },
  })

  const csv = toCsv(leads as Array<Record<string, unknown>>, COLUMNS)
  const filename = `devlab-leads-${new Date().toISOString().slice(0, 10)}.csv`

  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

// Authenticated per handler as well as by src/middleware.ts; see src/lib/adminGuard.ts.
export const GET = withAdmin(unguardedGET)

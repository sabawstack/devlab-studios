import type { APIRoute } from 'astro'
import { z } from 'zod'
import { getEnv } from '../../../../lib/env'
import { adminErrorResponse, jsonResponse, readJsonBody } from '../../../../lib/http'
import { withAdmin } from '../../../../lib/adminGuard'
import { getSiteSetting, setSiteSetting } from '../../../../worker/repositories/content.js'
import { recordAuditEvent } from '../../../../worker/repositories/auditLog.js'
import { getInquiryFunnel, INQUIRY_REMINDER_SETTINGS_KEY, resolveReminderSettings } from '../../../../worker/leads/funnel.js'

export const prerender = false

/**
 * Funnel figures for the Inquiries screen (audit LEAD-05) and the settings of
 * the daily "waiting for a reply" reminder. GET ?days=30 (1-365).
 */
const unguardedGET: APIRoute = async ({ url }) => {
  const env = getEnv()
  if (!env.DB) return jsonResponse({ error: 'D1 DB binding is not configured.' }, 503)
  const days = Math.min(365, Math.max(1, Number(url.searchParams.get('days')) || 30))
  const until = new Date()
  const since = new Date(until.getTime() - days * 24 * 3_600_000)
  const [funnel, reminderSettings] = await Promise.all([
    getInquiryFunnel(env.DB, { since, until }),
    getSiteSetting(env.DB, INQUIRY_REMINDER_SETTINGS_KEY, null),
  ])
  return jsonResponse({ days, funnel, reminders: resolveReminderSettings(reminderSettings) }, 200, { 'Cache-Control': 'no-store' })
}

const reminderSchema = z.object({ enabled: z.boolean(), hours: z.number().int().min(1).max(336) }).strict()

const unguardedPUT: APIRoute = async ({ request, locals }) => {
  const env = getEnv()
  if (!env.DB) return jsonResponse({ error: 'D1 DB binding is not configured.' }, 503)
  try {
    const parsed = reminderSchema.safeParse(await readJsonBody(request))
    if (!parsed.success) return jsonResponse({ error: 'Give enabled (true/false) and hours (1-336).' }, 400)
    await setSiteSetting(env.DB, INQUIRY_REMINDER_SETTINGS_KEY, parsed.data)
    await recordAuditEvent(env.DB, { actorEmail: locals.adminEmail || null, action: 'update', entityType: 'inquiry_reminders', entityId: INQUIRY_REMINDER_SETTINGS_KEY, metadata: { summary: 'Updated inquiry reminder settings.', after: parsed.data } })
    return jsonResponse({ reminders: parsed.data })
  } catch (error) {
    return adminErrorResponse(error, 'Could not save the reminder settings.')
  }
}

// Authenticated per handler as well as by src/middleware.ts; see src/lib/adminGuard.ts.
export const GET = withAdmin(unguardedGET)
export const PUT = withAdmin(unguardedPUT)

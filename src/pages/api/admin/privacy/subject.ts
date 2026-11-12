import type { APIRoute } from 'astro'
import { z } from 'zod'
import { getEnv } from '../../../../lib/env'
import { adminErrorResponse, jsonResponse } from '../../../../lib/http'
import { withAdmin } from '../../../../lib/adminGuard'
import { erasePerson, exportPerson } from '../../../../worker/privacy/subject.js'
import { hashRecipient } from '../../../../worker/delivery/confirmationCap.js'
import { recordAuditEvent } from '../../../../worker/repositories/auditLog.js'

export const prerender = false

const emailSchema = z.email()

/**
 * Data-subject requests for inquiries (audit SEC-08).
 * GET ?email=  -> the person's inquiries as a JSON download.
 * DELETE ?email=&confirm=  -> erases them; `confirm` must repeat the address.
 * Audit events carry a hash of the address, not the address, so the log does
 * not keep what was erased.
 */
const unguardedGET: APIRoute = async ({ url, locals }) => {
  const env = getEnv()
  if (!env.DB) return jsonResponse({ error: 'D1 DB binding is not configured.' }, 503)
  const email = String(url.searchParams.get('email') || '').trim().toLowerCase()
  if (!emailSchema.safeParse(email).success) return jsonResponse({ error: 'Give a valid email address.' }, 400)
  const data = await exportPerson(env.DB, email)
  await recordAuditEvent(env.DB, { actorEmail: locals.adminEmail || null, action: 'export', entityType: 'data_subject', entityId: await hashRecipient(email), metadata: { summary: `Exported ${data.inquiries.length} inquiries for a data-subject request.` } })
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': 'attachment; filename="inquiries-export.json"',
      'Cache-Control': 'no-store',
    },
  })
}

const unguardedDELETE: APIRoute = async ({ url, locals }) => {
  const env = getEnv()
  if (!env.DB) return jsonResponse({ error: 'D1 DB binding is not configured.' }, 503)
  try {
    const email = String(url.searchParams.get('email') || '').trim().toLowerCase()
    const confirm = String(url.searchParams.get('confirm') || '').trim().toLowerCase()
    if (!emailSchema.safeParse(email).success) return jsonResponse({ error: 'Give a valid email address.' }, 400)
    if (confirm !== email) return jsonResponse({ error: 'Type the address again in confirm to erase.' }, 400)
    const result = await erasePerson(env.DB, email)
    await recordAuditEvent(env.DB, { actorEmail: locals.adminEmail || null, action: 'erase', entityType: 'data_subject', entityId: await hashRecipient(email), metadata: { summary: `Erased ${result.inquiries} inquiries for a data-subject request.`, ...result } })
    return jsonResponse({ ok: true, ...result })
  } catch (error) {
    return adminErrorResponse(error, 'Could not erase the records.')
  }
}

// Authenticated per handler as well as by src/middleware.ts; see src/lib/adminGuard.ts.
export const GET = withAdmin(unguardedGET)
export const DELETE = withAdmin(unguardedDELETE)

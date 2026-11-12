import type { APIRoute } from 'astro'
import { z } from 'zod'
import { getEnv } from '../../../lib/env'
import { adminErrorResponse, jsonResponse, readJsonBody } from '../../../lib/http'
import { withAdmin } from '../../../lib/adminGuard'
import { getConfiguredAdmins, hashPassword, MIN_ADMIN_PASSWORD_LENGTH } from '../../../worker/middleware/adminAuth.js'
import { deleteAdminCredential, getAdminCredential, listAdminCredentials, upsertAdminCredential } from '../../../worker/repositories/adminCredentials.js'
import { recordAuditEvent } from '../../../worker/repositories/auditLog.js'

export const prerender = false

/**
 * Admin logins (audit CMS-04 / SEC-02): a second operator gets their own
 * login instead of sharing the owner's password. One role for everyone; no
 * permission tiers. New logins use the same PBKDF2 hashing as a password
 * change; removing one ends its sessions on their next request.
 */
const createSchema = z.object({
  email: z.email().transform((value) => value.trim().toLowerCase()),
  password: z.string().min(MIN_ADMIN_PASSWORD_LENGTH, `Use at least ${MIN_ADMIN_PASSWORD_LENGTH} characters.`).max(200),
})
const deleteSchema = z.object({ email: z.email().transform((value) => value.trim().toLowerCase()) })

const unguardedGET: APIRoute = async ({ locals }) => {
  const env = getEnv()
  if (!env.DB) return jsonResponse({ error: 'D1 DB binding is not configured.' }, 503)
  const stored = (await listAdminCredentials(env.DB)) as Array<{ email: string } & Record<string, unknown>>
  const bootstrap = getConfiguredAdmins(env).map((admin: { email: string }) => admin.email)
  return jsonResponse({
    currentEmail: locals.adminEmail || null,
    logins: [
      ...bootstrap.filter((email: string) => !stored.some((row) => row.email === email))
        .map((email: string) => ({ email, source: 'environment' })),
      ...stored.map((row) => ({ ...row, source: bootstrap.includes(row.email) ? 'environment+cms' : 'cms' })),
    ],
  }, 200, { 'Cache-Control': 'no-store' })
}

const unguardedPOST: APIRoute = async ({ request, locals }) => {
  const env = getEnv()
  if (!env.DB) return jsonResponse({ error: 'D1 DB binding is not configured.' }, 503)
  try {
    const parsed = createSchema.safeParse(await readJsonBody(request))
    if (!parsed.success) return jsonResponse({ error: parsed.error.issues[0]?.message || 'Validation failed.' }, 400)
    const { email, password } = parsed.data
    const bootstrap = getConfiguredAdmins(env).map((admin: { email: string }) => admin.email)
    if (bootstrap.includes(email) || await getAdminCredential(env.DB, email)) {
      return jsonResponse({ error: 'That email already has a login. Use Change password instead.' }, 409)
    }
    await upsertAdminCredential(env.DB, { email, passwordHash: await hashPassword(password), role: 'owner' })
    await recordAuditEvent(env.DB, { actorEmail: locals.adminEmail || null, action: 'create', entityType: 'admin_login', entityId: email, metadata: { summary: `Added an admin login for ${email}.` } })
    return jsonResponse({ ok: true, email }, 201)
  } catch (error) {
    return adminErrorResponse(error, 'Could not add the login.')
  }
}

const unguardedDELETE: APIRoute = async ({ url, locals }) => {
  const env = getEnv()
  if (!env.DB) return jsonResponse({ error: 'D1 DB binding is not configured.' }, 503)
  try {
    const parsed = deleteSchema.safeParse({ email: url.searchParams.get('email') || '' })
    if (!parsed.success) return jsonResponse({ error: 'Give the email of the login to remove.' }, 400)
    const { email } = parsed.data
    if (email === String(locals.adminEmail || '').toLowerCase()) {
      return jsonResponse({ error: 'You cannot remove your own login while signed in with it.' }, 409)
    }
    const bootstrap = getConfiguredAdmins(env).map((admin: { email: string }) => admin.email)
    if (bootstrap.includes(email)) {
      return jsonResponse({ error: 'This is the bootstrap login from the Worker secrets; it cannot be removed here.' }, 409)
    }
    if (!(await deleteAdminCredential(env.DB, email))) return jsonResponse({ error: 'No such login.' }, 404)
    await recordAuditEvent(env.DB, { actorEmail: locals.adminEmail || null, action: 'delete', entityType: 'admin_login', entityId: email, metadata: { summary: `Removed the admin login for ${email}.` } })
    return jsonResponse({ ok: true })
  } catch (error) {
    return adminErrorResponse(error, 'Could not remove the login.')
  }
}

// Authenticated per handler as well as by src/middleware.ts; see src/lib/adminGuard.ts.
export const GET = withAdmin(unguardedGET)
export const POST = withAdmin(unguardedPOST)
export const DELETE = withAdmin(unguardedDELETE)

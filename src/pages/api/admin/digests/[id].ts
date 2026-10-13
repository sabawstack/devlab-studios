import type { APIRoute } from 'astro'
import { deleteDigest, listDigests, setDigestStatus } from '../../../../worker/repositories/digests.js'
import { recordAuditEvent } from '../../../../worker/repositories/auditLog.js'
import { getEnv } from '../../../../lib/env'
import { adminErrorResponse, drainRequestBody, jsonResponse, readJsonBody } from '../../../../lib/http'
import { withAdmin } from '../../../../lib/adminGuard'

export const prerender = false

const STATUSES = ['published', 'draft']

async function findDigest(db: D1Database, id: string) {
  const digests = await listDigests(db, { limit: 60, includeDrafts: true })
  return digests.find((digest) => digest.id === id) || null
}

/** Publish / unpublish. Unpublishing hides the day from the site without losing it. */
const unguardedPATCH: APIRoute = async ({ params, request, locals }) => {
  const id = params.id as string
  const env = getEnv()
  if (!env.DB) {
    await drainRequestBody(request)
    return jsonResponse({ error: 'D1 DB binding is not configured.' }, 503)
  }

  try {
    // Read the body before any early return: an unread body breaks the next
    // keep-alive request under `wrangler dev --local`.
    const body = (await readJsonBody(request)) as { status?: string }

    const existing = await findDigest(env.DB, id)
    if (!existing) return jsonResponse({ error: 'Digest not found.' }, 404)

    const status = String(body?.status || '')
    if (!STATUSES.includes(status)) {
      return jsonResponse({ error: 'Status must be "published" or "draft".' }, 400)
    }

    await setDigestStatus(env.DB, id, status)
    await recordAuditEvent(env.DB, {
      actorEmail: locals.adminEmail || null,
      action: 'update',
      entityType: 'digests',
      entityId: id,
      metadata: { summary: `Set the ${existing.digestDate} digest to ${status}.`, status },
    })

    return jsonResponse({ ...existing, status })
  } catch (error) {
    return adminErrorResponse(error)
  }
}

/**
 * Deletes a day outright. Items go with it through the foreign key's cascade.
 *
 * Available because a digest is generated rather than authored: if a feed
 * publishes something that should not carry the DevLab byline, waiting for the
 * retention sweep is not an acceptable remedy.
 */
const unguardedDELETE: APIRoute = async ({ params, request, locals }) => {
  const id = params.id as string
  const env = getEnv()
  await drainRequestBody(request)
  if (!env.DB) return jsonResponse({ error: 'D1 DB binding is not configured.' }, 503)

  try {
    const existing = await findDigest(env.DB, id)
    if (!existing) return jsonResponse({ error: 'Digest not found.' }, 404)

    await deleteDigest(env.DB, id)
    await recordAuditEvent(env.DB, {
      actorEmail: locals.adminEmail || null,
      action: 'delete',
      entityType: 'digests',
      entityId: id,
      metadata: { summary: `Deleted the ${existing.digestDate} digest (${existing.itemCount} items).` },
    })

    return jsonResponse({ deleted: true, digestDate: existing.digestDate })
  } catch (error) {
    return adminErrorResponse(error)
  }
}

// Authenticated per handler as well as by src/middleware.ts; see src/lib/adminGuard.ts.
export const PATCH = withAdmin(unguardedPATCH)
export const DELETE = withAdmin(unguardedDELETE)

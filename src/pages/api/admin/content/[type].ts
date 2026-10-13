import type { APIRoute } from 'astro'
import { getSingletonContentType } from '../../../../worker/adminRegistry.js'
import { recordVersion } from '../../../../worker/repositories/contentVersions.js'
import { recordAuditEvent } from '../../../../worker/repositories/auditLog.js'
import { SINGLETON_CONTENT_SCHEMAS } from '../../../../lib/schemas/legacyContentTypes'
import { getEnv } from '../../../../lib/env'
import { adminErrorResponse, jsonResponse, readJsonBody } from '../../../../lib/http'
import { buildAuditMetadata } from '../../../../lib/audit.js'
import { withAdmin } from '../../../../lib/adminGuard'

const unguardedGET: APIRoute = async ({ params }) => {
  const handlers = getSingletonContentType(params.type as string)
  if (!handlers) return jsonResponse({ error: 'Unknown content type.' }, 404)

  const env = getEnv()
  if (!env.DB) return jsonResponse({ error: 'D1 DB binding is not configured.' }, 503)

  const data = await handlers.get(env.DB, { includeDrafts: true })
  return jsonResponse(data)
}

const unguardedPUT: APIRoute = async ({ params, request, locals }) => {
  const type = params.type as string
  const handlers = getSingletonContentType(type)
  if (!handlers) return jsonResponse({ error: 'Unknown content type.' }, 404)

  const env = getEnv()
  if (!env.DB) return jsonResponse({ error: 'D1 DB binding is not configured.' }, 503)

  try {
    const before = await handlers.get(env.DB, { includeDrafts: true })
    const rawPayload = await readJsonBody(request)
    // `handlers` already confirmed `type` is one of SINGLETON_CONTENT_SCHEMAS's keys.
    const result = SINGLETON_CONTENT_SCHEMAS[type].safeParse(rawPayload)
    if (!result.success) return jsonResponse({ error: 'Validation failed.', issues: result.error.issues }, 400)

    const data = await handlers.replace(env.DB, result.data)
    await recordVersion(env.DB, { contentType: type, contentId: null, status: 'published', snapshot: data, createdBy: locals.adminEmail || null })
    await recordAuditEvent(env.DB, {
      actorEmail: locals.adminEmail || null,
      action: 'replace',
      entityType: type,
      entityId: null,
      metadata: buildAuditMetadata({ before, after: data, label: handlers.label }),
    })
    return jsonResponse(data)
  } catch (error) {
    return adminErrorResponse(error)
  }
}

// Authenticated per handler as well as by src/middleware.ts; see src/lib/adminGuard.ts.
export const GET = withAdmin(unguardedGET)
export const PUT = withAdmin(unguardedPUT)

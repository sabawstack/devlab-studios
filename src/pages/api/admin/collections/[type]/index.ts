import type { APIRoute } from 'astro'
import { z } from 'zod'
import { getReplaceAllCollection, getPerItemCollection } from '../../../../../worker/adminRegistry.js'
import { recordVersion } from '../../../../../worker/repositories/contentVersions.js'
import { recordAuditEvent } from '../../../../../worker/repositories/auditLog.js'
import { getEnv } from '../../../../../lib/env'
import { adminErrorResponse, jsonResponse, readJsonBody } from '../../../../../lib/http'
import { buildAuditMetadata, buildCreateAuditMetadata } from '../../../../../lib/audit.js'
import { withAdmin } from '../../../../../lib/adminGuard'

const unguardedGET: APIRoute = async ({ params }) => {
  const type = params.type as string
  const env = getEnv()
  if (!env.DB) return jsonResponse({ error: 'D1 DB binding is not configured.' }, 503)

  const replaceAll = getReplaceAllCollection(type)
  if (replaceAll) return jsonResponse(await replaceAll.list(env.DB))

  const perItem = getPerItemCollection(type)
  if (perItem) return jsonResponse(await perItem.list(env.DB))

  return jsonResponse({ error: 'Unknown collection type.' }, 404)
}

const unguardedPUT: APIRoute = async ({ params, request, locals }) => {
  const type = params.type as string
  const collection = getReplaceAllCollection(type)
  if (!collection) return jsonResponse({ error: 'Unknown replace-all collection type.' }, 404)

  const env = getEnv()
  if (!env.DB) return jsonResponse({ error: 'D1 DB binding is not configured.' }, 503)

  const payload = await readJsonBody(request)
  const items = Array.isArray(payload) ? payload : (payload as { items?: unknown[] }).items
  const result = z.array(collection.schema).safeParse(items)
  if (!result.success) return jsonResponse({ error: 'Validation failed.', issues: result.error.issues }, 400)

  const before = await collection.list(env.DB)
  await collection.replaceAll(env.DB, result.data)
  await recordVersion(env.DB, { contentType: type, contentId: null, status: 'published', snapshot: result.data, createdBy: locals.adminEmail || null })
  await recordAuditEvent(env.DB, { actorEmail: locals.adminEmail || null, action: 'replace', entityType: type, entityId: null, metadata: buildAuditMetadata({ before, after: result.data, label: collection.label }) })

  return jsonResponse(await collection.list(env.DB))
}

const unguardedPOST: APIRoute = async ({ params, request, locals }) => {
  const type = params.type as string
  const collection = getPerItemCollection(type)
  if (!collection) return jsonResponse({ error: 'Unknown per-item collection type.' }, 404)

  const env = getEnv()
  if (!env.DB) return jsonResponse({ error: 'D1 DB binding is not configured.' }, 503)

  const payload = await readJsonBody(request)
  const result = collection.schema.safeParse(payload)
  if (!result.success) return jsonResponse({ error: 'Validation failed.', issues: result.error.issues }, 400)

  const isUpdate = Boolean((payload as { id?: string }).id)

  try {
    const beforeItems = isUpdate ? await collection.list(env.DB) : []
    const before = isUpdate ? beforeItems.find((item: { id?: string }) => item.id === (payload as { id?: string }).id) || null : null
    const saved = await collection.upsert(env.DB, result.data)
    const savedId = (saved as { id?: string } | null)?.id || null
    await recordVersion(env.DB, { contentType: type, contentId: savedId, status: (saved as { status?: string } | null)?.status || 'draft', snapshot: saved, createdBy: locals.adminEmail || null })
    await recordAuditEvent(env.DB, {
      actorEmail: locals.adminEmail || null,
      action: isUpdate ? 'update' : 'create',
      entityType: type,
      entityId: savedId,
      metadata: isUpdate
        ? buildAuditMetadata({ before, after: saved, label: collection.label })
        : buildCreateAuditMetadata(saved, collection.label),
    })
    return jsonResponse(saved, isUpdate ? 200 : 201)
  } catch (error) {
    return adminErrorResponse(error)
  }
}

// Authenticated per handler as well as by src/middleware.ts; see src/lib/adminGuard.ts.
export const GET = withAdmin(unguardedGET)
export const PUT = withAdmin(unguardedPUT)
export const POST = withAdmin(unguardedPOST)

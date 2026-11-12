import type { APIRoute } from 'astro'
import { z } from 'zod'
import { getReplaceAllCollection, getPerItemCollection, getSingletonContentType } from '../../../../../worker/adminRegistry.js'
import { getVersion, recordVersion } from '../../../../../worker/repositories/contentVersions.js'
import { recordAuditEvent } from '../../../../../worker/repositories/auditLog.js'
import { replacePage } from '../../../../../worker/repositories/pages.js'
import { checkPageForSave } from '../../../../../lib/pageSave'
import { getEnv } from '../../../../../lib/env'
import { jsonResponse, readJsonBody } from '../../../../../lib/http'
import { SINGLETON_CONTENT_SCHEMAS } from '../../../../../lib/schemas/legacyContentTypes'
import { projectRequestSchema } from '../../../../../lib/schemas/collections'
import { withAdmin } from '../../../../../lib/adminGuard'

/**
 * The schema a normal save of `type` validates against, so a restore is held
 * to exactly the same rules. Projects are saved through /api/admin/projects
 * with projectRequestSchema (which keeps galleryImages), not the registry's
 * bare projectSchema, so the same schema is used here.
 */
function saveSchemaFor(type: string, replaceAllSchema?: z.ZodTypeAny, perItemSchema?: z.ZodTypeAny): z.ZodTypeAny | null {
  if (replaceAllSchema) return z.array(replaceAllSchema)
  if (type === 'projects') return projectRequestSchema
  if (perItemSchema) return perItemSchema
  return SINGLETON_CONTENT_SCHEMAS[type] || null
}

/**
 * Rollback never rewrites history — it re-applies an old snapshot as a
 * brand-new version, so the version list always reads chronologically.
 */
const unguardedPOST: APIRoute = async ({ params, request, locals }) => {
  const type = params.type as string
  const body = (await readJsonBody(request)) as { contentId?: string | null; versionNumber?: number }
  const contentId = body.contentId ?? null
  const versionNumber = Number(body.versionNumber)

  if (!Number.isFinite(versionNumber)) return jsonResponse({ error: 'versionNumber is required.' }, 400)

  const env = getEnv()
  if (!env.DB) return jsonResponse({ error: 'D1 DB binding is not configured.' }, 503)

  // Pages are versioned per slug (contentId) by PUT /api/admin/pages/:slug,
  // not through the collection registry, so they restore through the same
  // checks that page save runs.
  if (type === 'pages' && (typeof contentId !== 'string' || !contentId)) {
    return jsonResponse({ error: 'contentId (the page slug) is required to restore a page.' }, 400)
  }

  const version = await getVersion(env.DB, type, contentId, versionNumber)
  if (!version) return jsonResponse({ error: 'Version not found.' }, 404)

  if (type === 'pages') {
    const slug = contentId as string
    const check = await checkPageForSave(env.DB, slug, version.snapshot)
    if (!check.ok) {
      const { error, issues, projectIds } = (await check.response.json()) as { error?: string; issues?: unknown; projectIds?: unknown }
      return jsonResponse({ error: `This version cannot be restored: ${error}`, issues, projectIds }, 400)
    }
    const restored = await replacePage(env.DB, slug, check.data)
    await recordVersion(env.DB, { contentType: 'pages', contentId: slug, status: check.data.status, snapshot: restored, createdBy: locals.adminEmail || null })
    await recordAuditEvent(env.DB, { actorEmail: locals.adminEmail || null, action: 'restore', entityType: 'pages', entityId: slug, metadata: { summary: `Restored the ${slug} page from version ${versionNumber}.`, restoredVersion: versionNumber } })
    return jsonResponse(restored)
  }

  const replaceAll = getReplaceAllCollection(type)
  const perItem = getPerItemCollection(type)
  const singleton = getSingletonContentType(type)

  if (!replaceAll && !perItem && !singleton) return jsonResponse({ error: 'Unknown content type.' }, 404)

  // An old snapshot was valid under the schema of its day, not necessarily
  // today's -- and it is written straight back to D1, so it must pass the same
  // validation (including the link-scheme policy) as a fresh save.
  const schema = saveSchemaFor(type, replaceAll?.schema, perItem?.schema)
  if (!schema) return jsonResponse({ error: 'Unknown content type.' }, 404)
  const validated = schema.safeParse(version.snapshot)
  if (!validated.success) {
    return jsonResponse({ error: 'This version no longer passes validation and cannot be restored.', issues: validated.error.issues }, 400)
  }
  const snapshot = validated.data

  let restored: unknown
  if (replaceAll) {
    await replaceAll.replaceAll(env.DB, snapshot)
    restored = await replaceAll.list(env.DB)
  } else if (perItem) {
    restored = await perItem.upsert(env.DB, snapshot)
  } else {
    restored = await singleton.replace(env.DB, snapshot)
  }

  await recordVersion(env.DB, { contentType: type, contentId, status: version.status, snapshot, createdBy: locals.adminEmail || null })
  await recordAuditEvent(env.DB, { actorEmail: locals.adminEmail || null, action: 'restore', entityType: type, entityId: contentId, metadata: { summary: `Restored ${type}${contentId ? ` ${contentId}` : ''} from version ${versionNumber}.`, restoredVersion: versionNumber } })

  return jsonResponse(restored)
}

// Authenticated per handler as well as by src/middleware.ts; see src/lib/adminGuard.ts.
export const POST = withAdmin(unguardedPOST)

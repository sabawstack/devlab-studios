import type { APIRoute } from 'astro'
import { getPerItemCollection } from '../../../../../worker/adminRegistry.js'
import { recordAuditEvent } from '../../../../../worker/repositories/auditLog.js'
import { getEnv } from '../../../../../lib/env'
import { jsonResponse } from '../../../../../lib/http'
import { buildDeleteAuditMetadata } from '../../../../../lib/audit.js'
import { withAdmin } from '../../../../../lib/adminGuard'

const unguardedDELETE: APIRoute = async ({ params, locals }) => {
  const type = params.type as string
  const id = params.id as string
  const collection = getPerItemCollection(type)
  if (!collection) return jsonResponse({ error: 'Unknown per-item collection type.' }, 404)

  const env = getEnv()
  if (!env.DB) return jsonResponse({ error: 'D1 DB binding is not configured.' }, 503)

  const existingItems = await collection.list(env.DB)
  const existing = existingItems.find((item: { id?: string }) => item.id === id)
  await collection.delete(env.DB, id, env)
  await recordAuditEvent(env.DB, { actorEmail: locals.adminEmail || null, action: 'delete', entityType: type, entityId: id, metadata: buildDeleteAuditMetadata(existing, collection.label) })

  return jsonResponse({ id })
}

// Authenticated per handler as well as by src/middleware.ts; see src/lib/adminGuard.ts.
export const DELETE = withAdmin(unguardedDELETE)

import type { APIRoute } from 'astro'
import { getPage, replacePage } from '../../../../worker/repositories/pages.js'
import { checkPageForSave } from '../../../../lib/pageSave'
import { recordVersion } from '../../../../worker/repositories/contentVersions.js'
import { recordAuditEvent } from '../../../../worker/repositories/auditLog.js'
import { getEnv } from '../../../../lib/env'
import { jsonResponse, readJsonBody } from '../../../../lib/http'
import { buildAuditMetadata } from '../../../../lib/audit.js'
import { withAdmin } from '../../../../lib/adminGuard'

const unguardedGET: APIRoute = async ({ params }) => {
  const slug = params.slug as string
  const env = getEnv()
  if (!env.DB) return jsonResponse({ error: 'D1 DB binding is not configured.' }, 503)

  const page = await getPage(env.DB, slug, { includeDrafts: true })
  return jsonResponse(page || { slug, title: slug, status: 'draft', blocks: [] })
}

const unguardedPUT: APIRoute = async ({ params, request, locals }) => {
  const slug = params.slug as string
  const env = getEnv()
  if (!env.DB) return jsonResponse({ error: 'D1 DB binding is not configured.' }, 503)

  const before = await getPage(env.DB, slug, { includeDrafts: true })
  const payload = await readJsonBody(request)
  const check = await checkPageForSave(env.DB, slug, payload)
  if (!check.ok) return check.response

  const saved = await replacePage(env.DB, slug, check.data)
  await recordVersion(env.DB, { contentType: 'pages', contentId: slug, status: check.data.status, snapshot: saved, createdBy: locals.adminEmail || null })
  await recordAuditEvent(env.DB, {
    actorEmail: locals.adminEmail || null,
    action: 'replace',
    entityType: 'pages',
    entityId: slug,
    metadata: buildAuditMetadata({ before, after: saved, label: `${check.data.title || slug} page` }),
  })

  return jsonResponse(saved)
}

// Authenticated per handler as well as by src/middleware.ts; see src/lib/adminGuard.ts.
export const GET = withAdmin(unguardedGET)
export const PUT = withAdmin(unguardedPUT)

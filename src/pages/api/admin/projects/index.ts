import type { APIRoute } from 'astro'
import { listProjects, upsertProject } from '../../../../worker/repositories/projects.js'
import { recordVersion } from '../../../../worker/repositories/contentVersions.js'
import { recordAuditEvent } from '../../../../worker/repositories/auditLog.js'
import { projectRequestSchema } from '../../../../lib/schemas/collections'
import { getEnv } from '../../../../lib/env'
import { normalizeProjectMedia } from '../../../../lib/media'
import { adminErrorResponse, jsonResponse, readJsonBody } from '../../../../lib/http'
import { buildCreateAuditMetadata } from '../../../../lib/audit.js'
import { withAdmin } from '../../../../lib/adminGuard'

const unguardedGET: APIRoute = async () => {
  const env = getEnv()
  if (!env.DB) return jsonResponse({ error: 'D1 DB binding is not configured.' }, 503)

  const projects = await listProjects(env.DB, { includeDrafts: true })
  return jsonResponse(
    projects.map((project: Record<string, unknown>) => normalizeProjectMedia(project, env)),
    200,
    { 'X-Total-Count': String(projects.length) },
  )
}

const unguardedPOST: APIRoute = async ({ request, locals }) => {
  const env = getEnv()
  if (!env.DB) return jsonResponse({ error: 'D1 DB binding is not configured.' }, 503)

  try {
    const rawPayload = await readJsonBody(request)
    const result = projectRequestSchema.safeParse(rawPayload)
    if (!result.success) return jsonResponse({ error: 'Validation failed.', issues: result.error.issues }, 400)

    const project = await upsertProject(env.DB, result.data, env) as { id?: string; status?: string } | null
    if (!project) return jsonResponse({ error: 'Project could not be saved.' }, 500)
    await recordVersion(env.DB, { contentType: 'projects', contentId: project.id || null, status: project.status || 'draft', snapshot: project, createdBy: locals.adminEmail || null })
    await recordAuditEvent(env.DB, { actorEmail: locals.adminEmail || null, action: 'create', entityType: 'projects', entityId: project.id || null, metadata: buildCreateAuditMetadata(project, 'Project') })
    return jsonResponse(normalizeProjectMedia(project, env), 201)
  } catch (error) {
    return adminErrorResponse(error)
  }
}

// Authenticated per handler as well as by src/middleware.ts; see src/lib/adminGuard.ts.
export const GET = withAdmin(unguardedGET)
export const POST = withAdmin(unguardedPOST)

import type { APIRoute } from 'astro'
import { deleteProject, getProject, upsertProject } from '../../../../worker/repositories/projects.js'
import { getPage } from '../../../../worker/repositories/pages.js'
import { recordVersion } from '../../../../worker/repositories/contentVersions.js'
import { recordAuditEvent } from '../../../../worker/repositories/auditLog.js'
import { projectRequestSchema } from '../../../../lib/schemas/collections'
import { getEnv } from '../../../../lib/env'
import { normalizeProjectMedia } from '../../../../lib/media'
import { adminErrorResponse, jsonResponse, readJsonBody } from '../../../../lib/http'
import { buildAuditMetadata, buildDeleteAuditMetadata } from '../../../../lib/audit.js'
import { withAdmin } from '../../../../lib/adminGuard'

const unguardedGET: APIRoute = async ({ params }) => {
  const env = getEnv()
  if (!env.DB) return jsonResponse({ error: 'D1 DB binding is not configured.' }, 503)

  const project = await getProject(env.DB, params.id as string, { includeDrafts: true })
  if (!project) return jsonResponse({ error: 'Project not found.' }, 404)
  return jsonResponse(normalizeProjectMedia(project, env))
}

const unguardedPUT: APIRoute = async ({ params, request, locals }) => {
  const env = getEnv()
  if (!env.DB) return jsonResponse({ error: 'D1 DB binding is not configured.' }, 503)

  try {
    const before = await getProject(env.DB, params.id as string, { includeDrafts: true })
    const rawPayload = await readJsonBody(request)
    const result = projectRequestSchema.safeParse({ ...rawPayload, id: params.id })
    if (!result.success) return jsonResponse({ error: 'Validation failed.', issues: result.error.issues }, 400)

    const project = await upsertProject(env.DB, result.data, env) as { id?: string; status?: string; title?: string } | null
    if (!project) return jsonResponse({ error: 'Project could not be saved.' }, 500)
    await recordVersion(env.DB, { contentType: 'projects', contentId: params.id as string, status: project.status || 'draft', snapshot: project, createdBy: locals.adminEmail || null })
    await recordAuditEvent(env.DB, { actorEmail: locals.adminEmail || null, action: 'update', entityType: 'projects', entityId: params.id as string, metadata: buildAuditMetadata({ before, after: project, label: `Project ${project.title || params.id}` }) })
    return jsonResponse(normalizeProjectMedia(project, env))
  } catch (error) {
    return adminErrorResponse(error)
  }
}

const unguardedPATCH: APIRoute = async ({ params, request, locals }) => {
  const env = getEnv()
  if (!env.DB) return jsonResponse({ error: 'D1 DB binding is not configured.' }, 503)

  try {
    const existing = await getProject(env.DB, params.id as string, { includeDrafts: true })
    if (!existing) return jsonResponse({ error: 'Project not found.' }, 404)
    const payload = await readJsonBody(request)
    const result = projectRequestSchema.safeParse({ ...existing, ...payload, id: params.id })
    if (!result.success) return jsonResponse({ error: 'Validation failed.', issues: result.error.issues }, 400)

    const project = await upsertProject(env.DB, result.data, env) as { id?: string; status?: string; title?: string } | null
    if (!project) return jsonResponse({ error: 'Project could not be saved.' }, 500)
    await recordVersion(env.DB, { contentType: 'projects', contentId: params.id as string, status: project.status || 'draft', snapshot: project, createdBy: locals.adminEmail || null })
    await recordAuditEvent(env.DB, { actorEmail: locals.adminEmail || null, action: 'update', entityType: 'projects', entityId: params.id as string, metadata: buildAuditMetadata({ before: existing, after: project, label: `Project ${project.title || params.id}` }) })
    return jsonResponse(normalizeProjectMedia(project, env))
  } catch (error) {
    return adminErrorResponse(error)
  }
}

const unguardedDELETE: APIRoute = async ({ params, locals }) => {
  const env = getEnv()
  if (!env.DB) return jsonResponse({ error: 'D1 DB binding is not configured.' }, 503)

  const projectId = params.id as string
  const existing = await getProject(env.DB, projectId, { includeDrafts: true })
  if (!existing) return jsonResponse({ error: 'Project not found.' }, 404)
  const workPage = await getPage(env.DB, 'work', { includeDrafts: true }) as {
    blocks?: Array<{ type?: string; props?: { items?: Array<{ projectId?: string }> } }>
  } | null
  const workShowcase = workPage?.blocks?.find((block) => block.type === 'workProjectShowcase')
  const isFeaturedOnWork = Array.isArray(workShowcase?.props?.items)
    && workShowcase.props.items.some((item: { projectId?: string }) => item?.projectId === projectId)

  if (isFeaturedOnWork) {
    return jsonResponse({
      error: 'This project is featured on Work. Remove it from the Work page before deleting it.',
    }, 409)
  }

  const deleted = await deleteProject(env.DB, projectId, env)
  await recordAuditEvent(env.DB, { actorEmail: locals.adminEmail || null, action: 'delete', entityType: 'projects', entityId: projectId, metadata: buildDeleteAuditMetadata(existing, 'Project') })
  return jsonResponse(deleted)
}

// Authenticated per handler as well as by src/middleware.ts; see src/lib/adminGuard.ts.
export const GET = withAdmin(unguardedGET)
export const PUT = withAdmin(unguardedPUT)
export const PATCH = withAdmin(unguardedPATCH)
export const DELETE = withAdmin(unguardedDELETE)

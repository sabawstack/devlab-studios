import type { APIRoute } from 'astro'
import { getPage, replacePage } from '../../../../worker/repositories/pages.js'
import { listProjects } from '../../../../worker/repositories/projects.js'
import { pageSingletonSchema } from '../../../../lib/schemas/singletons.js'
import { recordVersion } from '../../../../worker/repositories/contentVersions.js'
import { recordAuditEvent } from '../../../../worker/repositories/auditLog.js'
import { getEnv } from '../../../../lib/env'
import { jsonResponse, readJsonBody } from '../../../../lib/http'
import { buildAuditMetadata } from '../../../../lib/audit.js'
import { withAdmin } from '../../../../lib/adminGuard'

interface ProjectReferenceRecord {
  id: string
  status?: string
}

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
  const result = pageSingletonSchema.safeParse({ ...payload, slug })
  if (!result.success) return jsonResponse({ error: 'Validation failed.', issues: result.error.issues }, 400)

  if (slug === 'work') {
    const showcase = result.data.blocks.find((block) => block.type === 'workProjectShowcase')
    const featuredItems = showcase?.type === 'workProjectShowcase' ? showcase.props.items : []
    const projects = await listProjects(env.DB, { includeDrafts: true }) as ProjectReferenceRecord[]
    const projectsById = new Map(projects.map((project) => [project.id, project]))
    const missingProjectIds = featuredItems
      .map((item) => item.projectId)
      .filter((projectId) => !projectsById.has(projectId))

    if (missingProjectIds.length > 0) {
      return jsonResponse({
        error: 'Work contains project references that do not exist.',
        projectIds: missingProjectIds,
      }, 400)
    }

    const unpublishedProjectIds = featuredItems
      .filter((item) => item.status === 'published' && projectsById.get(item.projectId)?.status !== 'published')
      .map((item) => item.projectId)

    if (unpublishedProjectIds.length > 0) {
      return jsonResponse({
        error: 'Publish the referenced Projects before publishing their Work entries.',
        projectIds: unpublishedProjectIds,
      }, 400)
    }
  }

  const saved = await replacePage(env.DB, slug, result.data)
  await recordVersion(env.DB, { contentType: 'pages', contentId: slug, status: result.data.status, snapshot: saved, createdBy: locals.adminEmail || null })
  await recordAuditEvent(env.DB, {
    actorEmail: locals.adminEmail || null,
    action: 'replace',
    entityType: 'pages',
    entityId: slug,
    metadata: buildAuditMetadata({ before, after: saved, label: `${result.data.title || slug} page` }),
  })

  return jsonResponse(saved)
}

// Authenticated per handler as well as by src/middleware.ts; see src/lib/adminGuard.ts.
export const GET = withAdmin(unguardedGET)
export const PUT = withAdmin(unguardedPUT)

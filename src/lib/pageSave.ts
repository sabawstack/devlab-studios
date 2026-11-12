import { listProjects } from '../worker/repositories/projects.js'
import { pageSingletonSchema, type PageSingleton } from './schemas/singletons.js'
import { jsonResponse } from './http'

interface ProjectReferenceRecord {
  id: string
  status?: string
}

export type PageSaveCheck = { ok: true; data: PageSingleton } | { ok: false; response: Response }

/**
 * Everything a page must pass before it is written to D1: the page schema
 * (slug, status, blocks, link policy) and, for Work, that every featured
 * project exists and is published when its entry is. Shared by a normal save
 * (PUT /api/admin/pages/:slug) and a version restore, so an old snapshot is
 * held to exactly today's rules.
 */
export async function checkPageForSave(db: D1Database, slug: string, payload: unknown): Promise<PageSaveCheck> {
  const result = pageSingletonSchema.safeParse({ ...(payload as Record<string, unknown>), slug })
  if (!result.success) {
    return { ok: false, response: jsonResponse({ error: 'Validation failed.', issues: result.error.issues }, 400) }
  }

  if (slug === 'work') {
    const showcase = result.data.blocks.find((block) => block.type === 'workProjectShowcase')
    const featuredItems = showcase?.type === 'workProjectShowcase' ? showcase.props.items : []
    const projects = await listProjects(db, { includeDrafts: true }) as ProjectReferenceRecord[]
    const projectsById = new Map(projects.map((project) => [project.id, project]))
    const missingProjectIds = featuredItems
      .map((item) => item.projectId)
      .filter((projectId) => !projectsById.has(projectId))

    if (missingProjectIds.length > 0) {
      return {
        ok: false,
        response: jsonResponse({ error: 'Work contains project references that do not exist.', projectIds: missingProjectIds }, 400),
      }
    }

    const unpublishedProjectIds = featuredItems
      .filter((item) => item.status === 'published' && projectsById.get(item.projectId)?.status !== 'published')
      .map((item) => item.projectId)

    if (unpublishedProjectIds.length > 0) {
      return {
        ok: false,
        response: jsonResponse({
          error: 'Publish the referenced Projects before publishing their Work entries.',
          projectIds: unpublishedProjectIds,
        }, 400),
      }
    }
  }

  return { ok: true, data: result.data }
}

import type { APIRoute } from 'astro'
import { listProjects } from '../../worker/repositories/projects.js'
import { getEnv } from '../../lib/env'
import { normalizeProjectMedia } from '../../lib/media'
import { publicContentFailure, publicJson } from '../../lib/publicContent'

export const GET: APIRoute = async () => {
  const env = getEnv()

  if (!env.DB) {
    return publicJson({ data: [], source: 'static-fallback', configured: false })
  }

  try {
    const projects = await listProjects(env.DB)
    return publicJson({
      data: projects.map((project: Record<string, unknown>) => normalizeProjectMedia(project, env)),
      source: 'd1',
      configured: true,
    })
  } catch (error) {
    return publicContentFailure([], 'projects', error)
  }
}

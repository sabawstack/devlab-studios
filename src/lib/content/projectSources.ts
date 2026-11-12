/**
 * How the public project list is assembled from D1 and the static fallback
 * (src/data/portfolio.js). Kept free of image and runtime imports so it can be
 * unit-tested; src/lib/content/projects.ts applies it.
 *
 * D1 is the source of truth (audit CMS-02): a project deleted or unpublished in
 * the admin disappears from the site. The static file still supplies bundled
 * screenshots for a D1 project with no gallery of its own, and the whole list
 * when D1 is unavailable or empty (that fallback lives in loadProjects).
 *
 * The legacy behaviour -- appending every static project D1 lacks -- stays
 * available behind PROJECTS_STATIC_MERGE="true" (wrangler.jsonc) so an
 * environment whose D1 has not been reconciled keeps showing what it shows
 * today. Run scripts/cms/static-projects-missing-from-d1.mjs before turning it
 * off.
 */
export interface ProjectSourceItem {
  id: string
  galleryImages?: unknown[]
  [key: string]: unknown
}

export function shouldAppendStaticProjects(env: { PROJECTS_STATIC_MERGE?: string } | undefined): boolean {
  return env?.PROJECTS_STATIC_MERGE === 'true'
}

export function mergeProjectSources<T extends ProjectSourceItem>(
  d1Projects: T[],
  staticItems: T[],
  { appendStatic }: { appendStatic: boolean },
): T[] {
  const staticById = new Map(staticItems.map((project) => [project.id, project]))
  const d1Ids = new Set(d1Projects.map((project) => project.id))

  const merged = d1Projects.map((project) => {
    const fallback = staticById.get(project.id)
    const ownGallery = Array.isArray(project.galleryImages)
      ? project.galleryImages.filter((image) => (image as { url?: unknown } | null)?.url)
      : []
    const fallbackGallery = Array.isArray(fallback?.galleryImages) ? fallback.galleryImages : []
    return { ...project, galleryImages: ownGallery.length > 0 ? ownGallery : fallbackGallery }
  })

  return appendStatic ? [...merged, ...staticItems.filter((project) => !d1Ids.has(project.id))] : merged
}

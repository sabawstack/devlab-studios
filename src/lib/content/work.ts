/** Loads the Work write-ups for a page render (see ./workEntries.ts for the rules). */
import { loadPage } from './pages'
import { loadProjects } from './projects'
import { buildWorkEntries, type WorkEntry } from './workEntries'

export { workSlug, isTemplateProject, type WorkEntry } from './workEntries'

export async function loadWorkEntries({ includeDrafts = false }: { includeDrafts?: boolean } = {}): Promise<WorkEntry[]> {
  const [page, projects] = await Promise.all([loadPage('work', { includeDrafts }), loadProjects()])
  const showcase = page?.blocks.find((block) => block.type === 'workProjectShowcase')?.props || {}
  return buildWorkEntries(Array.isArray(showcase.items) ? showcase.items : [], projects)
}

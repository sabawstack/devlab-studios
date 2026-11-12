/**
 * Work write-ups (audit UX-08 / WEB-05): one entry per published narrative on
 * the CMS "work" page, joined to its project. The home page, the Work index
 * and /work/<slug> all read this, so a write-up can only ever claim what an
 * editor wrote in the Work narrative or the project's outcome statements.
 */
import { getScene } from '../../config/scenes'
import type { ProjectData } from './projects'

const DEFAULT_SCENE = 'build-in-layers'

export interface WorkEntry {
  slug: string
  project: ProjectData
  summary: string
  problem: string
  system: string
  value: string
  outcomes: string[]
  sceneId: string
  evidenceNote: string
}

export function workSlug(project: { id: string; slug?: unknown }): string {
  const set = typeof project.slug === 'string' ? project.slug.trim() : ''
  return set || project.id.replace(/^p\d+-/, '')
}

export function isTemplateProject(project: { clientType?: unknown; liveUrl?: unknown; [key: string]: unknown }): boolean {
  return project.clientType === 'template' || String(project.liveUrl || '').startsWith('/landing-sample-')
}

export function buildWorkEntries(items: Record<string, unknown>[], projects: ProjectData[]): WorkEntry[] {
  const byId = new Map(projects.map((project) => [project.id, project]))
  return items.flatMap((item) => {
    if (item.status !== 'published') return []
    const project = byId.get(String(item.projectId || ''))
    if (!project || isTemplateProject(project)) return []
    const diagram = String(project.systemDiagramId || '')
    return [{
      slug: workSlug(project),
      project,
      summary: String(item.description || project.description || ''),
      problem: String(item.challenge || ''),
      system: String(item.systemArchitecture || ''),
      value: String(item.deliveryValue || ''),
      outcomes: (Array.isArray(project.outcomeStatements) ? project.outcomeStatements : [])
        .map((statement) => String(statement || '').trim())
        .filter(Boolean),
      sceneId: getScene(diagram) ? diagram : DEFAULT_SCENE,
      evidenceNote: String(project.evidenceNote || ''),
    }]
  })
}

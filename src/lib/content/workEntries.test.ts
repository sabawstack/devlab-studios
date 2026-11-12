import { describe, expect, it } from 'vitest'
import { buildWorkEntries, isTemplateProject, workSlug } from './workEntries'

const project = (overrides: Record<string, unknown> = {}) => ({
  id: 'p10-automated-lead-qualification',
  title: 'Lead qualification',
  description: 'A description.',
  type: 'Automation',
  techStack: ['n8n'],
  ...overrides,
})

const item = (overrides: Record<string, unknown> = {}) => ({
  projectId: 'p10-automated-lead-qualification',
  description: 'Summary.',
  challenge: 'Problem.',
  systemArchitecture: 'System.',
  deliveryValue: 'Value.',
  status: 'published',
  ...overrides,
})

describe('workSlug', () => {
  it('uses the editor-set slug when there is one', () => {
    expect(workSlug(project({ slug: 'lead-intake' }))).toBe('lead-intake')
  })

  it('derives a readable slug from the id, without the record prefix', () => {
    expect(workSlug(project())).toBe('automated-lead-qualification')
    expect(workSlug(project({ id: 'custom-id' }))).toBe('custom-id')
  })
})

describe('isTemplateProject', () => {
  it('flags starter templates by client type or by a landing-sample address', () => {
    expect(isTemplateProject(project({ clientType: 'template' }))).toBe(true)
    expect(isTemplateProject(project({ liveUrl: '/landing-sample-react' }))).toBe(true)
    expect(isTemplateProject(project())).toBe(false)
  })
})

describe('buildWorkEntries', () => {
  it('joins published narratives to their projects, in the editor order', () => {
    const entries = buildWorkEntries(
      [item(), item({ projectId: 'p6-messenger-ai-agent', challenge: 'Second.' })],
      [project(), project({ id: 'p6-messenger-ai-agent', title: 'Messenger' })],
    )
    expect(entries.map((entry) => entry.slug)).toEqual(['automated-lead-qualification', 'messenger-ai-agent'])
    expect(entries[0]).toMatchObject({ problem: 'Problem.', system: 'System.', value: 'Value.', summary: 'Summary.' })
  })

  it('drops drafts, missing projects and templates', () => {
    const entries = buildWorkEntries(
      [item({ status: 'draft' }), item({ projectId: 'gone' }), item({ projectId: 'w1-react-modern' })],
      [project(), project({ id: 'w1-react-modern', clientType: 'template' })],
    )
    expect(entries).toEqual([])
  })

  it('uses the project drawing when it names a known scene, else the layered system drawing', () => {
    const [withScene] = buildWorkEntries([item()], [project({ systemDiagramId: 'handoff-to-person' })])
    const [unknownScene] = buildWorkEntries([item()], [project({ systemDiagramId: 'not-a-scene' })])
    expect(withScene.sceneId).toBe('handoff-to-person')
    expect(unknownScene.sceneId).toBe('build-in-layers')
  })

  it('keeps only non-empty outcome statements', () => {
    const [entry] = buildWorkEntries([item()], [project({ outcomeStatements: ['One', '', '  '] })])
    expect(entry.outcomes).toEqual(['One'])
  })
})

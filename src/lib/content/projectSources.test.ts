import { describe, expect, it } from 'vitest'
import { mergeProjectSources, shouldAppendStaticProjects } from './projectSources'

const staticItems = [
  { id: 'a', title: 'A (static)', galleryImages: [{ url: 'static-a.png' }] },
  { id: 'b', title: 'B (static only)' },
]

describe('mergeProjectSources (CMS-02)', () => {
  it('uses only D1 projects when D1 is the source of truth', () => {
    const merged = mergeProjectSources([{ id: 'a', title: 'A (d1)' }], staticItems, { appendStatic: false })
    expect(merged.map((project) => project.id)).toEqual(['a'])
  })

  it('a project deleted in the admin does not reappear from the static file', () => {
    expect(mergeProjectSources([{ id: 'a', title: 'A' }], staticItems, { appendStatic: false }).some((p) => p.id === 'b')).toBe(false)
  })

  it('still borrows the bundled screenshots for a D1 project that has none', () => {
    const [project] = mergeProjectSources([{ id: 'a', title: 'A (d1)' }], staticItems, { appendStatic: false })
    expect(project.galleryImages).toEqual([{ url: 'static-a.png' }])
    expect(project.title).toBe('A (d1)')
  })

  it('appends static-only projects in the legacy mode', () => {
    const merged = mergeProjectSources([{ id: 'a', title: 'A' }], staticItems, { appendStatic: true })
    expect(merged.map((project) => project.id)).toEqual(['a', 'b'])
  })
})

describe('shouldAppendStaticProjects', () => {
  it('is on only when PROJECTS_STATIC_MERGE is exactly "true"', () => {
    expect(shouldAppendStaticProjects({ PROJECTS_STATIC_MERGE: 'true' })).toBe(true)
    for (const value of [undefined, 'false', '1', 'TRUE', '']) {
      expect(shouldAppendStaticProjects({ PROJECTS_STATIC_MERGE: value })).toBe(false)
    }
  })
})

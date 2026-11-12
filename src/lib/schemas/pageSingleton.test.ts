import { describe, expect, it } from 'vitest'
import { PAGE_SLUGS, PAGE_STATUSES, pageSingletonSchema } from './singletons'
import { PUBLIC_SURFACES } from '../../config/publicSurfaces.js'

const minimalPage = (slug: string, status = 'draft') => ({ slug, title: 'Title', status, blocks: [] })

describe('pageSingletonSchema (CMS-01)', () => {
  it('accepts every page the admin page builder edits', () => {
    const builderSlugs = PUBLIC_SURFACES
      .filter((surface) => surface.adminPath.startsWith('/admin/pages/'))
      .map((surface) => surface.key)
    expect(builderSlugs.length).toBeGreaterThanOrEqual(7)
    for (const slug of builderSlugs) {
      expect(PAGE_SLUGS, `${slug} is editable in the admin but rejected on save`).toContain(slug)
      expect(pageSingletonSchema.safeParse(minimalPage(slug)).success).toBe(true)
    }
  })

  it('saves the Solutions and Insights pages (they could not be saved before)', () => {
    expect(pageSingletonSchema.safeParse(minimalPage('solutions')).success).toBe(true)
    expect(pageSingletonSchema.safeParse(minimalPage('insights')).success).toBe(true)
  })

  it('still refuses an unknown slug', () => {
    expect(pageSingletonSchema.safeParse(minimalPage('admin')).success).toBe(false)
  })

  it('offers only the statuses the pages table accepts (no archived)', () => {
    expect([...PAGE_STATUSES]).toEqual(['draft', 'published'])
    expect(pageSingletonSchema.safeParse(minimalPage('home', 'archived')).success).toBe(false)
  })
})

describe('code-composed pages (2.4.0)', () => {
  it('flags every page whose public copy no longer comes from its blocks, and only those', () => {
    const composed = PUBLIC_SURFACES.filter((surface) => surface.codeComposed).map((surface) => surface.key).sort()
    expect(composed).toEqual(['about', 'contact', 'home', 'insights', 'process', 'solutions'])
  })
})

import { describe, expect, it } from 'vitest'
import { normalizeStatus as contentStatus } from './content.js'
import { normalizeStatus as pageStatus } from './pages.js'
import { toDbProject } from './projects.js'

// Tables created in migrations/0001 accept only 'draft' and 'published'. The
// shared item schema also allows 'archived' (valid for testimonials,
// certifications and case studies), and these repositories used to store it
// as PUBLISHED -- archiving a project or a service through the API made it
// public. 'archived' means "not public": it must become a draft.
describe.each([
  ['content.js (services, FAQs, experiences, skills, tools, workflow items)', contentStatus],
  ['pages.js (pages, page sections)', pageStatus],
  ['projects.js', (status) => toDbProject({ id: 'p1', title: 'P', status }).status],
])('%s status normalization', (_name, normalize) => {
  it('stores archived as draft, never as published', () => {
    expect(normalize('archived')).toBe('draft')
  })

  it('keeps draft and published', () => {
    expect(normalize('draft')).toBe('draft')
    expect(normalize('published')).toBe('published')
  })

  it('only ever produces a value the table CHECK accepts', () => {
    for (const value of ['draft', 'published', 'archived', undefined, '', 'PUBLISHED']) {
      expect(['draft', 'published']).toContain(normalize(value))
    }
  })
})

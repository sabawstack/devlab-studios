import { describe, expect, it } from 'vitest'
import { resourcesContent } from '../resourcesContent.js'
import { ARTICLE_AUDIENCE_IDS, PROBLEM_TAG_IDS } from '../../config/problemTags.js'

// SEO-08: every article is organised by the problem it addresses and who it
// is for; the generic AI updates are for a technical reader.
describe('article tags', () => {
  it.each(resourcesContent.posts.map((post) => [post.slug, post]))('%s has a registered problem tag and audience', (_slug, post) => {
    expect(PROBLEM_TAG_IDS).toContain(post.problemTag)
    expect(ARTICLE_AUDIENCE_IDS).toContain(post.audience)
  })

  it('marks the AI news posts as technical', () => {
    const aiUpdates = resourcesContent.posts.filter((post) => post.category === 'AI Updates')
    expect(aiUpdates.length).toBeGreaterThanOrEqual(5)
    for (const post of aiUpdates) expect(post.audience).toBe('technical')
  })
})

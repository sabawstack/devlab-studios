import { describe, expect, it } from 'vitest'
import { seoContent } from '../../data/seoContent.js'
import { PUBLIC_ROUTES, seoSlugForPath } from '../../config/publicRoutes'

/**
 * The alignment guard.
 *
 * `loadPageSeo` falls back to the static file whenever the CMS has no row for a
 * slug. That is the right runtime behaviour — a missing record should never
 * blank a page's metadata — but it also means a slug can drift out of sync and
 * nothing anywhere fails. Two pages had drifted: the Solutions record was keyed
 * 'solutions' while the page asked for 'services', and the Insights record was
 * misspelled 'insigths'. Both screens accepted edits and discarded them.
 *
 * The static file is the fallback of last resort, so if a published route is
 * missing from it, that route has no guaranteed metadata at all.
 */
describe('SEO coverage', () => {
  const knownSlugs = new Set(seoContent.pages.map((page: { pageSlug: string }) => page.pageSlug))

  it.each(PUBLIC_ROUTES.map((entry) => entry.path))(
    'every canonical route in the sitemap has a static SEO record: %s',
    (path) => {
      expect(knownSlugs.has(seoSlugForPath(path))).toBe(true)
    },
  )

  it('keys the homepage as "home" rather than an empty string', () => {
    expect(seoSlugForPath('/')).toBe('home')
  })

  it('keeps nested routes fully qualified, so /insights/daily cannot collide with /insights', () => {
    expect(seoSlugForPath('/insights/daily')).toBe('insights/daily')
    expect(seoSlugForPath('/insights')).toBe('insights')
  })

  it('uses a route\'s explicit seoSlug where the record is not keyed by its path', () => {
    expect(seoSlugForPath('/pickleball/how-it-works')).toBe('pickleball-how-it-works')
    expect(seoSlugForPath('/pickleball/rotation')).toBe('pickleball-rotation')
  })

  it('declares no canonical URL that points somewhere other than its own route', () => {
    for (const path of PUBLIC_ROUTES.map((entry) => entry.path)) {
      const record = seoContent.pages.find(
        (page: { pageSlug: string }) => page.pageSlug === seoSlugForPath(path),
      ) as { canonicalUrl?: string } | undefined

      if (!record?.canonicalUrl) continue
      expect(new URL(record.canonicalUrl).pathname.replace(/\/$/, '') || '/').toBe(path)
    }
  })
})

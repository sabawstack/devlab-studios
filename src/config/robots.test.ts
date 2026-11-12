import { describe, expect, it } from 'vitest'
import { isNoindexPath, robotsDirectiveFor } from './robots'
import { PUBLIC_ROUTES } from './publicRoutes'

describe('robots directives (WEB-02 / SEO-06)', () => {
  it('keeps the low-value pages out of search but followed', () => {
    for (const path of ['/insights/daily', '/offers/lead-intake-checklist', '/crawler', '/maintenance', '/landing-sample-react']) {
      expect(robotsDirectiveFor(path), path).toBe('noindex, follow')
    }
  })

  it('indexes the business pages and articles', () => {
    for (const path of ['/', '/solutions', '/work', '/insights', '/insights/the-cost-of-a-silent-failure', '/about', '/profile', '/contact']) {
      expect(robotsDirectiveFor(path), path).toBe('index, follow')
    }
  })

  it('lists no noindex page in the sitemap routes', () => {
    for (const route of PUBLIC_ROUTES) expect(isNoindexPath(route.path), route.path).toBe(false)
  })
})

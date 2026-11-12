/**
 * The canonical, indexable routes this site publishes.
 *
 * One list, consumed by the generated sitemap and by the SEO coverage test.
 * It lives here rather than inside `sitemap.xml.ts` so it can be imported
 * without dragging in the Worker-only `cloudflare:workers` env binding.
 *
 * Excluded on purpose: admin routes, API routes, redirect sources such as
 * `/services`, and the landing samples (which are `noindex, follow`).
 */
export interface PublicRoute {
  path: string
  changefreq: string
  priority: string
  /** Set only where the SEO record's slug is not derived from the path (the pickleball pages use hyphens). */
  seoSlug?: string
}

export const PUBLIC_ROUTES: PublicRoute[] = [
  { path: '/', changefreq: 'weekly', priority: '1.0' },
  { path: '/solutions', changefreq: 'monthly', priority: '0.9' },
  { path: '/work', changefreq: 'monthly', priority: '0.9' },
  { path: '/insights', changefreq: 'weekly', priority: '0.8' },
  // /insights/daily is deliberately absent: it stays reachable from the
  // Insights footer but is noindex (SEO-06, src/config/robots.ts).
  { path: '/about', changefreq: 'monthly', priority: '0.8' },
  { path: '/profile', changefreq: 'monthly', priority: '0.8' },
  { path: '/contact', changefreq: 'monthly', priority: '0.8' },
  { path: '/process', changefreq: 'monthly', priority: '0.6' },
  // The free product sits below the business pages (SEO-07: 0.3-0.4).
  { path: '/pickleball', changefreq: 'monthly', priority: '0.4' },
  { path: '/pickleball/how-it-works', changefreq: 'monthly', priority: '0.3', seoSlug: 'pickleball-how-it-works' },
  { path: '/pickleball/rotation', changefreq: 'monthly', priority: '0.3', seoSlug: 'pickleball-rotation' },
  { path: '/pickleball/new', changefreq: 'monthly', priority: '0.4', seoSlug: 'pickleball-new' },
  { path: '/privacy', changefreq: 'yearly', priority: '0.3' },
  { path: '/terms', changefreq: 'yearly', priority: '0.3' },
]

/** Route path -> the `pageSlug` its SEO record is keyed by. */
export function seoSlugForPath(path: string): string {
  const override = PUBLIC_ROUTES.find((route) => route.path === path)?.seoSlug
  if (override) return override
  return path === '/' ? 'home' : path.replace(/^\//, '')
}

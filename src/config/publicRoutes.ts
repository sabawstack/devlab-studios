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
  // One permanent URL whose dated sections change every day — hence `daily`
  // here and a single entry rather than one per edition.
  { path: '/insights/daily', changefreq: 'daily', priority: '0.6' },
  { path: '/about', changefreq: 'monthly', priority: '0.8' },
  { path: '/profile', changefreq: 'monthly', priority: '0.8' },
  { path: '/contact', changefreq: 'monthly', priority: '0.8' },
  { path: '/process', changefreq: 'monthly', priority: '0.6' },
  { path: '/pickleball', changefreq: 'monthly', priority: '0.6' },
  { path: '/pickleball/how-it-works', changefreq: 'monthly', priority: '0.5', seoSlug: 'pickleball-how-it-works' },
  { path: '/pickleball/rotation', changefreq: 'monthly', priority: '0.5', seoSlug: 'pickleball-rotation' },
  { path: '/pickleball/new', changefreq: 'monthly', priority: '0.6', seoSlug: 'pickleball-new' },
  { path: '/privacy', changefreq: 'yearly', priority: '0.3' },
  { path: '/terms', changefreq: 'yearly', priority: '0.3' },
]

/** Route path -> the `pageSlug` its SEO record is keyed by. */
export function seoSlugForPath(path: string): string {
  const override = PUBLIC_ROUTES.find((route) => route.path === path)?.seoSlug
  if (override) return override
  return path === '/' ? 'home' : path.replace(/^\//, '')
}

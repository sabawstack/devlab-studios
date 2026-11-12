import type { APIRoute } from 'astro'
import { loadArticlesContent } from '../lib/content/articles'
import { PUBLIC_ROUTES } from '../config/publicRoutes'
import { loadWorkEntries } from '../lib/content/work'

export const prerender = false

/**
 * Generated sitemap, replacing the hand-maintained public/sitemap.xml.
 *
 * The static file had drifted badly: it still listed `/resources/*` URLs that
 * are permanent redirects into `/insights/*`, and omitted `/work` and `/pickleball`
 * entirely. A sitemap of redirects is worse than no sitemap,
 * because it spends crawl budget confirming the same 301s.
 *
 * Only canonical, indexable URLs are listed here: no admin routes, no API
 * routes, no redirect sources, and no landing samples (which are
 * `noindex, follow` via applySecurityHeaders).
 */
const SITE = 'https://www.devlabstudios.com'

interface SitemapEntry {
  path: string
  changefreq: string
  priority: string
  lastmod?: string
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function toUrlElement(entry: SitemapEntry): string {
  return [
    '  <url>',
    `    <loc>${escapeXml(`${SITE}${entry.path}`)}</loc>`,
    entry.lastmod ? `    <lastmod>${escapeXml(entry.lastmod)}</lastmod>` : null,
    `    <changefreq>${entry.changefreq}</changefreq>`,
    `    <priority>${entry.priority}</priority>`,
    '  </url>',
  ]
    .filter(Boolean)
    .join('\n')
}

/** Only an ISO date survives; anything unparseable is omitted rather than guessed. */
function toLastmod(value: string | undefined): string | undefined {
  if (!value) return undefined
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString().slice(0, 10)
}

export const GET: APIRoute = async () => {
  const { posts } = await loadArticlesContent()

  const articleEntries: SitemapEntry[] = posts
    .filter((post) => post.status !== 'draft' && post.slug)
    .map((post) => ({
      path: `/insights/${post.slug}`,
      changefreq: 'monthly',
      priority: '0.7',
      // When the article last changed, falling back to when it was published.
      lastmod: toLastmod((post as { updatedAt?: string }).updatedAt || post.publishedAt),
    }))

  const workEntries: SitemapEntry[] = (await loadWorkEntries()).map((entry) => ({
    path: `/work/${entry.slug}`,
    changefreq: 'monthly',
    priority: '0.7',
  }))

  // Offer landing pages are noindex (SEO-06), so they are not listed.

  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...[...PUBLIC_ROUTES, ...workEntries, ...articleEntries].map(toUrlElement),
    '</urlset>',
  ].join('\n')

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}

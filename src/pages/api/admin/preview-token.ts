import type { APIRoute } from 'astro'
import { getEnv } from '../../../lib/env'
import { jsonResponse } from '../../../lib/http'
import { withAdmin } from '../../../lib/adminGuard'
import { createPreviewToken, PREVIEW_TOKEN_TTL_SECONDS } from '../../../lib/previewToken'
import { PAGE_SLUGS } from '../../../lib/schemas/singletons'
import { PUBLIC_SURFACES } from '../../../config/publicSurfaces.js'

export const prerender = false

const ARTICLE_SLUG = /^[a-z0-9][a-z0-9-]{0,120}$/

/**
 * Issues a one-hour draft-preview link for one page or article (audit CMS-04).
 * GET ?type=page&id=home  or  ?type=article&id=<slug>
 * The link is only as powerful as "see this one draft for an hour": it is not
 * a session and opens nothing else (src/lib/previewToken.ts).
 */
const unguardedGET: APIRoute = async ({ url }) => {
  const type = url.searchParams.get('type')
  const id = String(url.searchParams.get('id') || '').trim()

  let path: string | null = null
  if (type === 'page' && (PAGE_SLUGS as readonly string[]).includes(id)) {
    path = PUBLIC_SURFACES.find((surface) => surface.key === id)?.publicPath ?? null
  } else if (type === 'article' && ARTICLE_SLUG.test(id)) {
    path = `/insights/${id}`
  }
  if (!path) return jsonResponse({ error: 'Unknown page or article.' }, 400)

  const secret = String(getEnv().ADMIN_SESSION_SECRET || '').trim()
  if (!secret) return jsonResponse({ error: 'Preview links need ADMIN_SESSION_SECRET.' }, 503)

  const now = new Date()
  const token = await createPreviewToken(secret, { type: type as 'page' | 'article', id }, now)
  return jsonResponse({
    url: `${path}?preview=${encodeURIComponent(token)}`,
    expiresAt: new Date(now.getTime() + PREVIEW_TOKEN_TTL_SECONDS * 1000).toISOString(),
  }, 200, { 'Cache-Control': 'no-store' })
}

// Authenticated per handler as well as by src/middleware.ts; see src/lib/adminGuard.ts.
export const GET = withAdmin(unguardedGET)

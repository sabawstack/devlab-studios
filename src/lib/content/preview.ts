import type { AstroGlobal } from 'astro'
import { getEnv } from '../env'
import { verifyPreviewToken, type PreviewTarget } from '../previewToken'

/**
 * Whether this request may see `target`'s draft (audit CMS-04): true only for
 * a valid, unexpired `?preview=` token issued for exactly this page/article.
 *
 * Any request that carries a `preview` parameter, valid or not, is answered
 * `no-store` and `noindex`, so a draft can never be cached (OPS-01) or indexed.
 */
export async function draftPreviewFor(Astro: AstroGlobal, target: PreviewTarget): Promise<boolean> {
  const token = Astro.url.searchParams.get('preview')
  if (token === null) return false
  Astro.response.headers.set('Cache-Control', 'no-store, private')
  Astro.response.headers.set('X-Robots-Tag', 'noindex, nofollow')
  const secret = String(getEnv().ADMIN_SESSION_SECRET || '').trim()
  return verifyPreviewToken(token, secret, target)
}

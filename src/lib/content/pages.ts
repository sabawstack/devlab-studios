import { getPage } from '../../worker/repositories/pages.js'
import { getEnv } from '../env'
import { privacyPage } from '../../data/pages/privacy'
import { termsPage } from '../../data/pages/terms'
import { processPage } from '../../data/pages/process'
import { workPage } from '../../data/pages/work'
import { sanitizeLinkFields } from '../safeHref'

export interface PageBlock {
  type: string
  props: Record<string, unknown>
}

export interface PageData {
  slug: string
  title: string
  status: string
  blocks: PageBlock[]
}

const STATIC_PAGES: Record<string, PageData> = {
  privacy: privacyPage,
  terms: termsPage,
  process: processPage,
  work: workPage,
}

/**
 * Block-composed singleton pages (Home, About, Process, Work) and the
 * single-richText-block legal pages (Privacy, Terms) share this loader —
 * D1 first, falling back to bundled static content so these pages render
 * correctly before an editor has ever saved them through the admin.
 */
export async function loadPage(slug: string): Promise<PageData | null> {
  const fallback = STATIC_PAGES[slug] || null
  const env = getEnv()
  if (!env.DB) return fallback

  try {
    // Block CTA hrefs re-checked at read time; see src/lib/safeHref.ts.
    const data = sanitizeLinkFields(await getPage(env.DB, slug, { includeDrafts: false }))
    if (!data?.blocks?.length) return fallback
    return data
  } catch {
    return fallback
  }
}

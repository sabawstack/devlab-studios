import { getSiteSettingsContent } from '../../worker/repositories/content.js'
import { siteSettingsContent } from '../../data/siteSettingsContent.js'
import { getEnv } from '../env'
import { sanitizeLinkFields } from '../safeHref'

const canonicalTagline = 'Your Vision, Digitally Crafted — one solution at a time, always evolving.'

function sanitizeFooterTagline(tagline?: string): string {
  const value = String(tagline || '').trim()
  if (!value || /^(?:smoke test|version history) tagline\b/i.test(value)) return canonicalTagline
  return value.replace(' - ', ' — ')
}

export interface SiteSettingsData {
  navigation: Array<{ label: string; href: string }>
  ctas: { navbarContactLabel?: string; mobileContactLabel?: string }
  footer: {
    companyName?: string
    tagline?: string
    email?: string
    location?: string
    copyright?: string
    legalLinks?: Array<{ label: string; href: string }>
    quickLinks?: Array<{ label: string; href: string }>
    socialLinks?: Array<{ label: string; href: string }>
  }
}

/**
 * Server-side equivalent of the old useSiteSettingsContent() client hook —
 * queries D1 directly during render instead of shipping static content
 * then re-fetching in the browser. Falls back to the same static data the
 * client hook used if D1 is unconfigured or the query fails.
 */
export async function loadSiteSettings(): Promise<SiteSettingsData> {
  const env = getEnv()
  if (!env.DB) return siteSettingsContent

  try {
    // D1 content is sanitised again here, not only validated on save: a row
    // that predates the link-scheme rule must still render inert.
    const data = sanitizeLinkFields(await getSiteSettingsContent(env.DB))
    if (!data) return siteSettingsContent

    const footer = (data.footer || {}) as SiteSettingsData['footer']
    return {
      navigation: data.navigation?.length ? data.navigation : siteSettingsContent.navigation,
      ctas: { ...siteSettingsContent.ctas, ...(data.ctas || {}) },
      footer: {
        ...siteSettingsContent.footer,
        ...footer,
        tagline: sanitizeFooterTagline(footer.tagline),
        quickLinks: footer.quickLinks?.length ? footer.quickLinks : siteSettingsContent.footer.quickLinks,
        socialLinks: footer.socialLinks?.length ? footer.socialLinks : siteSettingsContent.footer.socialLinks,
        legalLinks: footer.legalLinks?.length ? footer.legalLinks : siteSettingsContent.footer.legalLinks,
      },
    }
  } catch {
    return siteSettingsContent
  }
}

/**
 * The public identity of the business, in one place (audit BUS-05 / SEO-04).
 *
 * Every public contact point, the footer identity, the legal pages and the
 * structured data read from here, so they cannot disagree. Personal contact
 * details (a personal mailbox, a phone number, a street address, a date of
 * birth) are deliberately absent: they never appear on a public page.
 */
export const COMPANY = {
  name: 'DevLab Studios',
  url: 'https://www.devlabstudios.com',
  /** The single public business address (routed by Cloudflare Email Routing). */
  publicEmail: 'hello@devlabstudios.com',
  /** City-level only. */
  location: { locality: 'Lapu-Lapu City', region: 'Cebu', country: 'Philippines', countryCode: 'PH' },
  locationLabel: 'Lapu-Lapu City, Cebu, Philippines',
  /** One line for the footer identity. */
  description: 'Software, integrations and workflow automation for businesses that need their operations to hold up.',
  /** The footer's closing line: one person accountable for the system in production. */
  footerSignOff: 'Systems architected, engineered, and maintained end-to-end by Stephen Rey Agustinez.',
  /** Retired portfolio-era tagline: treated as unset wherever a stored copy still carries it. */
  legacyTagline: 'Your Vision, Digitally Crafted — one solution at a time, always evolving.',
  foundingDate: '2026-03-02',
  /** Used by the privacy and terms pages until the owner supplies a registered legal name (audit N5). */
  operatorStatement: 'DevLab Studios, operated by Stephen Rey Agustinez, Lapu-Lapu City, Cebu, Philippines',
  founder: { name: 'Stephen Rey G. Agustinez', profilePath: '/profile' },
  logo: 'https://www.devlabstudios.com/devlabstudios-logo-only.png',
  sameAs: [
    'https://www.linkedin.com/in/stephen-rey-agustinez-8b86041b3',
    'https://github.com/stpn-dev',
  ],
}

/** Stable JSON-LD node ids, so pages reference one Organization and one Person instead of repeating them. */
export const ORGANIZATION_ID = `${COMPANY.url}/#organization`
export const PERSON_ID = `${COMPANY.url}/profile#person`

/** Mail domains that indicate a personal mailbox rather than the business address. */
const PERSONAL_MAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com'])

/**
 * The address to show publicly for a stored contact value: the stored one if
 * it is a business address, otherwise the public business address. Guards the
 * public pages against a personal mailbox stored in CMS content.
 */
export function publicContactEmail(stored) {
  const value = String(stored || '').trim().toLowerCase()
  const domain = value.split('@')[1] || ''
  if (!value || !domain || PERSONAL_MAIL_DOMAINS.has(domain)) return COMPANY.publicEmail
  return value
}

const PERSONAL_MAILBOX = /[A-Za-z0-9._%+-]+@(?:gmail|googlemail|yahoo|outlook|hotmail|icloud)\.com\b/gi

/**
 * Replaces any personal mailbox in stored text with the public business
 * address, recursively through arrays and objects. A privacy rule applied on
 * the public read path (pages, footer, profile), so older CMS content cannot
 * publish a personal address.
 */
export function scrubPersonalContacts(value) {
  if (typeof value === 'string') return value.replace(PERSONAL_MAILBOX, COMPANY.publicEmail)
  if (Array.isArray(value)) return value.map(scrubPersonalContacts)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, scrubPersonalContacts(entry)]))
  }
  return value
}

/**
 * Markets with completed work, named on the site and in structured data
 * (BUS-04; owner decision Q-07, 2026-11-13). Change here, and About and the
 * schema follow.
 */
export const MARKETS = ['Philippines', 'United States', 'Australia']

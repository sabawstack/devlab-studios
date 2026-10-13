/**
 * Canonical domain and URL normalization.
 *
 * This is the dedupe foundation: `lead_companies.canonical_domain` is UNIQUE,
 * so whether two discovery sources produce one company or two is decided
 * entirely by the functions in this file. Getting it wrong in the permissive
 * direction crawls the same business twice and may email it twice; getting it
 * wrong in the strict direction merges two unrelated businesses onto one
 * record. Both are covered by tests in domains.test.js.
 *
 * NO public-suffix list. A full PSL is ~250KB of data that would have to be
 * bundled into the Worker and kept current, to serve a rule that matters only
 * for multi-part TLDs. Instead, MULTI_PART_TLDS below enumerates the ones that
 * actually occur in the target markets (US and PH), and anything else falls
 * back to last-two-labels. The failure mode of an unlisted multi-part TLD is a
 * canonical domain one label too short — which over-merges — so the list is
 * deliberately generous rather than minimal.
 */

/**
 * Second-level domains under which registrations are made, so the registrable
 * domain is three labels rather than two.
 */
const MULTI_PART_TLDS = new Set([
  // Philippines — the secondary target market.
  'com.ph', 'net.ph', 'org.ph', 'edu.ph', 'gov.ph', 'ngo.ph', 'mil.ph', 'i.ph',
  // Commonly encountered elsewhere; harmless to recognize.
  'co.uk', 'org.uk', 'me.uk', 'ltd.uk', 'plc.uk', 'net.uk', 'sch.uk', 'ac.uk', 'gov.uk',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au', 'asn.au', 'id.au',
  'co.nz', 'net.nz', 'org.nz',
  'com.sg', 'net.sg', 'org.sg', 'edu.sg', 'gov.sg',
  'co.jp', 'or.jp', 'ne.jp', 'ac.jp', 'go.jp',
  'com.br', 'net.br', 'org.br',
  'com.mx', 'org.mx', 'net.mx',
  'co.in', 'net.in', 'org.in', 'gen.in', 'firm.in', 'ind.in',
  'com.hk', 'org.hk', 'net.hk',
  'co.za', 'org.za', 'net.za',
])

/**
 * Hosts that are never a company's own site. A discovery source listing a
 * Facebook page or a Linktree as "the website" must not create a company whose
 * canonical domain is facebook.com — that would merge every such business into
 * one record.
 */
const NON_COMPANY_HOSTS = new Set([
  'facebook.com', 'm.facebook.com', 'fb.com', 'fb.me',
  'instagram.com', 'twitter.com', 'x.com', 'linkedin.com', 'tiktok.com',
  'youtube.com', 'youtu.be', 'pinterest.com', 'yelp.com', 'google.com',
  'maps.google.com', 'goo.gl', 'g.page', 'business.site',
  'linktr.ee', 'bit.ly', 'tinyurl.com', 'wa.me', 'api.whatsapp.com',
  'sites.google.com', 'wixsite.com', 'weebly.com', 'blogspot.com',
  'wordpress.com', 'squarespace.com', 'godaddysites.com',
])

/** Tracking parameters stripped during URL canonicalization. */
const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id',
  'gclid', 'gbraid', 'wbraid', 'fbclid', 'msclkid', 'mc_cid', 'mc_eid',
  'ref', 'referrer', 'source', '_ga', '_gl', 'yclid', 'igshid', 'ttclid',
])

/**
 * Splits a hostname into its registrable domain.
 *
 * @param {string} hostname already lowercased, punycode/IDN left as given
 * @returns {string}
 */
function registrableDomain(hostname) {
  const labels = hostname.split('.').filter(Boolean)
  if (labels.length <= 2) return labels.join('.')

  const lastTwo = labels.slice(-2).join('.')
  const take = MULTI_PART_TLDS.has(lastTwo) ? 3 : 2
  return labels.slice(-take).join('.')
}

/**
 * Parses a possibly-scheme-less, possibly-messy website string into a URL.
 *
 * Discovery sources supply all of `example.com`, `www.example.com/`,
 * `HTTP://Example.com`, and `example.com/contact?utm_source=x`. Returns null
 * rather than throwing for anything unparseable, because a bad website string
 * in a directory listing is an ordinary data-quality outcome, not an error.
 *
 * @param {unknown} value
 * @returns {URL|null}
 */
export function parseWebsite(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return null

  // A bare host has no scheme; assume https, which is also what we would
  // request first anyway.
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`

  let url
  try {
    url = new URL(withScheme)
  } catch {
    return null
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (!url.hostname || !url.hostname.includes('.')) return null
  // A hostname of digits and dots is a bare IP. The crawler's SSRF guard would
  // reject a private one anyway, but a public IP is equally not a business
  // website we can canonicalize.
  if (/^[\d.]+$/.test(url.hostname)) return null

  return url
}

/**
 * The company identity key.
 *
 * @param {unknown} value a website URL or bare hostname
 * @returns {string|null} lowercased registrable domain, or null when the value
 *   is unparseable or points at a host that cannot identify a company
 */
export function canonicalDomain(value) {
  const url = parseWebsite(value)
  if (!url) return null

  const hostname = url.hostname.toLowerCase().replace(/\.$/, '')
  const registrable = registrableDomain(hostname)

  if (!registrable || !registrable.includes('.')) return null
  if (NON_COMPANY_HOSTS.has(registrable) || NON_COMPANY_HOSTS.has(hostname)) return null

  return registrable
}

/** @param {unknown} value */
export function isNonCompanyHost(value) {
  const url = parseWebsite(value)
  if (!url) return false
  const hostname = url.hostname.toLowerCase()
  return NON_COMPANY_HOSTS.has(hostname) || NON_COMPANY_HOSTS.has(registrableDomain(hostname))
}

/**
 * A stable URL string for crawl dedupe and for `lead_signals.source_url`.
 *
 * Two URLs that fetch the same page must produce the same string, or the
 * crawler spends its four-page budget fetching one page four times. Strips the
 * fragment (never sent to the server), tracking parameters, the default port,
 * a trailing slash on a non-root path, and sorts the remaining query
 * parameters.
 *
 * Case is preserved in the path — unlike the host, paths are case-sensitive on
 * most servers, and lowercasing them would break a real URL.
 *
 * @param {unknown} value
 * @returns {string|null}
 */
export function canonicalizeUrl(value) {
  const url = parseWebsite(value)
  if (!url) return null

  url.hostname = url.hostname.toLowerCase().replace(/\.$/, '')
  url.hash = ''
  url.username = ''
  url.password = ''

  if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) {
    url.port = ''
  }

  const params = [...url.searchParams.entries()]
    .filter(([key]) => !TRACKING_PARAMS.has(key.toLowerCase()))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))

  url.search = ''
  for (const [key, paramValue] of params) url.searchParams.append(key, paramValue)

  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.replace(/\/+$/, '')
  }

  return url.toString()
}

/**
 * True when two URLs belong to the same site for crawling purposes.
 *
 * Registrable-domain comparison rather than exact hostname, so a link from
 * `example.com` to `www.example.com` — or to `booking.example.com` — is
 * correctly treated as the same site and followed.
 *
 * @param {unknown} a
 * @param {unknown} b
 */
export function isSameSite(a, b) {
  const left = canonicalDomain(a)
  const right = canonicalDomain(b)
  return Boolean(left) && left === right
}

/**
 * Normalizes a company name for fuzzy comparison.
 *
 * Used ONLY as corroborating evidence when two sources supply the same domain —
 * never as a dedupe key on its own. Two property managers in different states
 * can share a name; they do not share a domain.
 *
 * @param {unknown} value
 */
export function normalizeCompanyName(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/\b(inc|llc|l\.l\.c|ltd|limited|corp|corporation|co|company|group|holdings|pllc|plc|pty|gmbh)\b\.?/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

/**
 * Normalizes an email address for comparison and suppression lookup.
 *
 * Lowercases the whole address, including the local part. RFC 5321 says the
 * local part is case-sensitive, but no mail provider in practice treats it that
 * way — and for SUPPRESSION the permissive reading is the correct one: if
 * someone at `Info@example.com` asks not to be contacted, `info@example.com`
 * must be suppressed too.
 *
 * @param {unknown} value
 * @returns {string|null}
 */
export function normalizeEmail(value) {
  const raw = String(value ?? '').trim().toLowerCase()
  if (!raw) return null

  // Strip a display name: "Jane Doe <jane@example.com>".
  const angled = raw.match(/<([^>]+)>\s*$/)
  const address = angled ? angled[1].trim() : raw

  const atIndex = address.lastIndexOf('@')
  if (atIndex <= 0 || atIndex === address.length - 1) return null
  if (/\s/.test(address)) return null

  const domain = address.slice(atIndex + 1)
  if (!domain.includes('.') || domain.startsWith('.') || domain.endsWith('.')) return null

  return address
}

/**
 * The address a message may be ADDRESSED to — stricter than `normalizeEmail`.
 *
 * `normalizeEmail` is deliberately permissive because it is used for
 * comparison and suppression lookup, where reading more addresses as valid is
 * the safe direction. Building a recipient is the opposite case: `a@x.com,b@y.com`
 * passes the permissive check (it only looks at the LAST `@` and at
 * whitespace), and a transmitter that hands that string to `RCPT TO` or a
 * `To:` header mails two people. So a recipient must be one plain
 * `local@domain`: dot-atom local part, LDH domain labels, nothing else — no
 * commas, semicolons, quotes, angle brackets, a second `@`, or control
 * characters.
 *
 * @param {unknown} value
 * @returns {string|null} the normalized address, or null if it is not exactly one plain address
 */
export function strictRecipient(value) {
  const address = normalizeEmail(value)
  if (!address || address.length > 254) return null

  const atIndex = address.indexOf('@')
  if (atIndex !== address.lastIndexOf('@')) return null

  const local = address.slice(0, atIndex)
  const domain = address.slice(atIndex + 1)
  if (local.length > 64) return null
  if (!/^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/.test(local)) return null

  const labels = domain.split('.')
  if (labels.length < 2) return null
  if (!labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return null
  if (!/^[a-z]{2,63}$|^xn--[a-z0-9-]{1,59}$/.test(labels[labels.length - 1])) return null

  return address
}

/** The domain part of a normalized address, for domain-scoped suppression. */
export function emailDomain(value) {
  const normalized = normalizeEmail(value)
  if (!normalized) return null
  return normalized.slice(normalized.lastIndexOf('@') + 1)
}

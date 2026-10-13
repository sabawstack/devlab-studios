/**
 * The one URL-scheme policy for every link a CMS editor can set.
 *
 * Astro escapes attribute values but does not filter URL schemes, and the CSP
 * allows inline script, so a stored `javascript:` href is script execution on
 * every public page that renders it. This is applied twice on purpose: the Zod
 * schemas refuse an unsafe link at save time, and the public read path / the
 * Navbar and Footer pass every CMS href through `safeHref` again, so a row that
 * predates the schema rule (or was written straight to D1) still cannot reach
 * the page as a live link.
 *
 * Allowed: empty, same-site relative paths ("/x", not "//host" or "/\host",
 * which browsers treat as another host), "#anchors", "?query", and the
 * absolute schemes http:, https:, mailto:, tel:. Everything else -- including
 * javascript:, data:, vbscript:, file: and bare relative words that a browser
 * might read as a scheme -- is refused.
 */

const SAFE_SCHEME = /^(?:https?|mailto|tel):/i

/** What a browser actually parses: tabs/newlines are stripped anywhere, C0 controls and spaces trimmed at the ends. */
function browserNormalised(value: string): string {
  return value.replace(/[\t\n\r]/g, '').replace(/^[\u0000- ]+|[\u0000- ]+$/g, '')
}

export function isSafeHref(value: unknown): boolean {
  if (value === undefined || value === null) return true
  if (typeof value !== 'string') return false

  const href = browserNormalised(value)
  if (href === '') return true
  if (href.startsWith('#') || href.startsWith('?')) return true
  // WHATWG parsing treats "\" like "/", so "/\evil.com" is as
  // protocol-relative as "//evil.com".
  if (href.startsWith('/')) return !(href.startsWith('//') || href.startsWith('/\\'))
  return SAFE_SCHEME.test(href)
}

/** The href to actually render: the value when it is safe, otherwise `fallback`. */
export function safeHref(value: unknown, fallback = '#'): string {
  if (typeof value !== 'string') return fallback
  return isSafeHref(value) ? value.trim() : fallback
}

export const UNSAFE_HREF_MESSAGE =
  'Links must be a relative path starting with "/", a "#anchor", or an http(s):, mailto: or tel: URL.'

/**
 * Field names that hold a clickable link anywhere in CMS content. Image
 * fields (imageUrl, photoUrl, ...) are deliberately absent: an <img src> never
 * executes a javascript: URL.
 */
export const LINK_FIELD_NAMES = new Set([
  'href',
  'liveUrl',
  'sourceUrl',
  'credentialUrl',
  'linkedinUrl',
  'githubUrl',
  'resumeUrl',
])

/**
 * Returns a copy of `value` with every unsafe link field (by name, at any
 * depth) replaced by "#". Used on the public read path so stored content that
 * slipped past validation still renders inert.
 */
export function sanitizeLinkFields<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => sanitizeLinkFields(item)) as unknown as T
  if (!value || typeof value !== 'object') return value

  const entries = Object.entries(value as Record<string, unknown>).map(([key, field]) => {
    if (LINK_FIELD_NAMES.has(key) && typeof field === 'string') return [key, safeHref(field)]
    return [key, sanitizeLinkFields(field)]
  })
  return Object.fromEntries(entries) as T
}

/** Paths (as Zod issue paths) of every unsafe link field inside `value`. */
export function findUnsafeLinkPaths(value: unknown, path: Array<string | number> = []): Array<Array<string | number>> {
  if (Array.isArray(value)) return value.flatMap((item, index) => findUnsafeLinkPaths(item, [...path, index]))
  if (!value || typeof value !== 'object') return []

  return Object.entries(value as Record<string, unknown>).flatMap(([key, field]) => {
    if (LINK_FIELD_NAMES.has(key) && typeof field === 'string') return isSafeHref(field) ? [] : [[...path, key]]
    return findUnsafeLinkPaths(field, [...path, key])
  })
}

/**
 * robots.txt parsing and evaluation.
 *
 * A deliberately conservative subset of the Robots Exclusion Protocol
 * (RFC 9309). Where the spec leaves latitude, this implementation takes the
 * restrictive reading — the crawler is a guest on someone else's server, and
 * the cost of skipping a page we were allowed to fetch is one missing signal,
 * while the cost of fetching a page we were told not to is a site operator
 * with a legitimate complaint.
 *
 * Specifically:
 *   - A group matching our user-agent token wins over `*`, per the spec.
 *   - An unreachable robots.txt is treated as ALLOWED (per the spec, a 4xx
 *     means no restrictions), but a 5xx or a network failure is treated as
 *     DISALLOWED, because a server that is failing is not a server to crawl.
 *   - Longest-match wins between a conflicting Allow and Disallow, with Allow
 *     winning ties. That is the spec's rule and also Google's behaviour.
 */

import { CRAWLER } from '../config/defaults.js'
import { isSameSite } from '../domain/domains.js'
import { readBounded } from './fetchPage.js'
import { checkRedirect, checkUrlSafety } from './ssrf.js'

/** Bytes of robots.txt read before the stream is abandoned. */
const ROBOTS_MAX_BYTES = 200_000

/** Our own token, matched case-insensitively against User-agent lines. */
const OUR_TOKEN = 'devlabresearchbot'

/**
 * Parses robots.txt into the rule groups that apply to us.
 *
 * @param {string} text
 * @param {string} [token]
 * @returns {{ rules: Array<{ allow: boolean, path: string }>, crawlDelay: number|null, matchedSpecificAgent: boolean }}
 */
export function parseRobots(text, token = OUR_TOKEN) {
  const lines = String(text || '').split(/\r?\n/)

  /** @type {Map<string, { rules: Array<{allow: boolean, path: string}>, crawlDelay: number|null }>} */
  const groups = new Map()
  /** User-agent lines accumulate until the first rule line, then start a new group. */
  let currentAgents = []
  let expectingAgents = true

  for (const rawLine of lines) {
    const line = rawLine.split('#')[0].trim()
    if (!line) continue

    const separator = line.indexOf(':')
    if (separator === -1) continue

    const field = line.slice(0, separator).trim().toLowerCase()
    const value = line.slice(separator + 1).trim()

    if (field === 'user-agent') {
      // Consecutive User-agent lines share one group; a User-agent line AFTER a
      // rule line begins a new group. Getting this wrong merges `*`'s rules
      // into a specific agent's group, which is how a crawler ends up ignoring
      // a Disallow that was meant for it.
      if (!expectingAgents) currentAgents = []
      expectingAgents = true
      currentAgents.push(value.toLowerCase())
      continue
    }

    if (currentAgents.length === 0) continue
    expectingAgents = false

    for (const agent of currentAgents) {
      if (!groups.has(agent)) groups.set(agent, { rules: [], crawlDelay: null })
      const group = groups.get(agent)

      if (field === 'disallow') {
        // An empty Disallow means "allow everything" and carries no path.
        if (value) group.rules.push({ allow: false, path: value })
      } else if (field === 'allow') {
        if (value) group.rules.push({ allow: true, path: value })
      } else if (field === 'crawl-delay') {
        const delay = Number(value)
        if (Number.isFinite(delay) && delay >= 0) group.crawlDelay = delay
      }
    }
  }

  // The most specific matching group wins; `*` is the fallback. A substring
  // match is correct here — robots.txt tokens are matched as a prefix of the
  // product token, so `DevLabResearchBot` in the file matches our
  // `DevLabResearchBot/1.0 (...)`.
  const specificKey = [...groups.keys()].find((agent) => agent !== '*' && token.includes(agent))
  const group = specificKey ? groups.get(specificKey) : groups.get('*')

  return {
    rules: group?.rules ?? [],
    crawlDelay: group?.crawlDelay ?? null,
    matchedSpecificAgent: Boolean(specificKey),
  }
}

/**
 * Matches a robots path pattern, including `*` wildcards and a `$` anchor.
 *
 * @param {string} pattern
 * @param {string} path
 */
function matchesPattern(pattern, path) {
  const anchored = pattern.endsWith('$')
  const body = anchored ? pattern.slice(0, -1) : pattern

  // Escape everything regex-significant EXCEPT `*`, which robots.txt defines as
  // "any sequence of characters".
  const escaped = body.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  const regex = new RegExp(`^${escaped}${anchored ? '$' : ''}`)
  return regex.test(path)
}

/**
 * Whether a path is allowed by a parsed rule set.
 *
 * Longest match wins; Allow wins a tie. Both are the spec's rules, and the tie
 * behaviour matters in practice because `Disallow: /` plus `Allow: /` is a
 * common way of saying "yes, crawl this".
 *
 * @param {{ rules: Array<{allow: boolean, path: string}> }} parsed
 * @param {string} path
 * @returns {boolean}
 */
export function isPathAllowed(parsed, path) {
  const normalized = path || '/'
  let best = null

  for (const rule of parsed.rules || []) {
    if (!matchesPattern(rule.path, normalized)) continue
    if (!best || rule.path.length > best.path.length || (rule.path.length === best.path.length && rule.allow)) {
      best = rule
    }
  }

  // No matching rule means allowed. That is the protocol's default, and it is
  // the only reading under which a robots.txt that mentions only other
  // crawlers does not accidentally block us.
  return best ? best.allow : true
}

/**
 * Fetches and evaluates robots.txt for an origin.
 *
 * Bounded like every other outbound request. Returns a small object the
 * crawler caches for the duration of a run — one robots.txt fetch per site, not
 * one per page.
 *
 * @param {string} origin e.g. "https://example.com"
 * @param {{ fetchImpl?: typeof fetch, userAgent?: string, timeoutMs?: number }} [options]
 * @returns {Promise<{ allowed: (path: string) => boolean, crawlDelayMs: number|null, status: string }>}
 */
export async function fetchRobots(origin, options = {}) {
  const fetchImpl = options.fetchImpl || fetch
  const userAgent = options.userAgent || CRAWLER.userAgent
  const timeoutMs = options.timeoutMs ?? CRAWLER.requestTimeoutMs
  const maxRedirects = options.maxRedirects ?? CRAWLER.maxRedirects ?? 5

  const refused = (status) => ({ allowed: () => false, crawlDelayMs: null, status })

  // The same SSRF guard every crawler fetch passes, applied to the robots.txt
  // URL itself and then to every redirect hop. Following redirects with the
  // runtime (`redirect: 'follow'`) would let a site bounce this request into
  // private address space or a metadata endpoint unchecked.
  let current = `${origin}/robots.txt`
  if (!checkUrlSafety(current).safe) return refused('unsafe_url')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    for (let hop = 0; hop <= maxRedirects; hop += 1) {
      const response = await fetchImpl(current, {
        headers: { 'User-Agent': userAgent, Accept: 'text/plain' },
        redirect: 'manual',
        signal: controller.signal,
      })

      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel().catch(() => {})
        const location = response.headers.get('location')
        if (!location) return refused('redirect_without_location')

        const target = new URL(location, current).toString()
        const verdict = checkRedirect(current, target, isSameSite)
        // An unsafe or off-site redirect is not followed. Refusing (rather
        // than treating robots.txt as absent) is the conservative reading:
        // we could not read the site's rules, so we do not crawl it.
        if (!verdict.allowed) return refused(verdict.reason || 'unsafe_redirect')

        current = target
        continue
      }

      if (response.status >= 500) {
        await response.body?.cancel().catch(() => {})
        // A failing server is not a server to crawl. Refusing here also stops the
        // crawler from adding load to something already in trouble.
        return refused('server_error')
      }

      if (!response.ok) {
        await response.body?.cancel().catch(() => {})
        // 404/403 and friends: no restrictions published.
        return { allowed: () => true, crawlDelayMs: null, status: 'absent' }
      }

      // A robots.txt is a small text file. Read at most the ceiling, chunk by
      // chunk, and abandon the stream after it — `response.text()` would
      // buffer the whole body before any limit could apply.
      const { text } = await readBounded(response, ROBOTS_MAX_BYTES)
      const parsed = parseRobots(text, userAgent.toLowerCase())

      return {
        allowed: (path) => isPathAllowed(parsed, path),
        crawlDelayMs: parsed.crawlDelay === null ? null : Math.min(parsed.crawlDelay * 1000, 30_000),
        status: parsed.matchedSpecificAgent ? 'matched_agent' : 'matched_wildcard',
      }
    }

    return refused('too_many_redirects')
  } catch {
    // Network failure or timeout. Same reasoning as a 5xx.
    return refused('unreachable')
  } finally {
    clearTimeout(timer)
  }
}

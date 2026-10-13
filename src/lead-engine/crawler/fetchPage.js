/**
 * One bounded, safety-checked HTTP fetch of one public page.
 *
 * Every limit here exists because the crawler is talking to servers nobody
 * controls: a hung connection, a 400MB "HTML" file, a redirect chain that never
 * terminates, or a redirect into private address space are all ordinary things
 * a remote server can do, deliberately or otherwise, and each one has a bound.
 *
 * Redirects are followed MANUALLY (`redirect: 'manual'`) rather than by the
 * runtime. That is the whole point: the runtime would happily follow a redirect
 * to `http://169.254.169.254/`, and the SSRF check has to run against each hop.
 */

import { CRAWLER } from '../config/defaults.js'
import { canonicalizeUrl, isSameSite } from '../domain/domains.js'
import { assertSafeUrl, checkRedirect, checkUrlSafety, UnsafeUrlError } from './ssrf.js'

/**
 * Reads a response body up to a byte ceiling, ABANDONING the stream once the
 * ceiling is passed.
 *
 * `response.text()` would buffer the whole body first and only then let us
 * check its size, which makes the limit useless against exactly the response it
 * is meant to protect against. Reading chunk by chunk means an oversized
 * response costs the ceiling, not the body.
 *
 * @param {Response} response
 * @param {number} maxBytes
 * @returns {Promise<{ text: string, bytes: number, truncated: boolean }>}
 */
export async function readBounded(response, maxBytes) {
  const body = response.body
  if (!body) return { text: '', bytes: 0, truncated: false }

  const reader = body.getReader()
  const chunks = []
  let bytes = 0
  let truncated = false

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue

      bytes += value.byteLength
      if (bytes > maxBytes) {
        truncated = true
        break
      }
      chunks.push(value)
    }
  } finally {
    // Releasing the lock and cancelling tells the runtime we are done with the
    // connection, rather than leaving it open until GC.
    await reader.cancel().catch(() => {})
  }

  const merged = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0))
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }

  return {
    // `fatal: false` so a page in an unexpected encoding yields replacement
    // characters rather than throwing — a mis-encoded page is still worth
    // extracting signals from.
    text: new TextDecoder('utf-8', { fatal: false }).decode(merged),
    bytes,
    truncated,
  }
}

/** Whether the declared content type is HTML we can parse. */
function isAcceptableContentType(header, accepted = CRAWLER.acceptedContentTypes) {
  if (!header) return false
  const mediaType = header.split(';')[0].trim().toLowerCase()
  return accepted.includes(mediaType)
}

/**
 * Fetches one page.
 *
 * Never throws for an ordinary failure — a refusal, a timeout, a wrong content
 * type and a 404 are all outcomes the crawl records and moves past. It throws
 * only for a programming error.
 *
 * @param {string} rawUrl
 * @param {{ fetchImpl?: typeof fetch, limits?: object, userAgent?: string,
 *           signal?: AbortSignal }} [options]
 * @returns {Promise<{
 *   ok: boolean, url: string, finalUrl: string|null, status: number|null,
 *   contentType: string|null, html: string, bytes: number,
 *   redirects: number, reason: string|null, truncated: boolean
 * }>}
 */
export async function fetchPage(rawUrl, options = {}) {
  const fetchImpl = options.fetchImpl || fetch
  const limits = { ...CRAWLER, ...(options.limits || {}) }
  const userAgent = options.userAgent || limits.userAgent

  const outcome = {
    ok: false,
    url: rawUrl,
    finalUrl: null,
    status: null,
    contentType: null,
    html: '',
    bytes: 0,
    redirects: 0,
    reason: null,
    truncated: false,
  }

  let current
  try {
    current = assertSafeUrl(rawUrl).toString()
  } catch (error) {
    outcome.reason = error instanceof UnsafeUrlError ? error.reason : 'invalid_url'
    return outcome
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), limits.requestTimeoutMs)
  // An outer signal (the whole run being cancelled) must also abort this fetch.
  const onOuterAbort = () => controller.abort()
  options.signal?.addEventListener('abort', onOuterAbort, { once: true })

  try {
    for (let hop = 0; hop <= limits.maxRedirects; hop += 1) {
      let response
      try {
        response = await fetchImpl(current, {
          method: 'GET',
          headers: {
            'User-Agent': userAgent,
            Accept: 'text/html,application/xhtml+xml',
            'Accept-Language': 'en',
          },
          redirect: 'manual',
          signal: controller.signal,
        })
      } catch (error) {
        outcome.reason = controller.signal.aborted ? 'timeout' : 'network_error'
        outcome.finalUrl = current
        if (error instanceof Error && !controller.signal.aborted) {
          outcome.reason = `network_error:${error.name}`
        }
        return outcome
      }

      outcome.status = response.status
      outcome.finalUrl = current

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location')
        if (!location) {
          outcome.reason = 'redirect_without_location'
          return outcome
        }

        const target = new URL(location, current).toString()
        const verdict = checkRedirect(current, target, isSameSite)
        if (!verdict.allowed) {
          outcome.reason = verdict.reason
          return outcome
        }

        current = target
        outcome.redirects += 1
        continue
      }

      if (!response.ok) {
        outcome.reason = `http_${response.status}`
        // The body of an error page is not useful and may be large.
        await response.body?.cancel().catch(() => {})
        return outcome
      }

      const contentType = response.headers.get('content-type')
      outcome.contentType = contentType
      if (!isAcceptableContentType(contentType, limits.acceptedContentTypes)) {
        outcome.reason = `content_type:${(contentType || 'unknown').split(';')[0]}`
        await response.body?.cancel().catch(() => {})
        return outcome
      }

      // A declared length over the ceiling is refused before a single byte is
      // read. The streaming reader below still bounds bodies that lie or send
      // no length at all.
      const declaredLength = Number(response.headers.get('content-length'))
      if (Number.isFinite(declaredLength) && declaredLength > limits.maxResponseBytes) {
        outcome.reason = 'response_too_large'
        await response.body?.cancel().catch(() => {})
        return outcome
      }

      const { text, bytes, truncated } = await readBounded(response, limits.maxResponseBytes)
      outcome.ok = true
      outcome.html = text
      outcome.bytes = bytes
      outcome.truncated = truncated
      outcome.finalUrl = canonicalizeUrl(current) || current
      return outcome
    }

    outcome.reason = 'too_many_redirects'
    return outcome
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', onOuterAbort)
  }
}

/** Re-exported so callers can pre-screen a URL without importing two modules. */
export { checkUrlSafety }

// One place every rate limit goes through, so a limiter can never again be
// "configured but not actually enforcing" without it being visible here.
//
// The Durable Object behind this is what makes the count global; see
// RateLimiterDO.ts for why the previous in-memory Maps did not work on
// Workers.

/**
 * The client address as the edge reported it, preferring Cloudflare's own
 * header. `x-forwarded-for` is client-controllable in general, but on Workers
 * `cf-connecting-ip` is set by the edge and cannot be spoofed by the caller, so
 * it is tried first. Use this where the real address is needed (Turnstile's
 * `remoteip`); rate limits use `clientIp`.
 *
 * @param {Request} request
 * @returns {string}
 */
export function clientAddress(request) {
  return request.headers.get('cf-connecting-ip')
    || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || 'unknown'
}

/**
 * The identity a per-IP rate limit counts against. IPv4 is the address
 * itself; IPv6 is its /64 network, because one household or VPS is handed a
 * whole /64 and could otherwise rotate through 2^64 addresses, each with a
 * fresh allowance. An IPv4-mapped IPv6 address counts as its IPv4 address.
 *
 * @param {Request} request
 * @returns {string}
 */
export function clientIp(request) {
  return rateLimitIp(clientAddress(request))
}

const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/
const HEXTET = /^[0-9a-f]{1,4}$/

/**
 * Normalizes one address for rate limiting (see clientIp). Anything that is
 * not a valid IPv6 literal is returned trimmed, so a malformed header still
 * gets a (bounded) key of its own rather than an error.
 *
 * @param {string} raw
 * @returns {string}
 */
export function rateLimitIp(raw) {
  const address = String(raw || '').trim().slice(0, 64)
  if (!address.includes(':')) return address || 'unknown'
  const hextets = ipv6Hextets(address)
  if (!hextets) return address.toLowerCase()
  const isMapped = hextets.slice(0, 5).every((h) => h === 0) && hextets[5] === 0xffff
  if (isMapped) return [hextets[6] >> 8, hextets[6] & 0xff, hextets[7] >> 8, hextets[7] & 0xff].join('.')
  return `${hextets.slice(0, 4).map((h) => h.toString(16)).join(':')}::/64`
}

/**
 * The eight 16-bit groups of an IPv6 literal, or null when it is not one.
 * Accepts `::` compression, a trailing dotted IPv4, brackets and a zone id.
 *
 * @param {string} text
 * @returns {number[] | null}
 */
function ipv6Hextets(text) {
  let address = text.toLowerCase().replace(/^\[|\]$/g, '').replace(/%.*$/, '')
  const tail = address.match(/:((?:\d{1,3}\.){3}\d{1,3})$/)
  if (tail) {
    const octets = tail[1].split('.').map(Number)
    if (!IPV4.test(tail[1]) || octets.some((o) => o > 255)) return null
    address = `${address.slice(0, -tail[1].length)}${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`
  }
  const halves = address.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const groups = halves.length === 2
    ? [...head, ...Array(8 - head.length - rest.length).fill('0'), ...rest]
    : head
  if (groups.length !== 8 || (halves.length === 2 && head.length + rest.length > 7)) return null
  if (!groups.every((g) => HEXTET.test(g))) return null
  return groups.map((g) => parseInt(g, 16))
}

/**
 * Records an attempt and says whether the caller is over its allowance.
 *
 * FAILS OPEN. If the Durable Object is unreachable, this returns "not
 * limited" rather than throwing, because a rate limiter that takes the login
 * page down with it when it has a bad minute is a worse outcome than one that
 * briefly stops counting. The trade-off is deliberate and worth knowing about.
 *
 * @param {{ RATE_LIMITER?: DurableObjectNamespace }} env
 * @param {string} bucket  coarse scope, e.g. 'admin-login' -- keeps unrelated
 *   limits from sharing a counter
 * @param {string} identity  who is being limited, e.g. an IP or `ip:email`
 * @param {{ limit: number, windowMs: number }} options
 * @returns {Promise<{ limited: boolean, retryAfterSeconds: number }>}
 */
export async function checkRateLimit(env, bucket, identity, { limit, windowMs }) {
  if (!env?.RATE_LIMITER) return { limited: false, retryAfterSeconds: 0 }

  try {
    // Keyed by bucket AND identity, so every distinct client gets its own
    // object and one noisy address cannot slow everyone else down.
    const key = `${bucket}:${identity}`
    const stub = env.RATE_LIMITER.get(env.RATE_LIMITER.idFromName(key))
    return await stub.check(key, limit, windowMs)
  } catch {
    return { limited: false, retryAfterSeconds: 0 }
  }
}

/**
 * Like checkRateLimit, but FAILS CLOSED: a missing binding or a limiter that
 * throws reports `{ limited: true, unavailable: true }`. For anonymous writes
 * where an uncounted request is worse than a refused one (session creation,
 * self check-in); the caller answers 503 for `unavailable`.
 *
 * @param {{ RATE_LIMITER?: DurableObjectNamespace }} env
 * @param {string} bucket
 * @param {string} identity
 * @param {{ limit: number, windowMs: number }} options
 * @returns {Promise<{ limited: boolean, retryAfterSeconds: number, unavailable?: boolean }>}
 */
export async function checkRateLimitStrict(env, bucket, identity, { limit, windowMs }) {
  if (!env?.RATE_LIMITER) return { limited: true, retryAfterSeconds: 0, unavailable: true }
  try {
    const key = `${bucket}:${identity}`
    const stub = env.RATE_LIMITER.get(env.RATE_LIMITER.idFromName(key))
    const result = await stub.check(key, limit, windowMs)
    if (!result || typeof result.limited !== 'boolean') return { limited: true, retryAfterSeconds: 0, unavailable: true }
    return result
  } catch (error) {
    console.error(JSON.stringify({ event: 'rate_limit.unavailable', bucket, error: error instanceof Error ? error.message : 'unknown' }))
    return { limited: true, retryAfterSeconds: 0, unavailable: true }
  }
}

/**
 * Read-only check, for call sites that count only failures (see
 * `recordRateLimitFailure`). Fails open for the same reason as checkRateLimit.
 *
 * @param {{ RATE_LIMITER?: DurableObjectNamespace }} env
 * @param {string} bucket
 * @param {string} identity
 * @param {{ limit: number }} options
 * @returns {Promise<{ limited: boolean, retryAfterSeconds: number }>}
 */
export async function peekRateLimit(env, bucket, identity, { limit }) {
  if (!env?.RATE_LIMITER) return { limited: false, retryAfterSeconds: 0 }
  try {
    const key = `${bucket}:${identity}`
    return await env.RATE_LIMITER.get(env.RATE_LIMITER.idFromName(key)).peek(key, limit)
  } catch {
    return { limited: false, retryAfterSeconds: 0 }
  }
}

/**
 * Counts one failed attempt.
 *
 * @param {{ RATE_LIMITER?: DurableObjectNamespace }} env
 * @param {string} bucket
 * @param {string} identity
 * @param {{ windowMs: number }} options
 */
export async function recordRateLimitFailure(env, bucket, identity, { windowMs }) {
  if (!env?.RATE_LIMITER) return
  try {
    const key = `${bucket}:${identity}`
    await env.RATE_LIMITER.get(env.RATE_LIMITER.idFromName(key)).record(key, windowMs)
  } catch {
    /* best-effort: losing one count is better than failing the request */
  }
}

/**
 * Clears a counter after a legitimate success, so someone who mistyped a
 * password twice is not left throttled once they get it right.
 *
 * @param {{ RATE_LIMITER?: DurableObjectNamespace }} env
 * @param {string} bucket
 * @param {string} identity
 */
export async function clearRateLimit(env, bucket, identity) {
  if (!env?.RATE_LIMITER) return
  try {
    const key = `${bucket}:${identity}`
    await env.RATE_LIMITER.get(env.RATE_LIMITER.idFromName(key)).reset(key)
  } catch {
    /* clearing is best-effort: the window expires on its own */
  }
}

/**
 * The 429 every caller should return, with Retry-After so a well-behaved
 * client backs off instead of spinning.
 *
 * @param {string} message
 * @param {number} retryAfterSeconds
 */
export function rateLimitedResponse(message, retryAfterSeconds) {
  return new Response(JSON.stringify({ error: message }), {
    status: 429,
    headers: {
      'content-type': 'application/json',
      ...(retryAfterSeconds > 0 ? { 'retry-after': String(retryAfterSeconds) } : {}),
    },
  })
}

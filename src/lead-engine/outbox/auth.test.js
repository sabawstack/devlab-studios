import { describe, expect, it } from 'vitest'
import { authorizeBearer, authorizeBearerRequest, authorizeOutbox, readBearerToken, timingSafeEqual } from './auth.js'

/**
 * A new authentication surface on an endpoint that hands out prospect email
 * addresses and message bodies, sitting outside the admin session gate. The
 * failure directions all have to be closed, so they are all asserted.
 */

const GOOD_TOKEN = 'a'.repeat(48)

const requestWith = (header) => ({
  headers: { get: (name) => (name.toLowerCase() === 'authorization' ? header : null) },
})

describe('timingSafeEqual', () => {
  it('matches identical strings', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true)
  })

  it('rejects a difference at the last byte as firmly as the first', () => {
    expect(timingSafeEqual('abc', 'abd')).toBe(false)
    expect(timingSafeEqual('abc', 'zbc')).toBe(false)
  })

  it('rejects different lengths', () => {
    expect(timingSafeEqual('abc', 'abcd')).toBe(false)
  })

  it('treats null and undefined as empty rather than throwing', () => {
    expect(timingSafeEqual(null, undefined)).toBe(true)
    expect(timingSafeEqual(null, 'x')).toBe(false)
  })
})

describe('readBearerToken', () => {
  it('reads a bearer token case-insensitively', () => {
    expect(readBearerToken(requestWith(`bearer ${GOOD_TOKEN}`))).toBe(GOOD_TOKEN)
    expect(readBearerToken(requestWith(`Bearer ${GOOD_TOKEN}`))).toBe(GOOD_TOKEN)
  })

  it('returns empty for a missing or malformed header', () => {
    expect(readBearerToken(requestWith(null))).toBe('')
    expect(readBearerToken(requestWith(GOOD_TOKEN))).toBe('')
    expect(readBearerToken({})).toBe('')
  })
})

describe('authorizeOutbox', () => {
  it('accepts the configured token', () => {
    const result = authorizeOutbox({ LEAD_OUTBOX_TOKEN: GOOD_TOKEN }, requestWith(`Bearer ${GOOD_TOKEN}`))

    expect(result.ok).toBe(true)
  })

  it('REFUSES EVERYTHING when no token is configured', () => {
    // The direction that matters most. Treating "unconfigured" as "open" would
    // mean a deploy that forgot the secret published prospect contact details.
    const result = authorizeOutbox({}, requestWith(`Bearer ${GOOD_TOKEN}`))

    expect(result.ok).toBe(false)
    expect(result.status).toBe(503)
  })

  it('refuses an unconfigured deployment even with no credentials offered', () => {
    expect(authorizeOutbox({}, requestWith(null)).ok).toBe(false)
  })

  it('refuses a token too short to be safe', () => {
    // A deployment that set `LEAD_OUTBOX_TOKEN=test` should not quietly work.
    const result = authorizeOutbox({ LEAD_OUTBOX_TOKEN: 'short' }, requestWith('Bearer short'))

    expect(result.ok).toBe(false)
    expect(result.status).toBe(503)
    // The same generic text as "unset": an unauthenticated caller learns
    // nothing about the deployment's configuration (F11). The operator gets
    // the specifics from the log.
    expect(result.error).toBe('This endpoint is not configured.')
    expect(result.error).not.toMatch(/LEAD_OUTBOX_TOKEN|short/i)
  })

  it('never names the environment variable in a 503 body', () => {
    const result = authorizeBearer({}, requestWith('Bearer x'), 'MAILBOX_OUTBOX_TOKEN')
    expect(result.status).toBe(503)
    expect(result.error).not.toMatch(/MAILBOX_OUTBOX_TOKEN/)
  })

  it('reports a misconfiguration as 503 and a bad credential as 401', () => {
    // Different problems for different people: 503 sends the operator to the
    // deployment config, 401 tells the caller its token is wrong.
    expect(authorizeOutbox({}, requestWith(`Bearer ${GOOD_TOKEN}`)).status).toBe(503)
    expect(authorizeOutbox({ LEAD_OUTBOX_TOKEN: GOOD_TOKEN }, requestWith('Bearer wrong')).status).toBe(401)
  })

  it('refuses a request with no Authorization header', () => {
    expect(authorizeOutbox({ LEAD_OUTBOX_TOKEN: GOOD_TOKEN }, requestWith(null)).ok).toBe(false)
  })

  it('refuses a prefix of the real token', () => {
    const prefix = GOOD_TOKEN.slice(0, 40)

    expect(authorizeOutbox({ LEAD_OUTBOX_TOKEN: GOOD_TOKEN }, requestWith(`Bearer ${prefix}`)).ok).toBe(false)
  })

  it('ignores surrounding whitespace in the configured value', () => {
    // A secret pasted with a trailing newline is a common accident, and it
    // should not produce an endpoint that rejects the correct token.
    const result = authorizeOutbox({ LEAD_OUTBOX_TOKEN: `  ${GOOD_TOKEN}\n` }, requestWith(`Bearer ${GOOD_TOKEN}`))

    expect(result.ok).toBe(true)
  })
})

describe('authorizeBearerRequest (F11)', () => {
  const TOKEN = 'b'.repeat(48)

  function limiter() {
    const failures = new Map()
    const stub = (key) => ({
      async peek(_key, limit) {
        return { limited: (failures.get(key) ?? 0) >= limit, retryAfterSeconds: 60 }
      },
      async record() {
        failures.set(key, (failures.get(key) ?? 0) + 1)
      },
    })
    return {
      failures,
      idFromName: (name) => name,
      get: (id) => stub(id),
    }
  }

  const request = (header) =>
    new Request('https://www.example.com/api/mailbox/outbox', {
      headers: { ...(header ? { authorization: header } : {}), 'cf-connecting-ip': '203.0.113.9' },
    })

  it('counts each 401 against the caller and answers 429 once over the limit', async () => {
    const RATE_LIMITER = limiter()
    const env = { MAILBOX_OUTBOX_TOKEN: TOKEN, RATE_LIMITER }

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const result = await authorizeBearerRequest(env, request('Bearer wrong'), 'MAILBOX_OUTBOX_TOKEN')
      expect(result.ok).toBe(false)
      expect(result.response.status).toBe(401)
    }

    // Over the limit: refused before the token is even compared — including
    // the right one, so the endpoint is no longer a guessing oracle.
    const throttled = await authorizeBearerRequest(env, request(`Bearer ${TOKEN}`), 'MAILBOX_OUTBOX_TOKEN')
    expect(throttled.ok).toBe(false)
    expect(throttled.response.status).toBe(429)
  })

  it('does not count successful calls', async () => {
    const RATE_LIMITER = limiter()
    const env = { MAILBOX_OUTBOX_TOKEN: TOKEN, RATE_LIMITER }
    for (let attempt = 0; attempt < 20; attempt += 1) {
      expect((await authorizeBearerRequest(env, request(`Bearer ${TOKEN}`), 'MAILBOX_OUTBOX_TOKEN')).ok).toBe(true)
    }
    expect([...RATE_LIMITER.failures.values()].reduce((a, b) => a + b, 0)).toBe(0)
  })

  it('answers a generic 503 when unconfigured', async () => {
    const result = await authorizeBearerRequest({}, request('Bearer x'), 'MAILBOX_OUTBOX_TOKEN')
    expect(result.response.status).toBe(503)
    expect(await result.response.json()).toEqual({ error: 'This endpoint is not configured.' })
  })
})

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createTestD1 } from '../../worker/repositories/testSupport/d1Sqlite.js'
import { LIMITS } from '../config.js'
import { ingestEmail } from './ingest.js'
import { parseAuthenticationResults, TRUSTED_AUTHSERV_ID } from './parse.js'

/**
 * F5 (forgeable Authentication-Results) and F11 (per-sender inbound cap).
 */

const headers = (value) => new Headers(value === null ? {} : { 'authentication-results': value })
const UNKNOWN = { spf: 'unknown', dkim: 'unknown', dmarc: 'unknown' }

describe('parseAuthenticationResults', () => {
  it("reads Cloudflare's own topmost header", () => {
    expect(TRUSTED_AUTHSERV_ID).toBe('mx.cloudflare.net')
    expect(
      parseAuthenticationResults(
        headers(
          'mx.cloudflare.net; dkim=pass header.d=example.com header.s=s1; dmarc=pass header.from=example.com ' +
            'policy.dmarc=none; spf=pass (mx.cloudflare.net: domain of a@example.com designates 1.2.3.4 as ' +
            'permitted sender) smtp.mailfrom=a@example.com; arc=none',
        ),
      ),
    ).toEqual({ spf: 'pass', dkim: 'pass', dmarc: 'pass' })
  })

  it('ignores a sender-supplied header that comes after the edge one', () => {
    // Headers.get joins repeats with ", " in message order — edge first.
    expect(
      parseAuthenticationResults(headers('mx.cloudflare.net; spf=fail; dkim=none; dmarc=fail, attacker.example; dmarc=pass')),
    ).toEqual({ spf: 'fail', dkim: 'none', dmarc: 'fail' })
  })

  it('does not let a comma inside a comment split the edge header', () => {
    expect(
      parseAuthenticationResults(headers('mx.cloudflare.net; spf=pass (looks, odd) smtp.mailfrom=a@b.example; dmarc=pass')),
    ).toEqual({ spf: 'pass', dkim: null, dmarc: 'pass' })
  })

  it('answers unknown when the topmost header is not from Cloudflare', () => {
    expect(parseAuthenticationResults(headers('attacker.example; spf=pass; dkim=pass; dmarc=pass'))).toEqual(UNKNOWN)
    expect(parseAuthenticationResults(headers('mx.cloudflare.net.evil.example; dmarc=pass'))).toEqual(UNKNOWN)
  })

  it('answers unknown when there is no header at all', () => {
    expect(parseAuthenticationResults(headers(null))).toEqual(UNKNOWN)
    expect(parseAuthenticationResults(undefined)).toEqual(UNKNOWN)
  })
})

describe('per-sender inbound daily cap', () => {
  const HERE = fileURLToPath(new URL('.', import.meta.url))
  const MIGRATIONS = join(HERE, '..', '..', '..', 'migrations')
  const schema = [
    '0012_lead_intelligence_engine.sql',
    '0013_lead_usage_metric_nominatim.sql',
    '0014_mailbox.sql',
  ].map((file) => readFileSync(join(MIGRATIONS, file), 'utf8'))

  function message(index, from = 'flood@spam.example') {
    const raw = [
      `From: <${from}>`,
      'To: hello@devlabconnect.com',
      `Subject: Message ${index}`,
      `Message-ID: <m${index}.${from}>`,
      'Content-Type: text/plain',
      '',
      'x',
      '',
    ].join('\r\n')
    const bytes = new TextEncoder().encode(raw)
    return {
      from,
      to: 'hello@devlabconnect.com',
      rawSize: bytes.byteLength,
      headers: new Headers(),
      raw: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close() } }),
    }
  }

  it('drops, with a reason, mail from a sender past the daily cap — and only that sender', async () => {
    const env = { DB: createTestD1(schema), MAILBOX_BUCKET: null }
    const now = new Date('2026-10-13T12:00:00Z')

    // Fill the sender up to the cap.
    for (let index = 0; index < LIMITS.maxInboundPerSenderPerDay; index += 1) {
      await ingestEmail(env, message(index), { now })
    }

    const over = await ingestEmail(env, message(9999), { now })
    expect(over).toEqual({ status: 'dropped', reason: 'sender_daily_cap' })

    const other = await ingestEmail(env, message(1, 'someone@else.example'), { now })
    expect(other.status).toBe('stored')

    // A day later the window has rolled forward.
    const later = await ingestEmail(env, message(10_000), { now: new Date('2026-10-14T12:00:01Z') })
    expect(later.status).toBe('stored')
  })
})

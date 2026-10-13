import { describe, expect, it, vi } from 'vitest'
import { checkRateLimit, checkRateLimitStrict, clientAddress, clientIp, rateLimitIp } from './rateLimit.js'

const withIp = (ip, header = 'cf-connecting-ip') => new Request('https://www.devlabstudios.com/', { headers: { [header]: ip } })

describe('rateLimitIp', () => {
  it('keeps IPv4 as it is', () => {
    expect(rateLimitIp('203.0.113.7')).toBe('203.0.113.7')
  })

  it('keys a full IPv6 address on its /64', () => {
    expect(rateLimitIp('2001:0db8:abcd:0012:0001:0002:0003:0004')).toBe('2001:db8:abcd:12::/64')
  })

  it('gives every address in one /64 the same key', () => {
    const a = rateLimitIp('2001:db8:abcd:12:aaaa:bbbb:cccc:dddd')
    const b = rateLimitIp('2001:db8:abcd:12::1')
    expect(a).toBe(b)
    expect(rateLimitIp('2001:db8:abcd:13::1')).not.toBe(a)
  })

  it('expands compressed IPv6 and ignores case', () => {
    expect(rateLimitIp('2001:DB8::1')).toBe('2001:db8:0:0::/64')
    expect(rateLimitIp('::1')).toBe('0:0:0:0::/64')
    expect(rateLimitIp('fe80::1%eth0')).toBe('fe80:0:0:0::/64')
    expect(rateLimitIp('[2001:db8::5]')).toBe('2001:db8:0:0::/64')
  })

  it('treats an IPv4-mapped IPv6 address as the IPv4 address', () => {
    expect(rateLimitIp('::ffff:203.0.113.7')).toBe('203.0.113.7')
    expect(rateLimitIp('::FFFF:cb00:7107')).toBe('203.0.113.7')
  })

  it('keys IPv6 with an embedded dotted tail on its /64', () => {
    expect(rateLimitIp('64:ff9b::192.0.2.1')).toBe('64:ff9b:0:0::/64')
  })

  it('leaves malformed values as bounded, trimmed keys', () => {
    expect(rateLimitIp('1:2:3:4:5:6:7:8:9')).toBe('1:2:3:4:5:6:7:8:9')
    expect(rateLimitIp('::ffff:999.1.1.1')).toBe('::ffff:999.1.1.1')
    expect(rateLimitIp('  ')).toBe('unknown')
    expect(rateLimitIp('x'.repeat(500))).toHaveLength(64)
  })
})

describe('clientIp and clientAddress', () => {
  it('rate-limits on the /64 but reports the real address', () => {
    const request = withIp('2001:db8:abcd:12:1:2:3:4')
    expect(clientIp(request)).toBe('2001:db8:abcd:12::/64')
    expect(clientAddress(request)).toBe('2001:db8:abcd:12:1:2:3:4')
  })

  it('falls back to the first x-forwarded-for entry', () => {
    expect(clientAddress(withIp('198.51.100.1, 10.0.0.1', 'x-forwarded-for'))).toBe('198.51.100.1')
    expect(clientIp(new Request('https://www.devlabstudios.com/'))).toBe('unknown')
  })
})

describe('checkRateLimitStrict', () => {
  const env = (check) => ({ RATE_LIMITER: { idFromName: (k) => k, get: () => ({ check }) } })

  it('fails closed without a binding', async () => {
    expect(await checkRateLimitStrict({}, 'b', 'ip', { limit: 1, windowMs: 1000 })).toEqual({ limited: true, retryAfterSeconds: 0, unavailable: true })
  })

  it('fails closed when the limiter throws', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await checkRateLimitStrict(env(async () => { throw new Error('DO down') }), 'b', 'ip', { limit: 1, windowMs: 1000 })
    expect(result).toEqual({ limited: true, retryAfterSeconds: 0, unavailable: true })
    spy.mockRestore()
  })

  it('fails closed on a malformed answer', async () => {
    expect((await checkRateLimitStrict(env(async () => undefined), 'b', 'ip', { limit: 1, windowMs: 1000 })).unavailable).toBe(true)
  })

  it('passes the limiter answer through', async () => {
    expect(await checkRateLimitStrict(env(async () => ({ limited: false, retryAfterSeconds: 0 })), 'b', 'ip', { limit: 1, windowMs: 1000 }))
      .toEqual({ limited: false, retryAfterSeconds: 0 })
  })

  it('differs from checkRateLimit, which still fails open', async () => {
    expect((await checkRateLimit(env(async () => { throw new Error('down') }), 'b', 'ip', { limit: 1, windowMs: 1000 })).limited).toBe(false)
  })
})

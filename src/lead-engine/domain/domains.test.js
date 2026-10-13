import { describe, expect, it } from 'vitest'
import {
  canonicalDomain,
  canonicalizeUrl,
  emailDomain,
  isNonCompanyHost,
  isSameSite,
  normalizeCompanyName,
  normalizeEmail,
  parseWebsite,
  strictRecipient,
} from './domains.js'

describe('canonicalDomain', () => {
  it('collapses the variants discovery sources actually produce onto one key', () => {
    const variants = [
      'example.com',
      'www.example.com',
      'https://example.com',
      'https://www.example.com/',
      'HTTP://Example.COM/contact?utm_source=osm',
      'https://www.example.com./',
    ]

    for (const variant of variants) {
      expect(canonicalDomain(variant), variant).toBe('example.com')
    }
  })

  it('keeps distinct businesses distinct', () => {
    expect(canonicalDomain('acme-properties.com')).not.toBe(canonicalDomain('acmeproperties.com'))
  })

  it('treats a subdomain as the same company as its registrable domain', () => {
    expect(canonicalDomain('rentals.example.com')).toBe('example.com')
  })

  it('handles multi-part TLDs in the target markets', () => {
    expect(canonicalDomain('https://www.acme.com.ph/about')).toBe('acme.com.ph')
    expect(canonicalDomain('acme.ph')).toBe('acme.ph')
    expect(canonicalDomain('sub.acme.com.ph')).toBe('acme.com.ph')
  })

  it('refuses social and link-shortener hosts, which would merge every business that lists one', () => {
    expect(canonicalDomain('https://www.facebook.com/acmeproperties')).toBeNull()
    expect(canonicalDomain('https://linktr.ee/acme')).toBeNull()
    expect(canonicalDomain('https://business.site/acme')).toBeNull()
    expect(isNonCompanyHost('https://m.facebook.com/acme')).toBe(true)
  })

  it('refuses values that cannot identify a company', () => {
    expect(canonicalDomain('')).toBeNull()
    expect(canonicalDomain(null)).toBeNull()
    expect(canonicalDomain('not a url')).toBeNull()
    expect(canonicalDomain('localhost')).toBeNull()
    expect(canonicalDomain('http://192.168.1.10/')).toBeNull()
    expect(canonicalDomain('ftp://example.com')).toBeNull()
    expect(canonicalDomain('javascript:alert(1)')).toBeNull()
  })
})

describe('parseWebsite', () => {
  it('assumes https for a bare host', () => {
    expect(parseWebsite('example.com')?.protocol).toBe('https:')
  })

  it('preserves an explicit http scheme', () => {
    expect(parseWebsite('http://example.com')?.protocol).toBe('http:')
  })
})

describe('canonicalizeUrl', () => {
  it('produces one string for URLs that fetch the same page', () => {
    const expected = 'https://example.com/contact'
    expect(canonicalizeUrl('https://example.com/contact#form')).toBe(expected)
    expect(canonicalizeUrl('https://example.com/contact/')).toBe(expected)
    expect(canonicalizeUrl('https://example.com:443/contact')).toBe(expected)
    expect(canonicalizeUrl('https://EXAMPLE.com/contact?utm_source=brave&fbclid=abc')).toBe(expected)
  })

  it('sorts remaining query parameters so order does not create a second URL', () => {
    expect(canonicalizeUrl('https://example.com/s?b=2&a=1')).toBe(
      canonicalizeUrl('https://example.com/s?a=1&b=2'),
    )
  })

  it('keeps meaningful query parameters', () => {
    expect(canonicalizeUrl('https://example.com/s?page=2')).toBe('https://example.com/s?page=2')
  })

  it('preserves path case, which is server-significant', () => {
    expect(canonicalizeUrl('https://example.com/Owner-Portal')).toBe('https://example.com/Owner-Portal')
  })

  it('keeps the root path slash', () => {
    expect(canonicalizeUrl('https://example.com')).toBe('https://example.com/')
  })

  it('strips embedded credentials rather than carrying them into a stored URL', () => {
    expect(canonicalizeUrl('https://user:pass@example.com/x')).toBe('https://example.com/x')
  })
})

describe('isSameSite', () => {
  it('follows www and subdomain links within one site', () => {
    expect(isSameSite('https://example.com/', 'https://www.example.com/contact')).toBe(true)
    expect(isSameSite('https://example.com/', 'https://portal.example.com/login')).toBe(true)
  })

  it('does not follow off-site links', () => {
    expect(isSameSite('https://example.com/', 'https://other.com/')).toBe(false)
  })

  it('is false when either side is unusable, rather than vacuously true', () => {
    expect(isSameSite('', '')).toBe(false)
    expect(isSameSite('https://facebook.com/a', 'https://facebook.com/b')).toBe(false)
  })
})

describe('normalizeEmail', () => {
  it('lowercases the whole address so suppression cannot be bypassed by case', () => {
    expect(normalizeEmail('Info@Example.COM')).toBe('info@example.com')
  })

  it('unwraps a display name', () => {
    expect(normalizeEmail('Jane Doe <jane@example.com>')).toBe('jane@example.com')
  })

  it('rejects malformed addresses', () => {
    expect(normalizeEmail('not-an-email')).toBeNull()
    expect(normalizeEmail('@example.com')).toBeNull()
    expect(normalizeEmail('info@')).toBeNull()
    expect(normalizeEmail('info@localhost')).toBeNull()
    expect(normalizeEmail('in fo@example.com')).toBeNull()
    expect(normalizeEmail('')).toBeNull()
  })

  it('exposes the domain for domain-scoped suppression', () => {
    expect(emailDomain('Info@Sub.Example.com')).toBe('sub.example.com')
    expect(emailDomain('garbage')).toBeNull()
  })
})

describe('normalizeCompanyName', () => {
  it('ignores legal suffixes and punctuation', () => {
    expect(normalizeCompanyName('Acme Properties, LLC')).toBe('acme properties')
    expect(normalizeCompanyName('ACME  Properties Inc.')).toBe('acme properties')
    expect(normalizeCompanyName('Acme & Sons')).toBe('acme and sons')
  })

  it('strips diacritics', () => {
    expect(normalizeCompanyName('Café Properties')).toBe('cafe properties')
  })
})

describe('strictRecipient', () => {
  it('accepts one plain address, normalized', () => {
    expect(strictRecipient('Jane.Doe+tag@Example.co.uk')).toBe('jane.doe+tag@example.co.uk')
    expect(strictRecipient('Jane <jane@example.com>')).toBe('jane@example.com')
  })

  it('rejects anything that could name more than one recipient or smuggle syntax', () => {
    for (const value of [
      'a@example.com,b@example.org',
      'a@example.com;b@example.org',
      '"a,b"@example.com',
      'a@b@example.com',
      'a..b@example.com',
      '.a@example.com',
      'a@-example.com',
      'a@example',
      'a@example.c',
      'a@exa_mple.com',
      'a@example.com\r\nBcc: x@y.com',
      `${'a'.repeat(65)}@example.com`,
      '',
      null,
    ]) {
      expect(strictRecipient(value), String(value)).toBeNull()
    }
  })
})

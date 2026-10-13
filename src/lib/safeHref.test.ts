import { describe, expect, it } from 'vitest'
import { findUnsafeLinkPaths, isSafeHref, safeHref, sanitizeLinkFields } from './safeHref'

describe('isSafeHref', () => {
  it.each([
    '',
    '/',
    '/contact',
    '/contact?type=business_system',
    '#selected-systems',
    '?ref=footer',
    'https://github.com/stpn-dev',
    'http://example.com',
    'HTTPS://EXAMPLE.COM',
    'mailto:someone@example.com',
    'tel:+639000000000',
    '  /padded  ',
  ])('accepts %j', (value) => {
    expect(isSafeHref(value)).toBe(true)
  })

  it.each([
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    ' javascript:alert(1)',
    'java\tscript:alert(1)',
    'java\nscript:alert(1)',
    '\u0001javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    '//evil.example',
    '/\\evil.example',
    '\\\\evil.example',
    'evil.example',
    'contact',
  ])('rejects %j', (value) => {
    expect(isSafeHref(value)).toBe(false)
  })

  it('rejects non-string values but tolerates absent ones', () => {
    expect(isSafeHref(42)).toBe(false)
    expect(isSafeHref({})).toBe(false)
    expect(isSafeHref(undefined)).toBe(true)
    expect(isSafeHref(null)).toBe(true)
  })
})

describe('safeHref', () => {
  it('passes a safe link through (trimmed)', () => {
    expect(safeHref(' /work ')).toBe('/work')
  })

  it('replaces an unsafe link with the fallback', () => {
    expect(safeHref('javascript:alert(1)')).toBe('#')
    expect(safeHref('//evil.example', '/')).toBe('/')
    expect(safeHref(undefined)).toBe('#')
  })
})

describe('sanitizeLinkFields', () => {
  it('neutralises link-named fields at any depth without mutating the input', () => {
    const input = {
      navigation: [{ label: 'Bad', href: 'javascript:alert(1)' }, { label: 'Good', href: '/about' }],
      footer: { socialLinks: [{ label: 'X', href: 'data:text/html,x' }] },
      about: { linkedinUrl: 'vbscript:x', photoUrl: 'javascript:not-a-link-field' },
    }
    const output = sanitizeLinkFields(input)

    expect(output.navigation[0].href).toBe('#')
    expect(output.navigation[1].href).toBe('/about')
    expect(output.footer.socialLinks[0].href).toBe('#')
    expect(output.about.linkedinUrl).toBe('#')
    // Image fields are not links and are left alone.
    expect(output.about.photoUrl).toBe('javascript:not-a-link-field')
    expect(input.navigation[0].href).toBe('javascript:alert(1)')
  })

  it('passes primitives and null through', () => {
    expect(sanitizeLinkFields(null)).toBe(null)
    expect(sanitizeLinkFields('x')).toBe('x')
  })
})

describe('findUnsafeLinkPaths', () => {
  it('reports the path of every unsafe link', () => {
    expect(findUnsafeLinkPaths({ a: [{ href: '/' }, { href: 'javascript:x' }], b: { liveUrl: '//x' } })).toEqual([
      ['a', 1, 'href'],
      ['b', 'liveUrl'],
    ])
  })
})

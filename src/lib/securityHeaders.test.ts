import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { applySecurityHeaders, PERMISSIONS_POLICY } from './securityHeaders'

const headersFor = (pathname: string, hostname = 'www.devlabstudios.com') =>
  applySecurityHeaders(new Response('ok'), pathname, hostname).headers

describe('applySecurityHeaders', () => {
  it('sets the hardening headers on every page', () => {
    const h = headersFor('/')
    expect(h.get('X-Content-Type-Options')).toBe('nosniff')
    expect(h.get('X-Frame-Options')).toBe('DENY')
    expect(h.get('Cross-Origin-Opener-Policy')).toBe('same-origin')
    expect(h.get('Cross-Origin-Resource-Policy')).toBe('same-site')
    expect(h.get('Strict-Transport-Security')).toContain('max-age=31536000')
    expect(h.get('Permissions-Policy')).toBe(PERMISSIONS_POLICY)
    expect(h.get('Permissions-Policy')).not.toContain('web-share')
    const csp = h.get('Content-Security-Policy') ?? ''
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain('https://static.cloudflareinsights.com')
  })

  // SEC-07: Astro sends a CSP header on rendered pages whose script-src
  // carries a hash per inline script and no 'unsafe-inline'. It is merged in,
  // not overwritten, so inline scripts Astro did not render are blocked.
  it("adopts the page's hashed script-src and keeps every other directive", () => {
    const page = new Response('ok', { headers: { 'Content-Security-Policy': "script-src 'self' https://www.googletagmanager.com 'sha256-abc='; style-src 'self' 'unsafe-inline'" } })
    const csp = applySecurityHeaders(page, '/', 'www.devlabstudios.com').headers.get('Content-Security-Policy') ?? ''
    const scriptSrc = csp.split(';').map((part) => part.trim()).find((part) => part.startsWith('script-src')) ?? ''
    expect(scriptSrc).toContain("'sha256-abc='")
    expect(scriptSrc).not.toContain("'unsafe-inline'")
    expect(scriptSrc).toContain('https://challenges.cloudflare.com')
    expect(csp).toContain("frame-ancestors 'none'")
    // SEC-03: every face is self-hosted; Google Fonts is not allowed anywhere.
    expect(csp).not.toMatch(/fonts\.(googleapis|gstatic)\.com/)
    expect(csp).toContain("font-src 'self'")
    expect(csp.match(/script-src/g)).toHaveLength(1)
  })

  it('is idempotent when a merged response passes through again (edge cache)', () => {
    const page = new Response('ok', { headers: { 'Content-Security-Policy': "script-src 'self' 'sha256-abc='" } })
    const once = applySecurityHeaders(page, '/', 'www.devlabstudios.com')
    const twice = applySecurityHeaders(once, '/', 'www.devlabstudios.com')
    expect(twice.headers.get('Content-Security-Policy')).toBe(once.headers.get('Content-Security-Policy'))
  })

  it('keeps admin pages and admin data out of every cache and out of search', () => {
    for (const path of ['/admin', '/admin/leads', '/api/admin/session']) {
      const h = headersFor(path)
      expect(h.get('Cache-Control'), path).toBe('no-store')
      expect(h.get('X-Robots-Tag'), path).toBe('noindex, nofollow')
    }
    expect(headersFor('/solutions').get('Cache-Control')).toBeNull()
  })

  it('keeps the preview deployment out of search', () => {
    expect(headersFor('/', 'devlab-studios-preview.example.workers.dev').get('X-Robots-Tag')).toBe('noindex, nofollow')
    expect(headersFor('/').get('X-Robots-Tag')).toBeNull()
  })

  it('leaves a WebSocket upgrade untouched', () => {
    const upgrade = { status: 101, headers: new Headers() } as unknown as Response
    expect(applySecurityHeaders(upgrade, '/pickleball/rt/open/ABC', 'www.devlabstudios.com')).toBe(upgrade)
  })
})

describe('public/_headers', () => {
  it('carries the same CSP and permissions as the middleware', () => {
    const file = readFileSync(resolve(__dirname, '../../public/_headers'), 'utf8')
    const csp = headersFor('/').get('Content-Security-Policy') ?? ''
    expect(file).toContain(`Content-Security-Policy: ${csp}`)
    expect(file).toContain(`Permissions-Policy: ${PERMISSIONS_POLICY}`)
    expect(file).not.toContain('zoho')
  })
})

describe('no layout requests Google Fonts (SEC-03)', () => {
  it.each(['src/layouts/PickleballAppShell.astro', 'src/layouts/BrandLayout.astro', 'astro.config.mjs'])('%s', async (path) => {
    const { readFileSync } = await import('node:fs')
    expect(readFileSync(path, 'utf8')).not.toMatch(/fonts\.(googleapis|gstatic)\.com/)
  })
})

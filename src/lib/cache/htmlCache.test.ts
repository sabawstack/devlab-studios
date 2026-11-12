import { describe, expect, it } from 'vitest'
import { cacheKeyUrl, isCacheablePath, isCacheableRequest, isStorableResponse, readGeneration, resetGenerationMemo } from './htmlCache'

const get = (url: string, headers: Record<string, string> = {}) => new Request(url, { headers })

describe('which requests may be served from the HTML cache (OPS-01)', () => {
  it('caches the business pages and articles', () => {
    for (const path of ['/', '/solutions', '/work', '/insights', '/insights/the-cost-of-a-silent-failure', '/about', '/profile', '/products', '/contact', '/privacy', '/terms', '/solutions/workflow-systems-audit', '/work/messenger-ai-agent']) {
      expect(isCacheablePath(path), path).toBe(true)
    }
  })

  it('never caches admin, API, preview, pickleball or the daily digest', () => {
    for (const path of ['/admin', '/admin/pages/home', '/api/health', '/api/admin/pages/home', '/pickleball', '/pickleball/new', '/insights/daily', '/brand', '/r/abc']) {
      expect(isCacheablePath(path), path).toBe(false)
    }
  })

  it('refuses non-GET, preview links and authorised requests', () => {
    expect(isCacheableRequest(get('https://www.devlabstudios.com/'), '/')).toBe(true)
    expect(isCacheableRequest(new Request('https://www.devlabstudios.com/', { method: 'POST' }), '/')).toBe(false)
    expect(isCacheableRequest(get('https://www.devlabstudios.com/terms?preview=p1.x.y'), '/terms')).toBe(false)
    expect(isCacheableRequest(get('https://www.devlabstudios.com/', { Authorization: 'Bearer x' }), '/')).toBe(false)
  })
})

describe('cache keys', () => {
  it('ignore tracking parameters but keep meaningful ones, and carry the generation and host', () => {
    expect(cacheKeyUrl(new URL('https://www.devlabstudios.com/contact?utm_source=x&type=workflow_audit&gclid=1'), 7))
      .toBe('https://www.devlabstudios.com/contact?type=workflow_audit&__g=7')
    expect(cacheKeyUrl(new URL('https://devlab-studios-preview.example.dev/'), 0)).toBe('https://devlab-studios-preview.example.dev/?__g=0')
  })
})

describe('which responses may be stored', () => {
  const html = (init: ResponseInit = {}) => new Response('<p>x</p>', { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }, ...init })
  it('stores a plain 200 HTML page', () => expect(isStorableResponse(html())).toBe(true))
  it('never stores a cookie, a no-store/private page, a non-200 or non-HTML', () => {
    expect(isStorableResponse(html({ headers: { 'Content-Type': 'text/html', 'Set-Cookie': 'a=b' } }))).toBe(false)
    expect(isStorableResponse(html({ headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-store, private' } }))).toBe(false)
    expect(isStorableResponse(html({ status: 404 }))).toBe(false)
    expect(isStorableResponse(new Response('{}', { headers: { 'Content-Type': 'application/json' } }))).toBe(false)
  })
})

describe('cache generation', () => {
  it('reads the stored generation, defaulting to 0, and reports null when D1 fails (bypass)', async () => {
    resetGenerationMemo()
    const db = (value: unknown) => ({ prepare: () => ({ bind: () => ({ first: async () => value }) }) }) as unknown as D1Database
    expect(await readGeneration(db({ value_json: '12' }), 0)).toBe(12)
    resetGenerationMemo()
    expect(await readGeneration(db(null), 0)).toBe(0)
    resetGenerationMemo()
    const failing = { prepare: () => ({ bind: () => ({ first: async () => { throw new Error('down') } }) }) } as unknown as D1Database
    expect(await readGeneration(failing, 0)).toBeNull()
  })
})

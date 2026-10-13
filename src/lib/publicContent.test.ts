// Public read endpoints (security audit L2): a failed D1 read answers the
// static-fallback shape with no error text and is never cached.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const runtime = vi.hoisted(() => ({ env: {} as Record<string, unknown> }))
vi.mock('cloudflare:workers', () => ({
  get env() {
    return runtime.env
  },
}))

const { servePublicContent } = await import('./publicContent')
const { GET: projects } = await import('../pages/api/projects')
const { GET: seo } = await import('../pages/api/seo/[pageSlug]')

const D1_ERROR = 'D1_ERROR: no such column: secret_column in SELECT * FROM internal_table'
const failingDb = {
  prepare: () => {
    throw new Error(D1_ERROR)
  },
}

beforeEach(() => {
  runtime.env = { DB: failingDb }
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

async function expectSafeFailure(response: Response, data: unknown) {
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  const text = await response.text()
  expect(text).not.toContain('secret_column')
  expect(JSON.parse(text)).toEqual({ data, source: 'static-fallback', configured: false })
}

describe('public content failures', () => {
  it('servePublicContent leaves the error out and is not cached', async () => {
    const response = await servePublicContent(async () => {
      throw new Error(D1_ERROR)
    }, null, 'articles')
    await expectSafeFailure(response, null)
    expect(console.error).toHaveBeenCalled()
  })

  it('a successful read is still cacheable', async () => {
    const response = await servePublicContent(async () => ({ ok: 1 }), null)
    expect(response.headers.get('Cache-Control')).toContain('s-maxage=300')
    expect(await response.json()).toEqual({ data: { ok: 1 }, source: 'd1', configured: true })
  })

  it('/api/projects', async () => {
    await expectSafeFailure(await (projects as () => Promise<Response>)(), [])
  })

  it('/api/seo/[pageSlug]', async () => {
    await expectSafeFailure(await (seo as (c: unknown) => Promise<Response>)({ params: { pageSlug: 'home' } }), null)
  })
})

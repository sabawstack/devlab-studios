import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { APIContext } from 'astro'

/**
 * L4: rollback re-validates a stored snapshot through the same schema as a
 * normal save before writing it back. Exercises the real route module with
 * its data dependencies stubbed.
 */

const state = vi.hoisted(() => ({
  version: null as null | { snapshot: unknown; status: string },
  replaced: [] as unknown[],
  upserted: [] as unknown[],
}))

vi.mock('./env', () => ({ getEnv: () => ({ DB: {} }) }))
vi.mock('../worker/repositories/contentVersions.js', () => ({
  getVersion: async () => state.version,
  recordVersion: async () => undefined,
}))
vi.mock('../worker/repositories/auditLog.js', () => ({
  recordAuditEvent: async () => undefined,
  logAuditFailure: () => undefined,
}))
vi.mock('../worker/adminRegistry.js', () => ({
  getReplaceAllCollection: () => null,
  getPerItemCollection: (type: string) => (type === 'projects'
    ? { schema: {}, upsert: async (_db: unknown, payload: unknown) => { state.upserted.push(payload); return payload } }
    : null),
  getSingletonContentType: (type: string) => (type === 'site-settings'
    ? { replace: async (_db: unknown, payload: unknown) => { state.replaced.push(payload); return payload } }
    : null),
}))

const { POST } = await import('../pages/api/admin/versions/[type]/rollback')

function rollback(type: string): Promise<Response> {
  const request = new Request(`https://example.com/api/admin/versions/${type}/rollback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ versionNumber: 3 }),
  })
  // Authenticated as the middleware would leave it, so withAdmin lets it through.
  const context = { params: { type }, request, locals: { adminEmail: 'admin@example.com', adminAuthMode: 'password' } }
  return POST(context as unknown as APIContext) as Promise<Response>
}

beforeEach(() => {
  state.version = null
  state.replaced = []
  state.upserted = []
})

describe('rollback validates the snapshot like a normal save', () => {
  it('refuses a snapshot carrying a javascript: link and writes nothing', async () => {
    state.version = { status: 'published', snapshot: { navigation: [{ label: 'x', href: 'javascript:alert(1)' }] } }

    const response = await rollback('site-settings')

    expect(response.status).toBe(400)
    expect(state.replaced).toHaveLength(0)
  })

  it('refuses a structurally invalid snapshot', async () => {
    state.version = { status: 'published', snapshot: { navigation: 'not-an-array' } }
    expect((await rollback('site-settings')).status).toBe(400)
    expect(state.replaced).toHaveLength(0)
  })

  it('restores a valid snapshot, writing the parsed data', async () => {
    state.version = { status: 'published', snapshot: { navigation: [{ label: 'Home', href: '/' }] } }

    const response = await rollback('site-settings')

    expect(response.status).toBe(200)
    expect(state.replaced).toHaveLength(1)
    expect(state.replaced[0]).toMatchObject({ navigation: [{ label: 'Home', href: '/' }], footer: {}, ctas: {} })
  })

  it('validates projects with the request schema, keeping the gallery', async () => {
    state.version = {
      status: 'published',
      snapshot: {
        id: 'p1', title: 'P', description: 'D', type: 'Website', liveUrl: '#', sourceUrl: '#',
        galleryImages: [{ url: 'https://cdn.example/a.webp', isThumbnail: true }],
      },
    }

    expect((await rollback('projects')).status).toBe(200)
    expect(state.upserted[0]).toMatchObject({ galleryImages: [{ url: 'https://cdn.example/a.webp' }] })

    state.version = { status: 'published', snapshot: { title: 'P', description: 'D', type: 'Website', liveUrl: 'javascript:x' } }
    expect((await rollback('projects')).status).toBe(400)
  })
})

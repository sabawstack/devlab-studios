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
  pages: [] as Array<{ slug: string; payload: unknown }>,
  projects: [] as Array<{ id: string; status: string }>,
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
vi.mock('../worker/repositories/pages.js', () => ({
  replacePage: async (_db: unknown, slug: string, payload: unknown) => {
    state.pages.push({ slug, payload })
    return { slug, ...(payload as object) }
  },
}))
vi.mock('../worker/repositories/projects.js', () => ({
  listProjects: async () => state.projects,
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

function rollback(type: string, contentId: string | null = null): Promise<Response> {
  const request = new Request(`https://example.com/api/admin/versions/${type}/rollback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ versionNumber: 3, contentId }),
  })
  // Authenticated as the middleware would leave it, so withAdmin lets it through.
  const context = { params: { type }, request, locals: { adminEmail: 'admin@example.com', adminAuthMode: 'password' } }
  return POST(context as unknown as APIContext) as Promise<Response>
}

beforeEach(() => {
  state.version = null
  state.replaced = []
  state.upserted = []
  state.pages = []
  state.projects = []
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

// CMS-01: restoring a page version answered 404 ("Unknown content type")
// because pages were never registered with the rollback route.
describe('rollback restores page versions', () => {
  const homeSnapshot = {
    slug: 'home', title: 'Home', status: 'published', createdAt: '2026-11-01T00:00:00.000Z',
    blocks: [{ type: 'richText', props: { body: 'Hello' } }],
  }

  it('restores a page snapshot through the page save checks', async () => {
    state.version = { status: 'published', snapshot: homeSnapshot }

    const response = await rollback('pages', 'home')

    expect(response.status).toBe(200)
    expect(state.pages).toHaveLength(1)
    expect(state.pages[0].slug).toBe('home')
    expect(state.pages[0].payload).toMatchObject({ title: 'Home', status: 'published' })
  })

  it('needs the page slug as contentId', async () => {
    state.version = { status: 'published', snapshot: homeSnapshot }
    expect((await rollback('pages')).status).toBe(400)
    expect(state.pages).toHaveLength(0)
  })

  it('refuses a page snapshot that no longer passes validation', async () => {
    state.version = { status: 'published', snapshot: { ...homeSnapshot, status: 'archived' } }
    expect((await rollback('pages', 'home')).status).toBe(400)
    expect(state.pages).toHaveLength(0)
  })

  it('refuses a Work snapshot that features a project that no longer exists', async () => {
    state.version = {
      status: 'published',
      snapshot: {
        slug: 'work', title: 'Work', status: 'published',
        blocks: [{
          type: 'workProjectShowcase',
          props: {
            heading: 'Selected work',
            items: [{ projectId: 'gone', status: 'draft' }],
          },
        }],
      },
    }
    const response = await rollback('pages', 'work')
    expect(response.status).toBe(400)
    expect(((await response.json()) as { error: string }).error).toMatch(/do not exist/)
    expect(state.pages).toHaveLength(0)
  })
})

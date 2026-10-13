import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { APIContext } from 'astro'

const runtime = vi.hoisted(() => ({ env: {} as Record<string, unknown> }))
vi.mock('./env', () => ({ getEnv: () => runtime.env }))

const { assertAdmin, withAdmin } = await import('./adminGuard')
const { handleAdminLogin } = await import('../worker/middleware/adminAuth.js')

const ADMIN_API_DIR = join(process.cwd(), 'src', 'pages', 'api', 'admin')
/** The only admin routes reachable without a session (they ARE the session). */
const PUBLIC_ADMIN_ROUTES = new Set(['login.ts', 'logout.ts'])
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'ALL', 'OPTIONS', 'HEAD']

function listRouteFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return listRouteFiles(path)
    return /\.(ts|js)$/.test(name) && !/\.test\./.test(name) ? [path] : []
  })
}

describe('every /api/admin route handler is wrapped in withAdmin', () => {
  const files = listRouteFiles(ADMIN_API_DIR)
    .map((path) => ({ path, name: relative(ADMIN_API_DIR, path).replace(/\\/g, '/') }))
    .filter(({ name }) => !PUBLIC_ADMIN_ROUTES.has(name))

  it('finds the admin routes (guards against the scan silently matching nothing)', () => {
    expect(files.length).toBeGreaterThan(40)
  })

  it.each(files.map(({ path, name }) => [name, path]))('%s', (_name, path) => {
    const source = readFileSync(path, 'utf8')
    const exported = METHODS.filter((method) =>
      new RegExp(`export\\s+(const|let|var|async\\s+function|function)\\s+${method}\\b`).test(source))

    expect(exported.length, 'route exports no HTTP method handler').toBeGreaterThan(0)
    for (const method of exported) {
      expect(source, `${method} must be exported as withAdmin(...)`)
        .toMatch(new RegExp(`export\\s+const\\s+${method}\\s*=\\s*withAdmin\\(`))
    }
    // Re-export forms (`export { x as GET }`) would bypass the check above.
    expect(source).not.toMatch(/export\s*\{[^}]*\bas\s+(GET|POST|PUT|PATCH|DELETE|ALL)\b/)
  })
})

// ---------------------------------------------------------------------------

const SESSION_SECRET = 'guard-test-session-secret'
const EMAIL = 'admin@example.com'
const PASSWORD = 'correct-horse-battery'

function base64Url(bytes: ArrayBuffer | Uint8Array): string {
  let binary = ''
  new Uint8Array(bytes).forEach((byte) => { binary += String.fromCharCode(byte) })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

async function pbkdf2Hash(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, key, 256)
  return `pbkdf2_sha256$100000$${base64Url(salt)}$${base64Url(bits)}`
}

const emptyDb = {
  prepare() {
    const statement = { bind: () => statement, first: async () => null, run: async () => ({ success: true }) }
    return statement
  },
}

function context(request: Request, locals: Record<string, unknown> = {}): APIContext {
  return { request, locals } as unknown as APIContext
}

async function sessionCookie(): Promise<string> {
  const request = new Request('https://example.com/api/admin/login', { method: 'POST' })
  const response = await handleAdminLogin({
    req: { header: () => null, json: async () => ({ email: EMAIL, password: PASSWORD }), raw: request, url: request.url },
    env: runtime.env,
    set() {},
    get() { return undefined },
  })
  expect(response.status).toBe(200)
  return (response.headers.get('Set-Cookie') || '').split(';')[0]
}

describe('withAdmin refuses unauthenticated requests on its own', () => {
  beforeEach(async () => {
    runtime.env = {
      ADMIN_AUTH_MODE: 'password',
      ADMIN_SESSION_SECRET: SESSION_SECRET,
      ADMIN_EMAIL: EMAIL,
      ADMIN_PASSWORD_HASH: await pbkdf2Hash(PASSWORD),
      DB: emptyDb,
    }
  })

  it('returns 401 without running the handler when there is no session (gate bypassed)', async () => {
    const handler = vi.fn(async () => new Response('ran'))
    const guarded = withAdmin(handler)

    // Exactly the C1 shape: the middleware never ran, so locals is empty.
    const response = await guarded(context(new Request('https://example.com/api/%61dmin/leads')))

    expect(handler).not.toHaveBeenCalled()
    expect(response.status).toBe(401)
  })

  it('refuses a forged/invalid cookie', async () => {
    const handler = vi.fn(async () => new Response('ran'))
    const response = await withAdmin(handler)(context(new Request('https://example.com/api/admin/leads', {
      headers: { Cookie: 'devlab_admin_session=v1.e30.AAAA' },
    })))

    expect(handler).not.toHaveBeenCalled()
    expect(response.status).toBe(401)
  })

  it('authenticates a real session itself when the middleware did not', async () => {
    const cookie = await sessionCookie()
    const handler = vi.fn(async () => new Response('ran'))
    const locals: Record<string, unknown> = {}

    const response = await withAdmin(handler)(context(new Request('https://example.com/api/admin/leads', {
      headers: { Cookie: cookie },
    }), locals))

    expect(handler).toHaveBeenCalledOnce()
    expect(await response.text()).toBe('ran')
    expect(locals.adminEmail).toBe(EMAIL)
  })

  it('trusts an identity the middleware already established', async () => {
    const handler = vi.fn(async () => new Response('ran'))
    const response = await withAdmin(handler)(context(
      new Request('https://example.com/api/admin/leads'),
      { adminEmail: EMAIL, adminAuthMode: 'password' },
    ))

    expect(handler).toHaveBeenCalledOnce()
    expect(response.status).toBe(200)
  })

  it('fails closed when auth is unconfigured', async () => {
    runtime.env = { DB: emptyDb }
    expect((await assertAdmin(context(new Request('https://example.com/api/admin/leads'))))?.status).toBe(503)
  })
})

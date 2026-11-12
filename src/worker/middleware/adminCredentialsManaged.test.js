import { readdirSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSqliteD1 } from '../repositories/pickleball/open/testing/sqliteD1'
import { handleAdminLogin, hashPassword, requireAdmin } from './adminAuth.js'
import { deleteAdminCredential, listAdminCredentials, upsertAdminCredential } from '../repositories/adminCredentials.js'

// CMS-04 / SEC-02: more than one admin login, managed in the CMS. A login
// created in the admin can sign in with the same hashing; removing it ends its
// sessions at once; the environment bootstrap admin is unaffected.
const SESSION_SECRET = 'managed-credentials-test-secret'
const OWNER = 'owner@example.com'
const SECOND = 'second@example.com'
const migrations = readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort().map((f) => `migrations/${f}`)

function limiter() {
  const stub = {
    async check() { return { limited: false, retryAfterSeconds: 0 } },
    async peek() { return { limited: false, retryAfterSeconds: 0 } },
    async record() {},
    async reset() {},
  }
  return { idFromName: (n) => n, get: () => stub }
}

function context(env, { body, cookie, url = 'https://example.com/api/admin/leads' } = {}) {
  const headers = { 'cf-connecting-ip': '203.0.113.9', ...(cookie ? { Cookie: cookie } : {}) }
  const locals = {}
  return {
    locals,
    req: { header: (name) => headers[Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase())] ?? null, json: async () => body, raw: new Request(url, { headers }), url },
    env,
    set(key, value) { locals[key] = value },
    get(key) { return locals[key] },
  }
}

async function setup() {
  const { d1 } = createSqliteD1(migrations)
  const env = {
    ADMIN_AUTH_MODE: 'password',
    ADMIN_SESSION_SECRET: SESSION_SECRET,
    ADMIN_EMAIL: OWNER,
    ADMIN_PASSWORD_HASH: await hashPassword('owner-password-123'),
    DB: d1,
    RATE_LIMITER: limiter(),
  }
  await upsertAdminCredential(d1, { email: SECOND, passwordHash: await hashPassword('second-password-123'), role: 'owner' })
  return env
}

async function signIn(env, email, password) {
  const response = await handleAdminLogin(context(env, { body: { email, password }, url: 'https://example.com/api/admin/login' }))
  return { response, cookie: (response.headers.get('Set-Cookie') || '').split(';')[0] }
}

const allowed = async (env, cookie) => {
  let ran = false
  const result = await requireAdmin(context(env, { cookie }), async () => { ran = true })
  return { ran, status: result?.status }
}

afterEach(() => vi.restoreAllMocks())

describe('managed admin logins', () => {
  it('a login created in the CMS can sign in', async () => {
    const env = await setup()
    const { response, cookie } = await signIn(env, SECOND, 'second-password-123')
    expect(response.status).toBe(200)
    expect((await allowed(env, cookie)).ran).toBe(true)
  })

  it('removing a login ends its live sessions immediately', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const env = await setup()
    const { cookie } = await signIn(env, SECOND, 'second-password-123')
    await deleteAdminCredential(env.DB, SECOND)
    const after = await allowed(env, cookie)
    expect(after.ran).toBe(false)
    expect(after.status).toBe(401)
  })

  it('the environment bootstrap admin keeps working without a stored row', async () => {
    const env = await setup()
    const { response, cookie } = await signIn(env, OWNER, 'owner-password-123')
    expect(response.status).toBe(200)
    expect((await allowed(env, cookie)).ran).toBe(true)
  })

  it('lists logins without ever returning a hash', async () => {
    const env = await setup()
    const rows = await listAdminCredentials(env.DB)
    expect(rows.map((row) => row.email)).toContain(SECOND)
    expect(JSON.stringify(rows)).not.toMatch(/pbkdf2/)
  })
})

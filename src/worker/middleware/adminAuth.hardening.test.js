import { afterEach, describe, expect, it, vi } from 'vitest'
import { handleAdminLogin, requireAdmin } from './adminAuth.js'

/**
 * October 2026 audit follow-ups: per-account login lockout (M2), constant
 * work for unknown emails (L1), revocation check failing closed (L2) and
 * ADMIN_AUTH_MODE=disabled being refused outside localhost (L3).
 */

const SESSION_SECRET = 'hardening-test-secret'
const PASSWORD = 'correct-horse-battery'
const EMAIL = 'admin@example.com'

function base64Url(bytes) {
  let binary = ''
  new Uint8Array(bytes).forEach((byte) => { binary += String.fromCharCode(byte) })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

async function pbkdf2Hash(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, key, 256)
  return `pbkdf2_sha256$100000$${base64Url(salt)}$${base64Url(bits)}`
}

/** Same semantics as RateLimiterDO (check / peek / record / reset), in memory. */
function fakeRateLimiter() {
  const windows = new Map()
  const live = (key) => {
    const window = windows.get(key)
    return window && Date.now() < window.resetAt ? window : undefined
  }
  const stub = {
    async check(key, limit, windowMs) {
      const existing = live(key)
      const next = existing ? { ...existing, count: existing.count + 1 } : { count: 1, resetAt: Date.now() + windowMs }
      windows.set(key, next)
      const limited = next.count > limit
      return { limited, retryAfterSeconds: limited ? Math.ceil((next.resetAt - Date.now()) / 1000) : 0 }
    },
    async peek(key, limit) {
      const existing = live(key)
      if (!existing) return { limited: false, retryAfterSeconds: 0 }
      const limited = existing.count >= limit
      return { limited, retryAfterSeconds: limited ? Math.ceil((existing.resetAt - Date.now()) / 1000) : 0 }
    },
    async record(key, windowMs) {
      const existing = live(key)
      windows.set(key, existing ? { ...existing, count: existing.count + 1 } : { count: 1, resetAt: Date.now() + windowMs })
    },
    async reset(key) { windows.delete(key) },
  }
  return { windows, idFromName: (name) => name, get: () => stub }
}

function fakeDb({ revoked = new Set(), failRevocationLookup = false } = {}) {
  return {
    prepare(sql) {
      const statement = {
        args: [],
        bind(...args) { statement.args = args; return statement },
        async run() { return { success: true } },
        async first() {
          if (sql.includes('admin_session_revocations')) {
            if (failRevocationLookup) throw new Error('D1_ERROR: network connection lost')
            return revoked.has(statement.args[0]) ? { revoked: 1 } : null
          }
          return null
        },
      }
      return statement
    },
  }
}

function makeContext({ env, body, cookie, ip = '203.0.113.1', url = 'https://example.com/api/admin/login' }) {
  const headers = { 'cf-connecting-ip': ip, ...(cookie ? { Cookie: cookie } : {}) }
  const locals = {}
  return {
    locals,
    req: {
      header: (name) => headers[Object.keys(headers).find((key) => key.toLowerCase() === name.toLowerCase())] ?? null,
      json: async () => body,
      raw: new Request(url, { headers }),
      url,
    },
    env,
    set(key, value) { locals[key] = value },
    get(key) { return locals[key] },
  }
}

async function passwordEnv(overrides = {}) {
  return {
    ADMIN_AUTH_MODE: 'password',
    ADMIN_SESSION_SECRET: SESSION_SECRET,
    ADMIN_EMAIL: EMAIL,
    ADMIN_PASSWORD_HASH: await pbkdf2Hash(PASSWORD),
    DB: fakeDb(),
    RATE_LIMITER: fakeRateLimiter(),
    ...overrides,
  }
}

const login = (env, password, ip, email = EMAIL) =>
  handleAdminLogin(makeContext({ env, body: { email, password }, ip }))

afterEach(() => {
  vi.restoreAllMocks()
})

describe('M2: per-account lockout across source addresses', () => {
  it('locks the account after 10 failures from 10 different IPs, even for the right password', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const env = await passwordEnv()

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await login(env, 'wrong-password', `198.51.100.${attempt}`)
      expect(response.status).toBe(401)
    }

    // A fresh address and the CORRECT password: still refused, because the
    // per-IP limits never saw enough from any one address to trip.
    const locked = await login(env, PASSWORD, '192.0.2.250')
    expect(locked.status).toBe(429)
    expect((await locked.json()).error).toBe('Too many login attempts. Try again later.')
    expect(Number(locked.headers.get('retry-after'))).toBeGreaterThan(0)
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('admin_login_account_locked'))
  })

  it('expires the lock after 15 minutes', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const env = await passwordEnv()
      for (let attempt = 0; attempt < 10; attempt += 1) await login(env, 'wrong-password', `198.51.100.${attempt}`)
      expect((await login(env, PASSWORD, '192.0.2.1')).status).toBe(429)

      vi.setSystemTime(Date.now() + 15 * 60 * 1000 + 1000)
      expect((await login(env, PASSWORD, '192.0.2.2')).status).toBe(200)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not lock below the threshold, and a success clears the failure count', async () => {
    const env = await passwordEnv()
    for (let attempt = 0; attempt < 9; attempt += 1) await login(env, 'wrong-password', `198.51.100.${attempt}`)
    expect((await login(env, PASSWORD, '192.0.2.1')).status).toBe(200)

    // Counter was reset by the success: 9 more failures still do not lock.
    for (let attempt = 0; attempt < 9; attempt += 1) await login(env, 'wrong-password', `198.51.100.${attempt + 20}`)
    expect((await login(env, PASSWORD, '192.0.2.2')).status).toBe(200)
  })

  it('locks only the targeted account', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const env = await passwordEnv()
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await login(env, 'wrong-password', `198.51.100.${attempt}`, 'someone-else@example.com')
    }
    expect((await login(env, PASSWORD, '192.0.2.9')).status).toBe(200)
  })

  it('still enforces the per-IP limit', async () => {
    const env = await passwordEnv()
    let last
    for (let attempt = 0; attempt < 9; attempt += 1) last = await login(env, 'wrong-password', '203.0.113.7')
    expect(last.status).toBe(429)
  })
})

describe('L1: unknown emails cost the same PBKDF2 work', () => {
  it('derives a key for an unknown email instead of returning early', async () => {
    const env = await passwordEnv()
    // Warm the dummy hash so only the verification derive is counted.
    await login(env, 'x', '192.0.2.10', 'warm-up@example.com')

    const derive = vi.spyOn(crypto.subtle, 'deriveBits')
    const response = await login(env, 'whatever', '192.0.2.11', 'nobody@example.com')

    expect(response.status).toBe(401)
    expect((await response.json()).error).toBe('Invalid email or password.')
    expect(derive).toHaveBeenCalledTimes(1)
    expect(derive.mock.calls[0][0]).toMatchObject({ name: 'PBKDF2', iterations: 100000 })
  })

  it('gives an unknown email the same response as a wrong password', async () => {
    const env = await passwordEnv()
    const unknown = await login(env, PASSWORD, '192.0.2.12', 'nobody@example.com')
    const wrong = await login(env, 'wrong-password', '192.0.2.13')
    expect(unknown.status).toBe(wrong.status)
    expect(await unknown.json()).toEqual(await wrong.json())
  })
})

describe('L2: the revocation check fails closed', () => {
  async function cookieFor(env) {
    const response = await login(env, PASSWORD, '192.0.2.20')
    expect(response.status).toBe(200)
    return (response.headers.get('Set-Cookie') || '').split(';')[0]
  }

  it('refuses a valid token when the revocation lookup errors', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const env = await passwordEnv()
    const cookie = await cookieFor(env)
    const failing = { ...env, DB: fakeDb({ failRevocationLookup: true }) }

    const next = vi.fn()
    const response = await requireAdmin(makeContext({ env: failing, cookie, url: 'https://example.com/api/admin/session' }), next)

    expect(next).not.toHaveBeenCalled()
    expect(response.status).toBe(503)
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('admin_session_revocation_check'))
  })

  it('refuses when there is no database to check against', async () => {
    const env = await passwordEnv()
    const cookie = await cookieFor(env)
    const next = vi.fn()
    const response = await requireAdmin(makeContext({ env: { ...env, DB: undefined }, cookie }), next)

    expect(next).not.toHaveBeenCalled()
    expect(response.status).toBe(503)
  })

  it('still accepts a valid, unrevoked token', async () => {
    const env = await passwordEnv()
    const cookie = await cookieFor(env)
    const next = vi.fn(async () => undefined)
    await requireAdmin(makeContext({ env, cookie }), next)
    expect(next).toHaveBeenCalled()
  })
})

describe('L3: ADMIN_AUTH_MODE=disabled outside local development', () => {
  it('is refused on a deployed hostname', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const next = vi.fn()
    const response = await requireAdmin(makeContext({
      env: { ADMIN_AUTH_MODE: 'disabled', ADMIN_AUTH_DISABLED_LOCAL_ONLY: 'true', DB: fakeDb() },
      url: 'https://www.devlabstudios.com/api/admin/session',
    }), next)

    expect(next).not.toHaveBeenCalled()
    expect(response.status).toBe(503)
  })

  it('is refused on localhost without the explicit local-only opt-in', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const next = vi.fn()
    const response = await requireAdmin(makeContext({
      env: { ADMIN_AUTH_MODE: 'disabled', DB: fakeDb() },
      url: 'http://localhost:8787/api/admin/session',
    }), next)

    expect(next).not.toHaveBeenCalled()
    expect(response.status).toBe(503)
  })

  it('is honoured only on localhost with the opt-in', async () => {
    const next = vi.fn(async () => undefined)
    await requireAdmin(makeContext({
      env: { ADMIN_AUTH_MODE: 'disabled', ADMIN_AUTH_DISABLED_LOCAL_ONLY: 'true', DB: fakeDb() },
      url: 'http://127.0.0.1:8787/api/admin/session',
    }), next)

    expect(next).toHaveBeenCalled()
  })
})

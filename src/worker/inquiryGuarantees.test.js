// Guard tests for the inquiry guarantees in the audit's Section L / LEAD-01.
// Each test fails if its guarantee regresses. Persistence-before-delivery,
// failure recording, idempotency and the confirmation cap are covered in
// inquiryService.test.js and delivery/confirmation.test.js; this file adds
// Turnstile enforcement, route ordering, the shared schema and per-call
// attempt recording.
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const runtime = vi.hoisted(() => ({ env: {} }))
vi.mock('cloudflare:workers', () => ({
  get env() {
    return runtime.env
  },
}))

const { enforceSubmissionGuards, submitInquiry } = await import('./inquiryService.js')
const { POST: inquiries } = await import('../pages/api/inquiries')
const { inquiryRequestSchema } = await import('../lib/schemas/inquiry')

const DEPLOYED = 'https://www.devlabstudios.com'
const PREVIEW = 'https://devlab-studios-preview.stpnrey-agustinez.workers.dev'

/** A D1 stand-in that fails the test if anything touches it. */
function untouchableDb() {
  return {
    prepare() {
      throw new Error('the database must not be touched before verification passes')
    },
    batch() {
      throw new Error('the database must not be touched before verification passes')
    },
  }
}

function validInquiry(overrides = {}) {
  return {
    inquiryType: 'business_system',
    fullName: 'Dana Reyes',
    email: 'dana@example.com',
    message: 'Inquiries land in a shared inbox and follow-up depends on someone remembering to check it.',
    company: 'Example Co',
    desiredOutcome: 'Every inquiry gets an owner.',
    timeline: 'within_month',
    preferredContact: 'email',
    consent: { granted: true, consentTextVersion: '2026-09-17', privacyPolicyVersion: '2026-09-17' },
    turnstileToken: 'token-from-the-widget',
    ...overrides,
  }
}

const guardArgs = { bucket: 'inquiry', action: 'contact_form', turnstileToken: 'token-from-the-widget' }
const request = (origin) => new Request(`${origin}/api/inquiries`, { method: 'POST' })

let fetchSpy
beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch')
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('Turnstile is enforced on deployed hosts', () => {
  for (const origin of [DEPLOYED, PREVIEW]) {
    it(`${origin}: refuses (503) when the secret is missing, without calling siteverify`, async () => {
      const response = await enforceSubmissionGuards({}, request(origin), guardArgs)
      expect(response?.status).toBe(503)
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it(`${origin}: refuses (400) a token siteverify rejects`, async () => {
      fetchSpy.mockResolvedValue(new Response(JSON.stringify({ success: false, 'error-codes': ['invalid-input-response'] })))
      const response = await enforceSubmissionGuards({ TURNSTILE_SECRET_KEY: 'secret' }, request(origin), guardArgs)
      expect(response?.status).toBe(400)
    })

    it(`${origin}: refuses (400) a token issued for another hostname`, async () => {
      fetchSpy.mockResolvedValue(new Response(JSON.stringify({ success: true, hostname: 'attacker.example', action: 'contact_form' })))
      const response = await enforceSubmissionGuards({ TURNSTILE_SECRET_KEY: 'secret' }, request(origin), guardArgs)
      expect(response?.status).toBe(400)
    })

    it(`${origin}: refuses (400) a missing token`, async () => {
      const response = await enforceSubmissionGuards({ TURNSTILE_SECRET_KEY: 'secret' }, request(origin), { ...guardArgs, turnstileToken: '' })
      expect(response?.status).toBe(400)
    })
  }

  it(`passes a token siteverify accepts for this host and action`, async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ success: true, hostname: 'www.devlabstudios.com', action: 'contact_form' })))
    expect(await enforceSubmissionGuards({ TURNSTILE_SECRET_KEY: 'secret' }, request(DEPLOYED), guardArgs)).toBeNull()
  })

  it('allows the missing-secret test flow only on localhost', async () => {
    expect(await enforceSubmissionGuards({}, request('http://localhost:4173'), guardArgs)).toBeNull()
    expect(await enforceSubmissionGuards({}, request('http://127.0.0.1:8787'), guardArgs)).toBeNull()
  })
})

describe('POST /api/inquiries verifies before it persists', () => {
  it('the test body is otherwise valid (so a refusal below is the guard, not validation)', () => {
    expect(inquiryRequestSchema.safeParse(validInquiry()).success).toBe(true)
  })

  it('answers 503 without touching the database when Turnstile is unconfigured on the live host', async () => {
    runtime.env = { DB: untouchableDb() }
    const response = await inquiries({
      request: new Request(`${DEPLOYED}/api/inquiries`, {
        method: 'POST',
        body: JSON.stringify(validInquiry()),
        headers: { 'Content-Type': 'application/json' },
      }),
      locals: {},
    })
    expect(response.status).toBe(503)
  })
})

describe('every public form route runs the guards before submitInquiry', () => {
  const routes = ['src/pages/api/inquiries.ts', 'src/pages/api/contact.ts', 'src/pages/api/lead-magnet.ts']

  it.each(routes)('%s', (path) => {
    const source = readFileSync(path, 'utf8')
    const guard = source.indexOf('await enforceSubmissionGuards(')
    const submit = source.indexOf('submitInquiry(env')
    expect(guard, 'calls enforceSubmissionGuards').toBeGreaterThan(-1)
    expect(submit, 'calls submitInquiry').toBeGreaterThan(-1)
    expect(guard).toBeLessThan(submit)
    expect(source).toMatch(/if \(guardResponse\) return guardResponse/)
    // The missing-secret opt-in is for tests on localhost only.
    expect(source).not.toMatch(/allowMissingSecret\s*:\s*true/)
  })
})

describe('the form and the route validate with the same schema', () => {
  it('both import inquiryRequestSchema from src/lib/schemas/inquiry', () => {
    const form = readFileSync('src/components/islands/InquiryForm.jsx', 'utf8')
    const route = readFileSync('src/pages/api/inquiries.ts', 'utf8')
    const importsShared = /import\s*\{[^}]*\binquiryRequestSchema\b[^}]*\}\s*from\s*'[./]+lib\/schemas\/inquiry'/
    expect(form).toMatch(importsShared)
    expect(route).toMatch(importsShared)
    expect(route).toMatch(/inquiryRequestSchema\.safeParse\(/)
    expect(form).toMatch(/inquiryRequestSchema\.safeParse\(/)
  })
})

describe('every delivery call is recorded as an attempt', () => {
  function recordingDb() {
    const tables = { leads: [], delivery_attempts: [] }
    const statement = (sql, args) => ({
      run: async () => {
        if (/^\s*INSERT INTO leads\b/i.test(sql)) tables.leads.push({ id: args[0], email: args[2], message: args[4] })
        if (/^\s*INSERT INTO delivery_attempts/i.test(sql)) {
          tables.delivery_attempts.push({ skipped: args.some((value) => typeof value === 'string' && value.startsWith('skipped_')) })
        }
      },
      first: async () => {
        if (/FROM leads WHERE id = \?/i.test(sql)) return tables.leads.find((row) => row.id === args[0]) ?? null
        if (/COUNT\(\*\) as count FROM delivery_attempts/i.test(sql)) return { count: tables.delivery_attempts.length }
        return null
      },
      all: async () => ({ results: [] }),
    })
    return {
      tables,
      prepare: (sql) => ({ bind: (...args) => statement(sql, args) }),
      batch: async (statements) => {
        for (const s of statements) await s.run()
      },
    }
  }

  // A withheld send (the confirmation cap, here unavailable in the fake) is
  // recorded too, as a `skipped_*` attempt, so the admin shows why nothing went out.
  function expectEverySendRecorded(db) {
    const sends = db.tables.delivery_attempts.filter((row) => !row.skipped)
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(0)
    expect(sends.length).toBe(fetchSpy.mock.calls.length)
    expect(db.tables.delivery_attempts.filter((row) => row.skipped).length).toBe(1)
  }

  it('one attempt row per outbound provider call, on success', async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ id: 'email_1' }), { status: 200 }))
    const db = recordingDb()
    const response = await submitInquiry({ DB: db, RESEND_API_KEY: 'test' }, {
      input: inquiryRequestSchema.parse(validInquiry()),
      source: 'inquiry-form',
      consentType: 'contact',
    })
    expect(response.status).toBe(200)
    expectEverySendRecorded(db)
  })

  it('one attempt row per outbound provider call, on failure', async () => {
    fetchSpy.mockResolvedValue(new Response('{}', { status: 500 }))
    const db = recordingDb()
    await submitInquiry({ DB: db, RESEND_API_KEY: 'test' }, {
      input: inquiryRequestSchema.parse(validInquiry()),
      source: 'inquiry-form',
      consentType: 'contact',
    })
    expectEverySendRecorded(db)
  })
})

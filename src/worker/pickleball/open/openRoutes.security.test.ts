// Route-level checks for the anonymous open-play routes (security audit M1,
// L1, L3): bodies are capped and validated before the Durable Object is
// called, only parsed data reaches it, and the create and check-in limiters
// fail closed. getEnv() reads cloudflare:workers, mocked here.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const runtime = vi.hoisted(() => ({ env: {} as Record<string, unknown> }))
vi.mock('cloudflare:workers', () => ({
  get env() {
    return runtime.env
  },
}))

const { POST: commands } = await import('../../../pages/api/pickleball/open/s/[code]/commands')
const { POST: checkIn } = await import('../../../pages/api/pickleball/open/s/[code]/check-in')
const { POST: captains } = await import('../../../pages/api/pickleball/open/s/[code]/captains')
const { POST: claim } = await import('../../../pages/api/pickleball/open/s/[code]/claim')
const { POST: sessions } = await import('../../../pages/api/pickleball/open/sessions')

const BASE = 'https://www.devlabstudios.com'
const CODE = 'AAAAA22222'
type Route = (context: never) => Response | Promise<Response>
const call = (route: Route, request: Request) => route({ request, params: { code: CODE }, locals: {} } as never)

function chunked(text: string, headers: Record<string, string> = {}): Request {
  const data = new TextEncoder().encode(text)
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < data.byteLength; i += 1024) controller.enqueue(data.slice(i, i + 1024))
      controller.close()
    },
  })
  return new Request(`${BASE}/api/x`, { method: 'POST', body: stream, duplex: 'half', headers } as RequestInit)
}
const json = (body: unknown, headers: Record<string, string> = {}) =>
  new Request(`${BASE}/api/x`, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', ...headers } })

const ok = { status: 200, body: {} }
let stub: Record<string, ReturnType<typeof vi.fn>>
let limiter: ReturnType<typeof vi.fn>

beforeEach(() => {
  stub = { command: vi.fn(async () => ok), checkIn: vi.fn(async () => ok), createCaptain: vi.fn(async () => ok), claim: vi.fn(async () => ok) }
  limiter = vi.fn(async () => ({ limited: false, retryAfterSeconds: 0 }))
  runtime.env = {
    OPEN_SESSION: { idFromName: (name: string) => name, get: () => stub },
    RATE_LIMITER: { idFromName: (name: string) => name, get: () => ({ check: limiter }) },
  }
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('POST …/commands', () => {
  it('413s an oversized chunked body and never calls the DO', async () => {
    const response = await call(commands, chunked(JSON.stringify({ idempotencyKey: 'key-0001', pad: 'x'.repeat(40 * 1024) })))
    expect(response.status).toBe(413)
    expect(await response.json()).toEqual({ error: 'That request is too large.' })
    expect(stub.command).not.toHaveBeenCalled()
  })

  it('400s an invalid envelope in the route', async () => {
    const response = await call(commands, json({ idempotencyKey: 'key-0001', command: { type: 'NOPE' } }))
    expect(response.status).toBe(400)
    expect(stub.command).not.toHaveBeenCalled()
  })

  it('passes only the parsed envelope on', async () => {
    const response = await call(commands, json({ idempotencyKey: 'key-0001', command: { type: 'END_SESSION', extra: 1 }, junk: 'x' }))
    expect(response.status).toBe(200)
    expect(stub.command).toHaveBeenCalledWith(CODE, { hostKey: null, captainKey: null }, { idempotencyKey: 'key-0001', command: { type: 'END_SESSION' } })
  })
})

describe('POST …/check-in', () => {
  it('forwards the parsed fields, never the raw body', async () => {
    await call(checkIn, json({ name: 'Ana', skill: 3, padding: 'x'.repeat(1000) }))
    expect(stub.checkIn).toHaveBeenCalledWith(CODE, { name: 'Ana', skill: 3 })
  })

  it('413s an oversized chunked body', async () => {
    const response = await call(checkIn, chunked(JSON.stringify({ name: 'Ana', pad: 'x'.repeat(8 * 1024) })))
    expect(response.status).toBe(413)
    expect(stub.checkIn).not.toHaveBeenCalled()
  })

  it('400s a body that does not fit the schema, with a generic message', async () => {
    const response = await call(checkIn, json({ name: 7 }))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Check your details and try again.' })
  })

  it('fails closed with 503 when the limiter errors, not only when the binding is missing', async () => {
    limiter.mockRejectedValue(new Error('DO unavailable'))
    const errored = await call(checkIn, json({ name: 'Ana' }))
    expect(errored.status).toBe(503)
    expect(await errored.json()).toEqual({ error: 'Check-in is temporarily unavailable. Try again shortly.' })
    runtime.env = { ...runtime.env, RATE_LIMITER: undefined }
    expect((await call(checkIn, json({ name: 'Ana' }))).status).toBe(503)
    expect(stub.checkIn).not.toHaveBeenCalled()
  })
})

describe('POST …/captains', () => {
  it('validates in the route and passes parsed data on', async () => {
    expect((await call(captains, json({ label: 'x' }))).status).toBe(400)
    expect(stub.createCaptain).not.toHaveBeenCalled()
    await call(captains, json({ courtId: 'c1', junk: true }))
    expect(stub.createCaptain).toHaveBeenCalledWith(CODE, null, { courtId: 'c1' })
  })

  it('413s an oversized body', async () => {
    expect((await call(captains, chunked(JSON.stringify({ courtId: 'c1', label: 'x'.repeat(8 * 1024) })))).status).toBe(413)
  })
})

describe('POST …/claim', () => {
  it('takes no body: a large one is refused with 413', async () => {
    const response = await call(claim, chunked('x'.repeat(8 * 1024), { Origin: BASE }))
    expect(response.status).toBe(413)
    expect(stub.claim).not.toHaveBeenCalled()
  })
})

describe('POST /api/pickleball/open/sessions', () => {
  it('fails closed with 503 when the limiter errors', async () => {
    limiter.mockRejectedValue(new Error('DO unavailable'))
    const response = await call(sessions, json({}))
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'Starting sessions is temporarily unavailable. Try again shortly.' })
  })

  it('413s a body over the session-create cap', async () => {
    const response = await call(sessions, chunked(JSON.stringify({ name: 'x', pad: 'x'.repeat(70 * 1024) })))
    expect(response.status).toBe(413)
  })

  it('400s an invalid body under the cap', async () => {
    expect((await call(sessions, json({ name: '' }))).status).toBe(400)
  })
})

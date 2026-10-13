// Abuse limits on the session coordinator (security audit M2, M3): the
// per-session socket cap, WebSocket message size and rate limits, RESYNC from
// cached frames, and a check-in allowance that only real changes spend.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSqliteD1 } from '../../repositories/pickleball/open/testing/sqliteD1'
import { createOpenSession } from '../../repositories/pickleball/open/openSessions'
import { buildInitialState } from '../../../lib/pickleball/open/create'
import { DEFAULT_SETTINGS } from '../../../lib/pickleball/open/types'
import { sha256Base64Url } from '../../../lib/pickleball/webCrypto.js'
import { MAX_SOCKETS, MAX_WS_MESSAGE_BYTES, OpenSessionDO, spendBudget, WS_AUTH_LIMIT, WS_MESSAGE_LIMIT, WS_MESSAGE_WINDOW_MS } from './OpenSessionDO'

vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    constructor(protected ctx: unknown, protected env: unknown) {}
  },
}))

// Counts how often each snapshot is built, to prove RESYNC reuses the cached frames.
const built = vi.hoisted(() => ({ host: 0, viewer: 0 }))
vi.mock('../../../lib/pickleball/open/snapshot', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../lib/pickleball/open/snapshot')>()
  return {
    ...real,
    toHostSnapshot: (...args: Parameters<typeof real.toHostSnapshot>) => {
      built.host += 1
      return real.toHostSnapshot(...args)
    },
    toViewerSnapshot: (...args: Parameters<typeof real.toViewerSnapshot>) => {
      built.viewer += 1
      return real.toViewerSnapshot(...args)
    },
  }
})

const CODE = 'AAAAA22222'
const MIGRATIONS = ['0016_open_sessions', '0017_open_captains', '0018_open_tournaments', '0019_hosts'].map((m) => `migrations/pickleball/${m}.sql`)

function fakeSocket(attachment: unknown = { code: CODE, role: 'viewer' }) {
  let stored = attachment
  const sent: Array<{ type: string }> = []
  const raw: string[] = []
  return {
    sent,
    raw,
    attachment: () => stored,
    close: vi.fn(),
    send: (message: string) => {
      raw.push(message)
      sent.push(JSON.parse(message))
    },
    serializeAttachment: (value: unknown) => { stored = value },
    deserializeAttachment: () => stored,
  }
}
type FakeSocket = ReturnType<typeof fakeSocket>

async function setup() {
  const { d1 } = createSqliteD1(MIGRATIONS)
  const now = new Date().toISOString()
  let n = 0
  const state = buildInitialState(
    { name: 'Saturday', hostDisplayName: 'Mo', location: null, courtCount: 1, settings: DEFAULT_SETTINGS, players: [] },
    { now, newId: () => `id-${(n += 1)}`, publicCode: CODE, sessionId: 'sess-1' },
  )
  await createOpenSession(d1, state, await sha256Base64Url('host-key'))
  const sockets: FakeSocket[] = []
  const ctx = { id: { equals: (o: unknown) => o === CODE }, getWebSockets: () => sockets }
  const env = { PICKLEBALL_DB: d1, OPEN_SESSION: { idFromName: (name: string) => name } }
  const coordinator = new OpenSessionDO(ctx as unknown as DurableObjectState, env as unknown as Env)
  const message = (ws: FakeSocket, data: unknown) =>
    coordinator.webSocketMessage(ws as unknown as WebSocket, typeof data === 'string' ? data : JSON.stringify(data))
  return { coordinator, sockets, message }
}

beforeEach(() => {
  built.host = 0
  built.viewer = 0
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

describe('check-in allowance (M3)', () => {
  it('a repeat check-in for a name already playing is a 200 no-op that spends nothing', async () => {
    const { coordinator } = await setup()
    expect((await coordinator.checkIn(CODE, { name: 'Ana' })).status).toBe(201)
    // Far past the 60-per-5-minutes session allowance: every one is still answered 200.
    for (let i = 0; i < 100; i += 1) {
      const repeat = await coordinator.checkIn(CODE, { name: 'ana' })
      expect(repeat.status).toBe(200)
      expect(repeat.body).toMatchObject({ alreadyCheckedIn: true })
    }
    // ...and real arrivals are not locked out by them.
    expect((await coordinator.checkIn(CODE, { name: 'Ben' })).status).toBe(201)
  })

  it('check-ins that add players still spend the allowance and hit 429', async () => {
    const { coordinator } = await setup()
    const statuses: number[] = []
    for (let i = 0; i < 61; i += 1) statuses.push((await coordinator.checkIn(CODE, { name: `Player ${i}` })).status)
    expect(statuses.slice(0, 60).every((s) => s === 201)).toBe(true)
    expect(statuses[60]).toBe(429)
    // A name already in still answers 200 while the allowance is used up.
    expect((await coordinator.checkIn(CODE, { name: 'Player 1' })).status).toBe(200)
  })

  it('refuses a malformed body before it queues', async () => {
    const { coordinator } = await setup()
    expect((await coordinator.checkIn(CODE, { name: 42 })).status).toBe(400)
  })
})

describe('WebSocket limits (M2)', () => {
  it('refuses a new socket with 429 once the session has MAX_SOCKETS', async () => {
    const { coordinator, sockets } = await setup()
    for (let i = 0; i < MAX_SOCKETS; i += 1) sockets.push(fakeSocket())
    const response = await coordinator.fetch(new Request('https://x/', { headers: { Upgrade: 'websocket', 'X-Open-Code': CODE } }))
    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('30')
  })

  it('closes a socket that sends a message over the size cap, before parsing it', async () => {
    const { sockets, message } = await setup()
    const ws = fakeSocket()
    sockets.push(ws)
    await message(ws, JSON.stringify({ type: 'RESYNC', pad: 'x'.repeat(MAX_WS_MESSAGE_BYTES) }))
    expect(ws.close).toHaveBeenCalledWith(1009, 'Message too large')
    expect(ws.sent).toHaveLength(0)
  })

  it('closes a binary message over the size cap too', async () => {
    const { coordinator, sockets } = await setup()
    const ws = fakeSocket()
    sockets.push(ws)
    await coordinator.webSocketMessage(ws as unknown as WebSocket, new ArrayBuffer(MAX_WS_MESSAGE_BYTES + 1))
    expect(ws.close).toHaveBeenCalledWith(1009, 'Message too large')
  })

  it('serves RESYNCs up to the limit, then closes a flooding socket with 1008', async () => {
    const { sockets, message } = await setup()
    const ws = fakeSocket()
    sockets.push(ws)
    for (let i = 0; i < WS_MESSAGE_LIMIT; i += 1) await message(ws, { type: 'RESYNC' })
    expect(ws.sent).toHaveLength(WS_MESSAGE_LIMIT)
    expect(ws.close).not.toHaveBeenCalled()
    await message(ws, { type: 'RESYNC' })
    expect(ws.close).toHaveBeenCalledWith(1008, 'Too many messages')
    expect(ws.sent).toHaveLength(WS_MESSAGE_LIMIT)
  })

  it('counts junk messages too', async () => {
    const { sockets, message } = await setup()
    const ws = fakeSocket()
    sockets.push(ws)
    for (let i = 0; i <= WS_MESSAGE_LIMIT; i += 1) await message(ws, 'not json')
    expect(ws.close).toHaveBeenCalledWith(1008, 'Too many messages')
  })

  it('caps AUTH attempts per socket, even when spread over windows', async () => {
    const { sockets, message } = await setup()
    const ws = fakeSocket()
    sockets.push(ws)
    const now = vi.spyOn(Date, 'now')
    try {
      for (let i = 0; i < WS_AUTH_LIMIT; i += 1) {
        now.mockReturnValue(1_000_000 + i * WS_MESSAGE_WINDOW_MS)
        await message(ws, { type: 'AUTH', hostKey: 'wrong' })
      }
      expect(ws.sent.map((m) => m.type)).toEqual(Array(WS_AUTH_LIMIT).fill('AUTH_FAILED'))
      expect(ws.close).not.toHaveBeenCalled()
      now.mockReturnValue(1_000_000 + WS_AUTH_LIMIT * WS_MESSAGE_WINDOW_MS)
      await message(ws, { type: 'AUTH', hostKey: 'host-key' })
      expect(ws.close).toHaveBeenCalledWith(1008, 'Too many messages')
    } finally {
      now.mockRestore()
    }
  })

  it('a real client (one AUTH) signs in and keeps its budget across the role change', async () => {
    const { sockets, message } = await setup()
    const ws = fakeSocket()
    sockets.push(ws)
    await message(ws, { type: 'AUTH', hostKey: 'host-key' })
    expect(ws.sent.map((m) => m.type)).toEqual(['HOST'])
    expect(ws.attachment()).toMatchObject({ role: 'host', budget: { count: 1, auths: 1 } })
  })

  it('RESYNC answers from the cached frames: no snapshot is rebuilt until the state changes', async () => {
    const { coordinator, sockets, message } = await setup()
    const host = fakeSocket({ code: CODE, role: 'host' })
    sockets.push(host)
    await message(host, { type: 'RESYNC' })
    const afterFirst = { ...built }
    for (let i = 0; i < 5; i += 1) await message(host, { type: 'RESYNC' })
    expect(built).toEqual(afterFirst)
    expect(new Set(host.raw).size).toBe(1)

    // A change builds new frames once, shared by the broadcast and the next RESYNC.
    expect((await coordinator.checkIn(CODE, { name: 'Ana' })).status).toBe(201)
    const afterChange = { ...built }
    expect(afterChange.host).toBe(afterFirst.host + 1)
    await message(host, { type: 'RESYNC' })
    expect(built).toEqual(afterChange)
    expect(host.raw.at(-1)).toBe(host.raw.at(-2))
  })
})

describe('spendBudget', () => {
  it('starts a fresh window after WS_MESSAGE_WINDOW_MS but keeps the AUTH count', () => {
    let budget = spendBudget(undefined, true, 0).budget
    for (let i = 0; i < WS_MESSAGE_LIMIT - 1; i += 1) budget = spendBudget(budget, false, 1).budget
    expect(spendBudget(budget, false, 2).over).toBe(true)
    const fresh = spendBudget(budget, false, WS_MESSAGE_WINDOW_MS)
    expect(fresh.over).toBe(false)
    expect(fresh.budget).toEqual({ windowStart: WS_MESSAGE_WINDOW_MS, count: 1, auths: 1 })
  })
})

describe('commands are validated before they queue (M1)', () => {
  it('a malformed envelope is refused without waiting behind queued work', async () => {
    const { coordinator } = await setup()
    let release: () => void = () => {}
    const blocker = new Promise<void>((resolve) => { release = resolve })
    // Hold the queue: anything that goes through serial() now waits.
    const queued = (coordinator as unknown as { serial: (fn: () => Promise<unknown>) => Promise<unknown> }).serial(() => blocker)
    const refused = await coordinator.command(CODE, { hostKey: 'host-key', captainKey: null }, { junk: true })
    expect(refused.status).toBe(400)
    release()
    await queued
  })
})

import { describe, expect, it, vi } from 'vitest'
import { createSqliteD1 } from '../../repositories/pickleball/open/testing/sqliteD1'
import { createOpenSession } from '../../repositories/pickleball/open/openSessions'
import { deleteHost, upsertHost } from '../../repositories/pickleball/open/hosts'
import { claimSession, MAX_EXTRA_HOST_KEYS } from '../../repositories/pickleball/open/hostAccess'
import { buildInitialState } from '../../../lib/pickleball/open/create'
import { finished, player } from '../../../lib/pickleball/open/testing/fixtures'
import { DEFAULT_SETTINGS } from '../../../lib/pickleball/open/types'
import { sha256Base64Url } from '../../../lib/pickleball/webCrypto.js'
import { OpenSessionDO } from './OpenSessionDO'

// The runtime's base class only stores ctx and env; nothing else of it is used here.
vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    constructor(protected ctx: unknown, protected env: unknown) {}
  },
}))

// Lets a test make building the export email throw, to prove nothing is reserved for it.
const emailFails = vi.hoisted(() => ({ on: false }))
vi.mock('../../../lib/pickleball/open/dupr/email', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../lib/pickleball/open/dupr/email')>()
  return {
    ...real,
    buildDuprEmail: (input: Parameters<typeof real.buildDuprEmail>[0]) => {
      if (emailFails.on) throw new Error('email build failed')
      return real.buildDuprEmail(input)
    },
  }
})

const CODE = 'AAAAA22222'
const MIGRATIONS = ['0016_open_sessions', '0017_open_captains', '0018_open_tournaments', '0019_hosts'].map((m) => `migrations/pickleball/${m}.sql`)
const HOST = { id: 'h1', displayName: 'Mo', duprClubId: 'CLUB-1' }

/** A hibernatable socket stand-in: an attachment, and what was sent to it. */
function fakeSocket(attachment: unknown = { code: CODE, role: 'viewer' }) {
  let stored = attachment
  const sent: Array<{ type: string }> = []
  return {
    sent,
    attachment: () => stored,
    close: vi.fn(),
    send: (message: string) => sent.push(JSON.parse(message)),
    serializeAttachment: (value: unknown) => { stored = value },
    deserializeAttachment: () => stored,
  }
}

async function setup({ claimed = true, eligible = false } = {}) {
  const { d1, raw } = createSqliteD1(MIGRATIONS)
  const now = new Date().toISOString()
  let n = 0
  const initial = buildInitialState(
    { name: 'Saturday', hostDisplayName: 'Mo', location: null, courtCount: 1, settings: DEFAULT_SETTINGS, players: [] },
    { now, newId: () => `id-${(n += 1)}`, publicCode: CODE, sessionId: 'sess-1' },
  )
  const state = eligible
    ? {
        ...initial,
        players: ['Ana', 'Ben', 'Cy', 'Di'].map((name, i) => player(`p${i + 1}`, { name, duprId: `${name.toUpperCase().padEnd(3, 'X')}11${i}`, position: i + 1, joinedAt: now, waitingSince: now })),
        matches: [{ ...finished('m1', ['p1', 'p2'], ['p3', 'p4'], 'A', 11, 7, 1, initial.courts[0].id), proposedAt: now, startedAt: now, finishedAt: now }],
      }
    : initial
  await createOpenSession(d1, state, await sha256Base64Url('host-key'))
  const host = await upsertHost(d1, { googleSub: 'g', email: 'mo@example.com', displayName: 'Mo', marketingOptIn: false }, { now, newId: () => 'h1' })
  const other = await upsertHost(d1, { googleSub: 'g2', email: 'bo@example.com', displayName: 'Bo', marketingOptIn: false }, { now, newId: () => 'h2' })
  if (claimed) expect(await claimSession(d1, state.id, host.id)).toBe(true)
  const sockets: Array<ReturnType<typeof fakeSocket>> = []
  const ctx = { id: { equals: (o: unknown) => o === CODE }, getWebSockets: () => sockets }
  const env = { PICKLEBALL_DB: d1, OPEN_SESSION: { idFromName: (name: string) => name } }
  const coordinator = new OpenSessionDO(ctx as unknown as DurableObjectState, env as unknown as Env)
  const exportsLogged = () => (raw.prepare('SELECT COUNT(*) AS n FROM open_dupr_exports').get() as { n: number }).n
  return { d1, host, other, sockets, coordinator, exportsLogged }
}

const claimOf = async (coordinator: OpenSessionDO, hostId: string) =>
  ((await coordinator.duprStatus(CODE, 'host-key', hostId, 'UTC')).body as { claim: string }).claim

describe('OpenSessionDO.forgetHost', () => {
  it('drops a deleted host from the cached session without closing sockets, so the session can be claimed again', async () => {
    const { d1, host, sockets, coordinator } = await setup()
    const viewer = fakeSocket()
    sockets.push(viewer)
    expect(await claimOf(coordinator, host.id)).toBe('MINE')
    expect(await deleteHost(d1, host.id)).toEqual([CODE])
    expect(await claimOf(coordinator, host.id)).toBe('MINE') // still cached: this is what forgetHost fixes

    await coordinator.forgetHost('someone-else')
    expect(await claimOf(coordinator, host.id)).toBe('MINE')
    await coordinator.forgetHost(host.id)
    expect(await claimOf(coordinator, host.id)).toBe('UNCLAIMED')
    expect(viewer.close).not.toHaveBeenCalled()
  })

  it('revokes the extra host links: their sockets become viewers and their commands are refused; the original key keeps working', async () => {
    const { d1, host, sockets, coordinator } = await setup()
    const { hostKey: extraKey } = (await coordinator.reopen(CODE, host.id)).body as { hostKey: string }
    const viaExtra = fakeSocket()
    const viaOriginal = fakeSocket()
    sockets.push(viaExtra, viaOriginal)
    await coordinator.webSocketMessage(viaExtra as unknown as WebSocket, JSON.stringify({ type: 'AUTH', hostKey: extraKey }))
    await coordinator.webSocketMessage(viaOriginal as unknown as WebSocket, JSON.stringify({ type: 'AUTH', hostKey: 'host-key' }))
    expect(viaExtra.attachment()).toEqual({ code: CODE, role: 'host', extraKey: true, budget: expect.any(Object) })
    expect(viaOriginal.attachment()).toEqual({ code: CODE, role: 'host', budget: expect.any(Object) })
    expect((await coordinator.host(CODE, extraKey)).status).toBe(200)

    await deleteHost(d1, host.id)
    await coordinator.forgetHost(host.id)
    expect(viaExtra.attachment()).toEqual({ code: CODE, role: 'viewer', budget: expect.any(Object) })
    expect(viaExtra.sent.slice(-2).map((m) => m.type)).toEqual(['AUTH_FAILED', 'VIEWER'])
    expect(viaOriginal.attachment()).toEqual({ code: CODE, role: 'host', budget: expect.any(Object) })
    expect((await coordinator.host(CODE, extraKey)).status).toBe(403)
    expect((await coordinator.command(CODE, { hostKey: extraKey, captainKey: null }, {})).status).toBe(400)
    expect((await coordinator.command(CODE, { hostKey: extraKey, captainKey: null }, {
      idempotencyKey: 'key-0001', command: { type: 'SET_SELF_CHECK_IN', enabled: false },
    })).status).toBe(403)
    expect((await coordinator.host(CODE, 'host-key')).status).toBe(200)
  })
})

describe('OpenSessionDO.claim and reopen', () => {
  it('a session is claimed once: the same account again is fine, another account gets 409', async () => {
    const { host, other, coordinator } = await setup({ claimed: false })
    expect((await coordinator.claim(CODE, 'host-key', host.id)).body).toEqual({ claim: 'MINE' })
    expect((await coordinator.claim(CODE, 'host-key', host.id)).body).toEqual({ claim: 'MINE' })
    const taken = await coordinator.claim(CODE, 'host-key', other.id)
    expect(taken).toEqual({ status: 409, body: { error: 'This session is already linked to another Google account.' } })
    expect((await coordinator.claim(CODE, 'wrong-key', host.id)).status).toBe(403)
  })

  it('only the claiming account may reopen, up to the extra host link cap', async () => {
    const { host, other, coordinator } = await setup()
    expect(await coordinator.reopen(CODE, other.id)).toEqual({ status: 403, body: { error: 'This session is not linked to your account.' } })
    for (let i = 0; i < MAX_EXTRA_HOST_KEYS; i += 1) expect((await coordinator.reopen(CODE, host.id)).status).toBe(201)
    const capped = await coordinator.reopen(CODE, host.id)
    expect(capped.status).toBe(409)
  })
})

describe('OpenSessionDO DUPR export reservations', () => {
  it('reserves nothing when building the export throws', async () => {
    const { coordinator, exportsLogged } = await setup({ eligible: true })
    emailFails.on = true
    try {
      await expect(coordinator.prepareDuprExport(CODE, 'host-key', HOST, 'UTC')).rejects.toThrow('email build failed')
    } finally {
      emailFails.on = false
    }
    expect(exportsLogged()).toBe(0)
    expect((await coordinator.prepareDuprExport(CODE, 'host-key', HOST, 'UTC')).status).toBe(200)
    expect(exportsLogged()).toBe(1)
  })

  it('a release with the wrong host key gives nothing back; the right one does', async () => {
    const { coordinator, exportsLogged } = await setup({ eligible: true })
    const prepared = await coordinator.prepareDuprExport(CODE, 'host-key', HOST, 'UTC')
    const { exportId } = prepared.body as { exportId: string }
    await coordinator.releaseDuprExport(CODE, 'not-the-host-key', exportId)
    expect(exportsLogged()).toBe(1)
    await coordinator.releaseDuprExport(CODE, 'host-key', exportId)
    expect(exportsLogged()).toBe(0)
  })
})

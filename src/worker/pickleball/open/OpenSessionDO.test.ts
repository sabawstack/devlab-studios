import { describe, expect, it, vi } from 'vitest'
import { createSqliteD1 } from '../../repositories/pickleball/open/testing/sqliteD1'
import { createOpenSession } from '../../repositories/pickleball/open/openSessions'
import { deleteHost, upsertHost } from '../../repositories/pickleball/open/hosts'
import { claimSession } from '../../repositories/pickleball/open/hostAccess'
import { buildInitialState } from '../../../lib/pickleball/open/create'
import { DEFAULT_SETTINGS } from '../../../lib/pickleball/open/types'
import { sha256Base64Url } from '../../../lib/pickleball/webCrypto.js'
import { OpenSessionDO } from './OpenSessionDO'

// The runtime's base class only stores ctx and env; nothing else of it is used here.
vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    constructor(protected ctx: unknown, protected env: unknown) {}
  },
}))

const CODE = 'AAAAA22222'
const MIGRATIONS = ['0016_open_sessions', '0017_open_captains', '0018_open_tournaments', '0019_hosts'].map((m) => `migrations/pickleball/${m}.sql`)

async function setup() {
  const { d1 } = createSqliteD1(MIGRATIONS)
  const now = new Date().toISOString()
  let n = 0
  const state = buildInitialState(
    { name: 'Saturday', hostDisplayName: 'Mo', location: null, courtCount: 1, settings: DEFAULT_SETTINGS, players: [] },
    { now, newId: () => `id-${(n += 1)}`, publicCode: CODE, sessionId: 'sess-1' },
  )
  await createOpenSession(d1, state, await sha256Base64Url('host-key'))
  const host = await upsertHost(d1, { googleSub: 'g', email: 'mo@example.com', displayName: 'Mo', marketingOptIn: false }, { now, newId: () => 'h1' })
  expect(await claimSession(d1, state.id, host.id)).toBe(true)
  const close = vi.fn()
  const ctx = { id: { equals: (other: unknown) => other === CODE }, getWebSockets: () => [{ close }] }
  const env = { PICKLEBALL_DB: d1, OPEN_SESSION: { idFromName: (name: string) => name } }
  const coordinator = new OpenSessionDO(ctx as unknown as DurableObjectState, env as unknown as Env)
  return { d1, host, close, coordinator }
}

describe('OpenSessionDO.forgetHost', () => {
  it('drops a deleted host from the cached session without closing sockets, so the session can be claimed again', async () => {
    const { d1, host, close, coordinator } = await setup()
    const status = async () => {
      const result = await coordinator.duprStatus(CODE, 'host-key', host.id, 'UTC')
      return (result.body as { claim: string }).claim
    }
    expect(await status()).toBe('MINE')
    expect(await deleteHost(d1, host.id)).toEqual([CODE])
    expect(await status()).toBe('MINE') // still cached: this is what forgetHost fixes

    await coordinator.forgetHost('someone-else')
    expect(await status()).toBe('MINE')
    await coordinator.forgetHost(host.id)
    expect(await status()).toBe('UNCLAIMED')
    expect(close).not.toHaveBeenCalled()
  })
})

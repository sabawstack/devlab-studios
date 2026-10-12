import { describe, expect, it, vi } from 'vitest'
import { createSqliteD1 } from '../../repositories/pickleball/open/testing/sqliteD1'
import { createOpenSession } from '../../repositories/pickleball/open/openSessions'
import { buildInitialState } from '../../../lib/pickleball/open/create'
import { DEFAULT_SETTINGS } from '../../../lib/pickleball/open/types'
import { runHostLoginPurge, runOpenSessionPurge } from './purge'
import { createHostLogin, upsertHost } from '../../repositories/pickleball/open/hosts'

function stubNamespace(evict: () => Promise<void>) {
  return { idFromName: (name: string) => name, get: () => ({ evict }) } as unknown as Env['OPEN_SESSION']
}

describe('runOpenSessionPurge', () => {
  it('deletes expired sessions, evicts their coordinators and survives an evict failure', async () => {
    const { d1, raw } = createSqliteD1(['migrations/pickleball/0016_open_sessions.sql'])
    let n = 0
    for (const code of ['AAAAA22222', 'BBBBB33333']) {
      await createOpenSession(d1, buildInitialState(
        { name: 'x', hostDisplayName: 'y', location: null, courtCount: 1, settings: DEFAULT_SETTINGS, players: [] },
        { now: '2026-10-01T00:00:00.000Z', newId: () => `id${(n += 1)}`, publicCode: code, sessionId: code },
      ), 'h')
    }
    const evict = vi.fn().mockRejectedValueOnce(new Error('cold')).mockResolvedValue(undefined)
    const purged = await runOpenSessionPurge({ PICKLEBALL_DB: d1, OPEN_SESSION: stubNamespace(evict) }, { now: new Date('2026-10-09T00:00:00.000Z') })
    expect(purged).toBe(2)
    expect(evict).toHaveBeenCalledTimes(2)
    expect((raw.prepare('SELECT COUNT(*) AS n FROM open_sessions').get() as { n: number }).n).toBe(0)
  })

  it('removes expired host logins and keeps the host and live logins', async () => {
    const { d1, raw } = createSqliteD1(['0016_open_sessions', '0017_open_captains', '0018_open_tournaments', '0019_hosts'].map((m) => `migrations/pickleball/${m}.sql`))
    const host = await upsertHost(d1, { googleSub: 'g', email: 'mo@example.com', displayName: 'Mo', marketingOptIn: false }, { now: '2026-08-01T00:00:00.000Z', newId: () => 'h1' })
    await createHostLogin(d1, { tokenHash: 'old', hostId: host.id, now: '2026-08-01T00:00:00.000Z' })
    await createHostLogin(d1, { tokenHash: 'new', hostId: host.id, now: '2026-10-08T00:00:00.000Z' })
    expect(await runHostLoginPurge({ PICKLEBALL_DB: d1 }, { now: new Date('2026-10-09T00:00:00.000Z') })).toBe(1)
    expect((raw.prepare('SELECT COUNT(*) AS n FROM hosts').get() as { n: number }).n).toBe(1)
    expect((raw.prepare('SELECT token_hash FROM host_logins').get() as { token_hash: string }).token_hash).toBe('new')
  })
})

import { describe, expect, it, vi } from 'vitest'
import { createSqliteD1 } from '../../repositories/pickleball/open/testing/sqliteD1'
import { createOpenSession } from '../../repositories/pickleball/open/openSessions'
import { buildInitialState } from '../../../lib/pickleball/open/create'
import { DEFAULT_SETTINGS } from '../../../lib/pickleball/open/types'
import { runOpenSessionPurge } from './purge'

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
})

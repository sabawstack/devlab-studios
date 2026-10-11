import { describe, expect, it } from 'vitest'
import { createSqliteD1 } from './testing/sqliteD1'
import { createOpenSession, deleteOpenSession, findIdempotentResponse, loadOpenSession, persistDiff, purgeExpiredOpenSessions } from './openSessions'
import { buildInitialState } from '../../../../lib/pickleball/open/create'
import { diffState } from '../../../../lib/pickleball/open/diff'
import { applyCommand, finalizeCommand } from '../../../../lib/pickleball/open/reducer'
import { DEFAULT_SETTINGS } from '../../../../lib/pickleball/open/types'

const MIGRATION = ['migrations/pickleball/0016_open_sessions.sql', 'migrations/pickleball/0017_open_captains.sql']
const NOW = '2026-10-11T10:00:00.000Z'

function fresh(code = 'ABCDE23456') {
  let n = 0
  return buildInitialState({
    name: 'Sunday', hostDisplayName: 'Mike', location: null, courtCount: 2, settings: DEFAULT_SETTINGS,
    players: ['Ana', 'Ben', 'Carlo', 'Dina', 'Eli', 'Fay', 'Gio', 'Hana', 'Ivan'].map((name) => ({ name, skill: null, duprId: null })),
  }, { now: NOW, newId: () => `${code}-${(n += 1)}`, publicCode: code, sessionId: `sess-${code}` })
}

describe('open sessions repository', () => {
  it('round-trips a created session exactly', async () => {
    const { d1 } = createSqliteD1(MIGRATION)
    const state = fresh()
    await createOpenSession(d1, state, 'hash')
    const loaded = await loadOpenSession(d1, 'ABCDE23456', NOW)
    expect(loaded?.hostKeyHash).toBe('hash')
    expect(loaded?.state).toEqual(state)
  })

  it('loads rows with the same key order the reducer builds, so nothing shows up in a diff', async () => {
    const { d1 } = createSqliteD1(MIGRATION)
    const state = fresh()
    await createOpenSession(d1, state, 'hash')
    const loaded = await loadOpenSession(d1, 'ABCDE23456', NOW)
    if (!loaded) throw new Error('session not found')
    const diff = diffState(loaded.state, state)
    expect(diff.sessionChanged).toBe(false)
    expect(diff.upsertPlayers).toEqual([])
    expect(diff.upsertCourts).toEqual([])
    expect(diff.upsertMatches).toEqual([])
    expect(diff.deleteMatchIds).toEqual([])
  })

  it('persists only the diff, and a reload equals the in-memory state', async () => {
    const { d1 } = createSqliteD1(MIGRATION)
    const state = fresh()
    await createOpenSession(d1, state, 'hash')
    const match = state.matches[0]
    const ctx = { now: '2026-10-11T10:15:00.000Z', newId: () => 'new-proposal' }
    const result = applyCommand(state, { type: 'RECORD_RESULT', matchId: match.id, winner: 'A', scoreA: 11, scoreB: 6 }, ctx)
    if (!result.ok) throw new Error(result.error)
    const next = finalizeCommand(result.state, ctx)
    await persistDiff(d1, state, next, { key: 'idem-12345', responseJson: '{"ok":1}', now: ctx.now, cutoff: NOW })
    expect((await loadOpenSession(d1, 'ABCDE23456', ctx.now))?.state).toEqual(next)
    expect(await findIdempotentResponse(d1, state.id, 'idem-12345')).toBe('{"ok":1}')
  })

  it('treats an expired session as not found even before the purge runs', async () => {
    const { d1 } = createSqliteD1(MIGRATION)
    await createOpenSession(d1, fresh(), 'hash')
    expect(await loadOpenSession(d1, 'ABCDE23456', '2026-10-18T10:00:00.001Z')).toBeNull()
  })

  it('purges only expired sessions, with all their rows', async () => {
    const { d1, raw } = createSqliteD1(MIGRATION)
    await createOpenSession(d1, fresh('AAAAA22222'), 'h1')
    await createOpenSession(d1, { ...fresh('BBBBB33333'), expiresAt: '2026-12-01T00:00:00.000Z' }, 'h2')
    const purged = await purgeExpiredOpenSessions(d1, '2026-10-19T00:00:00.000Z')
    expect(purged).toEqual(['AAAAA22222'])
    const left = raw.prepare('SELECT COUNT(*) AS n FROM open_players').get() as { n: number }
    expect(left.n).toBe(9)
  })

  it('spares a session whose expiry moved between the select and the delete', async () => {
    const { d1, raw } = createSqliteD1(MIGRATION)
    await createOpenSession(d1, fresh('AAAAA22222'), 'h1')
    await createOpenSession(d1, fresh('BBBBB33333'), 'h2')
    raw.prepare("UPDATE open_sessions SET expires_at = '2026-10-01T00:00:00.000Z'").run()
    // A host command lands after the purge's SELECT and before its DELETEs:
    // it extends one session's expiry. The delete must not remove it.
    const racing = {
      prepare: d1.prepare.bind(d1),
      batch: (statements: Parameters<typeof d1.batch>[0]) => {
        raw.prepare("UPDATE open_sessions SET expires_at = '2026-12-01T00:00:00.000Z' WHERE public_code = 'AAAAA22222'").run()
        return d1.batch(statements)
      },
    } as unknown as D1Database
    const purged = await purgeExpiredOpenSessions(racing, '2026-10-19T00:00:00.000Z')
    expect(purged).toEqual(['BBBBB33333'])
    const survivors = raw.prepare('SELECT public_code FROM open_sessions').all() as { public_code: string }[]
    expect(survivors.map((row) => row.public_code)).toEqual(['AAAAA22222'])
  })

  it('deletes a session and everything under it', async () => {
    const { d1, raw } = createSqliteD1(MIGRATION)
    const state = fresh()
    await createOpenSession(d1, state, 'hash')
    await deleteOpenSession(d1, state.id)
    expect((raw.prepare('SELECT COUNT(*) AS n FROM open_matches').get() as { n: number }).n).toBe(0)
  })
})

import { describe, expect, it } from 'vitest'
import { createSqliteD1 } from './testing/sqliteD1'
import { createOpenSession, insertCaptain, loadOpenSession, persistDiff, purgeExpiredOpenSessions, revokeCaptain } from './openSessions'
import { buildInitialState } from '../../../../lib/pickleball/open/create'
import { applyCommand, finalizeCommand, touch } from '../../../../lib/pickleball/open/reducer'
import { DEFAULT_SETTINGS, type CaptainRecord } from '../../../../lib/pickleball/open/types'

const MIGRATIONS = ['migrations/pickleball/0016_open_sessions.sql', 'migrations/pickleball/0017_open_captains.sql']
const NOW = '2026-10-11T10:00:00.000Z'

function fresh(code = 'ABCDE23456') {
  let n = 0
  return buildInitialState({
    name: 'Sunday', hostDisplayName: 'Mike', location: null, courtCount: 2, settings: DEFAULT_SETTINGS,
    players: ['Ana', 'Ben', 'Carlo', 'Dina', 'Eli', 'Fay', 'Gio', 'Hana', 'Ivan'].map((name) => ({ name, skill: null, duprId: null })),
  }, { now: NOW, newId: () => `${code}-${(n += 1)}`, publicCode: code, sessionId: `sess-${code}` })
}

const captainFor = (courtId: string, id = 'cap-1'): CaptainRecord => ({ id, label: 'Court 1 captain', courtId, keyHash: `hash-${id}`, createdAt: NOW })

describe('Phase 2 repository', () => {
  it('a session stored before Phase 2 (old settings, no recorded_by) loads with defaults and diffs clean', async () => {
    const { d1, raw } = createSqliteD1(MIGRATIONS)
    const state = fresh()
    await createOpenSession(d1, state, 'hash')
    raw.prepare(`UPDATE open_sessions SET settings_json = '{"mode":"PADDLE_STACK","target":11,"scoringStyle":"SIDEOUT"}'`).run()
    const loaded = await loadOpenSession(d1, 'ABCDE23456', NOW)
    expect(loaded?.state.settings).toEqual({ mode: 'PADDLE_STACK', target: 11, scoringStyle: 'SIDEOUT', selfCheckIn: true, rules: [] })
    expect(loaded?.state.matches.every((m) => m.recordedBy === null)).toBe(true)
    expect(loaded?.captains).toEqual([])
    // Still accepts a command after the deploy.
    const ctx = { now: '2026-10-11T10:05:00.000Z', newId: () => 'later' }
    const result = applyCommand(loaded!.state, { type: 'START_MATCH', matchId: loaded!.state.matches[0].id }, ctx)
    expect(result.ok).toBe(true)
  })

  it('stores who saved a result through persistDiff, and a reload equals memory', async () => {
    const { d1 } = createSqliteD1(MIGRATIONS)
    const state = fresh()
    await createOpenSession(d1, state, 'hash')
    const ctx = { now: '2026-10-11T10:15:00.000Z', newId: () => 'next', actor: 'Court 1 captain' }
    const saved = applyCommand(state, { type: 'RECORD_RESULT', matchId: state.matches[0].id, winner: 'A', scoreA: 11, scoreB: 6 }, ctx)
    if (!saved.ok) throw new Error(saved.error)
    const next = finalizeCommand(saved.state, ctx)
    await persistDiff(d1, state, next, null)
    const loaded = await loadOpenSession(d1, 'ABCDE23456', ctx.now)
    expect(loaded?.state).toEqual(next)
    expect(loaded?.state.matches.find((m) => m.id === state.matches[0].id)?.recordedBy).toBe('Court 1 captain')
  })

  it('adds and revokes captain links; a revoked link no longer loads', async () => {
    const { d1 } = createSqliteD1(MIGRATIONS)
    const state = fresh()
    await createOpenSession(d1, state, 'hash')
    const later = touch(state, '2026-10-11T11:00:00.000Z')
    await insertCaptain(d1, later, captainFor(state.courts[0].id))
    const loaded = await loadOpenSession(d1, 'ABCDE23456', NOW)
    expect(loaded?.captains).toEqual([captainFor(state.courts[0].id)])
    expect(loaded?.state.version).toBe(later.version)
    expect(await revokeCaptain(d1, touch(later, '2026-10-11T11:05:00.000Z'), 'cap-1', '2026-10-11T11:05:00.000Z')).toBe(true)
    expect(await revokeCaptain(d1, touch(later, '2026-10-11T11:06:00.000Z'), 'cap-1', '2026-10-11T11:06:00.000Z')).toBe(false)
    expect((await loadOpenSession(d1, 'ABCDE23456', NOW))?.captains).toEqual([])
  })

  it('the purge removes captain links with their session', async () => {
    const { d1, raw } = createSqliteD1(MIGRATIONS)
    const state = fresh()
    await createOpenSession(d1, state, 'hash')
    await insertCaptain(d1, state, captainFor(state.courts[0].id))
    await purgeExpiredOpenSessions(d1, '2026-10-19T00:00:00.000Z')
    expect((raw.prepare('SELECT COUNT(*) AS n FROM open_captains').get() as { n: number }).n).toBe(0)
  })

  it('a captain key hash is unique across sessions', async () => {
    const { d1 } = createSqliteD1(MIGRATIONS)
    const a = fresh('AAAAA22222')
    const b = fresh('BBBBB33333')
    await createOpenSession(d1, a, 'h1')
    await createOpenSession(d1, b, 'h2')
    await insertCaptain(d1, a, captainFor(a.courts[0].id, 'x'))
    await expect(insertCaptain(d1, b, { ...captainFor(b.courts[0].id, 'y'), keyHash: 'hash-x' })).rejects.toThrow(/UNIQUE/)
  })
})

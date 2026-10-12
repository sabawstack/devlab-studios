import { describe, expect, it } from 'vitest'
import { createSqliteD1 } from './testing/sqliteD1'
import { createOpenSession, loadOpenSession, persistDiff, purgeExpiredOpenSessions } from './openSessions'
import {
  createHostLogin, deleteHost, deleteHostLogin, findHostByLogin, listHostSessions, LOGIN_TTL_MS, purgeExpiredHostLogins,
  toHostProfile, updateHostProfile, upsertHost,
} from './hosts'
import {
  claimSession, deleteDuprExport, insertDuprExport, insertHostKey, loadHostAccess, MAX_EXTRA_HOST_KEYS, recentDuprExports, reopenRefusal,
} from './hostAccess'
import { buildInitialState } from '../../../../lib/pickleball/open/create'
import { touch } from '../../../../lib/pickleball/open/reducer'
import { DEFAULT_SETTINGS } from '../../../../lib/pickleball/open/types'

const MIGRATIONS = [
  'migrations/pickleball/0016_open_sessions.sql',
  'migrations/pickleball/0017_open_captains.sql',
  'migrations/pickleball/0018_open_tournaments.sql',
  'migrations/pickleball/0019_hosts.sql',
]
const NOW = '2026-10-12T10:00:00.000Z'
const LATER = '2026-10-12T11:00:00.000Z'

function setup() {
  const { d1, raw } = createSqliteD1(MIGRATIONS)
  let n = 0
  return { d1, raw, newId: () => `id-${(n += 1)}` }
}

async function session(d1: D1Database, code: string, now = NOW) {
  let n = 0
  const state = buildInitialState(
    { name: `Session ${code}`, hostDisplayName: 'Mo', location: null, courtCount: 1, settings: DEFAULT_SETTINGS, players: [] },
    { now, newId: () => `${code}-${(n += 1)}`, publicCode: code, sessionId: `sess-${code}` },
  )
  await createOpenSession(d1, state, 'hash')
  return state
}

const count = (raw: ReturnType<typeof createSqliteD1>['raw'], sql: string) => (raw.prepare(sql).get() as { n: number }).n
const ANA = { googleSub: 'g-ana', email: 'ana@example.com', displayName: 'Ana', marketingOptIn: false }

describe('hosts', () => {
  it('creates a host on first sign-in and refreshes only email, name and last seen after that', async () => {
    const { d1, newId } = setup()
    const first = await upsertHost(d1, { ...ANA, marketingOptIn: true }, { now: NOW, newId })
    expect(first).toMatchObject({ googleSub: 'g-ana', email: 'ana@example.com', marketingOptIn: true, duprClubId: null, createdAt: NOW, lastSeenAt: NOW })
    const again = await upsertHost(d1, { ...ANA, email: 'ana@new.example', displayName: 'Ana P', marketingOptIn: false }, { now: LATER, newId })
    expect(again.id).toBe(first.id)
    expect(again).toMatchObject({ email: 'ana@new.example', displayName: 'Ana P', marketingOptIn: true, createdAt: NOW, lastSeenAt: LATER })
  })

  it('marketing opt-in is off unless the host ticked it', async () => {
    const { raw } = setup()
    raw.exec(`INSERT INTO hosts (id, google_sub, email, display_name, created_at, last_seen_at) VALUES ('h1', 's', 'e', 'n', '${NOW}', '${NOW}')`)
    expect(count(raw, "SELECT marketing_opt_in AS n FROM hosts WHERE id = 'h1'")).toBe(0)
    expect(() => raw.exec("UPDATE hosts SET marketing_opt_in = 2 WHERE id = 'h1'")).toThrow(/CHECK/)
  })

  it('a login finds its host until it expires, and signing out removes it', async () => {
    const { d1, newId } = setup()
    const host = await upsertHost(d1, ANA, { now: NOW, newId })
    await createHostLogin(d1, { tokenHash: 't1', hostId: host.id, now: NOW })
    expect((await findHostByLogin(d1, 't1', LATER))?.id).toBe(host.id)
    expect(await findHostByLogin(d1, 'nope', LATER)).toBeNull()
    const expiry = new Date(Date.parse(NOW) + LOGIN_TTL_MS).toISOString()
    expect(await findHostByLogin(d1, 't1', expiry)).toBeNull()
    await deleteHostLogin(d1, 't1')
    expect(await findHostByLogin(d1, 't1', LATER)).toBeNull()
  })

  it('updates only the fields given and returns the profile without the Google subject', async () => {
    const { d1, newId } = setup()
    const host = await upsertHost(d1, ANA, { now: NOW, newId })
    const withClub = await updateHostProfile(d1, host.id, { duprClubId: '12345' })
    expect(withClub).toMatchObject({ duprClubId: '12345', marketingOptIn: false })
    const optedIn = await updateHostProfile(d1, host.id, { marketingOptIn: true })
    expect(optedIn).toMatchObject({ duprClubId: '12345', marketingOptIn: true })
    expect(toHostProfile(optedIn!)).toEqual({ email: 'ana@example.com', displayName: 'Ana', duprClubId: '12345', marketingOptIn: true })
    expect(await updateHostProfile(d1, 'missing', { duprClubId: null })).toBeNull()
  })

  it('deleting an account unlinks its sessions, keeps them, and signs it out everywhere', async () => {
    const { d1, raw, newId } = setup()
    const host = await upsertHost(d1, ANA, { now: NOW, newId })
    await createHostLogin(d1, { tokenHash: 't1', hostId: host.id, now: NOW })
    await createHostLogin(d1, { tokenHash: 't2', hostId: host.id, now: NOW })
    const a = await session(d1, 'AAAAA22222')
    await session(d1, 'BBBBB33333')
    expect(await claimSession(d1, a.id, host.id)).toBe(true)
    expect(await deleteHost(d1, host.id)).toEqual(['AAAAA22222'])
    expect(count(raw, 'SELECT COUNT(*) AS n FROM hosts')).toBe(0)
    expect(count(raw, 'SELECT COUNT(*) AS n FROM host_logins')).toBe(0)
    expect(count(raw, 'SELECT COUNT(*) AS n FROM open_sessions')).toBe(2)
    expect(count(raw, 'SELECT COUNT(*) AS n FROM open_sessions WHERE host_id IS NOT NULL')).toBe(0)
  })

  it('deleting an account revokes the extra host links of its sessions only', async () => {
    const { d1, newId } = setup()
    const host = await upsertHost(d1, ANA, { now: NOW, newId })
    const mine = await session(d1, 'AAAAA22222')
    const other = await session(d1, 'BBBBB33333')
    await claimSession(d1, mine.id, host.id)
    await insertHostKey(d1, { id: 'k1', sessionId: mine.id, keyHash: 'h1', createdAt: NOW })
    await insertHostKey(d1, { id: 'k2', sessionId: other.id, keyHash: 'h2', createdAt: NOW })
    expect(await deleteHost(d1, host.id)).toEqual(['AAAAA22222'])
    expect(await loadHostAccess(d1, mine.id)).toEqual({ hostId: null, extraKeyHashes: [] })
    expect(await loadHostAccess(d1, other.id)).toEqual({ hostId: null, extraKeyHashes: ['h2'] })
  })

  it('a deleted host row also unlinks sessions through the foreign key', async () => {
    const { d1, raw, newId } = setup()
    const host = await upsertHost(d1, ANA, { now: NOW, newId })
    const a = await session(d1, 'AAAAA22222')
    await claimSession(d1, a.id, host.id)
    raw.exec(`DELETE FROM hosts WHERE id = '${host.id}'`)
    expect(count(raw, 'SELECT COUNT(*) AS n FROM open_sessions WHERE host_id IS NULL')).toBe(1)
  })

  it('lists only the host’s live sessions, most recently active first', async () => {
    const { d1, raw, newId } = setup()
    const host = await upsertHost(d1, ANA, { now: NOW, newId })
    const other = await upsertHost(d1, { ...ANA, googleSub: 'g-bo', email: 'bo@example.com' }, { now: NOW, newId })
    const older = await session(d1, 'AAAAA22222', '2026-10-10T09:00:00.000Z')
    const newer = await session(d1, 'BBBBB33333', '2026-10-11T09:00:00.000Z')
    const expired = await session(d1, 'CCCCC44444', '2026-09-01T09:00:00.000Z')
    const theirs = await session(d1, 'DDDDD55555')
    for (const s of [older, newer, expired]) await claimSession(d1, s.id, host.id)
    await claimSession(d1, theirs.id, other.id)
    const listed = await listHostSessions(d1, host.id, NOW)
    expect(listed.map((s) => s.code)).toEqual(['BBBBB33333', 'AAAAA22222'])
    expect(listed[0]).toMatchObject({ name: 'Session BBBBB33333', kind: 'OPEN_PLAY', status: 'ACTIVE' })
    expect(count(raw, 'SELECT COUNT(*) AS n FROM open_sessions')).toBe(4)
  })

  it('the cron removes expired logins only', async () => {
    const { d1, raw, newId } = setup()
    const host = await upsertHost(d1, ANA, { now: NOW, newId })
    await createHostLogin(d1, { tokenHash: 'old', hostId: host.id, now: '2026-08-01T00:00:00.000Z' })
    await createHostLogin(d1, { tokenHash: 'new', hostId: host.id, now: NOW })
    expect(await purgeExpiredHostLogins(d1, NOW)).toBe(1)
    expect(count(raw, 'SELECT COUNT(*) AS n FROM host_logins')).toBe(1)
  })
})

describe('host access', () => {
  it('a session is claimed once, and never by a host that no longer exists', async () => {
    const { d1, newId } = setup()
    const ana = await upsertHost(d1, ANA, { now: NOW, newId })
    const bo = await upsertHost(d1, { ...ANA, googleSub: 'g-bo' }, { now: NOW, newId })
    const s = await session(d1, 'AAAAA22222')
    expect(await claimSession(d1, s.id, 'ghost')).toBe(false)
    expect(await claimSession(d1, s.id, ana.id)).toBe(true)
    expect(await claimSession(d1, s.id, bo.id)).toBe(false)
    expect(await claimSession(d1, s.id, ana.id)).toBe(false)
    expect((await loadHostAccess(d1, s.id)).hostId).toBe(ana.id)
  })

  it('a normal session save after a claim keeps the claim', async () => {
    const { d1, newId } = setup()
    const ana = await upsertHost(d1, ANA, { now: NOW, newId })
    const s = await session(d1, 'AAAAA22222')
    expect(await claimSession(d1, s.id, ana.id)).toBe(true)
    const next = { ...touch(s, LATER), name: 'Renamed', version: s.version + 1 }
    await persistDiff(d1, s, next, null)
    const reloaded = await loadOpenSession(d1, 'AAAAA22222', LATER)
    expect(reloaded?.state).toMatchObject({ name: 'Renamed', lastActivityAt: LATER })
    expect((await loadHostAccess(d1, s.id)).hostId).toBe(ana.id)
  })

  it('reopen is only for the claiming account, and stops at the extra host link cap', () => {
    const keys = (n: number) => Array.from({ length: n }, (_, i) => `h${i}`)
    expect(MAX_EXTRA_HOST_KEYS).toBe(10)
    expect(reopenRefusal({ hostId: 'ana', extraKeyHashes: keys(9) }, 'ana')).toBeNull()
    expect(reopenRefusal({ hostId: null, extraKeyHashes: [] }, 'ana')).toEqual({ status: 403, error: 'This session is not linked to your account.' })
    expect(reopenRefusal({ hostId: 'bo', extraKeyHashes: [] }, 'ana')?.status).toBe(403)
    expect(reopenRefusal({ hostId: 'ana', extraKeyHashes: keys(10) }, 'ana')).toEqual({
      status: 409, error: 'This session already has 10 extra host links. Open it on a device you used before.',
    })
  })

  it('extra host keys load oldest first and cascade with the purge', async () => {
    const { d1, raw } = setup()
    const s = await session(d1, 'AAAAA22222', '2026-09-01T09:00:00.000Z')
    await insertHostKey(d1, { id: 'k2', sessionId: s.id, keyHash: 'h2', createdAt: '2026-09-01T10:00:00.000Z' })
    await insertHostKey(d1, { id: 'k1', sessionId: s.id, keyHash: 'h1', createdAt: '2026-09-01T09:30:00.000Z' })
    expect(await loadHostAccess(d1, s.id)).toEqual({ hostId: null, extraKeyHashes: ['h1', 'h2'] })
    await insertDuprExport(d1, { id: 'x1', sessionId: s.id, sentAt: '2026-09-01T10:00:00.000Z', gameCount: 3, skippedCount: 1 })
    expect(await purgeExpiredOpenSessions(d1, NOW)).toEqual(['AAAAA22222'])
    expect(count(raw, 'SELECT COUNT(*) AS n FROM open_host_keys')).toBe(0)
    expect(count(raw, 'SELECT COUNT(*) AS n FROM open_dupr_exports')).toBe(0)
  })

  it('the export log counts sends after a time, and a failed send can be given back', async () => {
    const { d1 } = setup()
    const s = await session(d1, 'AAAAA22222')
    await insertDuprExport(d1, { id: 'x1', sessionId: s.id, sentAt: '2026-10-11T09:00:00.000Z', gameCount: 3, skippedCount: 0 })
    await insertDuprExport(d1, { id: 'x2', sessionId: s.id, sentAt: '2026-10-12T09:00:00.000Z', gameCount: 3, skippedCount: 0 })
    await insertDuprExport(d1, { id: 'x3', sessionId: s.id, sentAt: '2026-10-12T09:30:00.000Z', gameCount: 3, skippedCount: 0 })
    expect(await recentDuprExports(d1, s.id, '2026-10-11T10:00:00.000Z')).toEqual(['2026-10-12T09:00:00.000Z', '2026-10-12T09:30:00.000Z'])
    await deleteDuprExport(d1, 'other-session', 'x3')
    expect(await recentDuprExports(d1, s.id, '2026-10-11T10:00:00.000Z')).toHaveLength(2)
    await deleteDuprExport(d1, s.id, 'x3')
    expect(await recentDuprExports(d1, s.id, '2026-10-11T10:00:00.000Z')).toEqual(['2026-10-12T09:00:00.000Z'])
  })
})

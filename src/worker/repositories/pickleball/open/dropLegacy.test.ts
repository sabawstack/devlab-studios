// 0020_drop_legacy_pickleball.sql (spec 2026-10-11 §12) runs once against
// production and preview data, so it is checked here against the real
// migrations rather than a hand-written schema.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { createSqliteD1 } from './testing/sqliteD1'

const DIR = 'migrations/pickleball'
const DROP = '0020_drop_legacy_pickleball.sql'
const ALL = readdirSync(join(process.cwd(), DIR)).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort()
const paths = (names: string[]) => names.map((name) => `${DIR}/${name}`)
/** 0001-0015: the logged-in app's schema. */
const LEGACY = ALL.filter((name) => Number(name.slice(0, 4)) <= 15)
/** Everything before the drop: the database as production and preview have it. */
const BEFORE_DROP = ALL.filter((name) => name < DROP)
const DROP_SQL = readFileSync(join(process.cwd(), DIR, DROP), 'utf8')

/** The free-session tables, which must survive untouched. */
const KEPT = [
  'host_logins', 'hosts', 'open_captains', 'open_courts', 'open_dupr_exports', 'open_host_keys', 'open_idempotency',
  'open_matches', 'open_players', 'open_sessions', 'open_tournament_entrants', 'open_tournament_fixtures', 'open_tournaments',
]

const names = (raw: DatabaseSync, type: 'table' | 'trigger'): string[] =>
  (raw.prepare("SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE 'sqlite_%' ORDER BY name").all(type) as { name: string }[]).map((row) => row.name)

const dropped = (kind: 'TABLE' | 'TRIGGER'): string[] =>
  [...DROP_SQL.matchAll(new RegExp(`^DROP ${kind} IF EXISTS (\\w+);$`, 'gm'))].map((match) => match[1])

describe('0020_drop_legacy_pickleball', () => {
  it('is the next migration after 0019', () => {
    expect(ALL.indexOf(DROP)).toBe(ALL.indexOf('0019_hosts.sql') + 1)
  })

  it('drops exactly the tables and the trigger of 0001-0015', () => {
    const { raw } = createSqliteD1(paths(LEGACY))
    expect([...dropped('TABLE')].sort()).toEqual(names(raw, 'table'))
    expect(dropped('TRIGGER')).toEqual(names(raw, 'trigger'))
    expect(dropped('TABLE')).toHaveLength(27)
  })

  it('drops every table only after every table that references it', () => {
    const { raw } = createSqliteD1(paths(LEGACY))
    const order = dropped('TABLE')
    order.forEach((table, index) => {
      const remaining = order.slice(index + 1)
      for (const child of remaining) {
        const parents = (raw.prepare(`PRAGMA foreign_key_list(${child})`).all() as { table: string }[]).map((fk) => fk.table)
        expect(parents, `${child} still references ${table} when ${table} is dropped`).not.toContain(table)
      }
    })
  })

  it('leaves only the free-session tables, with their rows, even when the old tables hold data', () => {
    const { raw } = createSqliteD1(paths(BEFORE_DROP))
    const now = '2026-10-12T10:00:00.000Z'
    raw.exec(`
      INSERT INTO users (id, google_sub, email, name, created_at, updated_at) VALUES ('u1', 'g1', 'a@example.com', 'A', '${now}', '${now}');
      INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES ('o1', 'Club', 'club', '${now}', '${now}');
      INSERT INTO organization_memberships (id, organization_id, user_id, invited_email, role, status, created_at, updated_at)
        VALUES ('m1', 'o1', 'u1', 'a@example.com', 'ADMIN', 'ACTIVE', '${now}', '${now}');
      INSERT INTO audit_events (id, organization_id, actor_user_id, action, entity_type, entity_id, created_at)
        VALUES ('e1', 'o1', 'u1', 'x', 'y', 'z', '${now}');
      INSERT INTO hosts (id, google_sub, email, display_name, created_at, last_seen_at) VALUES ('h1', 'g1', 'a@example.com', 'A', '${now}', '${now}');
      INSERT INTO open_sessions (id, public_code, host_key_hash, kind, name, host_display_name, settings_json, status, created_at, last_activity_at, expires_at, host_id)
        VALUES ('s1', 'ABCDE23456', 'hash', 'OPEN_PLAY', 'Sunday', 'Mo', '{}', 'ACTIVE', '${now}', '${now}', '${now}', 'h1');
    `)
    raw.exec(DROP_SQL)
    expect(names(raw, 'table')).toEqual(KEPT)
    expect(names(raw, 'trigger')).toEqual([])
    expect(raw.prepare("SELECT host_id FROM open_sessions WHERE id = 's1'").get()).toEqual({ host_id: 'h1' })
  })

  it('is a no-op the second time', () => {
    const { raw } = createSqliteD1(paths(ALL))
    expect(() => raw.exec(DROP_SQL)).not.toThrow()
    expect(names(raw, 'table')).toEqual(KEPT)
  })
})

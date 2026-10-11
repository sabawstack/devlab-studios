import { describe, expect, it } from 'vitest'
import { createSqliteD1 } from './testing/sqliteD1'

const MIGRATION = 'migrations/pickleball/0016_open_sessions.sql'
const NOW = '2026-10-11T10:00:00.000Z'

function seed(raw: ReturnType<typeof createSqliteD1>['raw']) {
  raw.exec(`
    INSERT INTO open_sessions (id, public_code, host_key_hash, kind, name, host_display_name, location, settings_json, status, version, created_at, last_activity_at, expires_at)
    VALUES ('s1', 'ABCDE23456', 'hash', 'OPEN_PLAY', 'Sunday', 'Mike', NULL, '{}', 'ACTIVE', 0, '${NOW}', '${NOW}', '${NOW}');
    INSERT INTO open_courts (id, session_id, label, position, enabled) VALUES ('c1', 's1', 'Court 1', 1, 1);
    INSERT INTO open_players (id, session_id, name, skill, dupr_id, status, games_offset, joined_at, waiting_since, position)
    VALUES ('p1', 's1', 'Ana', NULL, NULL, 'ACTIVE', 0, '${NOW}', '${NOW}', 1);
    INSERT INTO open_matches (id, session_id, court_id, seq, status, team_a_json, team_b_json, score_a, score_b, winner, fixture_id, proposed_at, started_at, finished_at)
    VALUES ('m1', 's1', 'c1', 1, 'PROPOSED', '["p1","p2"]', '["p3","p4"]', NULL, NULL, NULL, NULL, '${NOW}', NULL, NULL);
    INSERT INTO open_idempotency (session_id, key, response_json, created_at) VALUES ('s1', 'k1', '{}', '${NOW}');
  `)
}

describe('0016_open_sessions', () => {
  it('deleting a session cascades to every child table', () => {
    const { raw } = createSqliteD1([MIGRATION])
    seed(raw)
    raw.exec("DELETE FROM open_sessions WHERE id = 's1'")
    for (const table of ['open_courts', 'open_players', 'open_matches', 'open_idempotency']) {
      const row = raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }
      expect(row.n, table).toBe(0)
    }
  })

  it('rejects values outside the enum CHECKs', () => {
    const { raw } = createSqliteD1([MIGRATION])
    seed(raw)
    expect(() => raw.exec("UPDATE open_matches SET status = 'BOGUS' WHERE id = 'm1'")).toThrow(/CHECK/)
    expect(() => raw.exec("UPDATE open_players SET status = 'GONE' WHERE id = 'p1'")).toThrow(/CHECK/)
    expect(() => raw.exec("UPDATE open_sessions SET kind = 'LEAGUE' WHERE id = 's1'")).toThrow(/CHECK/)
  })

  it('enforces one public code per session', () => {
    const { raw } = createSqliteD1([MIGRATION])
    seed(raw)
    expect(() => raw.exec(`INSERT INTO open_sessions (id, public_code, host_key_hash, kind, name, host_display_name, location, settings_json, status, version, created_at, last_activity_at, expires_at)
      VALUES ('s2', 'ABCDE23456', 'h', 'OPEN_PLAY', 'x', 'y', NULL, '{}', 'ACTIVE', 0, '${NOW}', '${NOW}', '${NOW}')`)).toThrow(/UNIQUE/)
  })

  it('batch() is all-or-nothing through the adapter', async () => {
    const { d1, raw } = createSqliteD1([MIGRATION])
    seed(raw)
    await expect(d1.batch([
      d1.prepare("UPDATE open_players SET name = 'Changed' WHERE id = 'p1'"),
      d1.prepare("UPDATE open_players SET status = 'BOGUS' WHERE id = 'p1'"),
    ])).rejects.toThrow()
    const row = raw.prepare("SELECT name FROM open_players WHERE id = 'p1'").get() as { name: string }
    expect(row.name).toBe('Ana')
  })
})

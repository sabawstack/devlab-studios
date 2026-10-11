// Every SQL statement for free open play lives here (repository pattern).
// Writes are always one db.batch() -- D1 batches are transactional, so a
// command is either fully stored or not stored at all.
import { diffState } from '../../../../lib/pickleball/open/diff'
import type { OpenCourt, OpenMatch, OpenPlayer, OpenSessionState, Team } from '../../../../lib/pickleball/open/types'

interface SessionRow {
  id: string; public_code: string; host_key_hash: string; kind: OpenSessionState['kind']; name: string
  host_display_name: string; location: string | null; settings_json: string; status: OpenSessionState['status']
  version: number; created_at: string; last_activity_at: string; expires_at: string
}
interface PlayerRow {
  id: string; name: string; skill: number | null; dupr_id: string | null; status: OpenPlayer['status']
  games_offset: number; joined_at: string; waiting_since: string; position: number
}
interface CourtRow { id: string; label: string; position: number; enabled: number }
interface MatchRow {
  id: string; court_id: string; seq: number; status: OpenMatch['status']; team_a_json: string; team_b_json: string
  score_a: number | null; score_b: number | null; winner: OpenMatch['winner']; proposed_at: string
  started_at: string | null; finished_at: string | null
}

const UPSERT_PLAYER = `INSERT INTO open_players (id, session_id, name, skill, dupr_id, status, games_offset, joined_at, waiting_since, position)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET name = excluded.name, skill = excluded.skill, dupr_id = excluded.dupr_id, status = excluded.status,
    games_offset = excluded.games_offset, waiting_since = excluded.waiting_since, position = excluded.position`
const UPSERT_COURT = `INSERT INTO open_courts (id, session_id, label, position, enabled) VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET label = excluded.label, position = excluded.position, enabled = excluded.enabled`
const UPSERT_MATCH = `INSERT INTO open_matches (id, session_id, court_id, seq, status, team_a_json, team_b_json, score_a, score_b, winner, fixture_id, proposed_at, started_at, finished_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET status = excluded.status, team_a_json = excluded.team_a_json, team_b_json = excluded.team_b_json,
    score_a = excluded.score_a, score_b = excluded.score_b, winner = excluded.winner, started_at = excluded.started_at, finished_at = excluded.finished_at`

function playerStatement(db: D1Database, sessionId: string, p: OpenPlayer): D1PreparedStatement {
  return db.prepare(UPSERT_PLAYER).bind(p.id, sessionId, p.name, p.skill, p.duprId, p.status, p.gamesOffset, p.joinedAt, p.waitingSince, p.position)
}
function courtStatement(db: D1Database, sessionId: string, c: OpenCourt): D1PreparedStatement {
  return db.prepare(UPSERT_COURT).bind(c.id, sessionId, c.label, c.position, c.enabled ? 1 : 0)
}
function matchStatement(db: D1Database, sessionId: string, m: OpenMatch): D1PreparedStatement {
  return db.prepare(UPSERT_MATCH).bind(
    m.id, sessionId, m.courtId, m.seq, m.status, JSON.stringify(m.teamA), JSON.stringify(m.teamB),
    m.scoreA, m.scoreB, m.winner, m.proposedAt, m.startedAt, m.finishedAt,
  )
}
function sessionUpdate(db: D1Database, s: OpenSessionState): D1PreparedStatement {
  return db.prepare(`UPDATE open_sessions SET name = ?, host_display_name = ?, location = ?, settings_json = ?, status = ?,
      version = ?, last_activity_at = ?, expires_at = ? WHERE id = ?`)
    .bind(s.name, s.hostDisplayName, s.location, JSON.stringify(s.settings), s.status, s.version, s.lastActivityAt, s.expiresAt, s.id)
}

export async function createOpenSession(db: D1Database, state: OpenSessionState, hostKeyHash: string): Promise<void> {
  await db.batch([
    db.prepare(`INSERT INTO open_sessions (id, public_code, host_key_hash, kind, name, host_display_name, location, settings_json, status, version, created_at, last_activity_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(state.id, state.publicCode, hostKeyHash, state.kind, state.name, state.hostDisplayName, state.location,
        JSON.stringify(state.settings), state.status, state.version, state.createdAt, state.lastActivityAt, state.expiresAt),
    ...state.courts.map((c) => courtStatement(db, state.id, c)),
    ...state.players.map((p) => playerStatement(db, state.id, p)),
    ...state.matches.map((m) => matchStatement(db, state.id, m)),
  ])
}

// The row objects below deliberately use the same key order as the
// reducer/create code. diffState compares rows with JSON.stringify, so a
// different order would make every loaded row look changed.
export async function loadOpenSession(
  db: D1Database, code: string, nowIso: string,
): Promise<{ state: OpenSessionState; hostKeyHash: string } | null> {
  const session = await db.prepare('SELECT * FROM open_sessions WHERE public_code = ? AND expires_at > ?').bind(code, nowIso).first<SessionRow>()
  if (!session) return null
  const [players, courts, matches] = await Promise.all([
    db.prepare('SELECT * FROM open_players WHERE session_id = ? ORDER BY position').bind(session.id).all<PlayerRow>(),
    db.prepare('SELECT * FROM open_courts WHERE session_id = ? ORDER BY position').bind(session.id).all<CourtRow>(),
    db.prepare('SELECT * FROM open_matches WHERE session_id = ? ORDER BY seq').bind(session.id).all<MatchRow>(),
  ])
  return {
    hostKeyHash: session.host_key_hash,
    state: {
      id: session.id, publicCode: session.public_code, kind: session.kind, name: session.name,
      hostDisplayName: session.host_display_name, location: session.location, status: session.status,
      settings: JSON.parse(session.settings_json), version: session.version, createdAt: session.created_at,
      lastActivityAt: session.last_activity_at, expiresAt: session.expires_at,
      players: players.results.map((p) => ({
        id: p.id, name: p.name, skill: p.skill, duprId: p.dupr_id, status: p.status, gamesOffset: p.games_offset,
        joinedAt: p.joined_at, waitingSince: p.waiting_since, position: p.position,
      })),
      courts: courts.results.map((c) => ({ id: c.id, label: c.label, position: c.position, enabled: c.enabled === 1 })),
      matches: matches.results.map((m) => ({
        id: m.id, courtId: m.court_id, seq: m.seq, status: m.status,
        teamA: JSON.parse(m.team_a_json) as Team, teamB: JSON.parse(m.team_b_json) as Team,
        scoreA: m.score_a, scoreB: m.score_b, winner: m.winner, proposedAt: m.proposed_at,
        startedAt: m.started_at, finishedAt: m.finished_at,
      })),
    },
  }
}

export async function persistDiff(
  db: D1Database,
  prev: OpenSessionState,
  next: OpenSessionState,
  idempotency: { key: string; responseJson: string; now: string; cutoff: string } | null,
): Promise<void> {
  const diff = diffState(prev, next)
  const statements: D1PreparedStatement[] = [
    ...(diff.sessionChanged ? [sessionUpdate(db, next)] : []),
    ...diff.deleteMatchIds.map((id) => db.prepare('DELETE FROM open_matches WHERE id = ? AND session_id = ?').bind(id, next.id)),
    ...diff.upsertCourts.map((c) => courtStatement(db, next.id, c)),
    ...diff.upsertPlayers.map((p) => playerStatement(db, next.id, p)),
    ...diff.upsertMatches.map((m) => matchStatement(db, next.id, m)),
    ...(idempotency
      ? [
          db.prepare('DELETE FROM open_idempotency WHERE session_id = ? AND created_at < ?').bind(next.id, idempotency.cutoff),
          db.prepare('INSERT INTO open_idempotency (session_id, key, response_json, created_at) VALUES (?, ?, ?, ?)')
            .bind(next.id, idempotency.key, idempotency.responseJson, idempotency.now),
        ]
      : []),
  ]
  if (statements.length) await db.batch(statements)
}

export async function findIdempotentResponse(db: D1Database, sessionId: string, key: string): Promise<string | null> {
  const row = await db.prepare('SELECT response_json FROM open_idempotency WHERE session_id = ? AND key = ?').bind(sessionId, key).first<{ response_json: string }>()
  return row?.response_json ?? null
}

export async function deleteOpenSession(db: D1Database, sessionId: string): Promise<void> {
  await db.prepare('DELETE FROM open_sessions WHERE id = ?').bind(sessionId).run()
}

// The DELETE repeats the expiry test so a session whose expiry was extended
// between the SELECT and the DELETE (a command landed in that gap) survives.
// Only rows whose DELETE actually removed something are reported as purged.
export async function purgeExpiredOpenSessions(db: D1Database, nowIso: string, limit = 500): Promise<string[]> {
  const expired = await db.prepare('SELECT id, public_code FROM open_sessions WHERE expires_at < ? LIMIT ?').bind(nowIso, limit).all<{ id: string; public_code: string }>()
  if (!expired.results.length) return []
  const deletions = await db.batch(
    expired.results.map((row) => db.prepare('DELETE FROM open_sessions WHERE id = ? AND expires_at < ?').bind(row.id, nowIso)),
  )
  return expired.results.filter((_, index) => (deletions[index]?.meta.changes ?? 0) > 0).map((row) => row.public_code)
}

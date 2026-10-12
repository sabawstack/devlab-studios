// Google-verified hosts (spec §9) and their browser logins. Every SQL statement
// for the hosts and host_logins tables lives here (repository pattern). A host
// row is account data and never expires; a login expires after LOGIN_TTL_MS.

export interface HostRecord {
  id: string
  googleSub: string
  email: string
  displayName: string
  duprClubId: string | null
  marketingOptIn: boolean
  createdAt: string
  lastSeenAt: string
}

/** What the host's own screens may show about their account. Never the Google subject id. */
export interface HostProfile {
  email: string
  displayName: string
  duprClubId: string | null
  marketingOptIn: boolean
}

export interface HostSessionSummary {
  code: string
  name: string
  kind: 'OPEN_PLAY' | 'TOURNAMENT'
  status: 'ACTIVE' | 'ENDED'
  lastActivityAt: string
  expiresAt: string
}

interface HostRow {
  id: string; google_sub: string; email: string; display_name: string; dupr_club_id: string | null
  marketing_opt_in: number; created_at: string; last_seen_at: string
}

export const LOGIN_TTL_MS = 30 * 24 * 60 * 60 * 1000
export const MAX_LISTED_SESSIONS = 50

function toRecord(row: HostRow): HostRecord {
  return {
    id: row.id, googleSub: row.google_sub, email: row.email, displayName: row.display_name,
    duprClubId: row.dupr_club_id, marketingOptIn: row.marketing_opt_in === 1, createdAt: row.created_at, lastSeenAt: row.last_seen_at,
  }
}

export function toHostProfile(host: HostRecord): HostProfile {
  return { email: host.email, displayName: host.displayName, duprClubId: host.duprClubId, marketingOptIn: host.marketingOptIn }
}

/**
 * Creates the host on first sign-in, or refreshes their email, name and
 * last_seen_at. The marketing choice is taken only when the row is created:
 * signing in again never changes a choice the host already made.
 */
export async function upsertHost(
  db: D1Database,
  profile: { googleSub: string; email: string; displayName: string; marketingOptIn: boolean },
  ctx: { now: string; newId: () => string },
): Promise<HostRecord> {
  const row = await db.prepare(`INSERT INTO hosts (id, google_sub, email, display_name, dupr_club_id, marketing_opt_in, created_at, last_seen_at)
      VALUES (?, ?, ?, ?, NULL, ?, ?, ?)
      ON CONFLICT(google_sub) DO UPDATE SET email = excluded.email, display_name = excluded.display_name, last_seen_at = excluded.last_seen_at
      RETURNING *`)
    .bind(ctx.newId(), profile.googleSub, profile.email, profile.displayName, profile.marketingOptIn ? 1 : 0, ctx.now, ctx.now)
    .first<HostRow>()
  if (!row) throw new Error('Host upsert returned no row.')
  return toRecord(row)
}

export async function createHostLogin(db: D1Database, login: { tokenHash: string; hostId: string; now: string }): Promise<void> {
  const expiresAt = new Date(Date.parse(login.now) + LOGIN_TTL_MS).toISOString()
  await db.prepare('INSERT INTO host_logins (token_hash, host_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(login.tokenHash, login.hostId, login.now, expiresAt).run()
}

/** The host a live login belongs to, or null for an unknown, expired or deleted one. */
export async function findHostByLogin(db: D1Database, tokenHash: string, now: string): Promise<HostRecord | null> {
  const row = await db.prepare(`SELECT h.* FROM host_logins l JOIN hosts h ON h.id = l.host_id
      WHERE l.token_hash = ? AND l.expires_at > ?`).bind(tokenHash, now).first<HostRow>()
  return row ? toRecord(row) : null
}

export async function deleteHostLogin(db: D1Database, tokenHash: string): Promise<void> {
  await db.prepare('DELETE FROM host_logins WHERE token_hash = ?').bind(tokenHash).run()
}

/** Applies only the fields given. Returns the updated host, or null when it no longer exists. */
export async function updateHostProfile(
  db: D1Database, hostId: string, patch: { duprClubId?: string | null; marketingOptIn?: boolean },
): Promise<HostRecord | null> {
  const sets: string[] = []
  const values: Array<string | number | null> = []
  if (patch.duprClubId !== undefined) {
    sets.push('dupr_club_id = ?')
    values.push(patch.duprClubId)
  }
  if (patch.marketingOptIn !== undefined) {
    sets.push('marketing_opt_in = ?')
    values.push(patch.marketingOptIn ? 1 : 0)
  }
  if (sets.length) await db.prepare(`UPDATE hosts SET ${sets.join(', ')} WHERE id = ?`).bind(...values, hostId).run()
  const row = await db.prepare('SELECT * FROM hosts WHERE id = ?').bind(hostId).first<HostRow>()
  return row ? toRecord(row) : null
}

/**
 * Deletes the account (spec §3.2 "Delete my account"): its sessions are
 * unlinked, not deleted, and every login goes with it (cascade). Returns the
 * public codes of the sessions that were linked, so their coordinators can
 * drop the link from memory.
 */
export async function deleteHost(db: D1Database, hostId: string): Promise<string[]> {
  // RETURNING inside the same batch: a claim landing just before the delete is still reported.
  const [unlinked] = await db.batch<{ public_code: string }>([
    db.prepare('UPDATE open_sessions SET host_id = NULL WHERE host_id = ? RETURNING public_code').bind(hostId),
    db.prepare('DELETE FROM hosts WHERE id = ?').bind(hostId),
  ])
  return (unlinked?.results ?? []).map((row) => row.public_code)
}

/** The host's claimed sessions that have not expired, most recently active first (spec §9.5). */
export async function listHostSessions(db: D1Database, hostId: string, now: string): Promise<HostSessionSummary[]> {
  const rows = await db.prepare(`SELECT public_code, name, kind, status, last_activity_at, expires_at FROM open_sessions
      WHERE host_id = ? AND expires_at > ? ORDER BY last_activity_at DESC LIMIT ?`)
    .bind(hostId, now, MAX_LISTED_SESSIONS)
    .all<{ public_code: string; name: string; kind: HostSessionSummary['kind']; status: HostSessionSummary['status']; last_activity_at: string; expires_at: string }>()
  return rows.results.map((r) => ({
    code: r.public_code, name: r.name, kind: r.kind, status: r.status, lastActivityAt: r.last_activity_at, expiresAt: r.expires_at,
  }))
}

/** Removes expired logins (daily cron). Returns how many were removed. */
export async function purgeExpiredHostLogins(db: D1Database, now: string): Promise<number> {
  const result = await db.prepare('DELETE FROM host_logins WHERE expires_at <= ?').bind(now).run()
  return result.meta.changes ?? 0
}

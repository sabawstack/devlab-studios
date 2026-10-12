// Per-session host access beyond the original host key (spec §9): the claim
// (open_sessions.host_id), extra host links minted for the claiming account,
// and the DUPR export log behind the 5-per-day limit. The Durable Object is
// the only caller, so every change here is serialized per session.

export interface HostAccess {
  /** The Google-verified host who claimed the session, or null. */
  hostId: string | null
  /** SHA-256 hashes of extra host links, oldest first. */
  extraKeyHashes: string[]
}

export const MAX_EXTRA_HOST_KEYS = 10

export async function loadHostAccess(db: D1Database, sessionId: string): Promise<HostAccess> {
  const [session, keys] = await Promise.all([
    db.prepare('SELECT host_id FROM open_sessions WHERE id = ?').bind(sessionId).first<{ host_id: string | null }>(),
    db.prepare('SELECT key_hash FROM open_host_keys WHERE session_id = ? ORDER BY created_at, id').bind(sessionId).all<{ key_hash: string }>(),
  ])
  return { hostId: session?.host_id ?? null, extraKeyHashes: keys.results.map((k) => k.key_hash) }
}

/**
 * Links an unclaimed session to a host that still exists. False when the
 * session was already claimed or the host is gone (deleted mid-flow), so a
 * claim can never be overwritten and never points at a missing account.
 */
export async function claimSession(db: D1Database, sessionId: string, hostId: string): Promise<boolean> {
  const result = await db.prepare(`UPDATE open_sessions SET host_id = ?
      WHERE id = ? AND host_id IS NULL AND EXISTS (SELECT 1 FROM hosts WHERE id = ?)`)
    .bind(hostId, sessionId, hostId).run()
  return (result.meta.changes ?? 0) === 1
}

export async function insertHostKey(db: D1Database, key: { id: string; sessionId: string; keyHash: string; createdAt: string }): Promise<void> {
  await db.prepare('INSERT INTO open_host_keys (id, session_id, key_hash, created_at) VALUES (?, ?, ?, ?)')
    .bind(key.id, key.sessionId, key.keyHash, key.createdAt).run()
}

/** When each DUPR export since `sinceIso` was sent, oldest first. */
export async function recentDuprExports(db: D1Database, sessionId: string, sinceIso: string): Promise<string[]> {
  const rows = await db.prepare('SELECT sent_at FROM open_dupr_exports WHERE session_id = ? AND sent_at > ? ORDER BY sent_at')
    .bind(sessionId, sinceIso).all<{ sent_at: string }>()
  return rows.results.map((r) => r.sent_at)
}

export async function insertDuprExport(
  db: D1Database, row: { id: string; sessionId: string; sentAt: string; gameCount: number; skippedCount: number },
): Promise<void> {
  await db.prepare('INSERT INTO open_dupr_exports (id, session_id, sent_at, game_count, skipped_count) VALUES (?, ?, ?, ?, ?)')
    .bind(row.id, row.sessionId, row.sentAt, row.gameCount, row.skippedCount).run()
}

/** Gives an export back when its email could not be sent. */
export async function deleteDuprExport(db: D1Database, sessionId: string, id: string): Promise<void> {
  await db.prepare('DELETE FROM open_dupr_exports WHERE id = ? AND session_id = ?').bind(id, sessionId).run()
}

/**
 * Server-side revocation list for admin session tokens.
 *
 * Admin sessions are stateless HMAC-signed tokens, so "Log out" could only
 * ever clear the cookie — the token itself stayed valid for its full 8-hour
 * lifetime, and anyone holding a copy (shared machine, unlocked device) could
 * keep using it after the admin believed they had signed out. This table is
 * the missing half: logout records the token's `jti`, and requireAdmin
 * refuses any token listed here.
 *
 * A row is only useful until the token would have expired on its own, so
 * every write opportunistically prunes the ones that are past that point
 * rather than relying on a scheduled job.
 */

/** Drops rows for tokens that have expired on their own. Best-effort. */
async function pruneExpired(db) {
  await db
    .prepare('DELETE FROM admin_session_revocations WHERE expires_at <= ?')
    .bind(new Date().toISOString())
    .run()
}

/**
 * @param {D1Database} db
 * @param {{ jti: string, adminEmail?: string | null, expiresAt: string }} session
 * @returns {Promise<boolean>} whether the revocation was actually recorded
 */
export async function revokeAdminSession(db, { jti, adminEmail = null, expiresAt }) {
  if (!db || !jti || !expiresAt) return false

  try {
    await db
      .prepare(
        `INSERT INTO admin_session_revocations (jti, admin_email, revoked_at, expires_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(jti) DO NOTHING`,
      )
      .bind(jti, adminEmail, new Date().toISOString(), expiresAt)
      .run()

    await pruneExpired(db).catch(() => undefined)
    return true
  } catch {
    // The table may not exist yet on an environment that hasn't had
    // migration 0008 applied. Logout still clears the cookie, which is
    // exactly the behaviour that shipped before this table existed, so a
    // deploy that lands ahead of its migration degrades rather than breaks.
    return false
  }
}

/**
 * Whether a token may still be used.
 *
 * FAILS CLOSED (October 2026 security audit, L2). This used to return
 * "not revoked" on any D1 error, so during a D1 outage -- or on a database
 * missing migration 0008 -- a token the admin had explicitly signed out kept
 * working. An unreadable revocation list is now 'unknown', which requireAdmin
 * refuses with a 503. A token with no `jti` cannot be revoked at all, so it is
 * treated as revoked (every token issued since 0008 carries one).
 *
 * @param {D1Database} db
 * @param {string | undefined} jti
 * @returns {Promise<'active' | 'revoked' | 'unknown'>}
 */
export async function getAdminSessionRevocationState(db, jti) {
  if (!jti) return 'revoked'
  if (!db) return 'unknown'

  try {
    const row = await db
      .prepare('SELECT 1 AS revoked FROM admin_session_revocations WHERE jti = ? AND expires_at > ? LIMIT 1')
      .bind(jti, new Date().toISOString())
      .first()

    return row ? 'revoked' : 'active'
  } catch (error) {
    console.error(JSON.stringify({
      event: 'admin_session_revocation_check',
      outcome: 'failure',
      errorMessage: error instanceof Error ? error.message : String(error),
    }))
    return 'unknown'
  }
}

/**
 * True unless the token is positively known to be active -- a failed lookup
 * counts as revoked.
 *
 * @param {D1Database} db
 * @param {string | undefined} jti
 * @returns {Promise<boolean>}
 */
export async function isAdminSessionRevoked(db, jti) {
  return (await getAdminSessionRevocationState(db, jti)) !== 'active'
}

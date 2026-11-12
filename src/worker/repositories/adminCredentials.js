import { nowIso } from '../utils/responses'

/**
 * The admin credential, when one has been set through the CMS.
 *
 * Every read here FAILS SOFT: if D1 is unreachable or the table is missing
 * (a deploy that lands ahead of its migration), the caller falls back to the
 * environment credential rather than the CMS going offline. A database blip
 * must not lock the owner out of their own site — that is the whole reason the
 * env credential is kept as a permanent bootstrap.
 */

function toCredential(row) {
  if (!row) return null
  return {
    email: row.email,
    passwordHash: row.password_hash,
    role: row.role || 'owner',
    passwordChangedAt: row.password_changed_at || null,
  }
}

/** @param {import('@cloudflare/workers-types').D1Database} db */
export async function getAdminCredential(db, email) {
  if (!db || !email) return null

  try {
    const row = await db
      .prepare('SELECT email, password_hash, role, password_changed_at FROM admin_credentials WHERE email = ?')
      .bind(String(email).trim().toLowerCase())
      .first()
    return toCredential(row)
  } catch {
    return null
  }
}

/**
 * When the account's password last changed, as epoch seconds, or 0 when there
 * is no stored credential.
 *
 * Epoch seconds rather than an ISO string because it is compared against the
 * session token's `iat`, which is in seconds.
 *
 * @param {import('@cloudflare/workers-types').D1Database} db
 */
export async function getPasswordChangedAtSeconds(db, email) {
  const credential = await getAdminCredential(db, email)
  if (!credential?.passwordChangedAt) return 0

  const parsed = Date.parse(credential.passwordChangedAt)
  return Number.isNaN(parsed) ? 0 : Math.floor(parsed / 1000)
}

/**
 * Writes the new credential. Unlike the reads above this does NOT swallow
 * errors: if the write fails the caller must report failure, or the operator
 * is told their password changed when it did not.
 *
 * @param {import('@cloudflare/workers-types').D1Database} db
 */
export async function upsertAdminCredential(db, { email, passwordHash, role = 'owner' }) {
  const timestamp = nowIso()
  const normalizedEmail = String(email).trim().toLowerCase()

  await db
    .prepare(
      `INSERT INTO admin_credentials (email, password_hash, role, password_changed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(email) DO UPDATE SET
         password_hash = excluded.password_hash,
         role = excluded.role,
         password_changed_at = excluded.password_changed_at,
         updated_at = excluded.updated_at`,
    )
    .bind(normalizedEmail, passwordHash, role, timestamp, timestamp, timestamp)
    .run()

  return { email: normalizedEmail, role, passwordChangedAt: timestamp }
}

/**
 * Every CMS-managed login, without its hash (CMS-04 / SEC-02).
 *
 * @param {import('@cloudflare/workers-types').D1Database} db
 */
export async function listAdminCredentials(db) {
  const result = await db
    .prepare('SELECT email, role, password_changed_at, created_at, updated_at FROM admin_credentials ORDER BY created_at ASC')
    .all()
  return (result.results || []).map((row) => ({
    email: row.email,
    role: row.role,
    passwordChangedAt: row.password_changed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }))
}

/**
 * Removes a CMS-managed login. Its sessions stop working on their next request
 * (requireAdmin checks that the account still exists). Does not swallow errors.
 *
 * @param {import('@cloudflare/workers-types').D1Database} db
 */
export async function deleteAdminCredential(db, email) {
  const result = await db.prepare('DELETE FROM admin_credentials WHERE email = ?').bind(String(email || '').trim().toLowerCase()).run()
  return Number(result?.meta?.changes || 0) > 0
}

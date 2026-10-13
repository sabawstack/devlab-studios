/**
 * At most one visitor confirmation per recipient address per 24 hours.
 *
 * The confirmation goes to whatever address the visitor typed, so without a
 * cap the contact form is a way to point DevLab-branded, DKIM-signed mail at
 * an arbitrary inbox as often as the per-IP limiter allows (security audit
 * F4 / M5). The owner notification is NOT capped — every submission still
 * reaches the studio.
 *
 * Addresses are stored as SHA-256 hashes only (migrations/0017).
 */

/** Rolling window for the cap. */
export const CONFIRMATION_WINDOW_MS = 24 * 60 * 60 * 1000

/** Domain-separation prefix, so these hashes are not reusable as plain address hashes. */
const HASH_PREFIX = 'devlab-confirmation-v1:'

/**
 * @param {string} address
 * @returns {Promise<string>} hex SHA-256 of the prefixed, lowercased address
 */
export async function hashRecipient(address) {
  const normalized = String(address ?? '').trim().toLowerCase()
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${HASH_PREFIX}${normalized}`))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Claims the right to send one confirmation to `address` now.
 *
 * Atomic: a single upsert whose `WHERE` only lets it through when the previous
 * send is older than the window, so two submissions racing for the same
 * address cannot both win. Returns false when the address already received a
 * confirmation inside the window.
 *
 * @param {D1Database} db
 * @param {string} address
 * @param {{ now?: Date }} [options]
 * @returns {Promise<boolean>}
 */
export async function claimConfirmationSlot(db, address, { now = new Date() } = {}) {
  const hash = await hashRecipient(address)
  const nowIso = now.toISOString()
  const cutoff = new Date(now.getTime() - CONFIRMATION_WINDOW_MS).toISOString()

  const result = await db
    .prepare(
      `INSERT INTO confirmation_recipients (address_hash, last_sent_at) VALUES (?, ?)
       ON CONFLICT(address_hash) DO UPDATE SET last_sent_at = excluded.last_sent_at
       WHERE confirmation_recipients.last_sent_at < ?`,
    )
    .bind(hash, nowIso, cutoff)
    .run()

  return Number(result?.meta?.changes ?? result?.meta?.rows_written ?? 0) > 0
}

/**
 * Gives a claimed slot back after a send that did not go out, so a failed
 * confirmation can be retried without waiting out the window. Only releases
 * the claim this call made (matched on its timestamp).
 *
 * @param {D1Database} db
 * @param {string} address
 * @param {Date} claimedAt the `now` passed to claimConfirmationSlot
 */
export async function releaseConfirmationSlot(db, address, claimedAt) {
  const hash = await hashRecipient(address)
  await db
    .prepare('DELETE FROM confirmation_recipients WHERE address_hash = ? AND last_sent_at = ?')
    .bind(hash, claimedAt.toISOString())
    .run()
}

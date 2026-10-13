/**
 * The outbound queue.
 *
 * Same two rules the lead engine's outbox is built around, for the same
 * reasons (see src/lead-engine/services/outbox.js):
 *
 *   1. UNDER-SEND RATHER THAN DOUBLE-SEND. A row moves to `collected` the
 *      moment it is handed out and is never offered again. If the transmitter
 *      dies between collecting and sending, that reply is not sent and sits in
 *      the CMS for a person. The opposite bias mails a stranger twice.
 *   2. `sent` is recorded by the transmitter calling back, not by handing the
 *      message over. Only the callback knows whether it reached an MTA.
 */

import { bounded, clampLimit, newId, nowIso, operationError } from './helpers.js'
import { checkSuppression } from '../../lead-engine/repositories/suppression.js'
import { strictRecipient } from '../../lead-engine/domain/domains.js'

/** D1 reports `changes`; older shapes report `rows_written`. */
function changed(result) {
  return Number(result?.meta?.changes ?? result?.meta?.rows_written ?? 0) > 0
}

/**
 * Why `address` may not be sent to right now, or null if it may.
 *
 * Re-checked at every point a message moves toward the wire -- draft edit,
 * draft promotion, collection -- not only when it was composed. Someone may
 * opt out, or an operator may suppress a domain, while a reply sits in Drafts
 * or the queue; the gate has to run when it matters.
 *
 * @param {D1Database} db
 * @param {string} address
 * @returns {Promise<string|null>}
 */
export async function sendBlockReason(db, address) {
  const recipient = strictRecipient(address)
  if (!recipient) return 'The recipient is not a single valid address.'
  const suppression = await checkSuppression(db, recipient)
  if (suppression.suppressed) {
    return `That address is suppressed${suppression.entry?.reason ? ` (${suppression.entry.reason})` : ''}.`
  }
  return null
}

function mapOutbound(row) {
  if (!row) return null
  return {
    id: row.id,
    threadId: row.thread_id,
    inReplyToMessageId: row.in_reply_to_message_id,
    mailbox: row.mailbox,
    toAddress: row.to_address,
    toName: row.to_name,
    subject: row.subject,
    bodyText: row.body_text,
    messageId: row.message_id,
    inReplyTo: row.in_reply_to,
    references: row.references_header,
    envelopeFrom: row.envelope_from,
    status: row.status,
    collectedAt: row.collected_at,
    sentAt: row.sent_at,
    failedAt: row.failed_at,
    error: row.error,
    providerMessageId: row.provider_message_id,
    leadId: row.lead_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * @param {D1Database} db
 * @param {string} id
 * @returns {Promise<any|null>}
 */
export async function getOutbound(db, id) {
  return mapOutbound(await db.prepare('SELECT * FROM mailbox_outbound WHERE id = ?').bind(id).first())
}

/** @param {D1Database} db */
export async function queueOutbound(db, input) {
  const id = input.id ?? newId()
  const now = nowIso()

  await db
    .prepare(
      `INSERT INTO mailbox_outbound
         (id, thread_id, in_reply_to_message_id, mailbox, to_address, to_name, subject, body_text,
          message_id, in_reply_to, references_header, envelope_from,
          status, lead_id, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.threadId,
      input.inReplyToMessageId ?? null,
      input.mailbox,
      String(input.toAddress).toLowerCase(),
      input.toName ? bounded(input.toName, 200) : null,
      bounded(input.subject ?? '', 500),
      bounded(input.bodyText ?? '', 100_000),
      input.messageId,
      input.inReplyTo ?? null,
      input.references ? bounded(input.references, 4_000) : null,
      input.envelopeFrom,
      // 'draft' keeps it out of the transmitter's reach by construction:
      // collectQueued selects WHERE status = 'queued'.
      input.status === 'draft' ? 'draft' : 'queued',
      input.leadId ?? null,
      input.createdBy ?? null,
      now,
      now,
    )
    .run()

  return getOutbound(db, id)
}

/**
 * Hands out queued replies and marks them collected in the same step.
 *
 * The UPDATE carries `status = 'queued'` in its WHERE clause, so two
 * transmitters polling at once cannot both take the same row — whichever
 * UPDATE lands second changes nothing and that row is dropped from the result.
 * Selecting first and updating after would hand the same reply to both.
 *
 * @param {D1Database} db
 * @param {{ limit?: number }} [options]
 * @returns {Promise<any[]>}
 */
export async function collectQueued(db, { limit = 10 } = {}) {
  const take = clampLimit(limit, 10, 50)
  const result = await db
    .prepare("SELECT * FROM mailbox_outbound WHERE status = 'queued' ORDER BY created_at ASC LIMIT ?")
    .bind(take)
    .all()

  const collected = []
  const now = nowIso()

  for (const row of result.results || []) {
    // Suppression and address validity, re-checked at the last moment this
    // application controls. A blocked row is marked failed with the reason --
    // terminal, visible in the Outbox, never handed out -- rather than silently
    // skipped (it would be re-offered forever) or sent.
    const blocked = await sendBlockReason(db, row.to_address)
    if (blocked) {
      await db
        .prepare(
          "UPDATE mailbox_outbound SET status = 'failed', failed_at = ?, error = ?, updated_at = ? " +
            "WHERE id = ? AND status = 'queued'",
        )
        .bind(now, bounded(`Not sent: ${blocked}`, 1_000), now, row.id)
        .run()
      continue
    }

    const claimed = await db
      .prepare(
        "UPDATE mailbox_outbound SET status = 'collected', collected_at = ?, updated_at = ? " +
          "WHERE id = ? AND status = 'queued'",
      )
      .bind(now, now, row.id)
      .run()

    // D1 reports rows_written; a claim that changed nothing was won by someone
    // else and must not be handed out here as well.
    if (changed(claimed)) {
      collected.push(mapOutbound({ ...row, status: 'collected', collected_at: now }))
    }
  }

  return collected
}

/**
 * Records that the transmitter put a reply on the wire.
 *
 * Idempotent: confirming twice leaves the row `sent` with its original
 * timestamp. A retry after a timeout must not look like a second send.
 *
 * @param {D1Database} db
 * @param {string} id
 * @param {{ providerMessageId?: string|null, sentAt?: string|null }} [options]
 */
export async function markSent(db, id, { providerMessageId = null, sentAt = null } = {}) {
  const row = await getOutbound(db, id)
  if (!row) throw operationError('Outbound message not found.', 404)
  if (row.status === 'sent') return { status: 'already_sent', outbound: row }
  // ONLY FROM `collected`. The transmitter can only have sent what it was
  // handed; a callback naming a draft, a cancelled reply or one still queued
  // is a bug or a forged call, and honouring it would show a message as
  // delivered that never left, or resurrect one a person cancelled.
  if (row.status !== 'collected') {
    throw operationError(`This message is ${row.status}; only a collected message can be confirmed sent.`, 409)
  }

  const now = nowIso()
  const result = await db
    .prepare(
      "UPDATE mailbox_outbound SET status = 'sent', sent_at = ?, provider_message_id = ?, " +
        "error = NULL, failed_at = NULL, updated_at = ? WHERE id = ? AND status = 'collected'",
    )
    .bind(sentAt || now, providerMessageId, now, id)
    .run()

  if (!changed(result)) {
    const current = await getOutbound(db, id)
    if (current?.status === 'sent') return { status: 'already_sent', outbound: current }
    throw operationError(`This message is ${current?.status ?? 'gone'}; it was not confirmed sent.`, 409)
  }

  return { status: 'ok', outbound: await getOutbound(db, id) }
}

/**
 * Records a transmission failure.
 *
 * Returns to `queued` rather than staying `failed` ONLY when the caller says
 * the failure is retryable. A reply that silently retried forever would mail
 * the same person repeatedly the moment the fault cleared.
 *
 * @param {D1Database} db
 * @param {string} id
 * @param {{ error?: string|null, retryable?: boolean }} [options]
 */
export async function markFailed(db, id, { error = null, retryable = false } = {}) {
  const row = await getOutbound(db, id)
  if (!row) throw operationError('Outbound message not found.', 404)
  if (row.status === 'sent') return { status: 'already_sent', outbound: row }
  // Same rule as markSent: only a `collected` row may be reported failed.
  // Repeating the same terminal report is idempotent; anything else is a 409,
  // so a failure callback can no longer re-queue a draft or a cancelled reply.
  if (row.status === 'failed' && !retryable) return { status: 'already_failed', outbound: row }
  if (row.status !== 'collected') {
    throw operationError(`This message is ${row.status}; only a collected message can be reported failed.`, 409)
  }

  const now = nowIso()
  const result = await db
    .prepare(
      `UPDATE mailbox_outbound SET status = ?, failed_at = ?, error = ?, updated_at = ?
       WHERE id = ? AND status = 'collected'`,
    )
    .bind(retryable ? 'queued' : 'failed', now, error ? bounded(error, 1_000) : null, now, id)
    .run()

  if (!changed(result)) {
    const current = await getOutbound(db, id)
    throw operationError(`This message is ${current?.status ?? 'gone'}; the failure was not recorded.`, 409)
  }

  return { status: 'ok', outbound: await getOutbound(db, id) }
}

/** @param {D1Database} db */
export async function cancelOutbound(db, id) {
  const row = await getOutbound(db, id)
  if (!row) throw operationError('Outbound message not found.', 404)
  // Only a reply nobody has taken yet. Once it is collected we cannot know
  // whether it has already reached an MTA, and saying "cancelled" about a
  // message that went out is worse than admitting we do not know.
  if (row.status !== 'queued') {
    throw operationError(`This reply is ${row.status} and can no longer be cancelled.`, 409)
  }

  const now = nowIso()
  await db
    .prepare("UPDATE mailbox_outbound SET status = 'cancelled', updated_at = ? WHERE id = ? AND status = 'queued'")
    .bind(now, id)
    .run()

  return getOutbound(db, id)
}

/**
 * Puts a failed reply back in the queue, as an explicit human act.
 *
 * WHY THIS IS NOT AUTOMATIC. `markFailed` already returns a row to `queued`
 * when the transmitter says the failure was retryable. Everything else stays
 * `failed` on purpose: a submission that reported failure may still have
 * reached an MTA, so retrying it risks a second copy landing on a stranger.
 * The system under-sends rather than double-sends, and it cannot tell the two
 * cases apart on its own.
 *
 * A person can. They can read the error, see that `451 4.7.1` came from our own
 * Postfix before `DATA` was ever accepted, and know nothing was transmitted.
 * That judgement is the safeguard, which is why this is a button and not a
 * timer.
 *
 * `error` is deliberately left on the row. It is the record of what happened
 * last, the UI shows it as such while the reply waits, and the next outcome
 * overwrites it — `markSent` clears it, `markFailed` replaces it.
 *
 * @param {D1Database} db
 * @param {string} id
 */
export async function requeueOutbound(db, id) {
  const row = await getOutbound(db, id)
  if (!row) throw operationError('Outbound message not found.', 404)

  if (row.status === 'sent') {
    throw operationError('This reply was already sent. Send a new one rather than repeating it.', 409)
  }

  // `collected` is the dangerous one: the transmitter holds it and we do not
  // know whether it reached an MTA. Re-queueing that is exactly the
  // double-send this system refuses to risk.
  if (row.status !== 'failed') {
    throw operationError(`This reply is ${row.status} and is not waiting to be retried.`, 409)
  }

  const now = nowIso()
  await db
    .prepare(
      "UPDATE mailbox_outbound SET status = 'queued', collected_at = NULL, failed_at = NULL, " +
        "updated_at = ? WHERE id = ? AND status = 'failed'",
    )
    .bind(now, id)
    .run()

  return getOutbound(db, id)
}

/**
 * Saves a reply without handing it to the transmitter.
 *
 * A draft is invisible to the sender BY CONSTRUCTION, not by a filter someone
 * has to remember: `collectQueued` selects `WHERE status = 'queued'`, so a
 * draft is never offered. Promoting it is the explicit act of sending.
 *
 * @param {D1Database} db
 * @param {string} id
 * @param {{ subject?: string, bodyText?: string, toAddress?: string }} input
 */
export async function updateDraft(db, id, input) {
  const row = await getOutbound(db, id)
  if (!row) throw operationError('Draft not found.', 404)
  // Only while it is still a draft. Editing a message that has been handed out
  // would change what the CMS shows without changing what was transmitted.
  if (row.status !== 'draft') {
    throw operationError(`This reply is ${row.status} and can no longer be edited.`, 409)
  }

  // A new recipient gets the same gates composing one does: one strictly valid
  // address, not suppressed. Editing a draft must not be the way around the
  // check composeReply ran on the original address.
  let toAddress = null
  if (input.toAddress !== undefined) {
    toAddress = strictRecipient(input.toAddress)
    if (!toAddress) throw operationError('That recipient is not a single valid address.', 422)
    const blocked = await sendBlockReason(db, toAddress)
    if (blocked) {
      throw operationError(`${blocked} Remove it on the Suppression screen first if this is deliberate.`, 409)
    }
  }

  await db
    .prepare(
      `UPDATE mailbox_outbound
       SET subject = COALESCE(?, subject),
           body_text = COALESCE(?, body_text),
           to_address = COALESCE(?, to_address),
           updated_at = ?
       WHERE id = ? AND status = 'draft'`,
    )
    .bind(
      input.subject === undefined ? null : bounded(input.subject, 500),
      input.bodyText === undefined ? null : bounded(input.bodyText, 100_000),
      toAddress,
      nowIso(),
      id,
    )
    .run()

  return getOutbound(db, id)
}

/**
 * Hands a draft to the transmitter.
 *
 * `WHERE status = 'draft'` in the UPDATE, so pressing Send twice queues once.
 *
 * @param {D1Database} db
 * @param {string} id
 */
export async function promoteDraft(db, id) {
  const row = await getOutbound(db, id)
  if (!row) throw operationError('Draft not found.', 404)
  if (row.status === 'queued') return row
  if (row.status !== 'draft') {
    throw operationError(`This reply is already ${row.status}.`, 409)
  }

  // Re-checked here: a draft can sit for days and the address may have opted
  // out since. A blocked draft STAYS a draft (409) so the operator can see why
  // and change the recipient; collection checks again regardless.
  const blocked = await sendBlockReason(db, row.toAddress)
  if (blocked) {
    throw operationError(`${blocked} Remove it on the Suppression screen first if this is deliberate.`, 409)
  }

  const now = nowIso()
  await db
    .prepare("UPDATE mailbox_outbound SET status = 'queued', updated_at = ? WHERE id = ? AND status = 'draft'")
    .bind(now, id)
    .run()

  return getOutbound(db, id)
}

/**
 * Discards a draft.
 *
 * A real DELETE, unlike a thread's `trash` state. Nothing was transmitted and
 * nobody else has seen it, so there is no record to preserve — and leaving
 * abandoned drafts around forever is how a Drafts folder becomes useless.
 *
 * @param {D1Database} db
 * @param {string} id
 */
export async function deleteDraft(db, id) {
  const row = await getOutbound(db, id)
  if (!row) throw operationError('Draft not found.', 404)
  if (row.status !== 'draft') {
    throw operationError(`This reply is ${row.status} and cannot be deleted.`, 409)
  }

  await db.prepare("DELETE FROM mailbox_outbound WHERE id = ? AND status = 'draft'").bind(id).run()
  return { status: 'deleted', id }
}

/**
 * Outbound rows in the given states, newest first — the Drafts and Outbox
 * folders.
 *
 * @param {D1Database} db
 * @param {{ statuses: string[], limit?: number }} filters
 * @returns {Promise<any[]>}
 */
export async function listOutboundByStatus(db, { statuses, limit = 100 }) {
  const wanted = (statuses || []).filter(Boolean)
  if (wanted.length === 0) return []

  const result = await db
    .prepare(
      `SELECT o.*, t.correspondent_name, t.lead_id AS thread_lead_id
       FROM mailbox_outbound o
       JOIN mailbox_threads t ON t.id = o.thread_id
       WHERE o.status IN (${wanted.map(() => '?').join(', ')})
       ORDER BY o.updated_at DESC
       LIMIT ?`,
    )
    .bind(...wanted, clampLimit(limit, 100, 200))
    .all()

  return (result.results || []).map((row) => ({
    ...mapOutbound(row),
    correspondentName: row.correspondent_name ?? null,
  }))
}

/** @param {D1Database} db */
export async function listOutboundForThread(db, threadId) {
  const result = await db
    .prepare('SELECT * FROM mailbox_outbound WHERE thread_id = ? ORDER BY created_at ASC')
    .bind(threadId)
    .all()
  return (result.results || []).map(mapOutbound)
}

/**
 * Queue health for the diagnostics screen.
 *
 * @param {D1Database} db
 * @returns {Promise<Record<string, number>>}
 */
export async function outboundCounts(db) {
  const result = await db.prepare('SELECT status, COUNT(*) AS n FROM mailbox_outbound GROUP BY status').all()
  const counts = {}
  for (const row of result.results || []) counts[row.status] = Number(row.n ?? 0)
  return counts
}

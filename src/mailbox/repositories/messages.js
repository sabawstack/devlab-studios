/**
 * Mailbox messages and their attachments.
 *
 * INSERT-only for content. The only UPDATEs touch read state, lifecycle state
 * and the correlation columns — metadata about a message, never the message.
 * A mailbox whose contents can be edited is not a record of anything.
 *
 * IDEMPOTENCY IS A PLAIN INSERT PLUS A CAUGHT UNIQUE VIOLATION, never
 * `INSERT OR IGNORE`. See repositories/helpers.js and the header of
 * migrations/0014_mailbox.sql for why that distinction has cost this schema
 * time three times already.
 */

import { LIMITS } from '../config.js'
import { bounded, clampLimit, isUniqueViolation, newId, nowIso, parseJsonField, toInt } from './helpers.js'
import { threadRollupStatements } from './threads.js'

export function mapMessage(row) {
  if (!row) return null
  return {
    id: row.id,
    threadId: row.thread_id,
    mailbox: row.mailbox,
    direction: row.direction,
    envelopeFrom: row.envelope_from,
    envelopeTo: row.envelope_to,
    messageId: row.message_id,
    inReplyTo: row.in_reply_to,
    references: row.references_header,
    fromAddress: row.from_address,
    fromName: row.from_name,
    replyTo: row.reply_to,
    toAddresses: parseJsonField(row.to_addresses, []),
    ccAddresses: parseJsonField(row.cc_addresses, []),
    subject: row.subject,
    bodyText: row.body_text,
    bodyHtml: row.body_html,
    bodyTruncated: row.body_truncated === 1,
    strippedRemoteContent: row.stripped_remote_content === 1,
    rawKey: row.raw_key,
    rawSize: Number(row.raw_size ?? 0),
    parseStatus: row.parse_status,
    parseError: row.parse_error,
    auth: { spf: row.auth_spf, dkim: row.auth_dkim, dmarc: row.auth_dmarc },
    // Whether the edge verified the sender. Only `dmarc=pass` from Cloudflare's
    // own Authentication-Results counts (see inbound/parse.js); anything else
    // means the From address is the sender's unverified claim, and the UI says
    // so. Outbound rows are ours, so the question does not apply.
    verified: row.direction === 'inbound' ? row.auth_dmarc === 'pass' : true,
    isDsn: row.is_dsn === 1,
    dsn: row.is_dsn === 1
      ? {
          action: row.dsn_action,
          status: row.dsn_status,
          recipient: row.dsn_recipient,
          diagnostic: row.dsn_diagnostic,
        }
      : null,
    correlationMethod: row.correlation_method,
    leadId: row.lead_id,
    draftId: row.draft_id,
    readAt: row.read_at,
    state: row.state,
    receivedAt: row.received_at,
    sentAt: row.sent_at,
    createdAt: row.created_at,
  }
}

/**
 * @param {D1Database} db
 * @param {string} id
 * @returns {Promise<any|null>}
 */
export async function getMessage(db, id) {
  return mapMessage(await db.prepare('SELECT * FROM mailbox_messages WHERE id = ?').bind(id).first())
}

/** @param {D1Database} db */
export async function findByDedupeKey(db, dedupeKey) {
  return mapMessage(
    await db.prepare('SELECT * FROM mailbox_messages WHERE dedupe_key = ?').bind(dedupeKey).first(),
  )
}

/**
 * Stores a message and folds it into its thread's rollups, in one batch.
 *
 * Returns `created: false` for a message we already have. That is the normal
 * path, not an error: Cloudflare may invoke the handler more than once for the
 * same delivery, and an ingest that is not idempotent duplicates a prospect's
 * reply in front of whoever reads it.
 *
 * @param {D1Database} db
 * @param {object} input
 * @returns {Promise<{ message: object|null, created: boolean }>}
 */
export async function insertMessage(db, input) {
  const existing = await findByDedupeKey(db, input.dedupeKey)
  if (existing) return { message: existing, created: false }

  const id = input.id ?? newId()
  const now = nowIso()
  const body = String(input.bodyText ?? '')
  const truncated = body.length > LIMITS.maxBodyChars || Boolean(input.bodyTruncated)
  const messageAt = input.direction === 'inbound' ? input.receivedAt || now : input.sentAt || now

  const statements = [
    db
      .prepare(
        `INSERT INTO mailbox_messages
           (id, thread_id, mailbox, direction, dedupe_key, envelope_from, envelope_to,
            message_id, in_reply_to, references_header,
            from_address, from_name, reply_to, to_addresses, cc_addresses, subject,
            body_text, body_html, body_truncated, stripped_remote_content,
            raw_key, raw_size, parse_status, parse_error,
            auth_spf, auth_dkim, auth_dmarc,
            is_dsn, dsn_action, dsn_status, dsn_recipient, dsn_diagnostic,
            correlation_method, lead_id, draft_id,
            read_at, state, received_at, sent_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                 ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        input.threadId,
        input.mailbox,
        input.direction,
        input.dedupeKey,
        // Never coalesced to null: '' is what a DSN's envelope sender IS.
        String(input.envelopeFrom ?? ''),
        String(input.envelopeTo ?? ''),
        input.messageId ?? null,
        input.inReplyTo ?? null,
        input.references ? bounded(input.references, 4_000) : null,
        String(input.fromAddress ?? '').toLowerCase(),
        input.fromName ? bounded(input.fromName, 200) : null,
        input.replyTo ?? null,
        JSON.stringify((input.toAddresses ?? []).slice(0, LIMITS.maxRecipients)),
        JSON.stringify((input.ccAddresses ?? []).slice(0, LIMITS.maxRecipients)),
        bounded(input.subject ?? '', LIMITS.maxSubjectChars),
        bounded(body, LIMITS.maxBodyChars),
        input.bodyHtml ? bounded(input.bodyHtml, LIMITS.maxHtmlChars) : null,
        toInt(truncated),
        toInt(input.strippedRemoteContent),
        input.rawKey ?? null,
        Number(input.rawSize ?? 0),
        input.parseStatus ?? 'ok',
        input.parseError ? bounded(input.parseError, 1_000) : null,
        input.auth?.spf ?? null,
        input.auth?.dkim ?? null,
        input.auth?.dmarc ?? null,
        toInt(input.isDsn),
        input.dsn?.action ?? null,
        input.dsn?.status ?? null,
        input.dsn?.recipient ?? null,
        input.dsn?.diagnostic ? bounded(input.dsn.diagnostic, 1_000) : null,
        input.correlationMethod ?? null,
        input.leadId ?? null,
        input.draftId ?? null,
        // Outbound messages are never unread — nobody needs to be told about
        // what they themselves sent.
        input.direction === 'outbound' ? now : null,
        'inbox',
        input.receivedAt ?? null,
        input.sentAt ?? null,
        now,
      ),
    ...threadRollupStatements(db, {
      threadId: input.threadId,
      direction: input.direction,
      messageAt,
      unread: input.direction === 'inbound',
      subject: input.subject,
      correspondent: input.correspondent ?? input.fromAddress,
    }),
  ]

  try {
    await db.batch(statements)
  } catch (error) {
    // Two concurrent deliveries of the same message. The loser reads the
    // winner's row instead of failing the ingest.
    if (!isUniqueViolation(error)) throw error
    const raced = await findByDedupeKey(db, input.dedupeKey)
    if (raced) return { message: raced, created: false }
    throw error
  }

  return { message: await getMessage(db, id), created: true }
}

/**
 * @param {D1Database} db
 * @param {string} threadId
 * @returns {Promise<any[]>}
 */
export async function listMessagesForThread(db, threadId) {
  const result = await db
    .prepare("SELECT * FROM mailbox_messages WHERE thread_id = ? AND state != 'trash' ORDER BY created_at ASC")
    .bind(threadId)
    .all()
  return (result.results || []).map(mapMessage)
}

/** @param {D1Database} db */
export async function markThreadMessagesRead(db, threadId, read = true) {
  await db
    .prepare(
      `UPDATE mailbox_messages SET read_at = ?
       WHERE thread_id = ? AND direction = 'inbound' AND ${read ? 'read_at IS NULL' : 'read_at IS NOT NULL'}`,
    )
    .bind(read ? nowIso() : null, threadId)
    .run()
}

/** @param {D1Database} db */
export async function setMessagesState(db, threadId, state) {
  await db
    .prepare('UPDATE mailbox_messages SET state = ? WHERE thread_id = ?')
    .bind(state, threadId)
    .run()
}

/**
 * Attributes a message to a lead and draft after the fact.
 *
 * Separate from the insert because correlation can succeed later — a bounce may
 * arrive before the outbound row that explains it, and a thread may be linked
 * to a lead by hand.
 *
 * @param {D1Database} db
 */
export async function attachCorrelation(db, id, { leadId = null, draftId = null, method = null }) {
  await db
    .prepare(
      `UPDATE mailbox_messages
       SET lead_id = COALESCE(?, lead_id),
           draft_id = COALESCE(?, draft_id),
           correlation_method = COALESCE(?, correlation_method)
       WHERE id = ?`,
    )
    .bind(leadId, draftId, method, id)
    .run()
}

/**
 * Messages that could not be fully parsed.
 *
 * An operational queue rather than an archive: every row here is a message a
 * person may need to open in its raw form, and a list that grows is a signal
 * that the parser is meeting something it does not handle.
 *
 * @param {D1Database} db
 * @param {{ limit?: number }} [options]
 * @returns {Promise<any[]>}
 */
export async function listUnparsed(db, { limit = 50 } = {}) {
  const result = await db
    .prepare("SELECT * FROM mailbox_messages WHERE parse_status != 'ok' ORDER BY created_at DESC LIMIT ?")
    .bind(clampLimit(limit, 50, 200))
    .all()
  return (result.results || []).map(mapMessage)
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

function mapAttachment(row) {
  if (!row) return null
  return {
    id: row.id,
    messageId: row.message_id,
    filename: row.filename,
    originalFilename: row.original_filename,
    contentType: row.content_type,
    size: Number(row.size ?? 0),
    contentId: row.content_id,
    disposition: row.disposition,
    r2Key: row.r2_key,
    skippedReason: row.skipped_reason,
    createdAt: row.created_at,
  }
}

/** @param {D1Database} db */
export async function insertAttachment(db, input) {
  const id = input.id ?? newId()
  await db
    .prepare(
      `INSERT INTO mailbox_attachments
         (id, message_id, filename, original_filename, content_type, size,
          content_id, disposition, r2_key, skipped_reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.messageId,
      bounded(input.filename, 200),
      input.originalFilename ? bounded(input.originalFilename, 400) : null,
      input.contentType ?? 'application/octet-stream',
      Number(input.size ?? 0),
      input.contentId ?? null,
      input.disposition ?? 'attachment',
      input.r2Key,
      input.skippedReason ?? null,
      nowIso(),
    )
    .run()

  return id
}

/**
 * @param {D1Database} db
 * @param {string} messageId
 * @returns {Promise<any[]>}
 */
export async function listAttachments(db, messageId) {
  const result = await db
    .prepare('SELECT * FROM mailbox_attachments WHERE message_id = ? ORDER BY created_at ASC')
    .bind(messageId)
    .all()
  return (result.results || []).map(mapAttachment)
}

/**
 * @param {D1Database} db
 * @param {string} id
 * @returns {Promise<any|null>}
 */
export async function getAttachment(db, id) {
  return mapAttachment(await db.prepare('SELECT * FROM mailbox_attachments WHERE id = ?').bind(id).first())
}

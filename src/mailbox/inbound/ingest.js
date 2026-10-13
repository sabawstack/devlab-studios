/**
 * The inbound pipeline: an SMTP delivery becomes a row a person can read.
 *
 * THE ONE RULE THIS IS BUILT AROUND: a message that arrives is never silently
 * discarded. Not when it is too large to parse, not when its MIME is malformed,
 * not when R2 is unavailable, not when it is from nobody we recognise. Every
 * one of those produces a stored row that says what happened. This codebase has
 * already lost rows three times to a CHECK constraint behind `INSERT OR IGNORE`
 * (see migrations/0014_mailbox.sql); silent loss at the ingest layer would be
 * the same failure wearing a different hat, and it would be losing other
 * people's mail rather than a usage counter.
 *
 * ORDER OF OPERATIONS, AND WHY IT IS THIS ORDER:
 *
 *   1. Read the bytes.               — bounded; the stream is always drained.
 *   2. Parse.                        — never throws; a failure is a status.
 *   3. Compute the dedupe key.       — works whether or not parsing succeeded.
 *   4. Bail if already stored.       — before any write, so a redelivery is cheap.
 *   5. Put the original in R2.       — before the D1 row, so a row always has
 *                                      either an object or an explicit reason.
 *   6. Thread it, store it.
 *   7. Correlate, bridge, bounce.    — none of which may fail the ingest.
 *
 * Step 7 runs inside its own try/catch on purpose. The message is already
 * safely stored by then, and a CRM lookup that fails must not cost us the mail.
 */

import { LIMITS, attachmentObjectKey, rawObjectKey } from '../config.js'
import { MAILBOX, mailboxForRecipient } from '../domain/mailboxes.js'
import { extractDsn, isDeliveryStatusNotification } from '../domain/dsn.js'
import { candidateParentIds } from '../domain/threading.js'
import { createLogger } from '../../lead-engine/services/log.js'
import { newId } from '../repositories/helpers.js'
import {
  attachThreadToLead,
  createThread,
  findThreadByMessageIds,
  findThreadBySubject,
} from '../repositories/threads.js'
import { attachCorrelation, findByDedupeKey, insertAttachment, insertMessage } from '../repositories/messages.js'
import { buildDedupeKey, parseAuthenticationResults, parseMessage, readStream } from './parse.js'
import { sanitizeEmailHtml } from './sanitizeHtml.js'
import { safeContentType, sanitizeFilename } from './filenames.js'
import { correlateBounce, correlateInbound } from '../services/correlate.js'
import { bridgeToLeadConversation, applyBounceToCrm } from '../services/bridge.js'

/** Slightly above Cloudflare's own 25 MiB inbound ceiling, so `truncated` means their limit moved. */
const READ_CEILING_BYTES = 26 * 1024 * 1024

/**
 * @param {Env} env
 * @param {{ from: string, to: string, raw: ReadableStream, rawSize: number, headers: Headers }} message
 * @param {{ now?: Date, correlationId?: string }} [options]
 */
export async function ingestEmail(env, message, options = {}) {
  const db = env.DB
  const bucket = env.MAILBOX_BUCKET
  const now = options.now instanceof Date ? options.now : new Date()
  const logger = createLogger({ correlationId: options.correlationId })

  const envelopeFrom = String(message.from ?? '')
  const envelopeTo = String(message.to ?? '')
  const mailbox = mailboxForRecipient(envelopeTo)

  // 1. Bytes.
  const { bytes, truncated, totalSize } = await readStream(message.raw, READ_CEILING_BYTES)

  // 2. Parse. Never throws.
  const tooLarge = truncated || bytes.byteLength > LIMITS.parseMaxBytes
  const parseResult = await parseMessage(bytes, { tooLarge })
  const fields = parseResult.fields

  // 3 & 4. Idempotency, before any write.
  const dedupeKey = await buildDedupeKey({ mailbox, messageId: fields.messageId, bytes })
  const already = await findByDedupeKey(db, dedupeKey)
  if (already) {
    // One repair on a redelivery: if the first attempt could not reach R2, this
    // one can still supply the original rather than leaving the row permanently
    // pointing at nothing.
    if (!already.rawKey && bucket) {
      const repaired = await storeRaw(bucket, already.id, bytes, now, logger)
      if (repaired) {
        await db
          .prepare("UPDATE mailbox_messages SET raw_key = ?, raw_size = ?, parse_status = CASE WHEN parse_status = 'raw_unavailable' THEN 'ok' ELSE parse_status END WHERE id = ?")
          .bind(repaired, totalSize, already.id)
          .run()
      }
    }

    logger.log('mailbox.ingest', { result: 'duplicate', mailbox, message_row: already.id })
    return { status: 'duplicate', messageId: already.id, threadId: already.threadId }
  }

  // Per-sender daily cap. THE ONE DELIBERATE EXCEPTION to "never silently
  // discarded": not silent (it is logged with its reason), and bounded to a
  // sender who has already delivered more in a day than any correspondent
  // plausibly writes. Without it one address can fill D1 and R2 at will.
  const senderKey = String(fields.fromAddress || envelopeFrom || '').toLowerCase()
  if (senderKey && (await inboundCountSince(db, senderKey, now)) >= LIMITS.maxInboundPerSenderPerDay) {
    logger.log('mailbox.ingest', {
      result: 'dropped',
      reason: 'sender_daily_cap',
      mailbox,
      cap: LIMITS.maxInboundPerSenderPerDay,
      size: totalSize,
    })
    return { status: 'dropped', reason: 'sender_daily_cap' }
  }

  // The row id is generated here so the R2 key can be built from it, and so a
  // key is never derived from anything that came out of the message.
  const rowId = newId()

  // 5. Original bytes first.
  let rawKey = null
  let parseStatus = parseResult.status
  if (bucket) {
    rawKey = await storeRaw(bucket, rowId, bytes, now, logger)
  }
  if (!rawKey) {
    // Recorded, not thrown. Losing the attachment to a storage outage is bad;
    // losing the knowledge that a message arrived at all is worse.
    parseStatus = parseStatus === 'ok' ? 'raw_unavailable' : parseStatus
    logger.log('mailbox.raw_store_failed', { mailbox, message_row: rowId, size: totalSize })
  }

  // DSN classification happens before threading, because a bounce belongs in
  // the bounce mailbox even when it was addressed somewhere else.
  const isDsn = isDeliveryStatusNotification({
    envelopeFrom,
    contentType: fields.contentType,
    fromAddress: fields.fromAddress,
  })
  const dsn = isDsn && parseResult.parsed ? extractDsn(parseResult.parsed) : null
  const effectiveMailbox = isDsn && mailbox === MAILBOX.OTHER ? MAILBOX.BOUNCE : mailbox

  const html = fields.bodyHtml ? sanitizeEmailHtml(fields.bodyHtml) : null

  // The other party. For a DSN that is the reporting daemon, which is not
  // useful as a thread label — the failed recipient is.
  const correspondent = isDsn ? dsn?.primary?.recipient || fields.fromAddress : fields.fromAddress

  // Read once, used twice: whether the heuristics that trust the From address
  // (subject threading, address correlation) may run at all. A spoofed From
  // with a copied subject would otherwise join a lead's conversation and make
  // its Reply-To the next reply's recipient.
  const auth = parseAuthenticationResults(message.headers)
  const senderVerified = auth.dmarc === 'pass'

  // 6. Thread, then store.
  const thread = await resolveThread(db, {
    senderVerified,
    mailbox: effectiveMailbox,
    correspondent,
    correspondentName: fields.fromName,
    subject: fields.subject,
    inReplyTo: fields.inReplyTo,
    referenceIds: fields.referenceIds,
    now,
  })

  const stored = await insertMessage(db, {
    id: rowId,
    threadId: thread.id,
    mailbox: effectiveMailbox,
    direction: 'inbound',
    dedupeKey,
    envelopeFrom,
    envelopeTo,
    correspondent,
    messageId: fields.messageId,
    inReplyTo: fields.inReplyTo,
    references: fields.references,
    fromAddress: fields.fromAddress,
    fromName: fields.fromName,
    replyTo: fields.replyTo,
    toAddresses: fields.toAddresses,
    ccAddresses: fields.ccAddresses,
    subject: fields.subject,
    bodyText: fields.bodyText,
    bodyHtml: html?.html ?? null,
    bodyTruncated: Boolean(html?.truncated),
    strippedRemoteContent: Boolean(html?.strippedRemoteContent),
    rawKey,
    rawSize: totalSize,
    parseStatus,
    parseError: parseResult.error,
    auth,
    isDsn,
    dsn: dsn?.primary
      ? {
          action: dsn.primary.action,
          status: dsn.primary.status,
          recipient: dsn.primary.recipient,
          diagnostic: dsn.primary.diagnostic,
        }
      : null,
    receivedAt: now.toISOString(),
  })

  if (!stored.created) {
    logger.log('mailbox.ingest', { result: 'duplicate_race', mailbox: effectiveMailbox })
    return { status: 'duplicate', messageId: stored.message.id, threadId: thread.id }
  }

  if (bucket && parseResult.parsed) {
    await storeAttachments(db, bucket, rowId, parseResult.parsed.attachments ?? [], now, logger)
  }

  // 7. Everything CRM-facing, contained.
  let correlation = { leadId: null, draftId: null, method: null }
  try {
    correlation = isDsn
      ? await correlateBounce(db, {
          envelopeTo,
          originalMessageId: dsn?.originalMessageId ?? null,
          failedRecipient: dsn?.primary?.recipient ?? null,
        })
      : await correlateInbound(db, {
          fromAddress: fields.fromAddress,
          senderVerified,
          inReplyTo: fields.inReplyTo,
          referenceIds: fields.referenceIds,
        })

    if (correlation.leadId || correlation.draftId) {
      await attachCorrelation(db, rowId, {
        leadId: correlation.leadId,
        draftId: correlation.draftId,
        method: correlation.method,
      })
      if (correlation.leadId) await attachThreadToLead(db, thread.id, correlation.leadId)
    }

    if (isDsn) {
      await applyBounceToCrm(env, {
        draftId: correlation.draftId,
        kind: dsn?.kind ?? 'soft',
        diagnostic: dsn?.primary?.diagnostic ?? null,
        // How we matched it decides whether it may suppress. A DSN cannot be
        // authenticated, so only an identifier WE issued is trustworthy — see
        // services/bridge.js.
        method: correlation.method,
        correlationId: logger.correlationId,
      })
    } else if (correlation.leadId) {
      await bridgeToLeadConversation(db, {
        leadId: correlation.leadId,
        message: { ...stored.message, ...fields },
        correlationId: logger.correlationId,
      })
    }
  } catch (error) {
    // The mail is stored. A CRM failure is an operational problem to see in the
    // logs, not a reason to fail a delivery and have the sender retry.
    logger.log('mailbox.correlation_failed', {
      message_row: rowId,
      is_dsn: isDsn,
      error: error instanceof Error ? error.message : 'unknown',
    })
  }

  logger.log('mailbox.ingest', {
    result: 'stored',
    mailbox: effectiveMailbox,
    message_row: rowId,
    thread_id: thread.id,
    is_dsn: isDsn,
    parse_status: parseStatus,
    size: totalSize,
    correlation: correlation.method,
    // Deliberately no addresses, subject or body: this is an operational log,
    // and the mailbox itself is where message content belongs.
  })

  return { status: 'stored', messageId: rowId, threadId: thread.id, isDsn, parseStatus }
}

/**
 * @param {R2Bucket} bucket
 * @returns {Promise<string|null>} the key, or null if it could not be written
 */
async function storeRaw(bucket, rowId, bytes, now, logger) {
  const key = rawObjectKey(rowId, now)
  try {
    await bucket.put(key, bytes, {
      httpMetadata: { contentType: 'message/rfc822' },
      customMetadata: { storedAt: now.toISOString() },
    })
    return key
  } catch (error) {
    logger.log('mailbox.r2_put_failed', {
      key,
      error: error instanceof Error ? error.message : 'unknown',
    })
    return null
  }
}

/**
 * Stores attachments, recording the ones it refuses.
 *
 * A part over the ceiling still gets a row with `skipped_reason`, so the UI can
 * say "a 40 MB file was not stored" rather than showing a message that silently
 * lost half its content.
 */
async function storeAttachments(db, bucket, messageRowId, attachments, now, logger) {
  let index = 0

  for (const part of attachments) {
    if (index >= LIMITS.maxAttachments) {
      await insertAttachment(db, {
        messageId: messageRowId,
        filename: 'more-attachments',
        contentType: 'application/octet-stream',
        size: 0,
        r2Key: '',
        skippedReason: `This message had more than ${LIMITS.maxAttachments} parts; the rest were not stored.`,
      })
      break
    }

    // The DSN machinery parts are not attachments a person wants to download —
    // they are the report itself, already parsed into columns.
    const type = String(part?.mimeType ?? '').toLowerCase()
    if (type === 'message/delivery-status' || type === 'text/rfc822-headers') {
      index += 1
      continue
    }

    const content = part?.content
    const size =
      content instanceof ArrayBuffer
        ? content.byteLength
        : content instanceof Uint8Array
          ? content.byteLength
          : new TextEncoder().encode(String(content ?? '')).byteLength

    const filename = sanitizeFilename(part?.filename, { fallback: `attachment-${index + 1}` })
    const key = attachmentObjectKey(messageRowId, index, now)

    if (size > LIMITS.attachmentMaxBytes) {
      await insertAttachment(db, {
        messageId: messageRowId,
        filename,
        originalFilename: part?.filename ?? null,
        contentType: safeContentType(part?.mimeType),
        size,
        contentId: part?.contentId ?? null,
        disposition: part?.disposition ?? 'attachment',
        r2Key: '',
        skippedReason: `Larger than the ${Math.round(LIMITS.attachmentMaxBytes / (1024 * 1024))} MB limit; not stored.`,
      })
      index += 1
      continue
    }

    try {
      await bucket.put(key, content, {
        // The type is stored for reference; what a download is SERVED with is
        // decided by the allowlist in filenames.js at request time, never by
        // this value. An emailed `text/html` part served as its own type would
        // run script in the admin origin.
        httpMetadata: { contentType: safeContentType(part?.mimeType) },
      })

      await insertAttachment(db, {
        messageId: messageRowId,
        filename,
        originalFilename: part?.filename ?? null,
        contentType: safeContentType(part?.mimeType),
        size,
        contentId: part?.contentId ?? null,
        disposition: part?.disposition ?? 'attachment',
        r2Key: key,
      })
    } catch (error) {
      logger.log('mailbox.attachment_store_failed', {
        message_row: messageRowId,
        index,
        error: error instanceof Error ? error.message : 'unknown',
      })
      await insertAttachment(db, {
        messageId: messageRowId,
        filename,
        originalFilename: part?.filename ?? null,
        contentType: safeContentType(part?.mimeType),
        size,
        r2Key: '',
        skippedReason: 'Storage was unavailable when this message arrived.',
      })
    }

    index += 1
  }
}

/**
 * Finds the thread this message belongs to, or starts one.
 *
 * Identifiers first, the fenced subject heuristic second (verified senders
 * only), a new thread last.
 * See domain/threading.js for why that order and why subject never decides
 * alone.
 */
async function resolveThread(db, input) {
  const byIdentifier = await findThreadByMessageIds(
    db,
    candidateParentIds({ inReplyTo: input.inReplyTo, references: input.referenceIds }),
  )
  if (byIdentifier) return byIdentifier

  // The subject heuristic matches on the From address, which only means
  // something when DMARC vouched for it. Unverified mail starts its own thread.
  const bySubject = !input.senderVerified ? null : await findThreadBySubject(
    db,
    { mailbox: input.mailbox, correspondent: input.correspondent, subject: input.subject },
    input.now,
  )
  if (bySubject) return bySubject

  return createThread(db, {
    mailbox: input.mailbox,
    subject: input.subject,
    correspondent: input.correspondent,
    correspondentName: input.correspondentName,
  })
}

/**
 * Inbound messages stored from one sender in the 24 hours before `now`.
 * Served by idx_mailbox_messages_from.
 *
 * @param {D1Database} db
 * @param {string} sender lowercased From (or envelope sender when From is empty)
 * @param {Date} now
 */
async function inboundCountSince(db, sender, now) {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM mailbox_messages
       WHERE direction = 'inbound' AND received_at >= ?
         AND (from_address = ? OR (from_address = '' AND envelope_from = ?))`,
    )
    .bind(since, sender, sender)
    .first()
  return Number(row?.n ?? 0)
}

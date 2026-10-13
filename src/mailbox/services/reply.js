/**
 * Composing a reply in the CMS and queueing it for transmission.
 *
 * The boundary, restated because it is the thing most likely to erode: this
 * application decides what may be sent and records what was; n8n submitting to
 * the private Postfix instance puts it on the wire. Nothing here opens a
 * socket. The Email Worker is not an alternative — Cloudflare's `reply()` may
 * only answer the message currently being handled, once per event, and only
 * when that message passed DMARC, so it cannot serve a reply composed later by
 * a person.
 */

import { PRIMARY_ADDRESS } from '../config.js'
import { MAILBOX, verpAddress } from '../domain/mailboxes.js'
import { KIND_OUTBOUND, buildMessageId, buildReferenceChain, parseReferences } from '../domain/messageId.js'
import { buildOutboundMessage, replySubject } from '../outbound/buildMessage.js'
import { newId, operationError } from '../repositories/helpers.js'
import { getMessage, listMessagesForThread } from '../repositories/messages.js'
import { promoteDraft, queueOutbound } from '../repositories/outbound.js'
import { claimOutboundAttachments, listOutboundAttachments } from '../repositories/outboundAttachments.js'
import { createThread, getThread } from '../repositories/threads.js'
import { checkSuppression } from '../../lead-engine/repositories/suppression.js'
import { emailDomain, normalizeEmail, strictRecipient } from '../../lead-engine/domain/domains.js'
import { createLogger } from '../../lead-engine/services/log.js'

/**
 * Who a reply to `parent` would go to, and whether a person must confirm it.
 *
 * Reply-To wins over From when the sender set one — that is what it is for,
 * and ignoring it sends the answer somewhere nobody reads. But Reply-To is
 * also the cheapest hijack there is: a forged From that threads onto a lead's
 * conversation, plus a Reply-To pointing elsewhere, and the next reply quietly
 * goes to the forger. So the resolved address is always shown in the composer,
 * and it needs an explicit confirmation when
 *
 *   - Reply-To's domain differs from From's domain, or
 *   - the parent message is unverified (anything but DMARC pass from the edge).
 *
 * Pure: the thread GET uses it to show the composer what the server will do,
 * and `composeReply` uses it to enforce the same answer.
 *
 * @param {object|null} parent the inbound message being answered, if any
 * @param {object} thread
 * @returns {{ address: string|null, source: 'reply_to'|'from'|'thread'|null,
 *             fromAddress: string|null, replyTo: string|null,
 *             warnings: string[], requiresConfirmation: boolean }}
 */
export function resolveReplyRecipient(parent, thread) {
  const fromAddress = normalizeEmail(parent?.fromAddress) ?? null
  const replyTo = normalizeEmail(parent?.replyTo) ?? null

  let address = null
  let source = null
  if (replyTo) {
    address = strictRecipient(replyTo)
    source = 'reply_to'
  } else if (fromAddress) {
    address = strictRecipient(fromAddress)
    source = 'from'
  } else if (thread?.correspondent) {
    address = strictRecipient(thread.correspondent)
    source = 'thread'
  }

  const warnings = []
  if (replyTo && fromAddress && emailDomain(replyTo) !== emailDomain(fromAddress)) {
    warnings.push(
      `The message asks for replies to ${replyTo}, a different domain from the sender ${fromAddress}.`,
    )
  }
  if (parent && parent.direction === 'inbound' && parent.auth?.dmarc !== 'pass') {
    warnings.push(
      'The sender of this message is unverified (DMARC did not pass), so its From and Reply-To may be forged.',
    )
  }

  return { address, source, fromAddress, replyTo, warnings, requiresConfirmation: warnings.length > 0 }
}

/**
 * Queues a reply.
 *
 * SUPPRESSION IS RE-CHECKED HERE, at the moment of composing, exactly as the
 * lead engine's outbox re-checks it at the moment of collection. Someone may
 * have unsubscribed between receiving their message and this reply being
 * written, and the whole point of keeping the gates on this side of the
 * boundary is that they run when it matters rather than when it was convenient.
 *
 * @param {Env} env
 * `asDraft` saves it without handing it over, which is what the Drafts folder
 * writes. Suppression is still checked at THIS point rather than at send time:
 * refusing early tells the operator before they spend effort writing, and the
 * check runs again nowhere else because a draft is promoted, not re-composed.
 *
 * `confirmRecipient` is the address the operator was shown and confirmed. It
 * is required, and must equal the address resolved now, whenever
 * `resolveReplyRecipient` says confirmation is needed — so a message that
 * arrived between viewing and sending cannot swap the recipient underneath
 * the confirmation. An explicit `toAddress` is the operator's own choice and
 * needs no confirmation.
 *
 * @param {{ threadId: string, inReplyToMessageId?: string|null, bodyText: string,
 *           subject?: string|null, toAddress?: string|null, actorEmail?: string|null,
 *           confirmRecipient?: string|null,
 *           asDraft?: boolean, attachmentIds?: string[], correlationId?: string }} input
 */
export async function composeReply(env, input) {
  const db = env.DB
  const logger = createLogger({ correlationId: input.correlationId })

  const thread = await getThread(db, input.threadId)
  if (!thread) throw operationError('Thread not found.', 404)

  // The message being answered: the one named, or the most recent inbound one.
  let parent = null
  if (input.inReplyToMessageId) {
    parent = await getMessage(db, input.inReplyToMessageId)
    if (!parent || parent.threadId !== thread.id) {
      throw operationError('That message is not part of this thread.', 400)
    }
  } else {
    const messages = await listMessagesForThread(db, thread.id)
    parent = [...messages].reverse().find((message) => message.direction === 'inbound') ?? null
  }

  // See resolveReplyRecipient for why Reply-To wins and when it must be
  // confirmed. An explicit override is validated just as strictly.
  let recipient
  if (input.toAddress) {
    recipient = strictRecipient(input.toAddress)
    if (!recipient) throw operationError('That recipient is not a single valid address.', 422)
  } else {
    const resolved = resolveReplyRecipient(parent, thread)
    recipient = resolved.address
    if (!recipient) throw operationError('This thread has no address to reply to.', 400)
    if (resolved.requiresConfirmation && strictRecipient(input.confirmRecipient) !== recipient) {
      throw operationError(
        `Confirm the recipient before replying: this reply would go to ${recipient}. ${resolved.warnings.join(' ')}`,
        409,
      )
    }
  }

  const body = String(input.bodyText ?? '').trim()
  // A draft may be empty — that is what a draft is. A reply being sent may not.
  if (!body && !input.asDraft) throw operationError('A reply needs a body.', 422)

  // `checkSuppression` covers the address AND its domain in one query, and
  // returns the matching entry so the refusal can say which rule applied.
  const suppression = await checkSuppression(db, recipient)
  if (suppression.suppressed) {
    throw operationError(
      `That address is suppressed${suppression.entry?.reason ? ` (${suppression.entry.reason})` : ''}. ` +
        'Remove it on the Suppression screen first if this is deliberate.',
      409,
    )
  }

  // Generated before the insert so the Message-ID can carry it — the id is what
  // a DSN echoes back, and it is how a bounce on this reply finds its way home.
  const outboundId = newId()
  const messageId = buildMessageId({ kind: KIND_OUTBOUND, id: outboundId })
  const references = buildReferenceChain({
    parentReferences: parent?.references ?? null,
    parentMessageId: parent?.messageId ?? null,
  })

  const drafted = await queueOutbound(db, {
    id: outboundId,
    threadId: thread.id,
    inReplyToMessageId: parent?.id ?? null,
    mailbox: thread.mailbox,
    toAddress: recipient,
    toName: parent?.fromName ?? thread.correspondentName ?? null,
    subject: input.subject ? String(input.subject) : replySubject(parent?.subject ?? thread.subject),
    bodyText: body,
    messageId,
    inReplyTo: parent?.messageId ?? null,
    references: references.length > 0 ? references.map((id) => `<${id}>`).join(' ') : null,
    envelopeFrom: verpAddress(KIND_OUTBOUND, outboundId),
    // ALWAYS inserted as a draft, even when sending: the transmitter can only
    // collect `queued` rows, so the reply is invisible to it until its
    // attachments are claimed. Queueing first left a window where a poll
    // could collect the message without its files (and a claim failure left
    // it queued without them for good).
    status: 'draft',
    leadId: thread.leadId ?? null,
    createdBy: input.actorEmail ?? null,
  })

  // Claimed AFTER the row exists, because an upload is bound to a message and
  // the message did not exist a moment ago. A failure here throws, and the
  // half-made draft is discarded (its uploads released) so a retry neither
  // sends a message without the files the operator attached nor duplicates
  // the draft.
  const attachments = await claimOrDiscard(db, input.attachmentIds ?? [], outboundId, logger)

  // Only now may the transmitter see it.
  const queued = input.asDraft ? drafted : await promoteDraft(db, outboundId)

  logger.log(input.asDraft ? 'mailbox.reply_drafted' : 'mailbox.reply_queued', {
    outbound_id: outboundId,
    attachments: attachments.length,
    thread_id: thread.id,
    lead_id: thread.leadId ?? null,
    in_reply_to: Boolean(parent),
  })

  return queued
}

/**
 * Starts a NEW conversation — the Compose button.
 *
 * Every other path in this file answers something that already arrived, so it
 * has a thread to attach to. Compose does not, and inventing one lazily at send
 * time would leave the message unattached in the UI until the recipient
 * replied. So a thread is created up front, which also means a reply from them
 * threads onto it by the ordinary rules.
 *
 * SAME GATES AS A REPLY, deliberately: suppression is checked here, the VERP
 * return path and Message-ID are generated here, and nothing is transmitted by
 * this application. A new message is not a lesser act than a reply — if
 * anything it is riskier, because nobody wrote to us first.
 *
 * @param {Env} env
 * @param {{ toAddress: string, subject?: string|null, bodyText: string,
 *           asDraft?: boolean, actorEmail?: string|null, attachmentIds?: string[],
 *           correlationId?: string }} input
 */
export async function composeNew(env, input) {
  const db = env.DB
  const logger = createLogger({ correlationId: input.correlationId })

  const recipient = strictRecipient(input.toAddress)
  if (!recipient) throw operationError('A valid recipient address is required.', 422)

  const body = String(input.bodyText ?? '').trim()
  if (!body && !input.asDraft) throw operationError('A message needs a body.', 422)

  const suppression = await checkSuppression(db, recipient)
  if (suppression.suppressed) {
    throw operationError(
      `That address is suppressed${suppression.entry?.reason ? ` (${suppression.entry.reason})` : ''}. ` +
        'Remove it on the Suppression screen first if this is deliberate.',
      409,
    )
  }

  const subject = String(input.subject ?? '').trim()
  const thread = await createThread(db, {
    mailbox: MAILBOX.HELLO,
    subject,
    correspondent: recipient,
  })

  const outboundId = newId()

  const drafted = await queueOutbound(db, {
    id: outboundId,
    threadId: thread.id,
    inReplyToMessageId: null,
    mailbox: MAILBOX.HELLO,
    toAddress: recipient,
    toName: null,
    subject,
    bodyText: body,
    messageId: buildMessageId({ kind: KIND_OUTBOUND, id: outboundId }),
    // No In-Reply-To or References: this starts a thread rather than joining
    // one, and inventing either would make the recipient's client file it under
    // a conversation that does not exist.
    inReplyTo: null,
    references: null,
    envelopeFrom: verpAddress(KIND_OUTBOUND, outboundId),
    // ALWAYS inserted as a draft, even when sending: the transmitter can only
    // collect `queued` rows, so the reply is invisible to it until its
    // attachments are claimed. Queueing first left a window where a poll
    // could collect the message without its files (and a claim failure left
    // it queued without them for good).
    status: 'draft',
    leadId: null,
    createdBy: input.actorEmail ?? null,
  })

  const attachments = await claimOrDiscard(db, input.attachmentIds ?? [], outboundId, logger)

  const queued = input.asDraft ? drafted : await promoteDraft(db, outboundId)

  logger.log(input.asDraft ? 'mailbox.compose_drafted' : 'mailbox.compose_queued', {
    outbound_id: outboundId,
    attachments: attachments.length,
    thread_id: thread.id,
  })

  return { outbound: queued, threadId: thread.id }
}

/**
 * Binds uploads to a just-inserted draft, or undoes the draft.
 *
 * D1 offers no interactive transaction, so this is the closest to atomic the
 * insert-claim-promote sequence gets: on any claim failure the uploads this
 * draft already took are released and the draft row is deleted, then the
 * original error is rethrown for the operator.
 *
 * @param {D1Database} db
 * @param {string[]} ids
 * @param {string} outboundId
 * @param {{ log: (event: string, fields: object) => void }} logger
 */
async function claimOrDiscard(db, ids, outboundId, logger) {
  try {
    return await claimOutboundAttachments(db, { ids, outboundId })
  } catch (error) {
    try {
      await db.batch([
        db
          .prepare('UPDATE mailbox_outbound_attachments SET outbound_id = NULL, position = 0 WHERE outbound_id = ?')
          .bind(outboundId),
        db.prepare("DELETE FROM mailbox_outbound WHERE id = ? AND status = 'draft'").bind(outboundId),
      ])
    } catch (cleanupError) {
      logger.log('mailbox.claim_rollback_failed', {
        outbound_id: outboundId,
        error: cleanupError instanceof Error ? cleanupError.message : 'unknown',
      })
    }
    throw error
  }
}

/**
 * Renders a queued reply into the finished message plus its envelope.
 *
 * Returned as two separate things on purpose. The envelope is not derivable
 * from the message — that is the entire point of VERP — and a transmitter that
 * infers `MAIL FROM` from the `From:` header (which is what nodemailer does by
 * default, and what n8n's mail node forces) produces a message whose bounces
 * come back to `hello@` with no identifier attached.
 *
 * @param {Env} env
 * @param {object} outbound a `mailbox_outbound` row
 * @param {{ date?: Date }} [options]
 */
export async function renderOutbound(env, outbound, options = {}) {
  const attachments = await listOutboundAttachments(env.DB, outbound.id)

  // Bytes are fetched here rather than stored in D1, and a missing object is
  // FATAL rather than skipped. Sending a message whose attachment silently
  // vanished is the failure this whole path is arranged to prevent: the
  // operator believes the recipient has the file, and nothing in the delivered
  // message says otherwise.
  const parts = []
  for (const attachment of attachments) {
    const object = await env.MAILBOX_BUCKET?.get(attachment.r2Key)
    if (!object) {
      throw operationError(
        `The file "${attachment.filename}" is no longer in storage, so this message was not sent.`,
        410,
      )
    }
    parts.push({
      filename: attachment.filename,
      contentType: attachment.contentType,
      bytes: new Uint8Array(await object.arrayBuffer()),
    })
  }

  const raw = buildOutboundMessage({
    to: { email: outbound.toAddress, name: outbound.toName },
    from: { email: PRIMARY_ADDRESS, name: 'DevLab Studios' },
    subject: outbound.subject,
    bodyText: outbound.bodyText,
    messageId: outbound.messageId,
    inReplyTo: outbound.inReplyTo,
    references: parseReferences(outbound.references),
    attachments: parts,
    // NOW, not `createdAt`. The Date header states when the message was handed
    // to a mail server, and this function runs at exactly that moment. Taking
    // it from the row's creation time was usually harmless -- a reply is
    // normally collected within minutes -- but a reply that sat in the queue,
    // or was retried after a fault, went out claiming a Date hours in the past.
    // The first real send did exactly that: created 13:05 on the 21st,
    // transmitted 05:16 on the 22nd, and arrived stamped 16 hours stale, which
    // spam filters read as a forged or replayed message.
    date: options.date instanceof Date ? options.date : new Date(),
  })

  return {
    id: outbound.id,
    envelope: {
      // What the transmitter must issue as MAIL FROM.
      from: outbound.envelopeFrom,
      to: [outbound.toAddress],
    },
    raw,
    attachments: attachments.map((attachment) => ({
      filename: attachment.filename,
      contentType: attachment.contentType,
      size: attachment.size,
    })),
    // Repeated as plain fields so a transmitter that genuinely cannot take a
    // raw message can still send something -- degraded (no threading headers,
    // no VERP), but not broken. The `raw` field is the supported path.
    //
    // WITHHELD ENTIRELY once there are attachments, because this shape cannot
    // express them. A transmitter falling back here would send the covering
    // note and quietly drop the files, which is worse than not sending: the
    // recipient gets a message referring to a document that is not there, and
    // the operator has no way to know. No fallback forces the real path.
    fallback:
      attachments.length > 0
        ? null
        : {
            from: PRIMARY_ADDRESS,
            to: outbound.toAddress,
            subject: outbound.subject,
            text: outbound.bodyText,
          },
  }
}

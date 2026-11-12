/**
 * Conversations and messages.
 *
 * Messages are INSERT-only. Nothing in the application updates a body, because
 * the conversation view is a record of what was actually said — an editable
 * history would make it useless as the thing you check before replying.
 *
 * `provider_message_id` is UNIQUE per provider, which is what makes mailbox
 * sync idempotent: re-syncing an overlapping window, or a duplicate queue
 * delivery, cannot import the same message twice.
 */

import { normalizeEmail } from '../domain/domains.js'
import { ZOHO } from '../config/defaults.js'
import { bounded, buildWhere, clampLimit, clampOffset, newId, nowIso, parseJsonField } from './helpers.js'

/** Maps a present row. Callers that may have none guard with `mapped()` below. */
function mapConversation(row) {
  return {
    id: row.id,
    leadId: row.lead_id,
    contactId: row.contact_id,
    status: row.status,
    subject: row.subject,
    provider: row.provider,
    providerThreadId: row.provider_thread_id,
    messageCount: Number(row.message_count),
    lastMessageAt: row.last_message_at,
    lastInboundAt: row.last_inbound_at,
    lastOutboundAt: row.last_outbound_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    companyName: row.company_name ?? null,
    canonicalDomain: row.canonical_domain ?? null,
    stage: row.stage ?? null,
  }
}

/** `null` for an absent row, the mapped shape otherwise. */
const mappedConversation = (row) => (row ? mapConversation(row) : null)


function mapMessage(row) {
  if (!row) return null
  return {
    id: row.id,
    conversationId: row.conversation_id,
    leadId: row.lead_id,
    direction: row.direction,
    provider: row.provider,
    providerMessageId: row.provider_message_id,
    providerFolder: row.provider_folder,
    internetMessageId: row.internet_message_id,
    inReplyTo: row.in_reply_to,
    references: row.references_header,
    fromAddress: row.from_address,
    fromName: row.from_name,
    toAddresses: parseJsonField(row.to_addresses, []),
    ccAddresses: parseJsonField(row.cc_addresses, []),
    subject: row.subject,
    bodyText: row.body_text,
    bodyTruncated: row.body_truncated === 1,
    classification: row.classification,
    aiSummary: row.ai_summary,
    aiIntent: row.ai_intent,
    receivedAt: row.received_at,
    sentAt: row.sent_at,
    createdAt: row.created_at,
  }
}

const CONVERSATION_SELECT = `
  SELECT cv.*, c.name AS company_name, c.canonical_domain, l.stage
  FROM lead_conversations cv
  JOIN lead_leads l ON l.id = cv.lead_id
  JOIN lead_companies c ON c.id = l.company_id
`

/** @param {import('@cloudflare/workers-types').D1Database} db */
export async function getConversation(db, id) {
  const row = await db.prepare(`${CONVERSATION_SELECT} WHERE cv.id = ?`).bind(id).first()
  return mappedConversation(row)
}

/**
 * The conversation for a lead, creating one if needed.
 *
 * One open conversation per lead is the model: a prospect thread is a single
 * ongoing exchange, not a series of tickets. A second conversation only appears
 * if the first is explicitly closed.
 *
 * @param {import('@cloudflare/workers-types').D1Database} db
 */
export async function ensureConversation(db, { leadId, contactId = null, subject = '', providerThreadId = null }) {
  const existing = await db
    .prepare("SELECT * FROM lead_conversations WHERE lead_id = ? AND status != 'closed' ORDER BY created_at ASC LIMIT 1")
    .bind(leadId)
    .first()

  if (existing) {
    // Backfill the thread id the first time the provider reveals one — before
    // the first send there is nothing to record, and afterwards it is what
    // makes subsequent matching reliable.
    if (providerThreadId && !existing.provider_thread_id) {
      await db
        .prepare('UPDATE lead_conversations SET provider_thread_id = ?, updated_at = ? WHERE id = ?')
        .bind(providerThreadId, nowIso(), existing.id)
        .run()
      return mappedConversation({ ...existing, provider_thread_id: providerThreadId })
    }
    return mappedConversation(existing)
  }

  const id = newId()
  const now = nowIso()
  await db
    .prepare(
      `INSERT INTO lead_conversations
         (id, lead_id, contact_id, status, subject, provider, provider_thread_id, created_at, updated_at)
       VALUES (?, ?, ?, 'open', ?, 'zoho', ?, ?, ?)`,
    )
    .bind(id, leadId, contactId, bounded(subject, 300), providerThreadId, now, now)
    .run()

  return getConversation(db, id)
}

/** @param {import('@cloudflare/workers-types').D1Database} db */
export async function findConversationByThreadId(db, providerThreadId, provider = 'zoho') {
  if (!providerThreadId) return null
  const row = await db
    .prepare(`${CONVERSATION_SELECT} WHERE cv.provider = ? AND cv.provider_thread_id = ? LIMIT 1`)
    .bind(provider, providerThreadId)
    .first()
  return mappedConversation(row)
}

/** @param {import('@cloudflare/workers-types').D1Database} db */
export async function updateConversationStatus(db, id, status) {
  await db
    .prepare('UPDATE lead_conversations SET status = ?, updated_at = ? WHERE id = ?')
    .bind(status, nowIso(), id)
    .run()
}

/**
 * @param {import('@cloudflare/workers-types').D1Database} db
 * @param {{ status?, leadId?, needsAttention?, limit?, offset? }} [filters]
 */
export async function listConversations(db, filters = {}) {
  const { clause, bindings } = buildWhere([
    ['cv.status = ?', filters.status ?? null],
    ['cv.lead_id = ?', filters.leadId ?? null],
  ])

  const result = await db
    .prepare(`${CONVERSATION_SELECT} ${clause} ORDER BY cv.last_message_at DESC NULLS LAST LIMIT ? OFFSET ?`)
    .bind(...bindings, clampLimit(filters.limit, 50, 200), clampOffset(filters.offset))
    .all()

  return (result.results || []).map(mapConversation)
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

/**
 * Whether a provider message has already been imported.
 *
 * Checked before doing any work on a synced message, so a re-sync of an
 * overlapping window costs one indexed lookup per message rather than a parse,
 * a thread match and an AI call.
 *
 * @param {import('@cloudflare/workers-types').D1Database} db
 */
export async function messageExists(db, providerMessageId, provider = 'zoho') {
  if (!providerMessageId) return false
  const row = await db
    .prepare('SELECT id FROM lead_messages WHERE provider = ? AND provider_message_id = ? LIMIT 1')
    .bind(provider, providerMessageId)
    .first()
  return Boolean(row)
}

/**
 * Imports a message and updates its conversation's rollups in one batch.
 *
 * The rollups (`message_count`, `last_message_at`, direction timestamps) are
 * denormalized so the conversations list does not need an aggregate per row.
 * Updating them in the same batch as the insert is what keeps them honest.
 *
 * @param {import('@cloudflare/workers-types').D1Database} db
 * @param {object} input
 * @returns {Promise<{ message: object|null, created: boolean }>}
 */
export async function recordMessage(db, input) {
  if (input.providerMessageId && (await messageExists(db, input.providerMessageId, input.provider || 'zoho'))) {
    const existing = await db
      .prepare('SELECT * FROM lead_messages WHERE provider = ? AND provider_message_id = ?')
      .bind(input.provider || 'zoho', input.providerMessageId)
      .first()
    return { message: mapMessage(existing), created: false }
  }

  const id = newId()
  const now = nowIso()
  const body = String(input.bodyText || '')
  const truncated = body.length > ZOHO.maxBodyChars

  const timestampColumn = input.direction === 'inbound' ? 'last_inbound_at' : 'last_outbound_at'
  const messageAt = input.direction === 'inbound' ? input.receivedAt || now : input.sentAt || now

  await db.batch([
    db
      .prepare(
        `INSERT OR IGNORE INTO lead_messages
           (id, conversation_id, lead_id, direction, provider, provider_message_id, provider_folder,
            internet_message_id, in_reply_to, references_header, from_address, from_name,
            to_addresses, cc_addresses, subject, body_text, body_truncated,
            classification, ai_summary, ai_intent, received_at, sent_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id, input.conversationId, input.leadId, input.direction, input.provider || 'zoho',
        input.providerMessageId ?? null, input.providerFolder ?? null,
        input.internetMessageId ?? null, input.inReplyTo ?? null, input.references ?? null,
        normalizeEmail(input.fromAddress) || String(input.fromAddress || '').toLowerCase(),
        input.fromName ? bounded(input.fromName, 200) : null,
        JSON.stringify((input.toAddresses || []).map((address) => normalizeEmail(address) || address).filter(Boolean)),
        JSON.stringify((input.ccAddresses || []).map((address) => normalizeEmail(address) || address).filter(Boolean)),
        bounded(input.subject || '', 500),
        bounded(body, ZOHO.maxBodyChars),
        truncated ? 1 : 0,
        input.classification ?? null, input.aiSummary ?? null, input.aiIntent ?? null,
        input.receivedAt ?? null, input.sentAt ?? null, now,
      ),
    db
      .prepare(
        `UPDATE lead_conversations
         SET message_count = message_count + 1,
             last_message_at = ?,
             ${timestampColumn} = ?,
             updated_at = ?
         WHERE id = ?`,
      )
      .bind(messageAt, messageAt, now, input.conversationId),
  ])

  const stored = await db.prepare('SELECT * FROM lead_messages WHERE id = ?').bind(id).first()
  return { message: mapMessage(stored), created: Boolean(stored) }
}

/**
 * Attaches AI analysis to an already-stored message.
 *
 * The only UPDATE in this file, and deliberately narrow: it touches three
 * analysis columns and never the body, the addresses or the timestamps.
 *
 * @param {import('@cloudflare/workers-types').D1Database} db
 */
export async function attachMessageAnalysis(db, messageId, { classification, aiSummary, aiIntent }) {
  await db
    .prepare(
      `UPDATE lead_messages
       SET classification = COALESCE(?, classification), ai_summary = ?, ai_intent = ?
       WHERE id = ?`,
    )
    .bind(classification ?? null, aiSummary ? bounded(aiSummary, 2_000) : null, aiIntent ?? null, messageId)
    .run()
}

/** @param {import('@cloudflare/workers-types').D1Database} db */
export async function listMessages(db, conversationId) {
  const result = await db
    .prepare('SELECT * FROM lead_messages WHERE conversation_id = ? ORDER BY created_at ASC')
    .bind(conversationId)
    .all()
  return (result.results || []).map(mapMessage)
}

/** @param {import('@cloudflare/workers-types').D1Database} db */
export async function listMessagesForLead(db, leadId) {
  const result = await db
    .prepare('SELECT * FROM lead_messages WHERE lead_id = ? ORDER BY created_at ASC')
    .bind(leadId)
    .all()
  return (result.results || []).map(mapMessage)
}

/**
 * Inbound messages with no outbound message after them — the Replies queue.
 *
 * @param {import('@cloudflare/workers-types').D1Database} db
 */
export async function listUnansweredReplies(db, { limit = 50 } = {}) {
  const result = await db
    .prepare(
      `SELECT m.*, cv.subject AS conversation_subject, cv.status AS conversation_status,
              c.name AS company_name, c.canonical_domain, l.stage, l.id AS lead_ref
       FROM lead_messages m
       JOIN lead_conversations cv ON cv.id = m.conversation_id
       JOIN lead_leads l ON l.id = m.lead_id
       JOIN lead_companies c ON c.id = l.company_id
       WHERE m.direction = 'inbound'
         AND cv.status != 'resolved' AND cv.status != 'closed'
         AND NOT EXISTS (
           SELECT 1 FROM lead_messages later
           WHERE later.conversation_id = m.conversation_id
             AND later.direction = 'outbound'
             AND later.id != m.id
             -- Compare when the messages were actually sent/received, not when
             -- the rows were inserted: two rows written in the same millisecond
             -- (an import, a retry) must still order correctly.
             AND COALESCE(later.sent_at, later.received_at, later.created_at)
                 >= COALESCE(m.received_at, m.sent_at, m.created_at)
         )
       ORDER BY m.created_at DESC
       LIMIT ?`,
    )
    .bind(clampLimit(limit, 50, 200))
    .all()

  return (result.results || []).map((row) => ({
    ...(mapMessage(row) ?? {}),
    conversationSubject: row.conversation_subject,
    conversationStatus: row.conversation_status,
    companyName: row.company_name,
    canonicalDomain: row.canonical_domain,
    stage: row.stage,
  }))
}

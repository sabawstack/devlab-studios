/**
 * Attributing an inbound message to a lead, and a bounce to a draft.
 *
 * THIS IS WHERE THE MAILBOX MEETS THE CRM, and the direction of dependency is
 * deliberate: the mailbox reads the lead engine's tables to find out who a
 * message is about, and hands the answer to the lead engine's own
 * `recordBounce`. It does not decide anything about suppression, stages or
 * campaigns — the CRM owns that data and has owned it since before this
 * mailbox existed. Inventing a second bounce state here would mean two systems
 * disagreeing about whether an address is dead.
 *
 * THREE ROUTES TO A DRAFT, TRIED IN ORDER OF CERTAINTY:
 *
 *   1. VERP — the draft id in the envelope recipient. Exact, and free, but only
 *      if the transmitting agent honoured the envelope sender we asked for.
 *      n8n's built-in Send Email node does NOT (it derives MAIL FROM from the
 *      `From:` header and exposes no override), so this route cannot be the
 *      only one.
 *   2. MESSAGE-ID — our own id, echoed inside the DSN's returned headers. RFC
 *      3464 requires a DSN to carry the original headers, and we control the
 *      Message-ID absolutely because we build the message. This is the route
 *      that has to work, and it is why the id is encoded there at all.
 *   3. ADDRESS — the failed recipient, resolved to the most recent draft sent
 *      to it. A heuristic, used last, and it still produces a draftId so the
 *      single existing `recordBounce(draftId)` path stays the only one.
 */

import { verpIdentity } from '../domain/mailboxes.js'
import { KIND_DRAFT, KIND_OUTBOUND, parseMessageId } from '../domain/messageId.js'
import { normalizeEmail } from '../../lead-engine/domain/domains.js'

/**
 * The lead that owns an email address, if any.
 *
 * Matches on `lead_contacts.email`, which is indexed. An address may belong to
 * more than one lead when two discovered companies publish the same agency
 * address; the most recently contacted wins, because that is the exchange a
 * reply is most likely to be part of.
 *
 * @param {D1Database} db
 * @param {string} email
 * @returns {Promise<{ leadId: string, contactId: string }|null>}
 */
export async function findLeadByEmail(db, email) {
  const address = normalizeEmail(email)
  if (!address) return null

  const row = await db
    .prepare(
      `SELECT c.lead_id, c.id AS contact_id
       FROM lead_contacts c
       JOIN lead_leads l ON l.id = c.lead_id
       WHERE c.email = ?
       ORDER BY l.updated_at DESC
       LIMIT 1`,
    )
    .bind(address)
    .first()

  return row ? { leadId: row.lead_id, contactId: row.contact_id } : null
}

/**
 * The most recent draft actually handed out for an address.
 *
 * `status != 'draft'` filters to drafts that reached the outbox — a draft
 * nobody sent cannot have bounced, and attributing a bounce to one would
 * suppress an address we never contacted.
 *
 * @param {D1Database} db
 * @param {string} email
 * @returns {Promise<{ draftId: string, leadId: string }|null>}
 */
export async function findDraftByRecipient(db, email) {
  const address = normalizeEmail(email)
  if (!address) return null

  const row = await db
    .prepare(
      `SELECT d.id AS draft_id, d.lead_id
       FROM lead_outreach_drafts d
       JOIN lead_contacts c ON c.lead_id = d.lead_id
       WHERE c.email = ? AND d.status != 'draft' AND d.status != 'discarded'
       ORDER BY d.updated_at DESC
       LIMIT 1`,
    )
    .bind(address)
    .first()

  return row ? { draftId: row.draft_id, leadId: row.lead_id } : null
}

/** @param {D1Database} db */
async function leadForDraft(db, draftId) {
  const row = await db.prepare('SELECT lead_id FROM lead_outreach_drafts WHERE id = ?').bind(draftId).first()
  return row?.lead_id ?? null
}

/**
 * Works out which draft a delivery report is about.
 *
 * @param {D1Database} db
 * @param {{ envelopeTo: string, originalMessageId: string|null, failedRecipient: string|null }} input
 * @returns {Promise<{ draftId: string|null, leadId: string|null, method: string|null }>}
 */
export async function correlateBounce(db, { envelopeTo, originalMessageId, failedRecipient }) {
  const verp = verpIdentity(envelopeTo)
  if (verp?.kind === KIND_DRAFT) {
    const leadId = await leadForDraft(db, verp.id)
    // A VERP tag that names no draft is not a match. Trusting it anyway would
    // let anyone suppress an arbitrary address by mailing bounce+d-<anything>@.
    if (leadId) return { draftId: verp.id, leadId, method: 'verp' }
  }
  if (verp?.kind === KIND_OUTBOUND) {
    // A bounce on a mailbox reply. There is no outreach draft behind it, so
    // there is nothing for `recordBounce` to key on — but the lead is still
    // worth attaching so the failure shows on their timeline.
    const row = await db.prepare('SELECT lead_id FROM mailbox_outbound WHERE id = ?').bind(verp.id).first()
    if (row) return { draftId: null, leadId: row.lead_id ?? null, method: 'verp' }
  }

  const ours = parseMessageId(originalMessageId)
  if (ours?.kind === KIND_DRAFT) {
    const leadId = await leadForDraft(db, ours.id)
    if (leadId) return { draftId: ours.id, leadId, method: 'message_id' }
  }

  if (failedRecipient) {
    const found = await findDraftByRecipient(db, failedRecipient)
    if (found) return { draftId: found.draftId, leadId: found.leadId, method: 'address' }

    // No draft, but we may still know whose address it is — enough to show the
    // bounce against the lead even though the CRM's draft-keyed bounce path
    // cannot run.
    const lead = await findLeadByEmail(db, failedRecipient)
    if (lead) return { draftId: null, leadId: lead.leadId, method: 'address' }
  }

  return { draftId: null, leadId: null, method: null }
}

/**
 * Works out which lead an ordinary inbound message is from.
 *
 * @param {D1Database} db
 * The address fallback runs only when `senderVerified` (DMARC pass from the
 * edge). An unauthenticated From is a claim anyone can make, and attaching a
 * forged message to a lead puts it in the CRM's conversation and reply queue.
 * Callers that omit the flag get the strict behaviour.
 *
 * @param {{ fromAddress: string, inReplyTo: string|null, referenceIds: string[], senderVerified?: boolean }} input
 * @returns {Promise<{ leadId: string|null, draftId: string|null, method: string|null }>}
 */
export async function correlateInbound(db, { fromAddress, inReplyTo, referenceIds = [], senderVerified = false }) {
  // Our own identifiers first. A prospect replying from a different address
  // than the one we wrote to — a personal address, or a shared inbox — is
  // common, and the threading headers are the only thing that still connects
  // it to the lead.
  for (const candidate of [inReplyTo, ...[...referenceIds].reverse()].filter(Boolean)) {
    const ours = parseMessageId(candidate)
    if (!ours) continue

    if (ours.kind === KIND_DRAFT) {
      const leadId = await leadForDraft(db, ours.id)
      if (leadId) return { leadId, draftId: ours.id, method: 'message_id' }
    }

    if (ours.kind === KIND_OUTBOUND) {
      const row = await db.prepare('SELECT lead_id FROM mailbox_outbound WHERE id = ?').bind(ours.id).first()
      if (row?.lead_id) return { leadId: row.lead_id, draftId: null, method: 'message_id' }
    }
  }

  if (!senderVerified) return { leadId: null, draftId: null, method: null }

  const lead = await findLeadByEmail(db, fromAddress)
  if (lead) return { leadId: lead.leadId, draftId: null, method: 'address' }

  return { leadId: null, draftId: null, method: null }
}

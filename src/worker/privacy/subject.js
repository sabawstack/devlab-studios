/**
 * "Export / erase this person" for inquiries (audit SEC-08), by email address.
 *
 * Export returns every inquiry the address submitted with its activities,
 * attribution, consents and delivery attempts, as JSON for the person.
 * Erase deletes those inquiries (companions go with them, ON DELETE CASCADE)
 * and the address's confirmation-cap hash. Lead-engine suppression records
 * are deliberately kept: they are what stops the address being contacted again.
 * Mailbox correspondence is erased separately (docs/operations.md).
 */
import { hashRecipient } from '../delivery/confirmationCap.js'

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase()
}

async function all(db, sql, ...bindings) {
  return (await db.prepare(sql).bind(...bindings).all()).results || []
}

export async function exportPerson(db, email) {
  const address = normalizeEmail(email)
  const leads = await all(db, 'SELECT * FROM leads WHERE lower(email) = ? ORDER BY created_at', address)
  const inquiries = []
  for (const lead of leads) {
    inquiries.push({
      inquiry: lead,
      activities: await all(db, 'SELECT activity_type, status, created_at FROM lead_activities WHERE lead_id = ? ORDER BY created_at', lead.id),
      attribution: await all(db, 'SELECT * FROM lead_attribution WHERE lead_id = ?', lead.id),
      consents: await all(db, 'SELECT * FROM lead_consents WHERE lead_id = ?', lead.id),
      deliveryAttempts: await all(db, 'SELECT target, attempt_number, status, attempted_at FROM delivery_attempts WHERE lead_id = ?', lead.id),
    })
  }
  return { email: address, exportedAt: new Date().toISOString(), inquiries }
}

export async function erasePerson(db, email) {
  const address = normalizeEmail(email)
  const leads = await db.prepare('DELETE FROM leads WHERE lower(email) = ?').bind(address).run()
  const hash = await hashRecipient(address)
  const caps = await db.prepare('DELETE FROM confirmation_recipients WHERE address_hash = ?').bind(hash).run()
  return { inquiries: Number(leads?.meta?.changes || 0), confirmationRecords: Number(caps?.meta?.changes || 0) }
}

import { readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createSqliteD1 } from '../repositories/pickleball/open/testing/sqliteD1'
import { erasePerson, exportPerson } from './subject.js'
import { hashRecipient } from '../delivery/confirmationCap.js'

const migrations = readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort().map((f) => `migrations/${f}`)

async function seed() {
  const { d1, raw } = createSqliteD1(migrations)
  const lead = raw.prepare(`INSERT INTO leads (id, name, email, subject, message, source, status, created_at, updated_at, inquiry_type)
    VALUES (?, 'Synthetic', ?, 's', 'm', 'inquiry-form', 'delivered', '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z', 'general')`)
  lead.run('mine-1', 'Person@Example.com')
  lead.run('mine-2', 'person@example.com')
  lead.run('other', 'someone-else@example.com')
  raw.prepare("INSERT INTO lead_activities (id, lead_id, activity_type, created_at) VALUES ('a1', 'mine-1', 'received', '2026-11-01T00:00:00.000Z')").run()
  raw.prepare('INSERT INTO confirmation_recipients (address_hash, last_sent_at) VALUES (?, ?)').run(await hashRecipient('person@example.com'), '2026-11-01T00:00:00.000Z')
  return { d1, raw }
}

describe('export and erase a person (SEC-08)', () => {
  it('exports every inquiry for the address, case-insensitively, with companions', async () => {
    const { d1 } = await seed()
    const data = await exportPerson(d1, ' PERSON@example.com ')
    expect(data.inquiries.map((entry) => entry.inquiry.id).sort()).toEqual(['mine-1', 'mine-2'])
    expect(data.inquiries.find((entry) => entry.inquiry.id === 'mine-1').activities).toHaveLength(1)
  })

  it('erases only that person, with companions and the confirmation hash', async () => {
    const { d1, raw } = await seed()
    expect(await erasePerson(d1, 'person@example.com')).toEqual({ inquiries: 2, confirmationRecords: 1 })
    expect(raw.prepare('SELECT id FROM leads').all().map((r) => r.id)).toEqual(['other'])
    expect(raw.prepare('SELECT COUNT(*) AS n FROM lead_activities').get().n).toBe(0)
  })
})

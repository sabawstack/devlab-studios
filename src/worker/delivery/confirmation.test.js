import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestD1 } from '../repositories/testSupport/d1Sqlite.js'
import { attemptLeadDelivery } from '../leadDelivery.js'
import { buildConfirmationEmail, buildLeadMagnetEmail } from './messages.js'
import { claimConfirmationSlot, hashRecipient, releaseConfirmationSlot } from './confirmationCap.js'

/**
 * F4 / M5: the visitor confirmation is a fixed acknowledgement, capped at one
 * per recipient address per 24 hours, while the owner notification is
 * unaffected.
 */

const HERE = fileURLToPath(new URL('.', import.meta.url))
const MIGRATIONS = join(HERE, '..', '..', '..', 'migrations')
const schema = [
  '0006_leads_backend.sql',
  '0009_business_inquiry_platform.sql',
  '0017_confirmation_recipients.sql',
].map((file) => readFileSync(join(MIGRATIONS, file), 'utf8'))

const PHISH_NAME = 'Your account is locked, verify at https://evil.example/login'
const PHISH_MESSAGE = 'URGENT: reset your password at https://evil.example/reset within 24 hours.'

function lead(overrides = {}) {
  return {
    id: crypto.randomUUID(),
    name: PHISH_NAME,
    email: 'victim@example.com',
    subject: 'Inquiry',
    message: PHISH_MESSAGE,
    source: 'contact',
    inquiryType: 'general',
    ...overrides,
  }
}

async function insertLead(db, row) {
  const now = new Date().toISOString()
  await db
    .prepare(
      'INSERT INTO leads (id, name, email, subject, message, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(row.id, row.name, row.email, row.subject, row.message, row.source, now, now)
    .run()
  return row
}

describe('confirmation content', () => {
  it('echoes neither the name nor the message the visitor typed', () => {
    for (const message of [buildConfirmationEmail(lead()), buildConfirmationEmail(lead({ inquiryType: 'employment_opportunity' }))]) {
      for (const part of [message.subject, message.text, message.html]) {
        expect(part).not.toContain('evil.example')
        expect(part).not.toContain('URGENT')
        expect(part).not.toContain('locked')
      }
    }
  })

  it('does not greet a lead-magnet requester by the name they typed', () => {
    const message = buildLeadMagnetEmail(lead(), { title: 'The checklist', url: 'https://www.devlabstudios.com/x' })
    expect(message.text).not.toContain('evil.example')
    expect(message.html).not.toContain('evil.example')
    expect(message.text).toContain('https://www.devlabstudios.com/x')
  })
})

describe('confirmationCap', () => {
  it('allows one confirmation per address per 24 hours, case-insensitively', async () => {
    const db = createTestD1(schema)
    const now = new Date('2026-10-13T10:00:00Z')

    expect(await claimConfirmationSlot(db, 'Victim@Example.com', { now })).toBe(true)
    expect(await claimConfirmationSlot(db, 'victim@example.com', { now: new Date('2026-10-14T09:59:59Z') })).toBe(false)
    expect(await claimConfirmationSlot(db, 'other@example.com', { now })).toBe(true)
    expect(await claimConfirmationSlot(db, 'victim@example.com', { now: new Date('2026-10-14T10:00:01Z') })).toBe(true)
  })

  it('stores only a hash of the address', async () => {
    const db = createTestD1(schema)
    await claimConfirmationSlot(db, 'victim@example.com')
    const rows = (await db.prepare('SELECT * FROM confirmation_recipients').all()).results
    expect(rows).toHaveLength(1)
    expect(JSON.stringify(rows)).not.toContain('victim')
    expect(rows[0].address_hash).toBe(await hashRecipient('victim@example.com'))
  })

  it('gives a slot back after a send that did not go out', async () => {
    const db = createTestD1(schema)
    const now = new Date()
    await claimConfirmationSlot(db, 'victim@example.com', { now })
    await releaseConfirmationSlot(db, 'victim@example.com', now)
    expect(await claimConfirmationSlot(db, 'victim@example.com')).toBe(true)
  })
})

describe('attemptLeadDelivery with the cap', () => {
  let sent

  beforeEach(() => {
    sent = []
    vi.stubGlobal('fetch', async (_url, init) => {
      sent.push(JSON.parse(init.body))
      return new Response(JSON.stringify({ id: `email-${sent.length}` }), { status: 200 })
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('notifies the owner every time but confirms to an address only once a day', async () => {
    const db = createTestD1(schema)
    const env = { DB: db, RESEND_API_KEY: 're_test', LEAD_NOTIFICATION_EMAIL: 'owner@devlabstudios.com' }

    const first = await insertLead(db, lead())
    const second = await insertLead(db, lead())

    expect((await attemptLeadDelivery(env, first)).ok).toBe(true)
    expect((await attemptLeadDelivery(env, second)).ok).toBe(true)

    const toOwner = sent.filter((mail) => mail.to[0] === 'owner@devlabstudios.com')
    const toVisitor = sent.filter((mail) => mail.to[0] === 'victim@example.com')
    expect(toOwner).toHaveLength(2)
    expect(toVisitor).toHaveLength(1)
    expect(JSON.stringify(toVisitor)).not.toContain('evil.example')

    const skipped = (
      await db.prepare("SELECT * FROM delivery_attempts WHERE lead_id = ? AND target = 'resend-confirmation'").bind(second.id).all()
    ).results
    expect(skipped).toHaveLength(1)
    expect(skipped[0].error_category).toBe('skipped_recipient_daily_cap')

    // Retrying the second lead does not send the confirmation either.
    await attemptLeadDelivery(env, second)
    expect(sent.filter((mail) => mail.to[0] === 'victim@example.com')).toHaveLength(1)
  })

  it('never sends a confirmation to something that is not one plain address', async () => {
    const db = createTestD1(schema)
    const env = { DB: db, RESEND_API_KEY: 're_test' }
    const row = await insertLead(db, lead({ email: 'a@example.com,b@example.org' }))

    await attemptLeadDelivery(env, row)
    expect(sent.some((mail) => String(mail.to[0]).includes('example.org'))).toBe(false)
  })

  it('releases the slot when the confirmation send fails, so Retry can send it', async () => {
    const db = createTestD1(schema)
    const env = { DB: db, RESEND_API_KEY: 're_test' }
    vi.stubGlobal('fetch', async (_url, init) => {
      const body = JSON.parse(init.body)
      if (body.to[0] === 'victim@example.com') return new Response(JSON.stringify({ message: 'bad' }), { status: 422 })
      sent.push(body)
      return new Response(JSON.stringify({ id: 'ok' }), { status: 200 })
    })

    const row = await insertLead(db, lead())
    await attemptLeadDelivery(env, row)
    expect(await claimConfirmationSlot(db, 'victim@example.com')).toBe(true)
  })
})

import { readdirSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { createSqliteD1 } from '../repositories/pickleball/open/testing/sqliteD1'
import { getInquiryFunnel, listUnansweredInquiries, resolveReminderSettings, sendUnansweredInquiryReminder } from './funnel.js'

const migrations = readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort().map((f) => `migrations/${f}`)

function seed() {
  const { d1, raw } = createSqliteD1(migrations)
  const lead = raw.prepare(`INSERT INTO leads (id, name, email, subject, message, source, status, created_at, updated_at, inquiry_type, pipeline_status, company, qualification)
    VALUES (?, 'Synthetic', 'a@example.com', 's', 'm', ?, 'delivered', ?, ?, ?, ?, ?, ?)`)
  lead.run('l1', 'inquiry-form', '2026-11-10T08:00:00.000Z', '2026-11-10T08:00:00.000Z', 'business_system', 'contacted', 'Acme', 'priority')
  lead.run('l2', 'home-final-cta', '2026-11-11T08:00:00.000Z', '2026-11-11T08:00:00.000Z', 'workflow_audit', 'new', 'Beta', 'standard')
  lead.run('l3', 'inquiry-form', '2026-11-12T06:00:00.000Z', '2026-11-12T06:00:00.000Z', 'general', 'new', '', 'unscored')
  lead.run('old', 'inquiry-form', '2026-09-01T08:00:00.000Z', '2026-09-01T08:00:00.000Z', 'general', 'new', '', 'unscored')
  const activity = raw.prepare('INSERT INTO lead_activities (id, lead_id, activity_type, created_at) VALUES (?, ?, ?, ?)')
  activity.run('a1', 'l1', 'received', '2026-11-10T08:00:00.000Z')
  activity.run('a2', 'l1', 'status_change', '2026-11-10T12:00:00.000Z')
  activity.run('a3', 'l2', 'delivery', '2026-11-11T08:00:01.000Z')
  raw.prepare("INSERT INTO delivery_attempts (id, lead_id, target, attempt_number, status, attempted_at) VALUES ('d1', 'l2', 'resend', 1, 'failure', '2026-11-11T08:00:01.000Z')").run()
  return d1
}

describe('getInquiryFunnel (LEAD-05)', () => {
  it('counts by type, source and qualification, failures, and first-response time', async () => {
    const funnel = await getInquiryFunnel(seed(), { since: new Date('2026-11-01T00:00:00Z'), until: new Date('2026-11-13T00:00:00Z') })
    expect(funnel.total).toBe(3)
    expect(funnel.byType).toEqual({ business_system: 1, workflow_audit: 1, general: 1 })
    expect(funnel.bySource['inquiry-form']).toBe(2)
    expect(funnel.withDeliveryFailure).toBe(1)
    expect(funnel.answered).toBe(1)
    expect(funnel.unanswered).toBe(2)
    expect(funnel.firstResponseHours).toEqual({ median: 4, average: 4 })
  })
})

describe('unanswered inquiry reminder', () => {
  const now = new Date('2026-11-12T22:00:00Z')

  it('lists inquiries older than the threshold with no human response, newest excluded', async () => {
    const waiting = await listUnansweredInquiries(seed(), { now, hours: 24 })
    expect(waiting.map((lead) => lead.id)).toEqual(['l2'])
    expect(JSON.stringify(waiting)).not.toMatch(/a@example\.com/)
  })

  it('emails only the internal address, and only when something is waiting', async () => {
    const send = vi.fn(async () => ({ ok: true }))
    const result = await sendUnansweredInquiryReminder({ DB: seed(), LEAD_NOTIFICATION_EMAIL: 'ops@example.com' }, { now, provider: { isConfigured: true, send }, getSetting: async () => null })
    expect(result).toBe('sent: 1 waiting')
    expect(send.mock.calls[0][0].to).toBe('ops@example.com')
    expect(send.mock.calls[0][0].text).not.toMatch(/a@example\.com|Synthetic/)
  })

  it('honours the settings', async () => {
    expect(resolveReminderSettings(null)).toEqual({ enabled: true, hours: 24 })
    expect(resolveReminderSettings({ hours: 4 })).toEqual({ enabled: true, hours: 4 })
    expect(resolveReminderSettings({ hours: 0 })).toEqual({ enabled: true, hours: 24 })
    const send = vi.fn()
    expect(await sendUnansweredInquiryReminder({ DB: seed() }, { now, provider: { isConfigured: true, send }, getSetting: async () => ({ enabled: false }) })).toMatch(/turned off/)
    expect(send).not.toHaveBeenCalled()
  })
})

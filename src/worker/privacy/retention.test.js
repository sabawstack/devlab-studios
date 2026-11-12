import { readdirSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { createSqliteD1 } from '../repositories/pickleball/open/testing/sqliteD1'
import { applyRetention, planRetention, resolveRetention, runRetentionJob } from './retention.js'

const migrations = readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort().map((f) => `migrations/${f}`)
const now = new Date('2026-11-12T00:00:00Z')

function seed() {
  const { d1, raw } = createSqliteD1(migrations)
  const lead = raw.prepare(`INSERT INTO leads (id, name, email, subject, message, source, status, created_at, updated_at, inquiry_type, pipeline_status)
    VALUES (?, 'Synthetic', ?, 's', 'm', 'inquiry-form', 'delivered', ?, ?, 'general', ?)`)
  lead.run('old-closed', 'a@example.com', '2023-01-01T00:00:00.000Z', '2023-02-01T00:00:00.000Z', 'lost')
  lead.run('old-open', 'b@example.com', '2023-01-01T00:00:00.000Z', '2023-02-01T00:00:00.000Z', 'new')
  lead.run('old-closed-recent-activity', 'c@example.com', '2023-01-01T00:00:00.000Z', '2023-02-01T00:00:00.000Z', 'won')
  lead.run('recent-closed', 'd@example.com', '2026-10-01T00:00:00.000Z', '2026-10-02T00:00:00.000Z', 'archived')
  raw.prepare("INSERT INTO lead_activities (id, lead_id, activity_type, created_at) VALUES ('act', 'old-closed-recent-activity', 'note', '2026-06-01T00:00:00.000Z')").run()
  raw.prepare("INSERT INTO lead_activities (id, lead_id, activity_type, created_at) VALUES ('act2', 'old-closed', 'received', '2023-01-01T00:00:00.000Z')").run()
  raw.prepare("INSERT INTO confirmation_recipients (address_hash, last_sent_at) VALUES ('h-old', '2026-09-01T00:00:00.000Z'), ('h-new', '2026-11-10T00:00:00.000Z')").run()
  for (let v = 1; v <= 55; v += 1) {
    raw.prepare('INSERT INTO content_versions (id, content_type, content_id, version_number, status, snapshot_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(`v${v}`, 'pages', 'home', v, 'published', '{}', '2026-01-01T00:00:00.000Z')
  }
  return { d1, raw }
}

describe('retention (SEC-08)', () => {
  it('is off and dry-run by default, with the plan defaults', () => {
    expect(resolveRetention(null)).toMatchObject({ enabled: false, dryRun: true, inquiriesMonths: 24, confirmationDays: 30, auditLogMonths: 24, versionsPerEntity: 50 })
  })

  it('plans exactly the expired, closed, untouched records', async () => {
    const { d1 } = seed()
    expect(await planRetention(d1, resolveRetention(null), now)).toEqual({ inquiries: 1, confirmationRecipients: 1, auditLog: 0, contentVersions: 5 })
  })

  it('deletes them, with companions, and keeps everything else', async () => {
    const { d1, raw } = seed()
    const deleted = await applyRetention(d1, resolveRetention(null), now)
    expect(deleted).toEqual({ inquiries: 1, confirmationRecipients: 1, auditLog: 0, contentVersions: 5 })
    expect(raw.prepare('SELECT id FROM leads ORDER BY id').all().map((r) => r.id)).toEqual(['old-closed-recent-activity', 'old-open', 'recent-closed'])
    expect(raw.prepare("SELECT COUNT(*) AS n FROM lead_activities WHERE lead_id = 'old-closed'").get().n).toBe(0)
    expect(raw.prepare('SELECT MIN(version_number) AS m FROM content_versions').get().m).toBe(6)
  })

  it('the cron step deletes nothing unless enabled AND not a dry run', async () => {
    const audit = vi.fn(async () => {})
    for (const stored of [null, { enabled: true }, { enabled: false, dryRun: false }]) {
      const { d1, raw } = seed()
      const summary = await runRetentionJob({ DB: d1 }, { now, getSetting: async () => stored, audit })
      expect(summary).toMatch(/would delete/)
      expect(raw.prepare('SELECT COUNT(*) AS n FROM leads').get().n).toBe(4)
    }
    const { d1, raw } = seed()
    expect(await runRetentionJob({ DB: d1 }, { now, getSetting: async () => ({ enabled: true, dryRun: false }), audit })).toMatch(/^deleted/)
    expect(raw.prepare('SELECT COUNT(*) AS n FROM leads').get().n).toBe(3)
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'retention_delete' }))
  })
})

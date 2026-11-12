/**
 * Data retention (audit SEC-08).
 *
 * Settings live in site_settings `retention`. Shipped OFF, and when turned on
 * it stays a DRY RUN (counts only) until `dryRun` is set to false: the plan
 * requires automated backups (OPS-04) and the owner's confirmation of the
 * periods (audit N6) before anything is deleted, and the first real run is
 * attended. Every run records what it would delete or did delete.
 *
 * Categories (defaults are the plan's hypotheses, owner to confirm):
 *  - inquiries: closed (won / lost / archived) and untouched for 24 months,
 *    with their activities, attribution, consents and delivery attempts
 *    (ON DELETE CASCADE). Open pipeline statuses are never deleted.
 *  - confirmation_recipients: the 24-hour cap hashes, after 30 days.
 *  - audit_log: after 24 months.
 *  - content_versions: beyond the newest 50 per item.
 * Lead-engine suppression records are not touched (kept by design).
 * Deletes run in bounded batches.
 */
export const RETENTION_SETTINGS_KEY = 'retention'

export const DEFAULT_RETENTION = {
  enabled: false,
  dryRun: true,
  inquiriesMonths: 24,
  confirmationDays: 30,
  auditLogMonths: 24,
  versionsPerEntity: 50,
  batchSize: 200,
}

const OPEN_PIPELINE = ['new', 'in_review', 'qualified', 'contacted']

function bounded(value, fallback, min, max) {
  const n = Number(value)
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback
}

export function resolveRetention(stored) {
  const s = stored && typeof stored === 'object' ? stored : {}
  return {
    enabled: s.enabled === true,
    dryRun: s.dryRun !== false,
    inquiriesMonths: bounded(s.inquiriesMonths, DEFAULT_RETENTION.inquiriesMonths, 1, 120),
    confirmationDays: bounded(s.confirmationDays, DEFAULT_RETENTION.confirmationDays, 2, 3650),
    auditLogMonths: bounded(s.auditLogMonths, DEFAULT_RETENTION.auditLogMonths, 1, 120),
    versionsPerEntity: bounded(s.versionsPerEntity, DEFAULT_RETENTION.versionsPerEntity, 5, 1000),
    batchSize: bounded(s.batchSize, DEFAULT_RETENTION.batchSize, 10, 1000),
  }
}

function monthsAgo(now, months) {
  const d = new Date(now)
  d.setUTCMonth(d.getUTCMonth() - months)
  return d.toISOString()
}

function daysAgo(now, days) {
  return new Date(now.getTime() - days * 86_400_000).toISOString()
}

/** The id-selecting query for each category: shared by the dry run and the delete. */
function selectors(settings, now) {
  const open = OPEN_PIPELINE.map((status) => `'${status}'`).join(', ')
  return {
    inquiries: {
      table: 'leads',
      key: 'id',
      sql: `SELECT l.id FROM leads l
            WHERE l.pipeline_status NOT IN (${open})
              AND MAX(l.updated_at, COALESCE((SELECT MAX(a.created_at) FROM lead_activities a WHERE a.lead_id = l.id), l.updated_at)) < ?`,
      bindings: [monthsAgo(now, settings.inquiriesMonths)],
    },
    confirmationRecipients: {
      table: 'confirmation_recipients',
      key: 'address_hash',
      sql: 'SELECT address_hash FROM confirmation_recipients WHERE last_sent_at < ?',
      bindings: [daysAgo(now, settings.confirmationDays)],
    },
    auditLog: {
      table: 'audit_log',
      key: 'id',
      sql: 'SELECT id FROM audit_log WHERE created_at < ?',
      bindings: [monthsAgo(now, settings.auditLogMonths)],
    },
    contentVersions: {
      table: 'content_versions',
      key: 'id',
      sql: `SELECT v.id FROM content_versions v
            WHERE (SELECT COUNT(*) FROM content_versions newer
                   WHERE newer.content_type = v.content_type
                     AND newer.content_id IS v.content_id
                     AND newer.version_number > v.version_number) >= ?`,
      bindings: [settings.versionsPerEntity],
    },
  }
}

/** Counts per category, deleting nothing. */
export async function planRetention(db, settings, now = new Date()) {
  const counts = {}
  for (const [name, selector] of Object.entries(selectors(settings, now))) {
    const row = await db.prepare(`SELECT COUNT(*) AS n FROM (${selector.sql})`).bind(...selector.bindings).first()
    counts[name] = Number(row?.n || 0)
  }
  return counts
}

/** Deletes in batches of `batchSize` per category per run; returns what was deleted. */
export async function applyRetention(db, settings, now = new Date()) {
  const deleted = {}
  for (const [name, selector] of Object.entries(selectors(settings, now))) {
    const result = await db
      .prepare(`DELETE FROM ${selector.table} WHERE ${selector.key} IN (${selector.sql} LIMIT ?)`)
      .bind(...selector.bindings, settings.batchSize)
      .run()
    deleted[name] = Number(result?.meta?.changes || 0)
  }
  return deleted
}

/**
 * The daily cron step. Returns a one-line summary for job_runs and writes an
 * audit event for every run that is enabled (dry or real).
 *
 * @param {{ DB?: D1Database }} env
 * @param {{ now: Date, getSetting: (key: string) => Promise<unknown>, audit: (event: { action: string, entityType: string, entityId?: string, metadata?: unknown }) => Promise<unknown> }} deps
 */
export async function runRetentionJob(env, { now, getSetting, audit }) {
  if (!env?.DB) return 'skipped: no database'
  const settings = resolveRetention(await getSetting(RETENTION_SETTINGS_KEY))
  if (!settings.enabled) {
    const counts = await planRetention(env.DB, settings, now)
    return `off; would delete ${JSON.stringify(counts)}`
  }
  if (settings.dryRun) {
    const counts = await planRetention(env.DB, settings, now)
    await audit({ action: 'retention_dry_run', entityType: 'retention', entityId: RETENTION_SETTINGS_KEY, metadata: { summary: 'Retention dry run.', counts, settings } })
    return `dry run; would delete ${JSON.stringify(counts)}`
  }
  const deleted = await applyRetention(env.DB, settings, now)
  await audit({ action: 'retention_delete', entityType: 'retention', entityId: RETENTION_SETTINGS_KEY, metadata: { summary: 'Retention deleted expired records.', deleted, settings } })
  return `deleted ${JSON.stringify(deleted)}`
}

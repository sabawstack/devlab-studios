/**
 * Inquiry funnel and response-time figures for the admin (audit LEAD-05), and
 * the daily internal reminder about inquiries nobody has answered yet.
 *
 * "Answered" means a person acted on the inquiry in the admin: a status
 * change, a note or an assignment. Delivery, qualification and receipt are
 * automatic and do not count. Figures come from D1 only; CTA clicks and form
 * starts stay in GA4 (see the panel's source note).
 */
const HUMAN_ACTIVITY = ['status_change', 'note', 'assignment']
const placeholders = HUMAN_ACTIVITY.map(() => '?').join(', ')

function median(values) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

/**
 * @param {D1Database} db
 * @param {{ since: Date, until?: Date }} range
 */
export async function getInquiryFunnel(db, { since, until = new Date() }) {
  const bounds = [since.toISOString(), until.toISOString()]
  const count = async (column) => (await db
    .prepare(`SELECT ${column} AS key, COUNT(*) AS n FROM leads WHERE created_at >= ? AND created_at < ? GROUP BY ${column} ORDER BY n DESC`)
    .bind(...bounds).all()).results || []

  const [byType, bySource, byQualification, byStatus, failures, responses] = await Promise.all([
    count('inquiry_type'),
    count('source'),
    count('qualification'),
    count('pipeline_status'),
    db.prepare(
      `SELECT COUNT(DISTINCT d.lead_id) AS n FROM delivery_attempts d JOIN leads l ON l.id = d.lead_id
       WHERE l.created_at >= ? AND l.created_at < ? AND d.status = 'failure'`,
    ).bind(...bounds).first(),
    db.prepare(
      `SELECT l.id, l.created_at AS received,
              (SELECT MIN(a.created_at) FROM lead_activities a WHERE a.lead_id = l.id AND a.activity_type IN (${placeholders})) AS first_response
       FROM leads l WHERE l.created_at >= ? AND l.created_at < ?`,
    ).bind(...HUMAN_ACTIVITY, ...bounds).all(),
  ])

  const rows = responses.results || []
  const hours = rows
    .filter((row) => row.first_response)
    .map((row) => (Date.parse(row.first_response) - Date.parse(row.received)) / 3_600_000)
    .filter((value) => Number.isFinite(value) && value >= 0)

  const toMap = (list) => Object.fromEntries(list.map((row) => [row.key || 'unknown', Number(row.n)]))
  return {
    since: bounds[0],
    until: bounds[1],
    total: rows.length,
    byType: toMap(byType),
    bySource: toMap(bySource),
    byQualification: toMap(byQualification),
    byPipelineStatus: toMap(byStatus),
    withDeliveryFailure: Number(failures?.n || 0),
    answered: hours.length,
    unanswered: rows.length - hours.length,
    firstResponseHours: {
      median: hours.length ? Number(median(hours).toFixed(1)) : null,
      average: hours.length ? Number((hours.reduce((a, b) => a + b, 0) / hours.length).toFixed(1)) : null,
    },
  }
}

/**
 * Inquiries received more than `hours` ago (within the last 14 days) with no
 * human response and not archived/won/lost. Only fields the owner needs to
 * find the inquiry: no message text.
 *
 * @param {D1Database} db
 * @param {{ now: Date, hours: number }} options
 */
export async function listUnansweredInquiries(db, { now, hours }) {
  const olderThan = new Date(now.getTime() - hours * 3_600_000).toISOString()
  const notBefore = new Date(now.getTime() - 14 * 24 * 3_600_000).toISOString()
  const result = await db.prepare(
    `SELECT l.id, l.inquiry_type, l.company, l.created_at FROM leads l
     WHERE l.created_at < ? AND l.created_at >= ?
       AND l.pipeline_status NOT IN ('archived', 'won', 'lost')
       AND NOT EXISTS (SELECT 1 FROM lead_activities a WHERE a.lead_id = l.id AND a.activity_type IN (${placeholders}))
     ORDER BY l.created_at ASC LIMIT 50`,
  ).bind(olderThan, notBefore, ...HUMAN_ACTIVITY).all()
  return (result.results || []).map((row) => ({ id: row.id, inquiryType: row.inquiry_type, company: row.company || '', receivedAt: row.created_at }))
}

/** site_settings key: `{ "enabled": true, "hours": 24 }` (defaults). */
export const INQUIRY_REMINDER_SETTINGS_KEY = 'inquiry_reminders'
export const DEFAULT_INQUIRY_REMINDERS = { enabled: true, hours: 24 }

export function resolveReminderSettings(stored) {
  const hours = Number(stored?.hours)
  return {
    enabled: stored?.enabled !== false,
    hours: Number.isInteger(hours) && hours >= 1 && hours <= 24 * 14 ? hours : DEFAULT_INQUIRY_REMINDERS.hours,
  }
}

/**
 * The daily reminder to the internal notification address. Never sent to a
 * visitor; nothing is sent when nothing is waiting.
 */
/**
 * @param {{ DB?: D1Database, LEAD_NOTIFICATION_EMAIL?: string }} env
 * @param {{ now: Date, provider: { isConfigured: boolean, send: Function }, getSetting: (key: string) => Promise<unknown>, adminBaseUrl?: string }} deps
 */
export async function sendUnansweredInquiryReminder(env, { now, provider, getSetting, adminBaseUrl = 'https://www.devlabstudios.com' }) {
  if (!env?.DB) return 'skipped: no database'
  const settings = resolveReminderSettings(await getSetting(INQUIRY_REMINDER_SETTINGS_KEY))
  if (!settings.enabled) return 'skipped: turned off in settings'
  const waiting = await listUnansweredInquiries(env.DB, { now, hours: settings.hours })
  if (!waiting.length) return 'nothing waiting'
  if (!provider.isConfigured) return `skipped: ${waiting.length} waiting, no email provider`
  const lines = waiting.map((lead) => `- ${lead.inquiryType}${lead.company ? ` · ${lead.company}` : ''} · received ${lead.receivedAt} · id ${lead.id}`)
  const text = [`${waiting.length} inquir${waiting.length === 1 ? 'y has' : 'ies have'} had no response for over ${settings.hours} hours:`, '', ...lines, '', `Open them in ${adminBaseUrl}/admin/leads`].join('\n')
  const result = await provider.send({
    to: env.LEAD_NOTIFICATION_EMAIL || 'hello@devlabstudios.com',
    subject: `${waiting.length} inquir${waiting.length === 1 ? 'y' : 'ies'} waiting for a reply`,
    text,
    html: `<pre>${text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])}</pre>`,
  })
  if (!result.ok) throw new Error(`reminder email failed: ${result.errorMessage || result.statusCode}`)
  return `sent: ${waiting.length} waiting`
}

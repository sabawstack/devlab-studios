/**
 * Scheduled-job bookkeeping (audit OPS-03).
 *
 * recordJobRun wraps one cron task: it writes a `job_runs` row when the task
 * starts and updates it when it ends, so a failure is visible in a table and
 * in the daily summary email rather than only in Workers logs. It never
 * rethrows: each cron task runs in its own waitUntil and one failing job must
 * not stop, delay or retry another.
 *
 * Bookkeeping is best-effort. Without a DB binding, or before migration 0019
 * is applied, the job still runs and the run is only logged.
 */

function newId() {
  return crypto.randomUUID()
}

function message(error) {
  return error instanceof Error ? error.message : String(error)
}

async function safeRun(db, sql, bindings) {
  if (!db) return false
  try {
    await db.prepare(sql).bind(...bindings).run()
    return true
  } catch (error) {
    console.log(JSON.stringify({ event: 'job_runs.write_failed', error: message(error) }))
    return false
  }
}

/**
 * @template T
 * @param {{ DB?: D1Database }} env
 * @param {string} job
 * @param {() => Promise<T>} task
 * @param {{ now?: () => Date }} [options]
 * @returns {Promise<T | undefined>}
 */
export async function recordJobRun(env, job, task, { now = () => new Date() } = {}) {
  const id = newId()
  const db = env?.DB
  await safeRun(
    db,
    "INSERT INTO job_runs (id, job, started_at, outcome, detail) VALUES (?, ?, ?, 'running', '')",
    [id, job, now().toISOString()],
  )

  try {
    const result = await task()
    const detail = typeof result === 'string' ? result : result === undefined ? '' : JSON.stringify(result)
    await safeRun(db, "UPDATE job_runs SET outcome = 'ok', finished_at = ?, detail = ? WHERE id = ?", [now().toISOString(), detail.slice(0, 500), id])
    console.log(JSON.stringify({ event: 'job_run', job, outcome: 'ok' }))
    return result
  } catch (error) {
    await safeRun(db, "UPDATE job_runs SET outcome = 'failed', finished_at = ?, detail = ? WHERE id = ?", [now().toISOString(), message(error).slice(0, 500), id])
    console.log(JSON.stringify({ event: 'job_run', job, outcome: 'failed', error: message(error) }))
    return undefined
  }
}

/**
 * @param {D1Database} db
 * @param {{ since: Date }} options
 */
export async function listFailedJobRuns(db, { since }) {
  const result = await db
    .prepare(
      `SELECT id, job, started_at, finished_at, detail FROM job_runs
       WHERE outcome = 'failed' AND started_at >= ?
       ORDER BY started_at DESC, id DESC
       LIMIT 50`,
    )
    .bind(since.toISOString())
    .all()
  return (result.results || []).map((row) => ({
    id: row.id,
    job: row.job,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    detail: row.detail,
  }))
}

/** A plain internal email; job names and error text only, never visitor data. */
export function buildFailedJobsSummary(failures) {
  const count = failures.length
  const lines = failures.map((run) => `- ${run.job} at ${run.startedAt}: ${run.detail || 'no detail'}`)
  return {
    subject: `${count} scheduled job${count === 1 ? '' : 's'} failed in the last 24 hours`,
    text: [
      'These scheduled jobs failed on www.devlabstudios.com in the last 24 hours:',
      '',
      ...lines,
      '',
      'Each run is in the job_runs table; Workers logs have the full error.',
    ].join('\n'),
  }
}

/** site_settings key: `{ "enabled": false }` turns the daily failure email off. */
export const JOB_SUMMARY_SETTINGS_KEY = 'job_failure_summary'

/**
 * Emails the owner a list of scheduled jobs that failed in the last 24 hours.
 * Sends nothing when none failed, when turned off in settings, or when no
 * email provider is configured. Internal only: the recipient is
 * LEAD_NOTIFICATION_EMAIL, never a visitor.
 *
 * @param {{ DB?: D1Database, LEAD_NOTIFICATION_EMAIL?: string }} env
 * @param {{ now: Date, provider: { isConfigured: boolean, send: Function }, getSetting: (key: string) => Promise<unknown> }} deps
 */
export async function sendFailedJobsSummary(env, { now, provider, getSetting }) {
  if (!env?.DB) return 'skipped: no database'
  const settings = await getSetting(JOB_SUMMARY_SETTINGS_KEY)
  if (settings && settings.enabled === false) return 'skipped: turned off in settings'
  const failures = await listFailedJobRuns(env.DB, { since: new Date(now.getTime() - 24 * 60 * 60 * 1000) })
  if (!failures.length) return 'no failures'
  if (!provider.isConfigured) return `skipped: ${failures.length} failure(s), no email provider`
  const summary = buildFailedJobsSummary(failures)
  const result = await provider.send({
    to: env.LEAD_NOTIFICATION_EMAIL || 'hello@devlabstudios.com',
    subject: summary.subject,
    text: summary.text,
    html: `<pre>${summary.text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])}</pre>`,
  })
  if (!result.ok) throw new Error(`summary email failed: ${result.errorMessage || result.statusCode}`)
  return `sent: ${failures.length} failure(s)`
}

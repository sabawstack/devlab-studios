import { readdirSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { createSqliteD1 } from '../repositories/pickleball/open/testing/sqliteD1'
import { buildFailedJobsSummary, listFailedJobRuns, recordJobRun } from './jobRuns.js'

const migrations = readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort().map((f) => `migrations/${f}`)
const before0019 = migrations.filter((f) => !f.includes('0019'))

describe('recordJobRun (OPS-03)', () => {
  it('records a successful run with its detail', async () => {
    const { d1, raw } = createSqliteD1(migrations)
    const result = await recordJobRun({ DB: d1 }, 'digest', async () => 'published 10 items', { now: () => new Date('2026-11-12T22:00:00Z') })
    expect(result).toBe('published 10 items')
    expect(raw.prepare('SELECT job, outcome, detail FROM job_runs').all()).toEqual([{ job: 'digest', outcome: 'ok', detail: 'published 10 items' }])
  })

  it('records a failure and does not rethrow, so one job never blocks another', async () => {
    const { d1, raw } = createSqliteD1(migrations)
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await recordJobRun({ DB: d1 }, 'purge', async () => { throw new Error('D1 busy') })
    expect(raw.prepare('SELECT outcome, detail FROM job_runs').get()).toEqual({ outcome: 'failed', detail: 'D1 busy' })
    log.mockRestore()
  })

  it('still runs the job when the table does not exist yet', async () => {
    const { d1 } = createSqliteD1(before0019)
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    expect(await recordJobRun({ DB: d1 }, 'digest', async () => 'done')).toBe('done')
    log.mockRestore()
  })

  it('runs the job without a database binding', async () => {
    expect(await recordJobRun({}, 'digest', async () => 'done')).toBe('done')
  })
})

describe('failed job summary', () => {
  it('lists failures in the last day only, newest first', async () => {
    const { d1, raw } = createSqliteD1(migrations)
    const insert = raw.prepare('INSERT INTO job_runs (id, job, started_at, finished_at, outcome, detail) VALUES (?, ?, ?, ?, ?, ?)')
    insert.run('a', 'digest', '2026-11-11T22:00:00.000Z', '2026-11-11T22:00:05.000Z', 'failed', 'feed timeout')
    insert.run('b', 'purge', '2026-11-12T22:00:00.000Z', '2026-11-12T22:00:01.000Z', 'failed', 'D1 busy')
    insert.run('c', 'digest', '2026-11-12T22:00:00.000Z', '2026-11-12T22:00:09.000Z', 'ok', '')
    insert.run('d', 'digest', '2026-11-10T22:00:00.000Z', '2026-11-10T22:00:09.000Z', 'failed', 'too old')
    const failures = await listFailedJobRuns(d1, { since: new Date('2026-11-11T21:00:00Z') })
    expect(failures.map((run) => run.id)).toEqual(['b', 'a'])
  })

  it('builds a plain internal summary with no visitor data', () => {
    const summary = buildFailedJobsSummary([{ job: 'purge', startedAt: '2026-11-12T22:00:00.000Z', detail: 'D1 busy' }])
    expect(summary.subject).toMatch(/1 scheduled job failed/)
    expect(summary.text).toContain('purge')
    expect(summary.text).toContain('D1 busy')
  })
})

describe('sendFailedJobsSummary', async () => {
  const { sendFailedJobsSummary } = await import('./jobRuns.js')
  const now = new Date('2026-11-12T22:00:00Z')

  function dbWithFailure() {
    const { d1, raw } = createSqliteD1(migrations)
    raw.prepare("INSERT INTO job_runs (id, job, started_at, outcome, detail) VALUES ('x', 'purge', '2026-11-12T10:00:00.000Z', 'failed', 'D1 busy')").run()
    return d1
  }

  it('emails the internal address when something failed', async () => {
    const send = vi.fn(async () => ({ ok: true }))
    const result = await sendFailedJobsSummary(
      { DB: dbWithFailure(), LEAD_NOTIFICATION_EMAIL: 'ops@example.com' },
      { now, provider: { isConfigured: true, send }, getSetting: async () => null },
    )
    expect(result).toBe('sent: 1 failure(s)')
    expect(send.mock.calls[0][0]).toMatchObject({ to: 'ops@example.com', subject: expect.stringMatching(/1 scheduled job failed/) })
  })

  it('sends nothing when nothing failed or when turned off', async () => {
    const send = vi.fn()
    const { d1 } = createSqliteD1(migrations)
    expect(await sendFailedJobsSummary({ DB: d1 }, { now, provider: { isConfigured: true, send }, getSetting: async () => null })).toBe('no failures')
    expect(await sendFailedJobsSummary({ DB: dbWithFailure() }, { now, provider: { isConfigured: true, send }, getSetting: async () => ({ enabled: false }) }))
      .toMatch(/turned off/)
    expect(send).not.toHaveBeenCalled()
  })
})

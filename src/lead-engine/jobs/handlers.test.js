import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { JOB_HANDLERS, RETIRED_JOB_TYPES, runJob } from './handlers.js'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../../..')

function dbThatFailsAfterFlagRead(error) {
  return {
    prepare(sql) {
      if (sql.includes('FROM lead_settings')) {
        return {
          bind: () => ({
            first: async () => ({
              value_json: JSON.stringify({
                engine: true,
                crawler: true,
              }),
            }),
          }),
        }
      }
      throw error
    },
  }
}

describe('runJob', () => {
  it('refuses an unknown job type permanently rather than retrying it forever', () => {
    return runJob({}, { jobType: 'not_a_real_job', payload: {} }).then((outcome) => {
      expect(outcome.ok).toBe(false)
      expect(outcome.retryable).toBe(false)
    })
  })

  it('never throws — the runner needs a decision for every job', async () => {
    const env = { DB: null }
    await expect(runJob(env, { jobType: 'lead_research', payload: { leadId: 'x' } })).resolves.toMatchObject({
      ok: false,
    })
  })

  it('classifies a disabled feature as permanent', async () => {
    // Retrying a job whose feature flag is off just burns attempts until it
    // dead-letters with a misleading error. A human has to turn the flag on.
    const outcome = await runJob({}, { jobType: 'lead_research', payload: { leadId: 'x' } })
    expect(outcome.ok).toBe(false)
    expect(outcome.retryable).toBe(false)
    expect(outcome.error).toMatch(/LEAD_ENGINE_ENABLED|disabled/i)
  })

  it('classifies a transient failure as retryable', async () => {
    const env = {
      LEAD_ENGINE_ENABLED: 'true',
      LEAD_CRAWLER_ENABLED: 'true',
      DB: dbThatFailsAfterFlagRead(Object.assign(new Error('D1 unavailable'), { status: 503 })),
    }

    const outcome = await runJob(env, { jobType: 'lead_research', payload: { leadId: 'x' } })
    expect(outcome.ok).toBe(false)
    expect(outcome.retryable).toBe(true)
  })

  it('classifies a 4xx as permanent, because retrying repeats the same mistake', async () => {
    const env = {
      LEAD_ENGINE_ENABLED: 'true',
      LEAD_CRAWLER_ENABLED: 'true',
      DB: dbThatFailsAfterFlagRead(Object.assign(new Error('bad request'), { status: 422 })),
    }

    const outcome = await runJob(env, { jobType: 'lead_research', payload: { leadId: 'x' } })
    expect(outcome.retryable).toBe(false)
  })

  it('classifies a 429 as retryable even though it is a 4xx', async () => {
    const env = {
      LEAD_ENGINE_ENABLED: 'true',
      LEAD_CRAWLER_ENABLED: 'true',
      DB: dbThatFailsAfterFlagRead(Object.assign(new Error('slow down'), { status: 429 })),
    }

    expect((await runJob(env, { jobType: 'lead_research', payload: { leadId: 'x' } })).retryable).toBe(true)
  })

  it('classifies a 401 as permanent — a credential problem needs a human', async () => {
    const env = {
      LEAD_ENGINE_ENABLED: 'true',
      LEAD_CRAWLER_ENABLED: 'true',
      DB: dbThatFailsAfterFlagRead(Object.assign(new Error('unauthorized'), { status: 401 })),
    }

    expect((await runJob(env, { jobType: 'lead_research', payload: { leadId: 'x' } })).retryable).toBe(false)
  })

  it('respects an explicit retryable:false on the error', async () => {
    const env = {
      LEAD_ENGINE_ENABLED: 'true',
      LEAD_CRAWLER_ENABLED: 'true',
      DB: dbThatFailsAfterFlagRead(Object.assign(new Error('permanent'), { retryable: false })),
    }

    expect((await runJob(env, { jobType: 'lead_research', payload: { leadId: 'x' } })).retryable).toBe(false)
  })
})

describe('job handler coverage', () => {
  it('has a handler for every job type the schema allows', () => {
    // A job type the database accepts but no handler serves would be enqueued,
    // claimed, and dead-lettered with "no handler" — silently losing the work.
    const migration = readFileSync(resolve(repoRoot, 'migrations/0012_lead_intelligence_engine.sql'), 'utf8')

    const checkBlock = migration.slice(
      migration.indexOf('job_type TEXT NOT NULL CHECK (job_type IN ('),
      migration.indexOf("status TEXT NOT NULL DEFAULT 'pending'\n    CHECK (status IN ('pending', 'running'"),
    )

    const inSchema = new Set([...checkBlock.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]))

    expect(inSchema.size).toBeGreaterThan(0)
    // Served OR explicitly retired. A type that is merely missing still fails
    // here; one that was deliberately removed has to be declared as such, so
    // "we deleted the handler" cannot pass as "we thought about it".
    const accounted = new Set([...Object.keys(JOB_HANDLERS), ...Object.keys(RETIRED_JOB_TYPES)])

    expect(accounted).toEqual(inSchema)
  })

  it('dead-letters a retired job type with a reason, not a generic "no handler"', async () => {
    const result = await runJob({ DB: null }, { jobType: 'mailbox_sync', payload: {} })

    expect(result.ok).toBe(false)
    expect(result.retryable).toBe(false)
    expect(result.error).toMatch(/exported for manual sending/i)
  })
})

describe('admin API coverage', () => {
  /**
   * The Lead CRM routes do NOT check authentication individually — every path
   * under `/api/admin/` is gated by `requireAdmin` in src/middleware.ts before
   * the route module runs. That is the correct design (one gate, no drift), but
   * it only holds while the middleware actually covers the prefix, so the
   * assumption is asserted rather than assumed.
   */
  it('routes the Lead CRM API through the existing admin gate', () => {
    const middleware = readFileSync(resolve(repoRoot, 'src/middleware.ts'), 'utf8')

    // The gate must run on the decoded routing path, not the raw pathname:
    // `/api/%61dmin/...` once skipped a raw-path check and reached the route.
    expect(middleware).toContain('const path = routePath(url.pathname)')
    expect(middleware).toContain('isAdminApiPath(path) && !ADMIN_PUBLIC_ROUTES.has(path)')
    expect(middleware).toContain('requireAdmin')

    // And that nothing under lead-crm was added to the unauthenticated list.
    const publicRoutes = middleware.slice(
      middleware.indexOf('const ADMIN_PUBLIC_ROUTES'),
      middleware.indexOf('const MAINTENANCE_PAGE'),
    )
    expect(publicRoutes).not.toMatch(/lead-crm/)
  })
})

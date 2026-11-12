import { readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { createTestD1 } from '../../worker/repositories/testSupport/d1Sqlite.js'
import { USAGE_LIMITS } from '../config/defaults.js'
import { consumeBudget } from './usage.js'

/**
 * The schema and the code have to agree about their shared vocabularies.
 *
 * TWICE now a CHECK constraint has silently discarded a value the code was
 * confident about, because the write went through `INSERT OR IGNORE`:
 *
 *   lead_sources.type       rejected 'osm_nominatim' -> one of four seeded
 *                           sources simply never existed
 *   lead_usage_daily.metric rejected 'nominatim_requests' -> the counter row
 *                           was never created, so the conditional UPDATE that
 *                           reserves budget matched nothing and every discovery
 *                           run reported `daily_request_budget_exhausted` on a
 *                           database with zero recorded usage
 *
 * Neither raised an error. Both produced valid SQL, an exit code of zero, and a
 * feature that quietly did nothing. `OR IGNORE` is correct for both call sites
 * - a re-run seed and a get-or-create counter - which is precisely why the
 * constraint has to be checked somewhere else, and why asserting on the
 * migration TEXT would not do it. These tests exercise the real code against
 * the real schema and look at what survived.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsDir = resolve(here, '../../../migrations')

/**
 * Every CMS-database migration, in file order, as they are applied for real.
 * (Not only the lead engine's own: a later migration may alter an earlier
 * table -- 0018 adds columns to projects -- so a subset no longer applies.)
 */
const leadMigrations = readdirSync(migrationsDir)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => readFileSync(resolve(migrationsDir, name), 'utf8'))

let db

beforeAll(() => {
  db = createTestD1(leadMigrations)
})

describe('schema and code agree on their shared vocabularies', () => {
  it('admits a counter for every metric the engine budgets', async () => {
    // Driven through consumeBudget rather than a raw INSERT, so it fails the
    // same way the engine would: not with a constraint error, but with a
    // reservation that refuses on an empty counter.
    for (const metric of Object.keys(USAGE_LIMITS)) {
      const result = await consumeBudget(db, metric, { limits: USAGE_LIMITS })

      expect(
        result.allowed,
        `lead_usage_daily.metric rejects '${metric}', so its budget can never be reserved`,
      ).toBe(true)
    }
  })

  it('records what it consumed, rather than silently counting nothing', async () => {
    // The failure mode being guarded against returns used: 0 forever. A metric
    // that reserves but never increments would exhaust nothing and bound
    // nothing, which is the opposite failure and just as invisible.
    const fresh = createTestD1(leadMigrations)

    const first = await consumeBudget(fresh, 'nominatim_requests', { limits: USAGE_LIMITS })
    const second = await consumeBudget(fresh, 'nominatim_requests', { limits: USAGE_LIMITS })

    expect(first.allowed).toBe(true)
    expect(second.allowed).toBe(true)
    expect(second.used).toBe(2)
  })

  it('still refuses once a metric is genuinely exhausted', async () => {
    // Proves the widened CHECK did not weaken the limit it guards.
    const fresh = createTestD1(leadMigrations)
    const limits = { nominatim_requests: 2 }

    expect((await consumeBudget(fresh, 'nominatim_requests', { limits })).allowed).toBe(true)
    expect((await consumeBudget(fresh, 'nominatim_requests', { limits })).allowed).toBe(true)
    expect((await consumeBudget(fresh, 'nominatim_requests', { limits })).allowed).toBe(false)
  })

  it('admits every source type the seed registers', async () => {
    const seed = readFileSync(resolve(here, '../../../scripts/lead-engine/seed.sql'), 'utf8')
    const fresh = createTestD1([...leadMigrations, seed])

    const rows = await fresh.prepare('SELECT slug FROM lead_sources').all()
    const slugs = rows.results.map((row) => row.slug).sort()

    // The exact list matters more than the count: a dropped row and a renamed
    // one look identical to a count assertion.
    expect(slugs).toEqual(['brave-search', 'manual-import', 'osm-nominatim', 'osm-overpass'])
  })
})

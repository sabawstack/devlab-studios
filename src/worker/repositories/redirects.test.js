import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import { createTestD1 } from './testSupport/d1Sqlite.js'
import { findRedirect, redirectCandidates, upsertRedirect } from './redirects.js'

// Only the table, copied from migrations/0004_content_model_v2.sql: the rest of
// that migration builds content tables these tests do not touch.
const MIGRATION = readFileSync(new URL('../../../migrations/0004_content_model_v2.sql', import.meta.url), 'utf8')
const REDIRECTS_DDL = MIGRATION.slice(MIGRATION.indexOf('CREATE TABLE IF NOT EXISTS redirects'), MIGRATION.indexOf(');', MIGRATION.indexOf('CREATE TABLE IF NOT EXISTS redirects')) + 2)

describe('redirectCandidates', () => {
  it('lists the path, then each parent wildcard, deepest first', () => {
    expect(redirectCandidates('/pickleball/live/ABCDE23456/display')).toEqual([
      '/pickleball/live/ABCDE23456/display',
      '/pickleball/live/ABCDE23456/*',
      '/pickleball/live/*',
      '/pickleball/*',
    ])
  })

  it('tries the path without its trailing slash, and never offers a root wildcard', () => {
    expect(redirectCandidates('/pickleball/app/')).toEqual(['/pickleball/app/', '/pickleball/app', '/pickleball/*'])
    expect(redirectCandidates('/pickleball')).toEqual(['/pickleball'])
    expect(redirectCandidates('/')).toEqual(['/'])
  })

  it('stops at twelve levels of wildcards', () => {
    const deep = `/${Array.from({ length: 30 }, (_, i) => `s${i}`).join('/')}`
    expect(redirectCandidates(deep).filter((path) => path.endsWith('/*'))).toHaveLength(12)
  })
})

describe('findRedirect', () => {
  let db

  beforeEach(async () => {
    db = createTestD1([REDIRECTS_DDL])
    await upsertRedirect(db, { fromPath: '/pickleball/app', toPath: '/pickleball/new' })
    await upsertRedirect(db, { fromPath: '/pickleball/app/*', toPath: '/pickleball/new' })
    await upsertRedirect(db, { fromPath: '/pickleball/live/*', toPath: '/pickleball' })
    await upsertRedirect(db, { fromPath: '/pickleball/live/KEEP/*', toPath: '/pickleball/s/KEEP' })
  })

  it('an exact row answers its own path', async () => {
    expect((await findRedirect(db, '/pickleball/app'))?.toPath).toBe('/pickleball/new')
  })

  it('a wildcard row answers every path below its prefix, but not the prefix', async () => {
    expect((await findRedirect(db, '/pickleball/live/ABCDE23456'))?.toPath).toBe('/pickleball')
    expect((await findRedirect(db, '/pickleball/live/ABCDE23456/display'))?.toPath).toBe('/pickleball')
    expect((await findRedirect(db, '/pickleball/app/sessions/123'))?.toPath).toBe('/pickleball/new')
    expect(await findRedirect(db, '/pickleball/live')).toBeNull()
  })

  it('the longest wildcard wins, and an exact row beats any wildcard', async () => {
    expect((await findRedirect(db, '/pickleball/live/KEEP/display'))?.toPath).toBe('/pickleball/s/KEEP')
    await upsertRedirect(db, { fromPath: '/pickleball/live/A', toPath: '/exact' })
    expect((await findRedirect(db, '/pickleball/live/A'))?.toPath).toBe('/exact')
  })

  it('a path no row covers finds nothing', async () => {
    expect(await findRedirect(db, '/pickleball/new')).toBeNull()
    expect(await findRedirect(db, '/elsewhere/live/x')).toBeNull()
  })

  it('saving a wildcard row returns that row', async () => {
    const saved = await upsertRedirect(db, { fromPath: '/pickleball/accept-invite/*', toPath: '/pickleball', note: 'x' })
    expect(saved).toMatchObject({ fromPath: '/pickleball/accept-invite/*', toPath: '/pickleball', statusCode: 301 })
  })
})

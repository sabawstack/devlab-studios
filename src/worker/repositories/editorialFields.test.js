import { readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createSqliteD1 } from './pickleball/open/testing/sqliteD1'
import { getProject, listProjects, upsertProject } from './projects.js'

// CMS-03: the editorial columns from migrations/0018 are optional at runtime.
// The code ships before the migration reaches every database, so it must work
// on both, and must refuse (not silently drop) editorial values it cannot store.
const CMS_MIGRATIONS = readdirSync('migrations').filter((file) => file.endsWith('.sql')).sort()
const before0018 = CMS_MIGRATIONS.filter((file) => file < '0018').map((file) => `migrations/${file}`)
const through0018 = CMS_MIGRATIONS.filter((file) => file <= '0018_editorial_fields.sql').map((file) => `migrations/${file}`)

const baseProject = { id: 'p-intake', title: 'Lead intake system', description: 'Persist-first intake.', type: 'Automation', status: 'published' }

describe('projects on a database WITHOUT migration 0018', () => {
  it('saves and lists a project exactly as before, with empty editorial fields', async () => {
    const { d1 } = createSqliteD1(before0018)
    await upsertProject(d1, baseProject)
    const [project] = await listProjects(d1)
    expect(project).toMatchObject({ id: 'p-intake', slug: '', clientType: '', outcomeStatements: [], systemDiagramId: '', evidenceNote: '' })
  })

  it('refuses editorial values it cannot store, naming the migration', async () => {
    const { d1 } = createSqliteD1(before0018)
    await expect(upsertProject(d1, { ...baseProject, outcomeStatements: ['Every inquiry has an owner'] }))
      .rejects.toMatchObject({ status: 409, message: expect.stringMatching(/0018_editorial_fields.*outcome_statements_json/) })
    expect(await listProjects(d1, { includeDrafts: true })).toHaveLength(0)
  })
})

describe('projects on a database WITH migration 0018', () => {
  it('stores and reads back every editorial field', async () => {
    const { d1 } = createSqliteD1(through0018)
    await upsertProject(d1, {
      ...baseProject,
      slug: 'Lead Intake System!',
      clientType: 'client',
      outcomeStatements: ['Every inquiry has an owner', '  ', 'Failures are visible', 'Retries are one click', 'a fourth is dropped'],
      systemDiagramId: 'build-in-layers',
      evidenceNote: 'Screenshots use synthetic data.',
    })
    const project = await getProject(d1, 'p-intake')
    expect(project).toMatchObject({
      slug: 'lead-intake-system',
      clientType: 'client',
      outcomeStatements: ['Every inquiry has an owner', 'Failures are visible', 'Retries are one click'],
      systemDiagramId: 'build-in-layers',
      evidenceNote: 'Screenshots use synthetic data.',
    })
  })

  it('updates in place and keeps slugs unique', async () => {
    const { d1 } = createSqliteD1(through0018)
    await upsertProject(d1, { ...baseProject, slug: 'intake' })
    await upsertProject(d1, { ...baseProject, title: 'Renamed', slug: 'intake' })
    expect((await getProject(d1, 'p-intake')).title).toBe('Renamed')
    await expect(upsertProject(d1, { ...baseProject, id: 'p-other', slug: 'intake' })).rejects.toMatchObject({ status: 409 })
  })

  it('allows any number of projects without a slug', async () => {
    const { d1 } = createSqliteD1(through0018)
    await upsertProject(d1, baseProject)
    await upsertProject(d1, { ...baseProject, id: 'p-two' })
    expect(await listProjects(d1)).toHaveLength(2)
  })
})

describe('articles and SEO records, with and without migration 0018', async () => {
  const { listResources, replaceResources, listSeoMetadata, replaceSeoMetadata } = await import('./content.js')
  const article = { slug: 'silent-failures', title: 'The cost of a silent failure', summary: 'S', body: 'B', status: 'published' }
  const editorial = { audience: 'owner', problemTag: 'silent-failures', heroVisualId: 'persist-before-deliver', seoTitle: 'Silent failures', seoDescription: 'Why', ogVariant: 'article' }

  it('articles: saved and listed as before on an unmigrated database', async () => {
    const { d1 } = createSqliteD1(before0018)
    await replaceResources(d1, [article])
    const [saved] = await listResources(d1)
    expect(saved).toMatchObject({ slug: 'silent-failures', audience: '', problemTag: '', ogVariant: '' })
  })

  it('articles: editorial values are refused on an unmigrated database, and nothing is deleted', async () => {
    const { d1 } = createSqliteD1(before0018)
    await replaceResources(d1, [article])
    await expect(replaceResources(d1, [{ ...article, ...editorial }])).rejects.toMatchObject({ status: 409 })
    expect(await listResources(d1)).toHaveLength(1)
  })

  it('articles: editorial values round-trip on a migrated database', async () => {
    const { d1 } = createSqliteD1(through0018)
    await replaceResources(d1, [{ ...article, ...editorial }])
    expect((await listResources(d1))[0]).toMatchObject(editorial)
  })

  it('SEO: the social-card variant round-trips when migrated and is refused when not', async () => {
    const record = { pageSlug: 'home', metaTitle: 'DevLab Studios', metaDescription: 'D', ogImageVariant: 'default' }
    const migrated = createSqliteD1(through0018).d1
    await replaceSeoMetadata(migrated, [record])
    expect((await listSeoMetadata(migrated))[0].ogImageVariant).toBe('default')

    const unmigrated = createSqliteD1(before0018).d1
    await replaceSeoMetadata(unmigrated, [{ ...record, ogImageVariant: '' }])
    expect((await listSeoMetadata(unmigrated))[0].ogImageVariant).toBe('')
    await expect(replaceSeoMetadata(unmigrated, [record])).rejects.toMatchObject({ status: 409 })
  })
})

// CMS-01: the write-up fields from migrations/0020 (spec K.2) follow the same
// rule: optional at runtime, refused (not dropped) on a database without them.
const before0020 = CMS_MIGRATIONS.filter((file) => file < '0020').map((file) => `migrations/${file}`)
const through0020 = CMS_MIGRATIONS.filter((file) => file <= '0020_writeup_fields.sql').map((file) => `migrations/${file}`)

describe('write-up fields (migration 0020)', () => {
  it('exists as an additive migration', () => {
    expect(CMS_MIGRATIONS).toContain('0020_writeup_fields.sql')
  })

  it('on a database without 0020, lists projects with empty write-up fields', async () => {
    const { d1 } = createSqliteD1(before0020)
    await upsertProject(d1, baseProject)
    const [project] = await listProjects(d1)
    expect(project).toMatchObject({ situation: '', decisions: [], scope: '', inOperationSince: '' })
  })

  it('on a database without 0020, refuses write-up values and names the migration', async () => {
    const { d1 } = createSqliteD1(before0020)
    await expect(upsertProject(d1, { ...baseProject, scope: 'We built the intake; the client runs the CRM.' }))
      .rejects.toMatchObject({ status: 409, message: expect.stringMatching(/0020_writeup_fields.*scope/) })
  })

  it('with 0020, stores and reads back every write-up field, trimmed and capped', async () => {
    const { d1 } = createSqliteD1(through0020)
    await upsertProject(d1, {
      ...baseProject,
      situation: '  A property firm taking leads from four sources.  ',
      decisions: ['Rules route; AI only drafts', ' ', 'A sheet, not a CRM', 'Calls are logged', 'Retries are visible', 'a fifth is dropped'],
      scope: 'DevLab built the intake and the call flow; the client owns the sheet.',
      inOperationSince: '2026-04',
    })
    expect(await getProject(d1, 'p-intake')).toMatchObject({
      situation: 'A property firm taking leads from four sources.',
      decisions: ['Rules route; AI only drafts', 'A sheet, not a CRM', 'Calls are logged', 'Retries are visible'],
      scope: 'DevLab built the intake and the call flow; the client owns the sheet.',
      inOperationSince: '2026-04',
    })
  })

  it('with 0020, keeps the 0018 fields working alongside', async () => {
    const { d1 } = createSqliteD1(through0020)
    await upsertProject(d1, { ...baseProject, systemDiagramId: 'diagram-lead-qualification', scope: 'Scope.' })
    expect(await getProject(d1, 'p-intake')).toMatchObject({ systemDiagramId: 'diagram-lead-qualification', scope: 'Scope.' })
  })
})

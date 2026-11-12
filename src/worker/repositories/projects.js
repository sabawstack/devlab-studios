import { nowIso, parseJsonField } from '../utils/responses'
import { deleteMediaAssetByKey, deleteMediaAssetByUrl, findMediaReferences } from './mediaAssets.js'
import { missingMigrationError, tableColumns } from './columns.js'

/**
 * Editorial columns added by migrations/0018_editorial_fields.sql (CMS-03),
 * with the value each holds when unset. Read and written only when the
 * database has them; see ./columns.js.
 */
const EDITORIAL_COLUMNS = {
  slug: null,
  client_type: '',
  outcome_statements_json: '[]',
  system_diagram_id: '',
  evidence_note: '',
}

function isMissingGalleryTableError(error) {
  return /no such table:\s*project_gallery_images/i.test(String(error?.message || ''))
}

function toGalleryImage(row) {
  return {
    id: row.id,
    url: row.url,
    filename: row.filename || '',
    altText: row.alt_text || '',
    sortOrder: Number(row.sort_order) || 0,
    isThumbnail: Boolean(row.is_thumbnail),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function toProject(row, galleryImages = []) {
  if (!row) return null

  return {
    id: row.id,
    title: row.title,
    description: row.description,
    techStack: parseJsonField(row.tech_stack, []),
    liveUrl: row.live_url || '#',
    sourceUrl: row.source_url || '#',
    imageUrl: row.image_url || '',
    imageFilename: row.image_filename || '',
    galleryImages,
    type: row.type,
    sortOrder: row.sort_order,
    status: row.status,
    slug: row.slug || '',
    clientType: row.client_type || '',
    outcomeStatements: parseJsonField(row.outcome_statements_json, []),
    systemDiagramId: row.system_diagram_id || '',
    evidenceNote: row.evidence_note || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function normalizeSlug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function normalizeGalleryImages(input) {
  if (!Array.isArray(input)) return []

  return input
    .map((item, index) => ({
      id: String(item?.id || crypto.randomUUID()).trim(),
      url: String(item?.url || '').trim(),
      filename: String(item?.filename || '').trim(),
      altText: String(item?.altText || '').trim(),
      sortOrder: Number.isFinite(Number(item?.sortOrder)) ? Number(item.sortOrder) : index + 1,
      isThumbnail: Boolean(item?.isThumbnail),
    }))
    .filter((item) => item.url)
}

export function deriveThumbnailFields(normalizedImages) {
  const thumbnail = normalizedImages.find((image) => image.isThumbnail)
  return {
    imageUrl: thumbnail?.url || '',
    imageFilename: thumbnail?.filename || '',
  }
}

export function diffRemovedGalleryUrls(previousUrls, nextUrls) {
  const nextSet = new Set(nextUrls)
  return [...new Set(previousUrls)].filter((url) => !nextSet.has(url))
}

export function toDbProject(input) {
  return {
    id: String(input.id || '').trim(),
    title: String(input.title || '').trim(),
    description: String(input.description || '').trim(),
    tech_stack: JSON.stringify(Array.isArray(input.techStack) ? input.techStack : []),
    live_url: String(input.liveUrl || '#').trim() || '#',
    source_url: String(input.sourceUrl || '#').trim() || '#',
    image_url: String(input.imageUrl || '').trim(),
    image_filename: String(input.imageFilename || '').trim(),
    type: String(input.type || '').trim(),
    sort_order: Number.isFinite(Number(input.sortOrder)) ? Number(input.sortOrder) : 999,
    // The projects table accepts only 'draft' and 'published'; 'archived' means
    // "not public", so it is stored as a draft, never as published.
    status: input.status === 'draft' || input.status === 'archived' ? 'draft' : 'published',
    slug: normalizeSlug(input.slug) || null,
    client_type: String(input.clientType || '').trim(),
    outcome_statements_json: JSON.stringify(
      (Array.isArray(input.outcomeStatements) ? input.outcomeStatements : [])
        .map((statement) => String(statement || '').trim())
        .filter(Boolean)
        .slice(0, 3),
    ),
    system_diagram_id: String(input.systemDiagramId || '').trim(),
    evidence_note: String(input.evidenceNote || '').trim(),
  }
}

async function listGalleryImagesForProjects(db, projectIds) {
  if (!projectIds.length) return new Map()

  try {
    const placeholders = projectIds.map(() => '?').join(', ')
    const result = await db
      .prepare(
        `SELECT id, project_id, url, filename, alt_text, sort_order, is_thumbnail, created_at, updated_at
         FROM project_gallery_images
         WHERE project_id IN (${placeholders})
         ORDER BY project_id ASC, sort_order ASC, created_at ASC`,
      )
      .bind(...projectIds)
      .all()

    const byProjectId = new Map()
    for (const row of result.results || []) {
      const item = toGalleryImage(row)
      const current = byProjectId.get(row.project_id) || []
      current.push(item)
      byProjectId.set(row.project_id, current)
    }

    return byProjectId
  } catch (error) {
    if (isMissingGalleryTableError(error)) return new Map()
    throw error
  }
}

async function listGalleryImagesForProject(db, projectId) {
  const byProjectId = await listGalleryImagesForProjects(db, [projectId])
  return byProjectId.get(projectId) || []
}

export async function listProjects(db, { includeDrafts = false } = {}) {
  const where = includeDrafts ? '' : "WHERE status = 'published'"
  const result = await db
    .prepare(
      // SELECT * so the editorial columns are read when this database has them.
      `SELECT *
       FROM projects
       ${where}
       ORDER BY sort_order ASC, updated_at DESC`,
    )
    .all()

  const rows = result.results || []
  const galleryByProjectId = await listGalleryImagesForProjects(
    db,
    rows.map((row) => row.id),
  )

  return rows.map((row) => toProject(row, galleryByProjectId.get(row.id) || []))
}

export async function getProject(db, id, { includeDrafts = false } = {}) {
  const row = await db
    .prepare(
      `SELECT *
       FROM projects
       WHERE id = ? ${includeDrafts ? '' : "AND status = 'published'"}`,
    )
    .bind(id)
    .first()

  const galleryImages = row ? await listGalleryImagesForProject(db, row.id) : []
  return toProject(row, galleryImages)
}

/**
 * Runs the delete + every insert as a single db.batch() transaction —
 * see repositories/testimonials.js's replaceTestimonials for why a bare
 * DELETE followed by a sequential .run() loop is unsafe on D1.
 */
async function syncProjectGallery(db, projectId, normalizedImages) {
  try {
    const timestamp = nowIso()
    const statements = [db.prepare('DELETE FROM project_gallery_images WHERE project_id = ?').bind(projectId)]

    for (const image of normalizedImages) {
      statements.push(
        db
          .prepare(
            `INSERT INTO project_gallery_images (
              id, project_id, url, filename, alt_text, sort_order, is_thumbnail, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            image.id,
            projectId,
            image.url,
            image.filename,
            image.altText,
            image.sortOrder,
            image.isThumbnail ? 1 : 0,
            timestamp,
            timestamp,
          ),
      )
    }

    await db.batch(statements)
  } catch (error) {
    if (isMissingGalleryTableError(error) && normalizedImages.length === 0) return
    if (isMissingGalleryTableError(error)) {
      const migrationError = new Error('Project gallery migration is missing. Apply migrations/0002_project_gallery_images.sql first.')
      migrationError.status = 503
      throw migrationError
    }
    throw error
  }
}

async function cleanupOrphanedGalleryImages(db, env, removedUrls) {
  const mediaBucket = env?.MEDIA_BUCKET
  if (!mediaBucket || !removedUrls.length) return

  await Promise.all(removedUrls.map(async (url) => {
    const trackedAsset = await db.prepare('SELECT key FROM media_assets WHERE url = ?').bind(url).first()
    const candidates = trackedAsset?.key ? [url, trackedAsset.key] : [url]
    const stillReferenced = await findMediaReferences(db, candidates)
    if (stillReferenced.length) return
    if (trackedAsset?.key) {
      await deleteMediaAssetByKey(db, mediaBucket, trackedAsset.key)
    } else {
      await deleteMediaAssetByUrl(db, mediaBucket, url)
    }
  }))
}

export async function upsertProject(db, input, env = {}) {
  const trimmedId = String(input.id || '').trim()
  const before = trimmedId ? await getProject(db, trimmedId, { includeDrafts: true }) : null
  const previousGalleryUrls = before ? before.galleryImages.map((image) => image.url) : []

  const normalizedImages = normalizeGalleryImages(input.galleryImages)
  const derived = deriveThumbnailFields(normalizedImages)
  const hasThumbnail = Boolean(derived.imageUrl)
  const imageUrl = hasThumbnail ? derived.imageUrl : String(input.imageUrl || '').trim()
  const imageFilename = hasThumbnail ? derived.imageFilename : String(input.imageFilename || '').trim()

  const project = toDbProject({ ...input, imageUrl, imageFilename })
  const timestamp = nowIso()

  if (!project.id || !project.title || !project.description || !project.type) {
    const error = new Error('Project id, title, description, and type are required.')
    error.status = 400
    throw error
  }

  const available = await tableColumns(db, 'projects')
  const editorial = Object.keys(EDITORIAL_COLUMNS).filter((column) => available.has(column))
  const unsaved = Object.keys(EDITORIAL_COLUMNS).filter(
    (column) => !available.has(column) && (project[column] ?? null) !== EDITORIAL_COLUMNS[column],
  )
  if (unsaved.length) throw missingMigrationError('0018_editorial_fields', unsaved)

  const columns = [
    'id', 'title', 'description', 'tech_stack', 'live_url', 'source_url', 'image_url', 'image_filename', 'type', 'sort_order', 'status',
    ...editorial,
  ]
  const updates = columns.filter((column) => column !== 'id').map((column) => `${column} = excluded.${column}`)
  await db
    .prepare(
      `INSERT INTO projects (${columns.join(', ')}, created_at, updated_at)
       VALUES (${columns.map(() => '?').join(', ')}, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         ${updates.join(',\n         ')},
         updated_at = excluded.updated_at`,
    )
    .bind(...columns.map((column) => project[column]), timestamp, timestamp)
    .run()
    .catch((error) => {
      if (/UNIQUE constraint failed: projects\.slug/i.test(String(error?.message || ''))) {
        const conflict = new Error(`Another project already uses the address "${project.slug}". Choose a different slug.`)
        conflict.status = 409
        throw conflict
      }
      throw error
    })

  await syncProjectGallery(db, project.id, normalizedImages)

  const nextGalleryUrls = normalizedImages.map((image) => image.url)
  const removedUrls = diffRemovedGalleryUrls(previousGalleryUrls, nextGalleryUrls)

  try {
    await cleanupOrphanedGalleryImages(db, env, removedUrls)
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'project_gallery_cleanup',
        outcome: 'failure',
        projectId: project.id,
        errorMessage: error instanceof Error ? error.message : String(error),
      }),
    )
  }

  return getProject(db, project.id, { includeDrafts: true })
}

export async function deleteProject(db, id, env = {}) {
  const existing = await getProject(db, id, { includeDrafts: true })
  const galleryUrls = [...new Set(existing ? existing.galleryImages.map((image) => image.url) : [])]

  try {
    await db.batch([
      db.prepare('DELETE FROM project_gallery_images WHERE project_id = ?').bind(id),
      db.prepare('DELETE FROM projects WHERE id = ?').bind(id),
    ])
  } catch (error) {
    if (!isMissingGalleryTableError(error)) throw error
    await db.prepare('DELETE FROM projects WHERE id = ?').bind(id).run()
  }

  if (galleryUrls.length) {
    try {
      await cleanupOrphanedGalleryImages(db, env, galleryUrls)
    } catch (error) {
      console.error(
        JSON.stringify({
          event: 'project_delete_cleanup',
          outcome: 'failure',
          projectId: id,
          errorMessage: error instanceof Error ? error.message : String(error),
        }),
      )
    }
  }

  return { id }
}

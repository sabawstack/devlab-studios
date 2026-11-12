import { nowIso, parseJsonField } from '../utils/responses'

/**
 * Block-composed singleton pages (Home, About, Process, Work). Backed by the
 * `pages`/`page_sections` tables from migrations/0001_cms_foundation.sql,
 * which were created early on for exactly this purpose but never wired up
 * until now — `section_type` is the block type, `content_json` is its
 * validated props (see src/lib/schemas/blocks.ts).
 */

function normalizeString(value) {
  return String(value || '').trim()
}

// The pages and page_sections tables accept only 'draft' and 'published';
// anything meaning "not public" is stored as a draft.
export function normalizeStatus(value) {
  return value === 'draft' || value === 'archived' ? 'draft' : 'published'
}

async function getPageRow(db, slug) {
  return db.prepare('SELECT id, slug, title, status, created_at, updated_at FROM pages WHERE slug = ?').bind(slug).first()
}

async function listSectionsForPage(db, pageId, { includeDrafts = false } = {}) {
  const where = includeDrafts ? '' : "AND status = 'published'"
  const result = await db
    .prepare(
      `SELECT id, section_key, section_type, title, content_json, sort_order, status
       FROM page_sections
       WHERE page_id = ? ${where}
       ORDER BY sort_order ASC`,
    )
    .bind(pageId)
    .all()

  return (result.results || []).map((row) => ({
    type: row.section_type,
    props: parseJsonField(row.content_json, {}),
  }))
}

export async function getPage(db, slug, { includeDrafts = false } = {}) {
  const row = await getPageRow(db, slug)
  if (!row) return null
  if (!includeDrafts && row.status !== 'published') return null

  const blocks = await listSectionsForPage(db, row.id, { includeDrafts })
  return {
    slug: row.slug,
    title: row.title,
    status: row.status,
    blocks,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * Runs as a single db.batch() transaction (page upsert + section delete +
 * every section insert) — D1 does not implicitly wrap sequential .run()
 * calls in a transaction, so a mid-loop failure after the DELETE had
 * already committed would otherwise leave the page with zero blocks.
 */
export async function replacePage(db, slug, payload) {
  const timestamp = nowIso()
  const existing = await getPageRow(db, slug)
  const id = existing?.id || crypto.randomUUID()
  const title = normalizeString(payload.title) || slug

  const statements = [
    db
      .prepare(
        `INSERT INTO pages (id, slug, title, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(slug) DO UPDATE SET
           title = excluded.title,
           status = excluded.status,
           updated_at = excluded.updated_at`,
      )
      .bind(id, slug, title, normalizeStatus(payload.status), timestamp, timestamp),
    db.prepare('DELETE FROM page_sections WHERE page_id = ?').bind(id),
  ]

  const blocks = Array.isArray(payload.blocks) ? payload.blocks : []
  for (const [index, block] of blocks.entries()) {
    statements.push(
      db
        .prepare(
          `INSERT INTO page_sections (
            id, page_id, section_key, section_type, title, content_json, sort_order, status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          id,
          `block-${index + 1}`,
          normalizeString(block.type),
          null,
          JSON.stringify(block.props || {}),
          (index + 1) * 10,
          normalizeStatus(payload.status),
          timestamp,
          timestamp,
        ),
    )
  }

  await db.batch(statements)

  return getPage(db, slug, { includeDrafts: true })
}

import { nowIso } from '../utils/responses'

function normalizeString(value) {
  return String(value || '').trim()
}

function toRedirect(row) {
  return {
    id: row.id,
    fromPath: row.from_path,
    toPath: row.to_path,
    statusCode: Number(row.status_code) || 301,
    note: row.note || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function listRedirects(db) {
  const result = await db
    .prepare('SELECT id, from_path, to_path, status_code, note, created_at, updated_at FROM redirects ORDER BY from_path ASC')
    .all()
  return (result.results || []).map(toRedirect)
}

// The deepest parent a wildcard row can name. Bounds the IN (...) list below;
// no URL on this site comes close.
const MAX_WILDCARD_DEPTH = 12

/**
 * Every from_path that could answer this path, most specific first: the path
 * itself, the path without its trailing slash, then a `/*` wildcard for each
 * parent ("/a/b/c" gives "/a/b/*", then "/a/*"). A wildcard row covers
 * everything below its prefix but never the prefix itself, and there is no
 * root "/*".
 *
 * @param {string} pathname
 * @returns {string[]}
 */
export function redirectCandidates(pathname) {
  const exact = String(pathname || '')
  const trimmed = exact.length > 1 ? exact.replace(/\/+$/, '') : exact
  const segments = trimmed.split('/').filter(Boolean)
  const wildcards = []
  for (let depth = Math.min(segments.length - 1, MAX_WILDCARD_DEPTH); depth >= 1; depth -= 1) {
    wildcards.push(`/${segments.slice(0, depth).join('/')}/*`)
  }
  return [...new Set([exact, trimmed, ...wildcards])].filter(Boolean)
}

/**
 * Used by middleware only when a response already 404'd (see src/middleware.ts).
 * One indexed lookup (from_path is UNIQUE) over the path and its parent
 * wildcards: an exact row wins (even over a wildcard of equal length), then the longest wildcard.
 */
export async function findRedirect(db, fromPath) {
  const candidates = redirectCandidates(fromPath)
  if (candidates.length === 0) return null
  const placeholders = candidates.map(() => '?').join(', ')
  const row = await db
    .prepare(
      `SELECT id, from_path, to_path, status_code, note, created_at, updated_at FROM redirects
       WHERE from_path IN (${placeholders})
       ORDER BY (from_path = ?) DESC, (from_path NOT LIKE '%/*') DESC, length(from_path) DESC
       LIMIT 1`,
    )
    .bind(...candidates, candidates[0])
    .first()
  return row ? toRedirect(row) : null
}

export async function upsertRedirect(db, input) {
  const id = normalizeString(input.id) || crypto.randomUUID()
  const fromPath = normalizeString(input.fromPath)
  const toPath = normalizeString(input.toPath)

  if (!fromPath || !toPath) {
    const error = new Error('Both fromPath and toPath are required.')
    error.status = 400
    throw error
  }

  const timestamp = nowIso()
  await db
    .prepare(
      `INSERT INTO redirects (id, from_path, to_path, status_code, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(from_path) DO UPDATE SET
         to_path = excluded.to_path,
         status_code = excluded.status_code,
         note = excluded.note,
         updated_at = excluded.updated_at`,
    )
    .bind(
      id,
      fromPath,
      toPath,
      input.statusCode === 302 ? 302 : 301,
      normalizeString(input.note),
      timestamp,
      timestamp,
    )
    .run()

  return findRedirect(db, fromPath)
}

export async function deleteRedirect(db, id) {
  await db.prepare('DELETE FROM redirects WHERE id = ?').bind(id).run()
  return { id }
}

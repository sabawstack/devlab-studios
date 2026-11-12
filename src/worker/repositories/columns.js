/**
 * Which columns a table has, cached per Worker isolate.
 *
 * Code ships through `main` while migrations are applied to each D1 by hand
 * (production needs the owner's token), so for a while the code can run on a
 * database without the columns it knows about. Repositories that add optional
 * columns read and write them only when present, instead of failing every
 * query until the migration lands.
 *
 * A failed PRAGMA reads as "no columns known": callers then use only the
 * columns that predate the optional ones.
 */
const cache = new WeakMap()

export async function tableColumns(db, table) {
  if (!/^[a-z_]+$/.test(table)) throw new Error(`Invalid table name: ${table}`)
  let byTable = cache.get(db)
  if (!byTable) {
    byTable = new Map()
    cache.set(db, byTable)
  }
  if (byTable.has(table)) return byTable.get(table)

  let columns
  try {
    const result = await db.prepare(`PRAGMA table_info(${table})`).all()
    columns = new Set((result.results || []).map((row) => row.name))
  } catch {
    columns = new Set()
  }
  // Only remember a successful read: an empty answer may be a transient error.
  if (columns.size) byTable.set(table, columns)
  return columns
}

/**
 * The error for a save that carries values a not-yet-migrated database cannot
 * hold. Refusing beats silently dropping what the editor typed.
 */
export function missingMigrationError(migration, fields) {
  const error = new Error(
    `These fields need database migration ${migration}, which has not been applied here yet: ${fields.join(', ')}. ` +
      'Clear them or apply the migration, then save again.',
  )
  error.status = 409
  return error
}

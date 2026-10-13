import { nowIso, parseJsonField } from '../utils/responses'

/**
 * @param {import('@cloudflare/workers-types').D1Database} db
 * @param {{ actorEmail?: string | null, action: string, entityType: string, entityId?: string | null, metadata?: unknown }} options
 */
export async function recordAuditEvent(db, { actorEmail = null, action, entityType, entityId = null, metadata = {} }) {
  await db
    .prepare(
      `INSERT INTO audit_log (id, actor_email, action, entity_type, entity_id, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(crypto.randomUUID(), actorEmail, action, entityType, entityId, JSON.stringify(metadata), nowIso())
    .run()
}

/**
 * @param {import('@cloudflare/workers-types').D1Database} db
 * @param {{ entityType?: string | null, entityId?: string | null, limit?: number }} [options]
 */
export async function listAuditEvents(db, { entityType = null, entityId = null, limit = 100 } = {}) {
  const conditions = []
  const bindings = []

  if (entityType) {
    conditions.push('entity_type = ?')
    bindings.push(entityType)
  }
  if (entityId) {
    conditions.push('entity_id = ?')
    bindings.push(entityId)
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  bindings.push(limit)

  const result = await db
    .prepare(
      `SELECT id, actor_email, action, entity_type, entity_id, metadata_json, created_at
       FROM audit_log
       ${where}
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .bind(...bindings)
    .all()

  return (result.results || []).map((row) => ({
    id: row.id,
    actorEmail: row.actor_email,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    metadata: parseJsonField(row.metadata_json, {}),
    createdAt: row.created_at,
  }))
}

/**
 * The `.catch` for an audit write that must not fail the request it records
 * (the change has already happened). It used to be `.catch(() => undefined)`,
 * which made a broken audit trail invisible; now every dropped row is logged
 * with enough context to reconstruct it.
 *
 * @param {unknown} error
 */
export function logAuditFailure(error) {
  console.error(JSON.stringify({
    event: 'audit_log_write',
    outcome: 'failure',
    errorMessage: error instanceof Error ? error.message : String(error),
  }))
}

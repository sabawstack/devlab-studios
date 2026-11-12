/**
 * Dependency checks behind /api/health (audit OPS-03), for the uptime monitor
 * and the post-deploy smoke test.
 *
 * Each check is cheap (a `SELECT 1`, a binding presence check, one Durable
 * Object round-trip on a dedicated key) and reports only ok / missing / error:
 * no error text, ids or configuration ever leave the Worker. Any failing check
 * makes the answer 503 "degraded" so a monitor alerts on it.
 */
type CheckState = 'ok' | 'missing' | 'error'

async function checkDb(db: D1Database | undefined): Promise<CheckState> {
  if (!db) return 'missing'
  try {
    await db.prepare('SELECT 1 AS ok').first()
    return 'ok'
  } catch {
    return 'error'
  }
}

async function checkLimiter(namespace: Env['RATE_LIMITER'] | undefined): Promise<CheckState> {
  if (!namespace) return 'missing'
  try {
    // A dedicated key with a limit no probe rate can reach, so the check never
    // affects a real visitor's counters.
    const stub = namespace.get(namespace.idFromName('health:probe')) as unknown as { check: (key: string, limit: number, windowMs: number) => Promise<unknown> }
    await stub.check('health:probe', 1_000_000, 60_000)
    return 'ok'
  } catch {
    return 'error'
  }
}

export async function checkHealth(env: Env) {
  const [db, pickleballDb, rateLimiter] = await Promise.all([
    checkDb(env.DB),
    checkDb(env.PICKLEBALL_DB),
    checkLimiter(env.RATE_LIMITER),
  ])
  const checks = { db, pickleballDb, mediaBucket: (env.MEDIA_BUCKET ? 'ok' : 'missing') as CheckState, rateLimiter }
  const ok = Object.values(checks).every((state) => state === 'ok')
  return {
    status: ok ? 200 : 503,
    body: {
      ok,
      status: ok ? 'ok' : 'degraded',
      // Kept for existing callers.
      hasDb: Boolean(env.DB),
      hasMediaBucket: Boolean(env.MEDIA_BUCKET),
      checks,
    },
  }
}

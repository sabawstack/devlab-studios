import type { APIRoute } from 'astro'
import { listDigests } from '../../../../worker/repositories/digests.js'
import { recordAuditEvent } from '../../../../worker/repositories/auditLog.js'
import { runDailyDigest } from '../../../../worker/digest/runDigest.js'
import { checkRateLimit, clientIp } from '../../../../worker/rateLimit.js'
import { getEnv } from '../../../../lib/env'
import { drainRequestBody, jsonResponse } from '../../../../lib/http'
import { withAdmin } from '../../../../lib/adminGuard'

export const prerender = false

/**
 * Both handlers sit behind the blanket admin gate in src/middleware.ts.
 *
 * Drafts are included here and only here: the public loader asks for published
 * rows only, so unpublishing a day removes it from the site while leaving it
 * visible to whoever needs to look at what was removed.
 */
const unguardedGET: APIRoute = async () => {
  const env = getEnv()
  if (!env.DB) return jsonResponse({ error: 'D1 DB binding is not configured.' }, 503)

  const digests = await listDigests(env.DB, { limit: 14, includeDrafts: true })
  return jsonResponse({ digests })
}

/**
 * "Generate now" — the same run the cron performs, on demand.
 *
 * Rate-limited despite being admin-only, because each run makes four outbound
 * fetches and up to ten Workers AI calls against a daily allocation. An admin
 * holding down a button should not be able to spend the day's neurons.
 */
const unguardedPOST: APIRoute = async ({ request, locals }) => {
  const env = getEnv()
  await drainRequestBody(request)

  if (!env.DB) return jsonResponse({ error: 'D1 DB binding is not configured.' }, 503)

  const { limited, retryAfterSeconds } = await checkRateLimit(env, 'digest-generate', clientIp(request), {
    limit: 4,
    windowMs: 60 * 60 * 1000,
  })
  if (limited) {
    return jsonResponse(
      { error: 'The digest has been regenerated several times in the past hour. Try again shortly.' },
      429,
      { 'Retry-After': String(retryAfterSeconds) },
    )
  }

  const result = await runDailyDigest(env, { trigger: 'manual' })

  await recordAuditEvent(env.DB, {
    actorEmail: locals.adminEmail || null,
    action: 'update',
    entityType: 'digests',
    entityId: result.digestDate,
    metadata: {
      summary: result.published
        ? `Generated the ${result.digestDate} digest (${result.itemCount} items).`
        : `Digest run for ${result.digestDate} produced no new items.`,
      itemCount: result.itemCount,
    },
  })

  return jsonResponse(result)
}

// Authenticated per handler as well as by src/middleware.ts; see src/lib/adminGuard.ts.
export const GET = withAdmin(unguardedGET)
export const POST = withAdmin(unguardedPOST)

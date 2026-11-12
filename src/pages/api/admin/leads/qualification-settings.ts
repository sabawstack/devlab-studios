import type { APIRoute } from 'astro'
import { getEnv } from '../../../../lib/env'
import { adminErrorResponse, jsonResponse, readJsonBody } from '../../../../lib/http'
import { withAdmin } from '../../../../lib/adminGuard'
import { getSiteSetting, setSiteSetting } from '../../../../worker/repositories/content.js'
import { recordAuditEvent } from '../../../../worker/repositories/auditLog.js'
import { QUALIFICATION_SETTINGS_KEY } from '../../../../worker/inquiryService.js'
import {
  DEFAULT_QUALIFICATION_SETTINGS,
  qualificationSettingsOverrideSchema,
  resolveQualificationSettings,
} from '../../../../lib/leads/qualification'

export const prerender = false

/**
 * Inquiry qualification thresholds and weights (audit LEAD-04).
 *
 * GET returns the built-in defaults, the stored overrides and the effective
 * values new inquiries are scored with. PUT replaces the overrides; an empty
 * object restores every default. Already-stored inquiries keep the tier and
 * reasons they were given -- this only affects new ones.
 */
const unguardedGET: APIRoute = async () => {
  const env = getEnv()
  if (!env.DB) return jsonResponse({ error: 'D1 DB binding is not configured.' }, 503)
  const overrides = await getSiteSetting(env.DB, QUALIFICATION_SETTINGS_KEY, {})
  return jsonResponse({
    defaults: DEFAULT_QUALIFICATION_SETTINGS,
    overrides,
    effective: resolveQualificationSettings(overrides),
  })
}

const unguardedPUT: APIRoute = async ({ request, locals }) => {
  const env = getEnv()
  if (!env.DB) return jsonResponse({ error: 'D1 DB binding is not configured.' }, 503)
  try {
    const parsed = qualificationSettingsOverrideSchema.safeParse(await readJsonBody(request))
    if (!parsed.success) return jsonResponse({ error: 'Validation failed.', issues: parsed.error.issues }, 400)

    const effective = resolveQualificationSettings(parsed.data)
    const { priority, standard, nurture } = { ...DEFAULT_QUALIFICATION_SETTINGS.thresholds, ...parsed.data.thresholds }
    if (!(priority > standard && standard > nurture)) {
      return jsonResponse({ error: 'Tier thresholds must descend: priority above standard above nurture.' }, 400)
    }

    const before = await getSiteSetting(env.DB, QUALIFICATION_SETTINGS_KEY, {})
    await setSiteSetting(env.DB, QUALIFICATION_SETTINGS_KEY, parsed.data)
    await recordAuditEvent(env.DB, {
      actorEmail: locals.adminEmail || null,
      action: 'update',
      entityType: 'inquiry_qualification',
      entityId: QUALIFICATION_SETTINGS_KEY,
      metadata: { summary: 'Updated inquiry qualification settings.', before, after: parsed.data },
    })
    return jsonResponse({ defaults: DEFAULT_QUALIFICATION_SETTINGS, overrides: parsed.data, effective })
  } catch (error) {
    return adminErrorResponse(error, 'Could not save the qualification settings.')
  }
}

// Authenticated per handler as well as by src/middleware.ts; see src/lib/adminGuard.ts.
export const GET = withAdmin(unguardedGET)
export const PUT = withAdmin(unguardedPUT)

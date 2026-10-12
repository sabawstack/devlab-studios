import type { APIRoute } from 'astro'
import { getEnv } from '../../../../../lib/env'
import { drainRequestBody } from '../../../../../lib/http'
import { testLoginSchema } from '../../../../../lib/schemas/pickleball/open/host'
import { toHostProfile, upsertHost } from '../../../../../worker/repositories/pickleball/open/hosts'
import { beginHostLogin, signInIpLimited } from '../../../../../worker/pickleball/open/hostSession'
import { openErrorResponse } from '../../../../../worker/pickleball/open/routeHelpers'
import { crossSiteRefusal } from '../../../../../worker/pickleball/open/sameOrigin'
import { jsonResponse } from '../../../../../worker/utils/responses.js'

// Test-only stand-in for Google sign-in (spec §13), so Playwright can reach a
// signed-in host with no Google account. Answers only when
// PICKLEBALL_TEST_AUTH_ENABLED is exactly 'true': set in .dev.vars for local
// e2e, never in wrangler.jsonc's committed vars.
export const POST: APIRoute = async ({ request }) => {
  const env = getEnv()
  if (env.PICKLEBALL_TEST_AUTH_ENABLED !== 'true') {
    await drainRequestBody(request)
    return jsonResponse({ error: 'Not found.' }, 404)
  }
  try {
    const refused = crossSiteRefusal(request) ?? (await signInIpLimited(env, request))
    if (refused) {
      await drainRequestBody(request)
      return refused
    }
    const parsed = testLoginSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return jsonResponse({ error: 'Give an email address.' }, 400)
    const now = new Date().toISOString()
    const { email, name, marketingOptIn } = parsed.data
    const host = await upsertHost(env.PICKLEBALL_DB, {
      googleSub: `test-${email}`, email, displayName: name ?? email, marketingOptIn: marketingOptIn ?? false,
    }, { now, newId: () => crypto.randomUUID() })
    const cookie = await beginHostLogin(env, request, host.id, now)
    return jsonResponse({ host: toHostProfile(host) }, 200, { 'Set-Cookie': cookie })
  } catch (error) {
    return openErrorResponse(error, 'host.test-login')
  }
}

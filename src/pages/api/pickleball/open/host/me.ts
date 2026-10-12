import type { APIRoute } from 'astro'
import { getEnv } from '../../../../../lib/env'
import { drainRequestBody } from '../../../../../lib/http'
import { hostProfilePatchSchema } from '../../../../../lib/schemas/pickleball/open/host'
import { toHostProfile, updateHostProfile } from '../../../../../worker/repositories/pickleball/open/hosts'
import { currentHost, hostAccountIpLimited, signInFirst } from '../../../../../worker/pickleball/open/hostSession'
import { openErrorResponse } from '../../../../../worker/pickleball/open/routeHelpers'
import { crossSiteRefusal } from '../../../../../worker/pickleball/open/sameOrigin'
import { jsonResponse } from '../../../../../worker/utils/responses.js'

/** The signed-in host's own profile, or { host: null }. Never the Google subject id. */
export const GET: APIRoute = async ({ request }) => {
  const env = getEnv()
  try {
    const limited = await hostAccountIpLimited(env, request)
    if (limited) return limited
    const host = await currentHost(env, request)
    return jsonResponse({ host: host ? toHostProfile(host) : null }, 200)
  } catch (error) {
    return openErrorResponse(error, 'host.me')
  }
}

const MAX_BODY_BYTES = 1024

/** Saves the DUPR Club ID (spec §9.3) and/or the marketing choice. */
export const PATCH: APIRoute = async ({ request }) => {
  const env = getEnv()
  try {
    const refused = crossSiteRefusal(request) ?? (await hostAccountIpLimited(env, request))
    if (refused || Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) {
      await drainRequestBody(request)
      return refused ?? jsonResponse({ error: 'That request is too large.' }, 413)
    }
    const parsed = hostProfilePatchSchema.safeParse(await request.json().catch(() => null))
    const host = await currentHost(env, request)
    if (!host) return signInFirst()
    if (!parsed.success) return jsonResponse({ error: 'A DUPR Club ID is 3 to 20 letters, digits or dashes.' }, 400)
    const updated = await updateHostProfile(env.PICKLEBALL_DB, host.id, parsed.data)
    return updated ? jsonResponse({ host: toHostProfile(updated) }, 200) : signInFirst()
  } catch (error) {
    return openErrorResponse(error, 'host.me.patch')
  }
}

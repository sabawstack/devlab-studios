import type { APIRoute } from 'astro'
import { getEnv } from '../../../../../../lib/env'
import { toHostProfile } from '../../../../../../worker/repositories/pickleball/open/hosts'
import { currentHost } from '../../../../../../worker/pickleball/open/hostSession'
import { codeFrom, hostIpLimited, hostKeyFrom, notFound, openErrorResponse, openSessionStub } from '../../../../../../worker/pickleball/open/routeHelpers'
import { jsonResponse } from '../../../../../../worker/utils/responses.js'

/**
 * The host console's DUPR panel (spec §9): who is signed in, whether the
 * session is linked to them, what would go to DUPR and why games are left
 * out. Needs the host key; the cookie is optional (signed out is a state the
 * panel explains). ?tz= is the host device's time zone, for game dates.
 */
export const GET: APIRoute = async ({ request, params }) => {
  const env = getEnv()
  try {
    const limited = await hostIpLimited(env, request)
    if (limited) return limited
    const code = codeFrom(params)
    if (!code) return notFound()
    const host = await currentHost(env, request)
    const timeZone = new URL(request.url).searchParams.get('tz') ?? 'UTC'
    const result = await openSessionStub(env, code).duprStatus(code, hostKeyFrom(request), host?.id ?? null, timeZone)
    if (result.status !== 200 || !('claim' in result.body)) return jsonResponse(result.body, result.status)
    return jsonResponse({ host: host ? toHostProfile(host) : null, ...result.body }, 200)
  } catch (error) {
    return openErrorResponse(error, 'dupr')
  }
}

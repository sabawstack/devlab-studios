import type { APIRoute } from 'astro'
import { getEnv } from '../../../../../lib/env'
import { listHostSessions } from '../../../../../worker/repositories/pickleball/open/hosts'
import { currentHost, hostAccountIpLimited, signInFirst } from '../../../../../worker/pickleball/open/hostSession'
import { openErrorResponse } from '../../../../../worker/pickleball/open/routeHelpers'
import { jsonResponse } from '../../../../../worker/utils/responses.js'

/** My sessions (spec §9.5): the signed-in host's claimed, unexpired sessions. */
export const GET: APIRoute = async ({ request }) => {
  const env = getEnv()
  try {
    const limited = await hostAccountIpLimited(env, request)
    if (limited) return limited
    const host = await currentHost(env, request)
    if (!host) return signInFirst()
    return jsonResponse({ sessions: await listHostSessions(env.PICKLEBALL_DB, host.id, new Date().toISOString()) }, 200)
  } catch (error) {
    return openErrorResponse(error, 'host.sessions')
  }
}

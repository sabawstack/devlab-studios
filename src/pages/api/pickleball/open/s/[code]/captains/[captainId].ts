import type { APIRoute } from 'astro'
import { getEnv } from '../../../../../../../lib/env'
import { codeFrom, doResponse, hostIpLimited, hostKeyFrom, notFound, openErrorResponse, openSessionStub } from '../../../../../../../worker/pickleball/open/routeHelpers'

export const DELETE: APIRoute = async ({ request, params }) => {
  const env = getEnv()
  try {
    const limited = await hostIpLimited(env, request)
    if (limited) return limited
    const code = codeFrom(params)
    const captainId = params.captainId ?? ''
    if (!code || !captainId || captainId.length > 64) return notFound()
    return doResponse(await openSessionStub(env, code).revokeCaptain(code, hostKeyFrom(request), captainId))
  } catch (error) {
    return openErrorResponse(error, 'captain-revoke')
  }
}

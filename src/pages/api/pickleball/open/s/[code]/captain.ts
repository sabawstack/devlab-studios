import type { APIRoute } from 'astro'
import { getEnv } from '../../../../../../lib/env'
import { captainKeyFrom, codeFrom, doResponse, hostIpLimited, notFound, openErrorResponse, openSessionStub } from '../../../../../../worker/pickleball/open/routeHelpers'

export const GET: APIRoute = async ({ request, params }) => {
  const env = getEnv()
  try {
    const limited = await hostIpLimited(env, request)
    if (limited) return limited
    const code = codeFrom(params)
    if (!code) return notFound()
    return doResponse(await openSessionStub(env, code).captain(code, captainKeyFrom(request)))
  } catch (error) {
    return openErrorResponse(error, 'captain')
  }
}

import type { APIRoute } from 'astro'
import { getEnv } from '../../../../../../lib/env'
import { codeFrom, doResponse, hostIpLimited, hostKeyFrom, notFound, openErrorResponse, openSessionStub } from '../../../../../../worker/pickleball/open/routeHelpers'

export const GET: APIRoute = async ({ request, params }) => {
  const env = getEnv()
  try {
    const limited = await hostIpLimited(env, request)
    if (limited) return limited
    const code = codeFrom(params)
    if (!code) return notFound()
    return doResponse(await openSessionStub(env, code).host(code, hostKeyFrom(request)))
  } catch (error) {
    return openErrorResponse(error, 'host')
  }
}

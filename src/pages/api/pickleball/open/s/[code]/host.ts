import type { APIRoute } from 'astro'
import { getEnv } from '../../../../../../lib/env'
import { codeFrom, doResponse, hostKeyFrom, notFound, openErrorResponse, openSessionStub } from '../../../../../../worker/pickleball/open/routeHelpers'

export const GET: APIRoute = async ({ request, params }) => {
  try {
    const code = codeFrom(params)
    if (!code) return notFound()
    return doResponse(await openSessionStub(getEnv(), code).host(code, hostKeyFrom(request)))
  } catch (error) {
    return openErrorResponse(error, 'host')
  }
}

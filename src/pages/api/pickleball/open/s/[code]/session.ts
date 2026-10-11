import type { APIRoute } from 'astro'
import { getEnv } from '../../../../../../lib/env'
import { codeFrom, doResponse, hostKeyFrom, notFound, openErrorResponse, openSessionStub } from '../../../../../../worker/pickleball/open/routeHelpers'

export const DELETE: APIRoute = async ({ request, params }) => {
  try {
    const code = codeFrom(params)
    if (!code) return notFound()
    return doResponse(await openSessionStub(getEnv(), code).remove(code, hostKeyFrom(request)))
  } catch (error) {
    return openErrorResponse(error, 'session')
  }
}

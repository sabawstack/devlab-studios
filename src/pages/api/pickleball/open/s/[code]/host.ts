import type { APIRoute } from 'astro'
import { getEnv } from '../../../../../../lib/env'
import { codeFrom, doResponse, hostKeyFrom, notFound, openSessionStub } from '../../../../../../worker/pickleball/open/routeHelpers'
import { apiErrorResponse } from '../../../../../../worker/utils/responses.js'

export const GET: APIRoute = async ({ request, params }) => {
  try {
    const code = codeFrom(params)
    if (!code) return notFound()
    return doResponse(await openSessionStub(getEnv(), code).host(code, hostKeyFrom(request)))
  } catch (error) {
    return apiErrorResponse(error)
  }
}

import type { APIRoute } from 'astro'
import { getEnv } from '../../../../../../lib/env'
import { codeFrom, doResponse, hostIpLimited, hostKeyFrom, notFound, openErrorResponse, openSessionStub } from '../../../../../../worker/pickleball/open/routeHelpers'
import { jsonResponse } from '../../../../../../worker/utils/responses.js'

export const POST: APIRoute = async ({ request, params }) => {
  const env = getEnv()
  try {
    const limited = await hostIpLimited(env, request)
    if (limited) {
      await request.arrayBuffer().catch(() => {})
      return limited
    }
    const code = codeFrom(params)
    if (!code) {
      await request.arrayBuffer().catch(() => {})
      return notFound()
    }
    const body = await request.json().catch(() => null)
    if (body === null) return jsonResponse({ error: 'That request was not understood.' }, 400)
    return doResponse(await openSessionStub(env, code).createCaptain(code, hostKeyFrom(request), body))
  } catch (error) {
    return openErrorResponse(error, 'captains')
  }
}

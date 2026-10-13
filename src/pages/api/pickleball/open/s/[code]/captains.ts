import type { APIRoute } from 'astro'
import { getEnv } from '../../../../../../lib/env'
import { discardUnreadBody } from '../../../../../../lib/http'
import { createCaptainSchema } from '../../../../../../lib/schemas/pickleball/open/captains'
import { BODY_LIMITS, readValidJson } from '../../../../../../worker/pickleball/open/requestBody'
import { codeFrom, doResponse, hostIpLimited, hostKeyFrom, notFound, openErrorResponse, openSessionStub } from '../../../../../../worker/pickleball/open/routeHelpers'

export const POST: APIRoute = async ({ request, params }) => {
  const env = getEnv()
  try {
    const limited = await hostIpLimited(env, request)
    if (limited) {
      await discardUnreadBody(request, env)
      return limited
    }
    const code = codeFrom(params)
    if (!code) {
      await discardUnreadBody(request, env)
      return notFound()
    }
    const body = await readValidJson(request, BODY_LIMITS.small, createCaptainSchema, { env, message: () => 'Pick a court for the captain.' })
    if (!body.ok) return body.response
    return doResponse(await openSessionStub(env, code).createCaptain(code, hostKeyFrom(request), body.data))
  } catch (error) {
    return openErrorResponse(error, 'captains')
  }
}

import type { APIRoute } from 'astro'
import { checkInSchema } from '../../../../../../lib/schemas/pickleball/open/checkIn'
import { getEnv } from '../../../../../../lib/env'
import { discardUnreadBody } from '../../../../../../lib/http'
import { BODY_LIMITS, readValidJson } from '../../../../../../worker/pickleball/open/requestBody'
import { checkInIpLimited, codeFrom, doResponse, notFound, openErrorResponse, openSessionStub } from '../../../../../../worker/pickleball/open/routeHelpers'

export const POST: APIRoute = async ({ request, params }) => {
  const env = getEnv()
  try {
    const limited = await checkInIpLimited(env, request)
    if (limited) {
      await discardUnreadBody(request, env)
      return limited
    }
    const code = codeFrom(params)
    if (!code) {
      await discardUnreadBody(request, env)
      return notFound()
    }
    // Only the parsed fields go on to the DO, never the raw body (extra keys are stripped).
    const body = await readValidJson(request, BODY_LIMITS.small, checkInSchema, { env, message: () => 'Check your details and try again.' })
    if (!body.ok) return body.response
    return doResponse(await openSessionStub(env, code).checkIn(code, body.data))
  } catch (error) {
    return openErrorResponse(error, 'check-in')
  }
}

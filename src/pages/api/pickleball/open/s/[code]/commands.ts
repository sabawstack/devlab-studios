import type { APIRoute } from 'astro'
import { getEnv } from '../../../../../../lib/env'
import { discardUnreadBody } from '../../../../../../lib/http'
import { commandEnvelopeSchema } from '../../../../../../lib/schemas/pickleball/open/commands'
import { BODY_LIMITS, readValidJson } from '../../../../../../worker/pickleball/open/requestBody'
import { codeFrom, credentialsFrom, doResponse, hostIpLimited, notFound, openErrorResponse, openSessionStub } from '../../../../../../worker/pickleball/open/routeHelpers'

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
    // Bounded and validated here, so only a well-formed command reaches (and queues in) the DO.
    // The 120-per-minute-per-session limit is counted in the DO after the host or captain key checks out.
    const body = await readValidJson(request, BODY_LIMITS.command, commandEnvelopeSchema, { env })
    if (!body.ok) return body.response
    return doResponse(await openSessionStub(env, code).command(code, credentialsFrom(request), body.data))
  } catch (error) {
    return openErrorResponse(error, 'commands')
  }
}

import type { APIRoute } from 'astro'
import { getEnv } from '../../../../../../lib/env'
import { codeFrom, notFound, openErrorResponse, openSessionStub } from '../../../../../../worker/pickleball/open/routeHelpers'
import { checkRateLimit, clientIp, rateLimitedResponse } from '../../../../../../worker/rateLimit.js'
import { jsonResponse } from '../../../../../../worker/utils/responses.js'

export const GET: APIRoute = async ({ request, params }) => {
  const env = getEnv()
  try {
    const rate = await checkRateLimit(env, 'open-state', clientIp(request), { limit: 60, windowMs: 60_000 })
    if (rate.limited) return rateLimitedResponse('Too many requests. Try again shortly.', rate.retryAfterSeconds)
    const code = codeFrom(params)
    if (!code) return notFound()
    const snapshot = await openSessionStub(env, code).viewer(code)
    return snapshot ? jsonResponse(snapshot, 200) : notFound()
  } catch (error) {
    return openErrorResponse(error, 'state')
  }
}

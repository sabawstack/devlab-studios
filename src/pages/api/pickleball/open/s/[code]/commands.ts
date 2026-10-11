import type { APIRoute } from 'astro'
import { getEnv } from '../../../../../../lib/env'
import { codeFrom, doResponse, hostKeyFrom, notFound, openErrorResponse, openSessionStub } from '../../../../../../worker/pickleball/open/routeHelpers'
import { checkRateLimit, rateLimitedResponse } from '../../../../../../worker/rateLimit.js'
import { jsonResponse } from '../../../../../../worker/utils/responses.js'

export const POST: APIRoute = async ({ request, params }) => {
  const env = getEnv()
  try {
    const code = codeFrom(params)
    if (!code) {
      await request.arrayBuffer().catch(() => {})
      return notFound()
    }
    const rate = await checkRateLimit(env, 'open-commands', code, { limit: 120, windowMs: 60_000 })
    if (rate.limited) {
      await request.arrayBuffer().catch(() => {})
      return rateLimitedResponse('Slow down a little and try again.', rate.retryAfterSeconds)
    }
    const body = await request.json().catch(() => null)
    if (body === null) return jsonResponse({ error: 'That request was not understood.' }, 400)
    return doResponse(await openSessionStub(env, code).command(code, hostKeyFrom(request), body))
  } catch (error) {
    return openErrorResponse(error, 'commands')
  }
}

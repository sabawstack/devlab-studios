import type { APIRoute } from 'astro'
import { getEnv } from '../../../../lib/env'
import { codeFrom, notFound, openErrorResponse, openSessionStub } from '../../../../worker/pickleball/open/routeHelpers'
import { checkRateLimit, clientIp, rateLimitedResponse } from '../../../../worker/rateLimit.js'
import { jsonResponse } from '../../../../worker/utils/responses.js'

export const GET: APIRoute = async ({ request, params }) => {
  const env = getEnv()
  try {
    if (request.headers.get('Upgrade') !== 'websocket') return jsonResponse({ error: 'Expected a WebSocket upgrade request.' }, 400)
    const rate = await checkRateLimit(env, 'open-ws', clientIp(request), { limit: 30, windowMs: 60_000 })
    if (rate.limited) return rateLimitedResponse('Too many connections. Try again shortly.', rate.retryAfterSeconds)
    const code = codeFrom(params)
    if (!code) return notFound()
    const headers = new Headers(request.headers)
    headers.set('X-Open-Code', code)
    return openSessionStub(env, code).fetch(new Request(request, { headers }))
  } catch (error) {
    return openErrorResponse(error, 'rt')
  }
}

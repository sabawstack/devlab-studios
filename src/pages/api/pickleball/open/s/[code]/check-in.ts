import type { APIRoute } from 'astro'
import { checkInSchema } from '../../../../../../lib/schemas/pickleball/open/checkIn'
import { getEnv } from '../../../../../../lib/env'
import { checkInIpLimited, codeFrom, doResponse, notFound, openErrorResponse, openSessionStub } from '../../../../../../worker/pickleball/open/routeHelpers'
import { jsonResponse } from '../../../../../../worker/utils/responses.js'

const MAX_BODY_BYTES = 4096

export const POST: APIRoute = async ({ request, params }) => {
  const env = getEnv()
  try {
    const limited = await checkInIpLimited(env, request)
    if (limited) {
      await request.arrayBuffer().catch(() => {})
      return limited
    }
    const code = codeFrom(params)
    if (!code) {
      await request.arrayBuffer().catch(() => {})
      return notFound()
    }
    const declared = Number(request.headers.get('content-length') ?? 0)
    if (declared > MAX_BODY_BYTES) return jsonResponse({ error: 'That request is too large.' }, 413)
    const body = await request.json().catch(() => null)
    if (body === null) return jsonResponse({ error: 'That request was not understood.' }, 400)
    const parsed = checkInSchema.safeParse(body)
    if (!parsed.success) return jsonResponse({ error: parsed.error.issues[0]?.message ?? 'Check your details and try again.' }, 400)
    return doResponse(await openSessionStub(env, code).checkIn(code, body))
  } catch (error) {
    return openErrorResponse(error, 'check-in')
  }
}

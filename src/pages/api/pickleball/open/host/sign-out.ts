import type { APIRoute } from 'astro'
import { getEnv } from '../../../../../lib/env'
import { drainRequestBody } from '../../../../../lib/http'
import { endHostLogin, hostAccountIpLimited } from '../../../../../worker/pickleball/open/hostSession'
import { openErrorResponse } from '../../../../../worker/pickleball/open/routeHelpers'
import { crossSiteRefusal } from '../../../../../worker/pickleball/open/sameOrigin'
import { jsonResponse } from '../../../../../worker/utils/responses.js'

/** Ends this browser's host login. Other devices stay signed in. */
export const POST: APIRoute = async ({ request }) => {
  const env = getEnv()
  try {
    await drainRequestBody(request)
    const refused = crossSiteRefusal(request) ?? (await hostAccountIpLimited(env, request))
    if (refused) return refused
    return jsonResponse({ signedOut: true }, 200, { 'Set-Cookie': await endHostLogin(env, request) })
  } catch (error) {
    return openErrorResponse(error, 'host.sign-out')
  }
}

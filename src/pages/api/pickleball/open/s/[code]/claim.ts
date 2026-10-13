import type { APIRoute } from 'astro'
import { getEnv } from '../../../../../../lib/env'
import { currentHost, signInFirst } from '../../../../../../worker/pickleball/open/hostSession'
import { refuseLargeBody } from '../../../../../../worker/pickleball/open/requestBody'
import { codeFrom, doResponse, hostIpLimited, hostKeyFrom, notFound, openErrorResponse, openSessionStub } from '../../../../../../worker/pickleball/open/routeHelpers'
import { crossSiteRefusal } from '../../../../../../worker/pickleball/open/sameOrigin'

/** Links this session to the signed-in Google account (spec §9.2). Needs the host key AND the host cookie. */
export const POST: APIRoute = async ({ request, params }) => {
  const env = getEnv()
  try {
    // Takes no body: anything sent is read off up to a small cap, never buffered whole.
    const refused = (await refuseLargeBody(request, undefined, env)) ?? crossSiteRefusal(request) ?? (await hostIpLimited(env, request))
    if (refused) return refused
    const code = codeFrom(params)
    if (!code) return notFound()
    const host = await currentHost(env, request)
    if (!host) return signInFirst()
    return doResponse(await openSessionStub(env, code).claim(code, hostKeyFrom(request), host.id))
  } catch (error) {
    return openErrorResponse(error, 'claim')
  }
}

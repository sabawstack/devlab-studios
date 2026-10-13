import type { APIRoute } from 'astro'
import { getEnv } from '../../../../../../../lib/env'
import { currentHost, hostAccountIpLimited, signInFirst } from '../../../../../../../worker/pickleball/open/hostSession'
import { refuseLargeBody } from '../../../../../../../worker/pickleball/open/requestBody'
import { codeFrom, doResponse, notFound, openErrorResponse, openSessionStub } from '../../../../../../../worker/pickleball/open/routeHelpers'
import { crossSiteRefusal } from '../../../../../../../worker/pickleball/open/sameOrigin'

/** A fresh host link for a session this account claimed (spec §9.5): the lost-link recovery path. */
export const POST: APIRoute = async ({ request, params }) => {
  const env = getEnv()
  try {
    // Takes no body: anything sent is read off up to a small cap, never buffered whole.
    const refused = (await refuseLargeBody(request, undefined, env)) ?? crossSiteRefusal(request) ?? (await hostAccountIpLimited(env, request))
    if (refused) return refused
    const host = await currentHost(env, request)
    if (!host) return signInFirst()
    const code = codeFrom(params)
    if (!code) return notFound()
    return doResponse(await openSessionStub(env, code).reopen(code, host.id))
  } catch (error) {
    return openErrorResponse(error, 'host.reopen')
  }
}

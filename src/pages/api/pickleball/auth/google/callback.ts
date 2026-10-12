import type { APIRoute } from 'astro'
import { getEnv } from '../../../../../lib/env'
import { finishHostSignIn, hostSignInFailedResponse } from '../../../../../worker/pickleball/open/hostAuth'

// The redirect URI registered with Google (spec §9.1), so this path never
// moves even though everything else under /api/pickleball/ outside open/ is
// gone: the logged-in operator app that once shared it was retired in Phase 5
// (§12). Every visit is a host sign-in coming back from Google, and every
// outcome is a redirect with ?signin=…, never a raw error body.
export const GET: APIRoute = async ({ request }) => {
  try {
    return await finishHostSignIn(getEnv(), request)
  } catch (error) {
    console.log(JSON.stringify({ event: 'pickleball_open.host_signin_failed', error: error instanceof Error ? error.message : 'unknown' }))
    return hostSignInFailedResponse(request)
  }
}

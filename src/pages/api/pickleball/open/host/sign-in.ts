import type { APIRoute } from 'astro'
import { getEnv } from '../../../../../lib/env'
import { DEFAULT_RETURN_PATH, startHostSignIn, withSignInResult } from '../../../../../worker/pickleball/open/hostAuth'

/** A top-level navigation from the DUPR sheet or My sessions: always answers with a redirect. */
export const GET: APIRoute = async ({ request }) => {
  try {
    return await startHostSignIn(getEnv(), request)
  } catch (error) {
    console.log(JSON.stringify({ event: 'pickleball_open.host_signin_start_failed', error: error instanceof Error ? error.message : 'unknown' }))
    return new Response(null, { status: 302, headers: { Location: withSignInResult(DEFAULT_RETURN_PATH, 'failed'), 'Cache-Control': 'no-store' } })
  }
}

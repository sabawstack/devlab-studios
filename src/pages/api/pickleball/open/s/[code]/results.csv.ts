import type { APIRoute } from 'astro'
import { getEnv } from '../../../../../../lib/env'
import { codeFrom, doResponse, hostIpLimited, hostKeyFrom, notFound, openErrorResponse, openSessionStub } from '../../../../../../worker/pickleball/open/routeHelpers'

export const GET: APIRoute = async ({ request, params }) => {
  const env = getEnv()
  try {
    const limited = await hostIpLimited(env, request)
    if (limited) return limited
    const code = codeFrom(params)
    if (!code) return notFound()
    const result = await openSessionStub(env, code).results(code, hostKeyFrom(request))
    if (result.status !== 200 || !('csv' in result.body)) return doResponse(result)
    return new Response(`﻿${result.body.csv}`, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${result.body.filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    return openErrorResponse(error, 'results.csv')
  }
}

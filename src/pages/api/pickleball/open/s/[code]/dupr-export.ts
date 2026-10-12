import type { APIRoute } from 'astro'
import { getEnv } from '../../../../../../lib/env'
import { drainRequestBody } from '../../../../../../lib/http'
import { duprExportRequestSchema } from '../../../../../../lib/schemas/pickleball/open/host'
import { sendDuprExport } from '../../../../../../worker/pickleball/open/duprExport'
import { currentHost, signInFirst } from '../../../../../../worker/pickleball/open/hostSession'
import { codeFrom, hostIpLimited, hostKeyFrom, notFound, openErrorResponse, openSessionStub } from '../../../../../../worker/pickleball/open/routeHelpers'
import { crossSiteRefusal } from '../../../../../../worker/pickleball/open/sameOrigin'
import { jsonResponse } from '../../../../../../worker/utils/responses.js'

const MAX_BODY_BYTES = 1024

/**
 * Emails the DUPR CSV to the signed-in host's verified Google address (spec
 * §9.6). Needs the host key, the host cookie, a claim by that account and a
 * DUPR Club ID. A failed send gives the reserved export back.
 */
export const POST: APIRoute = async ({ request, params }) => {
  const env = getEnv()
  try {
    const refused = crossSiteRefusal(request) ?? (await hostIpLimited(env, request))
    const code = codeFrom(params)
    if (refused || !code || Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) {
      await drainRequestBody(request)
      return refused ?? (code ? jsonResponse({ error: 'That request is too large.' }, 413) : notFound())
    }
    const parsed = duprExportRequestSchema.safeParse(await request.json().catch(() => ({})))
    const host = await currentHost(env, request)
    if (!host) return signInFirst()
    if (!host.duprClubId) return jsonResponse({ error: 'Add your DUPR Club ID first.' }, 409)

    const stub = openSessionStub(env, code)
    const hostKey = hostKeyFrom(request)
    const prepared = await stub.prepareDuprExport(code, hostKey, { id: host.id, displayName: host.displayName, duprClubId: host.duprClubId },
      parsed.success ? parsed.data.timeZone ?? 'UTC' : 'UTC')
    if (prepared.status !== 200 || !('exportId' in prepared.body)) return jsonResponse(prepared.body, prepared.status)

    const { exportId, email, filename, csv, exported, skipped, exportsLeft } = prepared.body
    const sent = await sendDuprExport(env, { to: host.email, email, filename, csv })
    if (sent.delivery === 'FAILED') {
      await stub.releaseDuprExport(code, hostKey, exportId)
      return jsonResponse({ error: 'The email could not be sent. Nothing was used up; try again in a minute.' }, 502)
    }
    return jsonResponse({
      delivery: sent.delivery, to: host.email, exported, skipped, exportsLeft,
      ...(sent.delivery === 'SUPPRESSED' ? { outbox: sent.outbox } : {}),
    }, 200)
  } catch (error) {
    return openErrorResponse(error, 'dupr-export')
  }
}

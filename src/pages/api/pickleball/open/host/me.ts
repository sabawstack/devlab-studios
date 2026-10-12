import type { APIRoute } from 'astro'
import { getEnv } from '../../../../../lib/env'
import { drainRequestBody } from '../../../../../lib/http'
import { HOST_PROFILE_PATCH_FALLBACK, HOST_PROFILE_PATCH_MESSAGES, hostProfilePatchSchema } from '../../../../../lib/schemas/pickleball/open/host'
import { deleteHost, MAX_LISTED_SESSIONS, toHostProfile, updateHostProfile } from '../../../../../worker/repositories/pickleball/open/hosts'
import { clearHostCookieHeader, currentHost, hostAccountIpLimited, signInFirst } from '../../../../../worker/pickleball/open/hostSession'
import { fieldMessage, readSmallJson } from '../../../../../worker/pickleball/open/requestBody'
import { openErrorResponse, openSessionStub } from '../../../../../worker/pickleball/open/routeHelpers'
import { crossSiteRefusal } from '../../../../../worker/pickleball/open/sameOrigin'
import { jsonResponse } from '../../../../../worker/utils/responses.js'

/** The signed-in host's own profile, or { host: null }. Never the Google subject id. */
export const GET: APIRoute = async ({ request }) => {
  const env = getEnv()
  try {
    const limited = await hostAccountIpLimited(env, request)
    if (limited) return limited
    const host = await currentHost(env, request)
    return jsonResponse({ host: host ? toHostProfile(host) : null }, 200)
  } catch (error) {
    return openErrorResponse(error, 'host.me')
  }
}

const MAX_BODY_BYTES = 1024

/** Saves the DUPR Club ID (spec §9.3) and/or the marketing choice. */
export const PATCH: APIRoute = async ({ request }) => {
  const env = getEnv()
  try {
    // Cross-site or limited (403/429), then signed out (401), then a bad body (400).
    const refused = crossSiteRefusal(request) ?? (await hostAccountIpLimited(env, request))
    if (refused) {
      await drainRequestBody(request)
      return refused
    }
    const body = await readSmallJson(request, MAX_BODY_BYTES)
    if (!body.ok) return body.response
    const host = await currentHost(env, request)
    if (!host) return signInFirst()
    const parsed = hostProfilePatchSchema.safeParse(body.value)
    if (!parsed.success) return jsonResponse({ error: fieldMessage(parsed.error, HOST_PROFILE_PATCH_MESSAGES, HOST_PROFILE_PATCH_FALLBACK) }, 400)
    const updated = await updateHostProfile(env.PICKLEBALL_DB, host.id, parsed.data)
    return updated ? jsonResponse({ host: toHostProfile(updated) }, 200) : signInFirst()
  } catch (error) {
    return openErrorResponse(error, 'host.me.patch')
  }
}

/**
 * "Delete my account" (spec §3.2): removes the host row and every login,
 * unlinks (does not delete) the sessions it had claimed and revokes the extra
 * host links minted for them from My sessions. The sessions keep running on
 * their original host key and expire 7 days after their last change.
 */
export const DELETE: APIRoute = async ({ request, locals }) => {
  const env = getEnv()
  try {
    await drainRequestBody(request)
    const refused = crossSiteRefusal(request) ?? (await hostAccountIpLimited(env, request))
    if (refused) return refused
    const host = await currentHost(env, request)
    if (!host) return signInFirst()
    const codes = await deleteHost(env.PICKLEBALL_DB, host.id)
    // D1 is already unlinked and the extra keys deleted; this only refreshes coordinators holding
    // the session in memory (and downgrades sockets on a revoked key). Bounded, and after the response.
    const forget = Promise.allSettled(codes.slice(0, MAX_LISTED_SESSIONS).map((code) => openSessionStub(env, code).forgetHost(host.id)))
    if (locals?.cfContext) locals.cfContext.waitUntil(forget)
    else await forget
    return jsonResponse({ deleted: true, unlinkedSessions: codes.length }, 200, { 'Set-Cookie': clearHostCookieHeader(request) })
  } catch (error) {
    return openErrorResponse(error, 'host.me.delete')
  }
}

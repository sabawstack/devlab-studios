// CSRF guard for every state-changing route that trusts the host cookie
// (spec §9: claim, export, account changes, sign-out, reopen). The cookie is
// SameSite=Lax, so a browser does not send it on a cross-site POST; this
// check refuses the request outright as well, so the defence never rests on
// one browser feature. Browsers send Origin on every POST, PATCH and DELETE;
// a request without Origin must at least say it came from this site.
import { jsonResponse } from '../../utils/responses.js'

export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('Origin')
  if (origin) return origin === new URL(request.url).origin
  return request.headers.get('Sec-Fetch-Site') === 'same-origin'
}

/** The 403 to send when the request did not come from this site, or null. The caller drains any body first. */
export function crossSiteRefusal(request: Request): Response | null {
  return isSameOrigin(request) ? null : jsonResponse({ error: 'That request did not come from this site.' }, 403)
}

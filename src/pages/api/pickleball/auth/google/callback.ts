import type { APIRoute } from 'astro'
import { exchangeGoogleCode, fetchGoogleProfile } from '../../../../../worker/pickleball/oauth.js'
import { upsertUserByGoogleSub } from '../../../../../worker/repositories/pickleball/users.js'
import { listActiveMembershipsForEmail, linkMembershipUser } from '../../../../../worker/repositories/pickleball/memberships.js'
import { getPendingInviteForEmail } from '../../../../../worker/repositories/pickleball/organizationInvites.js'
import {
  resolveActiveOrgId,
  buildLoginRateLimitKey,
  isLoginRateLimited,
  recordFailedLogin,
  clearFailedLogins,
} from '../../../../../worker/pickleball/authContext.js'
import { signSession, buildSetCookieHeader, buildClearCookieHeader } from '../../../../../worker/pickleball/session.js'
import { SESSION_COOKIE_NAME } from '../../../../../worker/pickleball/session.js'
import { getEnv } from '../../../../../lib/env'
import { parseCookies } from '../../../../../worker/pickleball/session.js'
import { jsonResponse } from '../../../../../worker/utils/responses.js'
import { finishHostSignIn, hostOwnsCallback, LEGACY_OAUTH_COOKIE } from '../../../../../worker/pickleball/open/hostAuth'

const OAUTH_COOKIE_NAME = LEGACY_OAUTH_COOKIE
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 8

// The SPA is mounted at /pickleball/app and renders LoginPage for an
// unauthenticated visit, reading ?error= to explain why the attempt failed.
// There is no standalone /pickleball/login route, so every failure redirect
// must target the SPA mount point or it would 404.
const LOGIN_PATH = '/pickleball/app'

// The callback Google redirects to is registered once and cannot move (spec
// §9.1), so this one route serves both sign-ins. A free-session host sign-in
// (open/host/sign-in) owns it whenever its own in-flight cookie is present, or
// when neither flow's cookie is (hostOwnsCallback, unit-tested in
// hostAuth.test.ts). Phase 5 deletes the old
// operator app: it then deletes legacyOperatorCallback and every import only
// it uses, and GET becomes a one-line call to finishHostSignIn.
export const GET: APIRoute = async (context) => {
  const { request } = context
  if (hostOwnsCallback(request)) {
    return finishHostSignIn(getEnv(), request)
  }
  return legacyOperatorCallback(context)
}

const legacyOperatorCallback: APIRoute = async ({ request }) => {
  const env = getEnv()
  const url = new URL(request.url)
  const secure = url.protocol === 'https:'
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')

  const cookies = parseCookies(request.headers.get('Cookie')) as Record<string, string>
  const clearOauthCookie = buildClearCookieHeader(OAUTH_COOKIE_NAME, { secure })

  let stashed
  try {
    stashed = JSON.parse(decodeURIComponent(cookies['devlab_pb_oauth'] || ''))
  } catch {
    stashed = null
  }

  if (!code || !state || !stashed?.state || stashed.state !== state) {
    return jsonResponse({ error: 'Invalid OAuth state.' }, 400)
  }

  // Fail fast on misconfiguration before spending a round-trip to Google —
  // without this check, signSession would silently HMAC the literal string
  // "undefined" as the secret, issue a cookie that looks like a successful
  // login, and only fail later (503) on the very next authenticated request.
  if (!env.PICKLEBALL_SESSION_SECRET) {
    return jsonResponse({ error: 'Pickleball session secret is not configured.' }, 503, { 'Set-Cookie': clearOauthCookie })
  }

  try {
    const redirectUri = `${env.PICKLEBALL_OAUTH_REDIRECT_BASE_URL}/api/pickleball/auth/google/callback`
    const { accessToken } = await exchangeGoogleCode({
      code,
      codeVerifier: stashed.verifier,
      clientId: env.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      redirectUri,
    })

    const profile = await fetchGoogleProfile(accessToken)

    // Google only guarantees `email` is actually owned by the account when
    // email_verified is true. Since profile.email is used directly as the
    // authorization key below (which org memberships it can claim / link
    // to), an unverified email must never be allowed to log in or link.
    if (!profile.emailVerified) {
      return new Response(null, {
        status: 302,
        headers: { Location: `${LOGIN_PATH}?error=email_not_verified`, 'Set-Cookie': clearOauthCookie },
      })
    }

    // Same ip:email throttle as the test-login bypass. Without it the
    // "no memberships" branch below is an email-enumeration oracle: an
    // attacker who controls many Google accounts (or one account plus a
    // scripted consent loop) can distinguish "invited" from "not invited"
    // by whether they land on the dashboard or the ?error=no_access page.
    // This branch is reached by a top-level browser navigation, so it
    // redirects (rather than returning a raw 429 body the user would see as
    // JSON) — the SPA's LoginPage renders the throttling message.
    const loginKey = buildLoginRateLimitKey(request, profile.email)
    if (await isLoginRateLimited(env, loginKey)) {
      return new Response(null, {
        status: 302,
        headers: { Location: `${LOGIN_PATH}?error=too_many_attempts`, 'Set-Cookie': clearOauthCookie },
      })
    }

    const user = await upsertUserByGoogleSub(env.PICKLEBALL_DB, {
      googleSub: profile.sub,
      email: profile.email,
      name: profile.name,
      avatarUrl: profile.picture,
    })

    if (!user) {
      return jsonResponse({ error: 'Failed to create or update user.' }, 500, { 'Set-Cookie': clearOauthCookie })
    }

    const memberships = await listActiveMembershipsForEmail(env.PICKLEBALL_DB, profile.email)

    if (!memberships.length) {
      const pendingInvite = await getPendingInviteForEmail(env.PICKLEBALL_DB, profile.email)
      if (pendingInvite) {
        await clearFailedLogins(env, loginKey)
        const now = Math.floor(Date.now() / 1000)
        const token = await signSession(
          { userId: user.id, googleSub: user.googleSub, activeOrgId: null, iat: now, exp: now + SESSION_MAX_AGE_SECONDS },
          env.PICKLEBALL_SESSION_SECRET,
        )
        return new Response(null, {
          status: 302,
          headers: {
            Location: `/pickleball/accept-invite/${pendingInvite.token}`,
            'Set-Cookie': buildSetCookieHeader(SESSION_COOKIE_NAME, token, { secure, maxAgeSeconds: SESSION_MAX_AGE_SECONDS }),
          },
        })
      }

      await recordFailedLogin(env, loginKey)
      return new Response(null, {
        status: 302,
        headers: { Location: `${LOGIN_PATH}?error=no_access`, 'Set-Cookie': clearOauthCookie },
      })
    }

    await clearFailedLogins(env, loginKey)

    // Link every active membership for this email to the real user id now
    // that we have one — requirePickleballSession's getMembership() lookup
    // is by (organizationId, userId), so without this every request after
    // login would find no membership and be rejected as unauthorized.
    await Promise.all(
      memberships.map((membership: { organizationId: string }) =>
        linkMembershipUser(env.PICKLEBALL_DB, {
          organizationId: membership.organizationId,
          invitedEmail: profile.email,
          userId: user.id,
        }),
      ),
    )

    const activeOrgId = resolveActiveOrgId(memberships, null)
    const now = Math.floor(Date.now() / 1000)
    const token = await signSession(
      { userId: user.id, googleSub: user.googleSub, activeOrgId, iat: now, exp: now + SESSION_MAX_AGE_SECONDS },
      env.PICKLEBALL_SESSION_SECRET,
    )

    return new Response(null, {
      status: 302,
      headers: {
        Location: '/pickleball/app',
        'Set-Cookie': buildSetCookieHeader(SESSION_COOKIE_NAME, token, { secure, maxAgeSeconds: SESSION_MAX_AGE_SECONDS }),
      },
    })
  } catch (error) {
    // exchangeGoogleCode / fetchGoogleProfile throw tagged 502s on routine
    // conditions (expired/reused code, a transient Google 4xx, network
    // failure) — none of that should surface as a raw unhandled 500 to the
    // user, so send them back to login with a friendly error instead. The
    // real reason is only useful server-side, so log it rather than leaking
    // it into the redirect URL.
    console.error(
      JSON.stringify({
        event: 'pickleball_oauth_callback_failed',
        errorMessage: error instanceof Error ? error.message : String(error),
      }),
    )

    return new Response(null, {
      status: 302,
      headers: { Location: `${LOGIN_PATH}?error=oauth_failed`, 'Set-Cookie': clearOauthCookie },
    })
  }
}

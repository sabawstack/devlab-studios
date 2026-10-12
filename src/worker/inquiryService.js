import { createInquiry, findLeadByIdempotencyKey, findRecentDuplicateLead } from './repositories/leads.js'
import { buildActivityStatement, buildAttributionStatement, buildConsentStatement } from './repositories/leadContext.js'
import { attemptLeadDelivery } from './leadDelivery.js'
import { verifyTurnstileToken } from './turnstile.js'
import { checkRateLimit, clientIp, rateLimitedResponse } from './rateLimit.js'
import { qualifyInquiry } from '../lib/leads/qualification'
import { computeIdempotencyKey, normalizeInquiry } from '../lib/leads/normalize'
import { CONSENT_TEXT_VERSION, PRIVACY_POLICY_VERSION } from '../config/consent.js'
import { attributeInquiry } from '../lead-engine/tracking/attribution.js'
import { discardUnreadBody } from '../lib/http'

/**
 * The submission pipeline, in one place, shared by every public form.
 *
 * Order matters and is the point of this file:
 *
 *   rate limit -> anti-spam -> normalize -> idempotency -> PERSIST
 *   -> consent + attribution -> qualify -> background delivery
 *
 * The inquiry is durably in D1 before any external call is attempted, so a
 * Resend outage, a webhook timeout, or a misconfigured key can leave a lead
 * visibly undelivered but can never lose it. The response the visitor sees is
 * decided by whether the WRITE succeeded, never by whether the email did.
 */

const INQUIRY_WINDOW_MS = 10 * 60 * 1000
const INQUIRY_MAX_ATTEMPTS = 5
/** Hard cap before the body is even parsed — an unbounded POST never reaches Zod. */
export const MAX_REQUEST_BYTES = 32 * 1024

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

/**
 * Reads the request body with a size ceiling. Content-Length is advisory
 * (a chunked request has none), so the decoded text is checked too.
 */
/**
 * @param {Request} request
 * @param {{ DRAIN_UNREAD_BODIES?: string }} [env] only to drop a refused body in local dev
 */
export async function readBoundedJson(request, env) {
  const declaredLength = Number(request.headers.get('content-length') || 0)
  if (declaredLength > MAX_REQUEST_BYTES) {
    // Refused unread; see discardUnreadBody for why local dev drops it first.
    await discardUnreadBody(request, env)
    return { error: jsonResponse({ error: 'Request payload is too large.' }, 413) }
  }

  const text = await request.text().catch(() => null)
  if (text === null) return { error: jsonResponse({ error: 'Invalid request body.' }, 400) }
  if (text.length > MAX_REQUEST_BYTES) {
    return { error: jsonResponse({ error: 'Request payload is too large.' }, 413) }
  }

  try {
    return { data: JSON.parse(text) }
  } catch {
    return { error: jsonResponse({ error: 'Invalid JSON payload.' }, 400) }
  }
}

/**
 * Flattens Zod issues into `{ field: message }` for inline display. Only the
 * schema's own messages are returned — never raw input, never internals.
 */
export function fieldErrorsFromZod(error) {
  const fields = {}
  for (const issue of error.issues || []) {
    const path = issue.path.join('.')
    if (path && !fields[path]) fields[path] = issue.message
  }
  return fields
}

export async function enforceSubmissionGuards(env, request, { bucket, action, allowMissingSecret = false, turnstileToken }) {
  const rate = await checkRateLimit(env, bucket, clientIp(request), {
    limit: INQUIRY_MAX_ATTEMPTS,
    windowMs: INQUIRY_WINDOW_MS,
  })
  if (rate.limited) {
    return rateLimitedResponse('Too many submissions. Please try again later.', rate.retryAfterSeconds)
  }

  const requestHostname = new URL(request.url).hostname
  const isLocalRequest = requestHostname === 'localhost' || requestHostname === '127.0.0.1'
  const turnstileResult = await verifyTurnstileToken(env.TURNSTILE_SECRET_KEY, turnstileToken, clientIp(request), {
    expectedHostname: requestHostname,
    expectedAction: action,
    allowMissingSecret: allowMissingSecret || isLocalRequest,
  })

  if (turnstileResult.ok) return null

  console.log(JSON.stringify({ event: 'inquiry_submission', outcome: 'turnstile_rejected', reason: turnstileResult.reason }))
  if (turnstileResult.reason === 'configuration-missing' || turnstileResult.reason === 'verification-request-failed') {
    return jsonResponse(
      { code: 'verification_unavailable', error: 'Verification is temporarily unavailable. Please try again later.' },
      503,
    )
  }
  if (turnstileResult.reason === 'timeout-or-duplicate') {
    return jsonResponse({ code: 'verification_expired', error: 'Verification expired. Please try again.' }, 400)
  }
  return jsonResponse({ code: 'verification_failed', error: "We couldn't verify the request. Please retry." }, 400)
}

/**
 * Persists the inquiry, its consent record, its attribution, and its first
 * activity entries.
 *
 * The lead row is inserted on its own first (so its id exists), then the three
 * context rows go in one `db.batch()` — D1 does not implicitly wrap sequential
 * `.run()` calls in a transaction, and a half-written context is worse than a
 * missing one. A context-write failure is logged but never fails the request:
 * the inquiry itself is already safe, and refusing the submission at that
 * point would lose a real lead over a secondary record.
 */
async function persistInquiry(env, normalized, { qualification, attribution, consent, consentType, idempotencyKey }) {
  const lead = await createInquiry(env.DB, {
    ...normalized,
    qualification: qualification.result,
    qualificationScore: qualification.score,
    qualificationReasons: qualification.reasons,
    idempotencyKey,
  })

  if (!lead) return null

  try {
    await env.DB.batch([
      buildConsentStatement(
        env.DB,
        lead.id,
        {
          consentType,
          granted: consent.granted,
          consentTextVersion: consent.consentTextVersion || CONSENT_TEXT_VERSION,
          privacyPolicyVersion: consent.privacyPolicyVersion || PRIVACY_POLICY_VERSION,
        },
        normalized.source,
      ),
      buildAttributionStatement(env.DB, lead.id, attribution),
      buildActivityStatement(env.DB, lead.id, {
        activityType: 'received',
        status: 'ok',
        metadata: { source: normalized.source, inquiryType: normalized.inquiryType, formId: attribution.formId || '' },
      }),
      buildActivityStatement(env.DB, lead.id, {
        activityType: 'qualified',
        status: 'ok',
        metadata: {
          result: qualification.result,
          score: qualification.score,
          route: qualification.route,
          requiresHumanReview: qualification.requiresHumanReview,
        },
      }),
    ])
  } catch (error) {
    console.error('[inquiry] context write failed', { leadId: lead.id, message: error instanceof Error ? error.message : 'unknown' })
  }

  return lead
}

function scheduleDelivery(env, locals, lead) {
  // attemptLeadDelivery records its own failures; this catch is only a
  // last-resort net so a bug there can never surface as an unhandled
  // rejection in the background task.
  const task = attemptLeadDelivery(env, lead).catch((error) => {
    console.log(
      JSON.stringify({
        event: 'lead_delivery',
        outcome: 'unhandled_error',
        leadId: lead.id,
        error: error instanceof Error ? error.message : String(error),
      }),
    )
  })

  if (locals?.cfContext) {
    locals.cfContext.waitUntil(task)
    return null
  }
  // Dev fallback (astro preview / no cfContext) — returned so the caller can
  // await it inline rather than letting it be dropped.
  return task
}

/**
 * @param {{ DB: import('@cloudflare/workers-types').D1Database }} env
 * @param {{ input: object, source: string, consentType: string, locals?: object,
 *           request?: Request|null }} options `request` is read ONLY for the
 *   Lead Intelligence Engine's first-party attribution cookie; it cannot affect
 *   the response.
 */
export async function submitInquiry(env, { input, source, consentType, locals, request = null }) {
  if (!env.DB) {
    return jsonResponse({ error: 'Server misconfiguration: D1 DB binding missing.' }, 503)
  }

  const normalized = normalizeInquiry(input, source)
  const attribution = input.attribution || {}
  const idempotencyKey = await computeIdempotencyKey({
    inquiryType: normalized.inquiryType,
    email: normalized.email,
    message: normalized.message,
  })

  // Two independent dedupe layers: the deterministic key (covers the common
  // double-submit) and the content window (covers a resubmission that fell
  // into a different time bucket). Either match short-circuits before any
  // second notification is sent.
  const existing =
    (await findLeadByIdempotencyKey(env.DB, idempotencyKey)) ||
    (await findRecentDuplicateLead(env.DB, { email: normalized.email, message: normalized.message }))

  if (existing) {
    return jsonResponse({ ok: true, id: existing.id, duplicate: true, persisted: true })
  }

  const qualification = qualifyInquiry({
    inquiryType: normalized.inquiryType,
    email: normalized.email,
    message: normalized.message,
    company: normalized.company,
    website: normalized.website,
    currentWorkflow: normalized.currentWorkflow,
    desiredOutcome: normalized.desiredOutcome,
    currentTools: normalized.currentTools,
    teamSize: normalized.teamSize,
    timeline: normalized.timeline,
    budgetRange: normalized.budgetRange,
    volume: normalized.volume,
  })

  let lead
  try {
    lead = await persistInquiry(env, normalized, {
      qualification,
      attribution,
      consent: input.consent || { granted: true },
      consentType,
      idempotencyKey,
    })
  } catch (error) {
    // A UNIQUE violation here means a concurrent request won the race with the
    // same idempotency key — that is a duplicate, not a failure.
    const message = error instanceof Error ? error.message : ''
    if (/UNIQUE|constraint/i.test(message)) {
      const raced = await findLeadByIdempotencyKey(env.DB, idempotencyKey)
      if (raced) return jsonResponse({ ok: true, id: raced.id, duplicate: true, persisted: true })
    }
    console.error('[inquiry] persistence failed', { message })
    lead = null
  }

  if (!lead) {
    return jsonResponse(
      { code: 'persistence_failed', error: 'We could not save your inquiry. Please try again in a moment.' },
      500,
    )
  }

  const inlineTask = scheduleDelivery(env, locals, lead)
  if (inlineTask) await inlineTask

  // Lead Intelligence Engine attribution. Fire-and-forget, fully contained, and
  // deliberately AFTER the lead is persisted and delivery is scheduled: it
  // cannot change this response, cannot delay it, and cannot fail it. When the
  // engine is disabled, when no tracking cookie is present, or when anything at
  // all goes wrong, `attributeInquiry` returns quietly. See
  // src/lead-engine/tracking/attribution.js.
  if (request) {
    const attribution = attributeInquiry(env, { request, inboundLeadId: lead.id })
    if (locals?.cfContext) locals.cfContext.waitUntil(attribution)
    else await attribution
  }

  // `persisted: true` is what the client uses to decide whether to report a
  // conversion — never the delivery outcome, which happens after this responds.
  return jsonResponse({
    ok: true,
    id: lead.id,
    persisted: true,
    inquiryType: lead.inquiryType,
  })
}

export { jsonResponse }

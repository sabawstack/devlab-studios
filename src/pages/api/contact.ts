import type { APIRoute } from 'astro'
import { getEnv } from '../../lib/env'
import {
  allowedSource,
  CONTACT_SOURCES,
  enforceSubmissionGuards,
  jsonResponse,
  readBoundedJson,
  singleLine,
  submitInquiry,
} from '../../worker/inquiryService.js'
import { CONSENT_TYPES, PRIVACY_POLICY_VERSION } from '../../config/consent.js'

export const prerender = false

/**
 * The legacy four-field contact endpoint.
 *
 * Kept as a stable public contract — the Pickleball club form on
 * /pickleball still posts this shape, and so may anything external — but it no
 * longer has its own pipeline. It normalizes into the inquiry shape and hands
 * off to the same persist-then-deliver service as /api/inquiries, so both
 * paths share one set of guarantees rather than drifting apart.
 *
 * Submissions arriving here are recorded as `general` inquiries with consent
 * marked as implied by the act of submitting, under its own consent-text
 * version so it is never confused with an explicit checkbox.
 */

const LEGACY_CONSENT_TEXT_VERSION = 'implied-legacy-contact-form'

interface ContactPayload {
  name?: string
  email?: string
  subject?: string
  message?: string
  source?: string
  turnstileToken?: string
}

const LIMITS: Record<string, number> = { name: 120, email: 254, subject: 180, message: 5000 }

function validateContactPayload(payload: ContactPayload): string | null {
  const required = Object.keys(LIMITS)
  const missing = required.filter((key) => !String(payload[key as keyof ContactPayload] || '').trim())
  if (missing.length > 0) {
    return `Missing required fields: ${missing.join(', ')}`
  }

  const oversized = required.filter((key) => String(payload[key as keyof ContactPayload] || '').length > LIMITS[key])
  if (oversized.length > 0) {
    return `Fields exceed maximum length: ${oversized.join(', ')}`
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(payload.email || '').trim())) {
    return 'Email address is invalid.'
  }

  return null
}

export const POST: APIRoute = async ({ request, locals }) => {
  const env = getEnv()

  const body = await readBoundedJson(request, env)
  if (body.error) return body.error

  const payload = (body.data || {}) as ContactPayload
  const validationError = validateContactPayload(payload)
  if (validationError) {
    return jsonResponse({ error: validationError }, 400)
  }

  const guardResponse = await enforceSubmissionGuards(env, request, {
    bucket: 'contact',
    action: 'contact_form',
    turnstileToken: payload.turnstileToken,
  })
  if (guardResponse) return guardResponse

  const response = await submitInquiry(env, {
    input: {
      inquiryType: 'general',
      fullName: String(payload.name || ''),
      email: String(payload.email || ''),
      message: String(payload.message || ''),
      // The legacy subject is visitor-written and carries real meaning (the
      // Pickleball beta form relies on it), so it is preserved verbatim
      // instead of being replaced by the type-derived one. Line breaks are
      // flattened, so it can never carry a header if delivery ever builds raw mail.
      subjectOverride: singleLine(String(payload.subject || '')),
      company: '',
      website: '',
      phone: '',
      currentWorkflow: '',
      desiredOutcome: '',
      currentTools: '',
      teamSize: '',
      timeline: '',
      budgetRange: '',
      volume: '',
      preferredContact: 'email',
      solutionInterest: '',
      roleTitle: '',
      employmentType: '',
      workArrangement: '',
      locationRequirement: '',
      jobPostingUrl: '',
      hiringTimeline: '',
      attribution: { formId: 'legacy-contact-form' },
      consent: {
        granted: true,
        consentTextVersion: LEGACY_CONSENT_TEXT_VERSION,
        privacyPolicyVersion: PRIVACY_POLICY_VERSION,
      },
    },
    source: allowedSource(payload.source, CONTACT_SOURCES),
    consentType: CONSENT_TYPES.contact,
    locals,
    // Passed through solely so the Lead Intelligence Engine can read its
    // first-party attribution cookie. It cannot affect this response.
    request,
  })

  // The historical success body was exactly `{ ok: true }`; callers that only
  // check `ok` keep working, and the extra fields are additive.
  return response
}

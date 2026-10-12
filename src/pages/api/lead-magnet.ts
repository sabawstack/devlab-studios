import type { APIRoute } from 'astro'
import { getEnv } from '../../lib/env'
import { leadMagnetRequestSchema } from '../../lib/schemas/inquiry'
import {
  enforceSubmissionGuards,
  fieldErrorsFromZod,
  jsonResponse,
  readBoundedJson,
  submitInquiry,
} from '../../worker/inquiryService.js'
import { CONSENT_TYPES } from '../../config/consent.js'
import { LEAD_MAGNET_SOURCE } from '../../worker/leadDelivery.js'
import { getLeadMagnet } from '../../config/offers.js'

export const prerender = false

/**
 * Minimal-friction lead-magnet capture.
 *
 * Runs through the same persistence, consent, attribution, and delivery
 * pipeline as a full inquiry — the only differences are the smaller form and
 * that the confirmation email carries the requested resource. The offer is
 * resolved server-side from `src/config/offers.js` by id, so the submission
 * can never choose what URL gets emailed.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const env = getEnv()

  const body = await readBoundedJson(request, env)
  if (body.error) return body.error

  const parsed = leadMagnetRequestSchema.safeParse(body.data)
  if (!parsed.success) {
    return jsonResponse(
      {
        code: 'validation_failed',
        error: 'Some fields need attention before this can be submitted.',
        fields: fieldErrorsFromZod(parsed.error),
      },
      400,
    )
  }

  const offer = getLeadMagnet(parsed.data.offerId)
  if (!offer) {
    return jsonResponse({ code: 'unknown_offer', error: 'That resource is not available.' }, 404)
  }

  if (!parsed.data.consent.granted) {
    return jsonResponse(
      { code: 'validation_failed', error: 'Please confirm you agree before submitting.', fields: { 'consent.granted': 'Please confirm you agree before submitting.' } },
      400,
    )
  }

  const guardResponse = await enforceSubmissionGuards(env, request, {
    bucket: 'lead-magnet',
    action: 'contact_form',
    turnstileToken: parsed.data.turnstileToken,
  })
  if (guardResponse) return guardResponse

  return submitInquiry(env, {
    input: {
      inquiryType: 'general',
      fullName: parsed.data.fullName,
      email: parsed.data.email,
      message: `Requested resource: ${offer.title}`,
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
      solutionInterest: offer.id,
      roleTitle: '',
      employmentType: '',
      workArrangement: '',
      locationRequirement: '',
      jobPostingUrl: '',
      hiringTimeline: '',
      attribution: { ...parsed.data.attribution, offerId: offer.id },
      consent: parsed.data.consent,
    },
    source: LEAD_MAGNET_SOURCE,
    consentType: CONSENT_TYPES.leadMagnet,
    locals,
    // Passed through solely so the Lead Intelligence Engine can read its
    // first-party attribution cookie. It cannot affect this response.
    request,
  })
}

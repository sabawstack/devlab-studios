import type { APIRoute } from 'astro'
import { getEnv } from '../../lib/env'
import { inquiryRequestSchema } from '../../lib/schemas/inquiry'
import {
  allowedSource,
  enforceSubmissionGuards,
  fieldErrorsFromZod,
  INQUIRY_SOURCES,
  jsonResponse,
  readBoundedJson,
  submitInquiry,
} from '../../worker/inquiryService.js'
import { CONSENT_TYPES } from '../../config/consent.js'

export const prerender = false

/**
 * The single public inquiry endpoint. Every business, employment,
 * collaboration, partnership, and general submission comes through here;
 * `inquiryType` in the validated body is what differentiates them.
 *
 * `/api/contact` still exists and still works — it is the legacy four-field
 * shape, and it now delegates to the same pipeline as this route.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const env = getEnv()

  const body = await readBoundedJson(request, env)
  if (body.error) return body.error

  const parsed = inquiryRequestSchema.safeParse(body.data)
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

  const guardResponse = await enforceSubmissionGuards(env, request, {
    bucket: 'inquiry',
    action: 'contact_form',
    turnstileToken: parsed.data.turnstileToken,
  })
  if (guardResponse) return guardResponse

  return submitInquiry(env, {
    input: parsed.data,
    // Only a known form id becomes the source; anything else (including
    // `lead-magnet`) is recorded as the default. The id itself stays in attribution.
    source: allowedSource((parsed.data.attribution as { formId?: string })?.formId, INQUIRY_SOURCES),
    consentType: CONSENT_TYPES.contact,
    locals,
    // Passed through solely so the Lead Intelligence Engine can read its
    // first-party attribution cookie. It cannot affect this response.
    request,
  })
}

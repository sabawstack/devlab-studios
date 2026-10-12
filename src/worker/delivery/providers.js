/**
 * The external-delivery provider boundary.
 *
 * Every destination an inquiry can be pushed to implements the same tiny
 * contract: `{ name, isConfigured, send(payload) }` returning
 * `{ ok, statusCode, errorMessage, networkError }`. The orchestrator in
 * leadDelivery.js knows nothing else about them, so adding a CRM later means
 * adding one file here — not touching the pipeline.
 *
 * No provider is allowed to throw: a provider that cannot reach its upstream
 * returns a failure result, because a thrown error inside a background
 * delivery task is exactly how a lead silently disappears.
 */

/** Every outbound call is bounded — a hung upstream must never hold a request open. */
const DELIVERY_TIMEOUT_MS = 8000
const DEFAULT_SENDER = 'hello@devlabstudios.com'

async function fetchWithTimeout(url, init) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS)
  try {
    return { response: await fetch(url, { ...init, signal: controller.signal }) }
  } catch (error) {
    return { error: error instanceof Error ? error : new Error('Unknown network error') }
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Transactional email via Resend — the studio's existing provider.
 * `fromName` labels the sender (Devlab Pickleball mail says so); `attachments`
 * are Resend's `{ filename, content }` with base64 content.
 */
export function createResendProvider(env, { name = 'resend', fromName = 'DevLab Studios' } = {}) {
  return {
    name,
    isConfigured: Boolean(env.RESEND_API_KEY),
    configurationHint: 'RESEND_API_KEY is not configured.',
    async send({ to, replyTo, subject, text, html, attachments }) {
      const fromEmail = env.RESEND_FROM_EMAIL || DEFAULT_SENDER
      const { response, error } = await fetchWithTimeout('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: `${fromName} <${fromEmail}>`,
          to: [to],
          ...(replyTo ? { reply_to: replyTo } : {}),
          subject,
          text,
          html,
          ...(attachments?.length ? { attachments } : {}),
        }),
      })

      if (error) {
        return { ok: false, statusCode: null, networkError: true, errorMessage: error.message }
      }

      // Only the id is read back. The full provider response is deliberately
      // never stored — it can carry more recipient data than is needed to
      // know whether the send worked.
      const body = await response.json().catch(() => null)
      if (response.ok && body?.id) {
        return { ok: true, statusCode: response.status }
      }

      return {
        ok: false,
        statusCode: response.status,
        networkError: false,
        errorMessage: body?.message || `Upstream returned ${response.status}`,
      }
    },
  }
}

/**
 * Optional generic outbound webhook — the seam for a CRM, a sheet, an n8n or
 * Make workflow, or a task system, without this repository taking on a paid
 * third-party dependency. Entirely inert unless `LEAD_WEBHOOK_URL` is set, so
 * it costs nothing when unused and never has to be "turned off".
 */
export function createWebhookProvider(env) {
  return {
    name: 'webhook',
    isConfigured: Boolean(env.LEAD_WEBHOOK_URL),
    configurationHint: 'LEAD_WEBHOOK_URL is not configured.',
    async send({ payload }) {
      const { response, error } = await fetchWithTimeout(env.LEAD_WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Optional shared secret so the receiving end can reject anything
          // that did not come from this Worker.
          ...(env.LEAD_WEBHOOK_SECRET ? { 'X-DevLab-Signature': env.LEAD_WEBHOOK_SECRET } : {}),
        },
        body: JSON.stringify(payload),
      })

      if (error) {
        return { ok: false, statusCode: null, networkError: true, errorMessage: error.message }
      }
      if (response.ok) {
        return { ok: true, statusCode: response.status }
      }
      return {
        ok: false,
        statusCode: response.status,
        networkError: false,
        errorMessage: `Upstream returned ${response.status}`,
      }
    },
  }
}

/**
 * The outbound payload. An explicit allow-list rather than a spread of the
 * lead row, so a column added later is never accidentally shipped to a
 * third party.
 */
export function buildWebhookPayload(lead, attribution) {
  return {
    id: lead.id,
    inquiryType: lead.inquiryType,
    createdAt: lead.createdAt,
    name: lead.name,
    email: lead.email,
    company: lead.company,
    website: lead.website,
    phone: lead.phone,
    subject: lead.subject,
    message: lead.message,
    desiredOutcome: lead.desiredOutcome,
    currentWorkflow: lead.currentWorkflow,
    currentTools: lead.currentTools,
    teamSize: lead.teamSize,
    timeline: lead.timeline,
    budgetRange: lead.budgetRange,
    volume: lead.volume,
    preferredContact: lead.preferredContact,
    solutionInterest: lead.solutionInterest,
    roleTitle: lead.roleTitle,
    employmentType: lead.employmentType,
    workArrangement: lead.workArrangement,
    locationRequirement: lead.locationRequirement,
    jobPostingUrl: lead.jobPostingUrl,
    hiringTimeline: lead.hiringTimeline,
    qualification: lead.qualification,
    qualificationScore: lead.qualificationScore,
    attribution: attribution
      ? {
          entryPage: attribution.entryPage,
          sourcePage: attribution.sourcePage,
          referrer: attribution.referrer,
          utmSource: attribution.utmSource,
          utmMedium: attribution.utmMedium,
          utmCampaign: attribution.utmCampaign,
          utmTerm: attribution.utmTerm,
          utmContent: attribution.utmContent,
          formId: attribution.formId,
          offerId: attribution.offerId,
          solutionId: attribution.solutionId,
          caseStudyId: attribution.caseStudyId,
          insightId: attribution.insightId,
        }
      : null,
  }
}

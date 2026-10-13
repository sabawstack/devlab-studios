import { updateLeadStatus } from './repositories/leads.js'
import { countDeliveryAttempts, listDeliveryAttempts, recordDeliveryAttempt } from './repositories/deliveryAttempts.js'
import { getLeadAttribution, recordLeadActivity } from './repositories/leadContext.js'
import { buildConfirmationEmail, buildLeadMagnetEmail, buildNotificationEmail } from './delivery/messages.js'
import { buildWebhookPayload, createResendProvider, createWebhookProvider } from './delivery/providers.js'
import { classifyDeliveryFailure, isRetryable, nextRetryAt } from './delivery/classify.js'
import { claimConfirmationSlot, releaseConfirmationSlot } from './delivery/confirmationCap.js'
import { getLeadMagnet } from '../config/offers.js'
import { strictRecipient } from '../lead-engine/domain/domains.js'

const DEFAULT_RECIPIENT = 'hello@devlabstudios.com'
/** `leads.source` value that marks a lead-magnet capture rather than an inquiry. */
export const LEAD_MAGNET_SOURCE = 'lead-magnet'
/**
 * Attempts made inside one invocation before giving up and leaving the lead
 * retryable from the admin. Bounded on purpose: a Worker request budget is
 * not the place for an unbounded retry loop, and an inquiry that is already
 * durably persisted loses nothing by waiting for a human to press Retry.
 */
const MAX_ATTEMPTS_PER_INVOCATION = 3

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Which destinations this lead still needs. A target that has already
 * succeeded is never re-sent, so pressing Retry after a partial failure does
 * not email the visitor a second confirmation.
 */
async function pendingTargets(env, lead, attempts) {
  const succeeded = new Set(attempts.filter((attempt) => attempt.status === 'success').map((attempt) => attempt.target))

  const notificationProvider = createResendProvider(env, { name: 'resend' })
  const confirmationProvider = createResendProvider(env, { name: 'resend-confirmation' })
  const webhookProvider = createWebhookProvider(env)
  const attribution = await getLeadAttribution(env.DB, lead.id).catch(() => null)

  const targets = [
    {
      provider: notificationProvider,
      required: true,
      buildPayload: () => {
        const message = buildNotificationEmail(lead, { attribution })
        return {
          to: env.LEAD_NOTIFICATION_EMAIL || DEFAULT_RECIPIENT,
          replyTo: lead.email,
          subject: message.subject,
          text: message.text,
          html: message.html,
        }
      },
    },
    {
      provider: confirmationProvider,
      required: false,
      // Visitor-addressed mail is gated: one plain address, and at most one
      // confirmation per address per 24 hours (see delivery/confirmationCap.js).
      gate: (now) => confirmationGate(env, lead, now),
      release: (now) => releaseConfirmationSlot(env.DB, lead.email, now),
      buildPayload: () => {
        // The offer is resolved from the server-owned registry by id, never
        // from a URL the submission carried — see src/config/offers.js.
        const message =
          lead.source === LEAD_MAGNET_SOURCE
            ? buildLeadMagnetEmail(lead, getLeadMagnet(lead.solutionInterest))
            : buildConfirmationEmail(lead)
        return {
          to: lead.email,
          replyTo: env.LEAD_NOTIFICATION_EMAIL || DEFAULT_RECIPIENT,
          subject: message.subject,
          text: message.text,
          html: message.html,
        }
      },
    },
    {
      provider: webhookProvider,
      required: false,
      buildPayload: () => ({ payload: buildWebhookPayload(lead, attribution) }),
    },
  ]

  return targets.filter((target) => target.provider.isConfigured && !succeeded.has(target.provider.name))
}

/**
 * Whether the visitor confirmation may be sent now.
 *
 * FAILS CLOSED: if the cap cannot be checked (for instance the migration has
 * not been applied yet), the confirmation is skipped rather than sent
 * uncapped. The owner notification is a separate target and is unaffected.
 *
 * @returns {Promise<{ allowed: true } | { allowed: false, reason: string, message: string }>}
 */
async function confirmationGate(env, lead, now) {
  if (!strictRecipient(lead.email)) {
    return { allowed: false, reason: 'invalid_recipient', message: 'Not sent: the address is not a single valid recipient.' }
  }
  try {
    if (await claimConfirmationSlot(env.DB, lead.email, { now })) return { allowed: true }
    return {
      allowed: false,
      reason: 'recipient_daily_cap',
      message: 'Not sent: this address already received a confirmation in the last 24 hours.',
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'lead_delivery',
        outcome: 'confirmation_cap_unavailable',
        leadId: lead.id,
        error: error instanceof Error ? error.message : 'unknown',
      }),
    )
    return { allowed: false, reason: 'cap_unavailable', message: 'Not sent: the recipient cap could not be checked.' }
  }
}

async function deliverToTarget(env, lead, target) {
  let attemptNumber = (await countDeliveryAttempts(env.DB, lead.id, target.provider.name)) + 1

  const claimedAt = new Date()
  if (target.gate) {
    const verdict = await target.gate(claimedAt)
    if (!verdict.allowed) {
      // Recorded as a completed attempt (the schema admits only success or
      // failure) with the reason in error_category / error_message, so Retry
      // does not keep re-trying a send that was deliberately withheld and the
      // admin still shows why nothing went out.
      await recordDeliveryAttempt(env.DB, {
        leadId: lead.id,
        target: target.provider.name,
        attemptNumber,
        status: 'success',
        errorMessage: verdict.message,
        errorCategory: `skipped_${verdict.reason}`,
      })
      console.log(
        JSON.stringify({
          event: 'lead_delivery',
          outcome: 'skipped',
          leadId: lead.id,
          target: target.provider.name,
          reason: verdict.reason,
        }),
      )
      return { ok: true, target: target.provider.name, skipped: verdict.reason }
    }
  }

  const outcome = await sendWithRetries(env, lead, target, attemptNumber)
  if (!outcome.ok && target.release) {
    // Nothing went out, so the slot is given back and a later Retry may send.
    await target.release(claimedAt).catch((error) => {
      console.error(
        JSON.stringify({
          event: 'lead_delivery',
          outcome: 'confirmation_release_failed',
          leadId: lead.id,
          error: error instanceof Error ? error.message : 'unknown',
        }),
      )
    })
  }
  return outcome
}

async function sendWithRetries(env, lead, target, firstAttemptNumber) {
  let attemptNumber = firstAttemptNumber

  for (let tryIndex = 0; tryIndex < MAX_ATTEMPTS_PER_INVOCATION; tryIndex += 1) {
    const startedAt = Date.now()
    const result = await target.provider.send(target.buildPayload())
    const durationMs = Date.now() - startedAt

    if (result.ok) {
      await recordDeliveryAttempt(env.DB, {
        leadId: lead.id,
        target: target.provider.name,
        attemptNumber,
        status: 'success',
        statusCode: result.statusCode ?? null,
      })
      console.log(
        JSON.stringify({
          event: 'lead_delivery',
          outcome: 'success',
          leadId: lead.id,
          target: target.provider.name,
          attemptNumber,
          durationMs,
          statusCode: result.statusCode ?? null,
        }),
      )
      return { ok: true, target: target.provider.name }
    }

    const category = classifyDeliveryFailure(result)
    const retryable = isRetryable(category) && tryIndex < MAX_ATTEMPTS_PER_INVOCATION - 1

    await recordDeliveryAttempt(env.DB, {
      leadId: lead.id,
      target: target.provider.name,
      attemptNumber,
      status: 'failure',
      statusCode: result.statusCode ?? null,
      errorMessage: result.errorMessage,
      errorCategory: category,
      nextRetryAt: isRetryable(category) ? nextRetryAt(attemptNumber) : null,
    })

    // Never logs the lead's message, name, or email — only the id and the
    // upstream's own summary.
    console.log(
      JSON.stringify({
        event: 'lead_delivery',
        outcome: 'failure',
        leadId: lead.id,
        target: target.provider.name,
        attemptNumber,
        durationMs,
        statusCode: result.statusCode ?? null,
        errorCategory: category,
      }),
    )

    if (!retryable) {
      return { ok: false, target: target.provider.name, category }
    }

    await sleep(Math.min(400 * 2 ** tryIndex, 2000))
    attemptNumber += 1
  }

  return { ok: false, target: target.provider.name, category: 'transient' }
}

/**
 * Delivers a persisted inquiry to every configured destination and records
 * every attempt.
 *
 * Called from the submission pipeline's background `waitUntil()` task (first
 * attempt) and from the admin Retry action (any later attempt), so both share
 * identical logging, classification, and status behavior.
 *
 * The lead is already durably in D1 before this ever runs — nothing here can
 * lose it, only leave it visibly undelivered.
 *
 * @param {{ DB: import('@cloudflare/workers-types').D1Database }} env
 * @param {{ id: string }} lead
 */
export async function attemptLeadDelivery(env, lead) {
  const existingAttempts = await listDeliveryAttempts(env.DB, lead.id).catch(() => [])
  const targets = await pendingTargets(env, lead, existingAttempts)

  if (!targets.length) {
    const alreadyDelivered = existingAttempts.some(
      (attempt) => attempt.target === 'resend' && attempt.status === 'success',
    )
    if (alreadyDelivered) return { ok: true, results: [] }

    // Nothing is configured to deliver to. This is a configuration failure,
    // not a lost lead: the record is in D1 and visible in the admin.
    await recordDeliveryAttempt(env.DB, {
      leadId: lead.id,
      target: 'resend',
      attemptNumber: (await countDeliveryAttempts(env.DB, lead.id, 'resend')) + 1,
      status: 'failure',
      errorMessage: 'No delivery provider is configured.',
      errorCategory: 'configuration',
    })
    await updateLeadStatus(env.DB, lead.id, 'failed')
    await recordLeadActivity(env.DB, lead.id, {
      activityType: 'delivery',
      status: 'failed',
      metadata: { reason: 'no_provider_configured' },
    }).catch(() => {})
    console.log(JSON.stringify({ event: 'lead_delivery', outcome: 'failure', leadId: lead.id, reason: 'no_provider_configured' }))
    return { ok: false, results: [] }
  }

  const results = []
  for (const target of targets) {
    results.push(await deliverToTarget(env, lead, target))
  }

  const requiredFailed = targets.some(
    (target, index) => target.required && !results[index].ok,
  )
  const anyFailed = results.some((result) => !result.ok)
  const status = requiredFailed || anyFailed ? 'failed' : 'delivered'

  await updateLeadStatus(env.DB, lead.id, status)
  await recordLeadActivity(env.DB, lead.id, {
    activityType: 'delivery',
    status: status === 'delivered' ? 'ok' : 'failed',
    metadata: {
      targets: results.map((result) => ({ target: result.target, ok: result.ok, category: result.category || null })),
    },
  }).catch(() => {})

  return { ok: status === 'delivered', results }
}

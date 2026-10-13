import type { APIRoute } from 'astro'
import { STAGES } from '../../../../../../lead-engine/domain/pipeline.js'
import { ACTIVITY } from '../../../../../../lead-engine/domain/activity.js'
import { recordActivity } from '../../../../../../lead-engine/repositories/activity.js'
import { getPrimaryContact } from '../../../../../../lead-engine/repositories/contacts.js'
import { getLead, refreshNextAction, transitionLead, updateLeadSummary } from '../../../../../../lead-engine/repositories/leads.js'
import { addSuppression } from '../../../../../../lead-engine/repositories/suppression.js'
import { recordAuditEvent } from '../../../../../../worker/repositories/auditLog.js'
import { emailDomain } from '../../../../../../lead-engine/domain/domains.js'
import { leadActionSchema } from '../../../../../../lead-engine/schemas/index'
import {
  actorEmail,
  handleRoute,
  jsonResponse,
  notFound,
  readValidatedBody,
  requireDatabase,
} from '../../../../../../lead-engine/schemas/route'
import { withAdmin } from '../../../../../../lib/adminGuard'

export const prerender = false

/** Which pipeline stage and activity type each operator action produces. */
const ACTION_TARGETS = {
  hold: { stage: STAGES.HOLD, event: ACTIVITY.HELD },
  resume: { stage: STAGES.RESEARCHED, event: ACTIVITY.RESUMED },
  reject: { stage: STAGES.NOT_QUALIFIED, event: ACTIVITY.RULE_REJECTED },
  archive: { stage: STAGES.ARCHIVED, event: ACTIVITY.ARCHIVED },
  do_not_contact: { stage: STAGES.DO_NOT_CONTACT, event: ACTIVITY.DO_NOT_CONTACT },
  mark_won: { stage: STAGES.WON, event: ACTIVITY.WON },
  mark_lost: { stage: STAGES.LOST, event: ACTIVITY.LOST },
  // Nothing observes the mailbox any more, so the only thing that knows a
  // message actually went out is the person who pressed Send.
  mark_contacted: { stage: STAGES.CONTACTED, event: ACTIVITY.OUTBOUND_SEND_CONFIRMED },
} as const

/**
 * Operator actions on a lead.
 *
 * `do_not_contact` does two things, and both matter: it moves the lead to a
 * compliance-terminal stage it cannot leave, AND it writes a suppression entry.
 * The stage alone would be undone by any later transition; the suppression
 * entry is what makes the decision stick across campaigns and across the
 * address being rediscovered.
 */
const unguardedPOST: APIRoute = async (context) =>
  handleRoute(async () => {
    const database = requireDatabase()
    if (!database.ok) return database.response

    const body = await readValidatedBody(context.request, leadActionSchema)
    if (!body.ok) return body.response

    const db = database.env.DB
    const leadId = context.params.id!
    const email = actorEmail(context)

    const lead = await getLead(db, leadId)
    if (!lead) return notFound(context.request, 'Lead not found.')

    const { action, reason } = body.data

    if (action === 'set_priority') {
      await updateLeadSummary(db, leadId, { priority: body.data.priority })
      await recordActivity(db, {
        leadId,
        campaignId: lead.campaignId,
        eventType: ACTIVITY.NOTE_ADDED,
        actor: 'human',
        actorEmail: email,
        summary: `Priority set to ${body.data.priority}.`,
      })
      return jsonResponse({ ok: true, priority: body.data.priority })
    }

    if (action === 'do_not_contact') {
      const contact = await getPrimaryContact(db, leadId)

      if (contact) {
        await addSuppression(db, {
          scope: 'email',
          value: contact.email,
          reason: 'do_not_contact',
          source: 'manual',
          leadId,
          notes: reason,
          createdBy: email,
        })

        // Domain scope suppresses addresses at this business we have not even
        // discovered yet, which is what "do not contact this company" means.
        if (body.data.suppressDomain) {
          const domain = emailDomain(contact.email)
          if (domain) {
            await addSuppression(db, {
              scope: 'domain',
              value: domain,
              reason: 'do_not_contact',
              source: 'manual',
              leadId,
              notes: reason,
              createdBy: email,
            })
          }
        }
      }
    }

    const targetStage = action === 'set_stage' ? body.data.stage! : ACTION_TARGETS[action]?.stage
    const eventType = action === 'set_stage' ? ACTIVITY.STAGE_CHANGED : ACTION_TARGETS[action]?.event

    const moved = await transitionLead(db, leadId, targetStage!, {
      actor: 'human',
      actorEmail: email,
      eventType,
      summary: reason || `Moved to ${targetStage} by ${email || 'an admin'}.`,
      metadata: { action, reason },
    })

    if (!moved.moved) {
      // The refusal is almost always the compliance-terminal rule, and its
      // message names the suppression entry that has to be removed first.
      return jsonResponse({ error: moved.reason, stage: lead.stage }, 409)
    }

    if (action === 'hold') await updateLeadSummary(db, leadId, { holdReason: reason })
    if (action === 'mark_lost') await updateLeadSummary(db, leadId, { lostReason: reason })

    await refreshNextAction(db, leadId)

    await recordAuditEvent(db, {
      actorEmail: email,
      action: `lead.${action}`,
      entityType: 'lead',
      entityId: leadId,
      metadata: { from: moved.from, to: moved.to, reason },
    })

    return jsonResponse({ ok: true, stage: moved.to })
  })

// Authenticated per handler as well as by src/middleware.ts; see src/lib/adminGuard.ts.
export const POST = withAdmin(unguardedPOST)

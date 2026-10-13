import type { APIRoute } from 'astro'
import { ACTIVITY } from '../../../../../../lead-engine/domain/activity.js'
import { getCountryProfile } from '../../../../../../lead-engine/compliance/countryProfiles.js'
import { recordActivity } from '../../../../../../lead-engine/repositories/activity.js'
import {
  getComplianceReview,
  recordComplianceDecision,
} from '../../../../../../lead-engine/repositories/compliance.js'
import { getCompany } from '../../../../../../lead-engine/repositories/companies.js'
import { getLead, refreshNextAction } from '../../../../../../lead-engine/repositories/leads.js'
import { recordAuditEvent } from '../../../../../../worker/repositories/auditLog.js'
import { complianceDecisionSchema } from '../../../../../../lead-engine/schemas/index'
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

const unguardedGET: APIRoute = async ({ params, request }) =>
  handleRoute(async () => {
    const database = requireDatabase()
    if (!database.ok) return database.response

    const db = database.env.DB
    const lead = await getLead(db, params.id!)
    if (!lead) return notFound(request, 'Lead not found.')

    const [review, company] = await Promise.all([getComplianceReview(db, params.id!), getCompany(db, lead.companyId)])
    const profile = getCountryProfile(company?.countryCode || lead.countryCode)

    // The profile is returned alongside the review so the screen can explain
    // what each check MEANS, not just whether it passed.
    return jsonResponse({ review, profile })
  })

/**
 * Records a human compliance decision.
 *
 * Audited on its own action name because a waiver is the highest-consequence
 * manual act in this system: it is a person taking responsibility for
 * contacting someone the configured checks said to hold. The repository
 * separately requires a written reason for a waiver.
 */
const unguardedPOST: APIRoute = async (context) =>
  handleRoute(async () => {
    const database = requireDatabase()
    if (!database.ok) return database.response

    const body = await readValidatedBody(context.request, complianceDecisionSchema)
    if (!body.ok) return body.response

    const email = actorEmail(context)
    const leadId = context.params.id!

    const review = await recordComplianceDecision(database.env.DB, leadId, {
      ...body.data,
      reviewedBy: email,
    })

    await recordActivity(database.env.DB, {
      leadId,
      eventType: ACTIVITY.COMPLIANCE_REVIEWED,
      actor: 'human',
      actorEmail: email,
      summary: `Compliance review set to ${body.data.state}.`,
      metadata: { state: body.data.state, legalBasis: body.data.legalBasis },
    })

    await recordAuditEvent(database.env.DB, {
      actorEmail: email,
      action: body.data.state === 'waived' ? 'lead_compliance.waive' : 'lead_compliance.review',
      entityType: 'lead',
      entityId: leadId,
      metadata: { state: body.data.state, notes: body.data.notes },
    })

    await refreshNextAction(database.env.DB, leadId)
    return jsonResponse({ review })
  })

// Authenticated per handler as well as by src/middleware.ts; see src/lib/adminGuard.ts.
export const GET = withAdmin(unguardedGET)
export const POST = withAdmin(unguardedPOST)

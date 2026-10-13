import type { APIRoute } from 'astro'
import { listActivity } from '../../../../../../lead-engine/repositories/activity.js'
import { getLatestAiRun } from '../../../../../../lead-engine/repositories/aiRuns.js'
import { getComplianceReview } from '../../../../../../lead-engine/repositories/compliance.js'
import { getCompany } from '../../../../../../lead-engine/repositories/companies.js'
import { listContacts } from '../../../../../../lead-engine/repositories/contacts.js'
import { listConversations, listMessagesForLead } from '../../../../../../lead-engine/repositories/conversations.js'
import { listDrafts } from '../../../../../../lead-engine/repositories/drafts.js'
import { getLead } from '../../../../../../lead-engine/repositories/leads.js'
import { listCrawlRuns, listSignals } from '../../../../../../lead-engine/repositories/research.js'
import { getCurrentScore } from '../../../../../../lead-engine/repositories/scores.js'
import { listSourceRecordsForCompany } from '../../../../../../lead-engine/repositories/sources.js'
import { checkSuppression } from '../../../../../../lead-engine/repositories/suppression.js'
import { listTrackingTokens } from '../../../../../../lead-engine/repositories/tracking.js'
import { describeMxState } from '../../../../../../lead-engine/contacts/validate.js'
import { checkOutreachReadiness } from '../../../../../../lead-engine/services/outreach.js'
import { handleRoute, jsonResponse, notFound, requireDatabase } from '../../../../../../lead-engine/schemas/route'
import { withAdmin } from '../../../../../../lib/adminGuard'

export const prerender = false

/**
 * Everything the lead detail screen shows, in one request.
 *
 * One round trip rather than ten: the detail screen renders overview, research,
 * opportunity, contact, compliance, outreach, conversation and activity
 * together, and a request per panel would make opening a lead visibly slow over
 * a long connection.
 */
const unguardedGET: APIRoute = async ({ params, request }) =>
  handleRoute(async () => {
    const database = requireDatabase()
    if (!database.ok) return database.response

    const db = database.env.DB
    const leadId = params.id!

    const lead = await getLead(db, leadId)
    if (!lead) return notFound(request, 'Lead not found.')

    const [
      company,
      signals,
      crawlRuns,
      score,
      opportunityRun,
      contacts,
      compliance,
      drafts,
      conversations,
      messages,
      activity,
      trackingTokens,
      readiness,
    ] = await Promise.all([
      getCompany(db, lead.companyId),
      listSignals(db, leadId),
      listCrawlRuns(db, leadId, 5),
      getCurrentScore(db, leadId),
      getLatestAiRun(db, leadId, 'opportunity_review'),
      listContacts(db, leadId),
      getComplianceReview(db, leadId),
      listDrafts(db, { leadId, limit: 10 }),
      listConversations(db, { leadId }),
      listMessagesForLead(db, leadId),
      listActivity(db, { leadId, limit: 200 }),
      listTrackingTokens(db, leadId),
      // `persist: false` — this is a GET, and displaying a lead must not write to it.
      checkOutreachReadiness(database.env, leadId, { persist: false }),
    ])

    const sourceRecords = company ? await listSourceRecordsForCompany(db, company.id) : []

    // Suppression is resolved per contact so the UI can mark the specific
    // address that is blocked, rather than flagging the whole lead and leaving
    // the operator to work out which one.
    const contactsWithState = await Promise.all(
      contacts.map(async (contact: { email: string; mxPresent: boolean | null }) => {
        const suppression: { suppressed: boolean; entry: { reason?: string } | null } = await checkSuppression(
          db,
          contact.email,
        )
        return {
          ...contact,
          mxDescription: describeMxState(contact.mxPresent),
          suppressed: suppression.suppressed,
          suppressionReason: suppression.entry?.reason ?? null,
        }
      }),
    )

    return jsonResponse({
      lead,
      company,
      research: {
        signals,
        crawlRuns,
        pagesAnalyzed: crawlRuns[0]?.pages ?? [],
        technologies: signals.filter((signal) => signal.category === 'technology').map((signal) => signal.valueText),
      },
      score,
      // The AI run is exposed with its prompt version and model, because "which
      // prompt produced this" is the first question about any generated claim.
      opportunity: opportunityRun
        ? {
            ...opportunityRun.result,
            confidence: opportunityRun.confidence,
            model: opportunityRun.model,
            promptVersion: opportunityRun.promptVersion,
            createdAt: opportunityRun.createdAt,
          }
        : null,
      contacts: contactsWithState,
      compliance,
      drafts,
      conversations,
      messages,
      activity,
      trackingTokens,
      sourceRecords,
      readiness: { ready: readiness.ready, blockers: readiness.blockers },
    })
  })

// Authenticated per handler as well as by src/middleware.ts; see src/lib/adminGuard.ts.
export const GET = withAdmin(unguardedGET)

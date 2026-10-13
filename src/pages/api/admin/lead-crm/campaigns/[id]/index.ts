import type { APIRoute } from 'astro'
import { getCampaign, updateCampaign } from '../../../../../../lead-engine/repositories/campaigns.js'
import { countLeadsByStage } from '../../../../../../lead-engine/repositories/leads.js'
import { recordAuditEvent } from '../../../../../../worker/repositories/auditLog.js'
import { updateCampaignSchema } from '../../../../../../lead-engine/schemas/index'
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

    const campaign = await getCampaign(database.env.DB, params.id!)
    if (!campaign) return notFound(request, 'Campaign not found.')

    const stageCounts = await countLeadsByStage(database.env.DB, campaign.id)
    return jsonResponse({ campaign, stageCounts })
  })

const unguardedPATCH: APIRoute = async (context) =>
  handleRoute(async () => {
    const database = requireDatabase()
    if (!database.ok) return database.response

    const body = await readValidatedBody(context.request, updateCampaignSchema)
    if (!body.ok) return body.response

    const before = await getCampaign(database.env.DB, context.params.id!)
    if (!before) return notFound(context.request, 'Campaign not found.')

    const campaign = await updateCampaign(database.env.DB, context.params.id!, body.data)
    if (!campaign) return notFound(context.request, 'Campaign not found.')

    // Activation and arming the schedule are the two changes worth calling out
    // in the audit entry: both move a campaign from inert to capable of
    // spending money and touching other people's servers.
    await recordAuditEvent(database.env.DB, {
      actorEmail: actorEmail(context),
      action: 'lead_campaign.update',
      entityType: 'lead_campaign',
      entityId: campaign.id,
      metadata: {
        statusChanged: before.status !== campaign.status ? { from: before.status, to: campaign.status } : undefined,
        scheduleChanged:
          before.scheduleEnabled !== campaign.scheduleEnabled
            ? { from: before.scheduleEnabled, to: campaign.scheduleEnabled }
            : undefined,
      },
    })

    return jsonResponse({ campaign })
  })

// Authenticated per handler as well as by src/middleware.ts; see src/lib/adminGuard.ts.
export const GET = withAdmin(unguardedGET)
export const PATCH = withAdmin(unguardedPATCH)

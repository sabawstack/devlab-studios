import type { APIRoute } from 'astro'
import { ACTIVITY } from '../../../../../../lead-engine/domain/activity.js'
import { recordActivity } from '../../../../../../lead-engine/repositories/activity.js'
import { discardDraft, editDraft, getDraft } from '../../../../../../lead-engine/repositories/drafts.js'
import { validateGeneratedMessage } from '../../../../../../lead-engine/ai/validate.js'
import { draftEditSchema } from '../../../../../../lead-engine/schemas/index'
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

    const draft = await getDraft(database.env.DB, params.id!)
    if (!draft) return notFound(request, 'Draft not found.')

    return jsonResponse({ draft })
  })

/**
 * Applies a human edit.
 *
 * The content guard still runs, and its findings are returned — but they do NOT
 * block the save. A person editing their own outreach is allowed to write
 * whatever they judge correct; the guard exists to catch the MODEL inventing
 * things, and turning it into a restriction on the human would be both
 * patronizing and wrong, since they may well know a fact the engine does not.
 */
const unguardedPUT: APIRoute = async (context) =>
  handleRoute(async () => {
    const database = requireDatabase()
    if (!database.ok) return database.response

    const body = await readValidatedBody(context.request, draftEditSchema)
    if (!body.ok) return body.response

    const email = actorEmail(context)
    const draft = await editDraft(database.env.DB, context.params.id!, {
      subject: body.data.subject,
      bodyText: body.data.bodyText,
      actorEmail: email,
    })
    if (!draft) return notFound(context.request, 'Draft not found.')

    await recordActivity(database.env.DB, {
      leadId: draft.leadId,
      eventType: ACTIVITY.OUTREACH_DRAFT_EDITED,
      actor: 'human',
      actorEmail: email,
      summary: 'Edited the draft.',
      metadata: { draftId: draft.id },
    })

    const advisory = validateGeneratedMessage({ subject: draft.subject, body: draft.bodyText })
    return jsonResponse({ draft, advisory: advisory.violations })
  })

const unguardedDELETE: APIRoute = async ({ params }) =>
  handleRoute(async () => {
    const database = requireDatabase()
    if (!database.ok) return database.response

    await discardDraft(database.env.DB, params.id!)
    return jsonResponse({ ok: true })
  })

// Authenticated per handler as well as by src/middleware.ts; see src/lib/adminGuard.ts.
export const GET = withAdmin(unguardedGET)
export const PUT = withAdmin(unguardedPUT)
export const DELETE = withAdmin(unguardedDELETE)

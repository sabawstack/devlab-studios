import type { APIRoute } from 'astro'
import { exportDraft } from '../../../../../../lead-engine/services/draftExport.js'
import { recordAuditEvent } from '../../../../../../worker/repositories/auditLog.js'
import { actorEmail, handleRoute, jsonResponse, requireDatabase } from '../../../../../../lead-engine/schemas/route'
import { withAdmin } from '../../../../../../lib/adminGuard'

export const prerender = false

/**
 * Hands an approved draft to the operator as a file they send themselves.
 *
 * IT DOES NOT SEND, and there is no route in this application that does. There
 * is no longer even a mail provider configured to send through — see
 * lead-engine/mail/eml.js for why the mailbox integration was removed.
 *
 * GET returns the .eml as a download. POST returns the same message as JSON,
 * for the copy-to-clipboard path in the UI. Both run the identical gate chain
 * in `exportDraft`: suppression is re-checked at the moment of the click, and
 * an AI draft that tripped the content guard is refused.
 */
const unguardedGET: APIRoute = async (context) =>
  handleRoute(async () => {
    const database = requireDatabase()
    if (!database.ok) return database.response

    const email = actorEmail(context)
    const result = await exportDraft(database.env, context.params.id!, { actorEmail: email })

    await recordAuditEvent(database.env.DB, {
      actorEmail: email,
      action: 'lead_draft.exported',
      entityType: 'lead_draft',
      entityId: context.params.id!,
      metadata: { to: result.to, format: 'eml' },
    })

    return new Response(result.message, {
      headers: {
        'Content-Type': `${result.contentType}; charset=utf-8`,
        'Content-Disposition': `attachment; filename="${result.filename}"`,
        // A draft is per-operator and re-generated on demand; caching it would
        // hand back a stale body after an edit.
        'Cache-Control': 'no-store',
      },
    })
  })

const unguardedPOST: APIRoute = async (context) =>
  handleRoute(async () => {
    const database = requireDatabase()
    if (!database.ok) return database.response

    const email = actorEmail(context)
    const result = await exportDraft(database.env, context.params.id!, { actorEmail: email })

    await recordAuditEvent(database.env.DB, {
      actorEmail: email,
      action: 'lead_draft.exported',
      entityType: 'lead_draft',
      entityId: context.params.id!,
      metadata: { to: result.to, format: 'json' },
    })

    return jsonResponse({
      ...result,
      // Said explicitly, because this is the one place an operator could
      // reasonably assume otherwise.
      sent: false,
      instruction: 'Nothing has been sent. Open the file in your mail client, review it, and send it yourself.',
    })
  })

// Authenticated per handler as well as by src/middleware.ts; see src/lib/adminGuard.ts.
export const GET = withAdmin(unguardedGET)
export const POST = withAdmin(unguardedPOST)

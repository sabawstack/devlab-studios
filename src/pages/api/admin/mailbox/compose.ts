import type { APIRoute } from 'astro'
import { z } from 'zod'
import { composeNew } from '../../../../mailbox/services/reply.js'
import {
  actorEmail,
  handleRoute,
  jsonResponse,
  readValidatedBody,
  requireDatabase,
} from '../../../../lead-engine/schemas/route'
import { withAdmin } from '../../../../lib/adminGuard'

export const prerender = false

const composeSchema = z.object({
  toAddress: z.email().trim().max(320),
  subject: z.string().trim().max(500).optional().nullable(),
  bodyText: z.string().max(100_000),
  /** Save to Drafts instead of handing it to the transmitter. */
  asDraft: z.boolean().default(false),
  // Uploads to bind to this message, in the order the operator arranged them.
  // Validated and size-capped when claimed, not here -- the limit is per
  // message, and the message does not exist yet.
  attachmentIds: z.array(z.string().trim().min(1)).max(10).optional(),
})

/**
 * Starts a new conversation from the Compose button.
 *
 * NOTHING IS SENT HERE, exactly as with a reply — this writes a
 * `mailbox_outbound` row and the configured external sender collects it. Cc,
 * Bcc and outbound attachments are deliberately absent rather than accepted and
 * ignored: `mailbox_outbound` has no columns for them, so a field the UI
 * offered would be silently dropped on the way to the wire, which is worse than
 * not offering it.
 *
 * Suppression is re-checked inside `composeNew`. A new message gets the same
 * gates as a reply — arguably it needs them more, since nobody wrote to us
 * first.
 */
const unguardedPOST: APIRoute = async (context) =>
  handleRoute(async () => {
    const database = requireDatabase()
    if (!database.ok) return database.response

    const body = await readValidatedBody(context.request, composeSchema)
    if (!body.ok) return body.response

    const result = await composeNew(database.env, {
      toAddress: body.data.toAddress,
      subject: body.data.subject ?? null,
      bodyText: body.data.bodyText,
      asDraft: body.data.asDraft,
      attachmentIds: body.data.attachmentIds ?? [],
      actorEmail: actorEmail(context),
    })

    return jsonResponse({
      ...result,
      sent: false,
      instruction: body.data.asDraft
        ? 'Saved to Drafts. Nothing will be transmitted until you send it.'
        : 'Queued. It moves to Sent once the external sender confirms it went out.',
    })
  })

// Authenticated per handler as well as by src/middleware.ts; see src/lib/adminGuard.ts.
export const POST = withAdmin(unguardedPOST)

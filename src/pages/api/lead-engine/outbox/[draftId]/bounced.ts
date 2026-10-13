import type { APIRoute } from 'astro'
import { z } from 'zod'
import { authorizeOutboxRequest } from '../../../../../lead-engine/outbox/auth.js'
import { recordBounce } from '../../../../../lead-engine/services/outbox.js'
import {
  handleRoute,
  jsonResponse,
  readValidatedBody,
  requireDatabase,
} from '../../../../../lead-engine/schemas/route'

export const prerender = false

const bounceSchema = z.object({
  /**
   * `hard` suppresses the address permanently. `soft` is recorded and does
   * not, because a full mailbox or a temporary server failure is not a reason
   * to stop contacting a business forever.
   */
  kind: z.enum(['hard', 'soft']).default('hard'),
  diagnostic: z.string().trim().max(1000).optional().nullable(),
})

/**
 * A delivery failure reported by the external sender.
 *
 * WITHOUT THIS THE SUPPRESSION LIST NEVER LEARNS ABOUT BOUNCES. Nothing reads
 * the mailbox any more, so a dead address would be retried on every future
 * campaign it matched — and repeated hard bounces to the same address are one
 * of the fastest ways to lose sending reputation, which is far harder to
 * regain than to protect.
 *
 * A hard bounce suppresses the address immediately and moves the lead out of
 * the contactable set. That is deliberately not reversible from here: undoing
 * it is a human decision on the Suppression screen.
 */
export const POST: APIRoute = async (context) =>
  handleRoute(async () => {
    const database = requireDatabase()
    if (!database.ok) return database.response

    const auth = await authorizeOutboxRequest(database.env, context.request)
    if (!auth.ok) return auth.response

    const body = await readValidatedBody(context.request, bounceSchema)
    if (!body.ok) return body.response

    return jsonResponse(
      await recordBounce(database.env, context.params.draftId!, {
        kind: body.data.kind,
        diagnostic: body.data.diagnostic ?? null,
      }),
    )
  })

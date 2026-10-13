import type { APIRoute } from 'astro'
import { z } from 'zod'
import {
  deleteDraft,
  getOutbound,
  promoteDraft,
  updateDraft,
} from '../../../../../../mailbox/repositories/outbound.js'
import {
  handleRoute,
  jsonResponse,
  notFound,
  readValidatedBody,
  requireDatabase,
} from '../../../../../../lead-engine/schemas/route'
import { withAdmin } from '../../../../../../lib/adminGuard'

export const prerender = false

const draftSchema = z.object({
  subject: z.string().trim().max(500).optional(),
  bodyText: z.string().max(100_000).optional(),
  toAddress: z.email().trim().max(320).optional(),
  /**
   * `true` hands the draft to the transmitter.
   *
   * A separate flag rather than a status field the client sets, so the only
   * transition this route can perform is draft → queued. A client that could
   * name any status could mark its own message `sent`.
   */
  send: z.boolean().optional(),
})

/** One draft: read it back. */
const unguardedGET: APIRoute = async ({ params, request }) =>
  handleRoute(async () => {
    const database = requireDatabase()
    if (!database.ok) return database.response

    const outbound = await getOutbound(database.env.DB, params.outboundId!)
    if (!outbound) return notFound(request, 'Not found.')

    return jsonResponse({ outbound })
  })

/**
 * Edits a draft, and optionally sends it.
 *
 * Both halves refuse anything that is not still a draft. Editing a reply the
 * transmitter has already taken would change what the CMS displays without
 * changing what was actually put on the wire — the thread would show text
 * nobody received.
 */
const unguardedPATCH: APIRoute = async ({ params, request }) =>
  handleRoute(async () => {
    const database = requireDatabase()
    if (!database.ok) return database.response

    const body = await readValidatedBody(request, draftSchema)
    if (!body.ok) return body.response

    const db = database.env.DB
    const id = params.outboundId!

    const { send, ...fields } = body.data
    if (Object.keys(fields).length > 0) await updateDraft(db, id, fields)

    if (send) {
      const queued = await promoteDraft(db, id)
      return jsonResponse({
        outbound: queued,
        // Said explicitly, because "Send" in every other mail client means the
        // message has left. Here it means the transmitter may now collect it.
        sent: false,
        instruction: 'Queued. The configured external sender transmits it on its next run.',
      })
    }

    return jsonResponse({ outbound: await getOutbound(db, id) })
  })

/** Discards a draft. A real delete — nothing was transmitted, so there is no record to keep. */
const unguardedDELETE: APIRoute = async ({ params }) =>
  handleRoute(async () => {
    const database = requireDatabase()
    if (!database.ok) return database.response

    return jsonResponse(await deleteDraft(database.env.DB, params.outboundId!))
  })

// Authenticated per handler as well as by src/middleware.ts; see src/lib/adminGuard.ts.
export const GET = withAdmin(unguardedGET)
export const PATCH = withAdmin(unguardedPATCH)
export const DELETE = withAdmin(unguardedDELETE)

import type { APIRoute } from 'astro'
import { getMessage } from '../../../../../../mailbox/repositories/messages.js'
import { contentDisposition } from '../../../../../../mailbox/inbound/filenames.js'
import { handleRoute, jsonResponse, notFound, requireDatabase } from '../../../../../../lead-engine/schemas/route'
import { withAdmin } from '../../../../../../lib/adminGuard'

export const prerender = false

/**
 * Downloads the original message.
 *
 * THIS IS THE ESCAPE HATCH THAT MAKES "NEVER SILENTLY DISCARD" MEAN SOMETHING.
 * A message the parser could not read still produced a row and still has its
 * bytes here, so a person can open it in a real mail client and see what
 * arrived. Without this route, `parse_status = 'failed'` would be a label on
 * something nobody can inspect.
 *
 * Served as `message/rfc822` with an attachment disposition, so the browser
 * downloads it rather than trying to render it. The R2 object's own stored
 * type is not used; it is hard-coded here, because the type of THIS object is
 * something we know rather than something the message gets to tell us.
 */
const unguardedGET: APIRoute = async ({ params, request }) =>
  handleRoute(async () => {
    const database = requireDatabase()
    if (!database.ok) return database.response

    const bucket = database.env.MAILBOX_BUCKET
    if (!bucket) {
      return jsonResponse({ error: 'R2 MAILBOX_BUCKET binding is not configured.' }, 503)
    }

    const message = await getMessage(database.env.DB, params.messageId!)
    if (!message) return notFound(request, 'Message not found.')
    if (!message.rawKey) {
      return jsonResponse(
        {
          error:
            'The original of this message was not stored. Storage was unavailable when it arrived; the parsed fields above are all we have.',
        },
        404,
      )
    }

    const object = await bucket.get(message.rawKey)
    if (!object) return notFound(request, 'The stored original could not be found.')

    return new Response(object.body, {
      headers: {
        'Content-Type': 'message/rfc822',
        'Content-Disposition': contentDisposition(`message-${message.id}.eml`),
        // Mail is not cacheable by anything between here and the operator.
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  })

// Authenticated per handler as well as by src/middleware.ts; see src/lib/adminGuard.ts.
export const GET = withAdmin(unguardedGET)

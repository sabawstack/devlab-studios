import type { APIRoute } from 'astro'
import { getAttachment } from '../../../../../mailbox/repositories/messages.js'
import { contentDisposition, safeContentType } from '../../../../../mailbox/inbound/filenames.js'
import { handleRoute, jsonResponse, notFound, requireDatabase } from '../../../../../lead-engine/schemas/route'
import { withAdmin } from '../../../../../lib/adminGuard'

export const prerender = false

/**
 * Downloads one attachment.
 *
 * FOUR THINGS HERE ARE LOAD-BEARING, because every byte and every string
 * involved came from a stranger:
 *
 *   1. The R2 key comes from the DATABASE ROW, never from the request. The
 *      caller supplies an attachment id, which is looked up; a key built from
 *      user input is how a download route becomes an arbitrary-object reader.
 *   2. The content type is re-derived through the allowlist, not read from the
 *      stored object. `text/html` served as itself, from an origin the operator
 *      is signed into, would execute script in the admin session.
 *   3. `Content-Disposition: attachment` with a sanitized filename, so nothing
 *      renders inline and the filename cannot break out of the header.
 *   4. `nosniff`, so a browser does not decide for itself that our
 *      `application/octet-stream` is really HTML.
 */
const unguardedGET: APIRoute = async ({ params, request }) =>
  handleRoute(async () => {
    const database = requireDatabase()
    if (!database.ok) return database.response

    const bucket = database.env.MAILBOX_BUCKET
    if (!bucket) {
      return jsonResponse({ error: 'R2 MAILBOX_BUCKET binding is not configured.' }, 503)
    }

    const attachment = await getAttachment(database.env.DB, params.attachmentId!)
    if (!attachment) return notFound(request, 'Attachment not found.')

    if (!attachment.r2Key) {
      return jsonResponse(
        { error: attachment.skippedReason || 'This attachment was not stored.' },
        404,
      )
    }

    const object = await bucket.get(attachment.r2Key)
    if (!object) return notFound(request, 'The stored attachment could not be found.')

    return new Response(object.body, {
      headers: {
        'Content-Type': safeContentType(attachment.contentType),
        'Content-Disposition': contentDisposition(attachment.filename),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        // Belt and braces for the octet-stream case: if anything ever did
        // render, it would render with no privileges at all.
        'Content-Security-Policy': "default-src 'none'; sandbox",
      },
    })
  })

// Authenticated per handler as well as by src/middleware.ts; see src/lib/adminGuard.ts.
export const GET = withAdmin(unguardedGET)

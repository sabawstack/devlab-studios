import type { APIRoute } from 'astro'
import {
  MAX_SINGLE_ATTACHMENT_BYTES,
  ATTACHMENT_SOURCE,
} from '../../../../../mailbox/domain/attachmentSources.js'
import { sanitizeFilename, safeContentType } from '../../../../../mailbox/inbound/filenames.js'
import { createOutboundAttachment } from '../../../../../mailbox/repositories/outboundAttachments.js'
import { newId } from '../../../../../mailbox/repositories/helpers.js'
import { actorEmail, handleRoute, jsonResponse, requireDatabase } from '../../../../../lead-engine/schemas/route'
import { withAdmin } from '../../../../../lib/adminGuard'

export const prerender = false

/**
 * Accepts a file for an outgoing message, before that message exists.
 *
 * The upload is stored UNCLAIMED: bytes go to R2, metadata to D1 with a null
 * `outbound_id`. Pressing Send claims it. That split exists because the
 * operator picks files while composing, and there is nothing to attach them to
 * yet — see repositories/outboundAttachments.js.
 *
 * FILENAME AND CONTENT TYPE ARE NOT TAKEN ON TRUST. Both come from the
 * browser, which takes them from a file the operator chose but which a crafted
 * request can set to anything. The filename is sanitized with the same function
 * the ingest path uses, and the content type is reduced to `type/subtype` —
 * both end up in a `Content-Disposition` header on a message we send to a third
 * party, and a CR in either appends headers of the sender's choosing.
 *
 * The per-file cap is checked here; the per-MESSAGE total is checked at claim
 * time, because a message is not a message until it exists.
 */
const unguardedPOST: APIRoute = async (context) =>
  handleRoute(async () => {
    const database = requireDatabase()
    if (!database.ok) return database.response

    const bucket = database.env.MAILBOX_BUCKET
    if (!bucket) {
      return jsonResponse({ error: 'R2 MAILBOX_BUCKET binding is not configured.' }, 503)
    }

    let form: FormData
    try {
      form = await context.request.formData()
    } catch {
      return jsonResponse({ error: 'Send the file as multipart/form-data with a `file` field.' }, 400)
    }

    const file = form.get('file')
    if (!(file instanceof File)) {
      return jsonResponse({ error: 'No file was included.' }, 422)
    }

    if (file.size === 0) {
      return jsonResponse({ error: 'That file is empty.' }, 422)
    }

    if (file.size > MAX_SINGLE_ATTACHMENT_BYTES) {
      const mb = (MAX_SINGLE_ATTACHMENT_BYTES / 1024 / 1024).toFixed(0)
      return jsonResponse(
        { error: `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is ${mb} MB.` },
        413,
      )
    }

    const filename = sanitizeFilename(file.name, { fallback: 'attachment.bin' })
    const contentType = safeContentType(file.type)

    // Keyed by a fresh id rather than by filename: two uploads called
    // `proposal.pdf` must not overwrite one another, and a filename in an
    // object key is a path-traversal surface even after sanitising.
    const id = newId()
    const r2Key = `mailbox/out/${new Date().toISOString().slice(0, 10)}/${id}`

    await bucket.put(r2Key, await file.arrayBuffer(), {
      httpMetadata: { contentType },
    })

    const attachment = await createOutboundAttachment(database.env.DB, {
      id,
      filename,
      contentType,
      size: file.size,
      r2Key,
      source: ATTACHMENT_SOURCE.UPLOAD,
      createdBy: actorEmail(context),
    })

    return jsonResponse({ attachment }, 201)
  })

// Authenticated per handler as well as by src/middleware.ts; see src/lib/adminGuard.ts.
export const POST = withAdmin(unguardedPOST)

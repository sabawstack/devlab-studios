import type { APIRoute } from 'astro'
import { listSources, upsertSource } from '../../../../../lead-engine/repositories/sources.js'
import { recordAuditEvent } from '../../../../../worker/repositories/auditLog.js'
import { sourceUpdateSchema } from '../../../../../lead-engine/schemas/index'
import {
  actorEmail,
  handleRoute,
  jsonResponse,
  readValidatedBody,
  requireDatabase,
} from '../../../../../lead-engine/schemas/route'
import { withAdmin } from '../../../../../lib/adminGuard'

export const prerender = false

const unguardedGET: APIRoute = async () =>
  handleRoute(async () => {
    const database = requireDatabase()
    if (!database.ok) return database.response

    return jsonResponse({ sources: await listSources(database.env.DB) })
  })

/**
 * Updates a source's registration.
 *
 * Enabling automation on a source whose policy status is not `approved` is
 * refused by the repository, and that refusal is the point of the whole
 * registry: an operator has to record that they read the source's terms before
 * the engine will read the source.
 */
const unguardedPATCH: APIRoute = async (context) =>
  handleRoute(async () => {
    const database = requireDatabase()
    if (!database.ok) return database.response

    const slug = new URL(context.request.url).searchParams.get('slug')
    if (!slug) return jsonResponse({ error: 'A source slug is required.' }, 400)

    const body = await readValidatedBody(context.request, sourceUpdateSchema)
    if (!body.ok) return body.response

    const email = actorEmail(context)
    const source = await upsertSource(database.env.DB, { slug, ...body.data }, email)
    if (!source) return jsonResponse({ error: 'The source could not be saved.' }, 500)

    await recordAuditEvent(database.env.DB, {
      actorEmail: email,
      action: 'lead_source.update',
      entityType: 'lead_source',
      entityId: slug,
      metadata: {
        enabled: source.enabled,
        automationAllowed: source.automationAllowed,
        policyStatus: source.policyStatus,
      },
    })

    return jsonResponse({ source })
  })

// Authenticated per handler as well as by src/middleware.ts; see src/lib/adminGuard.ts.
export const GET = withAdmin(unguardedGET)
export const PATCH = withAdmin(unguardedPATCH)

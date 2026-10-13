import type { APIRoute } from 'astro'
import { parseDomainList, parseImportCsv } from '../../../../../../lead-engine/discovery/manualImport.js'
import { importCandidates } from '../../../../../../lead-engine/services/discovery.js'
import { recordAuditEvent } from '../../../../../../worker/repositories/auditLog.js'
import { importSchema } from '../../../../../../lead-engine/schemas/index'
import {
  actorEmail,
  handleRoute,
  jsonResponse,
  readValidatedBody,
  requireDatabase,
} from '../../../../../../lead-engine/schemas/route'
import { withAdmin } from '../../../../../../lib/adminGuard'

export const prerender = false

/**
 * Imports candidates from a pasted CSV or domain list.
 *
 * Imported rows go through exactly the same normalization, deduplication and
 * admission path as an automated adapter. A domain an operator typed is not a
 * privileged one: it still has to resolve to a canonical domain, and it is
 * still crawled, scored and gated like everything else.
 */
const unguardedPOST: APIRoute = async (context) =>
  handleRoute(async () => {
    const database = requireDatabase()
    if (!database.ok) return database.response

    const body = await readValidatedBody(context.request, importSchema)
    if (!body.ok) return body.response

    const parsed =
      body.data.format === 'csv' ? parseImportCsv(body.data.content) : parseDomainList(body.data.content)

    const email = actorEmail(context)
    const result = await importCandidates(database.env, context.params.id!, parsed.candidates, {
      actorEmail: email,
    })

    await recordAuditEvent(database.env.DB, {
      actorEmail: email,
      action: 'lead_campaign.import',
      entityType: 'lead_campaign',
      entityId: context.params.id!,
      metadata: { format: body.data.format, created: result.created, duplicates: result.duplicates },
    })

    // Parse errors are returned with their line numbers so the operator can fix
    // the source file rather than guess which rows were dropped.
    return jsonResponse({ ...result, parseErrors: parsed.errors.slice(0, 100) })
  })

// Authenticated per handler as well as by src/middleware.ts; see src/lib/adminGuard.ts.
export const POST = withAdmin(unguardedPOST)

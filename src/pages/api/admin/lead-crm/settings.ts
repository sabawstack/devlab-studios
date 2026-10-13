import type { APIRoute } from 'astro'
import {
  clearSetting,
  getEffectiveSettings,
  listSettingMetadata,
  maskSecrets,
  setSetting,
} from '../../../../lead-engine/repositories/settings.js'
import { recordAuditEvent } from '../../../../worker/repositories/auditLog.js'
import { settingsUpdateSchema } from '../../../../lead-engine/schemas/index'
import { actorEmail, handleRoute, jsonResponse, readValidatedBody, requireDatabase } from '../../../../lead-engine/schemas/route'
import { withAdmin } from '../../../../lib/adminGuard'

export const prerender = false

const unguardedGET: APIRoute = async () =>
  handleRoute(async () => {
    const database = requireDatabase()
    if (!database.ok) return database.response

    const [settings, metadata] = await Promise.all([
      getEffectiveSettings(database.env.DB),
      listSettingMetadata(database.env.DB),
    ])

    // Masked in the Worker, not in the browser: a UI-only mask is still visible
    // in the network tab.
    return jsonResponse({ settings: maskSecrets(settings, metadata), metadata })
  })

const unguardedPUT: APIRoute = async (context) =>
  handleRoute(async () => {
    const database = requireDatabase()
    if (!database.ok) return database.response

    const body = await readValidatedBody(context.request, settingsUpdateSchema)
    if (!body.ok) return body.response

    const email = actorEmail(context)
    await setSetting(database.env.DB, body.data.key, body.data.value, {
      actorEmail: email,
      isSecret: body.data.isSecret,
    })

    await recordAuditEvent(database.env.DB, {
      actorEmail: email,
      action: 'lead_settings.update',
      entityType: 'lead_settings',
      entityId: body.data.key,
      // The VALUE is deliberately not audited: a setting can hold an operational
      // value the audit log has no business duplicating. What changed and who
      // changed it is the auditable fact.
      metadata: { key: body.data.key },
    })

    return jsonResponse({ ok: true })
  })

const unguardedDELETE: APIRoute = async (context) =>
  handleRoute(async () => {
    const database = requireDatabase()
    if (!database.ok) return database.response

    const key = new URL(context.request.url).searchParams.get('key')
    if (!key) return jsonResponse({ error: 'A setting key is required.' }, 400)

    await clearSetting(database.env.DB, key)
    await recordAuditEvent(database.env.DB, {
      actorEmail: actorEmail(context),
      action: 'lead_settings.reset',
      entityType: 'lead_settings',
      entityId: key,
      metadata: { key },
    })

    return jsonResponse({ ok: true })
  })

// Authenticated per handler as well as by src/middleware.ts; see src/lib/adminGuard.ts.
export const GET = withAdmin(unguardedGET)
export const PUT = withAdmin(unguardedPUT)
export const DELETE = withAdmin(unguardedDELETE)

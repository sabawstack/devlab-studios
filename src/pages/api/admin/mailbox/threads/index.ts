import type { APIRoute } from 'astro'
import { HUMAN_MAILBOXES, MAILBOX_LABELS, isValidMailbox } from '../../../../../mailbox/domain/mailboxes.js'
import { listThreads } from '../../../../../mailbox/repositories/threads.js'
import { handleRoute, jsonResponse, requireDatabase } from '../../../../../lead-engine/schemas/route'
import { withAdmin } from '../../../../../lib/adminGuard'

export const prerender = false

/**
 * The inbox list.
 *
 * Authentication is the `/api/admin/` gate in src/middleware.ts, which runs
 * before this module does — the same arrangement every Lead CRM route uses, and
 * for the same reason: re-checking per route is duplicated security logic that
 * can drift from the real gate.
 *
 * With no `mailbox` filter this lists the HUMAN mailboxes only. Bounces and
 * DMARC reports are deliberately excluded from the default view: a DMARC
 * aggregate arrives daily from every receiver that has an opinion, and burying
 * a prospect's reply under a week of Google telemetry is how a reply goes
 * unanswered.
 */
const unguardedGET: APIRoute = async ({ url }) =>
  handleRoute(async () => {
    const database = requireDatabase()
    if (!database.ok) return database.response

    const requested = url.searchParams.get('mailbox')
    // An unknown value is ignored rather than returning nothing, so a stale
    // bookmark shows the inbox instead of an empty screen that looks broken.
    const mailbox = requested && isValidMailbox(requested) ? requested : null

    const threads = await listThreads(database.env.DB, {
      mailbox,
      // Spread because HUMAN_MAILBOXES is frozen and readonly, and the
      // repository binds each entry as a query parameter.
      mailboxes: mailbox ? null : [...HUMAN_MAILBOXES],
      state: url.searchParams.get('state') || 'inbox',
      unreadOnly: url.searchParams.get('unread') === 'true',
      search: url.searchParams.get('search') || null,
      limit: Number(url.searchParams.get('limit')) || 50,
      offset: Number(url.searchParams.get('offset')) || 0,
    })

    // No unread totals here. They were returned and never read, which cost an
    // extra aggregate on every keystroke of the search box; the Diagnostics
    // screen is where per-mailbox counts belong.
    return jsonResponse({ threads, mailboxes: MAILBOX_LABELS })
  })

// Authenticated per handler as well as by src/middleware.ts; see src/lib/adminGuard.ts.
export const GET = withAdmin(unguardedGET)

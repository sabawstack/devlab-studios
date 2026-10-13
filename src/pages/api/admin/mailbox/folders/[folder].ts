import type { APIRoute } from 'astro'
import { HUMAN_MAILBOXES, MAILBOX, MAILBOX_LABELS, isValidMailbox } from '../../../../../mailbox/domain/mailboxes.js'
import { listOutboundByStatus } from '../../../../../mailbox/repositories/outbound.js'
import { listSentThreads, listThreads, unreadCounts } from '../../../../../mailbox/repositories/threads.js'
import { handleRoute, jsonResponse, notFound, requireDatabase } from '../../../../../lead-engine/schemas/route'
import { withAdmin } from '../../../../../lib/adminGuard'

export const prerender = false

/**
 * One endpoint per mail-client folder.
 *
 * WHY FOLDERS ARE A ROUTE PARAMETER RATHER THAN FOUR ENDPOINTS: they are four
 * different QUESTIONS about the same mailbox, and three of them are not "which
 * threads" at all —
 *
 *   inbox    — threads with inbound mail, state 'inbox'
 *   sent     — threads containing a message we actually transmitted
 *   outbox   — `mailbox_outbound` rows queued or collected but NOT confirmed
 *   drafts   — `mailbox_outbound` rows saved and never handed over
 *   archived — threads the operator filed away
 *
 * Outbox and Drafts read a different table from Inbox and Sent, so they return
 * `messages` rather than `threads`. Collapsing them into one shape would mean
 * inventing a thread for a reply that has none yet.
 *
 * THE DISTINCTION BETWEEN OUTBOX AND SENT IS THE POINT OF HAVING BOTH. A reply
 * moves to Sent only when the transmitter confirms it; until then it sits in
 * Outbox. A mail client that showed a queued reply as "sent" would be lying
 * about the one fact the operator needs — whether the person received it.
 */

const THREAD_FOLDERS = new Set(['inbox', 'archived', 'sent'])

/**
 * Machine-mail folders, each pinned to one mailbox.
 *
 * First-class routes rather than `inbox?mailbox=bounce`. The query form let two
 * navigation items claim the same pathname and both render as selected; a
 * folder that owns its own path cannot collide with another.
 */
const MACHINE_FOLDERS: Record<string, string> = {
  bounces: MAILBOX.BOUNCE,
  dmarc: MAILBOX.DMARC,
}
const OUTBOUND_FOLDERS: Record<string, string[]> = {
  drafts: ['draft'],
  outbox: ['queued', 'collected'],
  failed: ['failed'],
}

const unguardedGET: APIRoute = async ({ params, request, url }) =>
  handleRoute(async () => {
    const database = requireDatabase()
    if (!database.ok) return database.response

    const db = database.env.DB
    const folder = String(params.folder ?? 'inbox')

    const requested = url.searchParams.get('mailbox')
    const mailbox = requested && isValidMailbox(requested) ? requested : null
    const search = url.searchParams.get('search') || null
    const limit = Number(url.searchParams.get('limit')) || 50

    if (OUTBOUND_FOLDERS[folder]) {
      return jsonResponse({
        folder,
        messages: await listOutboundByStatus(db, { statuses: OUTBOUND_FOLDERS[folder], limit }),
        counts: await unreadCounts(db),
        mailboxes: MAILBOX_LABELS,
      })
    }

    if (MACHINE_FOLDERS[folder]) {
      return jsonResponse({
        folder,
        threads: await listThreads(db, {
          mailbox: MACHINE_FOLDERS[folder],
          state: 'inbox',
          search,
          limit,
        }),
        counts: await unreadCounts(db),
        mailboxes: MAILBOX_LABELS,
      })
    }

    if (!THREAD_FOLDERS.has(folder)) return notFound(request, 'Unknown folder.')

    // Sent is a different question from the others: "which conversations
    // contain something we transmitted", not "which are in this state".
    const threads =
      folder === 'sent'
        ? await listSentThreads(db, { limit })
        : await listThreads(db, {
            mailbox,
            mailboxes: mailbox ? null : [...HUMAN_MAILBOXES],
            state: folder === 'archived' ? 'archived' : 'inbox',
            unreadOnly: url.searchParams.get('unread') === 'true',
            search,
            limit,
            offset: Number(url.searchParams.get('offset')) || 0,
          })

    return jsonResponse({
      folder,
      threads,
      counts: await unreadCounts(db),
      mailboxes: MAILBOX_LABELS,
      // The bounce and DMARC mailboxes are reachable but deliberately not part
      // of the default inbox — see domain/mailboxes.js.
      machineMailboxes: [MAILBOX.BOUNCE, MAILBOX.DMARC],
    })
  })

// Authenticated per handler as well as by src/middleware.ts; see src/lib/adminGuard.ts.
export const GET = withAdmin(unguardedGET)

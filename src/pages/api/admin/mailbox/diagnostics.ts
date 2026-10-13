import type { APIRoute } from 'astro'
import { HUMAN_MAILBOXES, MAILBOX, MAILBOX_LABELS } from '../../../../mailbox/domain/mailboxes.js'
import { listUnparsed } from '../../../../mailbox/repositories/messages.js'
import { outboundCounts } from '../../../../mailbox/repositories/outbound.js'
import { listThreads, unreadCounts } from '../../../../mailbox/repositories/threads.js'
import { handleRoute, jsonResponse, requireDatabase } from '../../../../lead-engine/schemas/route'
import { withAdmin } from '../../../../lib/adminGuard'

export const prerender = false

/**
 * Operational state of the mailbox, in one call.
 *
 * Exists because the three failure modes that matter are all invisible from the
 * inbox: a message that could not be parsed, a reply that has been sitting in
 * the queue because nothing is collecting it, and the R2 binding being absent
 * so originals are not being stored at all. Each of those is a quiet failure —
 * the inbox keeps looking fine — which is exactly the kind this codebase has
 * been bitten by before.
 */
const unguardedGET: APIRoute = async () =>
  handleRoute(async () => {
    const database = requireDatabase()
    if (!database.ok) return database.response

    const db = database.env.DB
    const outbound = await outboundCounts(db)

    return jsonResponse({
      storage: {
        // Reported rather than assumed: without the bucket, ingest still stores
        // every message's metadata but records `raw_unavailable`, and nobody
        // would otherwise know until they tried to open an original.
        rawStorageConfigured: Boolean(database.env.MAILBOX_BUCKET),
        senderConfigured: Boolean(database.env.MAILBOX_OUTBOX_TOKEN),
      },
      unread: await unreadCounts(db),
      // Which mailboxes a person is expected to read, so the UI can headline
      // those and report machine mail separately. Without this the headline
      // number is swamped: DMARC aggregates arrive daily from every receiver
      // with an opinion, are inbound, and are never marked read — so within
      // days it would climb into the hundreds with an empty human inbox and
      // stop meaning anything. That is the exact burial this design keeps them
      // out of the inbox to avoid, and it would simply have moved screens.
      humanMailboxes: [...HUMAN_MAILBOXES],
      outbound,
      // A queue that never drains means the transmitter is not running. Worth
      // seeing as a number rather than discovering when someone asks why their
      // reply was never answered.
      awaitingTransmission: (outbound.queued ?? 0) + (outbound.collected ?? 0),
      unparsed: await listUnparsed(db, { limit: 25 }),
      bounces: await listThreads(db, { mailbox: MAILBOX.BOUNCE, state: 'inbox', limit: 25 }),
      dmarc: await listThreads(db, { mailbox: MAILBOX.DMARC, state: 'inbox', limit: 25 }),
      mailboxes: MAILBOX_LABELS,
    })
  })

// Authenticated per handler as well as by src/middleware.ts; see src/lib/adminGuard.ts.
export const GET = withAdmin(unguardedGET)

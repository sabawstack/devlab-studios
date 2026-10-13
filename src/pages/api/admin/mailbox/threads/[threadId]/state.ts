import type { APIRoute } from 'astro'
import { z } from 'zod'
import { markThreadMessagesRead, setMessagesState } from '../../../../../../mailbox/repositories/messages.js'
import { getThread, recountUnread, setThreadState } from '../../../../../../mailbox/repositories/threads.js'
import {
  handleRoute,
  jsonResponse,
  notFound,
  readValidatedBody,
  requireDatabase,
} from '../../../../../../lead-engine/schemas/route'
import { withAdmin } from '../../../../../../lib/adminGuard'

export const prerender = false

const stateSchema = z.object({
  /**
   * `read` and `state` are independent and either may be omitted: marking a
   * thread read is not the same action as archiving it, and the UI does both
   * from different controls.
   */
  read: z.boolean().optional(),
  state: z.enum(['inbox', 'archived', 'trash']).optional(),
})

/**
 * Read state and lifecycle.
 *
 * `trash` is a state, not a delete. Nothing in this mailbox removes a message:
 * the thread stops appearing in the default list and its messages stop counting
 * as unread, and the raw original stays in R2. Actually destroying mail is a
 * retention decision, and it is not one an archive button should be quietly
 * making.
 */
const unguardedPOST: APIRoute = async ({ params, request }) =>
  handleRoute(async () => {
    const database = requireDatabase()
    if (!database.ok) return database.response

    const db = database.env.DB
    const thread = await getThread(db, params.threadId!)
    if (!thread) return notFound(request, 'Thread not found.')

    const body = await readValidatedBody(request, stateSchema)
    if (!body.ok) return body.response

    if (body.data.read !== undefined) {
      await markThreadMessagesRead(db, thread.id, body.data.read)
      // Recounted from the messages rather than adjusted by a delta: marking a
      // thread read touches an unknown number of rows, and a delta computed
      // here is a delta that can be applied twice.
      await recountUnread(db, thread.id)
    }

    if (body.data.state) {
      await setMessagesState(db, thread.id, body.data.state)
      await setThreadState(db, thread.id, body.data.state)
      await recountUnread(db, thread.id)
    }

    return jsonResponse({ thread: await getThread(db, thread.id) })
  })

// Authenticated per handler as well as by src/middleware.ts; see src/lib/adminGuard.ts.
export const POST = withAdmin(unguardedPOST)

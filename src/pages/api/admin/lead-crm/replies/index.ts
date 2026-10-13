import type { APIRoute } from 'astro'
import { getLatestAiRun } from '../../../../../lead-engine/repositories/aiRuns.js'
import { listUnansweredReplies } from '../../../../../lead-engine/repositories/conversations.js'
import { listDrafts } from '../../../../../lead-engine/repositories/drafts.js'
import { handleRoute, jsonResponse, requireDatabase } from '../../../../../lead-engine/schemas/route'
import { withAdmin } from '../../../../../lib/adminGuard'

export const prerender = false

/**
 * The Replies queue: inbound messages with no outbound message after them.
 *
 * Each card carries its analysis and its suggested draft, so the screen renders
 * without a request per reply. The analysis may be absent — a reply arrives
 * before it is analysed, and a reply the model flagged for human attention
 * deliberately has no draft.
 */
const unguardedGET: APIRoute = async ({ url }) =>
  handleRoute(async () => {
    const database = requireDatabase()
    if (!database.ok) return database.response

    const db = database.env.DB
    const replies = await listUnansweredReplies(db, { limit: Number(url.searchParams.get('limit')) || 50 })

    const enriched = await Promise.all(
      replies.map(async (reply) => {
        const [analysisRun, drafts] = await Promise.all([
          getLatestAiRun(db, reply.leadId, 'reply_analysis'),
          listDrafts(db, { leadId: reply.leadId, kind: 'reply', limit: 3 }),
        ])

        const draft =
          drafts.find((entry: { status: string }) => entry.status === 'draft' || entry.status === 'edited') ?? null

        return {
          ...reply,
          analysis: analysisRun?.result ?? null,
          analysisModel: analysisRun?.model ?? null,
          analysisPromptVersion: analysisRun?.promptVersion ?? null,
          suggestedDraft: draft,
        }
      }),
    )

    return jsonResponse({ replies: enriched })
  })

// Authenticated per handler as well as by src/middleware.ts; see src/lib/adminGuard.ts.
export const GET = withAdmin(unguardedGET)

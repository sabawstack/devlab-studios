import type { APIRoute } from 'astro'
import { z } from 'zod'
import { authorizeBearerRequest } from '../../../../../lead-engine/outbox/auth.js'
import { getOutbound, markSent } from '../../../../../mailbox/repositories/outbound.js'
import { getThread } from '../../../../../mailbox/repositories/threads.js'
import { insertMessage } from '../../../../../mailbox/repositories/messages.js'
import {
  handleRoute,
  jsonResponse,
  notFound,
  readValidatedBody,
  requireDatabase,
} from '../../../../../lead-engine/schemas/route'

export const prerender = false

const sentSchema = z.object({
  providerMessageId: z.string().trim().max(400).optional().nullable(),
  sentAt: z.string().trim().max(40).optional().nullable(),
})

/**
 * The transmitter reporting that a reply went out.
 *
 * This is also where the reply becomes part of the thread a person reads.
 * Recording it at COMPOSE time would show a message as sent that might never
 * have been transmitted; recording it here means the thread shows what actually
 * happened, which is the only property that makes a conversation view worth
 * looking at before replying again.
 *
 * Idempotent in both halves: `markSent` returns `already_sent` without changing
 * the timestamp, and the message insert is keyed on the outbound row's id, so a
 * retry after a timeout does not duplicate the reply in the thread.
 */
export const POST: APIRoute = async (context) =>
  handleRoute(async () => {
    const database = requireDatabase()
    if (!database.ok) return database.response

    const auth = await authorizeBearerRequest(database.env, context.request, 'MAILBOX_OUTBOX_TOKEN')
    if (!auth.ok) return auth.response

    const body = await readValidatedBody(context.request, sentSchema)
    if (!body.ok) return body.response

    const db = database.env.DB
    const result = await markSent(db, context.params.outboundId!, {
      providerMessageId: body.data.providerMessageId ?? null,
      sentAt: body.data.sentAt ?? null,
    })

    // `markSent` throws a 404 for an unknown id, so this is defensive rather
    // than expected — but the alternative is dereferencing null and answering
    // 500 to a transmitter that has ALREADY SENT the message, which would make
    // it retry and mail the recipient twice.
    const outbound = result.outbound ?? (await getOutbound(db, context.params.outboundId!))
    if (!outbound) return notFound(context.request, 'Outbound message not found.')

    const thread = await getThread(db, outbound.threadId)

    if (thread) {
      await insertMessage(db, {
        threadId: thread.id,
        mailbox: outbound.mailbox,
        direction: 'outbound',
        // Keyed on the outbound row, so confirming twice inserts once.
        dedupeKey: `${outbound.mailbox}:outbound:${outbound.id}`,
        envelopeFrom: outbound.envelopeFrom,
        envelopeTo: outbound.toAddress,
        correspondent: outbound.toAddress,
        messageId: outbound.messageId,
        inReplyTo: outbound.inReplyTo,
        references: outbound.references,
        fromAddress: 'hello@devlabconnect.com',
        fromName: 'DevLab Studios',
        toAddresses: [outbound.toAddress],
        subject: outbound.subject,
        bodyText: outbound.bodyText,
        leadId: outbound.leadId,
        sentAt: outbound.sentAt,
      })
    }

    return jsonResponse({ status: result.status, outbound: await getOutbound(db, outbound.id) })
  })

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'
import { createTestD1 } from '../../worker/repositories/testSupport/d1Sqlite.js'
import { ingestEmail } from '../inbound/ingest.js'
import { composeNew, composeReply, renderOutbound } from './reply.js'
import { MAILBOX } from '../domain/mailboxes.js'
import { parseMessageId } from '../domain/messageId.js'
import { collectQueued, getOutbound, markSent } from '../repositories/outbound.js'
import { getThread, listThreads } from '../repositories/threads.js'
import { createOutboundAttachment } from '../repositories/outboundAttachments.js'
import { addSuppression } from '../../lead-engine/repositories/suppression.js'

/**
 * The reply path, from an inbound message to a message ready for the wire.
 *
 * WHAT THESE CASES ARE REALLY GUARDING is the reason this application builds the
 * whole RFC 5322 message rather than handing fields to the transmitter: n8n's
 * Send Email node cannot set `In-Reply-To`, `References`, `Message-ID` or the
 * envelope sender. If the assembly here regressed, replies would still "work"
 * — they would arrive, as a new conversation, with bounces that correlate to
 * nothing. Nothing else in the system would notice.
 */

const HERE = fileURLToPath(new URL('.', import.meta.url))
const MIGRATIONS = join(HERE, '..', '..', '..', 'migrations')
const schema = [
  readFileSync(join(MIGRATIONS, '0012_lead_intelligence_engine.sql'), 'utf8'),
  readFileSync(join(MIGRATIONS, '0013_lead_usage_metric_nominatim.sql'), 'utf8'),
  readFileSync(join(MIGRATIONS, '0014_mailbox.sql'), 'utf8'),
  // 0015 widens mailbox_outbound.status to admit 'draft'. Applied here so the
  // draft cases run against the REAL constraint — the fourth CHECK widening in
  // this schema, and the first three each silently discarded rows first.
  readFileSync(join(MIGRATIONS, '0015_mailbox_drafts.sql'), 'utf8'),
  readFileSync(join(MIGRATIONS, '0016_mailbox_outbound_attachments.sql'), 'utf8'),
]

const INBOUND = [
  'From: Jane Prospect <jane@prospect.example>',
  'To: hello@devlabconnect.com',
  'Subject: A question about your booking page',
  'Message-ID: <CAJane123@mail.prospect.example>',
  'References: <root@mail.prospect.example>',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'Could you tell me more?',
  '',
].join('\r\n')

function bucket() {
  const objects = new Map()
  return {
    objects,
    async put(key, value) { objects.set(key, value); return { key } },
    async get(key) {
      if (!objects.has(key)) return null
      const value = objects.get(key)
      return {
        body: value,
        async arrayBuffer() {
          return value instanceof Uint8Array ? value.buffer : new TextEncoder().encode(String(value)).buffer
        },
      }
    },
  }
}

/** Cloudflare's edge verdict for a sender DMARC vouched for. */
const VERIFIED = 'mx.cloudflare.net; dkim=pass header.d=prospect.example; spf=pass; dmarc=pass'

function message(raw, { from = 'jane@prospect.example', to = 'hello@devlabconnect.com', auth = VERIFIED } = {}) {
  const bytes = new TextEncoder().encode(raw)
  return {
    from,
    to,
    rawSize: bytes.byteLength,
    headers: new Headers(auth ? { 'authentication-results': auth } : {}),
    raw: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close() } }),
  }
}

let env
let threadId

beforeEach(async () => {
  env = { DB: createTestD1(schema), MAILBOX_BUCKET: bucket(), LEAD_ENGINE_ENABLED: 'true' }
  await ingestEmail(env, message(INBOUND))
  const [thread] = await listThreads(env.DB, { mailbox: MAILBOX.HELLO })
  threadId = thread.id
})

describe('composeReply', () => {
  it('queues a reply addressed to the sender, with threading headers', async () => {
    const queued = await composeReply(env, { bodyText: 'Happy to help.', threadId, actorEmail: 'admin@devlabstudios.com' })

    expect(queued.status).toBe('queued')
    expect(queued.toAddress).toBe('jane@prospect.example')
    expect(queued.subject).toBe('Re: A question about your booking page')
    expect(queued.inReplyTo).toBe('CAJane123@mail.prospect.example')
    // The parent's References, then the parent itself — RFC 5322 §3.6.4.
    expect(queued.references).toBe('<root@mail.prospect.example> <CAJane123@mail.prospect.example>')
    expect(queued.createdBy).toBe('admin@devlabstudios.com')
  })

  it('encodes its own id in the Message-ID and in the VERP return path', async () => {
    const queued = await composeReply(env, { bodyText: 'Hello.', threadId })

    expect(parseMessageId(queued.messageId)).toEqual({ kind: 'o', id: queued.id })
    expect(queued.envelopeFrom).toBe(`bounce+o-${queued.id}@devlabconnect.com`)
  })

  it('does not add a second Re: to an already-prefixed subject', async () => {
    const queued = await composeReply(env, { bodyText: 'x', threadId })
    const second = await composeReply(env, { bodyText: 'y', threadId, subject: queued.subject })
    expect(second.subject).toBe('Re: A question about your booking page')
  })

  it('refuses to reply to a suppressed address', async () => {
    // Re-checked HERE, at the moment of composing — someone may have
    // unsubscribed between sending their message and this reply being written.
    await addSuppression(env.DB, {
      scope: 'email',
      value: 'jane@prospect.example',
      reason: 'unsubscribe',
      // 'inbound_reply', not 'reply': lead_suppression.source has a CHECK, and
      // a value outside it is rejected. addSuppression verifies the row landed
      // and throws rather than letting it vanish — the guard that exists
      // because this schema has lost rows to exactly this three times.
      source: 'inbound_reply',
    })

    await expect(composeReply(env, { bodyText: 'Hello.', threadId })).rejects.toThrow(/suppressed/i)

    const queued = await collectQueued(env.DB)
    expect(queued).toHaveLength(0)
  })

  it('refuses an empty body and an unknown thread', async () => {
    await expect(composeReply(env, { bodyText: '   ', threadId })).rejects.toThrow(/body/i)
    await expect(composeReply(env, { bodyText: 'x', threadId: 'nope' })).rejects.toThrow(/not found/i)
  })

  it('prefers Reply-To over From when the sender set one', async () => {
    const withReplyTo = INBOUND.replace(
      'Message-ID: <CAJane123@mail.prospect.example>',
      'Message-ID: <CAJane999@mail.prospect.example>\r\nReply-To: inbox@prospect.example',
    ).replace('Subject: A question', 'Subject: Another question')

    await ingestEmail(env, message(withReplyTo))
    const threads = await listThreads(env.DB, { mailbox: MAILBOX.HELLO })
    const other = threads.find((thread) => thread.subject.startsWith('Another question'))

    const queued = await composeReply(env, { bodyText: 'x', threadId: other.id })
    expect(queued.toAddress).toBe('inbox@prospect.example')
  })
})

describe('renderOutbound', () => {
  async function anUpload(env, { filename, body }) {
    const key = `mailbox/out/${crypto.randomUUID()}`
    const bytes = new TextEncoder().encode(body)
    await env.MAILBOX_BUCKET.put(key, bytes)
    return createOutboundAttachment(env.DB, {
      filename,
      contentType: 'application/pdf',
      size: bytes.byteLength,
      r2Key: key,
    })
  }

  it('renders attachments as MIME parts, in the order the operator chose', async () => {
    const second = await anUpload(env, { filename: 'b.pdf', body: 'BBBB' })
    const first = await anUpload(env, { filename: 'a.pdf', body: 'AAAA' })

    const queued = await composeReply(env, {
      bodyText: 'Both attached.',
      threadId,
      // Deliberately not upload order -- the operator listed a.pdf first.
      attachmentIds: [first.id, second.id],
    })
    const rendered = await renderOutbound(env, queued)

    expect(rendered.raw).toContain('Content-Type: multipart/mixed')
    expect(rendered.raw.indexOf('a.pdf')).toBeLessThan(rendered.raw.indexOf('b.pdf'))
    expect(rendered.raw).toContain('Content-Transfer-Encoding: base64')
    expect(rendered.attachments.map((file) => file.filename)).toEqual(['a.pdf', 'b.pdf'])
  })

  it('withholds the fallback once a message has attachments', async () => {
    // The fallback shape has no way to carry a file. A transmitter using it
    // would send the covering note and silently drop the attachment, leaving a
    // message that refers to a document the recipient does not have.
    const upload = await anUpload(env, { filename: 'proposal.pdf', body: 'PDF' })
    const queued = await composeReply(env, { bodyText: 'Attached.', threadId, attachmentIds: [upload.id] })

    expect((await renderOutbound(env, queued)).fallback).toBeNull()
  })

  it('keeps the fallback when there is nothing to attach', async () => {
    const queued = await composeReply(env, { bodyText: 'No files.', threadId })
    expect((await renderOutbound(env, queued)).fallback).toMatchObject({ to: 'jane@prospect.example' })
  })

  it('refuses to send at all when the bytes are gone from storage', async () => {
    // Skipping the missing part would send a message the operator believes
    // carries it. Failing is the only honest option.
    const upload = await anUpload(env, { filename: 'gone.pdf', body: 'X' })
    const queued = await composeReply(env, { bodyText: 'Attached.', threadId, attachmentIds: [upload.id] })
    env.MAILBOX_BUCKET.objects.delete(upload.r2Key)

    await expect(renderOutbound(env, queued)).rejects.toThrow(/no longer in storage/i)
  })

  it('dates the message when it is rendered, not when the row was created', async () => {
    // A reply that waited in the queue, or was retried after an outage, must
    // not go out claiming a Date hours in the past. The first real send did:
    // created 13:05 on the 21st, transmitted 05:16 on the 22nd, stamped 16
    // hours stale. Receivers read that as a replayed or forged message, and
    // this one landed in spam.
    const queued = await composeReply(env, { bodyText: 'Sent much later.', threadId })
    const stale = { ...queued, createdAt: '2020-01-01T00:00:00.000Z' }

    const rendered = await renderOutbound(env, stale)
    const dateHeader = /^Date: (.+)$/m.exec(rendered.raw)?.[1]

    expect(dateHeader).toBeTruthy()
    expect(new Date(dateHeader).getUTCFullYear()).not.toBe(2020)
    expect(Date.now() - new Date(dateHeader).getTime()).toBeLessThan(60_000)
  })

  it('still honours an explicit date, so the output stays reproducible in tests', async () => {
    const queued = await composeReply(env, { bodyText: 'Fixed date.', threadId })
    const rendered = await renderOutbound(env, queued, { date: new Date('2026-09-22T05:16:00Z') })

    expect(rendered.raw).toContain('Date: Tue, 22 Sep 2026 05:16:00 +0000')
  })

  it('produces a message and an envelope that are not derivable from each other', async () => {
    const queued = await composeReply(env, { bodyText: 'Happy to help.\nBest,\nDevLab', threadId })
    const rendered = await renderOutbound(env, queued)

    // The envelope sender is the VERP address; the visible From is not. A
    // transmitter that infers MAIL FROM from the From: header loses the
    // identifier entirely, which is why these are separate fields.
    expect(rendered.envelope.from).toBe(`bounce+o-${queued.id}@devlabconnect.com`)
    expect(rendered.envelope.to).toEqual(['jane@prospect.example'])
    expect(rendered.raw).toContain('From: DevLab Studios <hello@devlabconnect.com>')

    expect(rendered.raw).toContain('To: Jane Prospect <jane@prospect.example>')
    expect(rendered.raw).toContain(`Message-ID: <${queued.messageId}>`)
    expect(rendered.raw).toContain('In-Reply-To: <CAJane123@mail.prospect.example>')
    expect(rendered.raw).toContain('References: <root@mail.prospect.example>')
    expect(rendered.raw).toContain('Subject: Re: A question about your booking page')
    expect(rendered.raw).toContain('Happy to help.')

    // Headers and body separated by a blank line, CRLF throughout.
    expect(rendered.raw).toContain('\r\n\r\n')
    // Not a draft marker: that would make Outlook treat a received message as
    // an unsent one. buildEmlMessage emits it; this must not.
    expect(rendered.raw).not.toContain('X-Unsent')
  })

  it('cannot have headers injected through the subject', async () => {
    const queued = await composeReply(env, {
      bodyText: 'x',
      threadId,
      subject: 'Hello\r\nBcc: attacker@evil.example',
    })
    const rendered = await renderOutbound(env, queued)

    // The text survives INSIDE the subject; what must not exist is a header
    // line of its own, which is what a bare CRLF would have produced.
    expect(rendered.raw).toContain('Subject: Hello Bcc: attacker@evil.example')

    // Asserted on the header block specifically. A naive `not.toContain('Bcc:')`
    // would fail on the sanitized subject's own text and prove nothing about
    // whether a real header was injected.
    const headerBlock = rendered.raw.split('\r\n\r\n')[0]
    expect(headerBlock.split('\r\n').some((line) => /^bcc:/i.test(line))).toBe(false)
  })
})

describe('composeNew', () => {
  it('starts a thread and queues the message', async () => {
    const result = await composeNew(env, {
      toAddress: 'New Person <new@elsewhere.example>',
      subject: 'Hello there',
      bodyText: 'First contact.',
      actorEmail: 'admin@devlabstudios.com',
    })

    expect(result.outbound.status).toBe('queued')
    expect(result.outbound.toAddress).toBe('new@elsewhere.example')
    expect(result.outbound.subject).toBe('Hello there')
    // A NEW conversation, so no threading headers — inventing either would
    // make the recipient's client file it under a thread that does not exist.
    expect(result.outbound.inReplyTo).toBeNull()
    expect(result.outbound.references).toBeNull()

    // The thread exists up front, so the message is attached in the UI rather
    // than floating until they reply.
    const thread = await getThread(env.DB, result.threadId)
    expect(thread.correspondent).toBe('new@elsewhere.example')
    expect(thread.mailbox).toBe(MAILBOX.HELLO)
  })

  it('gets the same identifiers a reply does', async () => {
    const { outbound } = await composeNew(env, { toAddress: 'x@y.example', bodyText: 'hi' })

    expect(parseMessageId(outbound.messageId)).toEqual({ kind: 'o', id: outbound.id })
    expect(outbound.envelopeFrom).toBe(`bounce+o-${outbound.id}@devlabconnect.com`)
  })

  it('can be saved as a draft instead', async () => {
    const { outbound } = await composeNew(env, { toAddress: 'x@y.example', bodyText: '', asDraft: true })

    expect(outbound.status).toBe('draft')
    expect(await collectQueued(env.DB)).toHaveLength(0)
  })

  it('refuses a suppressed recipient and an unusable address', async () => {
    // A new message gets the SAME gates as a reply. Arguably it needs them
    // more: nobody wrote to us first.
    await addSuppression(env.DB, {
      scope: 'email',
      value: 'blocked@elsewhere.example',
      reason: 'unsubscribe',
      source: 'inbound_reply',
    })

    await expect(
      composeNew(env, { toAddress: 'blocked@elsewhere.example', bodyText: 'hi' }),
    ).rejects.toThrow(/suppressed/i)

    await expect(composeNew(env, { toAddress: 'not-an-address', bodyText: 'hi' })).rejects.toThrow(/valid recipient/i)
    await expect(composeNew(env, { toAddress: 'x@y.example', bodyText: '  ' })).rejects.toThrow(/body/i)
  })
})

describe('drafts', () => {
  it('saves without handing the reply to the transmitter', async () => {
    const draft = await composeReply(env, { bodyText: 'Half a thought', threadId, asDraft: true })

    expect(draft.status).toBe('draft')
    // The guarantee is structural, not a filter someone has to remember:
    // collectQueued selects WHERE status = 'queued'.
    expect(await collectQueued(env.DB)).toHaveLength(0)
  })

  it('accepts an empty body, because that is what a draft is', async () => {
    const draft = await composeReply(env, { bodyText: '   ', threadId, asDraft: true })
    expect(draft.status).toBe('draft')

    // But an empty reply may not be sent.
    await expect(composeReply(env, { bodyText: '   ', threadId })).rejects.toThrow(/body/i)
  })

  it('can be edited, then sent', async () => {
    const { promoteDraft, updateDraft } = await import('../repositories/outbound.js')
    const draft = await composeReply(env, { bodyText: 'first pass', threadId, asDraft: true })

    const edited = await updateDraft(env.DB, draft.id, { bodyText: 'second pass', subject: 'Re: revised' })
    expect(edited.bodyText).toBe('second pass')
    expect(edited.subject).toBe('Re: revised')
    // Still not collectable while it is a draft.
    expect(await collectQueued(env.DB)).toHaveLength(0)

    await promoteDraft(env.DB, draft.id)
    const collected = await collectQueued(env.DB)
    expect(collected).toHaveLength(1)
    expect(collected[0].bodyText).toBe('second pass')
  })

  it('keeps its Message-ID and VERP return path across the edit', async () => {
    // The identifiers are generated at compose time, so editing must not
    // regenerate them — a bounce correlates on the Message-ID we already
    // committed to.
    const { promoteDraft, updateDraft } = await import('../repositories/outbound.js')
    const draft = await composeReply(env, { bodyText: 'x', threadId, asDraft: true })

    await updateDraft(env.DB, draft.id, { bodyText: 'y' })
    const sentReady = await promoteDraft(env.DB, draft.id)

    expect(sentReady.messageId).toBe(draft.messageId)
    expect(sentReady.envelopeFrom).toBe(draft.envelopeFrom)
  })

  it('refuses to edit or delete a reply that has already been handed over', async () => {
    const { deleteDraft, updateDraft } = await import('../repositories/outbound.js')
    const queued = await composeReply(env, { bodyText: 'x', threadId })

    // Editing a collected message would change what the CMS shows without
    // changing what went on the wire.
    await expect(updateDraft(env.DB, queued.id, { bodyText: 'y' })).rejects.toThrow(/no longer be edited/i)
    await expect(deleteDraft(env.DB, queued.id)).rejects.toThrow(/cannot be deleted/i)
  })

  it('promoting twice queues once', async () => {
    const { promoteDraft } = await import('../repositories/outbound.js')
    const draft = await composeReply(env, { bodyText: 'x', threadId, asDraft: true })

    await promoteDraft(env.DB, draft.id)
    await promoteDraft(env.DB, draft.id)

    expect(await collectQueued(env.DB)).toHaveLength(1)
  })

  it('discards a draft outright, since nothing was transmitted', async () => {
    const { deleteDraft, getOutbound } = await import('../repositories/outbound.js')
    const draft = await composeReply(env, { bodyText: 'x', threadId, asDraft: true })

    await deleteDraft(env.DB, draft.id)
    expect(await getOutbound(env.DB, draft.id)).toBeNull()
  })

  it('still refuses a suppressed recipient', async () => {
    await addSuppression(env.DB, {
      scope: 'email',
      value: 'jane@prospect.example',
      reason: 'unsubscribe',
      source: 'inbound_reply',
    })

    // Checked at compose time, so the operator is told before writing rather
    // than after — and a draft cannot smuggle past the gate later.
    await expect(composeReply(env, { bodyText: 'x', threadId, asDraft: true })).rejects.toThrow(/suppressed/i)
  })
})

describe('the collect / confirm round trip', () => {
  it('hands a reply out once and records it in the thread only when confirmed', async () => {
    const queued = await composeReply(env, { bodyText: 'Happy to help.', threadId })

    const first = await collectQueued(env.DB)
    expect(first).toHaveLength(1)
    expect(first[0].id).toBe(queued.id)
    expect(first[0].status).toBe('collected')

    // Never offered twice. If the transmitter dies now, this reply is unsent
    // and sits in the CMS — rather than being mailed to a stranger twice.
    expect(await collectQueued(env.DB)).toHaveLength(0)

    await markSent(env.DB, queued.id, { providerMessageId: 'smtp-1' })
    const confirmed = await getOutbound(env.DB, queued.id)
    expect(confirmed.status).toBe('sent')
    expect(confirmed.providerMessageId).toBe('smtp-1')
  })

  it('treats a repeated confirmation as the same send', async () => {
    const queued = await composeReply(env, { bodyText: 'x', threadId })
    await collectQueued(env.DB)

    const first = await markSent(env.DB, queued.id)
    const second = await markSent(env.DB, queued.id)
    expect(first.status).toBe('ok')
    expect(second.status).toBe('already_sent')
    expect(second.outbound.sentAt).toBe(first.outbound.sentAt)
  })

  it('keeps a failed reply out of the queue unless it is called retryable', async () => {
    const { markFailed } = await import('../repositories/outbound.js')
    const queued = await composeReply(env, { bodyText: 'x', threadId })
    await collectQueued(env.DB)

    await markFailed(env.DB, queued.id, { error: 'connection refused' })
    expect((await getOutbound(env.DB, queued.id)).status).toBe('failed')
    // A reply that silently re-queued forever would mail the same person
    // repeatedly the moment the fault cleared.
    expect(await collectQueued(env.DB)).toHaveLength(0)

    // A callback cannot move a FAILED row back into the queue — only a
    // collected one (F10). Re-queueing a failure is the person's Retry button.
    await expect(markFailed(env.DB, queued.id, { error: 'temporary', retryable: true })).rejects.toMatchObject({
      status: 409,
    })
    expect((await getOutbound(env.DB, queued.id)).status).toBe('failed')

    // A collected reply reported retryable does go back.
    const second = await composeReply(env, { bodyText: 'y', threadId })
    await collectQueued(env.DB)
    await markFailed(env.DB, second.id, { error: 'temporary', retryable: true })
    expect((await getOutbound(env.DB, second.id)).status).toBe('queued')
    expect(await collectQueued(env.DB)).toHaveLength(1)
  })

  it('hands a reply to only one of two transmitters polling at once', async () => {
    // The claim-by-UPDATE carries `WHERE status = 'queued'` precisely so this
    // cannot double-send. Asserted concurrently rather than sequentially,
    // because a sequential call is already excluded by the status change and
    // would prove nothing about the race the guard exists for.
    await composeReply(env, { bodyText: 'x', threadId })

    const [first, second] = await Promise.all([collectQueued(env.DB), collectQueued(env.DB)])

    expect(first.length + second.length).toBe(1)
  })

  it('cancels only a reply nobody has taken', async () => {
    const { cancelOutbound } = await import('../repositories/outbound.js')
    const queued = await composeReply(env, { bodyText: 'x', threadId })

    await cancelOutbound(env.DB, queued.id)
    expect((await getOutbound(env.DB, queued.id)).status).toBe('cancelled')

    const second = await composeReply(env, { bodyText: 'y', threadId })
    await collectQueued(env.DB)
    // Once collected we cannot know whether it reached an MTA, so "cancelled"
    // would be a claim we cannot support.
    await expect(cancelOutbound(env.DB, second.id)).rejects.toThrow(/no longer be cancelled/i)
  })
})

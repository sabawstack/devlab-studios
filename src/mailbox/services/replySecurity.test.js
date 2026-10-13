import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'
import { createTestD1 } from '../../worker/repositories/testSupport/d1Sqlite.js'
import { ingestEmail } from '../inbound/ingest.js'
import { composeNew, composeReply, resolveReplyRecipient } from './reply.js'
import { renderCollectedBatch } from './outboxBatch.js'
import { MAILBOX } from '../domain/mailboxes.js'
import {
  cancelOutbound,
  collectQueued,
  getOutbound,
  markFailed,
  markSent,
  promoteDraft,
  updateDraft,
} from '../repositories/outbound.js'
import { listThreads } from '../repositories/threads.js'
import { createOutboundAttachment, getOutboundAttachment } from '../repositories/outboundAttachments.js'
import { addSuppression } from '../../lead-engine/repositories/suppression.js'

/**
 * Security-audit fixes on the reply path (2026-10-13): F2 reply hijack, F3
 * suppression on drafts and at collection, F8 one bad row in a batch, F9
 * attachments claimed before the reply is visible, F10 callback transitions.
 */

const HERE = fileURLToPath(new URL('.', import.meta.url))
const MIGRATIONS = join(HERE, '..', '..', '..', 'migrations')
const schema = [
  '0012_lead_intelligence_engine.sql',
  '0013_lead_usage_metric_nominatim.sql',
  '0014_mailbox.sql',
  '0015_mailbox_drafts.sql',
  '0016_mailbox_outbound_attachments.sql',
].map((file) => readFileSync(join(MIGRATIONS, file), 'utf8'))

const VERIFIED = 'mx.cloudflare.net; dkim=pass header.d=prospect.example; spf=pass; dmarc=pass'

function inbound({ subject = 'A question', messageId = 'm1@prospect.example', from = 'jane@prospect.example', replyTo = null } = {}) {
  return [
    `From: Jane <${from}>`,
    'To: hello@devlabconnect.com',
    `Subject: ${subject}`,
    `Message-ID: <${messageId}>`,
    ...(replyTo ? [`Reply-To: ${replyTo}`] : []),
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Hello there.',
    '',
  ].join('\r\n')
}

function message(raw, { auth = VERIFIED, from = 'jane@prospect.example' } = {}) {
  const bytes = new TextEncoder().encode(raw)
  return {
    from,
    to: 'hello@devlabconnect.com',
    rawSize: bytes.byteLength,
    headers: new Headers(auth ? { 'authentication-results': auth } : {}),
    raw: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close() } }),
  }
}

function bucket() {
  const objects = new Map()
  return {
    objects,
    async put(key, value) { objects.set(key, value); return { key } },
    async get(key) {
      if (!objects.has(key)) return null
      const value = objects.get(key)
      return { async arrayBuffer() { return value instanceof Uint8Array ? value.buffer : new TextEncoder().encode(String(value)).buffer } }
    },
  }
}

let env

async function threadFor(subject) {
  const threads = await listThreads(env.DB, { mailbox: MAILBOX.HELLO })
  return threads.find((thread) => thread.subject.startsWith(subject))
}

async function suppress(value, scope = 'email') {
  await addSuppression(env.DB, { scope, value, reason: 'unsubscribe', source: 'inbound_reply' })
}

beforeEach(() => {
  env = { DB: createTestD1(schema), MAILBOX_BUCKET: bucket(), LEAD_ENGINE_ENABLED: 'true' }
})

describe('F2 — reply recipient is shown and, when risky, confirmed', () => {
  it('needs no confirmation for a verified sender without a foreign Reply-To', async () => {
    await ingestEmail(env, message(inbound()))
    const thread = await threadFor('A question')
    const queued = await composeReply(env, { bodyText: 'Hi', threadId: thread.id })
    expect(queued.toAddress).toBe('jane@prospect.example')
    expect(queued.status).toBe('queued')
  })

  it('refuses an unverified parent until the shown address is confirmed', async () => {
    await ingestEmail(env, message(inbound(), { auth: null }))
    const thread = await threadFor('A question')

    await expect(composeReply(env, { bodyText: 'Hi', threadId: thread.id })).rejects.toMatchObject({ status: 409 })
    await expect(
      composeReply(env, { bodyText: 'Hi', threadId: thread.id, confirmRecipient: 'someone@else.example' }),
    ).rejects.toMatchObject({ status: 409 })
    expect(await collectQueued(env.DB)).toHaveLength(0)

    const queued = await composeReply(env, {
      bodyText: 'Hi',
      threadId: thread.id,
      confirmRecipient: 'Jane@Prospect.example',
    })
    expect(queued.toAddress).toBe('jane@prospect.example')
  })

  it('requires confirmation when Reply-To is a different domain, even with DMARC pass', async () => {
    await ingestEmail(env, message(inbound({ replyTo: 'billing@attacker.example' })))
    const thread = await threadFor('A question')

    await expect(composeReply(env, { bodyText: 'Hi', threadId: thread.id })).rejects.toThrow(/billing@attacker\.example/)
    const queued = await composeReply(env, {
      bodyText: 'Hi',
      threadId: thread.id,
      confirmRecipient: 'billing@attacker.example',
    })
    expect(queued.toAddress).toBe('billing@attacker.example')
  })

  it('describes the target for the composer with warnings', () => {
    const target = resolveReplyRecipient(
      {
        direction: 'inbound',
        fromAddress: 'ceo@lead.example',
        replyTo: 'pay@evil.example',
        auth: { dmarc: 'unknown' },
      },
      { correspondent: 'ceo@lead.example' },
    )
    expect(target.address).toBe('pay@evil.example')
    expect(target.source).toBe('reply_to')
    expect(target.requiresConfirmation).toBe(true)
    expect(target.warnings).toHaveLength(2)

    const plain = resolveReplyRecipient(
      { direction: 'inbound', fromAddress: 'a@lead.example', replyTo: 'b@lead.example', auth: { dmarc: 'pass' } },
      {},
    )
    expect(plain.requiresConfirmation).toBe(false)
  })

  it('does not thread an unverified message onto a lead thread by subject', async () => {
    await ingestEmail(env, message(inbound({ subject: 'Proposal', messageId: 'p1@prospect.example' })))
    await ingestEmail(
      env,
      message(inbound({ subject: 'Re: Proposal', messageId: 'p2@evil.example', replyTo: 'x@evil.example' }), {
        auth: 'mx.cloudflare.net; spf=fail; dmarc=fail',
      }),
    )

    const threads = await listThreads(env.DB, { mailbox: MAILBOX.HELLO })
    expect(threads).toHaveLength(2)
  })

  it('still threads a verified follow-up by subject', async () => {
    await ingestEmail(env, message(inbound({ subject: 'Proposal', messageId: 'p1@prospect.example' })))
    await ingestEmail(env, message(inbound({ subject: 'Re: Proposal', messageId: 'p2@prospect.example' })))
    expect(await listThreads(env.DB, { mailbox: MAILBOX.HELLO })).toHaveLength(1)
  })

  it('rejects a recipient that is more than one address (strict validator)', async () => {
    await expect(
      composeNew(env, { toAddress: 'a@example.com,b@example.org', bodyText: 'x' }),
    ).rejects.toMatchObject({ status: 422 })
    await expect(
      composeNew(env, { toAddress: '"a@x.com" <b@example.org>; c@example.net', bodyText: 'x' }),
    ).rejects.toMatchObject({ status: 422 })
  })
})

describe('F3 — suppression on draft edit, promotion and collection', () => {
  let threadId
  beforeEach(async () => {
    await ingestEmail(env, message(inbound()))
    threadId = (await threadFor('A question')).id
  })

  it('refuses to re-address a draft to a suppressed recipient', async () => {
    const draft = await composeReply(env, { bodyText: 'x', threadId, asDraft: true })
    await suppress('blocked@other.example')

    await expect(updateDraft(env.DB, draft.id, { toAddress: 'blocked@other.example' })).rejects.toMatchObject({
      status: 409,
    })
    await expect(updateDraft(env.DB, draft.id, { toAddress: 'a@x.com,b@y.com' })).rejects.toMatchObject({
      status: 422,
    })
    expect((await getOutbound(env.DB, draft.id)).toAddress).toBe('jane@prospect.example')
  })

  it('refuses to promote a draft whose recipient was suppressed after it was written', async () => {
    const draft = await composeReply(env, { bodyText: 'x', threadId, asDraft: true })
    await suppress('prospect.example', 'domain')

    await expect(promoteDraft(env.DB, draft.id)).rejects.toThrow(/suppressed/i)
    expect((await getOutbound(env.DB, draft.id)).status).toBe('draft')
  })

  it('marks a queued reply failed, with the reason, when it is suppressed before collection', async () => {
    const queued = await composeReply(env, { bodyText: 'x', threadId })
    await suppress('jane@prospect.example')

    expect(await collectQueued(env.DB)).toHaveLength(0)
    const row = await getOutbound(env.DB, queued.id)
    expect(row.status).toBe('failed')
    expect(row.error).toMatch(/suppressed/i)
  })
})

describe('F8 — one unrenderable row does not strand the batch', () => {
  it('marks the broken row failed and still returns the rest', async () => {
    await ingestEmail(env, message(inbound()))
    const threadId = (await threadFor('A question')).id

    const key = 'mailbox/out/gone'
    await env.MAILBOX_BUCKET.put(key, new TextEncoder().encode('PDF'))
    const upload = await createOutboundAttachment(env.DB, {
      filename: 'gone.pdf',
      contentType: 'application/pdf',
      size: 3,
      r2Key: key,
    })
    const broken = await composeReply(env, { bodyText: 'with file', threadId, attachmentIds: [upload.id] })
    const fine = await composeReply(env, { bodyText: 'plain', threadId })
    env.MAILBOX_BUCKET.objects.delete(key)

    const rendered = await renderCollectedBatch(env, await collectQueued(env.DB))

    expect(rendered.map((item) => item.id)).toEqual([fine.id])
    const row = await getOutbound(env.DB, broken.id)
    expect(row.status).toBe('failed')
    expect(row.error).toMatch(/no longer in storage/i)
  })
})

describe('F9 — the reply is invisible to the transmitter until its files are claimed', () => {
  it('leaves nothing queued, and releases its uploads, when a claim fails', async () => {
    await ingestEmail(env, message(inbound()))
    const threadId = (await threadFor('A question')).id

    const ok = await createOutboundAttachment(env.DB, { filename: 'a.pdf', contentType: 'application/pdf', size: 1, r2Key: 'k1' })
    await expect(
      composeReply(env, { bodyText: 'x', threadId, attachmentIds: [ok.id, 'missing-upload'] }),
    ).rejects.toMatchObject({ status: 404 })

    expect(await collectQueued(env.DB)).toHaveLength(0)
    const rows = await env.DB.prepare('SELECT COUNT(*) AS n FROM mailbox_outbound').first()
    expect(Number(rows.n)).toBe(0)
    expect((await getOutboundAttachment(env.DB, ok.id)).outboundId).toBeNull()
  })

  it('queues only after the claim when sending', async () => {
    await ingestEmail(env, message(inbound()))
    const threadId = (await threadFor('A question')).id
    const upload = await createOutboundAttachment(env.DB, { filename: 'a.pdf', contentType: 'application/pdf', size: 1, r2Key: 'k2' })

    const queued = await composeReply(env, { bodyText: 'x', threadId, attachmentIds: [upload.id] })
    expect(queued.status).toBe('queued')
    expect((await getOutboundAttachment(env.DB, upload.id)).outboundId).toBe(queued.id)
  })
})

describe('F10 — callbacks only move a collected row', () => {
  let threadId
  beforeEach(async () => {
    await ingestEmail(env, message(inbound()))
    threadId = (await threadFor('A question')).id
  })

  it('refuses to mark a draft, a queued or a cancelled reply sent or failed', async () => {
    const draft = await composeReply(env, { bodyText: 'x', threadId, asDraft: true })
    await expect(markSent(env.DB, draft.id)).rejects.toMatchObject({ status: 409 })
    await expect(markFailed(env.DB, draft.id, { retryable: true })).rejects.toMatchObject({ status: 409 })
    expect((await getOutbound(env.DB, draft.id)).status).toBe('draft')

    const queued = await composeReply(env, { bodyText: 'y', threadId })
    await expect(markSent(env.DB, queued.id)).rejects.toMatchObject({ status: 409 })

    await cancelOutbound(env.DB, queued.id)
    await expect(markFailed(env.DB, queued.id, { retryable: true })).rejects.toMatchObject({ status: 409 })
    await expect(markSent(env.DB, queued.id)).rejects.toMatchObject({ status: 409 })
    expect((await getOutbound(env.DB, queued.id)).status).toBe('cancelled')
  })

  it('stays idempotent for the transitions it does allow', async () => {
    const queued = await composeReply(env, { bodyText: 'x', threadId })
    await collectQueued(env.DB)
    expect((await markSent(env.DB, queued.id)).status).toBe('ok')
    expect((await markSent(env.DB, queued.id)).status).toBe('already_sent')

    const other = await composeReply(env, { bodyText: 'y', threadId })
    await collectQueued(env.DB)
    expect((await markFailed(env.DB, other.id, { error: 'boom' })).status).toBe('ok')
    expect((await markFailed(env.DB, other.id, { error: 'boom' })).status).toBe('already_failed')
  })
})

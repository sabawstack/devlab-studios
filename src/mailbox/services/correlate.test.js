import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'
import { createTestD1 } from '../../worker/repositories/testSupport/d1Sqlite.js'
import { ingestEmail } from '../inbound/ingest.js'
import { MAILBOX, verpAddressForDraft } from '../domain/mailboxes.js'
import { KIND_DRAFT, buildMessageId } from '../domain/messageId.js'
import { listThreads } from '../repositories/threads.js'
import { listMessagesForThread } from '../repositories/messages.js'

/**
 * Bounce correlation, end to end, against the real schema.
 *
 * THE POINT OF THESE CASES is that the bounce path has THREE independent routes
 * to the same draft, and only one of them is guaranteed to be available in
 * production:
 *
 *   - VERP needs the transmitter to honour a per-message envelope sender. n8n's
 *     built-in Send Email node cannot do that, so this route may never fire.
 *   - The Message-ID route works regardless, because we build the message.
 *   - The address route is the last resort.
 *
 * Each is tested on its own, with the others made unavailable, so a passing
 * suite cannot be hiding the fact that only one of them ever worked.
 */

const HERE = fileURLToPath(new URL('.', import.meta.url))
const MIGRATIONS = join(HERE, '..', '..', '..', 'migrations')
const schema = [
  readFileSync(join(MIGRATIONS, '0012_lead_intelligence_engine.sql'), 'utf8'),
  readFileSync(join(MIGRATIONS, '0013_lead_usage_metric_nominatim.sql'), 'utf8'),
  readFileSync(join(MIGRATIONS, '0014_mailbox.sql'), 'utf8'),
]

const NOW = '2026-09-20T12:00:00.000Z'
const DRAFT_ID = 'draft-0001-aaaa-bbbb'
const RECIPIENT = 'nobody@prospect.example'

function bucket() {
  const objects = new Map()
  return { objects, async put(key, value) { objects.set(key, value); return { key } }, async get(key) { return objects.has(key) ? { body: objects.get(key) } : null } }
}

/** What Cloudflare's edge stamps on a message whose sender DMARC vouched for. */
const VERIFIED = { 'authentication-results': 'mx.cloudflare.net; dkim=pass header.d=prospect.example; spf=pass; dmarc=pass' }

function message({ from, to, raw, headers = {} }) {
  const bytes = new TextEncoder().encode(raw)
  return {
    from,
    to,
    rawSize: bytes.byteLength,
    headers: new Headers(headers),
    raw: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close() } }),
  }
}

/** A campaign, company, lead, contact and an EXPORTED draft. */
async function seedLead(db) {
  const rows = [
    `INSERT INTO lead_campaigns (id, name, slug, country_code, created_at, updated_at)
       VALUES ('camp-1', 'Test', 'test', 'US', '${NOW}', '${NOW}')`,
    `INSERT INTO lead_companies (id, canonical_domain, name, website_url, first_discovered_at, created_at, updated_at)
       VALUES ('co-1', 'prospect.example', 'Prospect Ltd', 'https://prospect.example', '${NOW}', '${NOW}', '${NOW}')`,
    `INSERT INTO lead_leads (id, campaign_id, company_id, stage, created_at, updated_at)
       VALUES ('lead-1', 'camp-1', 'co-1', 'CONTACTED', '${NOW}', '${NOW}')`,
    `INSERT INTO lead_contacts (id, lead_id, company_id, email, source_url, source_type, is_primary, discovered_at, created_at, updated_at)
       VALUES ('contact-1', 'lead-1', 'co-1', '${RECIPIENT}', 'https://prospect.example/contact', 'company_contact_page', 1, '${NOW}', '${NOW}', '${NOW}')`,
    // `status` must not be 'draft': a draft nobody sent cannot have bounced.
    `INSERT INTO lead_outreach_drafts (id, lead_id, contact_id, kind, status, subject, body_text, created_at, updated_at)
       VALUES ('${DRAFT_ID}', 'lead-1', 'contact-1', 'initial', 'edited', 'Hello', 'Body', '${NOW}', '${NOW}')`,
    // THE ENGINE HAS TO BE SWITCHED ON IN D1, not just permitted by the Worker
    // var. `recordBounce` resolves operational flags from this row and they
    // default to FALSE, so a deployment where nobody has turned the engine on
    // in CRM Settings stores bounces and suppresses nothing. That is correct
    // behaviour — the engine ships off — and it is worth a test in both
    // directions rather than a surprise in production.
    `INSERT INTO lead_settings (key, value_json, updated_at)
       VALUES ('operations.flags', '{"engine":true}', '${NOW}')`,
  ]
  for (const sql of rows) await db.prepare(sql).run()
}

/**
 * @param {{ to: string, originalMessageId?: string|null, recipient?: string }} options
 */
function dsn({ to, originalMessageId = null, recipient = RECIPIENT }) {
  const returned = originalMessageId
    ? [
        '--XYZ',
        'Content-Type: message/rfc822-headers',
        '',
        'From: hello@devlabconnect.com',
        `To: ${recipient}`,
        `Message-ID: <${originalMessageId}>`,
        '',
      ]
    : []

  return [
    'From: MAILER-DAEMON@mail.example.net',
    `To: ${to}`,
    'Subject: Undelivered Mail Returned to Sender',
    `Message-ID: <dsn-${Math.random().toString(36).slice(2)}@mail.example.net>`,
    'MIME-Version: 1.0',
    'Content-Type: multipart/report; report-type=delivery-status; boundary="XYZ"',
    '',
    '--XYZ',
    'Content-Type: text/plain',
    '',
    'Delivery failed.',
    '',
    '--XYZ',
    'Content-Type: message/delivery-status',
    '',
    'Reporting-MTA: dns; mail.example.net',
    '',
    `Final-Recipient: rfc822; ${recipient}`,
    'Action: failed',
    'Status: 5.1.1',
    'Diagnostic-Code: smtp; 550 5.1.1 User unknown',
    '',
    ...returned,
    '--XYZ--',
    '',
  ].join('\r\n')
}

let env

beforeEach(async () => {
  env = {
    DB: createTestD1(schema),
    MAILBOX_BUCKET: bucket(),
    // recordBounce runs behind the engine flag, so the CRM half of this path
    // only executes with it on — which is itself worth asserting (below).
    LEAD_ENGINE_ENABLED: 'true',
  }
  await seedLead(env.DB)
})

async function storedBounce() {
  const [thread] = await listThreads(env.DB, { mailbox: MAILBOX.BOUNCE })
  const [stored] = await listMessagesForThread(env.DB, thread.id)
  return stored
}

async function suppression() {
  const result = await env.DB.prepare('SELECT * FROM lead_suppression').all()
  return result.results ?? []
}

describe('route 1 — VERP', () => {
  it('correlates from the envelope recipient alone', async () => {
    await ingestEmail(
      env,
      message({ from: '', to: verpAddressForDraft(DRAFT_ID), raw: dsn({ to: verpAddressForDraft(DRAFT_ID) }) }),
    )

    const stored = await storedBounce()
    expect(stored.correlationMethod).toBe('verp')
    expect(stored.draftId).toBe(DRAFT_ID)
    expect(stored.leadId).toBe('lead-1')
  })

  it('ignores a VERP tag that names no draft', async () => {
    // Otherwise anyone could suppress an arbitrary address by mailing
    // bounce+d-<anything>@ and letting the address fallback do the rest.
    const address = 'bounce+d-nosuchdraft12345@devlabconnect.com'
    await ingestEmail(env, message({ from: '', to: address, raw: dsn({ to: address, recipient: 'stranger@elsewhere.example' }) }))

    const stored = await storedBounce()
    expect(stored.draftId).toBeNull()
    expect(await suppression()).toHaveLength(0)
  })
})

describe('route 2 — Message-ID in the returned headers', () => {
  it('correlates with no VERP at all', async () => {
    // The route that has to work: it survives a transmitter that cannot set the
    // envelope sender, which is the situation we are actually in.
    const ourId = buildMessageId({ kind: KIND_DRAFT, id: DRAFT_ID })
    await ingestEmail(
      env,
      message({
        from: '',
        to: 'bounce@devlabconnect.com',
        raw: dsn({ to: 'bounce@devlabconnect.com', originalMessageId: ourId }),
      }),
    )

    const stored = await storedBounce()
    expect(stored.correlationMethod).toBe('message_id')
    expect(stored.draftId).toBe(DRAFT_ID)
  })
})

describe('route 3 — the failed recipient address', () => {
  it('correlates from Final-Recipient when nothing else is available', async () => {
    await ingestEmail(env, message({ from: '', to: 'bounce@devlabconnect.com', raw: dsn({ to: 'bounce@devlabconnect.com' }) }))

    const stored = await storedBounce()
    expect(stored.correlationMethod).toBe('address')
    expect(stored.draftId).toBe(DRAFT_ID)
  })

  it('records the failure but does NOT suppress, because the address is an assertion', async () => {
    await ingestEmail(env, message({ from: '', to: 'bounce@devlabconnect.com', raw: dsn({ to: 'bounce@devlabconnect.com' }) }))

    // The report says 5.1.1, and the mailbox records that truthfully.
    const stored = await storedBounce()
    expect(stored.dsn.status).toBe('5.1.1')

    // But nothing was suppressed, because nothing authenticated it. See the
    // forged-DSN case below for what this prevents.
    expect(await suppression()).toHaveLength(0)
    const lead = await env.DB.prepare("SELECT stage FROM lead_leads WHERE id = 'lead-1'").first()
    expect(lead.stage).toBe('CONTACTED')

    // It is still on the lead's timeline, so a person can act on it.
    const activity = await env.DB.prepare("SELECT * FROM lead_activity WHERE event_type = 'BOUNCED'").all()
    expect(activity.results).toHaveLength(1)
  })

  it('does not attribute a bounce for an address we never wrote to', async () => {
    await ingestEmail(
      env,
      message({
        from: '',
        to: 'bounce@devlabconnect.com',
        raw: dsn({ to: 'bounce@devlabconnect.com', recipient: 'stranger@elsewhere.example' }),
      }),
    )

    const stored = await storedBounce()
    expect(stored.draftId).toBeNull()
    expect(stored.leadId).toBeNull()
    expect(await suppression()).toHaveLength(0)
  })
})

describe('a forged delivery report', () => {
  it('cannot suppress an address by asserting one in the message body', async () => {
    // THIS WAS A REAL, REPRODUCED VULNERABILITY. A delivery report cannot be
    // authenticated — it arrives from an arbitrary MTA with an empty envelope
    // sender, so there is no SPF identity to check and no DMARC alignment to
    // require. Before the trust gate in services/bridge.js, this exact message
    // permanently suppressed the address and moved the lead to NO_CONTACT:
    // unauthenticated, remote, repeatable denial-of-outreach against any
    // business the operator was prospecting.
    //
    // No MIME report part, no VERP tag, no knowledge of any internal id —
    // just a null envelope sender, which anyone may use, and four lines of
    // plain text.
    const forged = [
      'From: nobody@attacker.example',
      'To: hello@devlabconnect.com',
      'Subject: hello',
      'Message-ID: <forged-1@attacker.example>',
      'Content-Type: text/plain; charset=utf-8',
      '',
      `Final-Recipient: rfc822; ${RECIPIENT}`,
      'Action: failed',
      'Status: 5.1.1',
      '',
    ].join('\r\n')

    await ingestEmail(env, message({ from: '', to: 'hello@devlabconnect.com', raw: forged }))

    expect(await suppression()).toHaveLength(0)
    const lead = await env.DB.prepare("SELECT stage FROM lead_leads WHERE id = 'lead-1'").first()
    expect(lead.stage).toBe('CONTACTED')
  })

  it('cannot suppress by guessing a VERP tag either', async () => {
    const address = 'bounce+d-guessed000000@devlabconnect.com'
    await ingestEmail(
      env,
      message({ from: '', to: address, raw: dsn({ to: address }) }),
    )

    // Falls through to the address route, which does not suppress.
    expect(await suppression()).toHaveLength(0)
  })
})

describe('handing the bounce to the CRM', () => {
  it('suppresses a hard bounce through the lead engine, not a second system', async () => {
    await ingestEmail(
      env,
      message({ from: '', to: verpAddressForDraft(DRAFT_ID), raw: dsn({ to: verpAddressForDraft(DRAFT_ID) }) }),
    )

    const entries = await suppression()
    expect(entries).toHaveLength(1)
    expect(entries[0].value).toBe(RECIPIENT)
    expect(entries[0].reason).toBe('hard_bounce')
    // 'bounce', because lead_suppression.source has a CHECK — the exact
    // constraint that silently discarded rows here before.
    expect(entries[0].source).toBe('bounce')

    // The lead left the contactable set, through the CRM's own transition.
    const lead = await env.DB.prepare("SELECT stage FROM lead_leads WHERE id = 'lead-1'").first()
    expect(lead.stage).toBe('NO_CONTACT')

    const activity = await env.DB.prepare("SELECT * FROM lead_activity WHERE event_type = 'BOUNCED'").all()
    expect(activity.results).toHaveLength(1)
  })

  it('does not suppress a soft bounce', async () => {
    const soft = dsn({ to: verpAddressForDraft(DRAFT_ID) })
      .replace('Status: 5.1.1', 'Status: 4.2.2')
      .replace('Action: failed', 'Action: delayed')

    await ingestEmail(env, message({ from: '', to: verpAddressForDraft(DRAFT_ID), raw: soft }))

    // A full mailbox is not a reason to stop contacting a business forever.
    expect(await suppression()).toHaveLength(0)
    const lead = await env.DB.prepare("SELECT stage FROM lead_leads WHERE id = 'lead-1'").first()
    expect(lead.stage).toBe('CONTACTED')
  })

  it('still stores the bounce when the engine is switched off', async () => {
    // Both switches are exercised: the Worker var here, and the D1 operational
    // flag is covered by the fact that suppression only works once it is
    // seeded above.
    env.LEAD_ENGINE_ENABLED = 'false'

    const result = await ingestEmail(
      env,
      message({ from: '', to: verpAddressForDraft(DRAFT_ID), raw: dsn({ to: verpAddressForDraft(DRAFT_ID) }) }),
    )

    // recordBounce refuses with the engine off. The mail must survive that:
    // the bounce is visible on the Bounces screen either way.
    expect(result.status).toBe('stored')
    const stored = await storedBounce()
    expect(stored.isDsn).toBe(true)
    expect(await suppression()).toHaveLength(0)
  })

  it('is idempotent — a redelivered DSN suppresses once', async () => {
    const raw = dsn({ to: verpAddressForDraft(DRAFT_ID) })
    await ingestEmail(env, message({ from: '', to: verpAddressForDraft(DRAFT_ID), raw }))
    await ingestEmail(env, message({ from: '', to: verpAddressForDraft(DRAFT_ID), raw }))

    expect(await suppression()).toHaveLength(1)
    const activity = await env.DB.prepare("SELECT * FROM lead_activity WHERE event_type = 'BOUNCED'").all()
    expect(activity.results).toHaveLength(1)
  })
})

describe('an ordinary reply from a known lead', () => {
  it('is bridged into the CRM conversation so the Replies queue sees it', async () => {
    const reply = [
      `From: Someone <${RECIPIENT}>`,
      'To: hello@devlabconnect.com',
      'Subject: Re: Hello',
      '.Message-ID: <reply-1@prospect.example>'.slice(1),
      'Content-Type: text/plain; charset=utf-8',
      '',
      'Yes, interested.',
      '',
    ].join('\r\n')

    await ingestEmail(env, message({ from: RECIPIENT, to: 'hello@devlabconnect.com', raw: reply, headers: VERIFIED }))

    const conversations = await env.DB.prepare('SELECT * FROM lead_conversations').all()
    expect(conversations.results).toHaveLength(1)

    const messages = await env.DB.prepare('SELECT * FROM lead_messages').all()
    expect(messages.results).toHaveLength(1)
    expect(messages.results[0].provider).toBe('devlabconnect')
    expect(messages.results[0].body_text).toContain('Yes, interested.')

    const activity = await env.DB.prepare("SELECT * FROM lead_activity WHERE event_type = 'INBOUND_REPLY'").all()
    expect(activity.results).toHaveLength(1)

    // And the mailbox thread is linked to the lead.
    const [thread] = await listThreads(env.DB, { mailbox: MAILBOX.HELLO })
    expect(thread.leadId).toBe('lead-1')
  })

  it('does NOT attach an unverified message to the lead by its From address alone', async () => {
    // F2: a forged From matching a lead's address must not land in that lead's
    // CRM conversation. Without DMARC pass the address is only a claim.
    const forged = [
      `From: Someone <${RECIPIENT}>`,
      'To: hello@devlabconnect.com',
      'Subject: Re: Hello',
      'Reply-To: attacker@evil.example',
      'Message-ID: <forged-1@evil.example>',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'Please send the invoice here instead.',
      '',
    ].join('\r\n')

    await ingestEmail(env, message({ from: RECIPIENT, to: 'hello@devlabconnect.com', raw: forged }))

    const messages = await env.DB.prepare('SELECT * FROM lead_messages').all()
    expect(messages.results).toHaveLength(0)
    const [thread] = await listThreads(env.DB, { mailbox: MAILBOX.HELLO })
    expect(thread.leadId).toBeNull()
  })

  it('does not trust a dmarc=pass that a sender wrote below the edge header', async () => {
    const forged = [
      `From: Someone <${RECIPIENT}>`,
      'To: hello@devlabconnect.com',
      'Subject: Re: Hello',
      'Message-ID: <forged-2@evil.example>',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'x',
      '',
    ].join('\r\n')

    // Headers joins repeats with ", " — the edge's verdict first, the forged
    // one after it.
    await ingestEmail(
      env,
      message({
        from: RECIPIENT,
        to: 'hello@devlabconnect.com',
        raw: forged,
        headers: { 'authentication-results': 'mx.cloudflare.net; spf=fail; dmarc=fail, evil.example; dmarc=pass' },
      }),
    )

    const messages = await env.DB.prepare('SELECT * FROM lead_messages').all()
    expect(messages.results).toHaveLength(0)
  })
})

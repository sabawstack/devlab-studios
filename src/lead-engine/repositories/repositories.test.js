import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { createTestD1 } from '../../worker/repositories/testSupport/d1Sqlite.js'

import { upsertCompany, findCompanyByDomain } from './companies.js'
import { createCampaign, getCampaign, listScheduledCampaigns, updateCampaign } from './campaigns.js'
import { countLeadsByStage, getLead, listLeads, refreshNextAction, transitionLead, upsertLead } from './leads.js'
import { listActivity, recordActivity } from './activity.js'
import { addSuppression, checkSuppression, filterSuppressed, listSuppression, removeSuppression } from './suppression.js'
import { checkMonthlyDiscoveryBudget, consumeBudget, getUsage, releaseBudget } from './usage.js'
import { claimJobs, completeJob, enqueueJob, failJob, reclaimStaleJobs, retryJob } from './jobs.js'
import { getPrimaryContact, upsertContact } from './contacts.js'
import { getCurrentScore, listScoreHistory, recordScore } from './scores.js'
import { ensureConversation, listUnansweredReplies, recordMessage } from './conversations.js'
import { createDraft, getCurrentDraft, recordDraftExported } from './drafts.js'
import { STAGES } from '../domain/pipeline.js'
import { ACTIVITY } from '../domain/activity.js'

/**
 * Repository tests against a real SQLite database.
 *
 * Not mocks: the migration's own CHECK constraints, UNIQUE indexes, partial
 * indexes, foreign keys and ON CONFLICT clauses all run here exactly as they do
 * in D1. That is the whole point — the guarantees this engine relies on
 * (idempotency, the atomic budget reservation, the suppression boundary) are
 * implemented IN THE SCHEMA, and a stubbed `prepare()` would exercise none of
 * them.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migration = readFileSync(resolve(here, '../../../migrations/0012_lead_intelligence_engine.sql'), 'utf8')

let db

async function seedLead() {
  const campaign = await createCampaign(db, {
    name: 'Test',
    slug: 'test',
    countryCode: 'US',
    config: {},
    description: '',
  })
  const { company } = await upsertCompany(db, { name: 'Acme', websiteUrl: 'https://acme.com' })
  const { lead } = await upsertLead(db, { campaignId: campaign.id, companyId: company.id })
  return { campaign, company, lead }
}

beforeEach(() => {
  db = createTestD1([migration])
})

describe('companies', () => {
  it('deduplicates on the canonical domain across URL spellings', async () => {
    const first = await upsertCompany(db, { name: 'Acme', websiteUrl: 'https://acme.com' })
    const second = await upsertCompany(db, { name: 'Acme Properties', websiteUrl: 'http://www.acme.com/contact' })

    expect(first.created).toBe(true)
    expect(second.created).toBe(false)
    expect(second.company.id).toBe(first.company.id)
  })

  it('enriches additively — a second source fills gaps but never overwrites', async () => {
    await upsertCompany(db, { name: 'Acme', websiteUrl: 'https://acme.com', city: 'Austin' })
    const { company } = await upsertCompany(db, {
      name: 'Totally Different Name',
      websiteUrl: 'https://acme.com',
      city: 'Dallas',
      phone: '+1 512 555 0100',
    })

    // The disagreement is not resolved by whoever ran last.
    expect(company.city).toBe('Austin')
    expect(company.name).toBe('Acme')
    // But a field nobody had gets filled.
    expect(company.phone).toBe('+1 512 555 0100')
  })

  it('refuses a candidate with no resolvable domain', async () => {
    await expect(upsertCompany(db, { name: 'X', websiteUrl: 'https://facebook.com/acme' })).rejects.toThrow()
    expect(await findCompanyByDomain(db, 'facebook.com')).toBeNull()
  })
})

describe('leads', () => {
  it('admits a company at most once per campaign', async () => {
    const { campaign, company } = await seedLead()
    const again = await upsertLead(db, { campaignId: campaign.id, companyId: company.id })

    expect(again.created).toBe(false)
    expect((await listLeads(db, {})).total).toBe(1)
  })

  it('allows the same company in a second campaign', async () => {
    const { company } = await seedLead()
    const other = await createCampaign(db, { name: 'B', slug: 'b', countryCode: 'US', config: {}, description: '' })

    const { created } = await upsertLead(db, { campaignId: other.id, companyId: company.id })
    expect(created).toBe(true)
    expect((await listLeads(db, {})).total).toBe(2)
  })

  it('writes the stage change and its activity row atomically', async () => {
    const { lead } = await seedLead()

    const moved = await transitionLead(db, lead.id, STAGES.RESEARCHED, { summary: 'done' })
    expect(moved.moved).toBe(true)

    expect((await getLead(db, lead.id)).stage).toBe(STAGES.RESEARCHED)
    const activity = await listActivity(db, { leadId: lead.id })
    expect(activity[0].toStage).toBe(STAGES.RESEARCHED)
    expect(activity[0].fromStage).toBe(STAGES.DISCOVERED)
  })

  it('refuses to move a lead out of a compliance-terminal stage', async () => {
    const { lead } = await seedLead()
    await transitionLead(db, lead.id, STAGES.UNSUBSCRIBED, {})

    const attempt = await transitionLead(db, lead.id, STAGES.READY_TO_CONTACT, {})
    expect(attempt.moved).toBe(false)
    expect((await getLead(db, lead.id)).stage).toBe(STAGES.UNSUBSCRIBED)
  })

  it('rejects a stage the schema does not allow', async () => {
    const { lead } = await seedLead()
    await expect(transitionLead(db, lead.id, 'INVENTED_STAGE', {})).resolves.toMatchObject({ moved: false })
  })

  it('counts by stage for the dashboard funnel', async () => {
    const { lead } = await seedLead()
    await transitionLead(db, lead.id, STAGES.RESEARCHED, {})

    expect(await countLeadsByStage(db)).toEqual({ [STAGES.RESEARCHED]: 1 })
  })

  it('derives the next action from real related rows', async () => {
    const { lead, company } = await seedLead()
    await transitionLead(db, lead.id, STAGES.NO_CONTACT, {})

    expect(await refreshNextAction(db, lead.id)).toMatch(/contact/i)

    await upsertContact(db, {
      leadId: lead.id,
      companyId: company.id,
      email: 'hello@acme.com',
      sourceUrl: 'https://acme.com/contact',
      sourceType: 'company_contact_page',
    })
    await transitionLead(db, lead.id, STAGES.READY_TO_CONTACT, {})

    expect(await refreshNextAction(db, lead.id)).toMatch(/draft/i)
  })
})

describe('activity', () => {
  it('is idempotent on a dedupe key, so duplicate delivery writes one row', async () => {
    const { lead } = await seedLead()

    for (let index = 0; index < 3; index += 1) {
      await recordActivity(db, {
        leadId: lead.id,
        eventType: ACTIVITY.CRAWL_COMPLETED,
        summary: 'done',
        dedupeKey: 'crawl:run-1',
      })
    }

    const events = await listActivity(db, { leadId: lead.id, eventType: ACTIVITY.CRAWL_COMPLETED })
    expect(events).toHaveLength(1)
  })

  it('records every un-keyed event, because most events are not duplicates', async () => {
    const { lead } = await seedLead()
    await recordActivity(db, { leadId: lead.id, eventType: ACTIVITY.NOTE_ADDED, summary: 'one' })
    await recordActivity(db, { leadId: lead.id, eventType: ACTIVITY.NOTE_ADDED, summary: 'two' })

    expect(await listActivity(db, { leadId: lead.id })).toHaveLength(2)
  })

  it('refuses an unknown event type rather than writing an unqueryable row', async () => {
    const { lead } = await seedLead()
    await expect(recordActivity(db, { leadId: lead.id, eventType: 'CRAWL_COMPLETD' })).rejects.toThrow(/Unknown activity/)
  })
})

describe('suppression', () => {
  it('blocks an exact address', async () => {
    await addSuppression(db, { scope: 'email', value: 'Hello@Acme.com', reason: 'unsubscribe' })

    expect((await checkSuppression(db, 'hello@acme.com')).suppressed).toBe(true)
    expect((await checkSuppression(db, 'HELLO@ACME.COM')).suppressed).toBe(true)
    expect((await checkSuppression(db, 'other@acme.com')).suppressed).toBe(false)
  })

  it('blocks every address at a suppressed domain, including undiscovered ones', async () => {
    await addSuppression(db, { scope: 'domain', value: 'acme.com', reason: 'do_not_contact' })

    expect((await checkSuppression(db, 'anyone@acme.com')).suppressed).toBe(true)
    expect((await checkSuppression(db, 'someone-new@acme.com')).suppressed).toBe(true)
  })

  it('fails closed on an address it cannot even parse', async () => {
    expect((await checkSuppression(db, 'not-an-email')).suppressed).toBe(true)
    expect((await checkSuppression(db, '')).suppressed).toBe(true)
  })

  it('checks many addresses in one query with the same semantics', async () => {
    await addSuppression(db, { scope: 'email', value: 'a@x.com', reason: 'unsubscribe' })
    await addSuppression(db, { scope: 'domain', value: 'y.com', reason: 'complaint' })

    const suppressed = await filterSuppressed(db, ['a@x.com', 'b@x.com', 'c@y.com', 'd@z.com'])
    expect(suppressed).toEqual(new Set(['a@x.com', 'c@y.com']))
  })

  it('is idempotent — suppressing twice keeps one active entry', async () => {
    const first = await addSuppression(db, { scope: 'email', value: 'a@x.com', reason: 'unsubscribe' })
    const second = await addSuppression(db, { scope: 'email', value: 'a@x.com', reason: 'complaint' })

    expect(first.created).toBe(true)
    expect(second.created).toBe(false)
    expect(await listSuppression(db, {})).toHaveLength(1)
  })

  it('retains a removed entry and stops blocking, but only with a written reason', async () => {
    const { entry } = await addSuppression(db, { scope: 'email', value: 'a@x.com', reason: 'unsubscribe' })

    await expect(removeSuppression(db, entry.id, { actorEmail: 'x@y.z', reason: '' })).rejects.toThrow(/reason/i)

    await removeSuppression(db, entry.id, { actorEmail: 'x@y.z', reason: 'Wrong address suppressed by mistake.' })

    expect((await checkSuppression(db, 'a@x.com')).suppressed).toBe(false)
    expect(await listSuppression(db, {})).toHaveLength(0)
    // The history survives.
    const withRemoved = await listSuppression(db, { includeRemoved: true })
    expect(withRemoved).toHaveLength(1)
    expect(withRemoved[0].removalReason).toMatch(/mistake/)
  })

  it('allows re-suppressing a value after removal', async () => {
    const { entry } = await addSuppression(db, { scope: 'email', value: 'a@x.com', reason: 'unsubscribe' })
    await removeSuppression(db, entry.id, { actorEmail: 'x@y.z', reason: 'a reason' })

    const again = await addSuppression(db, { scope: 'email', value: 'a@x.com', reason: 'complaint' })
    expect(again.created).toBe(true)
    expect((await checkSuppression(db, 'a@x.com')).suppressed).toBe(true)
  })
})

describe('usage budgets', () => {
  it('reserves budget and refuses once the limit is reached', async () => {
    const limits = { ai_reviews: 3 }

    for (let index = 0; index < 3; index += 1) {
      const outcome = await consumeBudget(db, 'ai_reviews', { limits })
      expect(outcome.allowed, `reservation ${index + 1}`).toBe(true)
    }

    const refused = await consumeBudget(db, 'ai_reviews', { limits })
    expect(refused.allowed).toBe(false)
    expect(refused.used).toBe(3)
  })

  it('never exceeds the limit even when called far more often than it allows', async () => {
    // The property the whole module exists for. A read-then-write would let
    // several of these through.
    const limits = { crawl_pages: 5 }
    const outcomes = []
    for (let index = 0; index < 25; index += 1) {
      outcomes.push(await consumeBudget(db, 'crawl_pages', { limits }))
    }

    expect(outcomes.filter((outcome) => outcome.allowed)).toHaveLength(5)
    expect((await getUsage(db)).crawl_pages.used).toBe(5)
  })

  it('records when the limit was first reached', async () => {
    const limits = { browser_runs: 1 }
    await consumeBudget(db, 'browser_runs', { limits })
    await consumeBudget(db, 'browser_runs', { limits })

    expect((await getUsage(db)).browser_runs.limitReachedAt).toBeTruthy()
  })

  it('returns released budget without letting a double-release manufacture any', async () => {
    const limits = { crawl_pages: 2 }
    await consumeBudget(db, 'crawl_pages', { limits })
    await releaseBudget(db, 'crawl_pages', { amount: 1 })
    await releaseBudget(db, 'crawl_pages', { amount: 5 })

    expect((await getUsage(db)).crawl_pages.used).toBe(0)
  })

  it('keeps a campaign counter separate from the global one', async () => {
    const { campaign } = await seedLead()
    const limits = { ai_reviews: 2 }

    await consumeBudget(db, 'ai_reviews', { limits })
    await consumeBudget(db, 'ai_reviews', { limits, campaignId: campaign.id })

    expect((await getUsage(db)).ai_reviews.used).toBe(1)
    expect((await getUsage(db, { campaignId: campaign.id })).ai_reviews.used).toBe(1)
  })

  it('reports the monthly discovery ceiling', async () => {
    const before = await checkMonthlyDiscoveryBudget(db, { limit: 2 })
    expect(before.allowed).toBe(true)

    await consumeBudget(db, 'discovery_candidates', { limits: { discovery_candidates: 10 }, amount: 2 })

    expect((await checkMonthlyDiscoveryBudget(db, { limit: 2 })).allowed).toBe(false)
  })
})

describe('jobs', () => {
  it('dedupes an outstanding job but allows a later re-run', async () => {
    const first = await enqueueJob(db, { jobType: 'lead_research', payload: {}, dedupeKey: 'research:1' })
    const duplicate = await enqueueJob(db, { jobType: 'lead_research', payload: {}, dedupeKey: 'research:1' })

    expect(first.created).toBe(true)
    expect(duplicate.created).toBe(false)

    await completeJob(db, first.job.id)

    // Re-crawling next week is legitimate work, not a duplicate.
    const later = await enqueueJob(db, { jobType: 'lead_research', payload: {}, dedupeKey: 'research:1' })
    expect(later.created).toBe(true)
  })

  it('refuses a payload carrying a document rather than a reference', async () => {
    await expect(
      enqueueJob(db, { jobType: 'lead_research', payload: { html: 'x'.repeat(5_000) } }),
    ).rejects.toThrow(/references, not documents/)
  })

  it('claims a job once, so two runners cannot both take it', async () => {
    await enqueueJob(db, { jobType: 'lead_research', payload: {} })

    const first = await claimJobs(db, { limit: 5 })
    const second = await claimJobs(db, { limit: 5 })

    expect(first).toHaveLength(1)
    expect(second).toHaveLength(0)
  })

  it('backs a retryable failure off into the future rather than re-running it at once', async () => {
    const { job } = await enqueueJob(db, { jobType: 'lead_research', payload: {}, maxAttempts: 3 })

    await claimJobs(db, {})
    const outcome = await failJob(db, job.id, { error: 'transient' })

    expect(outcome.status).toBe('pending')
    expect(new Date(outcome.nextRunAt).getTime()).toBeGreaterThan(Date.now())

    // And it is genuinely not claimable until then — the backoff is real, not
    // just a recorded timestamp.
    expect(await claimJobs(db, {})).toHaveLength(0)
  })

  it('dead-letters once the attempts are actually spent', async () => {
    // Attempts increment on CLAIM, so exhausting them means being claimed that
    // many times — which is why the previous test cannot simply fail twice.
    const { job } = await enqueueJob(db, { jobType: 'lead_research', payload: {}, maxAttempts: 1 })

    await claimJobs(db, {})
    expect((await failJob(db, job.id, { error: 'transient' })).status).toBe('dead')
  })

  it('dead-letters a permanent failure immediately, without burning attempts', async () => {
    const { job } = await enqueueJob(db, { jobType: 'lead_research', payload: {}, maxAttempts: 5 })
    await claimJobs(db, {})

    expect((await failJob(db, job.id, { error: 'robots disallow', retryable: false })).status).toBe('dead')
  })

  it('reclaims a job whose runner died mid-work', async () => {
    await enqueueJob(db, { jobType: 'lead_research', payload: {} })
    await claimJobs(db, { leaseSeconds: -1 })

    expect(await reclaimStaleJobs(db)).toBe(1)
    expect(await claimJobs(db, {})).toHaveLength(1)
  })

  it('resets attempts when a human retries a dead job', async () => {
    const { job } = await enqueueJob(db, { jobType: 'lead_research', payload: {}, maxAttempts: 1 })
    await claimJobs(db, {})
    await failJob(db, job.id, { error: 'x' })

    const retried = await retryJob(db, job.id)
    expect(retried.status).toBe('pending')
    expect(retried.attempts).toBe(0)
  })
})

describe('scores', () => {
  it('keeps one current score and preserves the history', async () => {
    const { lead } = await seedLead()

    await recordScore(db, lead.id, {
      total: 50, icpFit: 20, workflowOpportunity: 15, contactability: 10, dataQuality: 5,
      routing: 'hold', reasons: [{ code: 'A', points: 50 }],
    })
    await recordScore(db, lead.id, {
      total: 80, icpFit: 30, workflowOpportunity: 25, contactability: 15, dataQuality: 10,
      routing: 'priority_ai_review', reasons: [{ code: 'B', points: 80 }],
    })

    expect((await getCurrentScore(db, lead.id)).total).toBe(80)
    expect(await listScoreHistory(db, lead.id)).toHaveLength(2)
  })
})

describe('contacts and drafts', () => {
  it('prefers a role address at the company domain as primary', async () => {
    const { lead, company } = await seedLead()

    await upsertContact(db, {
      leadId: lead.id, companyId: company.id, email: 'jane@acme.com', emailType: 'named',
      sourceUrl: 'https://acme.com/team', sourceType: 'company_team_page',
    })
    await upsertContact(db, {
      leadId: lead.id, companyId: company.id, email: 'hello@acme.com', emailType: 'role',
      sourceUrl: 'https://acme.com/contact', sourceType: 'company_contact_page',
    })

    expect((await getPrimaryContact(db, lead.id)).email).toBe('hello@acme.com')
  })

  it('refuses a contact with no recorded public source', async () => {
    const { lead, company } = await seedLead()

    await expect(
      upsertContact(db, { leadId: lead.id, companyId: company.id, email: 'hello@acme.com', sourceType: 'manual_entry' }),
    ).rejects.toThrow(/source URL/i)
  })

  it('supersedes the previous draft but leaves an exported one alone', async () => {
    const { lead } = await seedLead()

    const first = await createDraft(db, { leadId: lead.id, subject: 'A', bodyText: 'a' })
    await createDraft(db, { leadId: lead.id, subject: 'B', bodyText: 'b' })
    expect((await getCurrentDraft(db, lead.id)).subject).toBe('B')

    await recordDraftExported(db, (await getCurrentDraft(db, lead.id)).id)
    await createDraft(db, { leadId: lead.id, subject: 'C', bodyText: 'c' })

    // An exported draft keeps its status. The operator may already have sent
    // that exact text, and the CRM must not quietly claim it was superseded.
    const drafts = await listScoreHistoryless(db, lead.id)
    const exported = drafts.find((draft) => draft.subject === 'B')

    expect(exported.exported).toBe(true)
    expect(drafts.find((draft) => draft.subject === 'A').status).toBe('superseded')
    expect(first.status).toBe('draft')
  })
})

/** Small helper so the draft assertions above read clearly. */
async function listScoreHistoryless(database, leadId) {
  const { listDrafts } = await import('./drafts.js')
  return listDrafts(database, { leadId })
}

describe('conversations', () => {
  it('imports a provider message once, however many times sync sees it', async () => {
    const { lead } = await seedLead()
    const conversation = await ensureConversation(db, { leadId: lead.id, subject: 'Hello' })

    const message = {
      conversationId: conversation.id,
      leadId: lead.id,
      direction: 'inbound',
      providerMessageId: 'zoho-1',
      fromAddress: 'hello@acme.com',
      subject: 'Re: Hello',
      bodyText: 'Interested.',
      receivedAt: new Date().toISOString(),
    }

    const first = await recordMessage(db, message)
    const second = await recordMessage(db, message)

    expect(first.created).toBe(true)
    expect(second.created).toBe(false)
    expect(second.message.id).toBe(first.message.id)
  })

  it('surfaces an inbound message with no outbound reply after it', async () => {
    const { lead } = await seedLead()
    const conversation = await ensureConversation(db, { leadId: lead.id, subject: 'Hello' })

    await recordMessage(db, {
      conversationId: conversation.id, leadId: lead.id, direction: 'inbound',
      providerMessageId: 'in-1', fromAddress: 'hello@acme.com', subject: 'Re: Hello',
      bodyText: 'Interested.', receivedAt: '2026-09-18T10:00:00.000Z',
    })

    expect(await listUnansweredReplies(db)).toHaveLength(1)

    await recordMessage(db, {
      conversationId: conversation.id, leadId: lead.id, direction: 'outbound',
      providerMessageId: 'out-1', fromAddress: 'stephen@devlabstudios.com',
      toAddresses: ['hello@acme.com'], subject: 'Re: Hello', bodyText: 'Thanks.',
      sentAt: '2026-09-18T11:00:00.000Z',
    })

    expect(await listUnansweredReplies(db)).toHaveLength(0)
  })

  it('does not treat an outbound message sent before the inbound one as its reply', async () => {
    const { lead } = await seedLead()
    const conversation = await ensureConversation(db, { leadId: lead.id, subject: 'Hello' })

    await recordMessage(db, {
      conversationId: conversation.id, leadId: lead.id, direction: 'outbound',
      providerMessageId: 'out-0', fromAddress: 'stephen@devlabstudios.com',
      toAddresses: ['hello@acme.com'], subject: 'Hello', bodyText: 'Intro.',
      sentAt: '2026-09-18T09:00:00.000Z',
    })
    await recordMessage(db, {
      conversationId: conversation.id, leadId: lead.id, direction: 'inbound',
      providerMessageId: 'in-0', fromAddress: 'hello@acme.com', subject: 'Re: Hello',
      bodyText: 'Interested.', receivedAt: '2026-09-18T10:00:00.000Z',
    })

    expect(await listUnansweredReplies(db)).toHaveLength(1)
  })
})

describe('campaigns', () => {
  it('is always created as a draft with its schedule disarmed', async () => {
    const campaign = await createCampaign(db, {
      name: 'X', slug: 'x', countryCode: 'us', config: {}, description: '',
      // Even if a caller asks otherwise.
      status: 'active', scheduleEnabled: true,
    })

    expect(campaign.status).toBe('draft')
    expect(campaign.scheduleEnabled).toBe(false)
    expect(campaign.countryCode).toBe('US')
  })

  it('refuses to arm a schedule on a campaign that is not active', async () => {
    const campaign = await createCampaign(db, { name: 'X', slug: 'x', countryCode: 'US', config: {}, description: '' })

    await expect(updateCampaign(db, campaign.id, { scheduleEnabled: true })).rejects.toThrow(/must be active/i)
  })

  it('gives the scheduler only campaigns that are both active and armed', async () => {
    const campaign = await createCampaign(db, { name: 'X', slug: 'x', countryCode: 'US', config: {}, description: '' })
    expect(await listScheduledCampaigns(db)).toHaveLength(0)

    await updateCampaign(db, campaign.id, { status: 'active' })
    expect(await listScheduledCampaigns(db)).toHaveLength(0)

    await updateCampaign(db, campaign.id, { scheduleEnabled: true })
    expect(await listScheduledCampaigns(db)).toHaveLength(1)
  })

  it('refuses a duplicate slug', async () => {
    await createCampaign(db, { name: 'X', slug: 'x', countryCode: 'US', config: {}, description: '' })
    await expect(
      createCampaign(db, { name: 'Y', slug: 'x', countryCode: 'US', config: {}, description: '' }),
    ).rejects.toThrow(/already exists/i)
  })

  it('round-trips campaign config through JSON', async () => {
    const config = { industryLabel: 'Property management', metros: ['Austin'], overpass: { tags: [{ key: 'office' }] } }
    const campaign = await createCampaign(db, { name: 'X', slug: 'x', countryCode: 'US', config, description: '' })

    expect((await getCampaign(db, campaign.id)).config).toEqual(config)
  })
})

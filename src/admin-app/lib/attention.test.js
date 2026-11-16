import { describe, expect, it } from 'vitest'
import { inquiryAttention, INQUIRY_LIST_LIMIT, leadCrmAttention, mailboxAttention } from './attention'

describe('needs attention (ADMIN-03, ADMIN-04)', () => {
  it('inquiries: new and failed, from the list endpoint, marked capped at its limit', () => {
    const a = inquiryAttention([{}, {}], [{}])
    expect(a.total).toBe(3)
    expect(a.items.map((i) => [i.key, i.count, i.capped])).toEqual([['new', 2, false], ['failed', 1, false]])
    expect(inquiryAttention(Array.from({ length: INQUIRY_LIST_LIMIT }), []).items[0].capped).toBe(true)
    expect(inquiryAttention(null, undefined).total).toBe(0)
  })

  it('Lead CRM: only the dashboard’s own actionable counts', () => {
    const a = leadCrmAttention({ flags: { engine: true }, actionable: { qualifiedAwaitingReview: { count: 4 }, newReplies: { count: 1 }, readyToContact: { count: 2 } } })
    expect(a.total).toBe(7)
    expect(a.engineOn).toBe(true)
    expect(leadCrmAttention({}).total).toBe(0)
  })

  it('Mailbox: unread in the human mailboxes (not DMARC or bounces), plus failed replies', () => {
    const a = mailboxAttention({
      humanMailboxes: ['hello', 'postmaster'],
      unread: { hello: { unread: 3 }, postmaster: { unread: 1 }, dmarc: { unread: 90 } },
      outbound: { failed: 2 },
      awaitingTransmission: 5,
    })
    expect(a.items.map((i) => [i.key, i.count])).toEqual([['unread', 4], ['failed', 2], ['outbox', 5]])
    expect(a.total).toBe(6)
  })
})

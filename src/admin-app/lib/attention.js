// "Needs attention" (ADMIN-03, ADMIN-04): what each area of the workspace is
// waiting on a person for, read only from values its own endpoint already
// returns. No new metric, no new endpoint. Pure, so each extraction is
// unit-tested; useAttention (components/AttentionContext.jsx) does the fetching.

/** The inquiry list is capped by its endpoint; at the cap the count is shown as "N+". */
export const INQUIRY_LIST_LIMIT = 500

export const ATTENTION_SOURCES = {
  inquiries: {
    newInquiries: `/api/admin/leads?pipelineStatus=new&limit=${INQUIRY_LIST_LIMIT}`,
    failedDeliveries: `/api/admin/leads?status=failed&limit=${INQUIRY_LIST_LIMIT}`,
  },
  leadCrm: '/api/admin/lead-crm/dashboard',
  mailbox: '/api/admin/mailbox/diagnostics',
}

/** { count, capped } from an inquiry list response (an array). */
export function listCount(list) {
  const count = Array.isArray(list) ? list.length : 0
  return { count, capped: count >= INQUIRY_LIST_LIMIT }
}

export function inquiryAttention(newList, failedList) {
  const fresh = listCount(newList)
  const failed = listCount(failedList)
  return {
    total: fresh.count + failed.count,
    items: [
      { key: 'new', label: 'New inquiries to read', ...fresh, to: '/admin/leads' },
      { key: 'failed', label: 'Inquiries whose notification email failed', ...failed, to: '/admin/leads' },
    ],
  }
}

export function leadCrmAttention(dashboard) {
  const actionable = dashboard?.actionable ?? {}
  const n = (key) => Number(actionable[key]?.count ?? 0)
  const items = [
    { key: 'review', label: 'Qualified leads awaiting review', count: n('qualifiedAwaitingReview'), to: '/admin/lead-crm/review' },
    { key: 'replies', label: 'Replies not yet answered', count: n('newReplies'), to: '/admin/lead-crm/replies' },
    { key: 'contact', label: 'Approved, ready to contact', count: n('readyToContact'), to: '/admin/lead-crm/leads' },
  ]
  return { total: items.reduce((sum, item) => sum + item.count, 0), items, engineOn: Boolean(dashboard?.flags?.engine) }
}

export function mailboxAttention(diagnostics) {
  const unread = diagnostics?.unread ?? {}
  const human = diagnostics?.humanMailboxes ?? []
  const unreadHuman = human.reduce((sum, mailbox) => sum + Number(unread[mailbox]?.unread ?? 0), 0)
  const failed = Number(diagnostics?.outbound?.failed ?? 0)
  const waiting = Number(diagnostics?.awaitingTransmission ?? 0)
  return {
    total: unreadHuman + failed,
    items: [
      { key: 'unread', label: 'Unread messages', count: unreadHuman, to: '/admin/mailbox/inbox' },
      { key: 'failed', label: 'Replies that could not be sent', count: failed, to: '/admin/mailbox/failed' },
      { key: 'outbox', label: 'Replies waiting for the sender', count: waiting, to: '/admin/mailbox/outbox' },
    ],
  }
}

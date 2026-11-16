import { useState } from 'react'
import { formatDate, humanize, relativeTime } from './format'
import { Badge, EmptyState, Panel } from './shared'
import { useResource } from './useResource'
import { LoadState } from '../../primitives/index.jsx'

/**
 * Conversations — a lightweight sales inbox.
 *
 * Read-only. Nothing on this screen edits a message, because the thread is a
 * record of what was actually said and its value comes entirely from being
 * exactly that. Replying happens in the Replies queue and, ultimately, in your own mail client.
 */

const STATUS_TONES = {
  open: 'bg-sky-100 text-sky-800',
  awaiting_reply: 'bg-amber-100 text-amber-800',
  needs_attention: 'bg-emerald-100 text-emerald-800',
  resolved: 'bg-slate-100 text-slate-600',
  closed: 'bg-slate-100 text-slate-400',
}

function ConversationThread({ conversationId }) {
  const { data, state } = useResource(
    conversationId ? `/api/admin/lead-crm/conversations/${conversationId}` : null,
    { skip: !conversationId },
  )

  if (!conversationId) return <EmptyState title="Select a conversation." />
  if (state === 'loading') return <p className="text-sm text-slate-500">Loading…</p>
  if (state === 'error') return <p className="text-sm text-rose-600">This conversation could not be loaded.</p>
  if (!data) return null

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-base font-semibold text-slate-900">{data.conversation.companyName}</h3>
        <p className="text-xs text-slate-500">
          {data.conversation.subject || 'No subject'} · {data.messages.length} message
          {data.messages.length === 1 ? '' : 's'}
        </p>
      </div>

      <ul className="space-y-3">
        {data.messages.map((message) => {
          const inbound = message.direction === 'inbound'
          return (
            <li
              key={message.id}
              className={`rounded-lg border p-3 ${inbound ? 'border-emerald-200 bg-emerald-50/50' : 'border-slate-200 bg-white'}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-700">
                  {inbound ? message.fromAddress : 'DevLab — sent by hand'}
                </span>
                <span className="text-xs text-slate-400">{formatDate(message.receivedAt || message.sentAt)}</span>
              </div>
              <p className="mt-1 text-sm font-medium text-slate-800">{message.subject}</p>
              <pre className="mt-1 whitespace-pre-wrap font-sans text-sm text-slate-700">{message.bodyText}</pre>
              {message.bodyTruncated ? (
                <p className="mt-1 text-xs text-slate-400">Body truncated — open the message in your mail client to read it in full.</p>
              ) : null}
              {message.aiIntent ? (
                <p className="mt-2 border-t border-slate-200 pt-2 text-xs text-slate-500">
                  <Badge value={message.aiIntent} />{' '}
                  {message.aiSummary ? <span className="ml-1">{message.aiSummary}</span> : null}
                </p>
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function ConversationsPage() {
  const [status, setStatus] = useState('')
  const { data, state } = useResource(`/api/admin/lead-crm/conversations${status ? `?status=${status}` : ''}`)
  const [selectedId, setSelectedId] = useState(null)

  const conversations = data?.conversations ?? []

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Conversations</h1>
          <p className="mt-1 text-sm text-slate-500">
            Every exchange, as it happened. Messages are never edited after they are imported.
          </p>
        </div>
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          aria-label="Conversation status"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
        >
          <option value="">All statuses</option>
          <option value="needs_attention">Needs attention</option>
          <option value="awaiting_reply">Awaiting reply</option>
          <option value="open">Open</option>
          <option value="resolved">Resolved</option>
          <option value="closed">Closed</option>
        </select>
      </div>

      <LoadState state={state} label="conversations" />
      {state === 'ready' && conversations.length === 0 ? (
        <EmptyState title="No conversations yet." hint="One is created the first time you export a draft for a lead." />
      ) : null}

      {conversations.length > 0 ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
          <ul className="space-y-2">
            {conversations.map((conversation) => (
              <li key={conversation.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(conversation.id)}
                  className={`w-full rounded-xl border p-3 text-left transition ${
                    selectedId === conversation.id
                      ? 'border-slate-900 bg-white'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-semibold text-slate-800">{conversation.companyName}</span>
                    <Badge value={conversation.status} tones={STATUS_TONES} />
                  </div>
                  <p className="mt-0.5 truncate text-xs text-slate-500">{conversation.subject || 'No subject'}</p>
                  <p className="mt-1 text-xs text-slate-400">
                    {conversation.messageCount} message{conversation.messageCount === 1 ? '' : 's'} ·{' '}
                    {relativeTime(conversation.lastMessageAt)} · {humanize(conversation.stage)}
                  </p>
                </button>
              </li>
            ))}
          </ul>

          <Panel>
            <ConversationThread conversationId={selectedId ?? conversations[0]?.id} />
          </Panel>
        </div>
      ) : null}
    </div>
  )
}

export default ConversationsPage

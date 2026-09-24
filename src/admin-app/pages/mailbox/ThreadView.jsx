import { useState } from 'react'
import { Link } from 'react-router-dom'
import { adminApi } from '../../lib/adminApi'
import { buttonClass, formatDate, inputClass, primaryButtonClass } from '../lead-crm/format'
import { EmptyState, Feedback } from '../lead-crm/shared'
import { useResource } from '../lead-crm/useResource'
import MessageBody from './MessageBody'
import AttachmentPicker from './AttachmentPicker'
import DmarcReportView from './DmarcReportView'
import { looksLikeDmarcReport } from '../../../mailbox/inbound/dmarcReport.js'

/**
 * One conversation, and the box to answer it.
 *
 * THE THING THIS SCREEN HAS TO BE HONEST ABOUT: pressing Send does not send.
 * It hands the reply to an external sender which transmits it on its next run.
 * Every other mail client in the world sends on Send, so saying nothing would
 * be actively misleading — the button, the confirmation and the Outbox folder
 * all say so.
 */

const AUTH_TONES = {
  pass: 'text-emerald-700',
  fail: 'text-rose-700',
  softfail: 'text-amber-700',
  neutral: 'text-slate-500',
  none: 'text-slate-500',
}

function AuthResults({ auth }) {
  if (!auth || (!auth.spf && !auth.dkim && !auth.dmarc)) return null

  return (
    <span className="flex flex-wrap gap-2 text-xs">
      {['spf', 'dkim', 'dmarc'].map((mechanism) =>
        auth[mechanism] ? (
          <span key={mechanism} className={AUTH_TONES[auth[mechanism]] ?? 'text-slate-500'}>
            {mechanism.toUpperCase()} {auth[mechanism]}
          </span>
        ) : null,
      )}
    </span>
  )
}

function Attachments({ attachments }) {
  if (!attachments || attachments.length === 0) return null

  return (
    <ul className="mt-2 flex flex-wrap gap-2">
      {attachments.map((attachment) => (
        <li key={attachment.id}>
          {attachment.r2Key ? (
            <a
              href={`/api/admin/mailbox/attachments/${attachment.id}`}
              // Downloads only — the route serves everything with an attachment
              // disposition and a re-derived content type, never inline.
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
            >
              {attachment.filename}
              <span className="text-slate-400">{Math.max(1, Math.round(attachment.size / 1024))} KB</span>
            </a>
          ) : (
            <span
              className="inline-flex items-center gap-1 rounded-lg border border-dashed border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-800"
              title={attachment.skippedReason ?? ''}
            >
              {attachment.filename} — not stored
            </span>
          )}
        </li>
      ))}
    </ul>
  )
}

function ReplyBox({ threadId, parentMessageId, onDone }) {
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState(null)
  const [attachmentIds, setAttachmentIds] = useState([])
  // Bumped after a send so AttachmentPicker remounts and forgets its file
  // list. Clearing `attachmentIds` alone left the previous reply's files
  // still listed under the box while no longer attached to anything -- a UI
  // that shows files it will not send is worse than one that shows none.
  const [pickerKey, setPickerKey] = useState(0)

  async function submit(asDraft) {
    if (!body.trim() && !asDraft) return

    setBusy(true)
    setFeedback(null)
    try {
      await adminApi.post(`/api/admin/mailbox/threads/${threadId}/reply`, {
        bodyText: body,
        inReplyToMessageId: parentMessageId ?? null,
        asDraft,
        attachmentIds,
      })
      setBody('')
      setAttachmentIds([])
      setPickerKey((current) => current + 1)
      setFeedback({
        tone: 'ok',
        message: asDraft
          ? 'Saved to Drafts. Nothing will be transmitted until you send it.'
          : 'Queued. It moves to Sent once the external sender confirms it went out.',
      })
      onDone?.()
    } catch (error) {
      setFeedback({ tone: 'error', message: error.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        submit(false)
      }}
      className="space-y-2 border-t border-slate-200 pt-3"
    >
      <label className="block text-xs font-semibold text-slate-600" htmlFor={`reply-${threadId}`}>
        Reply as hello@devlabconnect.com
      </label>
      <textarea
        id={`reply-${threadId}`}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        rows={6}
        className={`${inputClass} w-full font-sans`}
        placeholder="Write your reply…"
      />
      <AttachmentPicker key={pickerKey} attachmentIds={attachmentIds} onChange={setAttachmentIds} disabled={busy} />
      <Feedback feedback={feedback} />
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={busy || !body.trim()} className={primaryButtonClass}>
          {busy ? 'Working…' : 'Send'}
        </button>
        <button type="button" disabled={busy || !body.trim()} onClick={() => submit(true)} className={buttonClass}>
          Save draft
        </button>
        <p className="text-xs text-slate-500">
          Send hands it to the external sender — it appears in Outbox, then Sent once confirmed.
        </p>
      </div>
    </form>
  )
}

/**
 * @param {{ threadId: string|null, onChanged?: () => void }} props
 */
function ThreadView({ threadId, onChanged }) {
  const { data, state, reload } = useResource(threadId ? `/api/admin/mailbox/threads/${threadId}` : null, {
    skip: !threadId,
  })
  const [busy, setBusy] = useState(false)

  if (!threadId) return <EmptyState title="Select a conversation." />
  if (state === 'loading') return <p className="text-sm text-slate-500">Loading…</p>
  if (state === 'error') return <p className="text-sm text-rose-600">This conversation could not be loaded.</p>
  if (!data) return null

  async function setThreadState(next) {
    setBusy(true)
    try {
      await adminApi.post(`/api/admin/mailbox/threads/${threadId}/state`, next)
      reload()
      onChanged?.()
    } finally {
      setBusy(false)
    }
  }

  const { thread, messages, outbound } = data
  const pending = (outbound ?? []).filter((item) => item.status === 'queued' || item.status === 'collected')
  const drafts = (outbound ?? []).filter((item) => item.status === 'draft')
  const failed = (outbound ?? []).filter((item) => item.status === 'failed')
  const lastInbound = [...messages].reverse().find((message) => message.direction === 'inbound')

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-slate-900">{thread.subject || '(no subject)'}</h3>
          <p className="text-xs text-slate-500">
            {thread.correspondent}
            {thread.companyName ? ` · ${thread.companyName}` : ''} · {messages.length} message
            {messages.length === 1 ? '' : 's'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => setThreadState({ read: true })} className={buttonClass}>
            Mark read
          </button>
          <button type="button" disabled={busy} onClick={() => setThreadState({ read: false })} className={buttonClass}>
            Unread
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setThreadState({ state: thread.state === 'archived' ? 'inbox' : 'archived' })}
            className={buttonClass}
          >
            {thread.state === 'archived' ? 'Move to inbox' : 'Archive'}
          </button>
        </div>
      </div>

      {thread.leadId ? (
        <p className="text-xs text-slate-500">
          Linked to a lead —{' '}
          <Link className="font-semibold underline" to={`/admin/lead-crm/leads?lead=${thread.leadId}`}>
            open in Lead CRM
          </Link>
          . This message also appears in the CRM&apos;s Conversations and Replies queue.
        </p>
      ) : null}

      {failed.length > 0 ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {failed.length} repl{failed.length === 1 ? 'y' : 'ies'} could not be transmitted.{' '}
          {failed[0].error ? <span className="text-xs">Last error: {failed[0].error}</span> : null}
        </div>
      ) : null}

      {pending.length > 0 ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {pending.length} repl{pending.length === 1 ? 'y is' : 'ies are'} in the Outbox, waiting for the external
          sender.
        </div>
      ) : null}

      {drafts.length > 0 ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
          {drafts.length} unsent draft{drafts.length === 1 ? '' : 's'} on this thread —{' '}
          <Link className="font-semibold underline" to="/admin/mailbox/drafts">
            open Drafts
          </Link>
          .
        </div>
      ) : null}

      <ul className="space-y-3">
        {messages.map((message) => {
          const inbound = message.direction === 'inbound'
          return (
            <li
              key={message.id}
              className={`rounded-lg border p-3 ${inbound ? 'border-emerald-200 bg-emerald-50/40' : 'border-slate-200 bg-white'}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-700">
                  {inbound ? message.fromAddress : 'hello@devlabconnect.com'}
                </span>
                <span className="text-xs text-slate-400">{formatDate(message.receivedAt || message.sentAt)}</span>
              </div>

              <div className="mt-1 flex flex-wrap items-center gap-3">
                <p className="text-sm font-medium text-slate-800">{message.subject || '(no subject)'}</p>
                <AuthResults auth={message.auth} />
              </div>

              {message.isDsn && message.dsn ? (
                <div className="my-2 rounded border border-rose-200 bg-rose-50 px-2 py-1 text-xs text-rose-800">
                  Delivery failure for {message.dsn.recipient ?? 'a recipient'} — status {message.dsn.status ?? '—'} (
                  {message.dsn.action ?? 'unknown action'}).
                  {message.dsn.diagnostic ? <span className="block">{message.dsn.diagnostic}</span> : null}
                  {message.correlationMethod === 'verp' || message.correlationMethod === 'message_id' ? (
                    <span className="block text-rose-600">
                      Matched by {message.correlationMethod === 'verp' ? 'return path' : 'message ID'} — an identifier
                      we issued, so this report is trustworthy.
                    </span>
                  ) : message.correlationMethod === 'address' ? (
                    // A delivery report cannot be authenticated: it comes from
                    // an arbitrary MTA with no envelope sender to check.
                    // Matching on the address alone means trusting a line the
                    // sender wrote, so it is shown rather than acted on.
                    <span className="block text-rose-600">
                      Matched by recipient address only, which any sender can assert — recorded, but nothing was
                      suppressed. If this is genuine, suppress the address on the{' '}
                      <Link className="underline" to="/admin/lead-crm/suppression">
                        Suppression screen
                      </Link>
                      .
                    </span>
                  ) : (
                    <span className="block text-rose-600">
                      Not matched to an outreach draft, so nothing was suppressed.
                    </span>
                  )}
                </div>
              ) : null}

              {message.parseStatus !== 'ok' ? (
                <p className="my-2 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-900">
                  This message was stored but not fully read ({message.parseStatus}).
                  {message.parseError ? ` ${message.parseError}` : ''} The original is still available below.
                </p>
              ) : null}

              <div className="mt-2">
                {/*
                  A DMARC aggregate report has no readable body -- the content is
                  a compressed XML attachment. Rendering the parsed report in its
                  place is the difference between a folder that accumulates
                  evidence and one that reports it.
                */}
                {(() => {
                  const report = (message.attachments ?? []).find(
                    (attachment) => attachment.r2Key && looksLikeDmarcReport(attachment),
                  )
                  return report ? <DmarcReportView attachment={report} /> : <MessageBody message={message} />
                })()}
              </div>

              <Attachments attachments={message.attachments} />

              {message.rawKey ? (
                <a
                  href={`/api/admin/mailbox/messages/${message.id}/raw`}
                  className="mt-2 inline-block text-xs text-slate-500 underline"
                >
                  Download original (.eml)
                </a>
              ) : null}
            </li>
          )
        })}
      </ul>

      <ReplyBox
        threadId={thread.id}
        parentMessageId={lastInbound?.id ?? null}
        onDone={() => {
          reload()
          // The list shows message counts and last-activity time, so it is
          // stale too — every other mutation on this screen refreshes both.
          onChanged?.()
        }}
      />
    </div>
  )
}

export default ThreadView

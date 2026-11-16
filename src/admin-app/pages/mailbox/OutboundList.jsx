import { useState } from 'react'
import { Link } from 'react-router-dom'
import { adminApi } from '../../lib/adminApi'
import { buttonClass, dangerButtonClass, formatDate, inputClass, primaryButtonClass } from '../lead-crm/format'
import { Badge, EmptyState, Feedback } from '../lead-crm/shared'
import { OUTBOUND_STATUS_TONES } from './folders'
import { confirmAction } from '../../primitives/confirm'

/**
 * The Drafts, Outbox and Failed folders.
 *
 * These read `mailbox_outbound` rather than the thread tables, because a reply
 * that has not been transmitted is not yet part of any conversation the
 * recipient can see. That is also why they are a separate component: a thread
 * list and a queue of pending sends answer different questions and should not
 * be forced into one shape.
 *
 * ONLY A DRAFT IS EDITABLE. Once a reply is queued the external sender may
 * already have collected it, and editing then would change what the CMS shows
 * without changing what went on the wire — the thread would display text nobody
 * received. The API refuses it too; this just does not offer it.
 */

/**
 * Puts one failed reply back in the queue.
 *
 * Confirmed first, because the consequence is not recoverable: if the failure
 * happened after the message reached a mail server, retrying sends a second
 * copy to a real person. The API refuses anything that is not `failed`, so the
 * ambiguous `collected` state cannot be retried from here or anywhere else.
 */
function RetryButton({ item, onChanged }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function retry() {
    if (!(await confirmAction({ title: 'Send this reply again?', body: 'Do this only if you know the message was not transmitted: a reply that reached the mail server would go out twice.', confirmLabel: 'Retry this reply', danger: true }))) return

    setBusy(true)
    setError(null)
    try {
      await adminApi.post(`/api/admin/mailbox/outbound/${item.id}/retry`, {})
      onChanged?.()
    } catch (caught) {
      setError(caught.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="mt-2 block">
      <button
        type="button"
        onClick={retry}
        disabled={busy}
        className="rounded border border-rose-300 bg-white px-2 py-0.5 font-semibold text-rose-800 disabled:opacity-50"
      >
        {busy ? 'Queueing…' : 'Retry this reply'}
      </button>
      {error ? <span className="ml-2 text-rose-700">{error}</span> : null}
    </span>
  )
}

function DraftEditor({ item, onChanged }) {
  const [subject, setSubject] = useState(item.subject ?? '')
  const [body, setBody] = useState(item.bodyText ?? '')
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState(null)

  async function act(payload, successMessage) {
    setBusy(true)
    setFeedback(null)
    try {
      await adminApi.patch(`/api/admin/mailbox/outbound/${item.id}`, payload)
      setFeedback({ tone: 'ok', message: successMessage })
      onChanged?.()
    } catch (error) {
      setFeedback({ tone: 'error', message: error.message })
    } finally {
      setBusy(false)
    }
  }

  async function discard() {
    // ADMIN-06: discarding a draft cannot be undone, so it asks first.
    if (!(await confirmAction({ title: 'Discard this draft?', body: 'The draft and its attachments are deleted. This cannot be undone.', confirmLabel: 'Discard draft', danger: true }))) return
    setBusy(true)
    setFeedback(null)
    try {
      await adminApi.delete(`/api/admin/mailbox/outbound/${item.id}`)
      onChanged?.()
    } catch (error) {
      setFeedback({ tone: 'error', message: error.message })
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2 border-t border-slate-200 pt-3">
      <label className="block text-xs font-semibold text-slate-600" htmlFor={`subject-${item.id}`}>
        Subject
      </label>
      <input
        id={`subject-${item.id}`}
        value={subject}
        onChange={(event) => setSubject(event.target.value)}
        className={`${inputClass} w-full`}
      />

      <label className="block text-xs font-semibold text-slate-600" htmlFor={`body-${item.id}`}>
        Message
      </label>
      <textarea
        id={`body-${item.id}`}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        rows={8}
        className={`${inputClass} w-full font-sans`}
      />

      <Feedback feedback={feedback} />

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => act({ subject, bodyText: body }, 'Saved.')}
          className={buttonClass}
        >
          Save
        </button>
        <button
          type="button"
          disabled={busy || !body.trim()}
          onClick={() => act({ subject, bodyText: body, send: true }, 'Moved to the Outbox.')}
          className={primaryButtonClass}
        >
          Send
        </button>
        <button type="button" disabled={busy} onClick={discard} className={dangerButtonClass}>
          Discard
        </button>
        <p className="text-xs text-slate-500">Send moves it to the Outbox; it reaches Sent once transmitted.</p>
      </div>
    </div>
  )
}

/**
 * @param {{ folder: string, messages: object[], onChanged?: () => void }} props
 */
function OutboundList({ folder, messages, onChanged }) {
  const [openId, setOpenId] = useState(null)

  if (!messages || messages.length === 0) {
    const empty = {
      drafts: { title: 'No drafts.', hint: 'Start a reply in a thread and choose Save draft.' },
      outbox: {
        title: 'Nothing waiting to go out.',
        hint: 'A reply sits here between being sent and the external sender confirming it.',
      },
      failed: { title: 'No failed replies.', hint: 'Anything the sender could not transmit appears here.' },
    }[folder] ?? { title: 'Nothing here.' }

    return <EmptyState title={empty.title} hint={empty.hint} />
  }

  return (
    <ul className="space-y-2">
      {messages.map((item) => {
        const open = openId === item.id
        const editable = item.status === 'draft'

        return (
          <li key={item.id} className="rounded-xl border border-slate-200 bg-white p-3">
            <button
              type="button"
              onClick={() => setOpenId(open ? null : item.id)}
              className="w-full text-left"
              aria-expanded={open}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="truncate text-sm font-medium text-slate-800">
                  {item.toName ? `${item.toName} <${item.toAddress}>` : item.toAddress}
                </span>
                <span className="flex items-center gap-2">
                  <Badge value={item.status} tones={OUTBOUND_STATUS_TONES} />
                  <span className="text-xs text-slate-400">{formatDate(item.updatedAt)}</span>
                </span>
              </div>
              <p className="truncate text-xs text-slate-600">{item.subject || '(no subject)'}</p>
              {!open ? (
                <p className="mt-1 line-clamp-2 text-xs text-slate-500">{item.bodyText}</p>
              ) : null}
            </button>

            {item.status === 'failed' && item.error ? (
              <div className="mt-2 rounded border border-rose-200 bg-rose-50 px-2 py-1 text-xs text-rose-800">
                {item.error}
                <span className="mt-1 block text-rose-600">
                  This will not be retried on its own — a reply that silently re-queued forever would mail the same
                  person repeatedly the moment a fault cleared. Retry once you know the cause, and know that a send
                  which reported failure may still have reached a mail server.
                </span>
                <RetryButton item={item} onChanged={onChanged} />
              </div>
            ) : null}

            {item.status === 'queued' && item.error ? (
              // The error survives a retry on purpose: while the reply waits
              // again, what went wrong last time is the most useful thing to
              // show about it.
              <p className="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800">
                Queued again after: {item.error}
              </p>
            ) : null}

            {open && editable ? <DraftEditor item={item} onChanged={onChanged} /> : null}

            {open && !editable ? (
              <div className="mt-2 space-y-2 border-t border-slate-200 pt-2">
                <pre className="whitespace-pre-wrap break-words font-sans text-sm text-slate-700">{item.bodyText}</pre>
                <p className="text-xs text-slate-500">
                  Handed to the external sender already, so it can no longer be edited — the thread must show what was
                  actually transmitted.
                </p>
              </div>
            ) : null}

            <Link
              to={`/admin/mailbox/inbox?thread=${item.threadId}`}
              className="mt-2 inline-block text-xs text-slate-500 underline"
            >
              Open the conversation
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

export default OutboundList

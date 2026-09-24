import { useState } from 'react'
import { adminApi } from '../../lib/adminApi'
import AttachmentPicker from './AttachmentPicker'
import { buttonClass, dangerButtonClass, inputClass, primaryButtonClass } from '../lead-crm/format'
import { Feedback } from '../lead-crm/shared'

/**
 * Compose a new message.
 *
 * WHAT IS DELIBERATELY NOT HERE: Cc and Bcc. `mailbox_outbound` has no columns
 * for either, so a field offered here would be accepted, shown back to the
 * operator, and silently dropped on the way to the wire. An absent control is
 * honest; a present one that does nothing is a message the recipient never
 * sees half of.
 *
 * Attachments used to be on that list for the same reason, and are now here
 * because the columns, the upload path and the multipart builder exist — the
 * control appeared only once it could keep its promise.
 *
 * Send does not send. It writes a queued row that the external sender collects,
 * which is why the button says what happens next rather than "Send" alone.
 */
function ComposeDialog({ open, onClose, onSent }) {
  const [to, setTo] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [attachmentIds, setAttachmentIds] = useState([])
  // See ThreadView: remounting the picker is what actually clears its list.
  const [pickerKey, setPickerKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState(null)

  if (!open) return null

  async function submit(asDraft) {
    setBusy(true)
    setFeedback(null)
    try {
      const result = await adminApi.post('/api/admin/mailbox/compose', {
        toAddress: to,
        subject,
        bodyText: body,
        asDraft,
        attachmentIds,
      })
      setTo('')
      setSubject('')
      setBody('')
      setAttachmentIds([])
      setPickerKey((current) => current + 1)
      onSent?.(asDraft ? 'drafts' : 'outbox', result)
      onClose?.()
    } catch (error) {
      setFeedback({ tone: 'error', message: error.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="New message"
    >
      <div className="flex max-h-full w-full flex-col overflow-hidden rounded-t-xl bg-white shadow-xl sm:max-w-2xl sm:rounded-xl">
        <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">New message</h2>
          <button type="button" onClick={onClose} className="text-sm text-slate-500 hover:text-slate-800">
            Close
          </button>
        </header>

        <div className="space-y-3 overflow-y-auto p-4">
          <div>
            <label className="block text-xs font-semibold text-slate-600" htmlFor="compose-to">
              To
            </label>
            <input
              id="compose-to"
              type="email"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              placeholder="name@example.com"
              className={`${inputClass} mt-1 w-full`}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600" htmlFor="compose-subject">
              Subject
            </label>
            <input
              id="compose-subject"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              className={`${inputClass} mt-1 w-full`}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600" htmlFor="compose-body">
              Message
            </label>
            <textarea
              id="compose-body"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={10}
              className={`${inputClass} mt-1 w-full font-sans`}
            />
          </div>

          <AttachmentPicker key={pickerKey} attachmentIds={attachmentIds} onChange={setAttachmentIds} disabled={busy} />

          <p className="text-xs text-slate-500">
            Sent as hello@devlabconnect.com. The body is plain text; files travel as separate attachments. Cc and
            Bcc are still not supported on the way out, so they are not offered here rather than being dropped
            silently.
          </p>

          <Feedback feedback={feedback} />
        </div>

        <footer className="flex flex-wrap items-center gap-2 border-t border-slate-200 px-4 py-3">
          <button
            type="button"
            disabled={busy || !to.trim() || !body.trim()}
            onClick={() => submit(false)}
            className={primaryButtonClass}
          >
            {busy ? 'Working…' : 'Send'}
          </button>
          <button type="button" disabled={busy || !to.trim()} onClick={() => submit(true)} className={buttonClass}>
            Save draft
          </button>
          <button type="button" disabled={busy} onClick={onClose} className={dangerButtonClass}>
            Discard
          </button>
          <p className="text-xs text-slate-500">Send queues it to the Outbox; it reaches Sent once transmitted.</p>
        </footer>
      </div>
    </div>
  )
}

export default ComposeDialog

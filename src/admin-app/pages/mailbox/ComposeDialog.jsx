import { useState } from 'react'
import { adminApi } from '../../lib/adminApi'
import AttachmentPicker from './AttachmentPicker'
import { buttonClass, dangerButtonClass, inputClass, primaryButtonClass } from '../lead-crm/format'
import { Feedback } from '../lead-crm/shared'
import { Dialog } from '../../primitives/Dialog'

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

  function clear() {
    setTo('')
    setSubject('')
    setBody('')
    setAttachmentIds([])
    setPickerKey((current) => current + 1)
    setFeedback(null)
  }

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
      clear()
      onSent?.(asDraft ? 'drafts' : 'outbox', result)
      onClose?.()
    } catch (error) {
      setFeedback({ tone: 'error', message: error.message })
    } finally {
      setBusy(false)
    }
  }

  // MAIL-02: Close (and Escape) keeps what was typed for later; Discard throws it away.
  function discard() {
    clear()
    onClose?.()
  }

  return (
    <Dialog
      open={open}
      title="New message"
      size="lg"
      onClose={onClose}
      footer={(
        <>
          <p className="mr-auto text-xs text-slate-500">Send queues it to the Outbox; it reaches Sent once transmitted.</p>
          <button type="button" disabled={busy} onClick={discard} className={dangerButtonClass}>
            Discard
          </button>
          <button type="button" disabled={busy || !to.trim()} onClick={() => submit(true)} className={buttonClass}>
            Save draft
          </button>
          <button
            type="button"
            disabled={busy || !to.trim() || !body.trim()}
            onClick={() => submit(false)}
            className={primaryButtonClass}
          >
            {busy ? 'Working…' : 'Send'}
          </button>
        </>
      )}
    >
      <div className="space-y-3">
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
    </Dialog>
  )
}

export default ComposeDialog

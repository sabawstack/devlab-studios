import { useState } from 'react'
import { adminApi } from '../lib/adminApi'

/**
 * Data-subject requests for inquiries (audit SEC-08): download everything an
 * address submitted, or erase it. Suppression records are kept so the address
 * is not contacted again. Mailbox correspondence is handled separately.
 */
function PrivacyRequestPanel() {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState(null)

  async function erase() {
    const confirm = window.prompt(`Type ${email} again to erase every inquiry from it. This cannot be undone.`)
    if (!confirm) return
    try {
      const result = await adminApi.delete(`/api/admin/privacy/subject?email=${encodeURIComponent(email)}&confirm=${encodeURIComponent(confirm)}`)
      setMessage(`Erased ${result.inquiries} inquiries.`)
    } catch (error) {
      setMessage(error.message)
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold text-slate-800">
        Privacy requests (export or erase a person)
        <span className="text-xs font-normal text-slate-500">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open ? (
        <div className="flex flex-wrap items-end gap-3 border-t border-slate-200 px-4 py-4 text-sm">
          <label className="grid gap-1 font-semibold text-slate-800">
            Email address
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="w-72 rounded-md border border-slate-300 px-3 py-2 font-normal" />
          </label>
          <a href={email ? `/api/admin/privacy/subject?email=${encodeURIComponent(email)}` : undefined} aria-disabled={!email} className="rounded-md border border-slate-300 px-3 py-2 font-semibold text-slate-700">Download export</a>
          <button type="button" disabled={!email} onClick={erase} className="rounded-md border border-rose-300 px-3 py-2 font-semibold text-rose-700 disabled:opacity-50">Erase</button>
          {message ? <p role="status" className="w-full text-slate-600">{message}</p> : null}
        </div>
      ) : null}
    </section>
  )
}

export default PrivacyRequestPanel

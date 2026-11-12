import { useEffect, useState } from 'react'
import { adminApi } from '../lib/adminApi'
import { INQUIRY_TYPE_LABELS } from '../../lib/schemas/inquiry'

/**
 * Inquiry funnel for a period (audit LEAD-05). Sources of truth: these
 * figures come from the inquiry database; CTA clicks, form starts and page
 * views are in Google Analytics.
 */
function Breakdown({ title, counts, labels = {} }) {
  const entries = Object.entries(counts || {})
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
      {entries.length ? (
        <ul className="mt-1 space-y-0.5 text-sm text-slate-700">
          {entries.map(([key, value]) => <li key={key} className="flex justify-between gap-3"><span>{labels[key] || key}</span><span className="font-semibold">{value}</span></li>)}
        </ul>
      ) : <p className="mt-1 text-sm text-slate-400">None</p>}
    </div>
  )
}

function FunnelPanel() {
  const [days, setDays] = useState(30)
  const [data, setData] = useState(null)
  const [reminders, setReminders] = useState(null)
  const [message, setMessage] = useState(null)

  useEffect(() => {
    let ignore = false
    adminApi.get(`/api/admin/leads/funnel?days=${days}`)
      .then((result) => { if (!ignore) { setData(result.funnel); setReminders(result.reminders) } })
      .catch((error) => !ignore && setMessage(error.message))
    return () => { ignore = true }
  }, [days])

  async function saveReminders(event) {
    event.preventDefault()
    try {
      await adminApi.put('/api/admin/leads/funnel', { enabled: reminders.enabled, hours: Number(reminders.hours) })
      setMessage('Reminder settings saved.')
    } catch (error) {
      setMessage(error.message)
    }
  }

  return (
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4" aria-labelledby="funnel-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="funnel-heading" className="text-base font-semibold text-slate-900">Funnel</h2>
        <label className="text-sm text-slate-600">
          Period{' '}
          <select value={days} onChange={(event) => setDays(Number(event.target.value))} className="rounded-md border border-slate-300 px-2 py-1 text-sm">
            {[7, 30, 90, 365].map((value) => <option key={value} value={value}>Last {value} days</option>)}
          </select>
        </label>
      </div>
      {data ? (
        <>
          <dl className="grid gap-3 text-sm sm:grid-cols-4">
            <div><dt className="text-slate-500">Inquiries</dt><dd className="text-xl font-semibold text-slate-900">{data.total}</dd></div>
            <div><dt className="text-slate-500">Answered</dt><dd className="text-xl font-semibold text-slate-900">{data.answered}</dd></div>
            <div><dt className="text-slate-500">First response (median)</dt><dd className="text-xl font-semibold text-slate-900">{data.firstResponseHours.median === null ? '—' : `${data.firstResponseHours.median} h`}</dd></div>
            <div><dt className="text-slate-500">With a failed delivery</dt><dd className="text-xl font-semibold text-slate-900">{data.withDeliveryFailure}</dd></div>
          </dl>
          <div className="grid gap-4 sm:grid-cols-3">
            <Breakdown title="By type" counts={data.byType} labels={INQUIRY_TYPE_LABELS} />
            <Breakdown title="By source" counts={data.bySource} />
            <Breakdown title="By qualification" counts={data.byQualification} />
          </div>
          <p className="text-xs text-slate-500">From the inquiry database. CTA clicks, form starts and page views are in Google Analytics.</p>
        </>
      ) : <p className="text-sm text-slate-500">Loading…</p>}
      {reminders ? (
        <form onSubmit={saveReminders} className="flex flex-wrap items-end gap-3 border-t border-slate-100 pt-3 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={reminders.enabled} onChange={(event) => setReminders({ ...reminders, enabled: event.target.checked })} />
            Daily reminder about unanswered inquiries
          </label>
          <label className="flex items-center gap-2">
            after
            <input type="number" min="1" max="336" value={reminders.hours} onChange={(event) => setReminders({ ...reminders, hours: event.target.value })} className="w-20 rounded-md border border-slate-300 px-2 py-1" />
            hours
          </label>
          <button type="submit" className="rounded-md border border-slate-300 px-3 py-1 font-semibold text-slate-700">Save</button>
        </form>
      ) : null}
      {message ? <p role="status" className="text-sm text-slate-600">{message}</p> : null}
    </section>
  )
}

export default FunnelPanel

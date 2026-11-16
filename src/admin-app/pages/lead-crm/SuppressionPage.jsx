import { useState } from 'react'
import { adminApi } from '../../lib/adminApi'
import { buttonClass, dangerButtonClass, formatDate, humanize, inputClass, primaryButtonClass } from './format'
import { Badge, EmptyState, Feedback, Panel } from './shared'
import { useResource } from './useResource'
import { LoadState } from '../../primitives/index.jsx'
import { useDebouncedValue } from '../../lib/useDebouncedValue'

/**
 * The suppression registry.
 *
 * A hard boundary, and the screen says so. Removing an entry is treated as the
 * consequential action it is: it requires a written reason, the row is retained
 * rather than deleted, and both the removal and the reason are audited. A
 * suppression that could be quietly undone would not be a boundary.
 */

const REASONS = [
  'unsubscribe',
  'do_not_contact',
  'hard_bounce',
  'complaint',
  'manual_block',
  'existing_client',
  'competitor',
  'other',
]

const REASON_TONES = {
  unsubscribe: 'bg-rose-100 text-rose-800',
  do_not_contact: 'bg-rose-100 text-rose-800',
  complaint: 'bg-rose-200 text-rose-900',
  hard_bounce: 'bg-amber-100 text-amber-800',
  manual_block: 'bg-slate-200 text-slate-700',
  existing_client: 'bg-emerald-100 text-emerald-800',
  competitor: 'bg-slate-100 text-slate-600',
  other: 'bg-slate-100 text-slate-600',
}

function AddForm({ onAdded }) {
  const [form, setForm] = useState({ scope: 'email', value: '', reason: 'do_not_contact', notes: '' })
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState(null)

  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }))

  async function handleSubmit(event) {
    event.preventDefault()
    setBusy(true)
    setFeedback(null)
    try {
      const result = await adminApi.post('/api/admin/lead-crm/suppression', form)
      setForm({ scope: 'email', value: '', reason: 'do_not_contact', notes: '' })
      setFeedback({
        tone: 'ok',
        message: result.created ? 'Added to the suppression list.' : 'That value was already suppressed.',
      })
      onAdded()
    } catch (error) {
      setFeedback({ tone: 'error', message: error.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <Feedback feedback={feedback} />
      <div className="flex flex-wrap gap-2">
        <select value={form.scope} onChange={update('scope')} aria-label="Scope" className={inputClass}>
          <option value="email">Email address</option>
          <option value="domain">Whole domain</option>
        </select>
        <input
          required
          value={form.value}
          onChange={update('value')}
          placeholder={form.scope === 'email' ? 'someone@example.com' : 'example.com'}
          aria-label="Value"
          className={`${inputClass} min-w-[240px] flex-1`}
        />
        <select value={form.reason} onChange={update('reason')} aria-label="Reason" className={inputClass}>
          {REASONS.map((reason) => (
            <option key={reason} value={reason}>
              {humanize(reason)}
            </option>
          ))}
        </select>
        <button type="submit" disabled={busy} className={primaryButtonClass}>
          {busy ? 'Adding…' : 'Suppress'}
        </button>
      </div>
      <input value={form.notes} onChange={update('notes')} placeholder="Notes (optional)" aria-label="Notes (optional)" className={`${inputClass} w-full`} />
      <p className="text-xs text-slate-500">
        A domain entry suppresses every address at that domain, including ones the engine has not discovered yet.
      </p>
    </form>
  )
}

function SuppressionPage() {
  const [includeRemoved, setIncludeRemoved] = useState(false)
  const [searchInput, setSearch] = useState('')
  const search = useDebouncedValue(searchInput)
  const query = new URLSearchParams()
  if (includeRemoved) query.set('includeRemoved', 'true')
  if (search) query.set('search', search)

  const { data, state, reload } = useResource(`/api/admin/lead-crm/suppression?${query.toString()}`)
  const [removingId, setRemovingId] = useState(null)
  const [removalReason, setRemovalReason] = useState('')
  const [feedback, setFeedback] = useState(null)

  const entries = data?.entries ?? []

  async function remove(id) {
    setFeedback(null)
    try {
      await adminApi.delete(`/api/admin/lead-crm/suppression?id=${encodeURIComponent(id)}`, {
        reason: removalReason,
      })
      setRemovingId(null)
      setRemovalReason('')
      setFeedback({ tone: 'ok', message: 'Suppression removed and recorded.' })
      reload()
    } catch (error) {
      setFeedback({ tone: 'error', message: error.message })
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Suppression</h1>
        <p className="mt-1 text-sm text-slate-500">
          A match here stops outreach entirely — at draft generation, at draft export, and at review-queue
          admission.
        </p>
      </div>

      <Panel title="Add an entry">
        <AddForm onAdded={reload} />
      </Panel>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
        <input
          type="search"
          value={searchInput}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search address or domain"
          aria-label="Search suppression list"
          className={`${inputClass} min-w-[220px] flex-1`}
        />
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={includeRemoved} onChange={(event) => setIncludeRemoved(event.target.checked)} />
          Show removed entries
        </label>
      </div>

      <Feedback feedback={feedback} />

      <LoadState state={state} label="the suppression list" onRetry={reload} />
      {state === 'ready' && entries.length === 0 ? <EmptyState title="Nothing suppressed." /> : null}

      {entries.length > 0 ? (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 font-medium">Value</th>
                <th className="px-3 py-2 font-medium">Reason</th>
                <th className="px-3 py-2 font-medium">Source</th>
                <th className="px-3 py-2 font-medium">Added</th>
                <th className="px-3 py-2 font-medium">Related lead</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {entries.map((entry) => (
                <tr key={entry.id} className={entry.removedAt ? 'opacity-50' : ''}>
                  <td className="px-3 py-2">
                    <p className="font-medium text-slate-800">{entry.value}</p>
                    <p className="text-xs text-slate-400">{humanize(entry.scope)}</p>
                  </td>
                  <td className="px-3 py-2">
                    <Badge value={entry.reason} tones={REASON_TONES} />
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500">{humanize(entry.source)}</td>
                  <td className="px-3 py-2 text-xs text-slate-500">
                    {formatDate(entry.createdAt)}
                    {entry.createdBy ? <span className="block text-slate-400">{entry.createdBy}</span> : null}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500">{entry.companyName || '—'}</td>
                  <td className="px-3 py-2 text-right">
                    {entry.removedAt ? (
                      <span className="text-xs text-slate-400" title={entry.removalReason}>
                        Removed {formatDate(entry.removedAt)}
                      </span>
                    ) : removingId === entry.id ? (
                      <div className="flex items-center justify-end gap-2">
                        <input
                          value={removalReason}
                          onChange={(event) => setRemovalReason(event.target.value)}
                          placeholder="Why is this being removed?"
                          aria-label="Reason for removing this entry"
                          className={`${inputClass} w-56`}
                        />
                        <button type="button" className={dangerButtonClass} onClick={() => remove(entry.id)}>
                          Confirm
                        </button>
                        <button type="button" className={buttonClass} onClick={() => setRemovingId(null)}>
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button type="button" className={buttonClass} onClick={() => setRemovingId(entry.id)}>
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  )
}

export default SuppressionPage

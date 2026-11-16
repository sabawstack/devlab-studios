import { useEffect, useState } from 'react'
import { adminApi } from '../lib/adminApi'

function eventSummary(event) {
  if (event.metadata?.summary) return event.metadata.summary
  if (event.metadata?.blockCount != null) return `Saved ${event.entityId || event.entityType} with ${event.metadata.blockCount} blocks.`
  if (event.metadata?.count != null) return `Replaced ${event.entityType} with ${event.metadata.count} records.`
  return `${event.action.replaceAll('_', ' ')} ${event.entityType}${event.entityId ? `: ${event.entityId}` : ''}.`
}

function ChangeDetails({ metadata }) {
  const changes = Array.isArray(metadata?.changedFields) ? metadata.changedFields : []
  if (!changes.length) return null

  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-xs font-semibold text-[var(--ws-link)] hover:underline">View {changes.length} field change{changes.length === 1 ? '' : 's'}</summary>
      <div className="mt-2 max-w-xl overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
        {changes.map((change) => (
          <div key={change.path} className="grid gap-1 border-b border-slate-200 px-3 py-2 text-xs last:border-0 sm:grid-cols-[140px_1fr]">
            <span className="font-semibold text-slate-700">{change.label}</span>
            <span className="min-w-0 text-slate-500"><span className="line-through">{String(change.before ?? 'empty')}</span> <span aria-hidden="true">→</span> <span className="text-slate-800">{String(change.after ?? 'empty')}</span></span>
          </div>
        ))}
      </div>
    </details>
  )
}

function AuditLogPage() {
  const [events, setEvents] = useState([])
  const [status, setStatus] = useState('loading')

  useEffect(() => {
    let ignore = false
    adminApi
      .get('/api/admin/audit-log')
      .then((data) => !ignore && (setEvents(data), setStatus('ready')))
      .catch(() => !ignore && setStatus('error'))
    return () => { ignore = true }
  }, [])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Audit Log</h1>
        <p className="mt-1 text-sm text-slate-500">A readable history of what changed, who changed it, and which public or operational record was affected.</p>
      </div>
      {status === 'loading' ? <p className="text-sm text-slate-500">Loading…</p> : null}
      {status === 'error' ? <p className="text-sm text-rose-600">Could not load the audit log.</p> : null}

      {status === 'ready' ? (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr><th className="px-4 py-3">When</th><th className="px-4 py-3">Actor</th><th className="px-4 py-3">Action</th><th className="px-4 py-3">Entity</th><th className="px-4 py-3">Details</th></tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id} className="border-b border-slate-100 align-top last:border-0">
                  <td className="whitespace-nowrap px-4 py-3 text-slate-500">{new Date(event.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-3">{event.actorEmail || '—'}</td>
                  <td className="px-4 py-3"><span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">{event.action.replaceAll('_', ' ')}</span></td>
                  <td className="px-4 py-3">{event.entityType}{event.entityId ? <span className="text-slate-400"> · {event.entityId}</span> : null}</td>
                  <td className="px-4 py-3 text-slate-600"><p>{eventSummary(event)}</p><ChangeDetails metadata={event.metadata} /></td>
                </tr>
              ))}
              {!events.length ? <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-500">No audit events recorded yet.</td></tr> : null}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  )
}

export default AuditLogPage

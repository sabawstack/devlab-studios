import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { adminApi } from '../lib/adminApi'
import { PRIMARY_PUBLIC_SURFACES } from '../../config/publicSurfaces'
import { useAttention } from '../components/AttentionContext'
import { Button, LoadState, PageHeader, Panel } from '../primitives/index.jsx'

// Content totals (below "Needs attention"): the same endpoints as before; the
// inquiry tile is called Inquiries, as everywhere else in the workspace.
const TOTALS = [
  { key: 'projects', label: 'Projects', to: '/admin/content/projects', path: '/api/admin/projects', count: (data) => data.length },
  { key: 'articles', label: 'Insight articles', to: '/admin/content/resources', path: '/api/admin/content/resources', count: (data) => data.posts?.length ?? 0 },
  { key: 'certifications', label: 'Certifications', to: '/admin/collections/certifications', path: '/api/admin/collections/certifications', count: (data) => data.length },
  { key: 'redirects', label: 'Redirects', to: '/admin/collections/redirects', path: '/api/admin/collections/redirects', count: (data) => data.length },
  { key: 'inquiries', label: 'Inquiries', to: '/admin/leads', path: '/api/admin/leads', count: (data) => data.length },
]

const AREAS = [
  { key: 'inquiries', title: 'Inquiries', description: 'People who contacted DevLab Studios.', to: '/admin/leads' },
  { key: 'leadCrm', title: 'Lead CRM', description: 'Businesses the engine found, and their replies.', to: '/admin/lead-crm' },
  { key: 'mailbox', title: 'Mailbox', description: 'hello@ and the replies waiting to go out.', to: '/admin/mailbox' },
]

function relative(isoString) {
  const seconds = Math.round((Date.now() - new Date(isoString).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`
  if (seconds < 2_592_000) return `${Math.round(seconds / 86_400)}d ago`
  return new Date(isoString).toLocaleDateString()
}

/** One area of "Needs attention", with its own loading and failure state. */
function AttentionCard({ area, entry, onRetry }) {
  const value = entry.value
  return (
    <Panel as="section" aria-labelledby={`attention-${area.key}`} data-testid={`attention-${area.key}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 id={`attention-${area.key}`} className="text-base font-semibold"><Link to={area.to} className="admin-link">{area.title}</Link></h3>
          <p className="text-xs text-[var(--ws-ink-3)]">{area.description}</p>
        </div>
        {value ? <span className="ws-mono text-2xl font-semibold" aria-label={`${value.total} need attention`}>{value.total}</span> : null}
      </div>
      <div className="mt-3">
        {entry.state === 'loading' || entry.state === 'error'
          ? <LoadState state={entry.state} label={area.title.toLowerCase()} onRetry={onRetry} />
          : (
            <ul className="space-y-1.5 text-sm">
              {value.items.map((item) => (
                <li key={item.key} className="flex items-center justify-between gap-3">
                  <Link to={item.to} className={item.count ? 'admin-link' : 'text-[var(--ws-ink-3)]'}>{item.label}</Link>
                  <span className="ws-mono font-semibold">{item.count}{item.capped ? '+' : ''}</span>
                </li>
              ))}
            </ul>
          )}
        {area.key === 'leadCrm' && value && !value.engineOn ? (
          <p className="mt-2 text-xs text-[var(--ws-ink-3)]">The engine is switched off, so nothing new arrives here.</p>
        ) : null}
      </div>
    </Panel>
  )
}

function DashboardPage() {
  const attention = useAttention()
  const [totals, setTotals] = useState({})
  const [events, setEvents] = useState({ state: 'loading', items: [] })

  useEffect(() => {
    let ignore = false
    adminApi.get('/api/admin/audit-log?limit=8')
      .then((data) => !ignore && setEvents({ state: 'ready', items: data }))
      .catch(() => !ignore && setEvents({ state: 'error', items: [] }))
    for (const total of TOTALS) {
      adminApi.get(total.path)
        .then((data) => !ignore && setTotals((current) => ({ ...current, [total.key]: { state: 'ready', count: total.count(data) } })))
        .catch(() => !ignore && setTotals((current) => ({ ...current, [total.key]: { state: 'error' } })))
    }
    return () => {
      ignore = true
    }
  }, [])

  return (
    <div className="space-y-8">
      <PageHeader title="Home" description="What is waiting for a person first, then the website at a glance." />

      {/* ADMIN-04: needs attention first, one card per area, each loading and failing on its own. */}
      <section aria-labelledby="needs-attention" className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 id="needs-attention" className="text-lg font-semibold">Needs attention</h2>
          <Button variant="quiet" onClick={attention.reload}>Refresh</Button>
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          {AREAS.map((area) => <AttentionCard key={area.key} area={area} entry={attention[area.key]} onRetry={attention.reload} />)}
        </div>
      </section>

      <section aria-labelledby="content-totals" className="space-y-3">
        <h2 id="content-totals" className="text-lg font-semibold">Website content</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {TOTALS.map((total) => {
            const entry = totals[total.key]
            return (
              <Link key={total.key} to={total.to} className="rounded-xl border border-[var(--ws-rule)] bg-[var(--ws-surface)] p-4 transition hover:border-[var(--ws-link)]">
                <p className="text-sm font-semibold">{total.label}</p>
                <p className="ws-mono mt-1 text-2xl font-semibold">
                  {!entry ? <span className="text-[var(--ws-ink-3)]" aria-label="Loading">…</span> : entry.state === 'error' ? <span className="text-sm text-[var(--ws-danger)]">Not loaded</span> : entry.count}
                </p>
              </Link>
            )
          })}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Panel title="Recent activity" description="The latest changes in the workspace, from the audit log.">
          {events.state !== 'ready' ? <LoadState state={events.state} label="recent activity" onRetry={() => window.location.reload()} /> : events.items.length ? (
            <ul className="divide-y divide-[var(--ws-rule)]">
              {events.items.map((event) => (
                <li key={event.id} className="flex items-start justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="ws-mono text-[0.7rem] text-[var(--ws-ink-3)]">{event.entityType} · {event.action.replace('_', ' ')}</p>
                    <p className="truncate text-sm font-medium">{event.entityId || event.entityType}</p>
                    {event.metadata?.summary ? <p className="line-clamp-2 text-xs text-[var(--ws-ink-3)]">{event.metadata.summary}</p> : null}
                  </div>
                  <span className="shrink-0 text-xs text-[var(--ws-ink-3)]">{relative(event.createdAt)}</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-[var(--ws-ink-3)]">No activity yet. Changes made in the workspace show up here.</p>}
        </Panel>

        <Panel title="Website pages" description="Same names and order visitors see.">
          <ul className="space-y-1.5 text-sm">
            {PRIMARY_PUBLIC_SURFACES.map((surface) => (
              <li key={surface.key} className="flex justify-between gap-3">
                <Link to={surface.adminPath} className="admin-link">{surface.label}</Link>
                <span className="ws-mono text-xs text-[var(--ws-ink-3)]">{surface.publicPath}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  )
}

export default DashboardPage

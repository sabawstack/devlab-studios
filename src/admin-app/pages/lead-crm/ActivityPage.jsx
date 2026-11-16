import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { adminApi } from '../../lib/adminApi'
import { buttonClass, formatDate, humanize, inputClass } from './format'
import { Badge, EmptyState, Feedback, Panel } from './shared'
import { useResource } from './useResource'
import { LoadState } from '../../primitives/index.jsx'
import { useDebouncedValue } from '../../lib/useDebouncedValue'

/**
 * Activity and background jobs.
 *
 * Two views on one screen, because they answer the same operator question from
 * different ends: "what has this system been doing" and "what did it fail to
 * do". A dead-lettered job is the only thing here that is actionable, so it
 * gets a retry button; the timeline is append-only and read-only.
 */

const JOB_STATUS_TONES = {
  pending: 'bg-slate-100 text-slate-700',
  running: 'bg-sky-100 text-sky-800',
  succeeded: 'bg-emerald-100 text-emerald-800',
  failed: 'bg-amber-100 text-amber-800',
  dead: 'bg-rose-100 text-rose-800',
  cancelled: 'bg-slate-100 text-slate-400',
}

function JobsView() {
  const [status, setStatus] = useState('dead')
  const { data, state, reload } = useResource(`/api/admin/lead-crm/jobs${status ? `?status=${status}` : ''}`)
  const [busy, setBusy] = useState(null)
  const [feedback, setFeedback] = useState(null)

  const jobs = data?.jobs ?? []
  const counts = data?.counts ?? {}

  async function act(key, body, message) {
    setBusy(key)
    setFeedback(null)
    try {
      await adminApi.post('/api/admin/lead-crm/jobs', body)
      setFeedback({ tone: 'ok', message })
      reload()
    } catch (error) {
      setFeedback({ tone: 'error', message: error.message })
    } finally {
      setBusy(null)
    }
  }

  return (
    <Panel
      title="Background jobs"
      description="Work is held in D1, so a Worker that dies mid-job leaves it reclaimable rather than lost."
      actions={
        <>
          <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Job status" className={inputClass}>
            <option value="">All</option>
            <option value="pending">Pending</option>
            <option value="running">Running</option>
            <option value="dead">Dead-lettered</option>
            <option value="succeeded">Succeeded</option>
          </select>
          <button
            type="button"
            disabled={busy !== null}
            className={buttonClass}
            onClick={() => act('drain', { action: 'drain', limit: 10 }, 'Drained a batch.')}
          >
            {busy === 'drain' ? 'Draining…' : 'Run a batch now'}
          </button>
        </>
      }
    >
      <div className="mb-3 flex flex-wrap gap-2 text-xs">
        {Object.entries(counts).map(([key, count]) => (
          <span key={key} className="rounded-full bg-slate-100 px-2.5 py-0.5 font-semibold text-slate-700">
            {humanize(key)}: {count}
          </span>
        ))}
      </div>

      <Feedback feedback={feedback} />

      <LoadState state={state} label="jobs" onRetry={reload} />
      {state === 'ready' && jobs.length === 0 ? <EmptyState title="Nothing here." /> : null}

      <ul className="mt-3 divide-y divide-slate-100">
        {jobs.map((job) => (
          <li key={job.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-slate-800">{humanize(job.jobType)}</span>
                <Badge value={job.status} tones={JOB_STATUS_TONES} />
              </div>
              <p className="text-xs text-slate-500">
                {job.companyName ? `${job.companyName} · ` : ''}
                {job.attempts}/{job.maxAttempts} attempts · {formatDate(job.updatedAt)}
              </p>
              {job.lastError ? <p className="mt-0.5 text-xs text-rose-600">{job.lastError}</p> : null}
            </div>

            {job.status === 'dead' ? (
              <button
                type="button"
                disabled={busy !== null}
                className={buttonClass}
                onClick={() => act(job.id, { action: 'retry', jobId: job.id }, 'Job re-queued.')}
              >
                {busy === job.id ? 'Retrying…' : 'Retry'}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </Panel>
  )
}

function TimelineView() {
  const [eventTypeInput, setEventType] = useState('')
  const eventType = useDebouncedValue(eventTypeInput)
  const { data, state } = useResource(`/api/admin/lead-crm/activity${eventType ? `?eventType=${eventType}` : ''}`)
  const events = data?.events ?? []

  return (
    <Panel
      title="Activity"
      description="Append-only. Nothing in this system updates or deletes a timeline entry."
      actions={
        <input
          value={eventTypeInput}
          onChange={(event) => setEventType(event.target.value.toUpperCase())}
          placeholder="Filter by event type"
          aria-label="Filter by event type"
          className={inputClass}
        />
      }
    >
      <LoadState state={state} label="activity" />
      {state === 'ready' && events.length === 0 ? <EmptyState title="No activity recorded." /> : null}

      <ul className="space-y-1.5">
        {events.map((event) => (
          <li key={event.id} className="flex flex-wrap gap-3 text-xs">
            <span className="w-36 shrink-0 text-slate-400">{formatDate(event.createdAt)}</span>
            <span className="w-48 shrink-0 font-medium text-slate-600">{event.label}</span>
            <span className="min-w-0 flex-1 text-slate-500">
              {event.companyName ? <span className="font-medium text-slate-700">{event.companyName}: </span> : null}
              {event.summary}
            </span>
            {event.actorEmail ? <span className="shrink-0 text-slate-400">{event.actorEmail}</span> : null}
          </li>
        ))}
      </ul>
    </Panel>
  )
}

function ActivityPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const view = searchParams.get('view') === 'jobs' ? 'jobs' : 'timeline'

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-slate-900">Activity</h1>
        <div className="flex gap-2">
          {[
            ['timeline', 'Timeline'],
            ['jobs', 'Jobs'],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setSearchParams(key === 'jobs' ? { view: 'jobs' } : {})}
              aria-pressed={view === key}
              className={
                view === key
                  ? 'rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white'
                  : buttonClass
              }
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {view === 'jobs' ? <JobsView /> : <TimelineView />}
    </div>
  )
}

export default ActivityPage

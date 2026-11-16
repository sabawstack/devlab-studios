import { useCallback, useEffect, useState } from 'react'
import { adminApi } from '../lib/adminApi'
import { confirmAction } from '../primitives/confirm'

/**
 * Daily Digests.
 *
 * Unlike every other page in this admin, nothing here is authored: the run
 * generates it and the retention sweep removes it. So the controls are the two
 * an operator actually needs over generated content — take a day down, or take
 * it out — plus a way to run the job without waiting for tomorrow's cron.
 */

function formatDate(value) {
  const parsed = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })
}

function StatusBadge({ status }) {
  const isPublished = status === 'published'
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${isPublished ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
      {isPublished ? 'Published' : 'Unpublished'}
    </span>
  )
}

function DigestCard({ digest, onToggle, onDelete, busy }) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">{formatDate(digest.digestDate)}</h2>
          <p className="mt-1 text-xs text-slate-500">
            {digest.itemCount} {digest.itemCount === 1 ? 'item' : 'items'}
            {/*
              The old wording here said "AI unavailable", which was wrong and
              cost real debugging time: the model had answered fine and the
              reply was being discarded. All this row can honestly report is
              that no summary was stored — `wrangler tail` has the reason.
            */}
            {digest.model ? ` · summarized by ${digest.model}` : ' · published as titles and links (no summaries stored)'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={digest.status} />
          <button
            type="button"
            onClick={() => onToggle(digest)}
            disabled={busy}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-violet-400 hover:text-violet-700 disabled:opacity-50"
          >
            {digest.status === 'published' ? 'Unpublish' : 'Publish'}
          </button>
          <button
            type="button"
            onClick={() => onDelete(digest)}
            disabled={busy}
            className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-50 disabled:opacity-50"
          >
            Delete
          </button>
        </div>
      </header>

      <ol className="divide-y divide-slate-100">
        {digest.items.map((item) => (
          <li key={item.id} className="px-4 py-3">
            <a
              href={item.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-semibold text-slate-900 hover:text-violet-700 hover:underline"
            >
              {item.title}
            </a>
            {item.summary ? <p className="mt-1 text-xs leading-relaxed text-slate-600">{item.summary}</p> : null}
            <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{item.sourceName}</p>
          </li>
        ))}
        {digest.items.length === 0 ? <li className="px-4 py-4 text-sm text-slate-500">This day has no items.</li> : null}
      </ol>
    </article>
  )
}

function DigestsPage() {
  const [digests, setDigests] = useState([])
  const [status, setStatus] = useState('loading')
  const [message, setMessage] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const data = await adminApi.get('/api/admin/digests')
      setDigests(data.digests || [])
      setStatus('ready')
    } catch {
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function handleGenerate() {
    setBusy(true)
    setMessage(null)
    try {
      const result = await adminApi.post('/api/admin/digests', {})
      setMessage({
        tone: 'ok',
        text: result.published
          ? `Generated the ${result.digestDate} digest with ${result.itemCount} items.`
          : `No new items were found for ${result.digestDate}. The previous edition is unchanged.`,
      })
      await load()
    } catch (error) {
      setMessage({ tone: 'error', text: error.message })
    } finally {
      setBusy(false)
    }
  }

  async function handleToggle(digest) {
    setBusy(true)
    setMessage(null)
    try {
      await adminApi.patch(`/api/admin/digests/${digest.id}`, {
        status: digest.status === 'published' ? 'draft' : 'published',
      })
      await load()
    } catch (error) {
      setMessage({ tone: 'error', text: error.message })
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(digest) {
    if (!(await confirmAction({ title: `Delete the ${digest.digestDate} digest?`, body: `Its ${digest.itemCount} items go with it. This cannot be undone.`, confirmLabel: 'Delete digest', danger: true }))) return

    setBusy(true)
    setMessage(null)
    try {
      await adminApi.delete(`/api/admin/digests/${digest.id}`)
      setMessage({ tone: 'ok', text: `Deleted the ${digest.digestDate} digest.` })
      await load()
    } catch (error) {
      setMessage({ tone: 'error', text: error.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Daily Digests</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            The AI &amp; Automation Daily log on <a href="/insights/daily" className="font-semibold text-violet-700 hover:underline">/insights/daily</a>.
            Generated once a day from a fixed list of feeds and kept for seven days, after which each edition is removed automatically.
          </p>
        </div>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={busy}
          className="rounded-lg bg-violet-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-800 disabled:opacity-50"
        >
          {busy ? 'Working…' : 'Generate now'}
        </button>
      </div>

      {message ? (
        <p
          role="status"
          className={`rounded-lg border px-4 py-3 text-sm ${message.tone === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}
        >
          {message.text}
        </p>
      ) : null}

      {status === 'loading' ? <p className="text-sm text-slate-500">Loading…</p> : null}
      {status === 'error' ? <p className="text-sm text-rose-600">Could not load the digests.</p> : null}

      {status === 'ready' && digests.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm text-slate-500">
          No digest has been generated yet. Use &ldquo;Generate now&rdquo; to run it immediately, or wait for the daily schedule.
        </p>
      ) : null}

      <div className="space-y-4">
        {digests.map((digest) => (
          <DigestCard key={digest.id} digest={digest} onToggle={handleToggle} onDelete={handleDelete} busy={busy} />
        ))}
      </div>
    </div>
  )
}

export default DigestsPage

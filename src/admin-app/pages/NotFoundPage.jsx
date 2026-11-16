import { Link, useRouteError } from 'react-router-dom'
import { PageHeader } from '../primitives/index.jsx'

/** ADMIN-02: an Admin address that does not exist. */
export function NotFoundPage() {
  return (
    <div className="space-y-4">
      <PageHeader title="Page not found" description="There is no Admin page at this address. Nothing was changed." />
      <Link to="/admin" className="admin-link">Back to Home</Link>
    </div>
  )
}

/** ADMIN-02: a screen threw while rendering; the rest of the workspace still works. */
export function RouteError() {
  const error = useRouteError()
  const message = error instanceof Error ? error.message : typeof error?.statusText === 'string' ? error.statusText : null
  return (
    <div className="admin-canvas min-h-screen p-8">
      <div role="alert" className="mx-auto max-w-xl space-y-3 rounded-xl border border-[var(--ws-rule)] bg-[var(--ws-surface)] p-6">
        <h1 className="text-xl font-semibold">This screen hit a problem</h1>
        <p className="text-sm text-[var(--ws-ink-2)]">Nothing you saved before is affected. Reload the page or go back to Home and try again.</p>
        {message ? <p className="ws-mono break-words text-xs text-[var(--ws-ink-3)]">{message}</p> : null}
        <div className="flex gap-3">
          <button type="button" className="admin-link" onClick={() => window.location.reload()}>Reload</button>
          <a href="/admin" className="admin-link">Back to Home</a>
        </div>
      </div>
    </div>
  )
}

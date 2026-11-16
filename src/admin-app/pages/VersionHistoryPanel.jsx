import { useEffect, useState } from 'react'
import { adminApi } from '../lib/adminApi'
import { confirmAction } from '../primitives/confirm'

function VersionHistoryPanel({ contentType, contentId = null, onRestored }) {
  const [versions, setVersions] = useState([])
  const [status, setStatus] = useState('loading')
  const [restoringVersion, setRestoringVersion] = useState(null)
  const [restoreError, setRestoreError] = useState(null)

  useEffect(() => {
    let ignore = false
    const query = contentId ? `?id=${encodeURIComponent(contentId)}` : ''
    adminApi
      .get(`/api/admin/versions/${contentType}${query}`)
      .then((data) => {
        if (!ignore) {
          setVersions(data)
          setStatus('ready')
        }
      })
      .catch(() => !ignore && setStatus('error'))
    return () => {
      ignore = true
    }
  }, [contentType, contentId])

  async function handleRestore(versionNumber) {
    if (!(await confirmAction({ title: `Restore version ${versionNumber}?`, body: 'This creates a new version on top of the current one. Nothing is deleted.', confirmLabel: 'Restore' }))) return

    setRestoreError(null)
    setRestoringVersion(versionNumber)
    try {
      const restored = await adminApi.post(`/api/admin/versions/${contentType}/rollback`, { contentId, versionNumber })
      onRestored?.(restored)
    } catch (error) {
      setRestoreError(error.message || 'Restore failed. Please try again.')
    } finally {
      setRestoringVersion(null)
    }
  }

  if (status === 'loading') return <p className="text-sm text-slate-500">Loading version history…</p>
  if (status === 'error') return <p className="text-sm text-rose-600">Could not load version history.</p>
  if (!versions.length) return <p className="text-sm text-slate-500">No saved versions yet.</p>

  return (
    <div className="space-y-2">
      {restoreError ? <p className="text-sm text-rose-600">{restoreError}</p> : null}
      <ul className="space-y-2">
        {versions.map((version) => (
          <li key={version.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
            <div>
              <span className="font-semibold text-slate-700">v{version.versionNumber}</span>
              <span className="ml-2 text-slate-500">{new Date(version.createdAt).toLocaleString()}</span>
              <span className="ml-2 rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-600">{version.status}</span>
            </div>
            <button
              type="button"
              onClick={() => handleRestore(version.versionNumber)}
              disabled={restoringVersion !== null}
              className="text-xs font-semibold text-[var(--ws-link)] hover:underline disabled:cursor-not-allowed disabled:opacity-50"
            >
              {restoringVersion === version.versionNumber ? 'Restoring…' : 'Restore'}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default VersionHistoryPanel

import { useState } from 'react'
import { adminApi } from '../lib/adminApi'

/**
 * Opens a one-hour, single-item draft preview of a page or article on the
 * public site (audit CMS-04). Save first: the preview shows what is stored.
 */
function PreviewDraftButton({ type, id, className = '' }) {
  const [error, setError] = useState(null)

  async function openPreview() {
    setError(null)
    // Open the tab synchronously so a pop-up blocker does not swallow it.
    const tab = window.open('about:blank', '_blank')
    try {
      const { url } = await adminApi.get(`/api/admin/preview-token?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`)
      if (tab) tab.location.href = url
      else window.location.href = url
    } catch (caught) {
      tab?.close()
      setError(caught.message || 'Could not create a preview link.')
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={openPreview}
        disabled={!id}
        title="Shows the saved draft on the public page for one hour. Save first."
        className={`rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 ${className}`}
      >
        Preview draft
      </button>
      {error ? <span role="alert" className="text-sm text-rose-600">{error}</span> : null}
    </>
  )
}

export default PreviewDraftButton

import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { X } from '../../components/icons/icons'

function describeReference(reference) {
  if (reference.type === 'Project') {
    return reference.isThumbnail
      ? `This image is the active thumbnail for project "${reference.label}". Update the thumbnail before deleting this image.`
      : `This image is used in the gallery for project "${reference.label}".`
  }
  return `Used by ${reference.type}: ${reference.label}`
}

export default function MediaDeleteConflictDialog({ references, onClose }) {
  const navigate = useNavigate()

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = 'unset'
    }
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="media-delete-conflict-heading"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <h2 id="media-delete-conflict-heading" className="text-base font-semibold text-slate-900">This image is still in use</h2>
          <button type="button" onClick={onClose} aria-label="Close"><X className="h-4 w-4 text-slate-400 hover:text-slate-700" /></button>
        </div>
        <ul className="mt-4 space-y-3">
          {references.map((reference, index) => (
            <li key={`${reference.type}-${reference.id}-${index}`} className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
              <p>{describeReference(reference)}</p>
              {reference.type === 'Project' ? (
                <button
                  type="button"
                  onClick={() => navigate(`/admin/content/projects?projectId=${encodeURIComponent(reference.id)}`)}
                  className="mt-2 text-sm font-semibold text-[var(--ws-link)] hover:underline"
                >
                  Go to project
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

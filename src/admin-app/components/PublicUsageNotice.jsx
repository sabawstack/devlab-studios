import { ExternalLink } from '../../components/icons/icons'
import { getContentUsage } from '../../config/publicSurfaces'

export default function PublicUsageNotice({ contentType, label, publicPath, description }) {
  const usage = getContentUsage(contentType)
  const paths = publicPath ? [publicPath] : usage?.publicPaths || []
  const resolvedLabel = label || usage?.label || 'Content'
  const resolvedDescription = description || usage?.description || 'Changes are reflected on the public website after saving.'

  return (
    <aside className="rounded-xl border border-[var(--ws-rule)] bg-[var(--ws-selected)] px-4 py-3 text-sm text-slate-700">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-semibold text-slate-900">Public use: {resolvedLabel}</p>
          <p className="mt-1 leading-5 text-slate-600">{resolvedDescription}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {paths.map((path) => path.startsWith('/') ? (
            <a key={path} href={path} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full border border-[var(--ws-rule)] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--ws-link)] hover:border-[var(--ws-link)]">
              {path}
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
          ) : <span key={path} className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-slate-600">{path}</span>)}
        </div>
      </div>
    </aside>
  )
}

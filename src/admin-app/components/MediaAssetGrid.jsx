import { ExternalLink, FolderOpen, RotateCw, Trash2 } from '../../components/icons/icons'
import { formatBytes } from '../lib/formatBytes'

function usedByLabel(usedBy) {
  if (!usedBy?.length) return null
  return usedBy.map((reference) => reference.label).join(', ')
}

export default function MediaAssetGrid({ assets, busyKey, onReplace, onRemove }) {
  if (!assets.length) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
        <FolderOpen className="mx-auto h-8 w-8 text-slate-400" />
        <h2 className="mt-3 font-semibold text-slate-800">No image objects found</h2>
        <p className="mt-2 text-sm text-slate-500">Upload a JPG, PNG, WebP, or AVIF. The CMS will resize it when needed and store an optimized WebP.</p>
      </div>
    )
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {assets.map((asset) => (
        <article key={asset.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <img src={asset.url} alt={asset.altText || asset.filename} className="h-40 w-full bg-slate-50 object-cover" loading="lazy" />
          <div className="space-y-2 p-3">
            <div className="flex items-start justify-between gap-2"><p className="min-w-0 truncate text-sm font-semibold text-slate-800">{asset.filename}</p><a href={asset.url} target="_blank" rel="noreferrer" aria-label={`Open ${asset.filename}`}><ExternalLink className="h-4 w-4 text-slate-400 hover:text-[var(--ws-link)]" /></a></div>
            <p className="truncate font-mono text-[11px] text-slate-500" title={asset.key}>{asset.key}</p>
            <div className="flex items-center justify-between gap-2 text-xs text-slate-500"><span>{formatBytes(asset.size)}</span><span className={asset.trackedInD1 ? 'text-emerald-600' : 'text-slate-400'}>{asset.trackedInD1 ? 'D1 linked' : 'R2 only'}</span></div>
            {usedByLabel(asset.usedBy) ? (
              <p className="truncate text-xs text-[var(--ws-link)]" title={usedByLabel(asset.usedBy)}>Used by: {usedByLabel(asset.usedBy)}</p>
            ) : null}
            <div className="grid grid-cols-2 gap-2 pt-1">
              <label className="inline-flex cursor-pointer items-center justify-center gap-1 rounded-lg border border-slate-200 px-2 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"><RotateCw className="h-3.5 w-3.5" />{busyKey === asset.key ? 'Working…' : 'Replace'}<input type="file" accept="image/png,image/jpeg,image/webp,image/avif" className="sr-only" disabled={Boolean(busyKey)} onChange={(event) => { onReplace(asset, event.target.files?.[0]); event.target.value = '' }} /></label>
              <button type="button" disabled={Boolean(busyKey)} onClick={() => onRemove(asset)} className="inline-flex items-center justify-center gap-1 rounded-lg border border-rose-200 px-2 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" />Delete</button>
            </div>
          </div>
        </article>
      ))}
    </div>
  )
}

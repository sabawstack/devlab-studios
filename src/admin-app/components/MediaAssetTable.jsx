import { ExternalLink, FolderOpen, RotateCw, Trash2 } from '../../components/icons/icons'
import { formatBytes } from '../lib/formatBytes'

function usedByLabel(usedBy) {
  if (!usedBy?.length) return '—'
  return usedBy.map((reference) => reference.label).join(', ')
}

export default function MediaAssetTable({ assets, busyKey, onReplace, onRemove }) {
  if (!assets.length) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
        <FolderOpen className="mx-auto h-8 w-8 text-slate-400" />
        <h2 className="mt-3 font-semibold text-slate-800">No image objects found</h2>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-3 py-2">Thumbnail</th>
            <th className="px-3 py-2">Filename</th>
            <th className="px-3 py-2">Key</th>
            <th className="px-3 py-2">Size</th>
            <th className="px-3 py-2">Folder</th>
            <th className="px-3 py-2">D1</th>
            <th className="px-3 py-2">Used by</th>
            <th className="px-3 py-2">Uploaded</th>
            <th className="px-3 py-2">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {assets.map((asset) => (
            <tr key={asset.id}>
              <td className="px-3 py-2"><img src={asset.url} alt={asset.altText || asset.filename} className="h-10 w-14 rounded object-cover" loading="lazy" /></td>
              <td className="max-w-[220px] truncate px-3 py-2 font-semibold text-slate-800" title={asset.filename}>
                {asset.filename}
                <a href={asset.url} target="_blank" rel="noreferrer" aria-label={`Open ${asset.filename}`} className="ml-1 inline-block align-middle"><ExternalLink className="h-3.5 w-3.5 text-slate-400 hover:text-[var(--ws-link)]" /></a>
              </td>
              <td className="max-w-[200px] truncate px-3 py-2 font-mono text-[11px] text-slate-500" title={asset.key}>{asset.key}</td>
              <td className="whitespace-nowrap px-3 py-2 text-slate-600">{formatBytes(asset.size)}</td>
              <td className="whitespace-nowrap px-3 py-2 text-slate-600">{asset.folder}</td>
              <td className="whitespace-nowrap px-3 py-2"><span className={asset.trackedInD1 ? 'text-emerald-600' : 'text-slate-400'}>{asset.trackedInD1 ? 'Linked' : 'R2 only'}</span></td>
              <td className="max-w-[220px] truncate px-3 py-2 text-[var(--ws-link)]" title={usedByLabel(asset.usedBy)}>{usedByLabel(asset.usedBy)}</td>
              <td className="whitespace-nowrap px-3 py-2 text-slate-500">{new Date(asset.uploadedAt).toLocaleDateString()}</td>
              <td className="whitespace-nowrap px-3 py-2">
                <div className="flex items-center gap-2">
                  <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"><RotateCw className="h-3 w-3" />{busyKey === asset.key ? '…' : 'Replace'}<input type="file" accept="image/png,image/jpeg,image/webp,image/avif" className="sr-only" disabled={Boolean(busyKey)} onChange={(event) => { onReplace(asset, event.target.files?.[0]); event.target.value = '' }} /></label>
                  <button type="button" disabled={Boolean(busyKey)} onClick={() => onRemove(asset)} className="inline-flex items-center gap-1 rounded-md border border-rose-200 px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"><Trash2 className="h-3 w-3" />Delete</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

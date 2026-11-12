import { useMemo } from 'react'
import { parseLiteMarkdown } from '../../lib/content/liteMarkdown'

/**
 * Rendered preview of the CMS body format (audit CMS-04), using the same
 * parser as the public pages, so what the editor sees is what ships. Text
 * only: the format has no HTML, so nothing here can inject markup.
 */
function MarkdownPreview({ value }) {
  const blocks = useMemo(() => parseLiteMarkdown(value || ''), [value])
  if (!blocks.length) return <p className="text-xs text-slate-400">The preview appears as you type.</p>
  return (
    <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800" aria-label="Rendered preview">
      {blocks.map((block, index) => {
        if (block.type === 'heading') return <h3 key={index} className="text-base font-semibold text-slate-900">{block.text}</h3>
        if (block.type === 'list') return <ul key={index} className="list-disc space-y-1 pl-5">{block.items.map((item, i) => <li key={i}>{item}</li>)}</ul>
        return <p key={index}>{block.text}</p>
      })}
    </div>
  )
}

export default MarkdownPreview

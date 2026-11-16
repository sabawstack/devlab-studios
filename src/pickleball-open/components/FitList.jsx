import { useEffect, useRef, useState } from 'react'

/**
 * A list that shows only as many whole rows as fit its box: rows that would be
 * cut off stay laid out but invisible, so a half-clipped row never shows and the
 * next resize can bring them back. With `more`, a line says how many rows are
 * not shown. Used by the TV board's side panel.
 */
export default function FitList({ rows, as: Tag = 'ol', className = '', rowClassName = '', more = null }) {
  const outer = useRef(null)
  const inner = useRef(null)
  const [limit, setLimit] = useState(Number.POSITIVE_INFINITY)
  useEffect(() => {
    const measure = () => {
      if (!outer.current || !inner.current) return
      const room = outer.current.clientHeight
      let fit = 0
      for (const row of inner.current.children) {
        if (row.offsetTop + row.offsetHeight > room + 0.5) break
        fit += 1
      }
      setLimit(fit)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(outer.current)
    observer.observe(inner.current)
    return () => observer.disconnect()
  }, [])
  const hidden = Math.max(0, rows.length - limit)
  return (
    <>
      <div ref={outer} className="min-h-0 flex-1 overflow-hidden">
        <Tag ref={inner} className={`relative ${className}`}>
          {rows.map((row, i) => (
            <li key={row.key} className={`${rowClassName} ${i >= limit ? 'invisible' : ''}`}>{row.content}</li>
          ))}
        </Tag>
      </div>
      {/* Rows that do not fit are never silently dropped: the screen says how many more there are. */}
      {more && hidden > 0 && <p className="shrink-0" data-testid="fit-more">{more(hidden)}</p>}
    </>
  )
}

import { useEffect, useRef, useState } from 'react'

/**
 * A list that shows only as many whole rows as fit its box: rows that would be
 * cut off stay laid out but invisible, so a half-clipped row never shows and the
 * next resize can bring them back. Used by the TV board's side panel.
 */
export default function FitList({ rows, as: Tag = 'ol', className = '', rowClassName = '' }) {
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
  return (
    <div ref={outer} className="min-h-0 flex-1 overflow-hidden">
      <Tag ref={inner} className={`relative ${className}`}>
        {rows.map((row, i) => (
          <li key={row.key} className={`${rowClassName} ${i >= limit ? 'invisible' : ''}`}>{row.content}</li>
        ))}
      </Tag>
    </div>
  )
}

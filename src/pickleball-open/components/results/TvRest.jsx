// src/pickleball-open/components/results/TvRest.jsx
// The TV's list below the podium: columns grow with the field, and only whole
// rows that fit are shown (never a clipped one). Anything left over is counted
// and sent to the phone board's full list through the QR beside it.
import { useEffect, useRef, useState } from 'react'
import { tvRestColumns, winLoss } from '../../../lib/pickleball/open/results'

const pct = (value) => (value === null ? '–' : `${Math.round(value * 100)}%`)
const WRAP = '[overflow-wrap:anywhere]'

/** The rows of `list` that end within `room` px of its top, counted from the first. */
function rowsWithin(list, room) {
  let fit = 0
  for (const row of list.children) {
    if (row.offsetTop + row.offsetHeight > room + 0.5) break
    fit += 1
  }
  return fit
}

function FittedRest({ rest, didntPlay }) {
  const outer = useRef(null)
  const inner = useRef(null)
  const note = useRef(null)
  const [limit, setLimit] = useState(Number.POSITIVE_INFINITY)
  // Measured from scratch every time: every row stays laid out (the hidden ones are only
  // invisible), and the "+N more" note gives its room back to the list while measuring, so
  // a list that once overflowed grows back as soon as it fits again.
  useEffect(() => {
    let frame = 0
    let cancelled = false
    const measure = () => {
      const box = outer.current
      const list = inner.current
      const more = note.current
      if (!box || !list || !more) return
      const gap = parseFloat(getComputedStyle(box.parentElement).rowGap) || 0
      const noteRoom = more.offsetHeight + gap
      // The list's share of the card, with the note's room added back when it is showing.
      const room = box.clientHeight + (more.dataset.shown === 'true' ? noteRoom : 0)
      setLimit(list.offsetHeight <= room + 0.5 ? Number.POSITIVE_INFINITY : rowsWithin(list, room - noteRoom))
    }
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    }
    const observer = new ResizeObserver(schedule)
    observer.observe(outer.current)
    observer.observe(inner.current)
    schedule()
    // The site fonts change every row's height once they arrive.
    document.fonts?.ready.then(() => { if (!cancelled) schedule() })
    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [rest, didntPlay])

  const items = [
    ...rest.map((entry) => ({
      key: entry.id,
      span: false,
      content: (
        // The record wraps under the name in a narrow column instead of squeezing it.
        <span className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span className={`min-w-[8ch] ${WRAP}`}><b className="text-pickle-neon tabular-nums">{entry.place}</b> {entry.name}</span>
          <span className="whitespace-nowrap tabular-nums text-mist">{winLoss(entry)} · {pct(entry.winRate)}</span>
        </span>
      ),
    })),
    ...(didntPlay.length ? [{ key: 'didnt-play', span: true, content: <span className={`text-mist ${WRAP}`}>Didn't play: {didntPlay.join(', ')}</span> }] : []),
  ]
  const shown = Number.isFinite(limit) ? limit : items.length
  const hiddenRanked = Math.max(0, rest.length - shown)
  const overflowing = shown < items.length
  const columns = tvRestColumns(rest.length)

  return (
    <>
      {/* Its natural height when there is room (the whole results block then sits centred), shrinking when there is not. */}
      <div ref={outer} className="min-h-0 shrink overflow-hidden">
        <ol ref={inner} data-testid="tv-results-rest" className="relative mx-auto grid gap-x-[2vw] gap-y-[0.6vh] text-[clamp(1.1rem,1.45vw,2.1rem)] leading-snug"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, maxWidth: `${columns * 30}vw` }}>
          {items.map((item, i) => (
            <li key={item.key} className={`${item.span ? 'col-span-full' : ''} ${i >= shown ? 'invisible' : ''}`}>{item.content}</li>
          ))}
        </ol>
      </div>
      {/* Always rendered so its height can be measured; it takes room only when rows are hidden. */}
      <p ref={note} data-shown={overflowing} aria-hidden={!overflowing}
        className={`text-center text-[clamp(1.05rem,1.3vw,1.9rem)] font-semibold text-pickle-neon ${overflowing ? 'shrink-0' : 'pointer-events-none invisible absolute inset-x-0'}`}
        {...(overflowing ? { 'data-testid': 'tv-results-more' } : {})}>
        {hiddenRanked > 0 ? `+${hiddenRanked} more: scan the QR for the full list` : 'Scan the QR for the full list'}
      </p>
    </>
  )
}

/** Nothing below the podium (a small knockout): nothing to lay out or measure. */
export default function TvRest({ rest, didntPlay }) {
  if (rest.length === 0 && didntPlay.length === 0) return null
  return <FittedRest rest={rest} didntPlay={didntPlay} />
}

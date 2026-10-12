// src/pickleball-open/components/TvMarquee.jsx
// The TV's welcome-message line (spec 2026-10-13 §A). One static line when it
// fits; otherwise it scrolls slowly as a CSS marquee (transform only). For
// people who ask for less motion it never scrolls: it wraps instead, so no
// text is ever cut off.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'

const REDUCED = '(prefers-reduced-motion: reduce)'
// Scroll speed: about 6 characters a second, so a 140-character line takes ~25 s a lap.
const SECONDS_PER_CHAR = 0.17
const MIN_SECONDS = 12

function subscribeReduced(callback) {
  const query = window.matchMedia(REDUCED)
  query.addEventListener('change', callback)
  return () => query.removeEventListener('change', callback)
}
const prefersReduced = () => window.matchMedia(REDUCED).matches

export default function TvMarquee({ text, className = '' }) {
  const reduced = useSyncExternalStore(subscribeReduced, prefersReduced, () => true)
  const outer = useRef(null)
  const measure = useRef(null)
  const [overflows, setOverflows] = useState(false)

  useEffect(() => {
    if (reduced || !outer.current || !measure.current) return undefined
    const check = () => {
      if (outer.current && measure.current) setOverflows(measure.current.offsetWidth > outer.current.clientWidth + 1)
    }
    const observer = new ResizeObserver(check)
    observer.observe(outer.current)
    observer.observe(measure.current)
    return () => observer.disconnect()
  }, [reduced])

  if (reduced) {
    return <p className={`[overflow-wrap:anywhere] ${className}`} data-testid="tv-announcement">{text}</p>
  }
  const scrolling = overflows
  const style = { '--pb-marquee-s': `${Math.max(MIN_SECONDS, text.length * SECONDS_PER_CHAR)}s` }
  return (
    <div ref={outer} className={`overflow-hidden ${className}`} data-testid="tv-announcement" data-marquee={scrolling ? 'scrolling' : 'static'} aria-label={text} role="marquee">
      <div className={scrolling ? 'pb-marquee flex w-max' : ''} style={scrolling ? style : undefined} aria-hidden="true">
        <span className={`whitespace-nowrap ${scrolling ? 'pr-[3em]' : ''}`}><span ref={measure} className="inline-block">{text}</span></span>
        {scrolling && <span className="whitespace-nowrap pr-[3em]">{text}</span>}
      </div>
    </div>
  )
}

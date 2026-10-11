import { useEffect, useRef, useState } from 'react'

const STATE_LABEL = { PLAYING: 'Playing', UP_NEXT: 'Walk on now', WAITING_FOR_PLAYERS: 'Waiting for players' }
const MAX_PX = 110
const HARD_MIN_PX = 10
const WIDE = '(min-width: 1024px)'

/** The largest type (px) at which the card's content fits its box; null when the card is not boxed (phones). */
function fitFont(card, content) {
  if (!window.matchMedia(WIDE).matches) {
    card.style.fontSize = ''
    return null
  }
  const style = getComputedStyle(card)
  const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)
  let size = Math.min(MAX_PX, card.clientHeight / 6.5, card.clientWidth / 5)
  while (size > HARD_MIN_PX) {
    card.style.fontSize = `${size}px`
    if (content.offsetHeight + padding <= card.clientHeight && content.scrollWidth <= content.clientWidth + 1) break
    size *= 0.97
  }
  // Left on the element: it is exactly what React renders for this size, so a re-render changes nothing.
  const fitted = Math.round(Math.max(size, HARD_MIN_PX) * 10) / 10
  card.style.fontSize = `${fitted}px`
  return fitted
}

function Team({ players, color }) {
  return (
    <div className={`border-l-[0.22em] pl-[0.45em] ${color}`}>
      {players.map((name, i) => <p key={`${i}-${name}`} className="[overflow-wrap:anywhere]">{name}</p>)}
    </div>
  )
}

/** One court on the TV: one player per line, type as large as the card allows (a very long name can push it small, but nothing is cut off). */
export default function TvCourt({ court }) {
  const card = useRef(null)
  const content = useRef(null)
  const [size, setSize] = useState(null)
  const signature = `${court.label}|${court.state}|${court.teamA.join('/')}|${court.teamB.join('/')}`
  useEffect(() => {
    let frame = 0
    const refit = () => {
      cancelAnimationFrame(frame)
      // Deferred a frame: resizing inside the observer callback would re-trigger it in the same frame.
      frame = requestAnimationFrame(() => setSize(fitFont(card.current, content.current)))
    }
    const observer = new ResizeObserver(refit)
    observer.observe(card.current)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [signature])
  const live = court.state === 'PLAYING'
  return (
    <article
      ref={card}
      style={size ? { fontSize: `${size}px` } : undefined}
      className={`flex min-h-0 flex-col justify-center overflow-hidden rounded-[0.8em] p-[0.5em] text-xl leading-[1.2] lg:text-[1.2vw] ${court.state === 'UP_NEXT' ? 'border-4 border-pickle-neon bg-ink' : 'bg-navy-900'}`}
      data-testid="tv-court"
    >
      <div ref={content} className="shrink-0">
        <div className="flex flex-wrap items-baseline justify-between gap-x-[0.5em]">
          <h2 className="text-[1.1em] font-bold text-pickle-neon">{court.label}</h2>
          <span className={`text-[0.55em] font-bold uppercase tracking-[0.08em] ${live ? 'text-mist' : 'text-pickle-neon'}`}>{STATE_LABEL[court.state]}</span>
        </div>
        {court.teamA.length > 0 && (
          <div className="mt-[0.25em] font-semibold">
            <Team players={court.teamA} color="border-pickle-neon" />
            <hr className="my-[0.25em] border-navy-700" />
            <Team players={court.teamB} color="border-pickle-teamb" />
          </div>
        )}
      </div>
    </article>
  )
}

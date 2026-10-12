// src/pickleball-open/components/results/ResultsScreen.jsx
// The final results (spec brief §B): one screen for the player board, the host
// console and the TV once a session ends (or a tournament plays its last game).
// Built only from the allowlisted viewer snapshot.
import { useEffect, useMemo, useRef, useState } from 'react'
import { finalResults, nextTvPodiumFit, summaryText } from '../../../lib/pickleball/open/results'
import Podium from './Podium.jsx'
import RestList from './RestList.jsx'
import ShareResultsButton from './ShareResultsButton.jsx'
import TvRest from './TvRest.jsx'

const untilDate = (iso) => new Date(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })

function Heading({ name, tv }) {
  return (
    <header className="pb-fade-in grid gap-1 text-center" style={{ '--pb-delay': '0ms' }}>
      <p className={`font-bold text-pickle-neon ${tv ? 'text-[clamp(1.5rem,2.4vw,3.5rem)] leading-tight' : 'text-xl sm:text-2xl'}`}>Thanks for playing, everyone! 🏆</p>
      <h2 className={`font-bold [overflow-wrap:anywhere] ${tv ? 'text-[clamp(1.25rem,1.9vw,2.75rem)] leading-tight' : 'text-lg sm:text-xl'}`}>{name}</h2>
      <p className={`font-bold uppercase tracking-[0.14em] text-mist ${tv ? 'text-[clamp(0.95rem,1.15vw,1.6rem)]' : 'text-xs'}`}>Final standings</p>
    </header>
  )
}

/** The TV podium, shrunk in small steps while a big tie would overflow its share of the screen. */
function TvPodium({ podium, limited }) {
  const box = useRef(null)
  const [fit, setFit] = useState({ scale: 1, capped: true })
  useEffect(() => {
    const el = box.current
    const observer = new ResizeObserver(() => {
      // The podium sits at the bottom of its box, so it would overflow at the top, where
      // scrollHeight does not see it: compare the podium's own height instead.
      const overflowing = (el.firstElementChild?.offsetHeight ?? 0) > el.clientHeight + 1
      setFit((scale) => nextTvPodiumFit(scale, overflowing))
    })
    observer.observe(el)
    if (el.firstElementChild) observer.observe(el.firstElementChild)
    return () => observer.disconnect()
  }, [])
  return (
    // Over a list: at most 45% of the height (until a big tie needs more). Alone: whatever is left, shrinking to fit.
    <div ref={box} className={`flex min-h-0 flex-col justify-end overflow-hidden ${!limited ? 'shrink' : fit.capped ? 'max-h-[45%] shrink-0' : 'shrink-0'}`}
      style={{ '--pb-fit': fit.scale }} data-testid="tv-podium">
      <Podium podium={podium} tv />
    </div>
  )
}

/**
 * @param {{ viewer: object, boardUrl?: string, actions?: import('react').ReactNode, highlightIds?: string[], tv?: boolean }} props
 */
export default function ResultsScreen({ viewer, boardUrl = '', actions = null, highlightIds = [], tv = false }) {
  const results = useMemo(() => finalResults(viewer), [viewer])
  const pairs = viewer.kind === 'TOURNAMENT'
  const summary = summaryText(results)
  const noGames = results.podium.length === 0
  const hasList = results.rest.length > 0 || results.didntPlay.length > 0

  if (tv) {
    return (
      <section aria-label="Final results" data-testid="final-results"
        className="flex min-h-0 flex-col gap-[1.6vh] rounded-2xl bg-navy-900 p-4 lg:col-span-full lg:row-span-full lg:justify-center lg:overflow-hidden lg:p-[1.4vw]">
        <Heading name={results.name} tv />
        {/* The podium takes what it needs (up to 45% when a list follows; a big tie shrinks it to fit), the list the rest. */}
        {noGames
          ? <p className="text-center text-[clamp(1.25rem,2vw,3rem)] text-mist">No games were saved in this session.</p>
          : <TvPodium podium={results.podium} limited={hasList} />}
        {hasList && <TvRest rest={results.rest} didntPlay={results.didntPlay} />}
        <p className="shrink-0 text-center text-[clamp(1.05rem,1.3vw,1.9rem)] text-mist">{summary} · Results stay available until {untilDate(results.expiresAt)}</p>
      </section>
    )
  }

  return (
    <section aria-label="Final results" data-testid="final-results" className="mx-auto grid w-full max-w-4xl gap-5 rounded-3xl bg-navy-900 p-4 sm:p-6">
      <Heading name={results.name} />
      {noGames
        ? <p className="text-center text-mist">No games were saved in this session.</p>
        : <div className="mx-auto w-full max-w-2xl"><Podium podium={results.podium} highlightIds={highlightIds} /></div>}
      <RestList rest={results.rest} highlightIds={highlightIds} pairs={pairs} />
      {results.didntPlay.length > 0 && (
        <p className="text-sm text-mist [overflow-wrap:anywhere]" data-testid="didnt-play">Didn't play: {results.didntPlay.join(', ')}</p>
      )}
      <div className="grid gap-1 text-sm text-mist">
        <p data-testid="results-summary">{summary}</p>
        <p>Results stay available until {untilDate(results.expiresAt)}.</p>
      </div>
      <div className="flex flex-wrap items-start gap-3">
        <ShareResultsButton results={results} url={boardUrl} />
        {actions}
      </div>
    </section>
  )
}

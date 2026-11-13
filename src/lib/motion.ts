/**
 * Stops SMIL animation for visitors who ask for reduced motion (ADR 0014).
 *
 * CSS `prefers-reduced-motion` stops CSS animations but not SVG <animate*>
 * elements, so every animated SVG carries `data-motion-root`; this pauses
 * them and marks the root `data-motion="off"` (the e2e test reads it). It
 * also follows a live change of the preference. Safe to call from several
 * components on one page: it runs once.
 */
let started = false

export function respectReducedMotion(): void {
  if (started) return
  started = true
  const root = document
  const query = window.matchMedia('(prefers-reduced-motion: reduce)')
  const apply = () => {
    for (const svg of root.querySelectorAll<SVGSVGElement>('svg[data-motion-root]')) {
      if (query.matches) {
        svg.pauseAnimations()
        svg.dataset.motion = 'off'
      } else {
        svg.unpauseAnimations()
        svg.dataset.motion = 'on'
      }
    }
  }
  apply()
  // The SVG timeline starts at the load event, which undoes a pause made
  // earlier (module scripts run before load), so apply again then.
  if (document.readyState !== 'complete') window.addEventListener('load', apply, { once: true })
  query.addEventListener('change', apply)
}

/**
 * Plays one Node sequence (spec G.4) by removing and re-adding `data-run`, so
 * the CSS animation restarts. One run per call; nothing repeats on its own.
 * Under reduced motion the CSS keeps the final frame, so this is harmless.
 */
export function replayNode(svg: SVGSVGElement, run: 'receive' | 'handoff'): void {
  svg.removeAttribute('data-run')
  // Reading layout commits the removal before the attribute comes back.
  void svg.getBoundingClientRect()
  svg.setAttribute('data-run', run)
}

let watchingVisibility = false

/** Marks the page hidden while its tab is in the background, so CSS pauses Node's sequences. */
export function pauseWhenHidden(): void {
  if (watchingVisibility) return
  watchingVisibility = true
  const apply = () => {
    if (document.hidden) document.documentElement.dataset.pageHidden = ''
    else delete document.documentElement.dataset.pageHidden
  }
  apply()
  document.addEventListener('visibilitychange', apply)
}

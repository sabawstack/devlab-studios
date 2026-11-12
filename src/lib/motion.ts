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

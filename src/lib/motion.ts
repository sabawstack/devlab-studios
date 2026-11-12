/**
 * Stops SMIL animation for visitors who ask for reduced motion (ADR 0014).
 *
 * CSS `prefers-reduced-motion` stops CSS animations but not SVG <animate*>
 * elements, so every animated SVG carries `data-motion-root`; this pauses
 * them and marks the root `data-motion="off"` (the e2e test reads it). It
 * also follows a live change of the preference.
 */
export function respectReducedMotion(root: ParentNode = document): void {
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
  query.addEventListener('change', apply)
}

/**
 * Node, the DevLab routing engine (ADR 0014): a secondary figure built from
 * the logo's `< | >` traces. Left plate magenta, centre plate the brand
 * gradient, right plate blue, each topped by a ring terminal; a visor across
 * the centre plate; terminal "hands" at the tips.
 *
 *   idle        visor blue → magenta, still
 *   active      visor pulses, three data packets travel the plate edges
 *   diagnostic  amber visor, holds a slate
 *
 * Hook-free so it renders from .astro files as static markup and inside the
 * inquiry form island alike. Colours come from classes in brand.css (tokens
 * only; no inline styles, which the CSP would block). Every id is prefixed so
 * two instances on a page never collide; pass `id` where the markup must be
 * stable between server and client.
 *
 * Motion: everything stops within 5 s (WCAG 2.2.2): three visor pulses (CSS,
 * also stopped by the global reduced-motion rule) and packets that end at
 * 4.8 s (SMIL; hidden under reduced motion and paused by src/lib/motion.ts).
 */

const STATES = new Set(['idle', 'active', 'diagnostic'])

/*
 * A page-wide counter, not useId: each Astro component renders in its own
 * React root, where useId restarts and two figures on one page would share
 * gradient ids. Callers that hydrate pass `id` instead.
 */
let counter = 0
function nextPrefix() {
  counter += 1
  return `node-${counter}`
}

/**
 * @param {object} props
 * @param {'idle'|'active'|'diagnostic'} [props.state]
 * @param {number} [props.size] rendered width in px; height keeps the 96:112 ratio
 * @param {string} [props.title] accessible name (ignored when decorative)
 * @param {boolean} [props.decorative] hide from assistive technology
 * @param {string} [props.id] id prefix for the gradients and title
 * @param {string} [props.className]
 */
export default function NodeMascot({ state = 'idle', size = 96, title = 'Node, the DevLab routing engine', decorative = false, id, className = '' }) {
  const mode = STATES.has(state) ? state : 'idle'
  const prefix = id || nextPrefix()
  const body = `${prefix}-gradient`
  const visor = `${prefix}-visor`
  const titleId = `${prefix}-title`
  const a11y = decorative ? { 'aria-hidden': 'true', focusable: 'false' } : { role: 'img', 'aria-labelledby': titleId }

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 96 112"
      width={size}
      height={Math.round((size * 112) / 96)}
      className={`node-mascot ${className}`.trim()}
      data-state={mode}
      data-motion-root=""
      {...a11y}
    >
      {!decorative && <title id={titleId}>{title}</title>}
      <defs>
        <linearGradient id={body} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="node-stop-magenta" />
          <stop offset="0.5" className="node-stop-violet" />
          <stop offset="1" className="node-stop-blue" />
        </linearGradient>
        <linearGradient id={visor} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" className="node-stop-blue" />
          <stop offset="1" className="node-stop-magenta" />
        </linearGradient>
      </defs>

      <g className="node-wire">
        <path d="M34 18v10M48 12v12M62 18v10M44 88l-2 12M52 88l2 12M16 56h-4M80 56h4" />
      </g>
      <circle className="node-ring node-ring--left" cx="34" cy="14" r="4" />
      <circle className="node-ring node-ring--centre" cx="48" cy="8" r="4" />
      <circle className="node-ring node-ring--right" cx="62" cy="14" r="4" />

      <polygon className="node-plate node-plate--left" points="30,28 37,28 23,56 37,84 30,84 16,56" />
      <polygon className="node-plate node-plate--right" points="66,28 59,28 73,56 59,84 66,84 80,56" />
      <rect className="node-torso" x="40" y="24" width="16" height="64" rx="3" fill={`url(#${body})`} />

      <rect className={`node-visor${mode === 'diagnostic' ? ' node-visor--amber' : ''}`} x="35" y="38" width="26" height="9" rx="4.5" fill={`url(#${visor})`} />
      <rect className="node-eye" x="40" y="41.5" width="16" height="2" rx="1" />

      <circle className="node-hand" cx="9" cy="56" r="3.5" />
      <circle className="node-hand" cx="87" cy="56" r="3.5" />
      <circle className="node-hand" cx="42" cy="102" r="3" />
      <circle className="node-hand" cx="54" cy="102" r="3" />

      {mode === 'diagnostic' && (
        <g data-node-slate="">
          <rect className="node-slate" x="76" y="62" width="16" height="20" rx="2" />
          <path className="node-slate-line" d="M79 68h10M79 72h7M79 76h9" />
        </g>
      )}

      {mode === 'active' && (
        <g className="node-packets">
          {/* Each packet starts at its plate's top terminal; the motion paths are relative to it.
              All motion ends at 4.8 s and the packets rest at the terminals (WCAG 2.2.2). */}
          <circle className="node-packet" r="2" cx="30" cy="28">
            <animateMotion dur="2.4s" repeatCount="indefinite" end="4.8s" path="M0 0L-14 28L0 56" />
          </circle>
          <circle className="node-packet" r="2" cx="48" cy="24">
            <animateMotion dur="2.4s" begin="0.8s" repeatCount="indefinite" end="4.8s" path="M0 0V64" />
          </circle>
          <circle className="node-packet" r="2" cx="66" cy="28">
            <animateMotion dur="2.4s" begin="1.6s" repeatCount="indefinite" end="4.8s" path="M0 0L14 28L0 56" />
          </circle>
        </g>
      )}
    </svg>
  )
}

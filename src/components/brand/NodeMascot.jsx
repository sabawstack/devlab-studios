/**
 * Node, the DevLab router (spec G.3 / G.4; MASCOT-01, MASCOT-02). The part of
 * every DevLab system that receives, holds, checks and hands off. Three plates
 * from the logo's `< | >` traces form the body (the centre plate 1.6 times the
 * width of each side plate); one round signal lamp is the head; two shoulder
 * terminals; terminal dots for hands. Ink lines on paper, inverted inside
 * `.ink-panel`; the lamp is the only filled accent.
 *
 *   idle          lamp unlit (outline)
 *   holding       lamp magenta, a slate in hand
 *   confirming    lamp green, the slate stamped with a check
 *   needs-person  lamp amber (exhibits only), a person beside
 *
 * Tiers: `mark` (24 px: centre plate, lamp, two side strokes), `figure`
 * (96 px), `scene` (240 px: the figure plus the hand-off path to a person).
 *
 * Motion is CSS only (brand.css), one run per trigger, never on its own:
 * `run="receive"` moves a packet into the body along the centre plate (600 ms);
 * `run="handoff"` (scene tier) moves it to the person (800 ms), then the lamp
 * turns green (200 ms). The packet is drawn at its final position, so reduced
 * motion and no-JS show the last frame. Re-trigger by removing and re-adding
 * `data-run` (src/lib/motion.ts `replayNode`).
 *
 * Hook-free, so it renders from .astro files as static markup and inside the
 * inquiry form island alike. No inline styles (CSP), no hex, no SMIL.
 * Approval: an unapproved state renders nothing unless `review` is set (the
 * /brand page); see src/config/node.js.
 */
import { NODE_STATES, NODE_TIERS, isNodeReady } from '../../config/node.js'

const TITLES = {
  idle: 'Node, the DevLab router',
  holding: 'Node, the DevLab router, holding an inquiry',
  confirming: 'Node, the DevLab router, handing an inquiry to a person',
  'needs-person': 'Node, the DevLab router, waiting for a person',
}

/*
 * A page-wide counter, not useId: each Astro component renders in its own
 * React root, where useId restarts. Callers that hydrate pass `id` instead.
 */
let counter = 0
function nextPrefix() {
  counter += 1
  return `node-${counter}`
}

function Mark() {
  return (
    <>
      <path className="node-line" d="M7 10 3 18l4 8M17 10l4 8-4 8" />
      <rect className="node-plate node-plate--centre" x="10" y="10" width="4" height="16" rx="1" />
      <circle className="node-lamp" cx="12" cy="5" r="3.5" />
    </>
  )
}

function Body({ state }) {
  return (
    <>
      <path className="node-line" d="M48 27v7M31 33v3M65 33v3M14 66h-2.5M82 66h2.5" />
      <circle className="node-terminal" cx="31" cy="30" r="3" />
      <circle className="node-terminal" cx="65" cy="30" r="3" />
      <polygon className="node-plate node-plate--left" points="26,36 36,36 24,66 36,96 26,96 14,66" />
      <polygon className="node-plate node-plate--right" points="70,36 60,36 72,66 60,96 70,96 82,66" />
      <rect className="node-plate node-plate--centre" x="40" y="34" width="16" height="62" rx="2" />
      <circle className="node-lamp" cx="48" cy="20" r="7" />
      <circle className="node-hand" cx="9" cy="66" r="2.5" />
      <circle className="node-hand" cx="87" cy="66" r="2.5" />
      {(state === 'holding' || state === 'confirming') && (
        <g data-node-slate="">
          <rect className="node-slate" x="80" y="72" width="14" height="17" rx="1.5" />
          {state === 'holding'
            ? <path className="node-line" d="M83 77h8M83 81h6M83 85h7" />
            : <path className="node-line node-stamp" data-node-stamp="" d="m83.5 80.5 3 3 5.5-6" />}
        </g>
      )}
      {state === 'needs-person' && (
        <g data-node-person="">
          <circle className="node-person" cx="7" cy="88" r="3" />
          <path className="node-person" d="M1.5 102c0-6 2.5-9 5.5-9s5.5 3 5.5 9" />
        </g>
      )}
      <circle className="node-packet node-packet--receive" cx="48" cy="64" r="2" />
    </>
  )
}

function Handoff({ state }) {
  return (
    <g data-node-handoff="" {...(state === 'needs-person' ? { 'data-node-person': '' } : {})}>
      <path className="node-line node-path" d="M92 66h54" />
      <circle className="node-person" cx="160" cy="52" r="6" />
      <path className="node-person" d="M148 80c0-10 5-16 12-16s12 6 12 16" />
      <circle className="node-packet node-packet--handoff" cx="150" cy="66" r="2" />
    </g>
  )
}

/**
 * @param {object} props
 * @param {'idle'|'holding'|'confirming'|'needs-person'} [props.state]
 * @param {'mark'|'figure'|'scene'} [props.tier]
 * @param {number} [props.size] rendered width in px; height keeps the tier ratio
 * @param {'receive'|'handoff'} [props.run] the one sequence to play on render
 * @param {boolean} [props.decorative] hidden from assistive technology (default)
 * @param {string} [props.title] overrides the state's accessible name
 * @param {string} [props.id] id prefix for the title
 * @param {boolean} [props.review] render an unapproved state (the /brand page)
 * @param {string} [props.className]
 */
export default function NodeMascot({ state = 'idle', tier = 'figure', size, run, decorative = true, title, id, review = false, className = '' }) {
  const mode = NODE_STATES.includes(state) ? state : 'idle'
  if (!review && !isNodeReady(mode)) return null
  const level = NODE_TIERS[tier] ? tier : 'figure'
  const [width, height] = NODE_TIERS[level].viewBox
  const renderedWidth = size ?? NODE_TIERS[level].size
  const titleId = `${id || nextPrefix()}-title`
  const a11y = decorative ? { 'aria-hidden': 'true', focusable: 'false' } : { role: 'img', 'aria-labelledby': titleId }

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${width} ${height}`}
      width={renderedWidth}
      height={Math.round((renderedWidth * height) / width)}
      className={`node-mascot node-mascot--${level} ${className}`.trim()}
      data-state={mode}
      data-tier={level}
      {...(run && level !== 'mark' ? { 'data-run': run } : {})}
      {...a11y}
    >
      {!decorative && <title id={titleId}>{title || TITLES[mode]}</title>}
      {level === 'mark' ? <Mark /> : <Body state={mode} />}
      {level === 'scene' && <Handoff state={mode} />}
    </svg>
  )
}

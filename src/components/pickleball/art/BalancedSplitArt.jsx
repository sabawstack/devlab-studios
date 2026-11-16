// src/components/pickleball/art/BalancedSplitArt.jsx
// Original, hand-authored SVG. Decorative. A level scale: a strong and a
// newer player on each pan, so both teams weigh about the same.
import { PB } from '../../../config/pickleballPalette'
export default function BalancedSplitArt({ className = '' }) {
  return (
    <svg viewBox="0 0 360 200" fill="none" className={className} aria-hidden="true">
      <path d="M180 60v110M140 172h80" stroke={PB.courtLine} strokeWidth="4" strokeLinecap="round" />
      <g className="pb-bob">
        <path d="M70 60h220" stroke="#fff" strokeWidth="4" strokeLinecap="round" />
        <path d="M90 60l-30 50h60zM270 60l-30 50h60z" stroke={PB.courtLine} strokeWidth="2" strokeLinejoin="round" />
        <circle cx="76" cy="96" r="13" fill={PB.play} />
        <circle cx="104" cy="100" r="8" fill={PB.play} />
        <circle cx="256" cy="100" r="8" fill={PB.teamB} />
        <circle cx="284" cy="96" r="13" fill={PB.teamB} />
      </g>
      <circle cx="180" cy="60" r="7" fill={PB.play} />
    </svg>
  )
}

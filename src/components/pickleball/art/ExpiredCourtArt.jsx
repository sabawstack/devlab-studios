// src/components/pickleball/art/ExpiredCourtArt.jsx
// Original, hand-authored SVG. Decorative. A quiet court with a resting ball.
import { PB } from '../../../config/pickleballPalette'
export default function ExpiredCourtArt({ className = '' }) {
  return (
    <svg viewBox="0 0 220 170" fill="none" className={className} aria-hidden="true">
      <rect x="20" y="60" width="180" height="96" rx="6" fill={PB.surface} />
      <rect x="32" y="70" width="156" height="76" stroke={PB.courtLine} strokeWidth="2" />
      <path d="M110 60v96" stroke={PB.courtLine} strokeWidth="4" />
      <g className="pb-bob"><circle cx="150" cy="134" r="12" fill={PB.play} /></g>
      <path className="pb-fade-cycle" d="M140 38h12l-12 12h12M162 24h9l-9 9h9" stroke={PB.ink2} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

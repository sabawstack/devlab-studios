// Original, hand-authored SVG. Decorative. Four first-round games feed two
// semi-finals and a final; the winning path lights up and the ball bobs at
// the top. CSS-only motion (pb-fade-cycle, pb-bob), stopped for reduced motion.
import { PB } from '../../../config/pickleballPalette'
const FIRST = [24, 64, 112, 152]
const SEMI = [44, 132]

export default function BracketArt({ className = '' }) {
  return (
    <svg viewBox="0 0 340 196" fill="none" className={className} aria-hidden="true">
      {FIRST.map((y) => <rect key={y} x="12" y={y} width="86" height="22" rx="6" fill={PB.court} />)}
      {SEMI.map((y) => <rect key={y} x="128" y={y} width="86" height="22" rx="6" fill={PB.court} />)}
      <rect x="244" y="88" width="86" height="22" rx="6" fill={PB.raised} stroke={PB.courtLine} strokeWidth="2" />
      <path d="M98 35h15v20h15M98 75h15V55M98 123h15v20h15M98 163h15v-20M214 55h15v44h15M214 143h15V99" stroke={PB.courtLine} strokeWidth="3" strokeLinejoin="round" />
      <g className="pb-fade-cycle">
        <rect x="12" y="24" width="86" height="22" rx="6" fill={PB.play} />
        <rect x="128" y="44" width="86" height="22" rx="6" fill={PB.play} />
        <rect x="244" y="88" width="86" height="22" rx="6" fill={PB.play} />
        <path d="M98 35h15v20h15M214 55h15v44h15" stroke={PB.play} strokeWidth="4" strokeLinejoin="round" />
      </g>
      <g className="pb-bob">
        <circle cx="287" cy="60" r="12" fill={PB.play} />
        <circle cx="283" cy="56" r="2" fill={PB.canvas} />
        <circle cx="292" cy="62" r="2" fill={PB.canvas} />
        <circle cx="285" cy="66" r="2" fill={PB.canvas} />
      </g>
    </svg>
  )
}

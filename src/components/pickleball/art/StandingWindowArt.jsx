// src/components/pickleball/art/StandingWindowArt.jsx
// Original, hand-authored SVG. Decorative. A ladder of eight standings bars;
// a window of four neighbouring ranks lights up and plays together.
const BARS = [150, 136, 122, 108, 94, 80, 66, 52]

export default function StandingWindowArt({ className = '' }) {
  return (
    <svg viewBox="0 0 360 200" fill="none" className={className} aria-hidden="true">
      {BARS.map((width, i) => (
        <rect key={width} x="20" y={22 + i * 20} width={width} height="12" rx="6" fill={i >= 2 && i <= 5 ? '#c6ff2e' : '#3055d6'} />
      ))}
      <g className="pb-fade-cycle">
        <rect x="12" y="56" width="168" height="80" rx="10" stroke="#c6ff2e" strokeWidth="3" />
      </g>
      <path d="M192 96h30m-8-7 8 7-8 7" stroke="#c6ff2e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="236" y="40" width="110" height="112" rx="8" fill="#3055d6" />
      <path d="M236 96h110" stroke="#fff" strokeWidth="3" />
      <g className="pb-bob">
        <circle cx="266" cy="68" r="9" fill="#c6ff2e" />
        <circle cx="316" cy="68" r="9" fill="#c6ff2e" />
        <circle cx="266" cy="124" r="9" fill="#8d9bff" />
        <circle cx="316" cy="124" r="9" fill="#8d9bff" />
      </g>
    </svg>
  )
}

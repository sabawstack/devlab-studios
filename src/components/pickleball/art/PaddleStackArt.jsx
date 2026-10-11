// src/components/pickleball/art/PaddleStackArt.jsx
// Original, hand-authored SVG. Decorative. Four waiting players step onto the free court in turn.
export default function PaddleStackArt({ className = '' }) {
  return (
    <svg viewBox="0 0 360 200" fill="none" className={className} aria-hidden="true">
      <rect x="190" y="30" width="150" height="140" rx="8" fill="#3055d6" />
      <path d="M190 100h150" stroke="#fff" strokeWidth="3" />
      <rect x="200" y="40" width="130" height="120" stroke="#fff" strokeWidth="2" />
      <rect x="20" y="40" width="120" height="120" rx="12" stroke="#7594fb" strokeWidth="2" strokeDasharray="5 6" />
      {[0, 1, 2, 3].map((i) => (
        <g key={i} className="pb-step" style={{ animationDelay: `${i * 0.25}s`, '--pb-step-x': `${190 + (i % 2) * 70}px` }}>
          <circle cx={50 + (i % 2) * 40} cy={70 + Math.floor(i / 2) * 50} r="10" fill={i < 2 ? '#c6ff2e' : '#8d9bff'} />
        </g>
      ))}
      <path d="M150 100h30m-8-7 8 7-8 7" stroke="#c6ff2e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// src/components/pickleball/art/WinnersShuffleArt.jsx
// Original, hand-authored SVG. Decorative. Two winning pairs (neon, violet)
// step onto one court split up, so each side has one player from each pair.
const PLAYERS = [
  { y: 50, fill: '#c6ff2e' },
  { y: 80, fill: '#8d9bff' },
  { y: 120, fill: '#c6ff2e' },
  { y: 150, fill: '#8d9bff' },
]

export default function WinnersShuffleArt({ className = '' }) {
  return (
    <svg viewBox="0 0 360 200" fill="none" className={className} aria-hidden="true">
      <rect x="190" y="30" width="150" height="140" rx="8" fill="#3055d6" />
      <path d="M190 100h150" stroke="#fff" strokeWidth="3" />
      <rect x="200" y="40" width="130" height="120" stroke="#fff" strokeWidth="2" />
      <path d="M22 44v42M22 114v42" stroke="#7594fb" strokeWidth="2" strokeLinecap="round" />
      <path d="M58 44v42M58 114v42" stroke="#7594fb" strokeWidth="2" strokeLinecap="round" strokeDasharray="3 5" />
      {PLAYERS.map(({ y, fill }, i) => (
        <g key={y} className="pb-step" style={{ animationDelay: `${i * 0.2}s`, '--pb-step-x': '200px' }}>
          <circle cx="40" cy={y} r="10" fill={fill} />
        </g>
      ))}
      <path d="M150 100h30m-8-7 8 7-8 7" stroke="#c6ff2e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

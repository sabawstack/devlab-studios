// src/components/pickleball/art/ExpiredCourtArt.jsx
// Original, hand-authored SVG. Decorative. A quiet court with a resting ball.
export default function ExpiredCourtArt({ className = '' }) {
  return (
    <svg viewBox="0 0 220 170" fill="none" className={className} aria-hidden="true">
      <rect x="20" y="60" width="180" height="96" rx="6" fill="#11214d" />
      <rect x="32" y="70" width="156" height="76" stroke="#7594fb" strokeWidth="2" />
      <path d="M110 60v96" stroke="#7594fb" strokeWidth="4" />
      <g className="pb-bob"><circle cx="150" cy="134" r="12" fill="#c6ff2e" /></g>
      <path className="pb-fade-cycle" d="M140 38h12l-12 12h12M162 24h9l-9 9h9" stroke="#b5c4e1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

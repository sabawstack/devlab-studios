// src/components/pickleball/art/ScoreTapArt.jsx
// Original, hand-authored SVG. Decorative. A phone showing a saved 11–7 with a pulsing tap target.
export default function ScoreTapArt({ className = '' }) {
  return (
    <svg viewBox="0 0 220 200" fill="none" className={className} aria-hidden="true">
      <rect x="60" y="10" width="100" height="180" rx="16" fill="#11214d" stroke="#7594fb" strokeWidth="2" />
      <rect x="72" y="34" width="76" height="40" rx="8" fill="#c6ff2e" />
      <path d="M86 54h48" stroke="#0b1426" strokeWidth="6" strokeLinecap="round" />
      <text x="110" y="112" textAnchor="middle" fontFamily="Plus Jakarta Sans, sans-serif" fontWeight="700" fontSize="30" fill="#fff">11–7</text>
      <rect x="76" y="136" width="68" height="30" rx="10" fill="#4500ff" />
      <circle className="pb-pulse" cx="150" cy="160" r="16" stroke="#c6ff2e" strokeWidth="3" />
    </svg>
  )
}

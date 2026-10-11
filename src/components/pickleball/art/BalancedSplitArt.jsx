// src/components/pickleball/art/BalancedSplitArt.jsx
// Original, hand-authored SVG. Decorative. A level scale: a strong and a
// newer player on each pan, so both teams weigh about the same.
export default function BalancedSplitArt({ className = '' }) {
  return (
    <svg viewBox="0 0 360 200" fill="none" className={className} aria-hidden="true">
      <path d="M180 60v110M140 172h80" stroke="#7594fb" strokeWidth="4" strokeLinecap="round" />
      <g className="pb-bob">
        <path d="M70 60h220" stroke="#fff" strokeWidth="4" strokeLinecap="round" />
        <path d="M90 60l-30 50h60zM270 60l-30 50h60z" stroke="#7594fb" strokeWidth="2" strokeLinejoin="round" />
        <circle cx="76" cy="96" r="13" fill="#c6ff2e" />
        <circle cx="104" cy="100" r="8" fill="#c6ff2e" />
        <circle cx="256" cy="100" r="8" fill="#8d9bff" />
        <circle cx="284" cy="96" r="13" fill="#8d9bff" />
      </g>
      <circle cx="180" cy="60" r="7" fill="#c6ff2e" />
    </svg>
  )
}

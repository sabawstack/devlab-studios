// src/components/pickleball/art/HeroRallyArt.jsx
// Original, hand-authored SVG. Decorative (aria-hidden). Animates only via
// pickleball-open.css classes inside a .pb-anim wrapper; static otherwise.
export default function HeroRallyArt({ className = '' }) {
  return (
    <svg viewBox="0 0 480 300" fill="none" className={className} aria-hidden="true">
      <rect x="40" y="110" width="400" height="170" rx="10" fill="#3055d6" />
      <rect x="58" y="124" width="364" height="142" stroke="#fff" strokeWidth="2.5" />
      <rect x="196" y="124" width="88" height="142" fill="#4d72ef" stroke="#fff" strokeWidth="2.5" />
      <path d="M240 104v176" stroke="#fff" strokeWidth="5" strokeLinecap="round" />
      <path d="M92 190q148-170 296 0" stroke="#c6ff2e" strokeWidth="2" strokeDasharray="4 8" opacity="0.7" />
      <g className="pb-ball">
        <circle cx="96" cy="182" r="13" fill="#c6ff2e" />
        <circle cx="92" cy="178" r="1.8" fill="#0b1426" /><circle cx="100" cy="184" r="1.8" fill="#0b1426" /><circle cx="95" cy="188" r="1.8" fill="#0b1426" />
      </g>
      <g className="pb-bob" transform="rotate(-22 88 214)">
        <rect x="74" y="190" width="30" height="40" rx="14" fill="#4500ff" />
        <rect x="85" y="228" width="8" height="22" rx="3" fill="#11214d" />
      </g>
      <g className="pb-bob" style={{ animationDelay: '0.9s' }} transform="rotate(20 396 206)">
        <rect x="382" y="182" width="30" height="40" rx="14" fill="#fff" />
        <rect x="393" y="220" width="8" height="22" rx="3" fill="#b5c4e1" />
      </g>
      {[[120, 240], [170, 160], [310, 240], [360, 160]].map(([x, y], i) => (
        <g key={x} className="pb-bob" style={{ animationDelay: `${i * 0.3}s` }}>
          <circle cx={x} cy={y - 18} r="8" fill={i < 2 ? '#c6ff2e' : '#8d9bff'} />
          <path d={`M${x - 9} ${y + 4}q9-20 18 0`} stroke={i < 2 ? '#c6ff2e' : '#8d9bff'} strokeWidth="6" strokeLinecap="round" />
        </g>
      ))}
    </svg>
  )
}

// src/components/pickleball/art/FeatureIcons.jsx
// Original, hand-authored 32x32 SVG icons for the landing page's feature
// cards. Decorative (aria-hidden), rendered statically, no JS. Motion comes
// from src/styles/pickleball-open.css and only runs inside a `.pb-anim`
// container, so it stops for reduced motion. No animated element carries its
// own `transform` attribute: the CSS animation would replace it.
const NEON = '#c6ff2e'
const TEAMB = '#8d9bff'

function Icon({ className = '', children }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {children}
    </svg>
  )
}

// Paddles waiting in the stack; the next one up lifts.
export function PaddleQueueIcon({ className }) {
  return (
    <Icon className={className}>
      <path d="M2 28h28" stroke={TEAMB} strokeWidth="1.5" opacity="0.5" />
      {[0, 1, 2].map((i) => {
        const x = 3 + i * 9.5
        const colour = i === 0 ? NEON : TEAMB
        return (
          <g key={i} className={i === 0 ? 'pb-lift' : undefined}>
            <rect x={x} y="6" width="7" height="12" rx="3.5" fill={i === 0 ? NEON : 'none'} stroke={colour} strokeWidth="2" />
            <path d={`M${x + 3.5} 18v6`} stroke={colour} strokeWidth="2.5" />
          </g>
        )
      })}
    </Icon>
  )
}

// Games-played bars holding level against an "even" line.
export function FairnessBarsIcon({ className }) {
  const bars = [{ x: 5, y: 12 }, { x: 13.5, y: 10 }, { x: 22, y: 11 }]
  return (
    <Icon className={className}>
      <path d="M3 8h26" stroke="#fff" strokeWidth="1.5" strokeDasharray="2 2.5" opacity="0.55" />
      {bars.map(({ x, y }, i) => (
        <rect key={x} className="pb-grow" style={{ animationDelay: `${i * 0.4}s` }} x={x} y={y} width="5" height={27 - y} rx="1.5" fill={i === 1 ? TEAMB : NEON} />
      ))}
    </Icon>
  )
}

// Two players with a link between them.
export function LinkedPlayersIcon({ className }) {
  return (
    <Icon className={className}>
      <circle cx="8" cy="10" r="4" stroke={NEON} strokeWidth="2" />
      <path d="M2 26a6 6 0 0 1 12 0" stroke={NEON} strokeWidth="2" />
      <circle cx="24" cy="10" r="4" stroke={TEAMB} strokeWidth="2" />
      <path d="M18 26a6 6 0 0 1 12 0" stroke={TEAMB} strokeWidth="2" />
      <rect className="pb-pulse" x="12.5" y="15" width="7" height="4" rx="2" stroke={NEON} strokeWidth="1.75" />
    </Icon>
  )
}

// Four courts; a highlight walks round them in turn.
export function CourtGridIcon({ className }) {
  const courts = [{ x: 3, y: 4 }, { x: 17, y: 4 }, { x: 17, y: 17 }, { x: 3, y: 17 }]
  return (
    <Icon className={className}>
      {courts.map(({ x, y }, i) => (
        <g key={i}>
          <rect className="pb-spot" style={{ animationDelay: `${i}s` }} x={x} y={y} width="12" height="11" rx="2" fill={NEON} opacity="0" />
          <rect x={x} y={y} width="12" height="11" rx="2" stroke={TEAMB} strokeWidth="1.75" />
          <path d={`M${x + 6} ${y + 1.5}v8`} stroke={TEAMB} strokeWidth="1.25" opacity="0.7" />
        </g>
      ))}
    </Icon>
  )
}

// A captain's whistle with a lanyard; the sound marks blink.
export function WhistleIcon({ className }) {
  return (
    <Icon className={className}>
      <path d="M7 14C3.5 10 5 5 10 4" stroke={TEAMB} strokeWidth="1.75" />
      <rect x="12" y="11" width="16" height="6" rx="2" fill={NEON} />
      <path fillRule="evenodd" d="M5 20a7 7 0 1 0 14 0a7 7 0 1 0 -14 0zM9.5 20a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0 -5 0z" fill={NEON} />
      <path className="pb-fade-cycle" d="M24 7l1.5-3M28 9l2.5-1.5" stroke={TEAMB} strokeWidth="1.75" />
    </Icon>
  )
}

// A venue screen showing courts and standings.
export function TvBoardIcon({ className }) {
  return (
    <Icon className={className}>
      <rect x="2.5" y="4" width="27" height="18" rx="2.5" stroke={TEAMB} strokeWidth="2" />
      <path d="M11 28h10M16 22v6" stroke={TEAMB} strokeWidth="2" />
      <rect x="6" y="7.5" width="9" height="6" rx="1" fill={NEON} />
      <rect className="pb-pulse" x="17" y="7.5" width="9" height="6" rx="1" fill={NEON} />
      <path d="M6 17.5h20" stroke="#fff" strokeWidth="1.5" opacity="0.6" />
    </Icon>
  )
}

// The host link as a key, with a small sparkle: nothing to sign up for.
export function KeyIcon({ className }) {
  return (
    <Icon className={className}>
      <circle cx="9" cy="17" r="5.5" stroke={NEON} strokeWidth="2" />
      <circle cx="9" cy="17" r="1.5" fill={NEON} />
      <path d="M14.5 17H28M24 17v4M28 17v3" stroke={NEON} strokeWidth="2" />
      <path className="pb-fade-cycle" d="M24 3v6M21 6h6" stroke={TEAMB} strokeWidth="1.75" />
    </Icon>
  )
}

// A four-team bracket; the winner's spot pulses.
export function BracketIcon({ className }) {
  return (
    <Icon className={className}>
      <path d="M3 6h7v6H3M10 9h6M3 20h7v6H3M10 23h6M16 9v14M16 16h6" stroke={TEAMB} strokeWidth="1.75" />
      <circle className="pb-pulse" cx="26" cy="16" r="3.5" fill={NEON} />
    </Icon>
  )
}

// A file with an upload arrow for the DUPR CSV.
export function UploadFileIcon({ className }) {
  return (
    <Icon className={className}>
      <path d="M7 3h12l6 6v20H7z" stroke={TEAMB} strokeWidth="2" />
      <path d="M19 3v6h6" stroke={TEAMB} strokeWidth="2" />
      <g className="pb-lift">
        <path d="M16 25V14M11.5 18.5 16 14l4.5 4.5" stroke={NEON} strokeWidth="2.25" />
      </g>
    </Icon>
  )
}

// A clock whose hand sweeps, with a lock: kept for a while, then deleted.
export function ClockLockIcon({ className }) {
  return (
    <Icon className={className}>
      <circle cx="12" cy="12" r="9" stroke={TEAMB} strokeWidth="2" />
      <path d="M12 12h4" stroke={TEAMB} strokeWidth="2" />
      <line className="pb-sweep" style={{ '--pb-pivot': '12px 12px' }} x1="12" y1="12" x2="12" y2="6" stroke={NEON} strokeWidth="2" />
      <path d="M22.5 20v-2a2.5 2.5 0 0 1 5 0v2" stroke={NEON} strokeWidth="1.75" />
      <rect x="20.5" y="20" width="9" height="8" rx="1.5" fill={NEON} />
    </Icon>
  )
}

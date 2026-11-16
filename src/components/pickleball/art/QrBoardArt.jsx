// src/components/pickleball/art/QrBoardArt.jsx
// Original, hand-authored SVG. Decorative. A QR card beaming the board to a phone.
import { PB } from '../../../config/pickleballPalette'
export default function QrBoardArt({ className = '' }) {
  const cells = [[0, 0], [2, 0], [4, 1], [1, 2], [3, 2], [0, 4], [2, 3], [4, 4], [3, 4]]
  return (
    <svg viewBox="0 0 260 180" fill="none" className={className} aria-hidden="true">
      <rect x="16" y="30" width="110" height="110" rx="12" fill="#fff" />
      {[[28, 42], [86, 42], [28, 100]].map(([x, y]) => <rect key={`${x}${y}`} x={x} y={y} width="28" height="28" rx="4" stroke={PB.canvas} strokeWidth="6" />)}
      {cells.map(([cx, cy]) => <rect key={`${cx}-${cy}`} x={64 + cx * 9} y={70 + cy * 9} width="7" height="7" fill={PB.canvas} />)}
      <path className="pb-fade-cycle" d="M136 84c20-12 40-12 60 0M142 98c14-8 28-8 42 0" stroke={PB.play} strokeWidth="3" strokeLinecap="round" />
      <rect x="196" y="40" width="50" height="96" rx="10" fill={PB.surface} stroke={PB.courtLine} strokeWidth="2" />
      <rect className="pb-fade-cycle" x="204" y="56" width="34" height="12" rx="3" fill={PB.play} />
      <rect x="204" y="74" width="34" height="8" rx="3" fill={PB.courtLine} />
      <rect x="204" y="88" width="34" height="8" rx="3" fill={PB.courtLine} />
    </svg>
  )
}

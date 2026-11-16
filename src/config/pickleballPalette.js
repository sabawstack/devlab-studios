// DevLab Pickleball colours on the DevLab brand (ADR 0016, amended 2026-11-16).
//
// The one source of every Pickleball colour: the Tailwind `pb-*` utilities
// (tailwind.config.js), the CSS layer (src/styles/pickleball-app.css and the
// .pb-marketing band in pickleball-open.css), the SVG art and the results
// poster all read these values. The surfaces are the brand's graphite exhibit
// surface (the home hero), and the two court colours are light ends of the
// brand gradient: indigo for play (team A, "you are on", selected) and
// magenta for team B. Guarded by src/config/pickleballPalette.test.js.
export const PB = {
  // Surfaces: brand graphite (--exhibit-paper, --exhibit-paper-2) and two steps around them.
  canvas: '#14122b',
  sunken: '#0f0d22',
  surface: '#1d1b36',
  raised: '#29274a',
  // Hairlines between cards; form fields use the stronger `field` (3:1 on every surface).
  rule: '#3a3858',
  field: '#77749a',
  // Text: brand graphite inks (--exhibit-ink, --exhibit-ink-2).
  ink: '#f2f1f6',
  ink2: '#c6c4d6',
  // Play: team A, the current player, the call and the selected choice. Graphite text on it.
  play: '#c7d2fe',
  // Team B: the magenta end of the brand gradient, a different lightness from play.
  teamB: '#e879f9',
  // Illustrations only: the court (brand indigo), its kitchen and its lines.
  court: '#4338ca',
  courtInner: '#4f46e5',
  courtLine: '#818cf8',
  // The non-game primary action (brand --link) and its hover.
  action: '#4338ca',
  actionHover: '#4f46e5',
}

// TV board grid (spec §7, §11): every court on one screen, readable from about
// 5 m on a 1080p screen. Columns grow with the court count; the type size
// shrinks with the columns so four names always fit a card.
const COLUMNS = [1, 1, 2, 3, 2, 3, 3, 4, 4, 3, 4, 4, 4, 4, 4, 4, 4]

/** Columns for n courts on a landscape screen: 1→1, 2→2, 3→3, 4→2×2, 5–6→3, 7–8→4, 9→3×3, 10–16→4. */
export function tvColumns(courts) {
  const n = Math.max(1, Math.min(16, Math.trunc(courts) || 1))
  return COLUMNS[n]
}

export function tvRows(courts) {
  const n = Math.max(1, Math.min(16, Math.trunc(courts) || 1))
  return Math.ceil(n / tvColumns(n))
}

/** The side panel cycles every PANEL_MS: standings, then recent results. */
export const PANEL_MS = 15_000
export const PANELS = ['standings', 'results']

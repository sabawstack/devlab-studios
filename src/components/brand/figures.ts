/**
 * Per-page figure numbering: call once in a page's frontmatter and pass
 * `next()` to each Figure/SceneFrame in reading order.
 */
export function createFigureCounter(start = 1) {
  let current = start - 1
  return { next: () => (current += 1) }
}

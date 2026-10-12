// src/pickleball-open/results/posterLayout.js
// The results poster's layout (brief §C): pure geometry and text fitting for a
// 1080×1350 PNG. It never touches a canvas; the caller hands in a
// measure(text, font) function (canvas measureText in the browser, a fake in
// tests), and drawPoster.js paints what this returns.
//
// Text is fitted, never cut: shrink on one line first, then wrap to two lines
// (at spaces, or after a hyphen inside a very long word), shrinking further if
// it must. Ranking comes from results.ts; nothing here re-ranks anyone.
import { podiumDisplayOrder, podiumStepColumns, summaryText, winLoss } from '../../lib/pickleball/open/results'

export const POSTER = Object.freeze({ width: 1080, height: 1350, pad: 72, bandHeight: 220 })

/** Places 4–10 at most, never more than this many rows. */
export const REST_LIMIT = Object.freeze({ maxPlace: 10, maxRows: 7 })

const LINE = 1.16
const FLOOR = 10

/** @typedef {{ size: number, weight?: number }} Font */
/** @typedef {(text: string, font: Font) => number} Measure */

const clean = (text) => String(text ?? '').replace(/\s+/g, ' ').trim()

/** Words, with any word wider than the box split after its hyphens ("Jean-" + "Luc"). */
function tokens(text, fits) {
  return clean(text).split(' ').filter(Boolean).flatMap((word) => {
    if (fits(word)) return [{ text: word, space: true }]
    const parts = word.split(/(?<=-)/)
    return parts.map((part, i) => ({ text: part, space: i === 0 }))
  })
}

/**
 * Greedy word wrap. A single token wider than the box keeps its own line (the
 * caller shrinks the size until it fits); nothing is ever dropped.
 * @param {string} text
 * @param {number} maxWidth
 * @param {(text: string) => number} width
 * @returns {string[]}
 */
export function wrapWords(text, maxWidth, width) {
  const lines = []
  let line = ''
  for (const token of tokens(text, (word) => width(word) <= maxWidth)) {
    const candidate = line ? `${line}${token.space ? ' ' : ''}${token.text}` : token.text
    if (!line || width(candidate) <= maxWidth) {
      line = candidate
    } else {
      lines.push(line)
      line = token.text
    }
  }
  return line ? [...lines, line] : lines
}

/**
 * Fits text in a box: one line, shrinking from maxSize to minSize; else wrapped
 * to maxLines, from maxSize down (below minSize only if it must). Every
 * character is kept.
 * @param {{ text: string, maxWidth: number, maxSize: number, minSize: number, maxLines?: number,
 *   maxHeight?: number, weight?: number, measure: Measure }} options
 * @returns {{ size: number, lines: string[], height: number, fits: boolean }}
 */
export function fitText({ text, maxWidth, maxSize, minSize, maxLines = 2, maxHeight = Infinity, weight = 700, measure }) {
  const value = clean(text)
  const widthAt = (size) => (t) => measure(t, { size, weight })
  const result = (size, lines, fits = true) => ({ size, lines, height: lines.length * size * LINE, fits })
  const ok = (size, lines) => lines.length <= maxLines && lines.length * size * LINE <= maxHeight + 0.01
    && lines.every((line) => widthAt(size)(line) <= maxWidth + 0.01)
  if (!value) return result(minSize, [])
  for (let size = maxSize; size >= minSize; size -= 1) {
    if (ok(size, [value])) return result(size, [value])
  }
  for (let size = maxSize; size >= FLOOR; size -= 1) {
    const lines = wrapWords(value, maxWidth, widthAt(size))
    if (ok(size, lines)) return result(size, lines)
  }
  return result(FLOOR, wrapWords(value, maxWidth, widthAt(FLOOR)), false)
}

/**
 * Who the list under the podium shows (places 4–10, at most seven rows) and
 * how many it leaves out.
 * @template {{ place: number }} T
 * @param {readonly T[]} rest
 * @returns {{ shown: T[], more: number }}
 */
export function restRows(rest, limit = REST_LIMIT) {
  const shown = rest.filter((entry) => entry.place <= limit.maxPlace).slice(0, limit.maxRows)
  return { shown, more: rest.length - shown.length }
}

/** "+3 more players" (or pairs); null when nobody is left out. */
export function moreLabel(more, noun = 'player') {
  if (more <= 0) return null
  return `+${more} more ${noun}${more === 1 ? '' : 's'}`
}

/**
 * Podium steps left to right (2nd · 1st · 3rd), each as wide as the columns its
 * names need (a tie stands side by side on one wider step, as on the screen),
 * the whole podium centred.
 * @param {readonly { place: number, entries: readonly object[] }[]} steps in display order
 * @param {{ x: number, width: number, gap: number, maxColumnWidth: number }} box
 */
export function podiumSlots(steps, { x, width, gap, maxColumnWidth }) {
  const columns = steps.map((step) => podiumStepColumns(step.entries.length))
  const total = columns.reduce((sum, n) => sum + n, 0)
  if (total === 0) return []
  const gaps = gap * (steps.length - 1)
  const unit = Math.min(maxColumnWidth, (width - gaps) / total)
  const used = unit * total + gaps
  let left = x + (width - used) / 2
  return steps.map((step, i) => {
    const slot = { place: step.place, x: left, width: unit * columns[i], columns: columns[i], rows: Math.ceil(step.entries.length / columns[i]) }
    left += slot.width + gap
    return slot
  })
}

/**
 * Where each name sits inside a step: rows of `columns`, a short last row centred.
 * @returns {{ x: number, width: number, row: number }[]}
 */
export function entryCells(count, { x, width, columns, gap }) {
  const cellWidth = (width - gap * (columns - 1)) / columns
  return Array.from({ length: count }, (_, i) => {
    const row = Math.floor(i / columns)
    const inRow = Math.min(columns, count - row * columns)
    const offset = (width - (cellWidth * inRow + gap * (inRow - 1))) / 2
    return { x: x + offset + (i % columns) * (cellWidth + gap), width: cellWidth, row }
  })
}

const pct = (value) => (value === null || value === undefined ? '–' : `${Math.round(value * 100)}%`)
const ORDINAL = { 1: '1st', 2: '2nd', 3: '3rd' }

/**
 * Everything the poster says, from the final results.
 * @param {import('../../lib/pickleball/open/results').FinalResults} results
 * @param {{ hostName: string, dateText: string }} meta
 */
export function posterModel(results, { hostName, dateText }) {
  const pairs = results.kind === 'TOURNAMENT'
  const { shown, more } = restRows(results.rest)
  return {
    title: clean(results.name),
    subtitle: `Final standings · ${dateText}`,
    host: clean(hostName) ? `Hosted by ${clean(hostName)}` : '',
    steps: podiumDisplayOrder(results.podium).map((step) => ({
      place: step.place,
      label: ORDINAL[step.place],
      entries: step.entries.map((e) => ({ name: e.name, stat: `${winLoss(e)} · ${pct(e.winRate)}` })),
    })),
    rest: shown.map((e) => ({ place: String(e.place), name: e.name, stat: `${winLoss(e)} · ${pct(e.winRate)}` })),
    more: moreLabel(more, pairs ? 'pair' : 'player'),
    summary: summaryText(results),
  }
}

/** "Sunday Open Play!" → "sunday-open-play-results.png". */
export function posterFilename(name) {
  const slug = clean(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60).replace(/-$/, '')
  return `${slug || 'session'}-results.png`
}

// ── The whole poster ─────────────────────────────────────────────────────────

const W = POSTER.width
const PAD = POSTER.pad
const INNER = W - PAD * 2
const STEP_HEIGHT = { 1: 176, 2: 128, 3: 92 }
const NAME_SIZE = { 1: 46, 2: 40, 3: 40 }
const MAX_SCALE = 1.15

function headerLayout(model, measure) {
  const title = fitText({ text: model.title, maxWidth: INNER, maxSize: 76, minSize: 58, maxLines: 2, measure })
  const top = 86
  const titleLines = title.lines.map((text, i) => ({ text, y: top + title.size * (0.82 + i * 1.08) }))
  const titleBottom = top + title.size * (0.82 + (title.lines.length - 1) * 1.08)
  const subtitle = fitText({ text: model.subtitle, maxWidth: INNER, maxSize: 32, minSize: 22, maxLines: 1, measure })
  const subtitleY = titleBottom + 26 + subtitle.size
  const host = model.host ? fitText({ text: model.host, maxWidth: INNER, maxSize: 28, minSize: 18, maxLines: 2, weight: 500, measure }) : null
  const hostLines = host ? host.lines.map((text, i) => ({ text, y: subtitleY + 16 + host.size * (1 + i * LINE) })) : []
  const bottom = hostLines.length ? hostLines[hostLines.length - 1].y : subtitleY
  return {
    title: { size: title.size, lines: titleLines },
    subtitle: { size: subtitle.size, text: subtitle.lines.join(' '), y: subtitleY },
    host: host ? { size: host.size, lines: hostLines } : null,
    bottom: bottom + 12,
  }
}

function restLayout(model, measure, bottom) {
  const count = model.rest.length
  if (count === 0 && !model.more) return { rows: [], more: null, top: bottom }
  const columns = count > 3 ? 2 : 1
  const gap = 20
  const width = columns === 2 ? (INNER - gap) / 2 : Math.min(INNER, 760)
  const rowHeight = 60
  const perColumn = Math.ceil(count / columns)
  const moreHeight = model.more ? 48 : 0
  const top = bottom - perColumn * (rowHeight + 10) - moreHeight
  const left = (W - (width * columns + gap * (columns - 1))) / 2
  const rows = model.rest.map((entry, i) => {
    const column = Math.floor(i / perColumn)
    const x = left + column * (width + gap)
    const y = top + (i % perColumn) * (rowHeight + 10)
    const statSize = 24
    const statWidth = measure(entry.stat, { size: statSize, weight: 600 })
    const nameX = x + 74
    const nameWidth = width - 74 - statWidth - 40
    const name = fitText({ text: entry.name, maxWidth: nameWidth, maxSize: 28, minSize: 22, maxLines: 2, maxHeight: rowHeight - 8, measure })
    return { x, y, width, height: rowHeight, place: entry.place, stat: entry.stat, statSize, name: { x: nameX, size: name.size, lines: name.lines } }
  })
  const more = model.more ? { text: model.more, y: bottom - 12, size: 24 } : null
  return { rows, more, top }
}

function stepNames(step, slot, scale, measure) {
  const cells = entryCells(step.entries.length, { x: slot.x, width: slot.width, columns: slot.columns, gap: 18 })
  const maxSize = Math.round(NAME_SIZE[step.place] * scale)
  const fitted = step.entries.map((entry, i) => fitText({ text: entry.name, maxWidth: cells[i].width - 8, maxSize, minSize: Math.round(maxSize * 0.72), maxLines: 2, measure }))
  // One size per step, so tied names look equal; re-wrap each at that size.
  const size = Math.min(...fitted.map((f) => f.size))
  const statSize = Math.max(16, Math.round(26 * scale))
  const entries = step.entries.map((entry, i) => {
    const lines = fitText({ text: entry.name, maxWidth: cells[i].width - 8, maxSize: size, minSize: size, maxLines: 2, measure }).lines
    return { ...cells[i], name: entry.name, lines, stat: entry.stat, height: lines.length * size * LINE + 8 + statSize * 1.2 }
  })
  const rowHeights = Array.from({ length: slot.rows }, (_, row) => Math.max(...entries.filter((e) => e.row === row).map((e) => e.height)))
  const rowGap = 16
  return { size, statSize, entries, rowHeights, height: rowHeights.reduce((a, b) => a + b, 0) + rowGap * (slot.rows - 1), rowGap }
}

function podiumAt(model, slots, scale, measure) {
  const medal = Math.round(34 * Math.max(scale, 0.7))
  return model.steps.map((step, i) => {
    const slot = slots[i]
    const names = stepNames(step, slot, scale, measure)
    const stepHeight = Math.round(STEP_HEIGHT[step.place] * Math.max(scale, 0.55))
    // The medal's ribbon reaches half a radius above the disc.
    return { step, slot, names, medal, stepHeight, needed: stepHeight + 22 + names.height + 16 + medal * 2.55 }
  })
}

function podiumLayout(model, measure, top, base) {
  const slots = podiumSlots(model.steps, { x: PAD, width: INNER, gap: 18, maxColumnWidth: 300 })
  const room = base - top
  let laid = []
  // A little larger than the base when there is room (a short list), smaller in steps when a big tie needs it.
  for (let scale = MAX_SCALE; scale >= 0.3; scale = Math.round((scale - 0.05) * 100) / 100) {
    laid = podiumAt(model, slots, scale, measure)
    if (laid.every((s) => s.needed <= room)) break
  }
  const tallest = Math.max(...laid.map((s) => s.needed))
  return { tallest, steps: laid.map(({ step, slot, names, medal, stepHeight }) => {
    const stepTop = base - stepHeight
    let y = stepTop - 22 - names.height
    const rowTops = names.rowHeights.map((h) => { const t = y; y += h + names.rowGap; return t })
    const namesTop = rowTops[0] ?? stepTop - 22
    return {
      place: step.place,
      label: step.label,
      x: slot.x,
      width: slot.width,
      stepTop,
      stepHeight,
      medal: { cx: slot.x + slot.width / 2, cy: namesTop - 16 - medal, r: medal },
      nameSize: names.size,
      statSize: names.statSize,
      entries: names.entries.map((e) => ({
        x: e.x, width: e.width, lines: e.lines.map((text, i) => ({ text, y: rowTops[e.row] + names.size * (0.9 + i * LINE) })),
        stat: e.stat, statY: rowTops[e.row] + e.lines.length * names.size * LINE + 8 + names.statSize * 0.9,
      })),
    }
  }) }
}

/**
 * The full layout, top to bottom: header, podium, the list, the summary, and
 * the credit band (always there).
 * @param {ReturnType<typeof posterModel>} model
 * @param {Measure} measure
 */
export function posterLayout(model, measure) {
  const bandTop = POSTER.height - POSTER.bandHeight
  const header = headerLayout(model, measure)
  const summary = { text: model.summary, y: bandTop - 46, size: 28 }
  const podiumTop = header.bottom + 36
  // Podium and list sit as one group between the header and the summary: laid
  // out from the bottom first, then lifted to the middle of any room left over.
  const place = (lift) => {
    const rest = restLayout(model, measure, summary.y - 52 - lift)
    const podiumBase = rest.rows.length || rest.more ? rest.top - 44 : summary.y - 70 - lift
    const podium = model.steps.length ? podiumLayout(model, measure, podiumTop, podiumBase) : { tallest: 0, steps: [] }
    return { rest, podiumBase, podium }
  }
  const first = place(0)
  const spare = first.podiumBase - first.podium.tallest - podiumTop
  const { rest, podiumBase, podium } = model.steps.length && spare > 8 ? place(Math.round(spare / 2)) : first
  const qr = { size: 136, x: W - PAD - 136, y: bandTop + 28 }
  return {
    width: POSTER.width,
    height: POSTER.height,
    header,
    podium: podium.steps,
    podiumBase,
    empty: model.steps.length === 0 ? { text: 'No games were saved in this session.', y: (podiumTop + podiumBase) / 2 } : null,
    rest,
    summary,
    band: {
      top: bandTop,
      logo: { x: PAD, y: bandTop + 46, height: 128 },
      text: { x: PAD + 124, lines: ['Made with Devlab Pickleball', 'Free open play & tournaments', 'devlabstudios.com/pickleball'] },
      qr,
      caption: { text: 'Scan to host yours', x: qr.x + qr.size / 2, y: qr.y + qr.size + 26 },
    },
  }
}

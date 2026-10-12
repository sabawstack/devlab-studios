// src/pickleball-open/results/posterLayout.test.js
import { describe, expect, it } from 'vitest'
import {
  BAND_LINES, POSTER, entryCells, fitText, moreLabel, podiumSlots, posterFilename, posterLayout, posterModel, posterText, restRows, wrapWords,
} from './posterLayout'

// A monospace stand-in for canvas measureText: every character is half the font size wide.
const measure = (text, { size }) => text.length * size * 0.5

const entry = (name, place, wins = 2, losses = 1) => ({ id: name, name, place, wins, losses, winRate: wins / (wins + losses), pointsPct: 0.5 })

function results({ podium, rest = [], kind = 'OPEN_PLAY', name = 'Sunday Open Play' }) {
  return { kind, name, podium, rest, didntPlay: [], players: 9, games: 12, durationMs: 90 * 60_000, expiresAt: '2026-10-20T00:00:00Z', champion: null }
}
const step = (place, names) => ({ place, medal: '', entries: names.map((n) => entry(n, place)) })

describe('wrapWords', () => {
  const width = (t) => measure(t, { size: 10 })
  it('wraps at spaces and keeps every word', () => {
    expect(wrapWords('Ana Maria de la Cruz', 50, width)).toEqual(['Ana Maria', 'de la Cruz'])
  })
  it('breaks a word too wide for the box after its hyphen, never inside a word', () => {
    expect(wrapWords('Maximilian-Alexandrovich', 70, width)).toEqual(['Maximilian-', 'Alexandrovich'])
  })
  it('keeps a single overlong word whole on its own line (the caller shrinks it)', () => {
    expect(wrapWords('Supercalifragilistic', 30, width)).toEqual(['Supercalifragilistic'])
  })
})

describe('fitText', () => {
  it('keeps a short name on one line at full size', () => {
    expect(fitText({ text: 'Ana', maxWidth: 300, maxSize: 40, minSize: 28, measure })).toMatchObject({ size: 40, lines: ['Ana'], fits: true })
  })
  it('shrinks on one line first, down to the minimum', () => {
    // 20 characters: 40px → 400 wide; 30px → 300 fits.
    expect(fitText({ text: 'Bartholomew Jenkinss', maxWidth: 300, maxSize: 40, minSize: 28, measure })).toMatchObject({ size: 30, lines: ['Bartholomew Jenkinss'] })
  })
  it('then wraps to two lines at the largest size that fits', () => {
    const fit = fitText({ text: 'Maximiliano Fernandez Rodriguez', maxWidth: 300, maxSize: 40, minSize: 34, measure })
    expect(fit.lines).toEqual(['Maximiliano', 'Fernandez Rodriguez'])
    expect(fit.size).toBe(31)
    expect(fit.fits).toBe(true)
  })
  it('never truncates: a 40-character name keeps every character', () => {
    const name = 'Maximilian-Alexandrovich Montgomery 01'.padEnd(40, 'x')
    const fit = fitText({ text: name, maxWidth: 280, maxSize: 46, minSize: 33, measure })
    expect(fit.lines.length).toBeLessThanOrEqual(2)
    expect(fit.lines.join(' ').replace(/- /g, '-')).toBe(name)
    for (const line of fit.lines) expect(measure(line, { size: fit.size })).toBeLessThanOrEqual(280)
  })
  it('as a last resort breaks an unbreakable word inside, with a hyphen, so no line is wider than the box', () => {
    const name = 'Wolfeschlegelsteinhausenbergerdorffvoral'
    expect(name).toHaveLength(40)
    const fit = fitText({ text: name, maxWidth: 200, maxSize: 40, minSize: 30, measure })
    expect(fit.lines).toHaveLength(2)
    expect(fit.lines[0].endsWith('-')).toBe(true)
    expect(fit.lines.join('').replace(/-/g, '')).toBe(name)
    for (const line of fit.lines) expect(measure(line, { size: fit.size })).toBeLessThanOrEqual(200)
    expect(fit.fits).toBe(true)
  })
  it('even past the floor, a broken word never overflows its box', () => {
    const fit = fitText({ text: 'x'.repeat(80), maxWidth: 30, maxSize: 20, minSize: 14, measure })
    for (const line of fit.lines) expect(measure(line, { size: fit.size })).toBeLessThanOrEqual(30)
    expect(fit.lines.join('').replace(/-/g, '')).toBe('x'.repeat(80))
  })
  it('respects a height limit (two lines must fit the row)', () => {
    const fit = fitText({ text: 'Maximiliano Fernandez Rodriguez', maxWidth: 300, maxSize: 40, minSize: 34, maxHeight: 52, measure })
    expect(fit.lines.length * fit.size * 1.16).toBeLessThanOrEqual(52.01)
  })
  it('a title can wrap to two lines', () => {
    const fit = fitText({ text: 'The Very Long Wednesday Night Ladder League Open Play Finals', maxWidth: 936, maxSize: 76, minSize: 58, measure })
    expect(fit.lines).toHaveLength(2)
    expect(fit.fits).toBe(true)
  })
})

describe('restRows and moreLabel', () => {
  const rest = Array.from({ length: 12 }, (_, i) => entry(`P${i}`, i + 4))
  it('lists places 4–10 and counts the rest', () => {
    const { shown, more } = restRows(rest)
    expect(shown.map((e) => e.place)).toEqual([4, 5, 6, 7, 8, 9, 10])
    expect(more).toBe(5)
    expect(moreLabel(more)).toBe('+5 more players')
  })
  it('stops at place 10 even when a tie for 3rd pushes the list down', () => {
    const tied = [5, 6, 7, 8, 9, 10, 11].map((place) => entry(`Q${place}`, place))
    expect(restRows(tied)).toEqual({ shown: tied.slice(0, 6), more: 1 })
  })
  it('never shows more than seven rows, even in a big tie', () => {
    const tie = Array.from({ length: 9 }, (_, i) => entry(`T${i}`, 4))
    expect(restRows(tie)).toMatchObject({ more: 2 })
  })
  it('says nothing when nobody is left out, and counts pairs in a tournament', () => {
    expect(moreLabel(0)).toBeNull()
    expect(moreLabel(1, 'pair')).toBe('+1 more pair')
  })
})

describe('podiumSlots', () => {
  const box = { x: 72, width: 936, gap: 18, maxColumnWidth: 300 }
  it('three single steps share the width equally, centred', () => {
    const slots = podiumSlots([step(2, ['B']), step(1, ['A']), step(3, ['C'])], box)
    expect(slots.map((s) => s.width)).toEqual([300, 300, 300])
    expect(slots[0].x - 72).toBeCloseTo(72 + 936 - (slots[2].x + 300))
  })
  it('a shared 1st (1, 1, 3) is one wide step with both names side by side', () => {
    const slots = podiumSlots([step(1, ['A', 'B']), step(3, ['C'])], box)
    expect(slots.map((s) => [s.place, s.columns, s.rows])).toEqual([[1, 2, 1], [3, 1, 1]])
    expect(slots[0].width).toBe(slots[1].width * 2)
  })
  it('four tied for 3rd stand two by two; five or more three across', () => {
    const four = podiumSlots([step(2, ['B']), step(1, ['A']), step(3, ['C', 'D', 'E', 'F'])], box)
    expect(four[2]).toMatchObject({ columns: 2, rows: 2 })
    const five = podiumSlots([step(1, ['A', 'B', 'C', 'D', 'E'])], box)
    expect(five[0]).toMatchObject({ columns: 3, rows: 2 })
    // Never wider than the poster.
    const sum = (slots) => slots.reduce((total, s) => total + s.width, 0) + 18 * (slots.length - 1)
    expect(sum(four)).toBeLessThanOrEqual(936)
  })
  it('a short last row is centred under the full one', () => {
    const cells = entryCells(5, { x: 0, width: 600, columns: 3, gap: 0 })
    expect(cells.map((c) => [c.x, c.row])).toEqual([[0, 0], [200, 0], [400, 0], [100, 1], [300, 1]])
  })
})

describe('posterModel', () => {
  it('builds the words: title, date, host, podium in 2·1·3 order, the list, +N more and the summary', () => {
    const rest = Array.from({ length: 9 }, (_, i) => entry(`P${i}`, i + 4, 1, 1))
    const model = posterModel(results({ podium: [step(1, ['Ana']), step(2, ['Ben']), step(3, ['Cy'])], rest }), { hostName: ' Coach Mike ', dateText: 'Oct 13, 2026' })
    expect(model.subtitle).toBe('Final standings · Oct 13, 2026')
    expect(model.host).toBe('Hosted by Coach Mike')
    expect(model.steps.map((s) => s.place)).toEqual([2, 1, 3])
    expect(model.steps[1].entries[0]).toEqual({ name: 'Ana', stat: '2–1 · 67%' })
    expect(model.rest.map((r) => r.place)).toEqual(['4', '5', '6', '7', '8', '9', '10'])
    expect(model.more).toBe('+2 more players')
    expect(model.summary).toBe('9 players · 12 games · 1 h 30 min')
  })
  it('tournaments list pairs', () => {
    const model = posterModel(results({ kind: 'TOURNAMENT', podium: [step(1, ['Ana & Ben'])], rest: Array.from({ length: 8 }, (_, i) => entry(`X & Y${i}`, i + 2)) }), { hostName: 'Mike', dateText: 'today' })
    expect(model.steps[0].entries[0].name).toBe('Ana & Ben')
    expect(model.more).toBe('+1 more pair')
  })
})

describe('posterFilename', () => {
  it('slugs the session name', () => {
    expect(posterFilename('Sunday Open Play!')).toBe('sunday-open-play-results.png')
    expect(posterFilename('  ¡¡ ')).toBe('session-results.png')
  })
})

describe('posterLayout', () => {
  const inside = (layout) => {
    for (const s of layout.podium) {
      expect(s.x).toBeGreaterThanOrEqual(POSTER.pad - 0.01)
      expect(s.x + s.width).toBeLessThanOrEqual(POSTER.width - POSTER.pad + 0.01)
      // The medal and its ribbon stay below the header.
      expect(s.medal.cy - s.medal.r * 1.55).toBeGreaterThanOrEqual(layout.header.bottom)
    }
  }
  it('stacks header, podium, list and summary above the credit band without overlap', () => {
    const rest = Array.from({ length: 12 }, (_, i) => entry(`Player Number ${i}`, i + 4))
    const layout = posterLayout(posterModel(results({ podium: [step(1, ['Ana']), step(2, ['Ben']), step(3, ['Cy'])], rest }), { hostName: 'Coach Mike', dateText: 'Oct 13, 2026' }), measure)
    inside(layout)
    expect(layout.podiumBase).toBeLessThan(layout.rest.top)
    expect(layout.rest.rows).toHaveLength(7)
    expect(layout.rest.more.text).toBe('+5 more players')
    expect(layout.rest.more.y).toBeLessThan(layout.summary.y)
    expect(layout.summary.y).toBeLessThan(layout.band.top)
    expect(layout.band.top).toBe(POSTER.height - POSTER.bandHeight)
    expect(layout.band.text.lines).toEqual(['Made with Devlab Pickleball', 'Free open play & tournaments', 'devlabstudios.com/pickleball'])
  })
  it('a 1,1,3 tie puts both names in one row on the wide gold step', () => {
    const layout = posterLayout(posterModel(results({ podium: [step(1, ['Ana', 'Ben']), step(3, ['Cy'])] }), { hostName: 'M', dateText: 'd' }), measure)
    const gold = layout.podium.find((s) => s.place === 1)
    expect(gold.entries).toHaveLength(2)
    expect(gold.entries[0].lines[0].y).toBe(gold.entries[1].lines[0].y)
    expect(gold.entries[1].x).toBeGreaterThan(gold.entries[0].x + gold.entries[0].width - 1)
    inside(layout)
  })
  it('a short poster centres the podium in the room left, instead of leaving a hole under the header', () => {
    const layout = posterLayout(posterModel(results({ podium: [step(1, ['Ana', 'Ben']), step(3, ['Cy'])] }), { hostName: 'M', dateText: 'd' }), measure)
    const top = Math.min(...layout.podium.map((s) => s.medal.cy - s.medal.r * 1.55)) - (layout.header.bottom + 36)
    const bottom = layout.summary.y - 70 - layout.podiumBase
    expect(top).toBeGreaterThan(8)
    expect(Math.abs(top - bottom)).toBeLessThanOrEqual(2)
  })
  it('40-character names and a two-line title still fit: everything shrinks, nothing is cut', () => {
    const long = (i) => `Maximilian-Alexandrovich Montgomery ${i}`.padEnd(40, 'z')
    const podium = [step(1, [long(1), long(2)]), step(3, [long(3), long(4), long(5), long(6)])]
    const rest = Array.from({ length: 9 }, (_, i) => entry(long(i + 10), i + 7))
    const model = posterModel(results({ podium, rest, name: 'The Very Long Wednesday Night Ladder League Open Play Finals' }), { hostName: 'A'.repeat(40), dateText: 'Oct 13, 2026' })
    const layout = posterLayout(model, measure)
    inside(layout)
    expect(layout.header.title.lines).toHaveLength(2)
    for (const s of layout.podium) {
      for (const e of s.entries) {
        expect(e.lines.length).toBeLessThanOrEqual(2)
        for (const line of e.lines) expect(measure(line.text, { size: s.nameSize })).toBeLessThanOrEqual(e.width)
      }
    }
    for (const row of layout.rest.rows) expect(row.name.lines.length).toBeLessThanOrEqual(2)
  })
  it('a 40-character name with no spaces in a three-across tie stays inside its cell', () => {
    const word = (i) => `Wolfeschlegelsteinhausenbergerdorffvora${i}`
    const podium = [step(1, [word(1), word(2), word(3), word(4), word(5)]), step(2, [word(6)]), step(3, [word(7)])]
    // A wide measure (0.62 em per character), closer to a real bold font.
    const wide = (text, { size }) => text.length * size * 0.62
    const layout = posterLayout(posterModel(results({ podium }), { hostName: 'M', dateText: 'd' }), wide)
    const gold = layout.podium.find((s) => s.place === 1)
    expect(gold.entries).toHaveLength(5)
    for (const s of layout.podium) {
      for (const e of s.entries) {
        expect(e.lines.length).toBeLessThanOrEqual(2)
        for (const line of e.lines) expect(wide(line.text, { size: s.nameSize })).toBeLessThanOrEqual(e.width)
      }
    }
  })
  it('posterText gathers every string drawn, so the font subsets for any name load', () => {
    const model = posterModel(results({ podium: [step(1, ['Łukasz Wiśniewski'])], rest: [entry('ВасилийПетровичСидоров', 4)] }), { hostName: 'Nguyễn Văn An', dateText: 'Oct 13, 2026' })
    const text = posterText(model)
    for (const part of ['Sunday Open Play', 'Łukasz Wiśniewski', 'ВасилийПетровичСидоров', 'Hosted by Nguyễn Văn An', ...BAND_LINES, '2–1 · 67%']) expect(text).toContain(part)
  })
  it('with no games it says so instead of drawing a podium', () => {
    const layout = posterLayout(posterModel(results({ podium: [] }), { hostName: 'M', dateText: 'd' }), measure)
    expect(layout.podium).toEqual([])
    expect(layout.empty.text).toBe('No games were saved in this session.')
  })
})

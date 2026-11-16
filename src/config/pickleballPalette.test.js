// The Pickleball palette is the one source of the app's colours: the CSS layers
// (which cannot import JS) must resolve to the same values, the surfaces and
// inks must be the brand's graphite tokens, and Tailwind must read the module.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PB } from './pickleballPalette'
import tailwind from '../../tailwind.config.js'

const strip = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '')
const block = (css, selector) => {
  const start = css.indexOf(`${selector} {`)
  if (start < 0) throw new Error(`${selector} missing`)
  const body = strip(css.slice(start, css.indexOf('}', start)))
  return new Map([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]))
}

const tokens = block(readFileSync('src/styles/brand-tokens.css', 'utf8'), ':root')
const app = block(readFileSync('src/styles/pickleball-app.css', 'utf8'), '.pb-app')
const resolve = (value) => {
  const ref = /^var\((--[\w-]+)\)$/.exec(value)
  if (!ref) return value.toLowerCase()
  return resolve(app.get(ref[1]) ?? tokens.get(ref[1]))
}

describe('Pickleball palette', () => {
  it.each([
    ['canvas', 'canvas'], ['sunken', 'sunken'], ['surface', 'surface'], ['raised', 'raised'], ['rule', 'rule'], ['field', 'field'],
    ['ink', 'ink'], ['ink-2', 'ink2'], ['play', 'play'], ['team-b', 'teamB'], ['action', 'action'], ['action-hover', 'actionHover'],
  ])('--pb-%s in the app layer equals PB.%s', (cssName, key) => {
    expect(resolve(app.get(`--pb-${cssName}`))).toBe(PB[key])
  })

  it('surfaces and inks are the brand graphite tokens', () => {
    expect(PB.canvas).toBe(tokens.get('--exhibit-paper'))
    expect(PB.surface).toBe(tokens.get('--exhibit-paper-2'))
    expect(PB.ink).toBe(tokens.get('--exhibit-ink'))
    expect(PB.ink2).toBe(tokens.get('--exhibit-ink-2'))
    expect(PB.action).toBe(tokens.get('--link'))
  })

  it('the public band uses the same surface and focus colour', () => {
    const css = strip(readFileSync('src/styles/pickleball-open.css', 'utf8'))
    expect(css).toMatch(/\.pb-marketing\s*\{[^}]*background:\s*var\(--exhibit-paper\)/)
    expect(css).toContain(`outline: 2px solid ${PB.play}`)
  })

  it('Tailwind pb-* utilities read the module, and the old navy, lime and mist names are gone', () => {
    const colors = tailwind.theme.extend.colors
    expect(colors.pb.play).toBe(PB.play)
    expect(colors.pb['team-b']).toBe(PB.teamB)
    expect(colors.pb.canvas).toBe(PB.canvas)
    for (const old of ['navy', 'ink', 'mist', 'pickle']) expect(colors[old]).toBeUndefined()
  })

  it('the app shell paints the browser chrome in the canvas colour', () => {
    expect(readFileSync('src/layouts/PickleballAppShell.astro', 'utf8')).toContain(`<meta name="theme-color" content="${PB.canvas}" />`)
  })
})

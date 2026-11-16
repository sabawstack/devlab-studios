// BRAND-06: the product themes (ADR 0016) stay on the shared brand tokens.
// Pins the Admin and Pickleball semantic layers, checks their contrast
// against the real token values, and ratchets the raw colours still left in
// the two apps so the count can only go down.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import ratchet from './themeRatchet.json'

const tokens = readFileSync('src/styles/brand-tokens.css', 'utf8')
const admin = readFileSync('src/styles/admin.css', 'utf8')
const pickleball = readFileSync('src/styles/pickleball-app.css', 'utf8')
const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '')

function declarations(css: string, selector: string): Map<string, string> {
  const start = css.indexOf(`${selector} {`)
  if (start < 0) throw new Error(`${selector} missing`)
  const body = stripComments(css.slice(start, css.indexOf('}', start)))
  return new Map([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]))
}

const rootTokens = declarations(tokens, ':root')

/** Follows var() references through a layer and the brand tokens to a hex value. */
function resolve(value: string, layer: Map<string, string>): string {
  const ref = /^var\((--[\w-]+)\)$/.exec(value)
  if (!ref) return value.toLowerCase()
  const next = layer.get(ref[1]) ?? rootTokens.get(ref[1])
  if (!next) throw new Error(`${ref[1]} is not defined`)
  return resolve(next, layer)
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (l1 + 0.05) / (l2 + 0.05)
}

describe('Admin semantic layer (BRAND-02)', () => {
  const layer = declarations(admin, '.admin-page')
  const color = (name: string) => resolve(layer.get(`--ws-${name}`) ?? '', layer)

  it.each([
    ['canvas', 'var(--paper)'], ['surface', 'var(--paper-2)'], ['ink', 'var(--ink)'], ['ink-2', 'var(--ink-2)'], ['ink-3', 'var(--ink-3)'],
    ['rule', 'var(--rule)'], ['action', 'var(--link)'], ['link', 'var(--link)'], ['selected', 'var(--selected)'], ['focus', 'var(--focus-ring)'],
    ['ok', 'var(--ok)'], ['warning', 'var(--amber)'], ['danger', 'var(--danger)'], ['info', 'var(--link)'],
    ['sidebar', 'var(--exhibit-paper)'], ['sidebar-ink', 'var(--exhibit-ink)'], ['sidebar-ink-2', 'var(--exhibit-ink-2)'],
    ['sidebar-rule', 'var(--exhibit-rule)'], ['sidebar-selected', 'var(--exhibit-rule)'],
  ])('--ws-%s maps to %s', (name, value) => expect(layer.get(`--ws-${name}`)).toBe(value))

  it('is scoped to .admin-page and imports the shared tokens', () => {
    expect(admin).toMatch(/@import '\.\/brand-tokens\.css';/)
    expect(stripComments(admin)).not.toMatch(/:root\s*\{/)
  })

  it('body text, captions and actions hold WCAG AA', () => {
    expect(contrast(color('ink'), color('canvas'))).toBeGreaterThanOrEqual(12)
    expect(contrast(color('ink-2'), color('surface'))).toBeGreaterThanOrEqual(7)
    expect(contrast(color('ink-3'), color('surface'))).toBeGreaterThanOrEqual(4.5)
    expect(contrast(color('ink-3'), color('canvas'))).toBeGreaterThanOrEqual(4.5)
    expect(contrast(color('action-ink'), color('action'))).toBeGreaterThanOrEqual(4.5)
    expect(contrast(color('action-ink'), color('action-hover'))).toBeGreaterThanOrEqual(4.5)
    expect(contrast(color('link'), color('surface'))).toBeGreaterThanOrEqual(4.5)
    expect(contrast(color('link'), color('selected'))).toBeGreaterThanOrEqual(4.5)
  })

  it('the graphite sidebar holds WCAG AA, including the current item', () => {
    expect(contrast(color('sidebar-ink'), color('sidebar'))).toBeGreaterThanOrEqual(12)
    expect(contrast(color('sidebar-ink-2'), color('sidebar'))).toBeGreaterThanOrEqual(7)
    expect(contrast(color('sidebar-ink'), color('sidebar-selected'))).toBeGreaterThanOrEqual(4.5)
    expect(contrast(color('sidebar-ink-2'), color('sidebar-selected'))).toBeGreaterThanOrEqual(4.5)
  })

  it('status colours hold 4.5:1 on white surfaces, and the focus ring 3:1 on the canvas', () => {
    for (const status of ['ok', 'warning', 'danger', 'info']) expect(contrast(color(status), color('surface')), status).toBeGreaterThanOrEqual(4.5)
    expect(contrast(color('focus'), color('canvas'))).toBeGreaterThanOrEqual(3)
  })

  it('the current nav item uses the selected token, never a gradient', () => {
    const active = /\.admin-nav-link--active[^{]*\{([^}]*)\}/.exec(stripComments(admin))?.[1] ?? ''
    expect(active).toMatch(/background:\s*var\(--ws-sidebar-selected\)/)
  })
})

describe('Pickleball app layer (BRAND-03)', () => {
  const layer = declarations(pickleball, '.pb-app')
  const color = (name: string) => resolve(layer.get(`--pb-${name}`) ?? '', layer)

  it.each([
    ['action', 'var(--link)'], ['focus', 'var(--pb-play)'], ['radius', 'var(--radius-m)'],
  ])('--pb-%s maps to %s', (name, value) => expect(layer.get(`--pb-${name}`)).toBe(value))

  it('sits on the brand graphite surface and inks', () => {
    for (const [name, token] of [['canvas', '--exhibit-paper'], ['surface', '--exhibit-paper-2'], ['ink', '--exhibit-ink'], ['ink-2', '--exhibit-ink-2']]) {
      expect(layer.get(`--pb-${name}`)).toBe(`var(${token})`)
    }
  })

  it('has no navy, lime or legacy brand blue left', () => {
    const text = stripComments(pickleball).toLowerCase()
    for (const old of ['#0b1426', '#11214d', '#c6ff2e', '#8d9bff', '#b5c4e1', '#4500ff']) expect(text).not.toContain(old)
  })

  it('uses the brand type face and imports the shared tokens', () => {
    expect(pickleball).toMatch(/@import '\.\/brand-tokens\.css';/)
    expect(stripComments(pickleball)).toMatch(/\.pb-app\s*\{[^}]*font-family:\s*var\(--font-display\)/)
  })

  it('holds WCAG AA: actions, secondary text, and a visible focus ring', () => {
    expect(contrast(color('action-ink'), color('action'))).toBeGreaterThanOrEqual(4.5)
    expect(contrast(color('action-ink'), color('action-hover'))).toBeGreaterThanOrEqual(4.5)
    expect(contrast(color('ink'), color('canvas'))).toBeGreaterThanOrEqual(12)
    expect(contrast(color('ink-2'), color('canvas'))).toBeGreaterThanOrEqual(4.5)
    expect(contrast(color('ink-2'), color('surface'))).toBeGreaterThanOrEqual(4.5)
    expect(contrast(color('focus'), color('canvas'))).toBeGreaterThanOrEqual(3)
    expect(contrast(color('focus'), color('surface'))).toBeGreaterThanOrEqual(3)
    for (const bg of ['canvas', 'sunken', 'surface', 'raised']) {
      expect(contrast(color('ink-2'), color(bg)), `ink-2 on ${bg}`).toBeGreaterThanOrEqual(4.5)
      expect(contrast(color('play'), color(bg)), `play on ${bg}`).toBeGreaterThanOrEqual(4.5)
      expect(contrast(color('team-b'), color(bg)), `team-b on ${bg}`).toBeGreaterThanOrEqual(4.5)
      expect(contrast(color('field'), color(bg)), `field border on ${bg}`).toBeGreaterThanOrEqual(3)
    }
    // Text on a play fill (the selected choice, "you're on") is the canvas colour.
    expect(contrast(color('canvas'), color('play'))).toBeGreaterThanOrEqual(7)
  })

  it('tells the two teams apart by lightness, not hue alone', () => {
    expect(contrast(color('play'), color('team-b'))).toBeGreaterThanOrEqual(1.5)
  })
})

describe('product layers stay quiet', () => {
  it.each([['admin.css', admin], ['pickleball-app.css', pickleball]])('%s has no gradient, blur or backdrop', (_, css) => {
    const text = stripComments(css)
    expect(text).not.toMatch(/gradient\(|--brand-gradient|backdrop-filter|blur\(/)
  })
})

// The ratchet: raw hex colours and legacy colour utilities left in the two
// apps. Pages move to the semantic tokens as they adopt the primitives; the
// count may only go down. When it goes down, lower themeRatchet.json to the
// new count in the same commit so it cannot creep back up.
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(jsx?|tsx?)$/.test(name) && !/\.test\./.test(name) ? [path] : []
  })
}

const HEX = /#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![\w-])/g
const LEGACY = /\b(?:bg|text|border|ring|from|via|to|outline|hover:bg|hover:text)-brand(?:-(?:teal|orange|orangeDark|ink|mint|shell))?\b|var\(--brand-(?:blue|indigo|violet|purple|magenta|cyan)\)/g

function count(dir: string, pattern: RegExp): number {
  return sourceFiles(dir).reduce((sum, path) => sum + (readFileSync(path, 'utf8').match(pattern)?.length ?? 0), 0)
}

describe('raw colour ratchet (BRAND-06)', () => {
  it.each([
    ['src/admin-app', 'adminHex', HEX], ['src/admin-app', 'adminLegacy', LEGACY],
    ['src/pickleball-open', 'pickleballHex', HEX], ['src/pickleball-open', 'pickleballLegacy', LEGACY],
  ] as const)('%s: %s stays at its recorded count', (dir, key, pattern) => {
    const now = count(dir, pattern)
    expect(now, `${key} grew: use the semantic tokens instead of a raw colour`).toBeLessThanOrEqual(ratchet[key])
    expect(now, `${key} went down to ${now}: lower themeRatchet.json so it stays down`).toBe(ratchet[key])
  })
})

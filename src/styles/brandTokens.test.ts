import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync('src/styles/brand.css', 'utf8')

function block(selector: string): string {
  const start = css.indexOf(`${selector} {`)
  return css.slice(start, css.indexOf('}', start))
}

function token(scope: string, name: string): string {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(block(scope))
  if (!match) throw new Error(`--${name} missing in ${scope}`)
  return match[1]
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

// BR.10 contrast requirements, on paper and on the inverted ink panel.
describe.each([':root', '.ink-panel'])('colour contrast in %s', (scope) => {
  const paper = token(scope, 'paper')
  it('body text (ink) is at least 7:1', () => expect(contrast(token(scope, 'ink'), paper)).toBeGreaterThanOrEqual(7))
  it('secondary text (ink-2) is at least 4.5:1', () => expect(contrast(token(scope, 'ink-2'), paper)).toBeGreaterThanOrEqual(4.5))
  it('captions (ink-3) are at least 4.5:1', () => expect(contrast(token(scope, 'ink-3'), paper)).toBeGreaterThanOrEqual(4.5))
  it('the redline focus ring is at least 3:1', () => expect(contrast(token(scope, 'redline'), paper)).toBeGreaterThanOrEqual(3))
  it('ink-3 also holds 4.5:1 on paper-2 surfaces', () => expect(contrast(token(scope, 'ink-3'), token(scope, 'paper-2'))).toBeGreaterThanOrEqual(4.5))
})

// TEST-03: the generic "AI template" patterns never enter the brand system.
// Extends to every public component as pages migrate (UX-04).
const FORBIDDEN = [/backdrop-filter/, /linear-gradient/, /radial-gradient/, /blur\(/, /animation:\s*float/, /\brounded-(?:2xl|3xl)\b/, /fonts\.googleapis\.com/, /bg-gradient-to-/, /backdrop-blur/]
const BRAND_SOURCES = ['src/styles/brand.css', 'src/components/brand', 'src/assets/scenes', 'src/assets/symbols']

function files(path: string): string[] {
  if (!existsSync(path)) return []
  if (statSync(path).isFile()) return [path]
  return readdirSync(path).flatMap((name) => files(join(path, name)))
}

describe('brand sources stay free of generic visual patterns (TEST-03)', () => {
  const sources = BRAND_SOURCES.flatMap(files).filter((path) => !/\.test\./.test(path))

  it('finds the brand sources', () => expect(sources.length).toBeGreaterThan(0))

  it.each(sources)('%s', (path) => {
    const text = readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    for (const pattern of FORBIDDEN) expect(text, String(pattern)).not.toMatch(pattern)
  })
})

describe('fonts (UX-01)', () => {
  it('self-hosts every face with its licence, within the 120 KB business-page budget', () => {
    const size = (file: string) => statSync(join('public/fonts', file)).size
    expect(size('bricolage-grotesque-latin-opsz.woff2') + size('martian-mono-latin-wght.woff2')).toBeLessThanOrEqual(120 * 1024)
    for (const licence of ['OFL-bricolage-grotesque.txt', 'OFL-martian-mono.txt', 'OFL-newsreader.txt']) {
      expect(readFileSync(join('public/fonts', licence), 'utf8')).toMatch(/SIL Open Font License/)
    }
  })

  it('declares metric-matched fallbacks for each face', () => {
    for (const family of ['Bricolage Fallback', 'Martian Fallback', 'Newsreader Fallback']) {
      expect(css).toMatch(new RegExp(`font-family: '${family}';[^}]*size-adjust:[^}]*ascent-override`))
    }
  })
})

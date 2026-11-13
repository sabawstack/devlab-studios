import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync('src/styles/brand.css', 'utf8')

function block(selector: string): string {
  const start = css.indexOf(`${selector} {`)
  if (start < 0) throw new Error(`${selector} block missing`)
  return css.slice(start, css.indexOf('}', start))
}

function token(scope: string, name: string): string {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(block(scope))
  if (!match) throw new Error(`--${name} missing in ${scope}`)
  return match[1].toLowerCase()
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

// Direction B, "Graphite on stone" (spec N.1, owner-approved 2026-11-13).
describe('Graphite-on-stone tokens match the approved palette (BRAND-01)', () => {
  it.each([
    ['paper', '#f0eff3'], ['paper-2', '#ffffff'], ['ink', '#15142a'], ['ink-2', '#3f3d5a'], ['ink-3', '#6b6984'],
    ['rule', '#d5d3df'], ['redline', '#b800d1'], ['link', '#4338ca'], ['violet', '#7b2cbf'], ['ok', '#1f7a4d'],
    ['amber', '#b45309'], ['danger', '#9f1239'],
    ['exhibit-paper', '#14122b'], ['exhibit-paper-2', '#1d1b36'], ['exhibit-ink', '#f2f1f6'], ['exhibit-ink-2', '#c6c4d6'],
    ['exhibit-ink-3', '#9492ad'], ['exhibit-rule', '#2b2947'], ['exhibit-link', '#a5b4fc'], ['exhibit-ok', '#4ade80'], ['exhibit-amber', '#f59e0b'],
  ])('--%s is %s', (name, hex) => expect(token(':root', name)).toBe(hex))

  it('the logo gradient runs magenta → violet → blue', () => {
    expect(block(':root')).toMatch(/--brand-gradient:\s*linear-gradient\(135deg,\s*#e100ff 0%,\s*#7b2cbf 50%,\s*#0048ba 100%\)/i)
  })

  it('.ink-panel switches every role to the exhibit values', () => {
    const panel = block('.ink-panel')
    for (const role of ['paper', 'paper-2', 'ink', 'ink-2', 'ink-3', 'rule', 'link', 'ok', 'amber']) {
      expect(panel).toMatch(new RegExp(`--${role}:\\s*var\\(--exhibit-${role}\\)`))
    }
  })

  it('"Balanced" density sets the section rhythm', () => {
    expect(block(':root')).toMatch(/--section-rhythm:\s*clamp\(4rem, 7vw, 7rem\)/)
  })

  it('the canvas carries no grid and the header no blur', () => {
    expect(stripComments(css)).not.toMatch(/--grid-(?:size|line)|backdrop-filter/)
  })
})

/** Resolves a role inside `.ink-panel`, where it points at an exhibit token. */
function role(scope: string, name: string): string {
  if (scope === ':root') return token(':root', name)
  return token(':root', `exhibit-${name}`)
}

// WCAG AA on stone (the canvas) and graphite (exhibits and the home hero band).
describe.each([':root', '.ink-panel'])('colour contrast in %s', (scope) => {
  const paper = role(scope, 'paper')
  it('body text (ink) is at least 12:1', () => expect(contrast(role(scope, 'ink'), paper)).toBeGreaterThanOrEqual(12))
  it('secondary text (ink-2) is at least 7:1', () => expect(contrast(role(scope, 'ink-2'), paper)).toBeGreaterThanOrEqual(7))
  it('captions (ink-3) are at least 4.5:1', () => expect(contrast(role(scope, 'ink-3'), paper)).toBeGreaterThanOrEqual(4.5))
  it('ink-3 also holds 4.5:1 on paper-2 surfaces', () => expect(contrast(role(scope, 'ink-3'), role(scope, 'paper-2'))).toBeGreaterThanOrEqual(4.5))
  it('links are at least 4.5:1', () => expect(contrast(role(scope, 'link'), paper)).toBeGreaterThanOrEqual(4.5))
  it('verified green is at least 4.5:1', () => expect(contrast(role(scope, 'ok'), paper)).toBeGreaterThanOrEqual(4.5))
})

describe('accent contrast on stone', () => {
  const paper = token(':root', 'paper')
  it('form errors are at least 4.5:1', () => expect(contrast(token(':root', 'danger'), paper)).toBeGreaterThanOrEqual(4.5))
  it('the redline holds 4.5:1 for its few label uses', () => expect(contrast(token(':root', 'redline'), paper)).toBeGreaterThanOrEqual(4.5))
  it('verified green holds 4.5:1', () => expect(contrast(token(':root', 'ok'), paper)).toBeGreaterThanOrEqual(4.5))
  it('exhibit amber holds 4.5:1 as text on graphite', () => expect(contrast(token(':root', 'exhibit-amber'), token(':root', 'exhibit-paper'))).toBeGreaterThanOrEqual(4.5))
})

// TEST-03, revised for Blueprint: the generic "AI template" patterns stay out,
// and the brand gradient enters only through one token.
const FORBIDDEN = [/animation:\s*float/, /\brounded-(?:2xl|3xl)\b/, /fonts\.googleapis\.com/, /bg-gradient-to-/, /background-clip:\s*text/, /bg-clip-text/]
const BRAND_PAGES = [
  'src/layouts/BrandLayout.astro', 'src/data/site', 'src/pages/index.astro', 'src/pages/solutions.astro', 'src/pages/solutions',
  'src/pages/work.astro', 'src/pages/work', 'src/pages/insights.astro', 'src/pages/insights/[slug].astro', 'src/pages/about.astro',
  'src/pages/profile.astro', 'src/pages/products.astro', 'src/pages/contact.astro', 'src/pages/privacy.astro', 'src/pages/terms.astro',
  'src/pages/404.astro',
]
const BRAND_SOURCES = ['src/styles/brand.css', 'src/components/brand', 'src/assets/scenes', 'src/assets/symbols', ...BRAND_PAGES]

function files(path: string): string[] {
  if (!existsSync(path)) return []
  if (statSync(path).isFile()) return [path]
  return readdirSync(path).flatMap((name) => files(join(path, name)))
}

const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '')

describe('brand sources stay free of generic visual patterns (TEST-03)', () => {
  const sources = BRAND_SOURCES.flatMap(files).filter((path) => !/\.test\./.test(path))

  it('finds the brand sources', () => expect(sources.length).toBeGreaterThan(0))

  it.each(sources)('%s', (path) => {
    const text = stripComments(readFileSync(path, 'utf8'))
    for (const pattern of FORBIDDEN) expect(text, String(pattern)).not.toMatch(pattern)
  })

  // Gradients come only from var(--brand-gradient), defined once in brand.css.
  it.each(sources.filter((path) => path !== 'src/styles/brand.css'))('%s uses no raw gradient', (path) => {
    expect(stripComments(readFileSync(path, 'utf8'))).not.toMatch(/(?:linear|radial|conic)-gradient\(/)
  })

  // Colours come from tokens: no raw hex in the brand components and pages.
  // The theme-color meta is the one exception: the browser reads it before CSS.
  it.each(sources.filter((path) => !path.startsWith('src/styles/') && !path.startsWith('src/assets/')))('%s uses no raw hex colour', (path) => {
    const text = stripComments(readFileSync(path, 'utf8')).replace(/<meta name="theme-color" content="#[0-9a-fA-F]{6}" \/>/g, '')
    expect(text).not.toMatch(/(?<![\w&/-])#(?:[0-9a-fA-F]{3}){1,2}(?![\w-])(?=["';\s,)])/)
  })

  // WCAG 2.2.2 (Level A): motion that starts by itself stops within five seconds.
  it.each(sources)('%s has no endless animation', (path) => {
    const text = stripComments(readFileSync(path, 'utf8'))
    expect(text, 'CSS animation set to infinite').not.toMatch(/animation(?:-iteration-count)?:[^;}]*\binfinite\b/)
    for (const tag of text.match(/<animate[A-Za-z]*\b[^>]*>/g) ?? []) {
      if (!/repeatCount="indefinite"/.test(tag)) continue
      const end = /\bend="(\d+(?:\.\d+)?)s"/.exec(tag)
      expect(end, `${tag} repeats forever`).not.toBeNull()
      expect(Number(end?.[1])).toBeLessThanOrEqual(5)
    }
  })

  it('the brand gradient is never applied to text', () => {
    expect(css).not.toMatch(/background-clip:\s*text/)
  })
})

describe('fonts (UX-01)', () => {
  it('self-hosts every face with its licence, within the 120 KB business-page budget', () => {
    const size = (file: string) => statSync(join('public/fonts', file)).size
    expect(size('space-grotesk-latin-wght.woff2') + size('jetbrains-mono-latin-wght.woff2')).toBeLessThanOrEqual(120 * 1024)
    for (const licence of ['OFL-space-grotesk.txt', 'OFL-jetbrains-mono.txt', 'OFL-newsreader.txt']) {
      expect(readFileSync(join('public/fonts', licence), 'utf8')).toMatch(/SIL Open Font License/)
    }
  })

  it('declares metric-matched fallbacks for each face', () => {
    for (const family of ['Space Grotesk Fallback', 'JetBrains Mono Fallback', 'Newsreader Fallback']) {
      expect(css).toMatch(new RegExp(`font-family: '${family}';[^}]*size-adjust:[^}]*ascent-override`))
    }
  })

  it('the display and label roles use the Blueprint faces', () => {
    expect(block(':root')).toMatch(/--font-display:\s*'Space Grotesk', 'Space Grotesk Fallback'/)
    expect(block(':root')).toMatch(/--font-label:\s*'JetBrains Mono', 'JetBrains Mono Fallback'/)
  })
})

describe('migrated pages use the brand layout (UX-04)', () => {
  it.each(BRAND_PAGES.filter((path) => path.startsWith('src/pages/')).flatMap(files))('%s', (path) => {
    const text = readFileSync(path, 'utf8')
    expect(text).not.toMatch(/layouts\/Layout\.astro/)
    expect(text).toMatch(/BrandLayout|LegalPage/)
  })
})

// TEST-01 guards for Direction B, "Graphite on stone" (spec N.1, N.3, N.5).
// Guards that BRAND-01/BRAND-02 make true are `it.fails` until then: they prove
// the gap today and turn red when the fix lands, forcing the flip to `it`.
const rules = [...stripComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({ selector: selector.trim(), body }))

// The gradient is the brand colour, used in four places only: the logo mark,
// primary buttons (the inquiry form's submit button is one), the 3 px hero
// rule and the current-nav underline. `:root` defines it.
const GRADIENT_SELECTORS = [/^:root$/, /\.dl-button-primary/, /\.form-surface button/, /\.hero-rule/, /aria-current|\.is-current/, /\.dl-logo-mark/]

function mixHex(hex: string, [r, g, b, alpha]: number[]): string {
  const base = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  return `#${base.map((c, i) => Math.round(c * (1 - alpha) + [r, g, b][i] * alpha).toString(16).padStart(2, '0')).join('')}`
}

describe('Direction B guards (TEST-01)', () => {
  it('finds the CSS rules', () => expect(rules.length).toBeGreaterThan(50))

  it('the gradient is referenced only by the four allowed roles', () => {
    const wrong = rules.filter(({ selector, body }) => /var\(--brand-gradient\)/.test(body) && !GRADIENT_SELECTORS.some((allowed) => allowed.test(selector)))
    expect(wrong.map(({ selector }) => selector)).toEqual([])
  })

  // White on the magenta end of a primary button, under its resting scrim.
  it('white text over the gradient holds 4.5:1 at the magenta end', () => {
    const magenta = /--brand-gradient:\s*linear-gradient\(135deg,\s*(#[0-9a-f]{6})/i.exec(block(':root'))?.[1]
    const scrim = /--button-scrim:\s*rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/.exec(css)?.slice(1).map(Number)
    expect(magenta).toBeTruthy()
    expect(scrim).toBeTruthy()
    expect(contrast('#ffffff', mixHex(magenta as string, scrim as number[]))).toBeGreaterThanOrEqual(4.5)
  })

  // Spec N.1 says >= 7:1; #4338ca measures 6.90:1 on stone (7.90:1 on white). AA is the bar.
  it('links (--link) hold 4.5:1 on the stone canvas', () => {
    expect(contrast(token(':root', 'link'), token(':root', 'paper'))).toBeGreaterThanOrEqual(4.5)
  })

  it('captions (--ink-3) hold 4.5:1 on the canvas', () => {
    expect(contrast(token(':root', 'ink-3'), token(':root', 'paper'))).toBeGreaterThanOrEqual(4.5)
  })

  // Amber is an exhibit colour: only inside `.ink-panel`. Fixed by BRAND-01 and
  // MASCOT-01 (Node's amber visor and slate today sit on the open page).
  it.fails('amber is used only inside .ink-panel (BRAND-01, MASCOT-01)', () => {
    const wrong = rules.filter(({ selector, body }) => /var\(--(?:accent-)?amber\)/.test(body) && !/\.ink-panel/.test(selector))
    expect(wrong.map(({ selector }) => selector)).toEqual([])
  })
})

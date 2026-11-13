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

/** A role that `.ink-panel` does not override falls back to its `:root` value. */
function resolved(scope: string, name: string): string {
  try {
    return token(scope, name)
  } catch {
    return token(':root', name)
  }
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

// Blueprint palette (ADR 0014): the spec's source values, aliased by the roles below.
describe('Blueprint source tokens match the approved palette', () => {
  it.each([
    ['bg-studio', '#050b14'], ['surface-card', '#0f172a'], ['surface-border', '#1e293b'],
    ['ink-primary', '#f8fafc'], ['ink-muted', '#94a3b8'],
    ['brand-magenta', '#e100ff'], ['brand-violet', '#7b2cbf'], ['brand-blue', '#0048ba'],
    ['accent-amber', '#d97706'], ['accent-danger', '#f87171'],
  ])('--%s is %s', (name, hex) => expect(token(':root', name)).toBe(hex))

  it('the logo gradient runs magenta → violet → blue', () => {
    expect(block(':root')).toMatch(/--brand-gradient:\s*linear-gradient\(135deg,\s*#e100ff 0%,\s*#7b2cbf 50%,\s*#0048ba 100%\)/i)
  })

  it('the roles alias the source values', () => {
    expect(token(':root', 'paper')).toBe('#050b14')
    expect(token(':root', 'paper-2')).toBe('#0f172a')
    expect(token(':root', 'ink')).toBe('#f8fafc')
    expect(token(':root', 'ink-3')).toBe('#94a3b8')
    expect(token(':root', 'rule')).toBe('#1e293b')
    expect(token(':root', 'redline')).toBe('#e100ff')
    expect(token('.ink-panel', 'paper')).toBe('#0f172a')
  })
})

// WCAG AA on navy, on the canvas and on the raised `.ink-panel` surface.
// Magenta (the redline role) is used as text, so it is held to 4.5:1, not 3:1.
describe.each([':root', '.ink-panel'])('colour contrast in %s', (scope) => {
  const paper = resolved(scope, 'paper')
  it('body text (ink) is at least 7:1', () => expect(contrast(resolved(scope, 'ink'), paper)).toBeGreaterThanOrEqual(7))
  it('secondary text (ink-2) is at least 4.5:1', () => expect(contrast(resolved(scope, 'ink-2'), paper)).toBeGreaterThanOrEqual(4.5))
  it('captions (ink-3) are at least 4.5:1', () => expect(contrast(resolved(scope, 'ink-3'), paper)).toBeGreaterThanOrEqual(4.5))
  it('the magenta accent is at least 4.5:1', () => expect(contrast(resolved(scope, 'redline'), paper)).toBeGreaterThanOrEqual(4.5))
  it('ink-3 also holds 4.5:1 on paper-2 surfaces', () => expect(contrast(resolved(scope, 'ink-3'), resolved(scope, 'paper-2'))).toBeGreaterThanOrEqual(4.5))
  it('amber status text is at least 4.5:1', () => expect(contrast(token(':root', 'accent-amber'), paper)).toBeGreaterThanOrEqual(4.5))
  it('form errors are at least 4.5:1', () => expect(contrast(token(':root', 'accent-danger'), paper)).toBeGreaterThanOrEqual(4.5))
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

  // Fixed by BRAND-02 (removes the gradient border on cards).
  it.fails('the gradient is referenced only by the four allowed roles (BRAND-02)', () => {
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

  // Fixed by BRAND-01 (adds the indigo link role).
  it.fails('links (--link) hold 7:1 on the stone canvas (BRAND-01)', () => {
    expect(contrast(token(':root', 'link'), token(':root', 'paper'))).toBeGreaterThanOrEqual(7)
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

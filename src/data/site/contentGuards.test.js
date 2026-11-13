import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as CONTENT from './content.js'
import { siteSettingsContent } from '../siteSettingsContent.js'
import { termsPage } from '../pages/terms.js'
import { privacyPage } from '../pages/privacy.js'

// TEST-01 guard tests for the brand, UX and architecture spec
// (docs/plans/devlab-complete-b2b-brand-ux-architecture-spec.md).
//
// A guard that the code already meets is a plain test. A guard that a later
// requirement makes true is `it.fails`, tagged with that requirement: it runs
// in CI, proves the violation exists today, and turns red the moment the fix
// lands, so the requirement's own commit has to flip it to a plain `it`.

/** Every string anywhere inside a value, with its path. */
function strings(value, path) {
  if (typeof value === 'string') return [[path, value]]
  if (Array.isArray(value)) return value.flatMap((entry, index) => strings(entry, `${path}[${index}]`))
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([key, entry]) => strings(entry, `${path}.${key}`))
  return []
}

// Identifiers and links are code, not copy a visitor reads.
const CODE_KEYS = /\.(id|slug|href|path|contactHref|sceneId|solutionId|inquiryType|workProjectId)$/
const contentStrings = Object.entries(CONTENT)
  .filter(([, value]) => typeof value !== 'function')
  .flatMap(([name, value]) => strings(value, name))
  .filter(([path]) => !CODE_KEYS.test(path))
const legalStrings = [...strings(termsPage, 'termsPage'), ...strings(privacyPage, 'privacyPage')]

// Spec C.3 (labels a visitor cannot check) and I.2 (writing standards).
// "deterministic" is allowed only in Technical notes, which content.js does not hold.
const FORBIDDEN = [
  ['self-issued verification line', /VERIFIED ·/],
  ['"LIVE" status label', /\bLIVE\b/],
  ['"live schematic" label', /live schematic/i],
  ['"nominal" status label', /\bnominal\b/i],
  ['spec-sheet card id', /\bSYS-\d/],
  ['"Systems in production"', /systems in production/i],
  ['"running today"', /running today/i],
  ['absolute "never lost"', /never lost/i],
  ['"Nothing is auto-replied and closed"', /nothing is auto-replied/i],
  ['Terms calling the Work screenshots illustrative', /illustrative purposes/i],
  ...['unlock', 'revolutioni[sz]e', 'cutting-edge', 'empower', 'seamless', 'next-generation', 'supercharge', 'leverage', 'robust', 'brittle wrappers', 'black box', 'deterministic', 'failure vector']
    .map((word) => [`cliché "${word}"`, new RegExp(`\\b${word}`, 'i')]),
]

function violations(entries) {
  return entries.flatMap(([path, text]) => FORBIDDEN.filter(([, pattern]) => pattern.test(text)).map(([why]) => `${path}: ${why}`))
}

describe('honesty and writing standards (TEST-01; spec C.3, I.2)', () => {
  it('finds the copy to check', () => {
    expect(contentStrings.length).toBeGreaterThan(100)
    expect(legalStrings.length).toBeGreaterThan(5)
  })

  // Fixed by CONTENT-01 (home copy) and CONTENT-03 (honesty labels).
  it.fails('content.js uses no forbidden label or cliché (CONTENT-01, CONTENT-03)', () => {
    expect(violations(contentStrings)).toEqual([])
  })

  // Fixed by CONTENT-03 (Terms "illustrative purposes"; owner decision Q-06).
  it.fails('the static legal data uses no forbidden label or cliché (CONTENT-03)', () => {
    expect(violations(legalStrings)).toEqual([])
  })

  // Hardcoded labels in brand components and pages. `data-state="nominal"` and
  // similar attribute values are code, not visible labels, so only the
  // upper-case labels and the card ids are checked here.
  const sources = ['src/components/brand', 'src/pages']
    .flatMap(function files(path) {
      return statSync(path).isFile() ? [path] : readdirSync(path).flatMap((name) => files(join(path, name)))
    })
    .filter((path) => /\.(astro|jsx)$/.test(path) && !/\.test\./.test(path))
  const LABELS = [/VERIFIED ·/, /\bLIVE\b/, /\bNOMINAL\b/, /\bSYS-/]
  const labelled = sources.filter((path) => LABELS.some((pattern) => pattern.test(readFileSync(path, 'utf8'))))

  it.each(sources.filter((path) => !labelled.includes(path)))('%s carries no self-issued status label', (path) => {
    for (const pattern of LABELS) expect(readFileSync(path, 'utf8')).not.toMatch(pattern)
  })

  // Fixed by UX-01, which removes the spec-sheet cards (WEB-01 deletes the file).
  it.fails.each(labelled)('%s carries no self-issued status label (UX-01)', (path) => {
    for (const pattern of LABELS) expect(readFileSync(path, 'utf8')).not.toMatch(pattern)
  })
})

// Spec K.3 / CONTENT-02: one primary label site-wide, line variants, the audit label.
const CONTACT_CTA_LABELS = new Set([
  'Talk to us about your system',
  'Talk to us',
  'Contact',
  'Talk to us about your intake',
  'Talk to us about your workflow',
  'Talk to us about your build',
  'Talk to us about something similar',
  'Request the audit',
  'Ask a question first',
])

/** Every { label, href } that leads to the contact form, plus each service line's CTA. */
function contactCtas() {
  const found = []
  const walk = (value, path) => {
    if (Array.isArray(value)) return value.forEach((entry, index) => walk(entry, `${path}[${index}]`))
    if (!value || typeof value !== 'object') return
    if (typeof value.label === 'string' && typeof value.href === 'string' && value.href.startsWith('/contact')) found.push({ path, label: value.label, href: value.href })
    if (typeof value.ctaLabel === 'string' && value.inquiryType) found.push({ path: `${path}.ctaLabel`, label: value.ctaLabel, href: `/contact?type=${value.inquiryType}` })
    Object.entries(value).forEach(([key, entry]) => walk(entry, `${path}.${key}`))
  }
  Object.entries(CONTENT).filter(([, value]) => typeof value !== 'function').forEach(([name, value]) => walk(value, name))
  for (const [key, label] of Object.entries(siteSettingsContent.ctas ?? {})) found.push({ path: `siteSettings.ctas.${key}`, label, href: '/contact' })
  const nav = readFileSync('src/components/brand/BrandNav.astro', 'utf8')
  const fallback = /navbarContactLabel \|\| '([^']+)'/.exec(nav)
  if (fallback) found.push({ path: 'BrandNav fallback', label: fallback[1], href: '/contact' })
  return found
}

describe('call-to-action labels (TEST-01; spec K.3)', () => {
  it('finds the contact CTAs', () => expect(contactCtas().length).toBeGreaterThan(5))

  // Fixed by CONTENT-02 (site-wide labels; Q-15).
  it.fails('every link to the contact form uses an approved label (CONTENT-02)', () => {
    const wrong = contactCtas().filter(({ label }) => !CONTACT_CTA_LABELS.has(label)).map(({ path, label }) => `${path}: "${label}"`)
    expect(wrong).toEqual([])
  })

  it('the audit request link always says "Request the audit"', () => {
    for (const { path, label } of contactCtas().filter(({ href }) => /type=workflow_audit/.test(href))) {
      if (path === 'HOME.hero.primary') continue // replaced by CONTENT-01; checked below
      expect(label, path).toBe('Request the audit')
    }
  })

  // Fixed by CONTENT-01 (the home hero becomes "Talk to us about your system").
  it.fails('the home hero uses an approved label (CONTENT-01)', () => {
    expect(CONTACT_CTA_LABELS.has(CONTENT.HOME.hero.primary.label)).toBe(true)
  })
})

describe('section labels (TEST-01; spec I.2, N.2)', () => {
  const eyebrows = contentStrings.filter(([path]) => /\.eyebrow$/.test(path))

  it('finds the section labels', () => expect(eyebrows.length).toBeGreaterThan(5))

  // BRAND-02: plain words, read aloud as words by screen readers.
  it('use no §, brackets or bullets, and are not shouted in capitals', () => {
    const wrong = eyebrows.filter(([, text]) => /[§[\]•]/.test(text) || /^[^a-z]*[A-Z]{4,}[^a-z]*$/.test(text)).map(([path, text]) => `${path}: ${text}`)
    expect(wrong).toEqual([])
  })
})

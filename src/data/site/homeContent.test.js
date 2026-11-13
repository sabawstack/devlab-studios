import { describe, expect, it } from 'vitest'
import { ABOUT, HOME, OFFER_AUDIT } from './content.js'
import { CTA } from '../../config/ctas.js'

// Shape and voice guards for the home copy (spec N.10, I.4; approved by the
// owner 2026-11-13). Forbidden labels and clichés are in contentGuards.test.js.

const words = (text) => String(text).split(/\s+/).filter(Boolean).length

/** Every string anywhere inside a value, with its path. */
function strings(value, path = 'HOME') {
  if (typeof value === 'string') return [[path, value]]
  if (Array.isArray(value)) return value.flatMap((entry, index) => strings(entry, `${path}[${index}]`))
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([key, entry]) => strings(entry, `${path}.${key}`))
  return []
}

describe('home hero (spec I.4)', () => {
  it('states the outcome and offers one conversation', () => {
    expect(HOME.hero.heading).toBe("Business systems that don't quietly lose work.")
    expect(HOME.hero.primary).toEqual({ label: CTA.primary, href: '/contact?type=business_system' })
    expect(HOME.hero.secondary).toEqual({ label: 'See the work', href: '/work' })
    expect(HOME.hero).not.toHaveProperty('eyebrow')
  })

  it('keeps the lead to one or two sentences', () => {
    expect(HOME.hero.lead.split(/(?<=\.)\s/).length).toBeLessThanOrEqual(2)
  })
})

describe('four ways work gets lost', () => {
  it('pairs four problems with what we do instead, each with a scene symbol', () => {
    expect(HOME.problems.items).toHaveLength(4)
    expect(new Set(HOME.problems.items.map((item) => item.id)).size).toBe(4)
    expect(HOME.problems.items.map((item) => item.symbol)).toEqual(['inbox', 'clock', 'sheet', 'form'])
    for (const item of HOME.problems.items) {
      expect(words(item.problem), item.id).toBeLessThanOrEqual(10)
      expect(words(item.fix), item.id).toBeLessThanOrEqual(22)
    }
  })
})

describe('the inquiry exhibit (spec C.3, H.2)', () => {
  it('is labelled as an illustration and its statuses say they are a simulation', () => {
    expect(HOME.exhibit.title).toMatch(/\(illustration\)$/)
    expect(HOME.exhibit.status.nominal).toMatch(/^In this simulation/)
    expect(HOME.exhibit.status.outage).toMatch(/^In this simulation/)
    expect(HOME.exhibit.checkpoints.map((checkpoint) => checkpoint.label)).toEqual(['Intake', 'Saved first', 'Rules route', 'Handed off'])
  })

  it('keeps the in-art labels short enough for the drawing', () => {
    for (const label of [...HOME.exhibit.checkpoints.map((checkpoint) => checkpoint.label), HOME.exhibit.branchLabel, HOME.exhibit.retryLabel, HOME.exhibit.heldLabel, HOME.exhibit.alertLabel]) {
      expect(label.length, label).toBeLessThanOrEqual(12)
    }
  })
})

describe('offer, founder and close', () => {
  it('offers the audit with three deliverables and its own label', () => {
    expect(HOME.audit.title).toBe(OFFER_AUDIT.title)
    expect(HOME.audit.deliverables).toHaveLength(3)
    expect(HOME.audit.primary).toEqual({ label: CTA.audit, href: OFFER_AUDIT.contactHref })
  })

  it('has no one-engineer founder strip; the studio speaks as "we" (owner, 2026-11-13)', () => {
    expect(HOME).not.toHaveProperty('founder')
  })

  it('About names only the markets the owner confirmed (Q-07: PH, US, AU)', () => {
    expect(ABOUT.facts.find((fact) => fact.label === 'Clients in')?.value).toBe('The Philippines, the United States and Australia')
  })

  it('closes with the primary conversation', () => {
    expect(HOME.final.primary).toEqual({ label: CTA.primary, href: CTA.primaryHref })
  })
})

describe('home voice', () => {
  const all = strings(HOME)

  it('uses no filler or casual openers', () => {
    for (const [path, text] of all) expect(text, path).not.toMatch(/\b(hey there|super|basically|just imagine|game[- ]changer)\b/i)
  })

  it('asks no rhetorical questions in headings', () => {
    for (const [path, text] of all.filter(([path]) => /heading|title/i.test(path))) expect(text.trim(), path).not.toMatch(/\?$/)
  })

  it('names the founder at most once and never pitches "one engineer"', () => {
    const count = all.reduce((total, [, text]) => total + (text.match(/Stephen Rey Agustinez/g) || []).length, 0)
    expect(count).toBeLessThanOrEqual(1)
    for (const [path, text] of all) expect(text, path).not.toMatch(/one engineer|one senior architect|one person accountable/i)
  })

  it('never uses an exclamation mark', () => {
    for (const [path, text] of all) expect(text, path).not.toMatch(/!/)
  })

  it('keeps the home copy within its budget', () => {
    expect(all.reduce((total, [, text]) => total + words(text), 0)).toBeLessThanOrEqual(600)
  })
})

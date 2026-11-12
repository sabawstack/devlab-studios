import { describe, expect, it } from 'vitest'
import { HOME, OFFER_AUDIT } from './content.js'

// Shape and voice guards for the Blueprint home page copy (ADR 0014).
// Voice: declarative, no rhetorical questions, no filler, the founder named once.

const words = (text) => String(text).split(/\s+/).filter(Boolean).length

/** Every string anywhere inside a value, with its path. */
function strings(value, path = 'HOME') {
  if (typeof value === 'string') return [[path, value]]
  if (Array.isArray(value)) return value.flatMap((entry, index) => strings(entry, `${path}[${index}]`))
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([key, entry]) => strings(entry, `${path}.${key}`))
  return []
}

describe('home hero', () => {
  it('leads with the reliability promise and the audit', () => {
    expect(HOME.hero.eyebrow).toBe('[ DEVLAB STUDIOS • SYSTEMS ARCHITECTURE ]')
    expect(HOME.hero.heading).toBe("Systems that don't silently fail.")
    expect(HOME.hero.primary).toEqual({ label: 'Request a Workflow Audit', href: OFFER_AUDIT.contactHref })
    expect(HOME.hero.secondary).toEqual({ label: 'Explore Production Systems', href: '/work' })
  })
})

describe('hero pipeline copy', () => {
  it('names four checkpoints in order and both statuses', () => {
    expect(HOME.pipeline.checkpoints.map((checkpoint) => checkpoint.label)).toEqual(['Intake', 'SQL persist', 'Deterministic route', 'Human handoff'])
    expect(HOME.pipeline.status.nominal).toBe('Nominal: payload persisted, delivered, handed off.')
    expect(HOME.pipeline.status.outage).toBe('Outage: webhook failed. Payload persisted in SQL, retry queued, operator alerted.')
    expect(HOME.pipeline.toggleLabel).toBe('Simulate outage')
  })
})

describe('failure-mode console', () => {
  it('has four items with unique ids and all three fields', () => {
    expect(HOME.console).toHaveLength(4)
    expect(new Set(HOME.console.map((item) => item.id)).size).toBe(4)
    for (const item of HOME.console) {
      expect(item.id).toMatch(/^[a-z-]+$/)
      for (const field of ['title', 'vector', 'architecture', 'verification']) expect(item[field], `${item.id}.${field}`).toBeTruthy()
    }
  })

  it('keeps every field within 45 words', () => {
    for (const item of HOME.console) {
      for (const field of ['vector', 'architecture', 'verification']) expect(words(item[field]), `${item.id}.${field}`).toBeLessThanOrEqual(45)
    }
  })

  it('states each verification as a mono status line', () => {
    for (const item of HOME.console) expect(item.verification).toMatch(/^VERIFIED · /)
  })
})

describe('rules of reliability', () => {
  it('has the four rules in order', () => {
    expect(HOME.bento.map((rule) => rule.title)).toEqual(['Persist Before Delivery', 'Visible Failures', 'Deterministic Routing', 'Human Handoff'])
    for (const rule of HOME.bento) expect(words(rule.text)).toBeGreaterThan(5)
  })
})

describe('start here', () => {
  it('offers the audit with three deliverables and the principal spotlight', () => {
    expect(HOME.audit.title).toBe(OFFER_AUDIT.title)
    expect(HOME.audit.deliverables).toEqual(['End-to-end bottleneck map', 'Recommended architecture', 'Prioritised build roadmap'])
    expect(HOME.principal.eyebrow).toBe('Principal engineer')
    expect(HOME.principal.linkLabel).toBe('Read the profile')
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

  it('names the founder at most once', () => {
    const count = all.reduce((total, [, text]) => total + (text.match(/Stephen Rey Agustinez/g) || []).length, 0)
    expect(count).toBeLessThanOrEqual(1)
  })

  it('never uses an exclamation mark', () => {
    for (const [path, text] of all) expect(text, path).not.toMatch(/!/)
  })
})

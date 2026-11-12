import { describe, expect, it } from 'vitest'
import { pageBlockSchema, PAGE_BLOCK_TYPES } from './blocks'
import { SCENE_IDS } from '../../config/scenes'
import { ENTRY_OFFERS } from '../../config/offers.js'
import { INQUIRY_TYPES } from './inquiry'

const parse = (block: unknown) => pageBlockSchema.safeParse(block)

// CMS-03: blocks and props the redesign composes pages from.
describe('scene block', () => {
  it('accepts a registered scene with an optional caption override', () => {
    const result = parse({ type: 'scene', props: { sceneId: SCENE_IDS[0], heading: 'Where inquiries go', body: 'Four tools, no owner.' } })
    expect(result.success).toBe(true)
    expect(parse({ type: 'scene', props: { sceneId: 'build-in-layers', heading: 'H', caption: 'Custom caption', variant: 'tall' } }).success).toBe(true)
  })

  it('refuses a scene that is not in the code-owned registry (no arbitrary art)', () => {
    expect(parse({ type: 'scene', props: { sceneId: 'uploaded.svg', heading: 'H' } }).success).toBe(false)
  })
})

describe('proofStrip block', () => {
  const item = { label: 'Inquiries saved before any email is sent', value: 'Persist-first', kind: 'system' }

  it('accepts up to four verifiable proof items', () => {
    expect(parse({ type: 'proofStrip', props: { items: [item, item, item, item] } }).success).toBe(true)
  })

  it('refuses a fifth item and an unknown kind', () => {
    expect(parse({ type: 'proofStrip', props: { items: [item, item, item, item, item] } }).success).toBe(false)
    expect(parse({ type: 'proofStrip', props: { items: [{ ...item, kind: 'metric' }] } }).success).toBe(false)
  })

  it('holds evidence links to the site link policy', () => {
    expect(parse({ type: 'proofStrip', props: { items: [{ ...item, evidenceUrl: 'javascript:alert(1)' }] } }).success).toBe(false)
    expect(parse({ type: 'proofStrip', props: { items: [{ ...item, evidenceUrl: '/work' }] } }).success).toBe(true)
  })
})

describe('offerCard block', () => {
  it('names a registered offer and a text price label, never a number', () => {
    const offerId = Object.keys(ENTRY_OFFERS)[0]
    expect(parse({ type: 'offerCard', props: { offerId, ctaLabel: 'Request the audit' } }).success).toBe(true)
    expect(parse({ type: 'offerCard', props: { offerId, ctaLabel: 'Go', priceLabel: 'Fixed scope, quoted after a call' } }).success).toBe(true)
    expect(parse({ type: 'offerCard', props: { offerId, ctaLabel: 'Go', priceLabel: 900 } }).success).toBe(false)
    expect(parse({ type: 'offerCard', props: { offerId: 'not-an-offer', ctaLabel: 'Go' } }).success).toBe(false)
  })
})

describe('hero and cta additions', () => {
  const hero = { type: 'hero', props: { heading: 'Systems that hold up' } }

  it('existing heroes still parse, keeping their behaviour (visualId "", density standard)', () => {
    const result = parse(hero)
    expect(result.success).toBe(true)
    if (result.success && result.data.type === 'hero') {
      expect(result.data.props.visualId).toBe('')
      expect(result.data.props.density).toBe('standard')
    }
  })

  it('a hero can carry a registered scene, the canvas, or nothing', () => {
    for (const visualId of ['none', 'system-canvas', `scene:${SCENE_IDS[1]}`]) {
      expect(parse({ ...hero, props: { ...hero.props, visualId, density: 'compact' } }).success).toBe(true)
    }
    expect(parse({ ...hero, props: { ...hero.props, visualId: 'scene:unknown' } }).success).toBe(false)
  })

  it('a cta has a tone and may preselect any inquiry type', () => {
    const cta = { type: 'cta', props: { heading: 'Start', primaryCta: { label: 'Contact', href: '/contact' } } }
    const parsed = parse(cta)
    expect(parsed.success && parsed.data.type === 'cta' && parsed.data.props.tone).toBe('primary')
    expect(parse({ ...cta, props: { ...cta.props, tone: 'quiet' } }).success).toBe(true)
    for (const inquiryType of INQUIRY_TYPES) {
      expect(parse({ ...cta, props: { ...cta.props, inquiryType } }).success, inquiryType).toBe(true)
    }
  })
})

describe('block type list', () => {
  it('offers the new blocks to editors', () => {
    for (const type of ['scene', 'proofStrip', 'offerCard']) expect(PAGE_BLOCK_TYPES).toContain(type)
  })
})

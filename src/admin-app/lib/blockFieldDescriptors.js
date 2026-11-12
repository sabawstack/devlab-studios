// Field descriptors for the general-purpose page-composition blocks.
// types' `props` shape (see src/lib/schemas/blocks.ts) — the constrained
// building blocks editors compose Home/About/Process from. Nested
// array/object props (CTAs, list items) use the 'json' field type as an
// explicit, visible escape hatch rather than a bespoke widget per shape;
// promoting any of these to a dedicated array-of-object editor is a
// reasonable follow-up once real page content shows which ones need it.

import { HERO_VISUAL_IDS, SCENES } from '../../config/scenes'
import { ENTRY_OFFERS } from '../../config/offers.js'
import { CONTACT_FORM_INQUIRY_TYPES, INQUIRY_TYPE_LABELS } from '../../lib/schemas/inquiry'

// Registry-backed selects: options come from the server-owned registries, so
// an editor can only choose values the public site knows how to render.
const SCENE_OPTIONS = SCENES.map((scene) => ({ value: scene.id, label: `${scene.code} · ${scene.title}` }))
const HERO_VISUAL_OPTIONS = HERO_VISUAL_IDS.map((id) => ({
  value: id,
  label: id === '' ? 'Keep current behaviour' : id === 'none' ? 'No visual' : id === 'system-canvas' ? 'Living-system canvas (legacy)' : `Scene: ${SCENES.find((scene) => `scene:${scene.id}` === id)?.title ?? id}`,
}))
const OFFER_OPTIONS = Object.values(ENTRY_OFFERS).map((offer) => ({ value: offer.id, label: offer.title }))
const INQUIRY_TYPE_OPTIONS = [
  { value: '', label: 'Do not preselect' },
  ...CONTACT_FORM_INQUIRY_TYPES.map((type) => ({ value: type, label: INQUIRY_TYPE_LABELS[type] })),
]

export const BLOCK_LABELS = {
  hero: 'Hero',
  richText: 'Rich Text',
  stats: 'Stats',
  processSteps: 'Process Steps',
  experienceTimeline: 'Experience Timeline',
  servicesGrid: 'Services Grid',
  featuredProjects: 'Featured Projects',
  featuredCaseStudies: 'Featured Case Studies',
  testimonials: 'Testimonials',
  faq: 'FAQ',
  problemList: 'Problem List',
  leadMagnet: 'Lead Magnet',
  resourceCards: 'Resource Cards',
  imageGallery: 'Image Gallery',
  cta: 'Call to Action',
  scene: 'Scene (illustration)',
  proofStrip: 'Proof Strip',
  offerCard: 'Offer Card',
}

export const BLOCK_FIELDS = {
  hero: [
    { name: 'eyebrow', label: 'Eyebrow', type: 'text' },
    { name: 'kicker', label: 'Hero Kicker', type: 'text', help: 'Used by the Home system hero.' },
    { name: 'tagline', label: 'Primary Tagline', type: 'textarea', help: 'Used by the large Home hero statement.' },
    { name: 'heading', label: 'Heading', type: 'text', required: true },
    { name: 'subheading', label: 'Subheading', type: 'textarea' },
    { name: 'variant', label: 'Hero Variant', type: 'select', options: [{ value: 'system', label: 'Living System' }, { value: 'editorial', label: 'Editorial' }, { value: 'compact', label: 'Compact' }] },
    { name: 'iconMotif', label: 'Vector Motif', type: 'select', options: [{ value: 'fullstack', label: 'Full-Stack' }, { value: 'automation', label: 'Automation' }, { value: 'data', label: 'Data & Cloud' }, { value: 'editorial', label: 'Editorial' }] },
    { name: 'signals', label: 'System Signals', type: 'stringList' },
    { name: 'capabilities', label: 'Hero Capability Labels', type: 'objectList', fields: [{ name: 'label', label: 'Label', type: 'text' }, { name: 'value', label: 'Value', type: 'text' }] },
    { name: 'canvasNodes', label: 'Living-System Nodes', type: 'objectList', fields: [{ name: 'key', label: 'Approved node key', type: 'text' }, { name: 'label', label: 'Label', type: 'text' }, { name: 'note', label: 'Note', type: 'text' }] },
    { name: 'statusLabel', label: 'Living-System Status', type: 'text' },
    { name: 'imageUrl', label: 'Image URL', type: 'url' },
    { name: 'primaryCta', label: 'Primary CTA', type: 'cta' },
    { name: 'secondaryCta', label: 'Secondary CTA', type: 'cta' },
    { name: 'visualId', label: 'Hero visual', type: 'select', options: HERO_VISUAL_OPTIONS, help: 'A scene from the brand scene library, or none.' },
    { name: 'density', label: 'Hero density', type: 'select', options: [{ value: 'standard', label: 'Standard' }, { value: 'compact', label: 'Compact' }] },
  ],
  richText: [
    { name: 'eyebrow', label: 'Eyebrow', type: 'text' },
    { name: 'heading', label: 'Heading', type: 'text' },
    { name: 'body', label: 'Body', type: 'textarea', required: true },
    { name: 'highlights', label: 'Highlight Cards', type: 'objectList', fields: [{ name: 'label', label: 'Heading', type: 'text' }, { name: 'value', label: 'Description', type: 'textarea' }] },
  ],
  stats: [
    { name: 'heading', label: 'Heading', type: 'text' },
    { name: 'subheading', label: 'Subheading', type: 'textarea' },
    { name: 'items', label: 'Items', type: 'objectList', fields: [{ name: 'label', label: 'Label', type: 'text' }, { name: 'value', label: 'Value', type: 'textarea' }] },
  ],
  processSteps: [
    { name: 'heading', label: 'Heading', type: 'text' },
    { name: 'subheading', label: 'Subheading', type: 'textarea' },
    { name: 'steps', label: 'Steps', type: 'objectList', fields: [{ name: 'title', label: 'Title', type: 'text' }, { name: 'description', label: 'Description', type: 'textarea' }, { name: 'icon', label: 'Approved icon key', type: 'text' }, { name: 'outcomes', label: 'Outcome bullets', type: 'stringList' }, { name: 'visualTitle', label: 'Artifact title', type: 'text' }, { name: 'visualChips', label: 'Artifact chips', type: 'stringList' }, { name: 'visualNote', label: 'Artifact note', type: 'textarea' }] },
  ],
  experienceTimeline: [
    { name: 'heading', label: 'Heading', type: 'text' },
  ],
  servicesGrid: [
    { name: 'heading', label: 'Heading', type: 'text' },
    { name: 'subheading', label: 'Subheading', type: 'textarea' },
    { name: 'serviceIds', label: 'Service IDs', type: 'stringList' },
  ],
  featuredProjects: [
    { name: 'heading', label: 'Heading', type: 'text' },
    { name: 'limit', label: 'Limit', type: 'number' },
  ],
  featuredCaseStudies: [
    { name: 'heading', label: 'Heading', type: 'text' },
    { name: 'subheading', label: 'Subheading', type: 'textarea' },
    { name: 'limit', label: 'Limit', type: 'number' },
  ],
  testimonials: [
    { name: 'heading', label: 'Heading', type: 'text' },
    { name: 'limit', label: 'Limit', type: 'number' },
  ],
  faq: [
    { name: 'heading', label: 'Heading', type: 'text' },
    { name: 'subheading', label: 'Subheading', type: 'textarea' },
    { name: 'context', label: 'Context', type: 'text', help: 'Matches an FAQ context tag, e.g. "general".' },
    { name: 'items', label: 'Questions', type: 'objectList', fields: [{ name: 'question', label: 'Question', type: 'text' }, { name: 'answer', label: 'Answer', type: 'textarea' }] },
  ],
  problemList: [
    { name: 'eyebrow', label: 'Eyebrow', type: 'text' },
    { name: 'heading', label: 'Heading', type: 'text' },
    { name: 'subheading', label: 'Subheading', type: 'textarea' },
    { name: 'items', label: 'Problems', type: 'objectList', fields: [{ name: 'title', label: 'Problem', type: 'text' }, { name: 'description', label: 'What it costs', type: 'textarea' }, { name: 'icon', label: 'Approved icon key', type: 'text' }] },
  ],
  leadMagnet: [
    { name: 'eyebrow', label: 'Eyebrow', type: 'text' },
    { name: 'heading', label: 'Heading', type: 'text', required: true },
    { name: 'body', label: 'Body', type: 'textarea' },
    { name: 'offerId', label: 'Offer ID', type: 'text', required: true, help: 'Must match a registered offer in src/config/offers.js — the destination URL is resolved server-side, never from this page.' },
    { name: 'bullets', label: 'What it covers', type: 'stringList' },
  ],
  resourceCards: [
    { name: 'heading', label: 'Heading', type: 'text' },
    { name: 'limit', label: 'Limit', type: 'number' },
  ],
  imageGallery: [
    { name: 'heading', label: 'Heading', type: 'text' },
    { name: 'images', label: 'Images', type: 'objectList', fields: [{ name: 'url', label: 'Image URL', type: 'text' }, { name: 'alt', label: 'Alternative text', type: 'text' }] },
  ],
  cta: [
    { name: 'eyebrow', label: 'Eyebrow', type: 'text' },
    { name: 'heading', label: 'Heading', type: 'text', required: true },
    { name: 'body', label: 'Body', type: 'textarea' },
    { name: 'primaryCta', label: 'Primary CTA', type: 'cta', required: true },
    { name: 'secondaryCta', label: 'Secondary CTA', type: 'cta' },
    { name: 'inquiryType', label: 'Preselected inquiry type', type: 'select', options: INQUIRY_TYPE_OPTIONS, help: 'Carried into the contact form so the visitor does not have to classify themselves.' },
    { name: 'tone', label: 'Tone', type: 'select', options: [{ value: 'primary', label: 'Primary band' }, { value: 'quiet', label: 'Quiet link row' }] },
    { name: 'formId', label: 'Attribution form ID', type: 'text' },
    { name: 'offerId', label: 'Attribution offer ID', type: 'text' },
    { name: 'solutionId', label: 'Attribution solution ID', type: 'text' },
  ],
  scene: [
    { name: 'sceneId', label: 'Scene', type: 'select', options: SCENE_OPTIONS, required: true, help: 'Art is drawn in code; choose which scene, then write the words around it.' },
    { name: 'eyebrow', label: 'Eyebrow', type: 'text' },
    { name: 'heading', label: 'Heading', type: 'text', required: true },
    { name: 'body', label: 'Body', type: 'textarea' },
    { name: 'caption', label: 'Caption override', type: 'text', help: 'Leave blank to use the scene\'s standard caption.' },
    { name: 'variant', label: 'Crop', type: 'select', options: [{ value: 'auto', label: 'Automatic (wide on desktop, tall on phones)' }, { value: 'wide', label: 'Always wide' }, { value: 'tall', label: 'Always tall' }] },
  ],
  proofStrip: [
    { name: 'heading', label: 'Heading', type: 'text' },
    { name: 'items', label: 'Proof items (up to 4, each verifiable)', type: 'objectList', fields: [
      { name: 'label', label: 'Statement', type: 'text' },
      { name: 'value', label: 'Short value', type: 'text' },
      { name: 'kind', label: 'Kind (credential, system or principle)', type: 'text' },
      { name: 'evidenceUrl', label: 'Evidence link (optional)', type: 'text' },
    ] },
  ],
  offerCard: [
    { name: 'offerId', label: 'Offer', type: 'select', options: OFFER_OPTIONS, required: true },
    { name: 'heading', label: 'Heading override', type: 'text' },
    { name: 'priceLabel', label: 'Price wording (optional text)', type: 'text', help: 'Words, not a number, e.g. "Fixed scope, quoted after a call". Leave blank to show no price.' },
    { name: 'ctaLabel', label: 'Button label', type: 'text', required: true },
  ],
}

export const PAGE_BLOCK_TYPES = Object.keys(BLOCK_LABELS).filter((type) => !['featuredCaseStudies', 'testimonials'].includes(type))

export function createEmptyBlockProps(type) {
  const empty = {}
  for (const field of BLOCK_FIELDS[type] || []) {
    if (field.type === 'json' || field.type === 'stringList' || field.type === 'objectList') empty[field.name] = []
    else if (field.type === 'cta') empty[field.name] = { label: '', href: '' }
    else if (field.type === 'number') empty[field.name] = 3
    else if (field.type === 'select') empty[field.name] = field.options?.[0]?.value || ''
    else empty[field.name] = ''
  }
  return empty
}

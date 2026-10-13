import { z } from 'zod'
import { linkHrefSchema } from './shared'

export const iconMotifSchema = z.enum(['fullstack', 'automation', 'data', 'editorial'])
export const ICON_MOTIFS = iconMotifSchema.options

/**
 * The constrained set of page-composition blocks approved for use on
 * block-composed singleton pages (Home, About, Process, Work). Editors can
 * configure and reorder these; nothing else (no arbitrary HTML/JS/CSS).
 * Each block's `props` shape is validated against its own schema below.
 */

const heroBlockSchema = z.object({
  type: z.literal('hero'),
  props: z.object({
    eyebrow: z.string().optional().default(''),
    kicker: z.string().optional().default(''),
    tagline: z.string().optional().default(''),
    heading: z.string().min(1),
    subheading: z.string().optional().default(''),
    primaryCta: z.object({ label: z.string(), href: linkHrefSchema }).optional(),
    secondaryCta: z.object({ label: z.string(), href: linkHrefSchema }).optional(),
    imageUrl: z.string().optional().default(''),
    variant: z.enum(['system', 'editorial', 'compact']).optional().default('editorial'),
    iconMotif: iconMotifSchema.optional().default('fullstack'),
    signals: z.array(z.string()).optional().default([]),
    capabilities: z.array(z.object({ label: z.string(), value: z.string() })).max(3).optional().default([]),
    canvasNodes: z.array(z.object({
      key: z.enum(['visitor', 'interface', 'backend', 'data', 'decision', 'automation', 'handoff']),
      label: z.string(),
      note: z.string(),
    })).max(7).optional().default([]),
    statusLabel: z.string().optional().default(''),
  }),
})

const richTextBlockSchema = z.object({
  type: z.literal('richText'),
  props: z.object({
    eyebrow: z.string().optional().default(''),
    heading: z.string().optional().default(''),
    body: z.string().min(1),
    highlights: z.array(z.object({ label: z.string(), value: z.string() })).max(4).optional().default([]),
  }),
})

const statsBlockSchema = z.object({
  type: z.literal('stats'),
  props: z.object({
    heading: z.string().optional().default(''),
    subheading: z.string().optional().default(''),
    items: z.array(z.object({ label: z.string(), value: z.string() })).default([]),
  }),
})

const processStepsBlockSchema = z.object({
  type: z.literal('processSteps'),
  props: z.object({
    heading: z.string().optional().default(''),
    subheading: z.string().optional().default(''),
    steps: z.array(z.object({
      title: z.string(),
      description: z.string(),
      icon: z.string().optional().default(''),
      outcomes: z.array(z.string()).optional().default([]),
      visualTitle: z.string().optional().default(''),
      visualChips: z.array(z.string()).optional().default([]),
      visualNote: z.string().optional().default(''),
      visualFlow: z.array(z.object({ label: z.string(), icon: z.string().optional().default('') })).optional().default([]),
    })).default([]),
  }),
})

const experienceTimelineBlockSchema = z.object({
  type: z.literal('experienceTimeline'),
  props: z.object({
    heading: z.string().optional().default(''),
  }),
})

const servicesGridBlockSchema = z.object({
  type: z.literal('servicesGrid'),
  props: z.object({
    heading: z.string().optional().default(''),
    subheading: z.string().optional().default(''),
    serviceIds: z.array(z.string()).optional().default([]),
  }),
})

const featuredProjectsBlockSchema = z.object({
  type: z.literal('featuredProjects'),
  props: z.object({
    heading: z.string().optional().default(''),
    limit: z.number().int().min(1).max(12).default(3),
  }),
})

const workProjectItemSchema = z.object({
  projectId: z.string().min(1),
  description: z.string().optional().default(''),
  challenge: z.string().optional().default(''),
  systemArchitecture: z.string().optional().default(''),
  deliveryValue: z.string().optional().default(''),
  status: z.enum(['draft', 'published']).optional().default('draft'),
}).superRefine((item, context) => {
  if (item.status !== 'published') return

  const requiredFields = [
    ['description', item.description],
    ['challenge', item.challenge],
    ['systemArchitecture', item.systemArchitecture],
    ['deliveryValue', item.deliveryValue],
  ] as const

  for (const [field, value] of requiredFields) {
    if (!value.trim()) {
      context.addIssue({
        code: 'custom',
        path: [field],
        message: 'Published Work entries require this field.',
      })
    }
  }
})

const workProjectShowcaseBlockSchema = z.object({
  type: z.literal('workProjectShowcase'),
  props: z.object({
    heading: z.string().min(1),
    subheading: z.string().optional().default(''),
    items: z.array(workProjectItemSchema).max(12).default([]),
  }).superRefine((props, context) => {
    const seen = new Set<string>()
    props.items.forEach((item, index) => {
      if (seen.has(item.projectId)) {
        context.addIssue({
          code: 'custom',
          path: ['items', index, 'projectId'],
          message: 'A project can only be featured once on Work.',
        })
      }
      seen.add(item.projectId)
    })
  }),
})

const featuredCaseStudiesBlockSchema = z.object({
  type: z.literal('featuredCaseStudies'),
  props: z.object({
    heading: z.string().optional().default(''),
    subheading: z.string().optional().default(''),
    limit: z.number().int().min(1).max(12).default(3),
  }),
})

const testimonialsBlockSchema = z.object({
  type: z.literal('testimonials'),
  props: z.object({
    heading: z.string().optional().default(''),
    limit: z.number().int().min(1).max(12).default(3),
  }),
})

const faqBlockSchema = z.object({
  type: z.literal('faq'),
  props: z.object({
    heading: z.string().optional().default(''),
    subheading: z.string().optional().default(''),
    context: z.string().default('general'),
    items: z.array(z.object({ question: z.string(), answer: z.string() })).optional().default([]),
  }),
})

const resourceCardsBlockSchema = z.object({
  type: z.literal('resourceCards'),
  props: z.object({
    heading: z.string().optional().default(''),
    limit: z.number().int().min(1).max(12).default(3),
  }),
})

const imageGalleryBlockSchema = z.object({
  type: z.literal('imageGallery'),
  props: z.object({
    heading: z.string().optional().default(''),
    images: z.array(z.object({ url: z.string(), alt: z.string().default('') })).default([]),
  }),
})

const ctaBlockSchema = z.object({
  type: z.literal('cta'),
  props: z.object({
    eyebrow: z.string().optional().default(''),
    heading: z.string().min(1),
    body: z.string().optional().default(''),
    primaryCta: z.object({ label: z.string(), href: linkHrefSchema }),
    secondaryCta: z.object({ label: z.string(), href: linkHrefSchema }).optional(),
    /**
     * Routing context carried into the inquiry form. `inquiryType` preselects
     * the form's type so a visitor arriving from a solution page never has to
     * classify themselves; the rest are attribution ids, never displayed.
     */
    inquiryType: z.union([
      z.enum([
        'business_system',
        'software_project',
        'workflow_audit',
        'employment_opportunity',
        'contract_collaboration',
        'partnership',
        'general',
      ]),
      // The admin's select offers an explicit "do not preselect" option, which
      // posts an empty string — it has to validate, not be a save error.
      z.literal(''),
    ]).optional().default(''),
    formId: z.string().max(80).optional().default(''),
    offerId: z.string().max(80).optional().default(''),
    solutionId: z.string().max(80).optional().default(''),
  }),
})

/**
 * The operational problems a visitor recognizes before they know what to call
 * the solution. Its own block (rather than a `stats` reuse) because each item
 * needs a real sentence, not a label/value pair.
 */
const problemListBlockSchema = z.object({
  type: z.literal('problemList'),
  props: z.object({
    eyebrow: z.string().optional().default(''),
    heading: z.string().optional().default(''),
    subheading: z.string().optional().default(''),
    items: z.array(z.object({
      title: z.string(),
      description: z.string().optional().default(''),
      icon: z.string().optional().default(''),
    })).max(8).optional().default([]),
  }),
})

/**
 * A gated resource. `offerId` is a key into the server-owned registry in
 * src/config/offers.js -- an editor selects which offer, never what URL gets
 * emailed, so the CMS cannot be used to redirect a delivery.
 */
const leadMagnetBlockSchema = z.object({
  type: z.literal('leadMagnet'),
  props: z.object({
    eyebrow: z.string().optional().default(''),
    heading: z.string().min(1),
    body: z.string().optional().default(''),
    offerId: z.string().min(1),
    bullets: z.array(z.string()).max(6).optional().default([]),
  }),
})

export const pageBlockSchema = z.discriminatedUnion('type', [
  heroBlockSchema,
  richTextBlockSchema,
  statsBlockSchema,
  processStepsBlockSchema,
  experienceTimelineBlockSchema,
  servicesGridBlockSchema,
  featuredProjectsBlockSchema,
  workProjectShowcaseBlockSchema,
  featuredCaseStudiesBlockSchema,
  testimonialsBlockSchema,
  faqBlockSchema,
  problemListBlockSchema,
  leadMagnetBlockSchema,
  resourceCardsBlockSchema,
  imageGalleryBlockSchema,
  ctaBlockSchema,
])
export type PageBlock = z.infer<typeof pageBlockSchema>
export type PageBlockType = PageBlock['type']

export const PAGE_BLOCK_TYPES: PageBlockType[] = [
  'hero',
  'richText',
  'stats',
  'processSteps',
  'experienceTimeline',
  'servicesGrid',
  'featuredProjects',
  'workProjectShowcase',
  'featuredCaseStudies',
  'testimonials',
  'faq',
  'problemList',
  'leadMagnet',
  'resourceCards',
  'imageGallery',
  'cta',
]

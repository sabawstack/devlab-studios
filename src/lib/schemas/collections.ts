import { z } from 'zod'
import { baseItemSchema, linkHrefSchema, requiredLinkHrefSchema, seoSchema, slugSchema } from './shared'

export const serviceSchema = baseItemSchema.extend({
  eyebrow: z.string().optional().default(''),
  title: z.string().min(1),
  description: z.string().min(1),
  icon: z.string().default('Settings'),
  capabilities: z.array(z.string()).default([]),
  projectIds: z.array(z.string()).default([]),
})
export type Service = z.infer<typeof serviceSchema>

export const projectSchema = baseItemSchema.extend({
  title: z.string().min(1),
  description: z.string().min(1),
  techStack: z.array(z.string()).default([]),
  liveUrl: linkHrefSchema.default('#'),
  sourceUrl: linkHrefSchema.default('#'),
  imageUrl: z.string().optional().default(''),
  type: z.enum(['Automation', 'Website']),
})
export type Project = z.infer<typeof projectSchema>

const projectGalleryImageSchema = z.object({
  id: z.string().optional(),
  url: z.string().optional().default(''),
  filename: z.string().optional().default(''),
  altText: z.string().optional().default(''),
  sortOrder: z.union([z.number(), z.string()]).optional(),
  isThumbnail: z.boolean().optional().default(false),
})

/**
 * projectSchema alone is missing imageFilename/galleryImages, which the
 * bespoke ProjectsManager editor and src/worker/repositories/projects.js's
 * upsertProject/syncProjectGallery both rely on — safeParse-ing a request
 * body with the bare projectSchema would silently strip those fields
 * (Zod's default behavior for unrecognized keys) and wipe every project's
 * gallery on the next save. Used only by the /api/admin/projects/* routes;
 * projectSchema itself stays as the field-descriptor/rollback-snapshot
 * contract other callers (adminRegistry.js's PER_ITEM_COLLECTIONS) expect.
 */
export const projectRequestSchema = projectSchema
  .extend({
    imageFilename: z.string().optional().default(''),
    galleryImages: z.array(projectGalleryImageSchema).optional().default([]),
  })
  .superRefine((data, ctx) => {
    const thumbnailCount = data.galleryImages.filter((image) => image.isThumbnail).length
    if (thumbnailCount > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['galleryImages'],
        message: 'Only one gallery image may be marked as the thumbnail.',
      })
    }
  })

/** Ships with zero rows for now — see docs/content-model.md. */
export const caseStudySchema = baseItemSchema.extend({
  slug: slugSchema,
  title: z.string().min(1),
  summary: z.string().default(''),
  clientName: z.string().optional().default(''),
  industry: z.string().optional().default(''),
  problem: z.string().optional().default(''),
  constraints: z.string().optional().default(''),
  architecture: z.string().optional().default(''),
  implementation: z.string().optional().default(''),
  integrations: z.array(z.string()).default([]),
  outcomes: z.string().optional().default(''),
  metrics: z.array(z.object({ label: z.string(), value: z.string() })).default([]),
  screenshots: z.array(z.object({ url: z.string(), caption: z.string().default('') })).default([]),
  projectIds: z.array(z.string()).default([]),
  testimonialId: z.string().nullable().optional(),
  coverImageUrl: z.string().optional().default(''),
  isFeatured: z.boolean().default(false),
  seo: seoSchema.optional(),
})
export type CaseStudy = z.infer<typeof caseStudySchema>

export const experienceSchema = baseItemSchema.extend({
  title: z.string().min(1),
  role: z.string().min(1),
  company: z.string().min(1),
  dates: z.string().min(1),
  bullets: z.array(z.string()).default([]),
  imageUrl: z.string().optional().default(''),
})
export type Experience = z.infer<typeof experienceSchema>

/** Real data exists (Make/n8n/Zapier certs) but hasn't been migrated into D1 yet — see the Phase 2 migration's comment. */
export const certificationSchema = baseItemSchema.extend({
  name: z.string().min(1),
  issuer: z.string().min(1),
  issuedDate: z.string().optional().default(''),
  credentialUrl: linkHrefSchema.optional().default(''),
  badgeImageUrl: z.string().optional().default(''),
})
export type Certification = z.infer<typeof certificationSchema>

/** Ships with zero rows for now — see docs/content-model.md. */
export const testimonialSchema = baseItemSchema.extend({
  quote: z.string().min(1),
  authorName: z.string().min(1),
  authorTitle: z.string().optional().default(''),
  authorCompany: z.string().optional().default(''),
  authorPhotoUrl: z.string().optional().default(''),
  relatedServiceId: z.string().nullable().optional(),
  isFeatured: z.boolean().default(false),
})
export type Testimonial = z.infer<typeof testimonialSchema>

/**
 * "Articles" is the renamed-in-DB `resources` table (see migration 0004's
 * comment) — this schema matches what's already stored, it's not new.
 */
export const articleSchema = baseItemSchema.extend({
  slug: slugSchema,
  title: z.string().min(1),
  summary: z.string().min(1),
  category: z.string().optional().default(''),
  contentType: z.string().default('guide'),
  icon: z.string().default('Lightbulb'),
  points: z.array(z.string()).default([]),
  body: z.string().default(''),
  coverImageUrl: z.string().optional().default(''),
  tags: z.array(z.string()).default([]),
  authorName: z.string().default('DevLab Studios'),
  publishedAt: z.string().optional().default(''),
  readingTimeMinutes: z.number().int().nullable().optional(),
  isFeatured: z.boolean().default(false),
  seo: seoSchema.optional(),
})
export type Article = z.infer<typeof articleSchema>

/** The real, newly-defined "downloads/reference" Resources collection. Ships empty. */
export const resourceSchema = baseItemSchema.extend({
  slug: slugSchema,
  title: z.string().min(1),
  description: z.string().optional().default(''),
  resourceType: z.enum(['template', 'checklist', 'external-link', 'download']).default('download'),
  url: requiredLinkHrefSchema,
  icon: z.string().optional().default(''),
  tags: z.array(z.string()).default([]),
  isFeatured: z.boolean().default(false),
})
export type Resource = z.infer<typeof resourceSchema>

export const faqSchema = baseItemSchema.extend({
  context: z.string().default('general'),
  question: z.string().min(1),
  answer: z.string().min(1),
})
export type Faq = z.infer<typeof faqSchema>

export const redirectSchema = z.object({
  id: z.string().optional(),
  fromPath: z.string().min(1).startsWith('/'),
  toPath: requiredLinkHrefSchema,
  statusCode: z.union([z.literal(301), z.literal(302)]).default(301),
  note: z.string().optional().default(''),
})
export type Redirect = z.infer<typeof redirectSchema>

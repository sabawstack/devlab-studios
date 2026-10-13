import { z } from 'zod'
import { linkHrefSchema, refineSafeLinks } from './shared'

/**
 * Schemas for the five content types that predate the schema-driven
 * collections system (services, resources, profile, site-settings, seo —
 * see docs/architecture/decisions/0002-schema-driven-cms.md). Their
 * repositories (src/worker/repositories/content.js) already coerce every
 * field defensively (String(x || '').trim(), etc.), so these schemas match
 * that same leniency — everything is optional/defaulted — rather than
 * imposing new "required field" rules that could reject content that
 * saved fine before. Their actual job is catching structural garbage
 * (a string where an array was expected, null, wrong types) that the
 * repositories' per-field coercion doesn't protect against, per the
 * finding that PUT /api/admin/content/[type] previously validated nothing
 * at all.
 */

const serviceGroupInputSchema = z.object({
  id: z.string().optional(),
  eyebrow: z.string().optional().default(''),
  title: z.string().optional().default(''),
  description: z.string().optional().default(''),
  icon: z.string().optional().default('Settings'),
  capabilities: z.array(z.string()).optional().default([]),
  projectIds: z.array(z.string()).optional().default([]),
  sortOrder: z.union([z.number(), z.string()]).optional(),
  status: z.string().optional(),
})

const processStepInputSchema = z.object({
  id: z.string().optional(),
  title: z.string().optional().default(''),
  description: z.string().optional().default(''),
  icon: z.string().optional().default('Settings'),
  sortOrder: z.union([z.number(), z.string()]).optional(),
})

const faqInputSchema = z.object({
  id: z.string().optional(),
  question: z.string().optional().default(''),
  answer: z.string().optional().default(''),
  sortOrder: z.union([z.number(), z.string()]).optional(),
  status: z.string().optional(),
})

export const servicesContentSchema = z.object({
  solutionGroups: z.array(serviceGroupInputSchema).optional().default([]),
  processSteps: z.array(processStepInputSchema).optional().default([]),
  faqs: z.array(faqInputSchema).optional().default([]),
})

const articleInputSchema = z.object({
  id: z.string().optional(),
  slug: z.string().optional(),
  title: z.string().optional().default(''),
  summary: z.string().optional().default(''),
  category: z.string().optional().default(''),
  contentType: z.string().optional().default('guide'),
  icon: z.string().optional().default('Lightbulb'),
  points: z.array(z.string()).optional().default([]),
  body: z.string().optional().default(''),
  coverImageUrl: z.string().optional().default(''),
  tags: z.array(z.string()).optional().default([]),
  authorName: z.string().optional().default('DevLab Studios'),
  publishedAt: z.string().optional().default(''),
  readingTimeMinutes: z.union([z.number(), z.string(), z.null()]).optional(),
  isFeatured: z.boolean().optional().default(false),
  sortOrder: z.union([z.number(), z.string()]).optional(),
  status: z.string().optional(),
})

export const resourcesContentSchema = z.object({
  posts: z.array(articleInputSchema).optional().default([]),
  guides: z.array(articleInputSchema).optional(),
  playbook: z.array(z.string()).optional().default([]),
})

const navigationItemInputSchema = z.object({
  id: z.string().optional(),
  label: z.string().optional().default(''),
  href: linkHrefSchema.optional().default(''),
  sortOrder: z.union([z.number(), z.string()]).optional(),
  status: z.string().optional(),
})

export const siteSettingsContentSchema = z.object({
  navigation: z.array(navigationItemInputSchema).optional().default([]),
  footer: z.record(z.string(), z.unknown()).optional().default({}),
  ctas: z.record(z.string(), z.unknown()).optional().default({}),
}).superRefine(refineSafeLinks)

const seoPageInputSchema = z.object({
  id: z.string().optional(),
  pageSlug: z.string().optional().default(''),
  metaTitle: z.string().optional().default(''),
  metaDescription: z.string().optional().default(''),
  metaKeywords: z.string().optional().default(''),
  canonicalUrl: z.string().optional().default(''),
  ogTitle: z.string().optional().default(''),
  ogDescription: z.string().optional().default(''),
  ogImage: z.string().optional().default(''),
  twitterTitle: z.string().optional().default(''),
  twitterDescription: z.string().optional().default(''),
  twitterImage: z.string().optional().default(''),
})

export const seoContentSchema = z.object({
  pages: z.array(seoPageInputSchema).optional().default([]),
})

const experienceInputSchema = z.object({
  id: z.string().optional(),
  title: z.string().optional().default(''),
  role: z.string().optional().default(''),
  company: z.string().optional().default(''),
  dates: z.string().optional().default(''),
  bullets: z.array(z.string()).optional().default([]),
  imageUrl: z.string().optional().default(''),
  sortOrder: z.union([z.number(), z.string()]).optional(),
  status: z.string().optional(),
})

export const profileContentSchema = z.object({
  about: z.record(z.string(), z.unknown()).optional().default({}),
  experiences: z.array(experienceInputSchema).optional().default([]),
  skills: z
    .object({
      technical: z.array(z.string()).optional().default([]),
      personal: z.array(z.string()).optional().default([]),
    })
    .optional()
    .default({ technical: [], personal: [] }),
  tools: z.array(z.object({ id: z.string().optional(), key: z.string().optional(), label: z.string().optional().default(''), icon: z.string().optional().default('Wrench'), sortOrder: z.union([z.number(), z.string()]).optional(), status: z.string().optional() })).optional().default([]),
  workflowPatterns: z.array(z.object({ id: z.string().optional(), key: z.string().optional(), label: z.string().optional().default(''), icon: z.string().optional().default('Settings'), sortOrder: z.union([z.number(), z.string()]).optional(), status: z.string().optional() })).optional().default([]),
  systemCharacteristics: z.array(z.object({ id: z.string().optional(), key: z.string().optional(), label: z.string().optional().default(''), icon: z.string().optional().default('Settings'), sortOrder: z.union([z.number(), z.string()]).optional(), status: z.string().optional() })).optional().default([]),
  // `about` is a loose record, so its linkedinUrl/githubUrl/resumeUrl are checked here.
}).superRefine(refineSafeLinks)

export const SINGLETON_CONTENT_SCHEMAS: Record<string, z.ZodTypeAny> = {
  services: servicesContentSchema,
  resources: resourcesContentSchema,
  profile: profileContentSchema,
  'site-settings': siteSettingsContentSchema,
  seo: seoContentSchema,
}

import { z } from 'zod'
import { findUnsafeLinkPaths, isSafeHref, UNSAFE_HREF_MESSAGE } from '../safeHref'

export const contentStatusSchema = z.enum(['draft', 'published', 'archived'])
export type ContentStatus = z.infer<typeof contentStatusSchema>

export const slugSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Slugs must be lowercase, alphanumeric, hyphen-separated.')

export const seoSchema = z.object({
  metaTitle: z.string().max(70).default(''),
  metaDescription: z.string().max(200).default(''),
  metaKeywords: z.string().max(300).optional().default(''),
  canonicalUrl: z.url().optional().or(z.literal('')).default(''),
  ogTitle: z.string().max(70).optional().default(''),
  ogDescription: z.string().max(200).optional().default(''),
  ogImage: z.string().optional().default(''),
  twitterTitle: z.string().max(70).optional().default(''),
  twitterDescription: z.string().max(200).optional().default(''),
  twitterImage: z.string().optional().default(''),
})
export type Seo = z.infer<typeof seoSchema>

export const sortableSchema = z.object({
  sortOrder: z.number().int().default(999),
})

/** Every collection item shares these — id/status/timestamps are set by the repository layer, not the editor. */
export const baseItemSchema = z.object({
  id: z.string().optional(),
  status: contentStatusSchema.default('draft'),
  sortOrder: z.number().int().default(999),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
})

/**
 * A clickable link an editor can set. Refuses javascript:, data:,
 * protocol-relative and every other scheme outside the allow-list in
 * src/lib/safeHref.ts -- the public read path re-applies the same policy.
 */
export const linkHrefSchema = z.string().refine(isSafeHref, { message: UNSAFE_HREF_MESSAGE })
export const requiredLinkHrefSchema = z.string().min(1).refine(isSafeHref, { message: UNSAFE_HREF_MESSAGE })

/**
 * For loosely-typed content (`z.record(...)` blobs): fails validation if any
 * link-named field, at any depth, holds an unsafe URL.
 */
export function refineSafeLinks(data: unknown, ctx: z.RefinementCtx): void {
  for (const path of findUnsafeLinkPaths(data)) {
    ctx.addIssue({ code: 'custom', path, message: UNSAFE_HREF_MESSAGE })
  }
}

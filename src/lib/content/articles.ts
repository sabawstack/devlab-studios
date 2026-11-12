import { getResourcesContent } from '../../worker/repositories/content.js'
import { resourcesContent } from '../../data/resourcesContent.js'
import { getEnv } from '../env'
import { parseLiteMarkdown, type LiteMarkdownBlock } from './liteMarkdown'
import { readingTimeMinutes } from './readingTime'
import { normalizeTopicId } from '../../config/insightTopics.js'

export interface ArticlePost {
  id: string
  slug: string
  title: string
  summary: string
  category: string
  contentType: string
  icon: string
  points: string[]
  body: string
  coverImageUrl: string
  tags: string[]
  authorName: string
  publishedAt: string
  readingTimeMinutes: number | null
  isFeatured: boolean
  sortOrder: number
  status: string
}

export interface ArticlesContentData {
  posts: ArticlePost[]
  playbook: string[]
}

/**
 * Server-side equivalent of the old useResourcesContent() client hook.
 * `articles` is the public-facing name (see docs/content-model.md's
 * Articles/Resources split); the underlying repository function keeps its
 * original name since it also powers the not-yet-renamed admin editor.
 */
export async function loadArticlesContent({ includeDrafts = false }: { includeDrafts?: boolean } = {}): Promise<ArticlesContentData> {
  const env = getEnv()
  if (!env.DB) return resourcesContent

  try {
    // includeDrafts only for a verified draft-preview request (./preview.ts).
    const data = await getResourcesContent(env.DB, { includeDrafts })
    if (!data?.posts?.length) return resourcesContent
    return { posts: data.posts.map(normalizePost), playbook: data.playbook || [] }
  } catch {
    return resourcesContent
  }
}

/**
 * Two things the stored row cannot be trusted for.
 *
 * `readingTimeMinutes` was typed by hand and had drifted — a 300-word post
 * claiming "5 min read". It is derived from the body instead, so the number
 * cannot disagree with the article under it.
 *
 * `contentType` predates the named taxonomy, so older rows still carry 'news'
 * and 'insight'. Normalizing here means one unmigrated row cannot vanish from
 * every filter on the page.
 */
function normalizePost(post: ArticlePost): ArticlePost {
  return {
    ...post,
    contentType: normalizeTopicId(post.contentType),
    readingTimeMinutes: readingTimeMinutes(post.body) ?? post.readingTimeMinutes,
  }
}

export type ArticleBodyBlock = LiteMarkdownBlock

/**
 * Parses the plain-text article body format used by the CMS. Kept as a
 * named re-export for backward compatibility with existing callers — the
 * actual parser is shared with richText page blocks in liteMarkdown.ts.
 */
export const parseArticleBody = parseLiteMarkdown

export function slugifyLabel(value: string | undefined): string {
  return String(value || '').trim().toLowerCase()
}

export function formatArticleDate(value: string | undefined): string {
  if (!value) return ''

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value

  return parsed.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

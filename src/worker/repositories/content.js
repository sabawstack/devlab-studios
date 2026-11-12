import { nowIso, parseJsonField } from '../utils/responses'
import { listCertifications } from './certifications.js'

// These tables accept only 'draft' and 'published'. 'archived' (valid in the
// shared item schema for other collections) means "not public", so it is
// stored as a draft -- never as published.
export function normalizeStatus(value) {
  return value === 'draft' || value === 'archived' ? 'draft' : 'published'
}

function normalizeSortOrder(value, fallback = 999) {
  const normalized = Number(value)
  return Number.isFinite(normalized) ? normalized : fallback
}

function normalizeString(value) {
  return String(value || '').trim()
}

function normalizeStringArray(items) {
  if (!Array.isArray(items)) return []
  return items.map((item) => normalizeString(item)).filter(Boolean)
}

function normalizeInteger(value, fallback = null) {
  const normalized = Number(value)
  return Number.isFinite(normalized) ? normalized : fallback
}

function toServiceGroup(row) {
  return {
    id: row.id,
    eyebrow: row.eyebrow || '',
    title: row.title,
    description: row.description,
    icon: row.icon || 'Settings',
    capabilities: parseJsonField(row.capabilities, []),
    projectIds: parseJsonField(row.project_ids, []),
    sortOrder: Number(row.sort_order) || 999,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function toResource(row) {
  return {
    id: row.id,
    slug: row.slug || row.id,
    title: row.title,
    summary: row.summary,
    category: row.category || '',
    contentType: row.content_type || 'guide',
    icon: row.icon || 'Lightbulb',
    points: parseJsonField(row.points, []),
    body: row.body_markdown || '',
    coverImageUrl: row.cover_image_url || '',
    tags: parseJsonField(row.tags_json, []),
    authorName: row.author_name || 'DevLab Studios',
    publishedAt: row.published_at || '',
    readingTimeMinutes: normalizeInteger(row.reading_time_minutes, null),
    isFeatured: Number(row.is_featured) === 1,
    sortOrder: Number(row.sort_order) || 999,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function toFaq(row) {
  return {
    id: row.id,
    question: row.question,
    answer: row.answer,
    sortOrder: Number(row.sort_order) || 999,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function toExperience(row) {
  return {
    id: row.id,
    title: row.title,
    role: row.role,
    company: row.company,
    dates: row.dates,
    bullets: parseJsonField(row.bullets, []),
    imageUrl: row.image_url || '',
    sortOrder: Number(row.sort_order) || 999,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function toSkill(row) {
  return {
    id: row.id,
    category: row.category,
    label: row.label,
    sortOrder: Number(row.sort_order) || 999,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function toTool(row) {
  return {
    id: row.id,
    key: row.id,
    label: row.label,
    icon: row.icon || 'Wrench',
    sortOrder: Number(row.sort_order) || 999,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function toWorkflowItem(row) {
  return {
    id: row.id,
    key: row.id,
    groupName: row.group_name,
    label: row.label,
    icon: row.icon || 'Settings',
    sortOrder: Number(row.sort_order) || 999,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function toNavigationItem(row) {
  return {
    id: row.id,
    label: row.label,
    href: row.href,
    sortOrder: Number(row.sort_order) || 999,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function toSeoMetadata(row) {
  return {
    id: row.id,
    pageSlug: row.page_slug,
    metaTitle: row.meta_title || '',
    metaDescription: row.meta_description || '',
    metaKeywords: row.meta_keywords || '',
    canonicalUrl: row.canonical_url || '',
    ogTitle: row.og_title || '',
    ogDescription: row.og_description || '',
    ogImage: row.og_image || '',
    twitterTitle: row.twitter_title || '',
    twitterDescription: row.twitter_description || '',
    twitterImage: row.twitter_image || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function buildStatusWhere(includeDrafts) {
  return includeDrafts ? '' : "WHERE status = 'published'"
}

async function listRows(db, sql, bindings = []) {
  const statement = db.prepare(sql)
  const result = bindings.length ? await statement.bind(...bindings).all() : await statement.all()
  return result.results || []
}

/**
 * @template T
 * @param {import('@cloudflare/workers-types').D1Database} db
 * @param {string} key
 * @param {T} [fallback]
 * @returns {Promise<T>}
 */
export async function getSiteSetting(db, key, fallback) {
  const row = await db.prepare('SELECT key, value_json, updated_at FROM site_settings WHERE key = ?').bind(key).first()
  return row ? parseJsonField(row.value_json, fallback) : fallback
}

export async function setSiteSetting(db, key, value) {
  const timestamp = nowIso()
  await db
    .prepare(
      `INSERT INTO site_settings (key, value_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         value_json = excluded.value_json,
         updated_at = excluded.updated_at`,
    )
    .bind(key, JSON.stringify(value), timestamp)
    .run()
}

export async function listServiceGroups(db, { includeDrafts = false } = {}) {
  const rows = await listRows(
    db,
    `SELECT id, eyebrow, title, description, icon, capabilities, project_ids, sort_order, status, created_at, updated_at
     FROM service_groups
     ${buildStatusWhere(includeDrafts)}
     ORDER BY sort_order ASC, updated_at DESC`,
  )
  return rows.map(toServiceGroup)
}

/** Runs as a single db.batch() transaction — see testimonials.js's replaceTestimonials for why. */
export async function replaceServiceGroups(db, groups) {
  const timestamp = nowIso()
  const statements = [db.prepare('DELETE FROM service_groups')]

  for (const [index, group] of (Array.isArray(groups) ? groups : []).entries()) {
    const id = normalizeString(group.id) || crypto.randomUUID()
    statements.push(
      db
        .prepare(
          `INSERT INTO service_groups (
            id, eyebrow, title, description, icon, capabilities, project_ids, sort_order, status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          id,
          normalizeString(group.eyebrow),
          normalizeString(group.title),
          normalizeString(group.description),
          normalizeString(group.icon) || 'Settings',
          JSON.stringify(normalizeStringArray(group.capabilities)),
          JSON.stringify(normalizeStringArray(group.projectIds)),
          normalizeSortOrder(group.sortOrder, (index + 1) * 10),
          normalizeStatus(group.status),
          timestamp,
          timestamp,
        ),
    )
  }

  await db.batch(statements)
}

// NOTE: these functions/exports keep their original "Resources" names since
// they still power the admin content editor's `resources` content type
// (Phase 4), even though the public-facing rename to Articles/Insights is
// done (src/pages/insights.astro, src/pages/api/articles.ts) and the
// underlying table was renamed to `articles` in
// migrations/0004_content_model_v2.sql. See docs/content-model.md for the
// full explanation. The new, real downloads/reference Resources collection
// lives in src/worker/repositories/resourceLibrary.js.
export async function listResources(db, { includeDrafts = false } = {}) {
  const rows = await listRows(
    db,
    `SELECT
       id,
       slug,
       title,
       summary,
       category,
       content_type,
       icon,
       points,
       body_markdown,
       cover_image_url,
       tags_json,
       author_name,
       published_at,
       reading_time_minutes,
       is_featured,
       sort_order,
       status,
       created_at,
       updated_at
     FROM articles
     ${buildStatusWhere(includeDrafts)}
     ORDER BY sort_order ASC, updated_at DESC`,
  )
  return rows.map(toResource)
}

/** Runs as a single db.batch() transaction — see testimonials.js's replaceTestimonials for why. */
export async function replaceResources(db, items) {
  const timestamp = nowIso()
  const statements = [db.prepare('DELETE FROM articles')]

  for (const [index, item] of (Array.isArray(items) ? items : []).entries()) {
    const id = normalizeString(item.id) || crypto.randomUUID()
    statements.push(
      db
        .prepare(
          `INSERT INTO articles (
            id, slug, title, summary, category, content_type, icon, points, body_markdown, cover_image_url, tags_json,
            author_name, published_at, reading_time_minutes, is_featured, sort_order, status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          id,
          normalizeString(item.slug) || id,
          normalizeString(item.title),
          normalizeString(item.summary),
          normalizeString(item.category),
          normalizeString(item.contentType) || 'guide',
          normalizeString(item.icon) || 'Lightbulb',
          JSON.stringify(normalizeStringArray(item.points)),
          normalizeString(item.body),
          normalizeString(item.coverImageUrl),
          JSON.stringify(normalizeStringArray(item.tags)),
          normalizeString(item.authorName) || 'DevLab Studios',
          normalizeString(item.publishedAt),
          normalizeInteger(item.readingTimeMinutes, null),
          item.isFeatured ? 1 : 0,
          normalizeSortOrder(item.sortOrder, (index + 1) * 10),
          normalizeStatus(item.status),
          timestamp,
          timestamp,
        ),
    )
  }

  await db.batch(statements)
}

export async function listFaqs(db, pageSlug, { includeDrafts = false } = {}) {
  const rows = await listRows(
    db,
    `SELECT id, question, answer, sort_order, status, created_at, updated_at
     FROM faqs
     WHERE page_slug = ? ${includeDrafts ? '' : "AND status = 'published'"}
     ORDER BY sort_order ASC, updated_at DESC`,
    [pageSlug],
  )
  return rows.map(toFaq)
}

/** Runs as a single db.batch() transaction — see testimonials.js's replaceTestimonials for why. */
export async function replaceFaqs(db, pageSlug, items) {
  const timestamp = nowIso()
  const statements = [db.prepare('DELETE FROM faqs WHERE page_slug = ?').bind(pageSlug)]

  for (const [index, item] of (Array.isArray(items) ? items : []).entries()) {
    const id = normalizeString(item.id) || crypto.randomUUID()
    statements.push(
      db
        .prepare(
          `INSERT INTO faqs (
            id, page_slug, question, answer, sort_order, status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          id,
          pageSlug,
          normalizeString(item.question),
          normalizeString(item.answer),
          normalizeSortOrder(item.sortOrder, (index + 1) * 10),
          normalizeStatus(item.status),
          timestamp,
          timestamp,
        ),
    )
  }

  await db.batch(statements)
}

export async function listExperiences(db, { includeDrafts = false } = {}) {
  const rows = await listRows(
    db,
    `SELECT id, title, role, company, dates, bullets, image_url, sort_order, status, created_at, updated_at
     FROM experiences
     ${buildStatusWhere(includeDrafts)}
     ORDER BY sort_order ASC, updated_at DESC`,
  )
  return rows.map(toExperience)
}

/** Runs as a single db.batch() transaction — see testimonials.js's replaceTestimonials for why. */
export async function replaceExperiences(db, items) {
  const timestamp = nowIso()
  const statements = [db.prepare('DELETE FROM experiences')]

  for (const [index, item] of (Array.isArray(items) ? items : []).entries()) {
    const id = normalizeString(item.id) || crypto.randomUUID()
    statements.push(
      db
        .prepare(
          `INSERT INTO experiences (
            id, title, role, company, dates, bullets, image_url, sort_order, status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          id,
          normalizeString(item.title),
          normalizeString(item.role),
          normalizeString(item.company),
          normalizeString(item.dates),
          JSON.stringify(normalizeStringArray(item.bullets)),
          normalizeString(item.imageUrl),
          normalizeSortOrder(item.sortOrder, (index + 1) * 10),
          normalizeStatus(item.status),
          timestamp,
          timestamp,
        ),
    )
  }

  await db.batch(statements)
}

export async function listSkills(db, { includeDrafts = false } = {}) {
  const rows = await listRows(
    db,
    `SELECT id, category, label, sort_order, status, created_at, updated_at
     FROM skills
     ${buildStatusWhere(includeDrafts)}
     ORDER BY category ASC, sort_order ASC, updated_at DESC`,
  )
  return rows.map(toSkill)
}

/** Runs as a single db.batch() transaction — see testimonials.js's replaceTestimonials for why. */
export async function replaceSkills(db, items) {
  const timestamp = nowIso()
  const statements = [db.prepare('DELETE FROM skills')]

  for (const [index, item] of (Array.isArray(items) ? items : []).entries()) {
    const id = normalizeString(item.id) || crypto.randomUUID()
    statements.push(
      db
        .prepare(
          `INSERT INTO skills (
            id, category, label, sort_order, status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          id,
          normalizeString(item.category),
          normalizeString(item.label),
          normalizeSortOrder(item.sortOrder, (index + 1) * 10),
          normalizeStatus(item.status),
          timestamp,
          timestamp,
        ),
    )
  }

  await db.batch(statements)
}

export async function listTools(db, { includeDrafts = false } = {}) {
  const rows = await listRows(
    db,
    `SELECT id, label, icon, sort_order, status, created_at, updated_at
     FROM tools
     ${buildStatusWhere(includeDrafts)}
     ORDER BY sort_order ASC, updated_at DESC`,
  )
  return rows.map(toTool)
}

/** Runs as a single db.batch() transaction — see testimonials.js's replaceTestimonials for why. */
export async function replaceTools(db, items) {
  const timestamp = nowIso()
  const statements = [db.prepare('DELETE FROM tools')]

  for (const [index, item] of (Array.isArray(items) ? items : []).entries()) {
    const id = normalizeString(item.id || item.key) || crypto.randomUUID()
    statements.push(
      db
        .prepare(
          `INSERT INTO tools (
            id, label, icon, sort_order, status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          id,
          normalizeString(item.label),
          normalizeString(item.icon) || 'Wrench',
          normalizeSortOrder(item.sortOrder, (index + 1) * 10),
          normalizeStatus(item.status),
          timestamp,
          timestamp,
        ),
    )
  }

  await db.batch(statements)
}

export async function listWorkflowItems(db, groupName, { includeDrafts = false } = {}) {
  const rows = await listRows(
    db,
    `SELECT id, group_name, label, icon, sort_order, status, created_at, updated_at
     FROM workflow_items
     WHERE group_name = ? ${includeDrafts ? '' : "AND status = 'published'"}
     ORDER BY sort_order ASC, updated_at DESC`,
    [groupName],
  )
  return rows.map(toWorkflowItem)
}

/** Runs as a single db.batch() transaction — see testimonials.js's replaceTestimonials for why. */
export async function replaceWorkflowItems(db, groupName, items) {
  const timestamp = nowIso()
  const statements = [db.prepare('DELETE FROM workflow_items WHERE group_name = ?').bind(groupName)]

  for (const [index, item] of (Array.isArray(items) ? items : []).entries()) {
    const id = normalizeString(item.id || item.key) || crypto.randomUUID()
    statements.push(
      db
        .prepare(
          `INSERT INTO workflow_items (
            id, group_name, label, icon, sort_order, status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          id,
          groupName,
          normalizeString(item.label),
          normalizeString(item.icon) || 'Settings',
          normalizeSortOrder(item.sortOrder, (index + 1) * 10),
          normalizeStatus(item.status),
          timestamp,
          timestamp,
        ),
    )
  }

  await db.batch(statements)
}

export async function listNavigationItems(db, { includeDrafts = false } = {}) {
  const rows = await listRows(
    db,
    `SELECT id, label, href, sort_order, status, created_at, updated_at
     FROM navigation_items
     ${buildStatusWhere(includeDrafts)}
     ORDER BY sort_order ASC, updated_at DESC`,
  )
  return rows.map(toNavigationItem)
}

/** Runs as a single db.batch() transaction — see testimonials.js's replaceTestimonials for why. */
export async function replaceNavigationItems(db, items) {
  const timestamp = nowIso()
  const statements = [db.prepare('DELETE FROM navigation_items')]

  for (const [index, item] of (Array.isArray(items) ? items : []).entries()) {
    const id = normalizeString(item.id) || crypto.randomUUID()
    statements.push(
      db
        .prepare(
          `INSERT INTO navigation_items (
            id, label, href, sort_order, status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          id,
          normalizeString(item.label),
          normalizeString(item.href),
          normalizeSortOrder(item.sortOrder, (index + 1) * 10),
          normalizeStatus(item.status),
          timestamp,
          timestamp,
        ),
    )
  }

  await db.batch(statements)
}

export async function listSeoMetadata(db) {
  const rows = await listRows(
    db,
    `SELECT
       id,
       page_slug,
       meta_title,
       meta_description,
       meta_keywords,
       canonical_url,
       og_title,
       og_description,
       og_image,
       twitter_title,
       twitter_description,
       twitter_image,
       created_at,
       updated_at
     FROM seo_metadata
     ORDER BY page_slug ASC`,
  )
  return rows.map(toSeoMetadata)
}

export async function getSeoMetadata(db, pageSlug) {
  const row = await db
    .prepare(
      `SELECT
         id,
         page_slug,
         meta_title,
         meta_description,
         meta_keywords,
         canonical_url,
         og_title,
         og_description,
         og_image,
         twitter_title,
         twitter_description,
         twitter_image,
         created_at,
         updated_at
       FROM seo_metadata
       WHERE page_slug = ?`,
    )
    .bind(pageSlug)
    .first()

  return row ? toSeoMetadata(row) : null
}

/** Runs as a single db.batch() transaction — see testimonials.js's replaceTestimonials for why. */
export async function replaceSeoMetadata(db, items) {
  const timestamp = nowIso()
  const statements = [db.prepare('DELETE FROM seo_metadata')]

  for (const item of Array.isArray(items) ? items : []) {
    const pageSlug = normalizeString(item.pageSlug)
    if (!pageSlug) continue

    statements.push(
      db
        .prepare(
          `INSERT INTO seo_metadata (
            id,
            page_slug,
            meta_title,
            meta_description,
            meta_keywords,
            canonical_url,
            og_title,
            og_description,
            og_image,
            twitter_title,
            twitter_description,
            twitter_image,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          normalizeString(item.id) || `seo-${pageSlug}`,
          pageSlug,
          normalizeString(item.metaTitle),
          normalizeString(item.metaDescription),
          normalizeString(item.metaKeywords),
          normalizeString(item.canonicalUrl),
          normalizeString(item.ogTitle),
          normalizeString(item.ogDescription),
          normalizeString(item.ogImage),
          normalizeString(item.twitterTitle),
          normalizeString(item.twitterDescription),
          normalizeString(item.twitterImage),
          timestamp,
          timestamp,
        ),
    )
  }

  await db.batch(statements)
}

export async function getServicesContent(db, { includeDrafts = false } = {}) {
  const [solutionGroups, processSteps, faqs] = await Promise.all([
    listServiceGroups(db, { includeDrafts }),
    getSiteSetting(db, 'services_process_steps', []),
    listFaqs(db, 'services', { includeDrafts }),
  ])

  return { solutionGroups, processSteps, faqs }
}

export async function replaceServicesContent(db, payload) {
  await replaceServiceGroups(db, payload.solutionGroups)
  await setSiteSetting(db, 'services_process_steps', Array.isArray(payload.processSteps) ? payload.processSteps : [])
  await replaceFaqs(db, 'services', payload.faqs)
  return getServicesContent(db, { includeDrafts: true })
}

export async function getResourcesContent(db, { includeDrafts = false } = {}) {
  const [posts, playbook] = await Promise.all([
    listResources(db, { includeDrafts }),
    getSiteSetting(db, 'resources_playbook', []),
  ])

  return { posts, playbook }
}

export async function replaceResourcesContent(db, payload) {
  await replaceResources(db, payload.posts || payload.guides)
  await setSiteSetting(db, 'resources_playbook', Array.isArray(payload.playbook) ? payload.playbook : [])
  return getResourcesContent(db, { includeDrafts: true })
}

export async function getSiteSettingsContent(db, { includeDrafts = false } = {}) {
  const [navigation, footer, ctas] = await Promise.all([
    listNavigationItems(db, { includeDrafts }),
    getSiteSetting(db, 'site_footer', {}),
    getSiteSetting(db, 'site_ctas', {}),
  ])

  return { navigation, footer, ctas }
}

export async function replaceSiteSettingsContent(db, payload) {
  await replaceNavigationItems(db, payload.navigation)
  await setSiteSetting(db, 'site_footer', payload.footer || {})
  await setSiteSetting(db, 'site_ctas', payload.ctas || {})
  return getSiteSettingsContent(db, { includeDrafts: true })
}

export async function getSeoContent(db) {
  const items = await listSeoMetadata(db)
  return {
    pages: items,
  }
}

export async function replaceSeoContent(db, payload) {
  await replaceSeoMetadata(db, payload.pages)
  return getSeoContent(db)
}

export async function getProfileContent(db, { includeDrafts = false } = {}) {
  const [about, experiences, skillItems, tools, workflowPatterns, systemCharacteristics, certifications] = await Promise.all([
    getSiteSetting(db, 'profile_about', {}),
    listExperiences(db, { includeDrafts }),
    listSkills(db, { includeDrafts }),
    listTools(db, { includeDrafts }),
    listWorkflowItems(db, 'patterns', { includeDrafts }),
    listWorkflowItems(db, 'characteristics', { includeDrafts }),
    listCertifications(db, { includeDrafts }),
  ])

  return {
    about,
    experiences,
    skills: {
      technical: skillItems.filter((item) => item.category === 'technical').map((item) => item.label),
      personal: skillItems.filter((item) => item.category === 'personal').map((item) => item.label),
      items: skillItems,
    },
    tools,
    workflowPatterns,
    systemCharacteristics,
    certifications,
  }
}

export async function replaceProfileContent(db, payload) {
  const technicalSkills = normalizeStringArray(payload.skills?.technical).map((label, index) => ({
    id: `technical-${index + 1}`,
    category: 'technical',
    label,
    sortOrder: (index + 1) * 10,
    status: 'published',
  }))

  const personalSkills = normalizeStringArray(payload.skills?.personal).map((label, index) => ({
    id: `personal-${index + 1}`,
    category: 'personal',
    label,
    sortOrder: (index + 1) * 10,
    status: 'published',
  }))

  await setSiteSetting(db, 'profile_about', payload.about || {})
  await replaceExperiences(db, payload.experiences)
  await replaceSkills(db, [...technicalSkills, ...personalSkills])
  await replaceTools(db, payload.tools)
  await replaceWorkflowItems(db, 'patterns', payload.workflowPatterns)
  await replaceWorkflowItems(db, 'characteristics', payload.systemCharacteristics)

  return getProfileContent(db, { includeDrafts: true })
}

import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { footerSchema, navigationSchema, pageSingletonSchema, profileSchema } from './singletons'
import { certificationSchema, projectRequestSchema, projectSchema, redirectSchema, resourceSchema } from './collections'
import { profileContentSchema, siteSettingsContentSchema } from './legacyContentTypes'
import { siteSettingsContent } from '../../data/siteSettingsContent.js'

const JS = 'javascript:alert(document.cookie)'

function issuesOf(schema: z.ZodTypeAny, value: unknown): string[] {
  const result = schema.safeParse(value)
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'))
}

describe('CMS link fields refuse unsafe URLs at save time', () => {
  it('site-settings (the shape the admin actually PUTs)', () => {
    expect(issuesOf(siteSettingsContentSchema, { navigation: [{ label: 'x', href: JS }] })).toContain('navigation.0.href')
    expect(issuesOf(siteSettingsContentSchema, {
      footer: { quickLinks: [{ label: 'x', href: '/' }], socialLinks: [{ label: 'x', href: 'data:text/html,x' }] },
    })).toContain('footer.socialLinks.0.href')
    expect(issuesOf(siteSettingsContentSchema, { footer: { legalLinks: [{ label: 'x', href: '//evil.example' }] } }))
      .toContain('footer.legalLinks.0.href')
  })

  it('accepts the bundled site settings unchanged', () => {
    expect(siteSettingsContentSchema.safeParse(siteSettingsContent).success).toBe(true)
  })

  it('navigation and footer singleton schemas', () => {
    expect(issuesOf(navigationSchema, { items: [{ label: 'x', href: JS }] })).toContain('items.0.href')
    expect(issuesOf(footerSchema, { quickLinks: [{ label: 'x', href: 'vbscript:x' }] })).toContain('quickLinks.0.href')
  })

  it('page block CTAs', () => {
    const page = {
      slug: 'home',
      title: 'Home',
      blocks: [{ type: 'hero', props: { heading: 'Hi', primaryCta: { label: 'Go', href: JS } } }],
    }
    expect(issuesOf(pageSingletonSchema, page).some((path) => path.endsWith('primaryCta.href'))).toBe(true)

    const safe = { ...page, blocks: [{ type: 'hero', props: { heading: 'Hi', primaryCta: { label: 'Go', href: '/contact' } } }] }
    expect(pageSingletonSchema.safeParse(safe).success).toBe(true)
  })

  it('profile links (typed and loose shapes)', () => {
    expect(issuesOf(profileSchema, { fullName: 'A', linkedinUrl: JS })).toContain('linkedinUrl')
    expect(issuesOf(profileContentSchema, { about: { githubUrl: JS } })).toContain('about.githubUrl')
    expect(profileContentSchema.safeParse({ about: { githubUrl: 'https://github.com/x' } }).success).toBe(true)
  })

  it('collection links', () => {
    const project = { title: 'P', description: 'D', type: 'Website' as const }
    expect(issuesOf(projectSchema, { ...project, liveUrl: JS })).toContain('liveUrl')
    expect(issuesOf(projectRequestSchema, { ...project, sourceUrl: JS })).toContain('sourceUrl')
    expect(projectRequestSchema.safeParse({ ...project, liveUrl: '#', sourceUrl: 'https://github.com/x' }).success).toBe(true)
    expect(issuesOf(certificationSchema, { name: 'n', issuer: 'i', credentialUrl: JS })).toContain('credentialUrl')
    expect(issuesOf(resourceSchema, { slug: 'r', title: 'R', url: JS })).toContain('url')
    expect(issuesOf(redirectSchema, { fromPath: '/a', toPath: JS })).toContain('toPath')
    expect(redirectSchema.safeParse({ fromPath: '/a', toPath: '/b' }).success).toBe(true)
  })
})

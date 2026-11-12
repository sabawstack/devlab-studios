import { describe, expect, it } from 'vitest'
import { getOrganizationSchema, getPersonSchema, getWebsiteSchema } from './schema.js'
import { COMPANY, ORGANIZATION_ID, PERSON_ID } from './company.js'

// SEO-04: one coherent identity in structured data.
describe('Organization schema', () => {
  const org = getOrganizationSchema()

  it('carries the business email, founding date and a city-level address', () => {
    expect(org['@id']).toBe(ORGANIZATION_ID)
    expect(org.email).toBe(COMPANY.publicEmail)
    expect(org.foundingDate).toBe('2026-03-02')
    expect(org.address).toEqual({ '@type': 'PostalAddress', addressLocality: 'Cebu', addressCountry: 'PH' })
  })

  it('references the founder by @id instead of repeating them', () => {
    expect(org.founder).toEqual({ '@id': PERSON_ID })
  })
})

describe('Person schema', () => {
  const person = getPersonSchema({ image: 'https://www.devlabstudios.com/_astro/portrait.webp', credentials: ['AWS Cloud Practitioner'] })

  it('points at the profile, drops the legacy alternate name and works for the Organization @id', () => {
    expect(person['@id']).toBe(PERSON_ID)
    expect(person.url).toBe('https://www.devlabstudios.com/profile')
    expect(person).not.toHaveProperty('alternateName')
    expect(person.worksFor).toEqual({ '@id': ORGANIZATION_ID })
  })

  it('uses the portrait and lists schools and credentials', () => {
    expect(person.image).toBe('https://www.devlabstudios.com/_astro/portrait.webp')
    expect(person.alumniOf.length).toBeGreaterThan(0)
    expect(person.alumniOf.every((school) => school['@type'] === 'CollegeOrUniversity' || school['@type'] === 'EducationalOrganization')).toBe(true)
    expect(person.hasCredential).toEqual([{ '@type': 'EducationalOccupationalCredential', name: 'AWS Cloud Practitioner' }])
  })

  it('is city-level only', () => {
    expect(person.address).toEqual({ '@type': 'PostalAddress', addressLocality: 'Cebu', addressCountry: 'PH' })
  })
})

describe('WebSite schema', () => {
  it('has no SearchAction (the site has no search)', () => {
    expect(getWebsiteSchema()).not.toHaveProperty('potentialAction')
    expect(JSON.stringify(getWebsiteSchema())).not.toMatch(/SearchAction/)
  })
})

describe('no personal data in any schema', () => {
  it('has no personal mailbox, phone or street address', () => {
    const all = JSON.stringify([getOrganizationSchema(), getPersonSchema(), getWebsiteSchema()])
    expect(all).not.toMatch(/@gmail\.com|telephone|streetAddress|postalCode|Lapu-Lapu/i)
  })
})

describe('Article schema (SEO-03)', async () => {
  const { getArticleSchema } = await import('./schema.js')
  const article = { title: 'The cost of a silent failure', summary: 'S', slug: 'silent', publishedAt: '2026-09-01', updatedAt: '2026-10-02T00:00:00.000Z' }

  it('always has an image, both dates, and author/publisher by @id', () => {
    const schema = getArticleSchema(article)
    expect(schema.image).toBe(COMPANY.logo)
    expect(schema.datePublished).toBe('2026-09-01')
    expect(schema.dateModified).toBe('2026-10-02T00:00:00.000Z')
    expect(schema.author['@id']).toBe(PERSON_ID)
    expect(schema.publisher['@id']).toBe(ORGANIZATION_ID)
  })

  it('uses the cover image when there is one', () => {
    expect(getArticleSchema({ ...article, coverImageUrl: 'https://cdn.example/c.webp' }).image).toBe('https://cdn.example/c.webp')
  })
})

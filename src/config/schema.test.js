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
    expect(org.address).toEqual({ '@type': 'PostalAddress', addressLocality: 'Lapu-Lapu City', addressRegion: 'Cebu', addressCountry: 'PH' })
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
    expect(person.address).toEqual({ '@type': 'PostalAddress', addressLocality: 'Lapu-Lapu City', addressRegion: 'Cebu', addressCountry: 'PH' })
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
    expect(all).not.toMatch(/@gmail\.com|telephone|streetAddress|postalCode/i)
  })

  // PROF-02: city-level only, checked by shape rather than by listing real values.
  it('gives every address exactly city, region and country, with no numbers', () => {
    for (const schema of [getOrganizationSchema(), getPersonSchema()]) {
      expect(Object.keys(schema.address).sort()).toEqual(['@type', 'addressCountry', 'addressLocality', 'addressRegion'])
      for (const value of Object.values(schema.address)) expect(String(value)).not.toMatch(/\d/)
    }
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

// CASE-03: write-ups are CreativeWork, authored by the founder and published by the business.
describe('write-up schema (CASE-03)', async () => {
  const { getCreativeWorkSchema } = await import('./schema.js')
  const schema = getCreativeWorkSchema({ slug: 'lead-qualification', title: 'Lead qualification', summary: 'A synthetic summary.', image: 'https://www.devlabstudios.com/x.webp', about: 'Lead intake and follow-up', inOperationSince: '2026-04' })

  it('is a CreativeWork at its own URL', () => {
    expect(schema).toMatchObject({ '@type': 'CreativeWork', name: 'Lead qualification', url: `${COMPANY.url}/work/lead-qualification` })
  })

  it('references the founder and the business by @id', () => {
    expect(schema.author['@id']).toBe(PERSON_ID)
    expect(schema.publisher['@id']).toBe(ORGANIZATION_ID)
  })

  it('carries the image, the service line and the in-operation date only when known', () => {
    expect(schema).toMatchObject({ image: { '@type': 'ImageObject', url: 'https://www.devlabstudios.com/x.webp' }, about: { '@type': 'Service', name: 'Lead intake and follow-up' }, dateCreated: '2026-04' })
    const bare = getCreativeWorkSchema({ slug: 'x', title: 'X', summary: 'Y' })
    expect(bare).not.toHaveProperty('image')
    expect(bare).not.toHaveProperty('about')
    expect(bare).not.toHaveProperty('dateCreated')
  })
})

// BUS-04: structured data names the same markets as the site (owner Q-07).
describe('areaServed (BUS-04)', () => {
  it('lists the Philippines, the United States and Australia on the Organization, Person and Service', async () => {
    const { getServiceSchema } = await import('./schema.js')
    const expected = [{ '@type': 'Country', name: 'Philippines' }, { '@type': 'Country', name: 'United States' }, { '@type': 'Country', name: 'Australia' }]
    expect(getOrganizationSchema().areaServed).toEqual(expected)
    expect(getPersonSchema().areaServed).toEqual(expected)
    expect(getServiceSchema({ id: 'x', title: 'X', description: 'Y', capabilities: [] }).areaServed).toEqual(expected)
  })
})

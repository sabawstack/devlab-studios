import { describe, expect, it } from 'vitest'
import { COMPANY, publicContactEmail } from './company.js'
import { toPublicAbout } from '../lib/content/publicAbout'

describe('publicContactEmail (BUS-05)', () => {
  it('replaces a personal mailbox with the business address', () => {
    expect(publicContactEmail('someone@gmail.com')).toBe(COMPANY.publicEmail)
    expect(publicContactEmail('')).toBe(COMPANY.publicEmail)
    expect(publicContactEmail(undefined)).toBe(COMPANY.publicEmail)
  })

  it('keeps a business address', () => {
    expect(publicContactEmail('hello@devlabstudios.com')).toBe('hello@devlabstudios.com')
    expect(publicContactEmail('Team@Example.co')).toBe('team@example.co')
  })
})

describe('toPublicAbout (PROF-02)', () => {
  const stored = {
    name: 'Founder', role: 'Builder', email: 'founder@gmail.com', phone: '+1 555 0100', dateOfBirth: 'January 1, 2000',
    mobileNumber: '555', location: 'Street 1, Barangay X, Some City, Cebu, 6015', about: 'Text',
  }

  it('never exposes a phone number or date of birth', () => {
    const about = toPublicAbout(stored)
    expect(about).not.toHaveProperty('phone')
    expect(about).not.toHaveProperty('dateOfBirth')
    expect(about).not.toHaveProperty('mobileNumber')
  })

  it('shows the business address and a city-level location', () => {
    const about = toPublicAbout(stored)
    expect(about.email).toBe(COMPANY.publicEmail)
    expect(about.location).toBe(COMPANY.locationLabel)
  })

  it('keeps a location that is already city-level, and everything else', () => {
    const about = toPublicAbout({ ...stored, location: 'Cebu, Philippines' })
    expect(about.location).toBe('Cebu, Philippines')
    expect(about).toMatchObject({ name: 'Founder', role: 'Builder', about: 'Text' })
  })
})

describe('scrubPersonalContacts (BUS-05)', async () => {
  const { scrubPersonalContacts } = await import('./company.js')

  it('replaces personal mailboxes anywhere in stored page content', () => {
    const page = { blocks: [{ type: 'richText', props: { body: 'Write to someone.name+x@Gmail.com or a@yahoo.com.' } }], title: 'Privacy' }
    expect(scrubPersonalContacts(page)).toEqual({
      blocks: [{ type: 'richText', props: { body: `Write to ${COMPANY.publicEmail} or ${COMPANY.publicEmail}.` } }],
      title: 'Privacy',
    })
  })

  it('leaves business addresses and non-strings alone', () => {
    expect(scrubPersonalContacts({ a: 'hello@devlabstudios.com', n: 3, b: true, c: null })).toEqual({ a: 'hello@devlabstudios.com', n: 3, b: true, c: null })
  })
})

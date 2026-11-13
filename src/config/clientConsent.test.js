import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CLIENT_CONSENT } from './clientConsent.js'
import { projectRecords } from '../data/projectRecords.js'

// CASE-04: a client is named or quoted only with an entry in the register.
describe('client consent register (CASE-04)', () => {
  it('every entry records what was agreed, when, and where the proof is kept', () => {
    for (const entry of CLIENT_CONSENT) {
      expect(entry).toMatchObject({ client: expect.any(String), writeup: expect.any(String), consentOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), evidence: expect.any(String) })
    }
  })

  it('no project record names a client without consent', () => {
    const allowed = new Set(CLIENT_CONSENT.filter((entry) => entry.name).map((entry) => entry.client))
    for (const project of projectRecords) {
      const named = String(project.clientName || '').trim()
      if (named) expect(allowed.has(named), `${project.id} names "${named}"`).toBe(true)
    }
  })

  it('no write-up copy carries a client quote without consent', () => {
    const quotes = CLIENT_CONSENT.some((entry) => entry.quote)
    const copy = readFileSync('src/data/pages/work.ts', 'utf8') + readFileSync('src/data/projectRecords.js', 'utf8')
    if (!quotes) expect(copy).not.toMatch(/(testimonial|said the (owner|client)|“[^”]{20,}” ?[—-] ?[A-Z])/i)
  })

  it('the human-readable register exists', () => {
    expect(readFileSync('docs/content/consent.md', 'utf8')).toMatch(/Client consent register/)
  })
})

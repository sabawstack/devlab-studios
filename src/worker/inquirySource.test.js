// Security audit L4 and L7: a public form cannot choose its own leads.source
// (e.g. claim `lead-magnet`), and the legacy contact subject is one line.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { allowedSource, CONTACT_SOURCES, INQUIRY_SOURCES, singleLine } from './inquiryService.js'

const captured = vi.hoisted(() => ({ calls: [] }))
vi.mock('cloudflare:workers', () => ({ env: {} }))
vi.mock('./inquiryService.js', async (importOriginal) => {
  const real = await importOriginal()
  return {
    ...real,
    enforceSubmissionGuards: async () => null,
    submitInquiry: async (_env, args) => {
      captured.calls.push(args)
      return new Response('{"ok":true}', { status: 201 })
    },
  }
})

const { POST: contact } = await import('../pages/api/contact')

describe('allowedSource', () => {
  it('keeps a listed source and replaces anything else with the default', () => {
    expect(allowedSource('devlabstudios-contact-form', CONTACT_SOURCES)).toBe('devlabstudios-contact-form')
    expect(allowedSource(' contact-form ', CONTACT_SOURCES)).toBe('contact-form')
    for (const value of ['lead-magnet', 'anything', '', undefined, null, 42, {}]) {
      expect(allowedSource(value, CONTACT_SOURCES)).toBe('contact-form')
    }
    expect(allowedSource('business-inquiry-form', INQUIRY_SOURCES)).toBe('business-inquiry-form')
    expect(allowedSource('home-final-cta', INQUIRY_SOURCES)).toBe('home-final-cta')
    expect(allowedSource('lead-magnet', INQUIRY_SOURCES)).toBe('inquiry-form')
  })

  it('never lists lead-magnet', () => {
    expect(CONTACT_SOURCES).not.toContain('lead-magnet')
    expect(INQUIRY_SOURCES).not.toContain('lead-magnet')
  })
})

describe('singleLine', () => {
  it('turns CR, LF, NEL and Unicode line separators into spaces', () => {
    const text = ['Hello', 'Bcc: x@example.com', 'a', 'b', 'c'].join('\r\n')
    expect(singleLine(text)).toBe('Hello Bcc: x@example.com a b c')
    expect(singleLine(`a${String.fromCharCode(0x2028)}b${String.fromCharCode(0x2029)}c${String.fromCharCode(0x85)}d`)).toBe('a b c d')
  })
})

describe('POST /api/contact', () => {
  beforeEach(() => {
    captured.calls = []
  })

  const post = (body) => contact({
    request: new Request('https://www.devlabstudios.com/api/contact', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }),
    locals: {},
  })
  const valid = { name: 'Ana', email: 'ana@example.com', subject: 'Hi\r\nBcc: evil@example.com', message: 'Hello' }

  it('records a spoofed lead-magnet source as contact-form', async () => {
    await post({ ...valid, source: 'lead-magnet' })
    expect(captured.calls[0].source).toBe('contact-form')
  })

  it('keeps the contact form\'s own source', async () => {
    await post({ ...valid, source: 'devlabstudios-contact-form' })
    expect(captured.calls[0].source).toBe('devlabstudios-contact-form')
  })

  it('strips line breaks from the subject', async () => {
    await post(valid)
    expect(captured.calls[0].input.subjectOverride).toBe('Hi Bcc: evil@example.com')
  })
})

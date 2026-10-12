import { afterEach, describe, expect, it, vi } from 'vitest'
import { base64Utf8, sendDuprExport } from './duprExport'

afterEach(() => vi.unstubAllGlobals())

const email = { subject: 'DUPR export: Sunday (2026-10-12)', text: 'Hi Mo', html: '<p>Hi Mo</p>' }
const message = { to: 'mo@example.com', email, filename: 'dupr-sunday-2026-10-12.csv', csv: 'matchType,event\r\nD,Café' }

describe('sendDuprExport', () => {
  it('attaches the CSV as base64 and sends from Devlab Pickleball with a reply-to', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 'e1' }) })
    vi.stubGlobal('fetch', fetch)
    const result = await sendDuprExport({ RESEND_API_KEY: 'k', RESEND_FROM_EMAIL: 'hello@devlabstudios.com' }, message)
    expect(result).toEqual({ delivery: 'SENT' })
    const body = JSON.parse(fetch.mock.calls[0][1].body)
    expect(body).toMatchObject({
      from: 'Devlab Pickleball <hello@devlabstudios.com>', to: ['mo@example.com'], reply_to: 'hello@devlabstudios.com',
      subject: email.subject, text: email.text, html: email.html,
      attachments: [{ filename: 'dupr-sunday-2026-10-12.csv', content: base64Utf8(message.csv) }],
    })
    expect(new TextDecoder().decode(Uint8Array.from(atob(body.attachments[0].content), (c) => c.charCodeAt(0)))).toBe(message.csv)
  })

  it('never emails anyone in a test environment, and hands the message back instead', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const result = await sendDuprExport({ RESEND_API_KEY: 'k', PICKLEBALL_TEST_AUTH_ENABLED: 'true' }, message)
    expect(fetch).not.toHaveBeenCalled()
    expect(result).toEqual({ delivery: 'SUPPRESSED', outbox: { to: 'mo@example.com', subject: email.subject, text: 'Hi Mo', filename: message.filename, csv: message.csv } })
  })

  it('fails cleanly with no API key, or when Resend refuses', async () => {
    expect(await sendDuprExport({}, message)).toEqual({ delivery: 'FAILED', reason: 'missing_api_key' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 422, json: async () => ({ message: 'Invalid' }) }))
    expect(await sendDuprExport({ RESEND_API_KEY: 'k' }, message)).toEqual({ delivery: 'FAILED', reason: 'Invalid' })
  })

  it('keeps line breaks and other control characters out of the subject', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 'e1' }) })
    vi.stubGlobal('fetch', fetch)
    const injected = { ...message, email: { ...email, subject: 'DUPR export: Sun\r\nBcc: x@evil.example\u0007 (2026-10-12)' } }
    await sendDuprExport({ RESEND_API_KEY: 'k' }, injected)
    expect(JSON.parse(fetch.mock.calls[0][1].body).subject).toBe('DUPR export: Sun Bcc: x@evil.example (2026-10-12)')
    const suppressed = await sendDuprExport({ PICKLEBALL_TEST_AUTH_ENABLED: 'true' }, injected)
    expect(suppressed).toMatchObject({ outbox: { subject: 'DUPR export: Sun Bcc: x@evil.example (2026-10-12)' } })
  })
})

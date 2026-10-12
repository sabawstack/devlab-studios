import { afterEach, describe, expect, it, vi } from 'vitest'
import { base64Utf8, sendDuprExport, sendOrRelease, type DuprDelivery } from './duprExport'

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
    expect(await sendDuprExport({ RESEND_API_KEY: 'k' }, message)).toEqual({ delivery: 'FAILED', reason: 'upstream_refused' })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')))
    expect(await sendDuprExport({ RESEND_API_KEY: 'k' }, message)).toEqual({ delivery: 'FAILED', reason: 'network_error' })
  })

  it("logs only the status code and a fixed reason, never Resend's own words (they can quote the recipient)", async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 422, json: async () => ({ message: 'mo@example.com is not allowed' }) }))
    await sendDuprExport({ RESEND_API_KEY: 'k' }, message)
    expect(log.mock.calls.map((c) => String(c[0])).join(' ')).not.toMatch(/@|not allowed/)
    expect(JSON.parse(String(log.mock.calls.at(-1)?.[0]))).toEqual({ event: 'pickleball_open.dupr_email', outcome: 'failure', statusCode: 422, reason: 'upstream_refused' })
    log.mockRestore()
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

describe('sendOrRelease', () => {
  const env = { RESEND_API_KEY: 'k' }

  it('keeps the reservation when the email went (or was suppressed)', async () => {
    const release = vi.fn().mockResolvedValue(undefined)
    expect(await sendOrRelease(env, message, release, async () => ({ delivery: 'SENT' }))).toEqual({ delivery: 'SENT' })
    const outbox = { to: 'mo@example.com', subject: 's', text: 't', filename: 'f.csv', csv: 'c' }
    await sendOrRelease(env, message, release, async () => ({ delivery: 'SUPPRESSED', outbox }))
    expect(release).not.toHaveBeenCalled()
  })

  it('gives the export back when sending fails', async () => {
    const release = vi.fn().mockResolvedValue(undefined)
    const failed: DuprDelivery = { delivery: 'FAILED', reason: 'upstream_refused' }
    expect(await sendOrRelease(env, message, release, async () => failed)).toEqual(failed)
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('gives the export back when sending throws, and reports a failure instead of throwing', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const release = vi.fn().mockResolvedValue(undefined)
    const result = await sendOrRelease(env, message, release, async () => { throw new Error('mo@example.com exploded') })
    expect(result).toEqual({ delivery: 'FAILED', reason: 'send_threw' })
    expect(release).toHaveBeenCalledTimes(1)
    expect(log.mock.calls.map((c) => String(c[0])).join(' ')).not.toContain('@')
    log.mockRestore()
  })

  it('still reports the failure when giving the export back fails too', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const release = vi.fn().mockRejectedValue(new Error('do down'))
    const result = await sendOrRelease(env, message, release, async () => ({ delivery: 'FAILED', reason: 'network_error' }))
    expect(result).toEqual({ delivery: 'FAILED', reason: 'network_error' })
    expect(log.mock.calls.map((c) => String(c[0])).join(' ')).toContain('release_failed')
    log.mockRestore()
  })
})

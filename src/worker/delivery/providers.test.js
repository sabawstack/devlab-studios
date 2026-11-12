import { afterEach, describe, expect, it, vi } from 'vitest'
import { createResendProvider } from './providers.js'

afterEach(() => vi.unstubAllGlobals())

function stubFetch(response = { ok: true, status: 200, json: async () => ({ id: 'email-1' }) }) {
  const fetch = vi.fn().mockResolvedValue(response)
  vi.stubGlobal('fetch', fetch)
  return fetch
}

const sentBody = (fetch) => JSON.parse(fetch.mock.calls[0][1].body)

describe('createResendProvider', () => {
  it('keeps the studio sender and sends no attachments key by default', async () => {
    const fetch = stubFetch()
    const result = await createResendProvider({ RESEND_API_KEY: 'k', RESEND_FROM_EMAIL: 'hello@devlabstudios.com' })
      .send({ to: 'a@example.com', subject: 's', text: 't', html: 'h' })
    expect(result).toEqual({ ok: true, statusCode: 200 })
    expect(sentBody(fetch)).toEqual({ from: 'DevLab Studios <hello@devlabstudios.com>', to: ['a@example.com'], subject: 's', text: 't', html: 'h' })
  })

  it('names another sender and passes attachments and reply-to through', async () => {
    const fetch = stubFetch()
    await createResendProvider({ RESEND_API_KEY: 'k' }, { name: 'resend-dupr', fromName: 'Devlab Pickleball' })
      .send({ to: 'a@example.com', replyTo: 'hello@devlabstudios.com', subject: 's', text: 't', html: 'h', attachments: [{ filename: 'x.csv', content: 'YQ==' }] })
    expect(sentBody(fetch)).toMatchObject({
      from: 'Devlab Pickleball <hello@devlabstudios.com>', reply_to: 'hello@devlabstudios.com',
      attachments: [{ filename: 'x.csv', content: 'YQ==' }],
    })
  })

  it('reports an upstream refusal without throwing', async () => {
    stubFetch({ ok: false, status: 422, json: async () => ({ message: 'Invalid attachment' }) })
    const result = await createResendProvider({ RESEND_API_KEY: 'k' }).send({ to: 'a@example.com', subject: 's', text: 't', html: 'h' })
    expect(result).toEqual({ ok: false, statusCode: 422, networkError: false, errorMessage: 'Invalid attachment' })
  })
})

// SEC-06: the webhook proves its origin with an HMAC of timestamp + body; the
// shared secret itself never travels.
describe('createWebhookProvider signing', async () => {
  const { createWebhookProvider, signWebhookBody } = await import('./providers.js')

  async function hmacHex(secret, message) {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
    return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  }

  it('sends sha256=<hmac(timestamp.body)> and a timestamp, never the secret', async () => {
    const fetch = stubFetch()
    await createWebhookProvider({ LEAD_WEBHOOK_URL: 'https://hooks.example.test/in', LEAD_WEBHOOK_SECRET: 'shh-secret' })
      .send({ payload: { id: 'lead-1' } })
    const { headers, body } = fetch.mock.calls[0][1]
    const timestamp = headers['X-DevLab-Timestamp']
    expect(timestamp).toMatch(/^\d{10}$/)
    expect(headers['X-DevLab-Signature']).toBe(`sha256=${await hmacHex('shh-secret', `${timestamp}.${body}`)}`)
    expect(JSON.stringify(headers)).not.toContain('shh-secret')
  })

  it('signWebhookBody is deterministic for a given secret, timestamp and body', async () => {
    expect(await signWebhookBody('k', '1700000000', '{}')).toBe(`sha256=${await hmacHex('k', '1700000000.{}')}`)
  })

  it('sends no signature headers without a secret', async () => {
    const fetch = stubFetch()
    await createWebhookProvider({ LEAD_WEBHOOK_URL: 'https://hooks.example.test/in' }).send({ payload: {} })
    expect(fetch.mock.calls[0][1].headers).not.toHaveProperty('X-DevLab-Signature')
  })
})

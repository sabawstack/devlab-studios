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

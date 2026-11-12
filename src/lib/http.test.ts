import { describe, expect, it } from 'vitest'
import { DEFAULT_MAX_JSON_BYTES, HttpError, adminErrorResponse, readJsonBody } from './http'

function post(body: string, headers: Record<string, string> = {}) {
  return new Request('https://example.test/api/admin/x', { method: 'PUT', body, headers })
}

describe('readJsonBody', () => {
  it('parses a JSON object', async () => {
    expect(await readJsonBody(post('{"a":1}'))).toEqual({ a: 1 })
  })

  it('treats an empty JSON null as an empty object', async () => {
    expect(await readJsonBody(post('null'))).toEqual({})
  })

  it('caps bodies at 256 KB by default', () => {
    expect(DEFAULT_MAX_JSON_BYTES).toBe(256 * 1024)
  })

  it('refuses a declared Content-Length over the cap with 413, without reading', async () => {
    const request = post('{}', { 'content-length': String(DEFAULT_MAX_JSON_BYTES + 1) })
    await expect(readJsonBody(request)).rejects.toMatchObject({ status: 413 })
  })

  it('refuses an actual body over the cap with 413 when no length is declared', async () => {
    const big = JSON.stringify({ blob: 'x'.repeat(DEFAULT_MAX_JSON_BYTES) })
    await expect(readJsonBody(post(big))).rejects.toMatchObject({ status: 413 })
  })

  it('counts bytes, not characters', async () => {
    // 3 bytes per character in UTF-8: under the cap in characters, over it in bytes.
    const big = JSON.stringify({ blob: '€'.repeat(Math.ceil(DEFAULT_MAX_JSON_BYTES / 3) + 10) })
    await expect(readJsonBody(post(big))).rejects.toMatchObject({ status: 413 })
  })

  it('accepts a per-route cap', async () => {
    await expect(readJsonBody(post('{"a":"0123456789"}'), { maxBytes: 8 })).rejects.toMatchObject({ status: 413 })
  })

  it('refuses invalid JSON with 400 instead of throwing a SyntaxError', async () => {
    const error = await readJsonBody(post('{not json')).catch((caught) => caught)
    expect(error).toBeInstanceOf(HttpError)
    expect(error.status).toBe(400)
  })

  it('maps through adminErrorResponse to the same status and message', async () => {
    const response = adminErrorResponse(new HttpError(413, 'Request payload is too large.'))
    expect(response.status).toBe(413)
    expect(await response.json()).toEqual({ error: 'Request payload is too large.' })
  })
})

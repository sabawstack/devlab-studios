import { describe, expect, it } from 'vitest'
import { createPreviewToken, verifyPreviewToken, PREVIEW_TOKEN_TTL_SECONDS } from './previewToken'

const SECRET = 'test-session-secret-long-enough'
const now = new Date('2026-11-12T10:00:00Z')

describe('preview tokens (CMS-04)', () => {
  it('verifies for the page it was issued for, within the hour', async () => {
    const token = await createPreviewToken(SECRET, { type: 'page', id: 'home' }, now)
    expect(await verifyPreviewToken(token, SECRET, { type: 'page', id: 'home' }, new Date(now.getTime() + 59 * 60_000))).toBe(true)
    expect(PREVIEW_TOKEN_TTL_SECONDS).toBe(3600)
  })

  it('refuses another page, another type, an expired token or a tampered one', async () => {
    const token = await createPreviewToken(SECRET, { type: 'page', id: 'home' }, now)
    expect(await verifyPreviewToken(token, SECRET, { type: 'page', id: 'about' }, now)).toBe(false)
    expect(await verifyPreviewToken(token, SECRET, { type: 'article', id: 'home' }, now)).toBe(false)
    expect(await verifyPreviewToken(token, SECRET, { type: 'page', id: 'home' }, new Date(now.getTime() + 3601_000))).toBe(false)
    expect(await verifyPreviewToken(`${token.slice(0, -2)}xx`, SECRET, { type: 'page', id: 'home' }, now)).toBe(false)
    expect(await verifyPreviewToken(token, 'another-secret-entirely-xx', { type: 'page', id: 'home' }, now)).toBe(false)
    expect(await verifyPreviewToken('', SECRET, { type: 'page', id: 'home' }, now)).toBe(false)
    expect(await verifyPreviewToken(null, SECRET, { type: 'page', id: 'home' }, now)).toBe(false)
  })

  it('is never shaped like an admin session token (different prefix and key)', async () => {
    const token = await createPreviewToken(SECRET, { type: 'page', id: 'home' }, now)
    expect(token.startsWith('p1.')).toBe(true)
    expect(token.startsWith('v1.')).toBe(false)
  })

  it('cannot be issued without a secret', async () => {
    await expect(createPreviewToken('', { type: 'page', id: 'home' }, now)).rejects.toThrow()
    expect(await verifyPreviewToken('p1.a.b', '', { type: 'page', id: 'home' }, now)).toBe(false)
  })
})

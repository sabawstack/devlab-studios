import { describe, it, expect } from 'vitest'
import { bytesToBase64Url, base64UrlToBytes, randomBase64Url, randomInt, sha256Base64Url, hmacSign, hmacVerify } from './webCrypto.js'

describe('base64url roundtrip', () => {
  it('encodes and decodes bytes without padding or unsafe characters', () => {
    const original = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255])
    const encoded = bytesToBase64Url(original)
    expect(encoded).not.toMatch(/[+/=]/)
    expect(base64UrlToBytes(encoded)).toEqual(original)
  })
})

describe('randomBase64Url', () => {
  it('produces a different value on each call', () => {
    expect(randomBase64Url(32)).not.toBe(randomBase64Url(32))
  })
})

describe('sha256Base64Url', () => {
  it('is deterministic for the same input', async () => {
    const a = await sha256Base64Url('code-verifier-value')
    const b = await sha256Base64Url('code-verifier-value')
    expect(a).toBe(b)
  })

  it('differs for different input', async () => {
    const a = await sha256Base64Url('one')
    const b = await sha256Base64Url('two')
    expect(a).not.toBe(b)
  })
})

describe('hmacSign / hmacVerify', () => {
  it('verifies a signature produced with the same secret', async () => {
    const signature = await hmacSign('payload', 'secret-value')
    expect(await hmacVerify('payload', signature, 'secret-value')).toBe(true)
  })

  it('rejects a signature produced with a different secret', async () => {
    const signature = await hmacSign('payload', 'secret-value')
    expect(await hmacVerify('payload', signature, 'wrong-secret')).toBe(false)
  })

  it('rejects a tampered payload', async () => {
    const signature = await hmacSign('payload', 'secret-value')
    expect(await hmacVerify('tampered', signature, 'secret-value')).toBe(false)
  })
})

describe('randomInt', () => {
  it('stays in range and reaches every value', () => {
    const seen = new Set()
    for (let i = 0; i < 2000; i += 1) {
      const value = randomInt(6)
      expect(Number.isInteger(value) && value >= 0 && value < 6).toBe(true)
      seen.add(value)
    }
    expect(seen.size).toBe(6)
  })

  it('refuses a range it cannot draw from', () => {
    expect(() => randomInt(0)).toThrow(RangeError)
    expect(() => randomInt(2.5)).toThrow(RangeError)
  })
})

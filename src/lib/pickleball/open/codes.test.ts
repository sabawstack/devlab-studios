import { describe, expect, it } from 'vitest'
import { CODE_ALPHABET, formatPublicCode, generatePublicCode, normalizePublicCode } from './codes'

describe('public codes', () => {
  it('generates 10 characters from the unambiguous alphabet', () => {
    for (let i = 0; i < 200; i += 1) {
      const code = generatePublicCode()
      expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{10}$/)
    }
  })

  it('rejects biased bytes (>= 248) instead of wrapping them', () => {
    const bytes = [255, 250, 248, ...Array.from({ length: 13 }, (_, i) => i)]
    const code = generatePublicCode(() => Uint8Array.from(bytes))
    expect(code).toBe(CODE_ALPHABET.slice(0, 10))
  })

  it('normalizes case, dashes and spaces, and rejects ambiguous letters', () => {
    expect(normalizePublicCode('abcde-23456')).toBe('ABCDE23456')
    expect(normalizePublicCode(' ABCDE 23456 ')).toBe('ABCDE23456')
    expect(normalizePublicCode('ABCDE2345O')).toBeNull()
    expect(normalizePublicCode('ABCDE2345')).toBeNull()
  })

  it('formats for humans as two groups of five', () => {
    expect(formatPublicCode('ABCDE23456')).toBe('ABCDE-23456')
  })
})

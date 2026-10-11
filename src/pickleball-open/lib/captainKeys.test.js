// src/pickleball-open/lib/captainKeys.test.js
import { afterEach, describe, expect, it, vi } from 'vitest'
import { captainKeyFor, captainKeyFromHash, captainLink, forgetCaptainKey, rememberCaptainKey } from './captainKeys'

describe('captain links', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reads the captain key from the fragment only', () => {
    expect(captainKeyFromHash('#cap=abc_DEF-123')).toBe('abc_DEF-123')
    expect(captainKeyFromHash('#x=1&cap=k2')).toBe('k2')
    expect(captainKeyFromHash('#host=k3')).toBeNull()
    expect(captainKeyFromHash('#cap=a/b')).toBeNull()
    expect(captainKeyFromHash('')).toBeNull()
  })

  it('builds the link with the key in the fragment', () => {
    expect(captainLink('https://x.test', 'ABCDE23456', 'k')).toBe('https://x.test/pickleball/s/ABCDE23456#cap=k')
  })

  it('remembers one key per session and forgets it on request', () => {
    const store = new Map()
    vi.stubGlobal('localStorage', { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) })
    rememberCaptainKey('ABCDE23456', 'k1')
    rememberCaptainKey('ABCDE23456', 'k2')
    expect(captainKeyFor('ABCDE23456')).toBe('k2')
    forgetCaptainKey('ABCDE23456')
    expect(captainKeyFor('ABCDE23456')).toBeNull()
  })
})

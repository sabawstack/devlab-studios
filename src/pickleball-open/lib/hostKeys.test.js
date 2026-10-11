import { afterEach, describe, expect, it, vi } from 'vitest'
import { hostKeyFor, hostKeyFromHash, hostedSessions, hostLink, viewerLink } from './hostKeys'

describe('host links', () => {
  it('reads the host key from the fragment only', () => {
    expect(hostKeyFromHash('#host=abc_DEF-123')).toBe('abc_DEF-123')
    expect(hostKeyFromHash('#x=1&host=k2')).toBe('k2')
    expect(hostKeyFromHash('')).toBeNull()
    expect(hostKeyFromHash('#host=')).toBeNull()
    expect(hostKeyFromHash('#host=abc/def')).toBeNull()
  })

  it('builds host and viewer links', () => {
    expect(hostLink('https://x.test', 'ABCDE23456', 'k')).toBe('https://x.test/pickleball/s/ABCDE23456#host=k')
    expect(viewerLink('https://x.test', 'ABCDE23456')).toBe('https://x.test/pickleball/s/ABCDE23456')
  })
})

describe('remembered sessions', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('ignores corrupt storage entries', () => {
    const stored = JSON.stringify([null, 7, 'x', { code: 'A' }, { code: 'B', hostKey: 'k' }])
    vi.stubGlobal('localStorage', { getItem: () => stored, setItem: () => {} })
    expect(hostedSessions()).toEqual([{ code: 'B', hostKey: 'k' }])
    expect(hostKeyFor('B')).toBe('k')
    expect(hostKeyFor('A')).toBeNull()
  })
})

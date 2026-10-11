import { describe, expect, it } from 'vitest'
import { hostKeyFromHash, hostLink, viewerLink } from './hostKeys'

describe('host links', () => {
  it('reads the host key from the fragment only', () => {
    expect(hostKeyFromHash('#host=abc_DEF-123')).toBe('abc_DEF-123')
    expect(hostKeyFromHash('#x=1&host=k2')).toBe('k2')
    expect(hostKeyFromHash('')).toBeNull()
    expect(hostKeyFromHash('#host=')).toBeNull()
  })

  it('builds host and viewer links', () => {
    expect(hostLink('https://x.test', 'ABCDE23456', 'k')).toBe('https://x.test/pickleball/s/ABCDE23456#host=k')
    expect(viewerLink('https://x.test', 'ABCDE23456')).toBe('https://x.test/pickleball/s/ABCDE23456')
  })
})

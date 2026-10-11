import { afterEach, describe, expect, it, vi } from 'vitest'
import { readMe, writeMe } from './me'

describe('me', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('remembers the picked player per session code', () => {
    const store = new Map()
    vi.stubGlobal('localStorage', { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) })
    writeMe('ABCDE23456', 'p1')
    expect(readMe('ABCDE23456')).toBe('p1')
    expect(readMe('ZZZZZ22222')).toBe('')
  })

  it('never throws when storage is blocked', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } })
    expect(() => writeMe('ABCDE23456', 'p1')).not.toThrow()
    expect(readMe('ABCDE23456')).toBe('')
  })
})

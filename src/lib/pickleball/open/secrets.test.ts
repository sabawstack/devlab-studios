import { describe, expect, it } from 'vitest'
import { constantTimeEqual } from './secrets'

describe('constantTimeEqual', () => {
  it('compares equal and unequal strings', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true)
    expect(constantTimeEqual('abc', 'abd')).toBe(false)
    expect(constantTimeEqual('abc', 'abcd')).toBe(false)
    expect(constantTimeEqual('', '')).toBe(true)
  })
})

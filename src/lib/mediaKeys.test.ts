import { describe, expect, it } from 'vitest'
import { isManageableMediaKey, isManageableMediaObject } from './mediaKeys'

describe('isManageableMediaKey', () => {
  it.each([
    'projects/project1-content-repurposing.webp',
    'uploads/3f0c6a1e-2b7d-4d1e-9c55-1a2b3c4d5e6f-photo.webp',
    'logo.png',
  ])('accepts %s', (key) => {
    expect(isManageableMediaKey(key)).toBe(true)
  })

  it.each([
    '',
    'uploads/../secrets.txt',
    './x.webp',
    'uploads//x.webp',
    'uploads/',
    'uploads\\x.webp',
    'uploads/x\u0000.webp',
    `${'a'.repeat(513)}`,
  ])('rejects %j', (key) => {
    expect(isManageableMediaKey(key)).toBe(false)
  })
})

describe('isManageableMediaObject', () => {
  it('accepts stored images', () => {
    expect(isManageableMediaObject('a.webp', { httpMetadata: { contentType: 'image/webp' } })).toBe(true)
    expect(isManageableMediaObject('a.webp', {})).toBe(true)
  })

  it('refuses objects that are not images', () => {
    expect(isManageableMediaObject('backup.sql', { httpMetadata: { contentType: 'application/sql' } })).toBe(false)
    expect(isManageableMediaObject('page.html', { httpMetadata: { contentType: 'text/html' } })).toBe(false)
    // A misleading extension does not override the stored content type.
    expect(isManageableMediaObject('fake.webp', { httpMetadata: { contentType: 'text/plain' } })).toBe(false)
    expect(isManageableMediaObject('notes.txt', {})).toBe(false)
  })
})

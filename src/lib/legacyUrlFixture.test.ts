import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// TEST-01: tests/fixtures/legacy-sitemap.txt froze the externally linked URLs
// before the rebuild, and legacy-urls.spec.js checks each still resolves. A
// redesign must never "fix" a failing legacy URL by editing the fixture, so
// the file is pinned here. Changing it is a deliberate, reviewed decision:
// update the hash and the count in the same commit and say why.
const FIXTURE = 'tests/fixtures/legacy-sitemap.txt'
const SHA256 = '1acc5ec6c630daf12ac0c7d932740ef2f6104a8a0b46a2e6a2a63593247709b7'

describe('frozen legacy URL fixture', () => {
  const text = readFileSync(FIXTURE, 'utf8')

  it('is unchanged', () => expect(createHash('sha256').update(text).digest('hex')).toBe(SHA256))

  it('lists 31 URLs', () => {
    expect(text.split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('#'))).toHaveLength(31)
  })
})

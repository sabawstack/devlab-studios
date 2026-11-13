import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// TEST-01 / SEC-01: this repository is public, so no SQL file under scripts/
// may carry a real person's phone number, date of birth, personal mailbox or
// street-level address. Use synthetic or business values instead. The
// patterns are generic on purpose: a guard must not itself repeat the data.
const PATTERNS = [
  ['phone number', /\+\d{1,3}[ -]?\d{3}[ -]?\d{3}[ -]?\d{4}\b|\b09\d{9}\b/],
  ['phone field with a value', /"(?:phone|mobile|telephone)"\s*:\s*"[^"]+"/i],
  ['date of birth with a value', /"(?:dateOfBirth|birthDate|birthday|dob)"\s*:\s*"[^"]+"/i],
  ['personal mailbox', /@(?:gmail|googlemail|yahoo|outlook|hotmail|icloud)\.com/i],
  ['barangay-level address', /\b(?:barangay|brgy)\b/i],
  ['postal code in an address', /(?:City|Cebu),\s*(?:[A-Za-z .]+,\s*)?\d{4}\b(?!-)/],
]

const sqlFiles = (function files(path) {
  return statSync(path).isFile() ? [path] : readdirSync(path).flatMap((name) => files(join(path, name)))
})('scripts').filter((path) => path.endsWith('.sql'))

/** Line number and kind of each hit; never the value itself. */
function hits(path) {
  return readFileSync(path, 'utf8').split('\n')
    .flatMap((line, index) => PATTERNS.filter(([, pattern]) => pattern.test(line)).map(([kind]) => `line ${index + 1}: ${kind}`))
}

describe('SQL under scripts/ carries no personal data (SEC-01)', () => {
  it('finds the seed and update files', () => {
    expect(sqlFiles).toContain('scripts/cms/seed/cms-content-seed.sql')
    expect(sqlFiles.some((path) => path.startsWith('scripts/cms/updates/'))).toBe(true)
  })

  it.each(sqlFiles)('%s', (path) => expect(hits(path)).toEqual([]))
})

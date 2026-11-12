import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * `.env.example` documents every variable the code reads (audit SEC-01), so a
 * new environment can be set up from it, and lists nothing the code no longer
 * reads (the nine ZOHO_* keys outlived the Zoho integration by months).
 *
 * "Read by the code" = a string field of the Worker `Env` in src/env.d.ts, or
 * an `import.meta.env.VITE_*` read in the front end.
 */
const envTypes = readFileSync('src/env.d.ts', 'utf8')
const example = readFileSync('.env.example', 'utf8')
const wrangler = readFileSync('wrangler.jsonc', 'utf8')

const workerStringVars = [...envTypes.matchAll(/^\s+([A-Z][A-Z0-9_]+)\??:\s*string\b/gm)].map((m) => m[1])
const frontEndVars = ['VITE_CONTACT_API_URL']
const exampleKeys = [...example.matchAll(/^\s*([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1])

/**
 * Read by the code but deliberately not in .env.example, with the reason.
 * Keep this short: anything an operator sets belongs in the example.
 */
const NOT_DOCUMENTED_HERE: Record<string, string> = {
  DRAIN_UNREAD_BODIES: 'local wrangler dev / e2e only; set by playwright.config.js and .dev.vars',
}

describe('.env.example', () => {
  it('finds the variables (guards against a pattern that matches nothing)', () => {
    expect(workerStringVars.length).toBeGreaterThan(20)
    expect(exampleKeys.length).toBeGreaterThan(10)
  })

  it.each(workerStringVars.filter((name) => !(name in NOT_DOCUMENTED_HERE)))(
    'documents %s, which the Worker reads',
    (name) => {
      expect(exampleKeys).toContain(name)
    },
  )

  it.each(exampleKeys)('%s is still read by the code', (name) => {
    expect([...workerStringVars, ...frontEndVars]).toContain(name)
  })

  it('every exception is still read by the code', () => {
    for (const name of Object.keys(NOT_DOCUMENTED_HERE)) expect(workerStringVars).toContain(name)
  })

  it('never carries a value for a secret', () => {
    const secretLike = /(SECRET|TOKEN|PASSWORD|API_KEY|_HASH)$/
    for (const line of example.split('\n')) {
      const match = /^\s*([A-Z][A-Z0-9_]+)=(.*)$/.exec(line)
      if (!match || !secretLike.test(match[1])) continue
      const value = match[2].trim()
      // Empty, or an obvious placeholder.
      expect(value === '' || /your|here|placeholder|example/i.test(value), `${match[1]} has a value`).toBe(true)
    }
  })

  it('agrees with wrangler.jsonc about non-secret vars (each var there is documented)', () => {
    const vars = wrangler.slice(wrangler.indexOf('"vars"'), wrangler.indexOf('}', wrangler.indexOf('"vars"')))
    const names = [...vars.matchAll(/"([A-Z][A-Z0-9_]+)"\s*:/g)].map((m) => m[1])
    expect(names.length).toBeGreaterThan(5)
    for (const name of names) expect(exampleKeys).toContain(name)
  })
})

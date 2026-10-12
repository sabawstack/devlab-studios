/**
 * Gives the e2e static preview server (`astro preview`, port 4173) its own
 * local state, copied from the one `wrangler dev` (port 8787) uses.
 *
 * Both servers used to persist into `.wrangler/state`, so two separate workerd
 * processes had the same D1 SQLite files open and wrote to them at once. Under
 * a full Playwright run that intermittently surfaced as `D1_ERROR ... internal
 * error` on the preview server, and a public page's `goto` hung until the test
 * timed out (2 of 5 full runs on 2026-10-12).
 *
 * The copy starts the preview from the same content the worker sees, so pages
 * render what they always did; after that the two never share a file.
 * astro.config.mjs points the preview at the copy when E2E_STATIC_PERSIST is
 * set (playwright.config.js sets it for the static webServer only).
 *
 * D1 files go through SQLite's online backup, which yields a consistent copy
 * even while wrangler dev is writing (a plain file copy of a database with a
 * live WAL can be torn). Durable Object state (rate limiters, sessions) is
 * deliberately NOT copied: the preview starts with empty counters each run.
 * Observability traces are skipped too (they run to gigabytes).
 *
 * Usage: node scripts/e2e/snapshot-static-state.mjs <target-dir>
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { DatabaseSync, backup } from 'node:sqlite'

const SOURCE = resolve('.wrangler/state/v3')
const COPIED_AS_FILES = ['kv', 'r2', 'images', 'cache']
const D1_DIR = join('d1', 'miniflare-D1DatabaseObject')

const target = process.argv[2]
if (!target) {
  console.error('Usage: node scripts/e2e/snapshot-static-state.mjs <target-dir>')
  process.exit(1)
}
const targetRoot = resolve(target)
if (targetRoot === resolve('.wrangler/state')) {
  console.error('Refusing to snapshot the shared state onto itself.')
  process.exit(1)
}
const targetV3 = join(targetRoot, 'v3')

rmSync(targetRoot, { recursive: true, force: true })
mkdirSync(join(targetV3, D1_DIR), { recursive: true })

if (!existsSync(SOURCE)) {
  // A fresh checkout: nothing to copy, and the preview starts empty just as
  // it would have against an empty shared state.
  console.log(`No ${SOURCE} yet; the static preview starts with empty state.`)
  process.exit(0)
}

for (const dir of COPIED_AS_FILES) {
  const from = join(SOURCE, dir)
  if (existsSync(from)) cpSync(from, join(targetV3, dir), { recursive: true })
}

const d1Source = join(SOURCE, D1_DIR)
const databases = existsSync(d1Source) ? readdirSync(d1Source).filter((name) => name.endsWith('.sqlite')) : []
for (const name of databases) {
  const source = new DatabaseSync(join(d1Source, name), { readOnly: true })
  try {
    await backup(source, join(targetV3, D1_DIR, name))
  } finally {
    source.close()
  }
}

console.log(`Snapshot ${databases.length} D1 database(s) into ${targetRoot} for the static preview.`)

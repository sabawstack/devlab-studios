import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The content-adapter boundary (audit requirement CMS-05).
 *
 * Public pages, layouts and components read content only through
 * src/lib/content/* (and src/lib/publicContent.ts). Those adapters own the
 * D1-or-static-fallback decision, so the store behind them can change -- for
 * example to the EmDash loader in the audit's Option D -- without touching a
 * page. A page importing src/worker/repositories/* directly would bypass the
 * fallback and tie the page to today's tables.
 *
 * API routes (src/pages/api/**) are the write path and may use repositories.
 * The admin app is a separate client and is not scanned.
 */
const ROOT = process.cwd()
const SCANNED_DIRS = ['src/pages', 'src/components', 'src/layouts']
const EXCLUDED = [/^src\/pages\/api\//, /^src\/components\/admin\//]
const SOURCE = /\.(astro|ts|tsx|js|jsx|mjs)$/
const REPOSITORY_IMPORT = /(?:from\s+|import\s*\(\s*|import\s+)['"][^'"]*worker\/repositories\//

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return walk(path)
    return SOURCE.test(name) && !/\.test\./.test(name) ? [path] : []
  })
}

const files = SCANNED_DIRS.flatMap((dir) => walk(join(ROOT, dir)))
  .map((path) => relative(ROOT, path).replace(/\\/g, '/'))
  .filter((path) => !EXCLUDED.some((pattern) => pattern.test(path)))

describe('content-adapter boundary', () => {
  it('scans the public page and component sources', () => {
    expect(files.length).toBeGreaterThan(50)
    expect(files.some((path) => path.endsWith('.astro'))).toBe(true)
  })

  it('detects a repository import (guards against a pattern that matches nothing)', () => {
    expect(REPOSITORY_IMPORT.test("import { listProjects } from '../worker/repositories/projects.js'")).toBe(true)
    expect(REPOSITORY_IMPORT.test("const m = await import('../../worker/repositories/content.js')")).toBe(true)
    expect(REPOSITORY_IMPORT.test("import { loadProjects } from '../lib/content/projects'")).toBe(false)
  })

  it.each(files)('%s reads content only through src/lib/content', (path) => {
    expect(readFileSync(join(ROOT, path), 'utf8')).not.toMatch(REPOSITORY_IMPORT)
  })
})

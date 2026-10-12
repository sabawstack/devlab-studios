// Phase 5 of the free open play spec (docs/superpowers/specs/
// 2026-10-11-pickleball-free-open-play-design.md §12) retired the logged-in
// operator app. These checks keep it retired: only the free-session routes and
// pages exist, the one shared Google callback serves host sign-in alone, and
// none of the old app's files come back.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8')

/** Every file under dir, as repo-relative paths with forward slashes. */
function filesUnder(dir: string): string[] {
  const absolute = join(ROOT, dir)
  if (!existsSync(absolute)) return []
  return readdirSync(absolute).flatMap((name) => {
    const path = join(absolute, name)
    if (statSync(path).isDirectory()) return filesUnder(relative(ROOT, path))
    return [relative(ROOT, path).split('\\').join('/')]
  })
}

describe('the operator app is retired: routes and pages', () => {
  it('the only pickleball API routes are the free-session ones and the Google callback', () => {
    const stray = filesUnder('src/pages/api/pickleball').filter(
      (file) => !file.startsWith('src/pages/api/pickleball/open/') && file !== 'src/pages/api/pickleball/auth/google/callback.ts',
    )
    expect(stray).toEqual([])
  })

  it('the only pickleball pages are the public ones, the free sessions and their socket', () => {
    const allowed = /^src\/pages\/pickleball\/(index|how-it-works|rotation|new|my-sessions)\.astro$|^src\/pages\/pickleball\/s\/|^src\/pages\/pickleball\/rt\/open\//
    expect(filesUnder('src/pages/pickleball').filter((file) => !allowed.test(file))).toEqual([])
  })

  it('the operator SPA and its e2e suites are gone', () => {
    expect(existsSync(join(ROOT, 'src/pickleball-app'))).toBe(false)
    const specs = filesUnder('tests/e2e/pickleball').filter((file) => file.endsWith('.spec.js'))
    expect(specs.filter((file) => !/\/(open-[a-z-]+|pickleball-public-pages)\.spec\.js$/.test(file))).toEqual([])
  })

  it('the Google callback serves host sign-in and nothing else', () => {
    const source = read('src/pages/api/pickleball/auth/google/callback.ts')
    const imports = [...source.matchAll(/from ['"]([^'"]+)['"]/g)].map((match) => match[1])
    expect(imports.sort()).toEqual(['../../../../../lib/env', '../../../../../worker/pickleball/open/hostAuth', 'astro'])
  })

  it('the middleware no longer gates /api/pickleball/ behind the operator session', () => {
    const source = read('src/middleware.ts')
    expect(source).not.toMatch(/requirePickleballSession|PICKLEBALL_API_PREFIX|authContext/)
  })
})

describe('the operator app is retired: SessionCoordinatorDO', () => {
  const wrangler = read('wrangler.jsonc')

  it('no environment binds it any more', () => {
    expect(wrangler).not.toContain('SESSION_COORDINATOR')
    expect(wrangler.match(/\{ "name": "OPEN_SESSION", "class_name": "OpenSessionDO" \}/g)).toHaveLength(2)
    expect(wrangler.match(/\{ "name": "RATE_LIMITER", "class_name": "RateLimiterDO" \}/g)).toHaveLength(2)
  })

  it('production and preview each delete the class with tag v4, after its v1 tag', () => {
    expect(wrangler.match(/\{ "tag": "v4", "deleted_classes": \["SessionCoordinatorDO"\] \}/g)).toHaveLength(2)
    expect(wrangler.match(/\{ "tag": "v1", "new_sqlite_classes": \["SessionCoordinatorDO"\] \}/g)).toHaveLength(2)
  })

  it('the Worker no longer exports it and the env type no longer names it', () => {
    expect(existsSync(join(ROOT, 'src/worker/pickleball/SessionCoordinatorDO.ts'))).toBe(false)
    expect(read('src/worker.ts')).not.toContain('SessionCoordinatorDO')
    expect(read('src/env.d.ts')).not.toContain('SESSION_COORDINATOR')
  })
})

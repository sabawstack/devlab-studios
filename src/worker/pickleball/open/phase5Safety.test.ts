// Phase 5 deletes the old operator app (spec §12) and keeps only oauth.js of
// its auth code. Host sign-in, the claim and the DUPR export must therefore
// import nothing Phase 5 deletes. This reads every file of the free-session
// worker, its repositories, its routes and the DUPR engine, so files added
// later are checked as they land.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOTS = [
  'src/worker/pickleball/open',
  'src/worker/repositories/pickleball/open',
  'src/pages/api/pickleball/open',
  'src/lib/pickleball/open/dupr',
  'src/pickleball-open/host',
]
const DELETED = /pickleball\/(session|authContext|permissions|quota|inviteEmail|SessionCoordinatorDO)(\.js|\.ts)?$|repositories\/pickleball\/(users|memberships|organizationInvites)(\.js)?$|pickleball-app\//

/** Every source file under dir; none while a later task has yet to create it. */
function files(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return files(path)
    return /\.(ts|js|jsx)$/.test(name) && !/\.test\.(ts|js)$/.test(name) ? [path] : []
  })
}

describe('Phase 4 survives Phase 5', () => {
  for (const root of ROOTS) {
    it(`nothing under ${root} imports code Phase 5 deletes`, () => {
      for (const file of files(join(process.cwd(), root))) {
        const source = readFileSync(file, 'utf8')
        for (const [, specifier] of source.matchAll(/from ['"]([^'"]+)['"]/g)) {
          expect(DELETED.test(specifier), `${file} imports ${specifier}`).toBe(false)
        }
      }
    })
  }

  it('the host flow reuses oauth.js, the one old auth file Phase 5 keeps', () => {
    const source = readFileSync(join(process.cwd(), 'src/worker/pickleball/open/hostAuth.ts'), 'utf8')
    expect(source).toContain("from '../oauth.js'")
  })
})

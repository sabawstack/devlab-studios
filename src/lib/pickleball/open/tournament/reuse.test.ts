// The spec reuses the old app's pure tournament modules unchanged (§3.5, §6),
// and Phase 5 deletes the rest of the old app (§12). This pins that the
// reused modules depend on nothing slated for deletion, so Phase 5 can't
// break tournaments by removing a file they quietly import.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const REUSED = ['generateFixtures', 'advanceBracket', 'nextPlayableFixture', 'rankTournamentStandings', 'resolvePoolQualifiers']
const ALLOWED = new Set(REUSED.map((name) => `./${name}`))

function imports(file: string): string[] {
  const source = readFileSync(join(process.cwd(), 'src/lib/pickleball/tournament', `${file}.ts`), 'utf8')
  return [...source.matchAll(/^\s*import[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1])
}

describe('reused tournament modules', () => {
  for (const file of REUSED) {
    it(`${file}.ts imports only other reused modules`, () => {
      for (const specifier of imports(file)) expect(ALLOWED.has(specifier), `${file} imports ${specifier}`).toBe(true)
    })
  }

  it('nothing under open/tournament imports the old app', () => {
    const banned = /(seeding|opi|permissions|quota|scoring\/|sessionStateMachine|queueEngine|pairSelection|authContext|SessionCoordinatorDO)/
    const dir = join(process.cwd(), 'src/lib/pickleball/open/tournament')
    for (const file of readdirSync(dir).filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))) {
      const source = readFileSync(join(dir, file), 'utf8')
      for (const [, specifier] of source.matchAll(/from ['"]([^'"]+)['"]/g)) {
        expect(banned.test(specifier), `${file} imports ${specifier}`).toBe(false)
      }
    }
  })
})

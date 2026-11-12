/**
 * Writes a local `.dev.vars` for the `worker` / `admin-auth` Playwright
 * projects (wrangler dev on :8787), so they run from a fresh checkout and in CI.
 *
 * Every value is a LOCAL TEST FIXTURE, not a credential: the admin is the
 * synthetic smoke-test account from tests/e2e/support/adminSession.js, the
 * session secret is random per checkout, and the switches below are honoured
 * only on localhost (ADMIN_AUTH_DISABLED_LOCAL_ONLY is NOT set; the pickleball
 * test login also requires a loopback host). `.dev.vars` is git-ignored and
 * never deployed.
 *
 *   node scripts/e2e/write-dev-vars.mjs          # keeps an existing .dev.vars
 *   node scripts/e2e/write-dev-vars.mjs --force  # replaces it
 */
import { existsSync, writeFileSync } from 'node:fs'
import { pbkdf2Sync, randomBytes } from 'node:crypto'
import { ADMIN_EMAIL, ADMIN_PASSWORD } from '../../tests/e2e/support/adminSession.js'

const TARGET = '.dev.vars'
const ITERATIONS = 100000 // the only value adminAuth.js accepts; see scripts/cms/hash-admin-password.mjs
const force = process.argv.includes('--force')

if (existsSync(TARGET) && !force) {
  console.log(`${TARGET} already exists; leaving it as it is (pass --force to replace it).`)
  process.exit(0)
}

const base64Url = (buffer) => buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
const salt = randomBytes(16)
const hash = pbkdf2Sync(ADMIN_PASSWORD, salt, ITERATIONS, 32, 'sha256')
const passwordHash = ['pbkdf2_sha256', String(ITERATIONS), base64Url(salt), base64Url(hash)].join('$')

const lines = [
  '# Written by scripts/e2e/write-dev-vars.mjs -- local e2e fixtures only. Never deploy.',
  'ADMIN_AUTH_MODE=password',
  `ADMIN_EMAIL=${ADMIN_EMAIL}`,
  `ADMIN_PASSWORD_HASH=${passwordHash}`,
  `ADMIN_SESSION_SECRET=${randomBytes(32).toString('hex')}`,
  'PICKLEBALL_TEST_AUTH_ENABLED=true',
  'PICKLEBALL_OAUTH_REDIRECT_BASE_URL=http://localhost:8787',
  'DRAIN_UNREAD_BODIES=1',
  '',
]
writeFileSync(TARGET, lines.join('\n'), { mode: 0o600 })
console.log(`Wrote ${TARGET} with local e2e fixtures.`)

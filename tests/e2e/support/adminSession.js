import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'

/**
 * Where the `admin-auth` setup project leaves the signed-in admin's browser
 * state, for specs that opt in with `test.use({ storageState })`.
 *
 * Git-ignored (/playwright/.auth/): it holds a live local session cookie.
 *
 * ONE session is shared by every worker for the whole run, so no test may sign
 * out with it (clicking "Log out" or calling /api/admin/logout revokes the
 * token server-side and every later admin test fails as signed out). A test
 * that needs to sign out must sign in on its own first.
 */
export const ADMIN_STORAGE_STATE = fileURLToPath(new URL('../../../playwright/.auth/admin.json', import.meta.url))

export const ADMIN_EMAIL = 'smoke-test@devlabstudios.com'
export const ADMIN_PASSWORD = 'smoke-test-password-123'

/**
 * Puts the shared admin session into a page that was created WITHOUT it.
 *
 * For suites like admin.spec.js that interleave signed-in tests with
 * unauthenticated `request` checks at the top level: a file-wide
 * `test.use({ storageState })` would also authenticate the `request` fixture
 * and silently turn those "refuses an unauthenticated caller" checks into
 * signed-in calls. Reads the same file the admin-auth setup project wrote, so
 * it never signs in itself.
 */
export async function addSharedAdminSession(page) {
  let saved
  try {
    saved = await readFile(ADMIN_STORAGE_STATE, 'utf8')
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    throw new Error(
      `No shared admin session at ${ADMIN_STORAGE_STATE}. It is written by the admin-auth setup ` +
        'project (tests/e2e/admin.setup.js); run this spec through a project that depends on it ' +
        '(e.g. --project=worker), not with --no-deps.',
    )
  }
  await page.context().addCookies(JSON.parse(saved).cookies)
}

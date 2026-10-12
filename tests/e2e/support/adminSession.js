import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'

/**
 * Where the `admin-auth` setup project leaves the signed-in admin's browser
 * state, for specs that opt in with `test.use({ storageState })`.
 *
 * Git-ignored (/playwright/.auth/): it holds a live local session cookie.
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
  const { cookies } = JSON.parse(await readFile(ADMIN_STORAGE_STATE, 'utf8'))
  await page.context().addCookies(cookies)
}

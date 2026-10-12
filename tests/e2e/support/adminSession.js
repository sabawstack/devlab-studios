import { fileURLToPath } from 'node:url'

/**
 * Where the `admin-auth` setup project leaves the signed-in admin's browser
 * state, for specs that opt in with `test.use({ storageState })`.
 *
 * Git-ignored (/playwright/.auth/): it holds a live local session cookie.
 */
export const ADMIN_STORAGE_STATE = fileURLToPath(new URL('../../../playwright/.auth/admin.json', import.meta.url))

export const ADMIN_EMAIL = 'smoke-test@devlabstudios.com'
export const ADMIN_PASSWORD = 'smoke-test-password-123'

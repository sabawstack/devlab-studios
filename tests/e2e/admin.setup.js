import { test as setup, expect } from '@playwright/test'
import { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_STORAGE_STATE } from './support/adminSession.js'

/**
 * ONE admin sign-in per Playwright RUN, shared by every worker.
 *
 * `/api/admin/login` is rate limited to 20 attempts per source address per 15
 * minutes, counting successes as well as failures, and the local limiter is a
 * Durable Object whose storage persists in .wrangler/state across
 * `wrangler dev` restarts. Signing in "once per worker" was not once: every
 * worker signed in, a worker that failed a test was replaced by a fresh one
 * that signed in again, and two or three back-to-back runs on a many-core
 * machine passed 20 on their own. From then on every login answered "Too many
 * login attempts", and each run failed a different handful of tests -- whichever
 * ones happened to land on a newly started worker -- as a missing "Log out"
 * button. The limit is a deliberate control and stays as it is; the suite
 * stops spending it.
 */
setup('sign in as the smoke-test admin', async ({ page }) => {
  await page.goto('/admin')
  await page.getByLabel('Email').fill(ADMIN_EMAIL)
  await page.getByLabel('Password', { exact: true }).fill(ADMIN_PASSWORD)
  await page.getByRole('button', { name: /sign in/i }).click()

  // Wait for whichever answer arrives, so a spent limiter is reported as that
  // rather than as a "Log out" button that was never found.
  const signedIn = page.getByRole('button', { name: /log ?out/i })
  const refused = page.getByText(/Too many login attempts/i)
  await expect(signedIn.or(refused)).toBeVisible()
  expect(await refused.isVisible(), 'the admin login rate limit is spent; wait for its 15-minute window').toBe(false)
  await expect(signedIn).toBeVisible()

  await page.context().storageState({ path: ADMIN_STORAGE_STATE })
})

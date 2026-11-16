import { test, expect } from '@playwright/test'
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './support/adminSession.js'

/**
 * ADMIN-05: a session that ends while a page is open.
 *
 * Signs in on its OWN session (never the shared one: revoking that would sign
 * out every other admin test in the run). Spends two of the login limiter's 20
 * attempts per 15 minutes: the first sign-in and the one in the dialog.
 */
test('a revoked session asks to sign in again over the page, and keeps what was typed', async ({ page }) => {
  await page.goto('/admin')
  await page.getByLabel('Email').fill(ADMIN_EMAIL)
  await page.getByLabel('Password', { exact: true }).fill(ADMIN_PASSWORD)
  await page.getByRole('button', { name: /sign in/i }).click()
  await expect(page.getByRole('button', { name: /log ?out/i }).first()).toBeVisible()

  await page.goto('/admin/lead-crm/suppression')
  await expect(page.getByRole('heading', { name: 'Suppression', level: 1 })).toBeVisible()
  const value = page.getByLabel('Value')
  await value.fill('unsaved-draft@example.org')

  // Revoked server-side, as an expiry or a sign-out elsewhere would.
  const revoked = await page.request.post('/api/admin/logout')
  expect(revoked.ok()).toBe(true)

  // Any request now: the list reloads when the filter changes.
  await page.getByLabel('Show removed entries').check()
  const dialog = page.getByRole('dialog', { name: 'Sign in again' })
  await expect(dialog).toBeVisible()
  // Over the page, not instead of it: the router and the form are still there.
  await expect(value).toHaveValue('unsaved-draft@example.org')
  await expect(dialog.getByLabel('Email')).toHaveValue(ADMIN_EMAIL)
  await expect(dialog.getByLabel('Password')).toBeFocused()

  await dialog.getByLabel('Password').fill(ADMIN_PASSWORD)
  await dialog.getByRole('button', { name: 'Sign in' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(value).toHaveValue('unsaved-draft@example.org')
  // The refused request was sent again and the screen is usable.
  await expect(page.getByText(/Nothing suppressed\.|Removed |Value/).first()).toBeVisible()
  const session = await page.request.get('/api/admin/session')
  expect(session.status()).toBe(200)

  // Sign out of this test's own session so it does not linger.
  await page.request.post('/api/admin/logout')
})

test('a wrong password in the dialog is refused there, with the page still underneath', async ({ page }) => {
  await page.goto('/admin')
  await page.getByLabel('Email').fill(ADMIN_EMAIL)
  await page.getByLabel('Password', { exact: true }).fill(ADMIN_PASSWORD)
  await page.getByRole('button', { name: /sign in/i }).click()
  await expect(page.getByRole('button', { name: /log ?out/i }).first()).toBeVisible()
  await page.goto('/admin/lead-crm/suppression')
  await expect(page.getByRole('heading', { name: 'Suppression', level: 1 })).toBeVisible()
  await page.request.post('/api/admin/logout')

  await page.getByLabel('Show removed entries').check()
  const dialog = page.getByRole('dialog', { name: 'Sign in again' })
  await dialog.getByLabel('Password').fill('not-the-password')
  await dialog.getByRole('button', { name: 'Sign in' }).click()
  await expect(dialog.getByRole('alert')).toBeVisible()
  await expect(dialog).toBeVisible()

  // Escape does not dismiss a dialog that must be answered; "Sign out" does.
  await page.keyboard.press('Escape')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible()
})

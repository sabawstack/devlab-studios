import { randomInt, randomUUID } from 'node:crypto'
import { test, expect } from '@playwright/test'
import { addSharedAdminSession } from './support/adminSession.js'

/**
 * October 2026 admin security audit regressions (M1, M2, C1 defence in depth).
 *
 * Named `*.admin.spec.js` so the `worker` project's /admin\.spec\.js/ match
 * picks it up: it needs the wrangler dev worker, its D1 and its RateLimiter DO.
 */

/** A client address no earlier request has used; see admin.spec.js freshClientIp. */
function freshClientIp() {
  return `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`
}

test('saving a javascript: link in site settings is rejected and changes nothing', async ({ page, baseURL }) => {
  await addSharedAdminSession(page)

  const before = await page.request.get(`${baseURL}/api/admin/content/site-settings`)
  expect(before.ok()).toBeTruthy()
  const current = await before.json()

  const response = await page.request.put(`${baseURL}/api/admin/content/site-settings`, {
    data: {
      ...current,
      navigation: [{ label: 'Evil', href: 'javascript:alert(document.cookie)', sortOrder: 1, status: 'published' }],
    },
  })
  expect(response.status()).toBe(400)
  expect((await response.json()).error).toBe('Validation failed.')

  const after = await page.request.get(`${baseURL}/api/admin/content/site-settings`)
  expect(await after.json()).toEqual(current)

  // And the public navbar carries no javascript: link.
  await page.goto('/')
  await expect(page.locator('a[href^="javascript:" i]')).toHaveCount(0)
})

test('a footer social link with a data: URL is rejected', async ({ page, baseURL }) => {
  await addSharedAdminSession(page)
  const current = await (await page.request.get(`${baseURL}/api/admin/content/site-settings`)).json()

  const response = await page.request.put(`${baseURL}/api/admin/content/site-settings`, {
    data: { ...current, footer: { ...(current.footer || {}), socialLinks: [{ label: 'X', href: 'data:text/html,<script>alert(1)</script>' }] } },
  })
  expect(response.status()).toBe(400)
  const { issues } = await response.json()
  expect(issues.some((issue) => issue.path.join('.') === 'footer.socialLinks.0.href')).toBe(true)
})

test('a page block CTA with a javascript: href is rejected', async ({ page, baseURL }) => {
  await addSharedAdminSession(page)
  const current = await (await page.request.get(`${baseURL}/api/admin/pages/about`)).json()

  const response = await page.request.put(`${baseURL}/api/admin/pages/about`, {
    data: {
      ...current,
      title: current.title || 'About',
      blocks: [{ type: 'cta', props: { heading: 'Go', primaryCta: { label: 'Go', href: 'javascript:alert(1)' } } }],
    },
  })
  expect(response.status()).toBe(400)
  // Refused for the link, not for some unrelated missing field.
  const { issues } = await response.json()
  expect(issues.some((issue) => issue.path.join('.').endsWith('primaryCta.href'))).toBe(true)
})

test('admin login locks an account after 10 failures from 10 different addresses', async ({ request, baseURL }) => {
  // A throwaway address that is not an admin: the lock applies per email
  // whether or not the account exists, and locking the shared smoke-test
  // admin would refuse every later sign-in in the run for 15 minutes.
  const email = `lockout-${randomUUID()}@example.com`
  const attempt = (password) => request.post(`${baseURL}/api/admin/login`, {
    headers: { 'cf-connecting-ip': freshClientIp() },
    data: { email, password },
  })

  for (let index = 0; index < 10; index += 1) {
    const response = await attempt(`wrong-password-${index}`)
    expect(response.status(), `attempt ${index + 1}`).toBe(401)
    expect((await response.json()).error).toBe('Invalid email or password.')
  }

  const locked = await attempt('any-password')
  expect(locked.status()).toBe(429)
  expect((await locked.json()).error).toBe('Too many login attempts. Try again later.')
  expect(Number(locked.headers()['retry-after'])).toBeGreaterThan(0)
})

test('an admin route refuses a percent-encoded path without a session', async ({ request, baseURL }) => {
  for (const path of ['/api/%61dmin/session', '/api//admin/session', '/api/%61dmin/leads']) {
    const response = await request.get(`${baseURL}${path}`)
    expect([400, 401, 404], `${path} -> ${response.status()}`).toContain(response.status())
    expect(response.status()).not.toBe(200)
  }
})

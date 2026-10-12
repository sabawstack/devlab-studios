import { test, expect } from '@playwright/test'
import { ADMIN_STORAGE_STATE } from './support/adminSession.js'

/**
 * Daily digest: access control, the admin surface, and the public page's
 * empty state.
 *
 * Deliberately does NOT exercise "Generate now". That run makes four real
 * outbound requests to third-party feeds, so an e2e assertion on its output
 * would be an assertion about someone else's uptime. The pipeline itself —
 * parsing, deduplication, caps, retention, AI degradation — is covered by unit
 * tests that run the real SQL against SQLite (src/worker/digest/*.test.js and
 * src/worker/repositories/digests.test.js).
 */

// Signed in ONCE per run by the admin-auth setup project (tests/e2e/admin.setup.js)
// and reused here, so this suite never spends the rate-limited /api/admin/login.
async function openAdmin(page) {
  await page.goto('/admin')
  await expect(page.getByRole('button', { name: /log ?out/i })).toBeVisible()
}

// A bodyless DELETE carries no Content-Type, and Astro's CSRF check rejects any
// non-GET request that has neither a form-like Content-Type nor a matching
// `Origin`. A browser always sends `Origin`; Playwright's request context does
// not, so these tests send it explicitly rather than weakening the check.
test.describe('digest admin API access control', () => {
  test('every digest endpoint rejects an unauthenticated caller', async ({ request, baseURL }) => {
    const list = await request.get(`${baseURL}/api/admin/digests`)
    expect(list.status()).toBe(401)

    const generate = await request.post(`${baseURL}/api/admin/digests`, { data: {} })
    expect(generate.status()).toBe(401)

    const patch = await request.patch(`${baseURL}/api/admin/digests/does-not-exist`, { data: { status: 'draft' } })
    expect(patch.status()).toBe(401)

    const remove = await request.delete(`${baseURL}/api/admin/digests/does-not-exist`, {
      headers: { Origin: baseURL },
    })
    expect(remove.status()).toBe(401)
  })
})

test.describe('digest admin', () => {
  test.use({ storageState: ADMIN_STORAGE_STATE })

  test.beforeEach(async ({ page }) => {
    await openAdmin(page)
  })

  test('lists digests for an authenticated admin', async ({ page, baseURL }) => {
    const response = await page.request.get(`${baseURL}/api/admin/digests`)
    expect(response.ok()).toBeTruthy()

    const body = await response.json()
    expect(Array.isArray(body.digests)).toBe(true)
  })

  test('rejects an unknown status rather than writing it', async ({ page, baseURL }) => {
    // A missing digest is reported as missing before the status is looked at,
    // so this asserts the 404 path; the 400 path is covered by the unit-level
    // enum check in the route.
    const response = await page.request.patch(`${baseURL}/api/admin/digests/does-not-exist`, {
      data: { status: 'published' },
    })
    expect(response.status()).toBe(404)
  })

  test('reports a missing digest on delete instead of silently succeeding', async ({ page, baseURL }) => {
    const response = await page.request.delete(`${baseURL}/api/admin/digests/does-not-exist`, {
      headers: { Origin: baseURL },
    })
    expect(response.status()).toBe(404)
  })

  test('the Daily Digests page is reachable from the sidebar', async ({ page }) => {
    // The sidebar groups collapse, and only the group matching the current page
    // is open. Reaching a link in another group means expanding it first, which
    // is part of what "reachable from the sidebar" now means.
    const group = page.getByRole('button', { name: 'Content Libraries' })
    if ((await group.getAttribute('aria-expanded')) === 'false') await group.click()

    await page.getByRole('link', { name: 'Daily Digests' }).first().click()

    await expect(page.getByRole('heading', { name: 'Daily Digests', level: 1 })).toBeVisible()
    await expect(page.getByRole('button', { name: /generate now/i })).toBeVisible()
  })
})

test.describe('the public daily log', () => {
  test('renders with its heading and a link back to Insights', async ({ page }) => {
    await page.goto('/insights/daily')

    await expect(page.getByRole('heading', { name: /AI & Automation Daily/i, level: 1 })).toBeVisible()
    await expect(page.getByRole('link', { name: /all insights/i })).toBeVisible()
  })

  test('declares a single canonical URL rather than one per edition', async ({ page }) => {
    await page.goto('/insights/daily')

    const canonical = page.locator('link[rel="canonical"]')
    await expect(canonical).toHaveAttribute('href', 'https://www.devlabstudios.com/insights/daily')
  })

  test('says so plainly when no edition has been generated', async ({ page }) => {
    await page.goto('/insights/daily')

    // The local database starts without digests; once one exists this becomes
    // the dated-sections branch, which is why both are asserted as alternatives
    // rather than the empty state being asserted unconditionally.
    const empty = page.getByRole('heading', { name: /no digest yet/i })
    const editions = page.getByRole('heading', { name: /latest editions/i })

    await expect(empty.or(editions)).toBeVisible()
  })

  test('is listed in the sitemap exactly once', async ({ request, baseURL }) => {
    const response = await request.get(`${baseURL}/sitemap.xml`)
    expect(response.ok()).toBeTruthy()

    const xml = await response.text()
    const matches = xml.match(/<loc>https:\/\/www\.devlabstudios\.com\/insights\/daily<\/loc>/g) || []
    expect(matches).toHaveLength(1)
  })
})

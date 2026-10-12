import { test, expect } from '@playwright/test'
import { FLAG_KEYS } from '../../src/lead-engine/config/flags.js'
import { ADMIN_STORAGE_STATE } from './support/adminSession.js'

/**
 * Lead CRM end-to-end checks.
 *
 * Focused on the properties that unit tests cannot prove because they are
 * properties of the DEPLOYED application rather than of a module:
 *
 *   1. Every Lead CRM API is actually behind the admin gate. The routes do not
 *      check auth individually — they rely on the blanket middleware — so the
 *      only honest verification is to call them over HTTP without a session.
 *   2. The public tracked redirect never leaves the allow-listed host and never
 *      errors, including when the engine is switched off.
 *   3. The crawler disclosure page is reachable and states the user agent the
 *      crawler actually sends, because the transparent user agent is only
 *      transparent if the URL it names resolves.
 *   4. The CRM screens render inside the existing admin shell rather than as a
 *      separate application.
 *
 * The engine ships with every flag off, so these run against an inert system —
 * which is exactly the state a deploy of this branch produces.
 */

/** Every Lead CRM endpoint, as an unauthenticated caller would reach them. */
const LEAD_CRM_ENDPOINTS = [
  '/api/admin/lead-crm/dashboard',
  '/api/admin/lead-crm/leads',
  '/api/admin/lead-crm/campaigns',
  '/api/admin/lead-crm/replies',
  '/api/admin/lead-crm/conversations',
  '/api/admin/lead-crm/activity',
  '/api/admin/lead-crm/sources',
  '/api/admin/lead-crm/suppression',
  '/api/admin/lead-crm/settings',
  '/api/admin/lead-crm/feature-flags',
  '/api/admin/lead-crm/jobs',
]

/**
 * The admin-auth setup project (tests/e2e/admin.setup.js) signs in ONCE per run;
 * the admin screens below reuse that session, so this suite never spends the
 * rate-limited /api/admin/login.
 */
async function openAdmin(page) {
  await page.goto('/admin')
  await expect(page.getByRole('button', { name: /log ?out/i })).toBeVisible()
}

async function openAdminNavGroup(page, name) {
  const group = page.getByRole('navigation', { name: 'Admin navigation' }).getByRole('button', { name, exact: true })
  if ((await group.getAttribute('aria-expanded')) === 'false') await group.click()
}

test.describe('Lead CRM API authorization', () => {
  test('every Lead CRM endpoint refuses an unauthenticated caller', async ({ request, baseURL }) => {
    for (const path of LEAD_CRM_ENDPOINTS) {
      const response = await request.get(`${baseURL}${path}`)
      expect(response.status(), `${path} must require a session`).toBe(401)
    }
  })

  test('writes are refused too, not just reads', async ({ request, baseURL }) => {
    const writes = [
      ['post', '/api/admin/lead-crm/campaigns', { name: 'x', slug: 'x', countryCode: 'US' }],
      ['post', '/api/admin/lead-crm/suppression', { scope: 'email', value: 'a@b.com', reason: 'manual_block' }],
      ['post', '/api/admin/lead-crm/jobs', { action: 'drain' }],
      ['put', '/api/admin/lead-crm/settings', { key: 'x', value: 1 }],
      ['put', '/api/admin/lead-crm/feature-flags', { key: 'engine', enabled: true }],
    ]

    for (const [method, path, body] of writes) {
      const response = await request[method](`${baseURL}${path}`, { data: body })
      expect(response.status(), `${method.toUpperCase()} ${path} must require a session`).toBe(401)
    }
  })
})

test.describe('public tracked redirect', () => {
  test('an unknown token redirects to the site root rather than erroring', async ({ request, baseURL }) => {
    const response = await request.get(`${baseURL}/r/a-token-that-does-not-exist`, { maxRedirects: 0 })

    expect(response.status()).toBe(302)
    expect(response.headers().location).toBe('https://www.devlabstudios.com/')
  })

  test('never redirects off the allow-listed host', async ({ request, baseURL }) => {
    // Values shaped like traversal or an injected host. None may produce a
    // Location pointing anywhere but devlabstudios.com.
    const hostile = [
      '..%2F..%2Fetc%2Fpasswd',
      'https:%2F%2Fattacker.com',
      '%2F%2Fattacker.com',
      'x'.repeat(200),
    ]

    for (const token of hostile) {
      const response = await request.get(`${baseURL}/r/${token}`, { maxRedirects: 0 })
      const location = response.headers().location

      if (location) {
        expect(new URL(location).hostname, `token "${token}" redirected off-site`).toMatch(/^(www\.)?devlabstudios\.com$/)
      }
    }
  })

  test('is not cacheable, so a click is always recorded', async ({ request, baseURL }) => {
    const response = await request.get(`${baseURL}/r/some-token`, { maxRedirects: 0 })
    expect(response.headers()['cache-control']).toContain('no-store')
  })
})

test.describe('crawler disclosure page', () => {
  test('is reachable and names the exact user agent the crawler sends', async ({ page }) => {
    await page.goto('/crawler')

    await expect(page.getByRole('heading', { name: /About DevLabResearchBot/i })).toBeVisible()
    await expect(page.getByText('DevLabResearchBot/1.0 (+https://www.devlabstudios.com/crawler)')).toBeVisible()
  })

  test('tells a site operator how to block it', async ({ page }) => {
    await page.goto('/crawler')

    await expect(page.getByText('User-agent: DevLabResearchBot')).toBeVisible()
    await expect(page.getByText(/robots\.txt/).first()).toBeVisible()
  })
})

test.describe('Lead CRM admin screens', () => {
  test.use({ storageState: ADMIN_STORAGE_STATE })

  test.beforeEach(async ({ page }) => {
    await openAdmin(page)
  })

  test('appear in the CMS navigation, separate from Inquiries', async ({ page }) => {
    await page.goto('/admin')

    const nav = page.getByRole('navigation', { name: 'Admin navigation' })
    await expect(nav.getByText('Lead CRM', { exact: true })).toBeVisible()
    // The pre-existing inbound inbox must still be there and still be distinct.
    await openAdminNavGroup(page, 'Operations')
    await expect(nav.getByRole('link', { name: 'Inquiries' })).toBeVisible()
  })

  test('highlights only the exact Lead CRM destination', async ({ page }) => {
    await page.goto('/admin/lead-crm/review')

    const nav = page.getByRole('navigation', { name: 'Admin navigation' })
    const review = nav.getByRole('link', { name: 'Review Queue' })
    const leadDashboard = nav.locator('a[href="/admin/lead-crm"]')

    await expect(review).toHaveClass(/admin-nav-link--active/)
    await expect(leadDashboard).not.toHaveClass(/admin-nav-link--active/)
  })

  test('collapses sections and persists compact desktop navigation', async ({ page }) => {
    await page.goto('/admin/lead-crm/review')

    const nav = page.getByRole('navigation', { name: 'Admin navigation' })
    const leadGroup = nav.getByRole('button', { name: 'Lead CRM', exact: true })
    await expect(leadGroup).toHaveAttribute('aria-expanded', 'true')
    await leadGroup.click()
    await expect(nav.getByRole('link', { name: 'Review Queue' })).toHaveCount(0)
    await leadGroup.click()
    await expect(nav.getByRole('link', { name: 'Review Queue' })).toBeVisible()

    await page.getByRole('button', { name: 'Collapse admin navigation' }).click()
    await expect(page.getByRole('button', { name: 'Expand admin navigation' })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('button', { name: 'Expand admin navigation' })).toBeVisible()
  })

  test('the dashboard renders inside the existing admin shell', async ({ page }) => {
    await page.goto('/admin/lead-crm')

    await expect(page.getByRole('heading', { name: 'Lead CRM', level: 1 })).toBeVisible()
    // Still the CMS: same shell, same sign-out control.
    await expect(page.getByRole('button', { name: /log ?out/i })).toBeVisible()
  })

  test('says plainly that the engine is switched off', async ({ page }) => {
    // The shipped state. Without this banner an operator would reasonably
    // conclude the feature is broken rather than disabled.
    await page.goto('/admin/lead-crm')

    await expect(page.getByText(/Lead Intelligence Engine is switched off/i)).toBeVisible()
    await expect(page.getByRole('main').getByRole('link', { name: 'CRM Settings' })).toHaveAttribute(
      'href',
      '/admin/lead-crm/settings',
    )
  })

  test('every CRM screen loads without error', async ({ page }) => {
    const screens = [
      ['/admin/lead-crm/campaigns', 'Campaigns'],
      ['/admin/lead-crm/leads', 'Leads'],
      ['/admin/lead-crm/review', 'Review queue'],
      ['/admin/lead-crm/replies', 'Replies'],
      ['/admin/lead-crm/conversations', 'Conversations'],
      ['/admin/lead-crm/activity', 'Activity'],
      ['/admin/lead-crm/sources', 'Sources'],
      ['/admin/lead-crm/suppression', 'Suppression'],
      ['/admin/lead-crm/settings', 'Lead CRM settings'],
    ]

    for (const [path, heading] of screens) {
      await page.goto(path)
      await expect(page.getByRole('heading', { name: heading, level: 1 }), `${path} did not render`).toBeVisible()
    }
  })

  test('the settings screen exposes safe operational switches and no send switch', async ({ page }) => {
    await page.goto('/admin/lead-crm/settings')

    await expect(page.getByRole('heading', { name: 'Operational switches' })).toBeVisible()
    // Derived, not hard-coded. A literal count went stale the moment two flags
    // were removed with the mailbox integration, and failed here rather than
    // where the change was made.
    await expect(page.getByRole('switch')).toHaveCount(Object.keys(FLAG_KEYS).length)

    // Permitted by the deployment ceiling, and still off until someone turns it
    // on: an operable switch that has not been operated.
    const engine = page.getByRole('switch', { name: 'Engine (master switch) operational switch' })
    await expect(engine).toBeEnabled()
    await expect(engine).not.toBeChecked()

    await expect(page.getByText(/no automated-send switch/i)).toBeVisible()
    // Nothing on THIS application may offer to send mail. Sending, where it
    // happens at all, is an external automation collecting from the outbox -
    // it has no switch here because there is nothing here to switch.
    await expect(page.getByRole('button', { name: /^send$/i })).toHaveCount(0)
    await expect(page.getByRole('switch', { name: /send/i })).toHaveCount(0)
  })

  test('a switch whose deployment ceiling is shut is locked, and says so', async ({ page }) => {
    await page.goto('/admin/lead-crm/settings')

    // Two ceilings ship shut, for different reasons. Campaign schedules is the
    // switch that makes campaigns run unattended and stays shut until a dry run
    // and a real run have both been inspected; browser rendering has no
    // credentials, so an operable switch would fail inside every research job.
    // Both must present as LOCKED rather than as a control that lies.
    for (const label of ['Campaign schedules', 'Browser rendering fallback']) {
      const control = page.getByRole('switch', { name: `${label} operational switch` })

      await expect(control, `${label} should be locked by its ceiling`).toBeDisabled()
      await expect(control).not.toBeChecked()
    }

    await expect(page.getByText(/locked by deployment configuration/i)).toHaveCount(2)
  })

  test('sources expose one lead-intake control instead of internal permission gates', async ({ page }) => {
    await page.goto('/admin/lead-crm/sources')

    await expect(page.getByText('Website research is controlled separately by the Crawler switch')).toBeVisible()
    await expect(page.getByLabel('Allow manual lead import')).toBeVisible()
    await expect(page.getByLabel('Use for automated lead discovery')).toHaveCount(2)
    await expect(page.getByText('Automation allowed', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Crawl allowed', { exact: true })).toHaveCount(0)
  })
})

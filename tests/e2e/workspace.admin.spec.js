import { test, expect } from '@playwright/test'
import { ADMIN_STORAGE_STATE } from './support/adminSession.js'

/**
 * DevLab Workspace (Phase 15, Group 6): the shell, navigation, Home, the
 * environment, the confirmation dialog and the Lead CRM list. Synthetic data;
 * where a screen needs records the local database does not have, the API is
 * stubbed for this test only.
 */
test.use({ storageState: ADMIN_STORAGE_STATE })

const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) })

test.describe('Home and navigation (ADMIN-02, 03, 04, 09)', () => {
  test('Home puts "Needs attention" first, one card per area, and one failing area does not blank the others', async ({ page }) => {
    await page.route('**/api/admin/mailbox/diagnostics', (route) => route.fulfill(json({ error: 'Mailbox store unavailable.' }, 500)))
    await page.goto('/admin')
    await expect(page.getByRole('heading', { name: 'Needs attention', level: 2 })).toBeVisible()
    const headings = await page.getByRole('main').getByRole('heading', { level: 2 }).allTextContents()
    expect(headings[0]).toBe('Needs attention')
    await expect(page.getByTestId('attention-inquiries').getByText('New inquiries to read')).toBeVisible()
    await expect(page.getByTestId('attention-leadCrm').getByText('Qualified leads awaiting review')).toBeVisible()
    await expect(page.getByTestId('attention-mailbox').getByRole('alert')).toContainText('Could not load mailbox')
    await expect(page.getByRole('link', { name: 'Inquiries', exact: true }).first()).toBeVisible()
    await expect(page.getByText(/^Leads$/)).toHaveCount(0)
  })

  test('the sidebar has six areas, no duplicate "Dashboard", and routes are unchanged', async ({ page }) => {
    await page.goto('/admin')
    const nav = page.getByRole('navigation', { name: 'Admin navigation' })
    for (const name of ['Home', 'Inquiries', 'Mailbox']) await expect(nav.getByRole('link', { name, exact: true })).toBeVisible()
    for (const name of ['Website', 'Lead CRM', 'Admin']) await expect(nav.getByRole('button', { name, exact: true })).toBeVisible()
    await expect(nav.getByText('Dashboard', { exact: true })).toHaveCount(0)
    await expect(nav.getByRole('link', { name: 'Inquiries', exact: true })).toHaveAttribute('href', '/admin/leads')
    await nav.getByRole('button', { name: 'Lead CRM', exact: true }).click()
    await expect(nav.getByRole('link', { name: 'Overview' })).toHaveAttribute('href', '/admin/lead-crm')
  })

  test('every page names itself in the header and the tab; an unknown address is "Page not found"', async ({ page }) => {
    await page.goto('/admin/lead-crm/review')
    await expect(page.getByTestId('page-title')).toHaveText('Review queue')
    await expect(page).toHaveTitle('Review queue · Lead CRM · DevLab Workspace')
    await page.goto('/admin/this-does-not-exist')
    await expect(page.getByRole('heading', { name: 'Page not found', level: 1 })).toBeVisible()
    await expect(page).toHaveTitle('Page not found · DevLab Workspace')
    await expect(page.getByRole('navigation', { name: 'Admin navigation' })).toBeVisible()
  })

  test('the environment comes from the server, and the site link says which site', async ({ page }) => {
    const session = await (await page.request.get('/api/admin/session')).json()
    expect(session.environment).toBe('local')
    await page.goto('/admin')
    await expect(page.getByTestId('environment-badge')).toHaveText('Local')
    await expect(page.getByRole('link', { name: 'Open local site' })).toBeVisible()
  })

  test('no horizontal overflow at 1440 and 390 px', async ({ page }) => {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 })
      for (const path of ['/admin', '/admin/lead-crm']) {
        await page.goto(path)
        await expect(page.getByTestId('page-title')).toBeVisible()
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${path} at ${width}`).toBe(true)
        const header = await page.locator('header.admin-header').evaluate((el) => el.scrollWidth <= el.clientWidth + 1)
        expect(header, `header fits at ${width}`).toBe(true)
      }
    }
  })

  test('on a phone the navigation is a dialog: Escape closes it and focus returns', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/admin')
    const open = page.getByRole('button', { name: 'Open admin navigation' })
    await open.click()
    const drawer = page.getByRole('dialog', { name: 'Admin navigation menu' })
    await expect(drawer).toBeVisible()
    await expect(drawer.getByRole('link', { name: 'Inquiries', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(drawer).toHaveCount(0)
    await expect(open).toBeFocused()
  })
})

test.describe('Confirmation dialog (ADMIN-06)', () => {
  test('a typed confirmation stays disabled until it matches, and Escape cancels without acting', async ({ page }) => {
    let erased = false
    await page.route('**/api/admin/privacy/subject*', (route) => {
      if (route.request().method() === 'DELETE') erased = true
      return route.fulfill(json({ inquiries: 0 }))
    })
    await page.goto('/admin/leads')
    await page.getByRole('button', { name: /Privacy requests/ }).click()
    await page.getByLabel('Email address').fill('erase-me@example.org')
    await page.getByRole('button', { name: 'Erase', exact: true }).click()
    const dialog = page.getByRole('alertdialog', { name: 'Erase every inquiry from this address?' })
    const confirm = dialog.getByRole('button', { name: 'Erase', exact: true })
    await expect(confirm).toBeDisabled()
    await dialog.getByLabel(/Type erase-me@example.org to confirm/).fill('erase-me@example.org')
    await expect(confirm).toBeEnabled()
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    expect(erased).toBe(false)
  })

  test('"Mark do not contact" asks whether to suppress the whole domain (decision 7)', async ({ page }) => {
    const reply = {
      id: 'reply-synthetic-2', leadId: 'lead-synthetic-2', companyName: 'Synthetic Bakery', fromAddress: 'owner@example.org',
      receivedAt: '2026-11-16T08:00:00.000Z', subject: 'Re: hello', bodyText: 'Please stop.', analysis: null, suggestedDraft: null,
    }
    let sent = null
    await page.route('**/api/admin/lead-crm/replies', (route) => route.fulfill(json({ replies: [reply] })))
    await page.route('**/api/admin/lead-crm/leads/lead-synthetic-2/actions', (route) => {
      sent = route.request().postDataJSON()
      return route.fulfill(json({ ok: true }))
    })
    await page.goto('/admin/lead-crm/replies')
    await page.getByRole('button', { name: 'Mark do not contact' }).click()
    const dialog = page.getByRole('alertdialog', { name: 'Mark this lead do not contact?' })
    const domain = dialog.getByLabel(/Also suppress every address at example.org/)
    await expect(domain).not.toBeChecked()
    await domain.check()
    await dialog.getByRole('button', { name: 'Mark do not contact' }).click()
    await expect.poll(() => sent).toMatchObject({ action: 'do_not_contact', suppressDomain: true })
  })
})

test.describe('Lead CRM list (CRM-03)', () => {
  test('pages through more than 100 leads, and opens the lead named in ?lead=', async ({ page }) => {
    const requested = []
    await page.route('**/api/admin/lead-crm/leads?*', (route) => {
      const url = new URL(route.request().url())
      requested.push(url.searchParams.get('offset'))
      const offset = Number(url.searchParams.get('offset') ?? 0)
      const leads = Array.from({ length: 3 }, (_, i) => ({
        id: `lead-${offset + i}`, companyName: `Synthetic Co ${offset + i}`, canonicalDomain: `co${offset + i}.example`, stage: 'DISCOVERED',
        priority: 'normal', ruleScore: 10, aiConfidence: null, contactEmail: null, lastActivityAt: null,
      }))
      return route.fulfill(json({ leads, total: 250, limit: 100, offset }))
    })
    let detailRequested = null
    await page.route('**/api/admin/lead-crm/leads/lead-from-mailbox', (route) => {
      detailRequested = true
      return route.fulfill(json({ error: 'Not found.' }, 404))
    })
    await page.goto('/admin/lead-crm/leads')
    await expect(page.getByText('Page 1 of 3')).toBeVisible()
    await page.getByRole('button', { name: 'Next' }).click()
    await expect(page.getByText('Page 2 of 3')).toBeVisible()
    expect(requested).toContain('100')
    // The row opens from the keyboard.
    await page.getByRole('button', { name: 'Synthetic Co 100' }).focus()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/lead=lead-100/)

    await page.goto('/admin/lead-crm/leads?lead=lead-from-mailbox')
    await expect.poll(() => detailRequested).toBe(true)
  })
})

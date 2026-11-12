import { test, expect } from '@playwright/test'

// The interactive pieces of the Blueprint home page (ADR 0014): the failure
// console's tabs, the hero's client-side outage toggle, reduced motion and
// the JavaScript-off fallbacks.

test.describe('failure-mode console', () => {
  test('switches panels by click with the tab state kept in step', async ({ page }) => {
    await page.goto('/')
    const console = page.locator('[data-console]')
    const tabs = console.getByRole('tab')
    await expect(tabs).toHaveCount(4)
    await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true')
    await expect(console.getByRole('tabpanel')).toHaveCount(1)

    await tabs.nth(1).click()
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true')
    await expect(tabs.nth(1)).toHaveAttribute('tabindex', '0')
    await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'false')
    await expect(tabs.nth(0)).toHaveAttribute('tabindex', '-1')
    const panel = console.getByRole('tabpanel')
    await expect(panel).toHaveCount(1)
    await expect(panel).toHaveAttribute('aria-labelledby', await tabs.nth(1).getAttribute('id'))
    await expect(panel).toContainText('02:00')
  })

  test('moves between tabs with arrow keys, Home and End', async ({ page }) => {
    await page.goto('/')
    const tabs = page.locator('[data-console]').getByRole('tab')
    await tabs.nth(0).focus()

    await page.keyboard.press('ArrowDown')
    await expect(tabs.nth(1)).toBeFocused()
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true')

    await page.keyboard.press('End')
    await expect(tabs.nth(3)).toBeFocused()
    await expect(tabs.nth(3)).toHaveAttribute('aria-selected', 'true')

    await page.keyboard.press('ArrowRight')
    await expect(tabs.nth(0)).toBeFocused()

    await page.keyboard.press('ArrowUp')
    await expect(tabs.nth(3)).toBeFocused()

    await page.keyboard.press('Home')
    await expect(tabs.nth(0)).toBeFocused()
    await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true')
    // Only the selected tab is in the tab order.
    expect(await tabs.evaluateAll((elements) => elements.map((element) => element.getAttribute('tabindex')))).toEqual(['0', '-1', '-1', '-1'])
  })
})

test.describe('hero pipeline', () => {
  test('simulates an outage on the client without calling the API', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' })
    const pipeline = page.locator('[data-pipeline]')
    const toggle = pipeline.getByRole('button', { name: 'Simulate outage' })
    const status = pipeline.locator('[data-pipeline-status]')

    const apiCalls = []
    page.on('request', (request) => { if (new URL(request.url()).pathname.startsWith('/api/')) apiCalls.push(request.url()) })

    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await expect(pipeline).toHaveAttribute('data-state', 'nominal')
    await expect(status).toHaveText('Nominal: payload persisted, delivered, handed off.')
    await expect(status).toHaveAttribute('aria-live', 'polite')

    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
    await expect(pipeline).toHaveAttribute('data-state', 'outage')
    await expect(status).toHaveText('Outage: webhook failed. Payload persisted in SQL, retry queued, operator alerted.')
    await expect(pipeline.locator('.pl-retrybox')).toHaveCSS('opacity', '1')

    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await expect(pipeline).toHaveAttribute('data-state', 'nominal')
    await expect(status).toHaveText('Nominal: payload persisted, delivered, handed off.')

    await page.waitForTimeout(300)
    expect(apiCalls).toEqual([])
  })

  test('shows Node as the router, hidden from assistive technology', async ({ page }) => {
    await page.goto('/')
    const node = page.locator('[data-pipeline] .pl-node-nominal svg.node-mascot')
    await expect(node).toHaveAttribute('aria-hidden', 'true')
    await expect(node).toHaveAttribute('data-state', 'active')
  })
})

test('every id on the home page is unique', async ({ page }) => {
  await page.goto('/')
  const ids = await page.evaluate(() => [...document.querySelectorAll('[id]')].map((element) => element.id))
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index)
  expect(duplicates).toEqual([])
})

test('the principal portrait loads when scrolled into view', async ({ page }) => {
  await page.goto('/')
  const portrait = page.locator('[data-principal] img')
  await portrait.scrollIntoViewIfNeeded()
  await expect.poll(() => portrait.evaluate((image) => image.complete && image.naturalWidth)).toBeGreaterThan(0)
})

test.describe('with reduced motion', () => {
  test('pauses every animated drawing and hides the packets', async ({ page }) => {
    // emulateMedia, not test.use({ reducedMotion }): the fixture option did not reach matchMedia here.
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/')
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true)
    const roots = page.locator('svg[data-motion-root]')
    expect(await roots.count()).toBeGreaterThan(0)
    await expect.poll(() => roots.evaluateAll((elements) => elements.every((svg) => svg.dataset.motion === 'off'))).toBe(true)
    // The SVG timeline starts at load and the helper re-pauses then, so poll.
    await expect.poll(() => page.locator('[data-pipeline] > svg').evaluate((svg) => svg.animationsPaused())).toBe(true)
    await expect(page.locator('[data-pipeline] .pl-packets')).toBeHidden()
  })
})

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false })

  test('shows the nominal diagram, every failure mode and no dead toggle', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1, name: "Systems that don't silently fail" })).toBeVisible()
    const pipeline = page.locator('[data-pipeline]')
    await expect(pipeline).toHaveAttribute('data-state', 'nominal')
    await expect(pipeline.locator('svg').first()).toBeVisible()
    await expect(pipeline.locator('[data-pipeline-toggle]')).toBeHidden()

    const panels = page.locator('[data-console-panel]')
    await expect(panels).toHaveCount(4)
    for (let index = 0; index < 4; index += 1) await expect(panels.nth(index)).toBeVisible()
    await expect(page.locator('[data-console] [role="tablist"]')).toBeHidden()
  })
})

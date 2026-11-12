import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { SCENES } from '../../src/config/scenes'

// UX-02 / UX-03 / TEST-04 / TEST-05: the brand review page shows every scene
// and component state; it is the surface the visual and accessibility checks
// run against until the pages themselves are migrated.
const VIEWPORTS = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'desktop', width: 1440, height: 900 },
]

test('every registered scene renders within its byte budget, with a title and description', async ({ page }) => {
  await page.goto('/brand')
  for (const scene of SCENES) {
    const svg = page.locator(`svg[data-scene="${scene.id}"]`).first()
    await expect(svg, scene.id).toBeVisible()
    const markup = await svg.evaluate((element) => element.outerHTML)
    expect(new TextEncoder().encode(markup).length, `${scene.id} bytes`).toBeLessThanOrEqual(scene.byteBudget)
    await expect(svg.locator('title')).toHaveText(scene.title)
    await expect(svg.locator('desc')).toHaveText(scene.alt)
  }
})

for (const viewport of VIEWPORTS) {
  test(`brand page at ${viewport.name} width: no horizontal scroll, scenes keep their aspect ratio`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.goto('/brand')
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width)
    for (const scene of SCENES) {
      const box = await page.locator(`[data-scene-frame="${scene.id}"] .scene-frame__box`).first().boundingBox()
      const [w, h] = scene.aspect.wide
      expect(Math.abs(box.width / box.height - w / h), scene.id).toBeLessThan(0.02)
    }
    await testInfo.attach(`brand-${viewport.name}.png`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
  })
}

test('reduced motion shows every scene finished (no pending draw-in)', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce' })
  const page = await context.newPage()
  await page.goto('/brand')
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  expect(await page.locator('[data-drawn="pending"]').count()).toBe(0)
  await context.close()
})

test('the brand page has no serious or critical accessibility violations', async ({ page }) => {
  await page.goto('/brand')
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  const blocking = results.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact))
  expect(blocking.map((violation) => `${violation.id}: ${violation.nodes.length} node(s)`)).toEqual([])
})

test('the brand page is never indexed', async ({ request }) => {
  const response = await request.get('/brand')
  expect(response.headers()['x-robots-tag']).toMatch(/noindex/)
  expect(await response.text()).toContain('<meta name="robots" content="noindex, nofollow"')
})

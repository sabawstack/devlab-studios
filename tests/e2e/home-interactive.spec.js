import { test, expect } from '@playwright/test'
import { isNodeReady } from '../../src/config/node.js'

import { HOME } from '../../src/data/site/content.js'

// The interactive pieces of the home page (spec H.2, UX-01, UX-02, MASCOT-02):
// the inquiry exhibit's client-side webhook-failure toggle, Node's single
// "receive" run, reduced motion and the JavaScript-off fallback.

test.describe('inquiry exhibit', () => {
  test('simulates an outage on the client without calling the API', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' })
    const pipeline = page.locator('[data-pipeline]')
    const toggle = pipeline.getByRole('button', { name: HOME.exhibit.toggleLabel })
    const status = pipeline.locator('[data-pipeline-status]')

    const apiCalls = []
    page.on('request', (request) => { if (new URL(request.url()).pathname.startsWith('/api/')) apiCalls.push(request.url()) })

    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await expect(pipeline).toHaveAttribute('data-state', 'nominal')
    await expect(status).toHaveText(HOME.exhibit.status.nominal)
    await expect(status).toHaveAttribute('aria-live', 'polite')
    const restingBackground = await toggle.evaluate((button) => getComputedStyle(button).backgroundColor)

    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
    await expect(pipeline).toHaveAttribute('data-state', 'outage')
    await expect(status).toHaveText(HOME.exhibit.status.outage)
    await expect(pipeline.locator('.pl-retrybox')).toHaveCSS('opacity', '1')
    // Spec N.5: the pressed state is visible, not only announced.
    expect(await toggle.evaluate((button) => getComputedStyle(button).backgroundColor)).not.toBe(restingBackground)
    // MASCOT-02: one "receive" run per click, never repeating on its own.
    const node = pipeline.locator('svg.node-mascot')
    if (await node.count()) {
      await expect(node).toHaveAttribute('data-run', 'receive')
      const runs = await node.evaluate((svg) => svg.getAnimations({ subtree: true }).map((animation) => animation.effect.getTiming().iterations))
      expect(runs.every((iterations) => iterations === 1)).toBe(true)
    }

    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await expect(pipeline).toHaveAttribute('data-state', 'nominal')
    await expect(status).toHaveText(HOME.exhibit.status.nominal)

    await page.waitForTimeout(300)
    expect(apiCalls).toEqual([])
  })

  // Spec G.3: one Node at the route step, decorative, once the owner has
  // approved it; until then the route step is a plain checkpoint square.
  test('marks the route step with Node, or a checkpoint until Node is approved', async ({ page }) => {
    await page.goto('/')
    const node = page.locator('[data-pipeline] svg.node-mascot')
    if (isNodeReady('holding')) {
      await expect(node).toHaveCount(1)
      await expect(node).toHaveAttribute('aria-hidden', 'true')
      await expect(node).toHaveAttribute('data-state', 'holding')
    } else {
      await expect(node).toHaveCount(0)
      await expect(page.locator('[data-pipeline] .pl-checkpoint--route .pl-square')).toHaveCount(1)
    }
  })
})

test('every id on the home page is unique', async ({ page }) => {
  await page.goto('/')
  const ids = await page.evaluate(() => [...document.querySelectorAll('[id]')].map((element) => element.id))
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index)
  expect(duplicates).toEqual([])
})

// Owner, 2026-11-13: the home page has no founder strip or portrait.
test('the home page has no founder strip', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('[data-principal], #home-founder')).toHaveCount(0)
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
    await expect.poll(() => page.locator('[data-pipeline] svg.pipeline__svg').evaluate((svg) => svg.animationsPaused())).toBe(true)
    await expect(page.locator('[data-pipeline] .pl-packets')).toBeHidden()
  })
})

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false })

  test('shows the nominal diagram, every problem and no dead toggle', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1, name: HOME.hero.heading.replace(/\.$/, '') })).toBeVisible()
    const pipeline = page.locator('[data-pipeline]')
    await expect(pipeline).toHaveAttribute('data-state', 'nominal')
    await expect(pipeline.locator('svg').first()).toBeVisible()
    await expect(pipeline.locator('[data-pipeline-toggle]')).toBeHidden()

    const problems = page.locator('[data-problem-id]')
    await expect(problems).toHaveCount(4)
    for (let index = 0; index < 4; index += 1) await expect(problems.nth(index)).toBeVisible()
  })
})

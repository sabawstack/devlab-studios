import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

// BR.15 acceptance checks for the redesigned business pages (audit UX-04..UX-12,
// TEST-03..TEST-05). Word budgets come from BR.9; they count the visible text
// of <main> only (navigation and footer excluded).
const PAGES = [
  { path: '/', words: 800, business: true, noStack: true },
  { path: '/solutions', words: 900, business: true, noStack: true },
  { path: '/solutions/lead-intake-and-follow-up', words: 600, business: true },
  { path: '/solutions/workflow-and-ai-automation', words: 600, business: true },
  { path: '/solutions/custom-software-and-operations', words: 600, business: true },
  { path: '/solutions/workflow-systems-audit', words: 500, business: true },
  { path: '/work', words: 500, business: true },
  { path: '/work/automated-lead-qualification', words: 900, business: true },
  { path: '/about', words: 450, business: true },
  { path: '/products', words: 400 },
  { path: '/contact', words: 220 },
  { path: '/profile', words: 900 },
  { path: '/insights', words: 400 + 60 * 20 },
]
const STACK_NAMES = /\b(n8n|Zapier|Make\.com|React|Astro|Cloudflare|OpenAI|Claude|Retell|Laravel|Spring Boot|Tailwind)\b/
const EMPLOYMENT = /available for (full-time|part-time)|hire me|résumé|resume/i

for (const { path, words, business, noStack } of PAGES) {
  test(`${path}: one h1, distinct h2s, mono eyebrows as <p>, within ${words} words`, async ({ page }) => {
    await page.goto(path)
    await expect(page.locator('h1')).toHaveCount(1)
    const h2s = (await page.locator('main h2').allInnerTexts()).map((text) => text.trim().toLowerCase())
    expect(new Set(h2s).size, `duplicate h2 on ${path}: ${h2s.join(' | ')}`).toBe(h2s.length)
    const mainText = await page.locator('main').innerText()
    const count = mainText.split(/\s+/).filter(Boolean).length
    expect(count, `${path} has ${count} words`).toBeLessThanOrEqual(words)
    if (noStack) expect(mainText).not.toMatch(STACK_NAMES)
    if (business) {
      expect((mainText.match(/Stephen Rey Agustinez/g) || []).length, 'founder named at most once').toBeLessThanOrEqual(1)
      expect(mainText).not.toMatch(EMPLOYMENT)
    }
  })
}

for (const viewport of [{ width: 390, height: 844 }, { width: 820, height: 1180 }, { width: 1440, height: 900 }]) {
  test(`primary message and a primary action are on the first screen at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport)
    for (const { path } of PAGES.filter((entry) => entry.path !== '/insights' && entry.path !== '/products')) {
      await page.goto(path)
      await expect(page.locator('h1'), path).toBeInViewport()
      // The page's own primary button, or the header CTA where it shows.
      const primary = page.locator('main .dl-button-primary, main .form-surface button, header.dl-nav .dl-button-primary:visible').first()
      await expect(primary, path).toBeInViewport()
      const box = await primary.boundingBox()
      expect(box.height, `${path} CTA height`).toBeGreaterThanOrEqual(44)
    }
  })
}

test('axe finds no serious or critical issues on the redesigned pages', async ({ page }) => {
  test.setTimeout(120_000)
  for (const { path } of PAGES) {
    await page.goto(path)
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
    const blocking = results.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact))
    expect(blocking.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).slice(0, 3).join(', ')}`), path).toEqual([])
  }
})

test('business pages load only the self-hosted brand fonts and no Google Fonts', async ({ page }) => {
  const external = []
  page.on('request', (request) => { if (/fonts\.(googleapis|gstatic)\.com/.test(request.url())) external.push(request.url()) })
  for (const path of ['/', '/solutions', '/work', '/about', '/contact', '/insights/choosing-what-not-to-automate']) {
    await page.goto(path, { waitUntil: 'load' })
  }
  expect(external).toEqual([])
})

test('every redesigned page names its own social card, and each card is under 200 KB', async ({ page, request }) => {
  for (const { path } of PAGES) {
    await page.goto(path)
    const image = await page.locator('meta[property="og:image"]').getAttribute('content')
    expect(image, path).toMatch(/^https:\/\/www\.devlabstudios\.com\/og(\/[a-z-]+)?\.png$/)
    const response = await request.get(new URL(image).pathname)
    expect(response.status(), image).toBe(200)
    expect((await response.body()).length, image).toBeLessThanOrEqual(200 * 1024)
  }
})

test('with JavaScript off, the pages still show their content and scenes', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()
  for (const path of ['/', '/solutions/workflow-systems-audit', '/work/automated-lead-qualification']) {
    await page.goto(path)
    await expect(page.locator('h1'), path).toBeVisible()
    const scenes = page.locator('[data-scene-frame] svg')
    if (await scenes.count()) await expect(scenes.first(), path).toBeVisible()
  }
  await context.close()
})

test('the products page captures interest through the inquiry form, typed and locked', async ({ page }) => {
  await page.goto('/products')
  const link = page.locator('[data-product-idea]').first().getByRole('link', { name: /Register interest/ })
  await expect(link).toHaveAttribute('href', /\/contact\?type=product_interest&solution=/)
  await link.click()
  await expect(page.getByRole('heading', { level: 1, name: 'Tell us what you would use it for.' })).toBeVisible()
  await expect(page.locator('select[name="inquiryType"]')).toHaveCount(0)
})

test('the contact form groups business options ahead of the employment path', async ({ page }) => {
  await page.goto('/contact')
  const groups = await page.locator('select optgroup').evaluateAll((elements) => elements.map((element) => element.getAttribute('label')))
  expect(groups).toEqual(['A business system', 'Something else', 'Working with Stephen'])
})

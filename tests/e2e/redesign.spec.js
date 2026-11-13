import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

// BR.15 acceptance checks for the redesigned business pages (audit UX-04..UX-12,
// TEST-03..TEST-05). Word budgets come from BR.9; they count the visible text
// of <main> only (navigation and footer excluded).
const PAGES = [
  // The home page shows stack tags on its production-system cards (ADR 0014).
  { path: '/', words: 900, business: true },
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

// BR.12: the sticky header is at most 64 px tall with the primary CTA visible on phones.
for (const width of [320, 390, 820, 1440]) {
  test(`header fits in 64 px with its CTA on one line at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    await page.goto('/')
    const header = page.locator('header.dl-nav')
    expect((await header.boundingBox()).height).toBeLessThanOrEqual(64)
    // Phones get the short label so the header stays on one line at 320 px.
    const cta = header.getByRole('link', { name: width < 640 ? 'Contact us' : /^discuss your system$/i })
    await expect(cta).toBeInViewport()
    expect((await cta.boundingBox()).height).toBeLessThanOrEqual(48)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
  })
}

// The menu sheet must cover the screen and its links must take clicks: a
// containing block on the sticky header once clipped it to 60 px while
// isVisible() still passed.
test('the phone menu opens full-screen and its links navigate', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/about')
  await page.locator('[data-menu-open]').click()
  const sheet = page.locator('#dl-mobile-menu')
  const box = await sheet.boundingBox()
  expect(box.height).toBeGreaterThanOrEqual(844 - 1)
  const links = sheet.getByRole('link')
  await expect(links.last()).toBeInViewport()
  await sheet.getByRole('link', { name: 'Work', exact: true }).click()
  await expect(page).toHaveURL(/\/work$/)
})

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

// TEST-01 / MASCOT-03: Node appears at most twice per page (spec G.3: the home
// exhibit and the offer card; the success state; the 404). The home page shows
// it eleven times until MASCOT-03 lands, so that one case is an expected
// failure that turns red when the fix arrives and must then be un-marked.
for (const path of [...PAGES.map((entry) => entry.path), '/this-page-does-not-exist']) {
  test(`${path}: Node appears at most twice`, async ({ page }) => {
    test.fail(path === '/', 'MASCOT-03 reduces the home page to two instances')
    await page.goto(path)
    expect(await page.locator('.node-mascot').count()).toBeLessThanOrEqual(2)
  })
}

// BRAND-01: every brand page sits on the stone canvas with no grid, glow or
// header blur; only the home hero band is graphite (spec N.1, N.10).
test('brand pages render on stone with no grid, glow or header blur', async ({ page }) => {
  for (const { path } of PAGES) {
    await page.goto(path)
    const styles = await page.evaluate(() => {
      const body = getComputedStyle(document.body)
      const header = getComputedStyle(document.querySelector('header.dl-nav'))
      const before = getComputedStyle(document.querySelector('header.dl-nav'), '::before')
      return { bg: body.backgroundColor, image: body.backgroundImage, blur: header.backdropFilter, beforeBlur: before.backdropFilter }
    })
    expect(styles.bg, path).toBe('rgb(240, 239, 243)')
    expect(styles.image, path).toBe('none')
    expect([styles.blur, styles.beforeBlur].filter((value) => value && value !== 'none'), path).toEqual([])
  }
})

// BRAND-02: the current nav item carries the gradient underline; section
// labels and form labels are plain sentence-case words in the text face.
test('nav underline, section labels and form labels follow spec N.5', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/about')
  const underline = await page.locator('nav[aria-label="Primary"] a[aria-current="page"]').evaluate((link) => getComputedStyle(link, '::after').backgroundImage)
  expect(underline).toMatch(/linear-gradient/)
  await page.goto('/contact')
  const styles = await page.evaluate(() => {
    const read = (element) => ({ transform: getComputedStyle(element).textTransform, font: getComputedStyle(element).fontFamily })
    return { section: read(document.querySelector('main .label')), field: read(document.querySelector('.form-surface label')) }
  })
  for (const [name, style] of Object.entries(styles)) {
    expect(style.transform, name).toBe('none')
    expect(style.font, name).toMatch(/Space Grotesk/)
  }
})

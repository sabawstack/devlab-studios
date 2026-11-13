import { test, expect } from '@playwright/test'

const pages = [
  { path: '/', heading: "Business systems that don't quietly lose work" },
  { path: '/about', heading: 'A small studio that builds operational software' },
  { path: '/solutions', heading: 'Operational software, built to be run' },
  { path: '/solutions/lead-intake-and-follow-up', heading: 'Lead intake and follow-up' },
  { path: '/solutions/workflow-and-ai-automation', heading: 'Workflow and AI automation' },
  { path: '/solutions/custom-software-and-operations', heading: 'Custom software and operations systems' },
  { path: '/solutions/workflow-systems-audit', heading: 'Workflow Systems Audit' },
  { path: '/products', heading: 'What we build and run ourselves' },
  { path: '/profile', heading: 'Stephen Rey Agustinez' },
  { path: '/insights', heading: 'Notes on the problems behind operations work' },
  { path: '/privacy', heading: 'Privacy Policy' },
  { path: '/terms', heading: 'Terms of Service' },
  { path: '/work', heading: 'Systems we have built, described honestly' },
  { path: '/contact', heading: 'Tell us what is going wrong. A person reads it.' },
  { path: '/offers/lead-intake-checklist', heading: 'Lead Intake and Follow-up Systems Checklist' },
]

for (const { path, heading } of pages) {
  test(`${path} loads and shows its heading`, async ({ page }) => {
    const response = await page.goto(path)
    expect(response.status()).toBe(200)
    await expect(page.getByRole('heading', { name: new RegExp(heading, 'i') }).first()).toBeVisible()
  })
}

test('legacy redirects still work', async ({ page }) => {
  await page.goto('/experiences')
  await expect(page).toHaveURL(/\/profile$/)
  await page.goto('/portfolio')
  await expect(page).toHaveURL(/\/profile$/)
  await page.goto('/resources')
  await expect(page).toHaveURL(/\/insights$/)
})

// UX-10 / WEB-07: the delivery approach moved to About; the starter templates
// are no longer presented as work.
test('retired routes redirect permanently to the page that replaced them', async ({ request }) => {
  for (const [from, to] of [
    ['/process', '/about#how-we-work'],
    ['/landing-sample-react', '/work'],
    ['/landing-sample-html', '/work'],
    ['/landing-sample-fullstack', '/work'],
    ['/landing-sample-local-service', '/work'],
    ['/landing-sample-ecommerce', '/work'],
  ]) {
    const response = await request.get(from, { maxRedirects: 0 })
    expect(response.status(), from).toBe(301)
    expect(new URL(response.headers()['location']).pathname + new URL(response.headers()['location']).hash, from).toBe(to)
  }
  const withQuery = await request.get('/process?utm_source=x', { maxRedirects: 0 })
  expect(withQuery.headers()['location']).toMatch(/\/about\?utm_source=x#how-we-work$/)
})

test('a specific insights article loads via the old /resources/:slug redirect', async ({ page, request }) => {
  const feedResponse = await request.get('/api/articles')
  const { data } = await feedResponse.json()
  const firstSlug = data?.posts?.[0]?.slug
  test.skip(!firstSlug, 'No published articles to verify')

  await page.goto(`/resources/${firstSlug}`)
  await expect(page).toHaveURL(new RegExp(`/insights/${firstSlug}$`))
})

test('unknown route shows 404 page', async ({ page }) => {
  const response = await page.goto('/this-route-does-not-exist')
  expect(response.status()).toBe(404)
  await expect(page.getByRole('heading', { name: 'Page Not Found' })).toBeVisible()
})

test('unknown case study slug returns a real 404 status', async ({ page }) => {
  const response = await page.goto('/work/this-case-study-does-not-exist')
  expect(response.status()).toBe(404)
  await expect(page.getByRole('heading', { name: 'Page Not Found' })).toBeVisible()
  const solution = await page.goto('/solutions/not-a-service-line')
  expect(solution.status()).toBe(404)
})

test('footer has real links to Privacy and Terms', async ({ page }) => {
  await page.goto('/')
  const footer = page.getByRole('contentinfo')
  await expect(footer.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/privacy')
  await expect(footer.getByRole('link', { name: 'Terms of Service' })).toHaveAttribute('href', '/terms')
  // BUS-05: one business identity -- the business address, city-level
  // location and description; the portfolio-era tagline is gone.
  await expect(footer).toContainText('hello@devlabstudios.com')
  await expect(footer).toContainText('Cebu, Philippines')
  await expect(footer).toContainText('Software, integrations and workflow automation')
  await expect(footer).not.toContainText('Your Vision, Digitally Crafted')
  await expect(footer).not.toContainText(/(?:version history|smoke test) tagline/i)
})

/**
 * The header navigation, whichever one this viewport actually shows.
 *
 * The desktop nav is `hidden md:flex` and the mobile panel only exists once the
 * hamburger is pressed, so a locator written for one viewport resolves to zero
 * elements on the other. These specs run under `desktop-safari` and
 * `mobile-safari` as well as Chrome, and the navigation's CONTENT - the labels,
 * the hrefs, the absence of retired routes - should be identical either way.
 * Asserting it through this helper checks both, rather than silently testing
 * only the width the author happened to have in mind.
 */
async function headerNav(page) {
  const banner = page.getByRole('banner')
  const desktop = banner.getByRole('navigation').first()

  if (await desktop.isVisible()) return desktop

  await banner.getByRole('button', { name: /^menu$|open navigation/i }).click()
  const mobile = banner.getByRole('navigation').first()
  await mobile.waitFor({ state: 'visible' })
  return mobile
}

test('primary navigation is business-first and does not promote Process', async ({ page }) => {
  await page.goto('/')
  const navigation = await headerNav(page)

  // The mobile panel puts the CTA INSIDE the <nav>; on desktop it sits beside
  // it. Dropping it by its exact label keeps this assertion strict about the
  // navigation items themselves on both viewports, instead of loosening to a
  // partial match that would stop noticing an unexpected extra link.
  // textContent, not innerText: the labels are uppercased by CSS only.
  const labels = (await navigation.getByRole('link').allTextContents())
    .map((text) => text.trim())
    .filter((text) => !/^discuss your system$/i.test(text))

  // G.2: "Home" is the logo, not a nav item.
  expect(labels).toEqual(['Solutions', 'Work', 'Insights', 'About', 'Profile'])
  await expect(navigation.getByRole('link', { name: 'Process' })).toHaveCount(0)
})

test('the Profile nav item is labelled Profile, never "Hire Me"', async ({ page }) => {
  await page.goto('/')
  const navigation = await headerNav(page)
  await expect(navigation.getByRole('link', { name: 'Profile' })).toHaveAttribute('href', '/profile')
  await expect(navigation.getByRole('link', { name: /hire/i })).toHaveCount(0)
})

test('the header CTA is a single business call to action', async ({ page }) => {
  await page.goto('/')
  // The CTA sits beside the nav on desktop and inside the panel on mobile, so
  // the menu has to be open before it can be found on a phone viewport.
  await headerNav(page)
  const headerCta = page.getByRole('banner').getByRole('link', { name: /^(talk to us|contact)$/i }).first()
  await expect(headerCta).toHaveAttribute('href', '/contact?type=business_system')
})

test('the homepage does not ask visitors to classify themselves', async ({ page }) => {
  await page.goto('/')
  const main = page.getByRole('main')
  // No audience-selection screen, modal, or section.
  await expect(main.getByText(/I'?m looking to/i)).toHaveCount(0)
  await expect(main.getByText(/I need a business system/i)).toHaveCount(0)
  await expect(main.getByText(/I'?m hiring technical talent/i)).toHaveCount(0)
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('the homepage hero leads with business outcomes, not an employment pitch', async ({ page }) => {
  await page.goto('/')
  const hero = page.locator('main > header').first()
  await expect(hero.getByRole('link', { name: 'Talk to us about your system' })).toHaveAttribute('href', '/contact?type=business_system')
  await expect(hero.getByRole('link', { name: 'See the work' })).toHaveAttribute('href', '/work')
  await expect(hero).not.toContainText(/available for (?:full-time|part-time) employment/i)
  await expect(hero.getByRole('link', { name: /resume|résumé/i })).toHaveCount(0)
})

test('the homepage follows the business conversion order', async ({ page }) => {
  await page.goto('/')
  const positions = await page.evaluate(() => {
    // Spec N.10: problems, the exhibit, what we build, the audit, the founder, then the closing CTA.
    const idsInOrder = ['home-problems', 'home-exhibit', 'home-solutions', 'home-start', 'home-founder', 'home-cta']
    return idsInOrder.map((id) => {
      const element = document.getElementById(id)
      return element ? element.getBoundingClientRect().top + window.scrollY : -1
    })
  })
  expect(positions.every((value) => value > 0)).toBe(true)
  const sorted = [...positions].sort((left, right) => left - right)
  expect(positions).toEqual(sorted)
})

test('the Profile page is a first-class technical page with its own CTAs', async ({ page }) => {
  await page.goto('/profile')
  await expect(page.getByRole('heading', { level: 1, name: 'Stephen Rey Agustinez' })).toBeVisible()
  await expect(page.getByText('Founder, Full-Stack Developer, and AI Automation Architect')).toBeVisible()
  await expect(page.getByRole('link', { name: 'View Selected Work' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'View Resume' })).toHaveAttribute('href', '/resume.pdf')
  await expect(page.getByRole('link', { name: 'Contact Stephen', exact: true })).toHaveAttribute(
    'href',
    '/contact?type=employment_opportunity',
  )
  await expect(page.locator('#experience')).toBeVisible()
  await expect(page.locator('#certifications')).toBeVisible()
  await expect(page.locator('#portfolio')).toBeVisible()
  await expect(page.locator('#availability')).toBeVisible()
})

test('employers reach an employment form, not the business qualification form', async ({ page }) => {
  await page.goto('/contact?type=employment_opportunity')
  await expect(page.getByRole('heading', { level: 1, name: /Talk to Stephen about a role/i })).toBeVisible()
  // Business qualification questions must not appear on this path.
  await expect(page.getByLabel(/budget range/i)).toHaveCount(0)
  await expect(page.getByLabel(/what result are you aiming for/i)).toHaveCount(0)
})

test('every internal link on the primary pages resolves', async ({ page, request }) => {
  // Link rot on these pages is a real failure mode: several CTAs were rewritten
  // to carry `?type=` context, and the lead magnet points at an Insights
  // article that must actually be published for the offer to make sense.
  const seen = new Set()

  for (const path of ['/', '/solutions', '/solutions/lead-intake-and-follow-up', '/solutions/workflow-systems-audit', '/work', '/work/automated-lead-qualification', '/insights', '/about', '/profile', '/products', '/contact', '/offers/lead-intake-checklist']) {
    await page.goto(path)
    const hrefs = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a[href]'))
        .map((anchor) => anchor.getAttribute('href'))
        .filter((href) => href && href.startsWith('/')),
    )
    for (const href of hrefs) seen.add(href.split('#')[0])
  }

  for (const href of seen) {
    if (!href) continue
    const response = await request.get(href)
    expect(response.status(), `${href} should resolve`).toBeLessThan(400)
  }
})

test('the lead magnet points at a published, readable article', async ({ page }) => {
  await page.goto('/offers/lead-intake-checklist')
  const readLink = page.getByRole('link', { name: 'published on the site' })
  const href = await readLink.getAttribute('href')
  expect(href).toBeTruthy()

  const response = await page.goto(href)
  expect(response.status()).toBe(200)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
})

test('the sitemap lists canonical routes and no redirect sources', async ({ request }) => {
  const response = await request.get('/sitemap.xml')
  expect(response.status()).toBe(200)
  expect(response.headers()['content-type']).toContain('xml')

  const body = await response.text()
  for (const path of ['/', '/solutions', '/solutions/lead-intake-and-follow-up', '/solutions/workflow-systems-audit', '/work', '/work/automated-lead-qualification', '/insights', '/about', '/profile', '/products', '/contact']) {
    expect(body, path).toContain(`<loc>https://www.devlabstudios.com${path}</loc>`)
  }
  expect(body).not.toContain('devlabstudios.com/process<')
  // /resources/* is a permanent redirect into /insights — listing it would
  // spend crawl budget re-confirming 301s.
  expect(body).not.toContain('devlabstudios.com/resources')
  expect(body).not.toContain('/admin')
  expect(body).not.toContain('landing-sample')
})

test('homepage presents DevLab Studios as a business and routes visitors to Work', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: "Business systems that don't quietly lose work" })).toBeVisible()
  await expect(page.getByRole('link', { name: 'See the work' })).toHaveAttribute('href', '/work')
  const heroBox = await page.locator('main > header').first().boundingBox()
  expect(Math.abs(heroBox.x)).toBeLessThanOrEqual(1)
  expect(Math.abs(heroBox.width - 1440)).toBeLessThanOrEqual(1)
})

test('homepage shows four ways work gets lost, all visible at once, with no console or self-issued badges', async ({ page }) => {
  await page.goto('/')
  const problems = page.locator('#home-problems')
  await expect(problems.locator('[data-problem-id]')).toHaveCount(4)
  for (const item of await problems.locator('[data-problem-id]').all()) await expect(item).toBeVisible()
  await expect(page.getByRole('tab')).toHaveCount(0)
  await expect(page.locator('main')).not.toContainText(/VERIFIED ·|SYS-\d|live schematic|Nominal/i)
})

test('homepage presents the three service lines with links to their own pages', async ({ page }) => {
  await page.goto('/')
  for (const [title, id, slug] of [
    ['Lead intake and follow-up', 'lead-intake-followup', 'lead-intake-and-follow-up'],
    ['Workflow and AI automation', 'workflow-ai-automation', 'workflow-and-ai-automation'],
    ['Custom software and operations systems', 'custom-software-operations', 'custom-software-and-operations'],
  ]) {
    const card = page.locator(`[data-solution-id="${id}"]`).first()
    await expect(card).toContainText(title)
    await expect(card.getByRole('link', { name: /What this includes/ })).toHaveAttribute('href', `/solutions/${slug}`)
  }
  await expect(page.locator('#home-start').getByRole('link', { name: 'What you receive' })).toHaveAttribute('href', '/solutions/workflow-systems-audit')
  await expect(page.locator('#home-start').getByRole('link', { name: 'Request the audit' })).toHaveAttribute('href', /type=workflow_audit/)
})

test('old Solutions anchors still land on the matching service line', async ({ page }) => {
  await page.goto('/solutions#workflow-ai-automation')
  await expect(page.locator('#workflow-ai-automation')).toBeInViewport()
  await page.goto('/solutions#workflow-systems-audit')
  await expect(page.locator('#workflow-systems-audit')).toBeInViewport()
})

test('redesigned pages use the brand shell with a working skip link', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('body')).toHaveClass(/\bbrand\b/)
  await page.keyboard.press('Tab')
  const skip = page.getByRole('link', { name: 'Skip to content' })
  await expect(skip).toBeFocused()
  await skip.press('Enter')
  await expect(page).toHaveURL(/#main$/)
})

test('core public compositions avoid horizontal overflow at target breakpoints', async ({ page }) => {
  for (const width of [1440, 1280, 1024, 768, 430, 390]) {
    await page.setViewportSize({ width, height: width <= 430 ? 844 : 900 })
    for (const path of ['/', '/solutions', '/solutions/workflow-systems-audit', '/work', '/work/automated-lead-qualification', '/insights', '/about', '/profile', '/products', '/contact']) {
      await page.goto(path)
      const dimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }))
      expect(dimensions.content, `${path} overflows at ${width}px`).toBeLessThanOrEqual(dimensions.viewport)
    }
  }
})

test('Work publishes selected systems as business proof, each with its own write-up', async ({ page }) => {
  await page.goto('/work')
  const entries = page.locator('[data-work-entry]')
  await expect(entries).toHaveCount(3)
  await expect(page.getByText('The problem', { exact: true })).toHaveCount(3)
  await expect(page.getByText('What it does', { exact: true })).toHaveCount(3)
  // Starter templates are not presented as work (BUS-F04).
  await expect(page.getByText(/landing page/i)).toHaveCount(0)
  // CASE-02: one link per entry; the "something similar" action lives on the write-up.
  const destinations = await entries.first().getByRole('link').evaluateAll((links) => [...new Set(links.map((link) => link.getAttribute('href')))])
  expect(destinations).toHaveLength(1)
  expect(destinations[0]).toMatch(/^\/work\//)
  await entries.first().getByRole('link', { name: /Read the write-up/ }).click()
  await expect(page).toHaveURL(/\/work\/[a-z0-9-]+$/)
  // CASE-01: the K.2 order.
  for (const name of ['What was going wrong', 'The system', 'What it verifiably does', 'Who built and runs what']) {
    await expect(page.getByRole('heading', { level: 2, name })).toBeVisible()
  }
  await expect(page.locator('[data-scope]')).not.toBeEmpty()
  await expect(page.getByRole('link', { name: 'Founder profile' })).toHaveAttribute('href', '/profile')
})

test('Work states its evidence standard instead of showing invented metrics', async ({ page }) => {
  await page.goto('/work')
  await expect(page.getByText(/Client names, revenue figures and percentage improvements/i)).toBeVisible()
})

test('each write-up offers a business next step carrying its own context', async ({ page }) => {
  await page.goto('/work')
  await page.locator('[data-work-entry]').first().getByRole('link', { name: /Read the write-up/ }).click()
  const cta = page.getByRole('link', { name: 'Talk to us about something similar' }).first()
  await expect(cta).toHaveAttribute('href', /\/contact\?type=business_system&case=/)
})

test('resume is available from Profile only and opens inline', async ({ page, request }) => {
  await page.goto('/')
  await expect(page.getByRole('link', { name: /resume/i })).toHaveCount(0)

  await page.goto('/profile')
  const resumeLink = page.getByRole('link', { name: 'View Resume' })
  await expect(resumeLink).toHaveAttribute('href', '/resume.pdf')
  await expect(resumeLink).toHaveAttribute('target', '_blank')
  await expect(resumeLink).not.toHaveAttribute('download', /.*/)

  const response = await request.get('/resume.pdf')
  expect(response.status()).toBe(200)
  expect(response.headers()['content-type']).toContain('application/pdf')
  expect(response.headers()['content-disposition'] || '').not.toContain('attachment')
})

// PROF-03: informative images carry real alt text and load lazily.
test('profile certificates have descriptive alt text and load lazily', async ({ page }) => {
  await page.goto('/profile')
  const images = page.locator('#certifications img')
  const count = await images.count()
  expect(count).toBeGreaterThan(0)
  for (let index = 0; index < count; index += 1) {
    await expect(images.nth(index)).toHaveAttribute('alt', /certificate issued by/)
    await expect(images.nth(index)).toHaveAttribute('loading', 'lazy')
  }
  // The profile shows city-level location only (PROF-02).
  await expect(page.getByText('Cebu, Philippines').first()).toBeVisible()
})

test('CMS decorative vector fields remain behind content and outside the accessibility tree', async ({ page }) => {
  await page.goto('/admin')
  const field = page.locator('.admin-vector-field')
  await expect(field).toHaveCount(1)
  await expect(field).toHaveAttribute('aria-hidden', 'true')
  await expect(field.locator('.admin-vector-field__icon')).toHaveCount(6)
})

test('security headers apply to real, server-rendered responses, not just static assets', async ({ request }) => {
  // public/_headers only ever reaches responses served directly from the
  // static ASSETS binding — with output:'server' almost every real
  // response (every page, /admin, every /api/* route) is instead rendered
  // by Astro and passes through src/middleware.ts, so this is the only
  // way to prove the headers actually protect what visitors load.
  const pageResponse = await request.get('/')
  const pageHeaders = pageResponse.headers()
  expect(pageHeaders['content-security-policy']).toContain("default-src 'self'")
  expect(pageHeaders['x-frame-options']).toBe('DENY')
  expect(pageHeaders['x-content-type-options']).toBe('nosniff')
  expect(pageHeaders['strict-transport-security']).toContain('max-age=')
  expect(pageHeaders['x-robots-tag']).toBeUndefined()

  const apiResponse = await request.get('/api/health')
  expect(apiResponse.headers()['content-security-policy']).toContain("default-src 'self'")

  const adminResponse = await request.get('/admin')
  expect(adminResponse.headers()['x-robots-tag']).toBe('noindex, nofollow')

  // SEC-07: rendered pages carry hashed inline scripts and no 'unsafe-inline' for scripts.
  const scriptSrc = (pageHeaders['content-security-policy'].split(';').find((part) => part.trim().startsWith('script-src')) || '')
  expect(scriptSrc).toMatch(/'sha256-/)
  expect(scriptSrc).not.toContain("'unsafe-inline'")
})

test('the contact form CSP allows Turnstile to actually load', async ({ page }) => {
  const cspViolations = []
  page.on('console', (message) => {
    if (message.text().toLowerCase().includes('content security policy')) {
      cspViolations.push(message.text())
    }
  })

  // Turnstile now mounts on step 2 of the inquiry form, beside the submit
  // button, so the widget's script only loads once the visitor gets there.
  await page.goto('/contact')
  await expect(page.getByLabel(/full name/i)).toBeEnabled({ timeout: 20_000 })
  await page.getByLabel(/full name/i).fill('CSP Check')
  await page.getByLabel(/work email/i).fill('csp@example.com')
  await page.getByLabel(/company or organization/i).fill('CSP Co')
  await page.getByLabel(/what needs improvement/i).fill('Checking that the verification widget is allowed to load.')

  await expect(async () => {
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(page.getByRole('heading', { name: 'A little more context' })).toBeVisible({ timeout: 1_500 })
  }).toPass({ timeout: 20_000 })

  await page.waitForFunction(() => Boolean(window.turnstile), { timeout: 15_000 })
  expect(cspViolations).toEqual([])
})

test('the renamed Solutions route serves, and /services permanently redirects to it', async ({ page, request, baseURL }) => {
  // The label, heading, breadcrumb and SEO record all said "Solutions" while
  // the route said "/services", and the CMS canonical pointed at /solutions —
  // a 404. The route moved; /services has to keep working for anything already
  // linking to it.
  const redirect = await request.get(`${baseURL}/services`, { maxRedirects: 0 })
  expect(redirect.status()).toBe(301)
  expect(redirect.headers()['location']).toMatch(/\/solutions$/)

  await page.goto('/solutions')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    'https://www.devlabstudios.com/solutions',
  )
})

test('the primary navigation points at /solutions, not the old route', async ({ page }) => {
  await page.goto('/')
  const navigation = await headerNav(page)
  await expect(navigation.getByRole('link', { name: 'Solutions' }).first()).toHaveAttribute('href', '/solutions')
})

// OPS-05: the GA4 id comes from settings, with today's id as the default.
test('the page renders the configured GA4 measurement id', async ({ request }) => {
  const html = await (await request.get('/')).text()
  expect(html).toMatch(/G-[A-Z0-9]{4,16}/)
})

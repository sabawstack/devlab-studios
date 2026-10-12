import { test, expect } from '@playwright/test'

const pages = [
  { path: '/', heading: 'Build the systems your business needs' },
  { path: '/about', heading: 'Systems for clearer offers' },
  { path: '/solutions', heading: 'Four ways a business system gets built here' },
  { path: '/profile', heading: 'Stephen Rey Agustinez' },
  { path: '/insights', heading: 'Guides, AI updates, and operational notes' },
  { path: '/process', heading: 'A four-phase delivery model' },
  { path: '/privacy', heading: 'Privacy Policy' },
  { path: '/terms', heading: 'Terms of Service' },
  { path: '/work', heading: 'Business systems, with the decisions' },
  { path: '/contact', heading: 'Tell us where the workflow slows down' },
  { path: '/offers/lead-intake-checklist', heading: 'Lead Intake and Follow-up Systems Checklist' },
  { path: '/landing-sample-react', heading: 'A Different Look' },
  { path: '/landing-sample-html', heading: 'Editorial Minimal Landing Page' },
  { path: '/landing-sample-fullstack', heading: 'Operations Dashboard Website' },
  { path: '/landing-sample-local-service', heading: 'Phone-First Layout for' },
  { path: '/landing-sample-ecommerce', heading: 'Catalog-First Shopping Flow' },
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
  await expect(page.getByRole('heading', { name: 'Case study not found' })).toBeVisible()
})

test('footer has real links to Privacy and Terms', async ({ page }) => {
  await page.goto('/')
  const footer = page.getByRole('contentinfo')
  await expect(footer.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/privacy')
  await expect(footer.getByRole('link', { name: 'Terms of Service' })).toHaveAttribute('href', '/terms')
  await expect(footer).toContainText('Your Vision, Digitally Crafted — one solution at a time, always evolving.')
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

  await banner.getByRole('button', { name: /open navigation/i }).click()
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
  const labels = (await navigation.getByRole('link').allInnerTexts())
    .map((text) => text.trim())
    .filter((text) => text !== 'Discuss Your System')

  expect(labels).toEqual(['Home', 'Solutions', 'Work', 'Insights', 'About', 'Profile'])
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
  const headerCta = page.getByRole('banner').getByRole('link', { name: 'Discuss Your System' }).first()
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
  const hero = page.locator('.home-landing')
  await expect(hero.getByRole('link', { name: 'Discuss Your System' })).toBeVisible()
  await expect(hero.getByRole('link', { name: 'View Our Work' })).toBeVisible()
  await expect(hero).not.toContainText(/available for (?:full-time|part-time) employment/i)
  await expect(hero.getByRole('link', { name: /resume|résumé/i })).toHaveCount(0)
})

test('the homepage follows the business conversion order', async ({ page }) => {
  await page.goto('/')
  const positions = await page.evaluate(() => {
    const idsInOrder = ['home-problems', 'home-solutions', 'home-approach', 'home-principles', 'home-faq', 'home-cta']
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
  await expect(page.getByRole('link', { name: /Download Résumé/ })).toHaveAttribute('href', '/resume.pdf')
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

  for (const path of ['/', '/solutions', '/work', '/insights', '/about', '/profile', '/contact', '/offers/lead-intake-checklist']) {
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
  for (const path of ['/', '/solutions', '/work', '/insights', '/about', '/profile', '/contact']) {
    expect(body, path).toContain(`<loc>https://www.devlabstudios.com${path}</loc>`)
  }
  // /resources/* is a permanent redirect into /insights — listing it would
  // spend crawl budget re-confirming 301s.
  expect(body).not.toContain('devlabstudios.com/resources')
  expect(body).not.toContain('/admin')
  expect(body).not.toContain('landing-sample')
})

test('homepage presents DevLab Studios as a business and routes visitors to Work', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: 'Build the systems your business needs to capture opportunities and operate reliably.',
    }),
  ).toBeVisible()
  await expect(page.getByText('Software and automation studio', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'View Our Work' })).toHaveAttribute('href', '/work')
  const heroBox = await page.locator('.home-landing').boundingBox()
  expect(Math.abs(heroBox.x)).toBeLessThanOrEqual(1)
  expect(Math.abs(heroBox.width - 1440)).toBeLessThanOrEqual(1)
})

test('homepage names the operational problems it solves', async ({ page }) => {
  await page.goto('/')
  const problems = page.locator('#home-problems')
  await expect(problems).toBeAttached()
  await expect(page.getByRole('heading', { name: 'Leads wait too long for a reply' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Follow-up depends on someone remembering' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Automations fail without telling anyone' })).toBeVisible()
})

test('homepage presents the four solution categories with links into Solutions', async ({ page }) => {
  await page.goto('/')
  for (const [title, id] of [
    ['Lead Intake and Follow-up Systems', 'lead-intake-followup'],
    ['Workflow and AI Automation', 'workflow-ai-automation'],
    ['Custom Software and Operations Systems', 'custom-software-operations'],
    ['Workflow Systems Audit', 'workflow-systems-audit'],
  ]) {
    const card = page.locator(`[data-solution-id="${id}"]`).first()
    await expect(card).toContainText(title)
    await expect(card.getByRole('link', { name: 'What this includes' })).toHaveAttribute('href', `/solutions#${id}`)
  }
})

test('public pages use one document backdrop and an integrated sticky navbar', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')

  const geometry = await page.evaluate(() => {
    const shell = document.querySelector('.public-shell')?.getBoundingClientRect()
    const backdrop = document.querySelector('.public-backdrop')?.getBoundingClientRect()
    const hero = document.querySelector('.home-landing')
    const navbar = document.querySelector('.site-navbar')
    return {
      shellHeight: shell?.height || 0,
      backdropTop: backdrop?.top || 0,
      backdropHeight: backdrop?.height || 0,
      heroBackground: hero ? getComputedStyle(hero).backgroundColor : '',
      navbarBackground: navbar ? getComputedStyle(navbar).backgroundColor : '',
    }
  })

  expect(Math.abs(geometry.backdropTop)).toBeLessThanOrEqual(1)
  expect(Math.abs(geometry.backdropHeight - geometry.shellHeight)).toBeLessThanOrEqual(1)
  expect(geometry.heroBackground).toBe('rgba(0, 0, 0, 0)')
  expect(geometry.navbarBackground).toBe('rgba(0, 0, 0, 0)')

  await page.evaluate(() => window.scrollTo(0, 500))
  await expect(page.locator('#site-header')).toHaveClass(/site-header--scrolled/)
  await expect(page.locator('.site-navbar')).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
})

test('core public compositions avoid horizontal overflow at target breakpoints', async ({ page }) => {
  for (const width of [1440, 1280, 1024, 768, 430, 390]) {
    await page.setViewportSize({ width, height: width <= 430 ? 844 : 900 })
    for (const path of ['/', '/work']) {
      await page.goto(path)
      const dimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }))
      expect(dimensions.content, `${path} overflows at ${width}px`).toBeLessThanOrEqual(dimensions.viewport)
    }
  }
})

test('Work publishes selected systems as business proof', async ({ page }) => {
  await page.goto('/work')
  await expect(page.getByRole('heading', { name: 'Selected systems' })).toBeVisible()
  await expect(page.getByText('The business problem', { exact: true })).toHaveCount(3)
  await expect(page.getByText('The system designed', { exact: true })).toHaveCount(3)
  await expect(page.getByText('What it does in operation', { exact: true })).toHaveCount(3)
  await expect(page.getByRole('button', { name: /^Enlarge .* image 1$/ })).toHaveCount(3)
  await expect(page.getByText('View full image', { exact: true })).toHaveCount(3)
})

test('Work states its evidence standard instead of showing invented metrics', async ({ page }) => {
  await page.goto('/work')
  await expect(page.getByText(/Client names, revenue figures, and percentage improvements/i)).toBeVisible()
})

test('each Work entry offers a business next step carrying its own context', async ({ page }) => {
  await page.goto('/work')
  const cta = page.getByRole('link', { name: 'Discuss something like this' }).first()
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

test('Profile hover actions stay legible and large previews remain below navigation', async ({ page, isMobile }) => {
  // A desktop-layout check (hover, a forced 1440x900 viewport), so it does not
  // run on the iPhone profile: there that viewport is painted at 3x by WebKit's
  // software renderer on Windows, ~2 s per frame, and actionability checks ran
  // out the clock. desktop-safari covers WebKit at this size.
  test.skip(isMobile, 'desktop layout check; covered by desktop-safari')
  test.setTimeout(45_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/profile')

  const detailsAction = page.getByRole('button', { name: 'View details' }).first()
  await detailsAction.hover()
  await expect(detailsAction).toHaveCSS('color', 'rgb(255, 255, 255)')

  const certificateButton = page.getByRole('button', { name: 'View No Code Automation with Zapier certificate full size' })
  // The gallery is a client:load island: its buttons are server-rendered
  // before React attaches onClick, and a click in that window does nothing,
  // so the dialog never opens. Astro drops `ssr` from the island once it
  // has hydrated.
  await expect(page.locator('astro-island', { has: certificateButton })).not.toHaveAttribute('ssr')
  await certificateButton.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  const backdropBox = await dialog.boundingBox()
  const panelBox = await dialog.locator('.modal-viewport-panel').boundingBox()
  const navbarBox = await page.locator('.site-navbar').boundingBox()
  expect(backdropBox.y).toBe(0)
  expect(backdropBox.height).toBe(900)
  expect(panelBox.y).toBeGreaterThanOrEqual(navbarBox.y + navbarBox.height)
  expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(900)
})

test('CMS decorative vector fields remain behind content and outside the accessibility tree', async ({ page }) => {
  await page.goto('/admin')
  const field = page.locator('.admin-vector-field')
  await expect(field).toHaveCount(1)
  await expect(field).toHaveAttribute('aria-hidden', 'true')
  await expect(field.locator('.admin-vector-field__icon')).toHaveCount(6)
})

test('decorative vector motifs stay out of the accessibility tree', async ({ page }) => {
  await page.goto('/')
  const fields = page.locator('.vector-field')
  await expect(fields.first()).toHaveAttribute('aria-hidden', 'true')
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

  const landingSampleResponse = await request.get('/landing-sample-react')
  expect(landingSampleResponse.headers()['x-robots-tag']).toBe('noindex, follow')
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

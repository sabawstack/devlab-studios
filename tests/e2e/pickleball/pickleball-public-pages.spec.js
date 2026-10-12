import { test, expect } from '@playwright/test'

// The public pickleball pages are anonymous — no login helper needed. They
// are served by the worker (astro `output: 'server'`), so this file matches
// the `worker` Playwright project via the pickleball/ path convention.

/**
 * All of <main>'s copy as one string — including text inside collapsed
 * <details> (which `innerText` would drop) but excluding <script>/<style>,
 * whose minified contents would otherwise be searched as if they were page
 * copy. Used by every copy assertion below.
 */
async function mainCopy(page) {
  return page.locator('main').evaluate((element) => {
    const clone = element.cloneNode(true)
    for (const node of clone.querySelectorAll('script, style, template')) node.remove()
    return clone.textContent
  })
}

test.describe('Pickleball public pages', () => {
  test('the landing page leads with starting a free session', async ({ page }) => {
    const response = await page.goto('/pickleball')
    expect(response.status()).toBe(200)
    await expect(page.locator('main h1')).toHaveText('Run every court from one phone.')
    await expect(page.getByRole('link', { name: 'Start a free session' }).first()).toHaveAttribute('href', '/pickleball/new')
    await expect(page.getByRole('link', { name: 'See how it works' })).toHaveAttribute('href', '/pickleball/how-it-works')
    await expect(page.getByRole('link', { name: 'Operator sign in' })).toHaveCount(0)
  })

  // On a social post the image IS the post -- it is read before any text.
  // These pages shipped with the site-wide agency card, so someone sharing
  // the pickleball link advertised a software consultancy instead. Pin a
  // pickleball-specific image, and that it actually resolves.
  for (const path of ['/pickleball', '/pickleball/how-it-works', '/pickleball/rotation']) {
    test(`shares a pickleball-specific social image (${path})`, async ({ page }) => {
      const response = await page.goto(path)
      expect(response.status()).toBe(200)

      const ogImage = await page.locator('meta[property="og:image"]').getAttribute('content')
      expect(ogImage).toContain('og-pickleball.png')
      expect(ogImage).not.toBe('https://www.devlabstudios.com/og.png')

      const twitterImage = await page.locator('meta[name="twitter:image"]').getAttribute('content')
      expect(twitterImage).toBe(ogImage)

      // A social card that 404s renders as a bare link, so prove it serves.
      const image = await page.request.get(new URL(ogImage).pathname)
      expect(image.status()).toBe(200)
      expect(Number(image.headers()['content-length'] ?? 1)).toBeGreaterThan(0)
    })
  }

  // The tab icon is part of looking like one product: the marketing pages get
  // it from Layout.astro, but every standalone shell declares its own <html>
  // and silently had none until this was pinned.
  for (const path of ['/pickleball', '/pickleball/how-it-works', '/pickleball/rotation', '/pickleball/new']) {
    test(`serves a favicon (${path})`, async ({ page }) => {
      await page.goto(path)
      await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', '/devlabstudios-logo-only.png')
    })
  }

  // Both structural art guards below run once per public page that ships its
  // own illustrations, so a future page in this family is checked by adding
  // one entry here rather than a whole new pair of tests. `viewBox` is a
  // marker unique to that page's hero art (HeroRallyArt, ScoreTapArt,
  // PaddleStackArt), and `htmlMarker` is real page copy that could only be
  // present in server-rendered HTML.
  const artPages = [
    { path: '/pickleball', htmlMarker: 'Run every court from one phone.', viewBox: '0 0 480 300' },
    { path: '/pickleball/how-it-works', htmlMarker: 'How to run open play with Devlab Pickleball', viewBox: '0 0 220 200' },
    { path: '/pickleball/rotation', htmlMarker: 'How fair rotation works', viewBox: '0 0 360 200' },
  ]

  for (const { path, htmlMarker, viewBox } of artPages) {
    test(`every decorative illustration is hidden from assistive technology (${path})`, async ({ page }) => {
      await page.goto(path)

      // Positively scoped to the elements that actually hold this plan's
      // artwork (`data-testid="pb-artwork"` on each art container). An
      // earlier `main section:not(#request-access) svg` form excluded
      // nothing — ContactForm renders its own nested <section
      // class="form-surface"> INSIDE #request-access, which matches
      // `section:not(#request-access)` — so the guard was silently also
      // asserting on a shared component this plan does not own.
      const svgs = page.locator('main [data-testid="pb-artwork"] svg')
      const count = await svgs.count()
      expect(count).toBeGreaterThan(0)
      for (let index = 0; index < count; index += 1) {
        await expect(svgs.nth(index)).toHaveAttribute('aria-hidden', 'true')
      }
    })

    test(`ships no artwork JavaScript (${path})`, async ({ page }) => {
      // Art is rendered statically (no client: directive), so it must be in
      // the server HTML rather than appearing after hydration. Footer.astro
      // also renders an aria-hidden <svg> outside <main> on every page, so a
      // bare `<svg>` check would still pass even if the art were switched to
      // a client:*-hydrated component that rendered nothing server-side.
      // Assert on a marker unique to this page's art, scoped to <main>.
      const response = await page.request.get(path)
      const html = await response.text()
      expect(html).toContain(htmlMarker)

      const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/)
      expect(mainMatch).not.toBeNull()
      expect(mainMatch[1]).toContain(`viewBox="${viewBox}"`)

      // The server-HTML check above is necessary but NOT sufficient: Astro
      // server-renders `client:load`/`client:idle`/`client:visible` islands
      // too (only `client:only` skips SSR), so adding a client: directive to
      // an art component would ship a hydration bundle while the markup
      // above still matched. An island's SSR output is wrapped in
      // <astro-island>, so no art <svg> may have one as an ancestor. Scoped
      // to `[data-testid="pb-artwork"]`, which deliberately excludes the
      // ContactForm island #request-access mounts `client:visible` on
      // purpose.
      await page.goto(path)
      await expect(page.locator('astro-island [data-testid="pb-artwork"] svg')).toHaveCount(0)
      await expect(page.locator('[data-testid="pb-artwork"] astro-island')).toHaveCount(0)
    })
  }

  for (const path of ['/pickleball', '/pickleball/how-it-works', '/pickleball/rotation']) {
    test(`claims only shipped features (${path})`, async ({ page }) => {
      await page.goto(path)
      const copy = (await mainCopy(page)).toLowerCase()
      // Whole words only: a bare substring check would flag "opi" inside "copied".
      // DUPR and sign-in are shipped (Phase 4): the host's DUPR export, with Google sign-in for it alone.
      for (const unshipped of ['opi', 'performance index', 'rally-by-rally', 'mexicano']) {
        expect(copy, `"${unshipped}" on ${path}`).not.toMatch(new RegExp(`\\b${unshipped.replace(/[-]/g, '\\-')}`))
      }
    })

    test(`animations stop for reduced motion (${path})`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.goto(path)
      const running = await page.locator('.pb-anim *').evaluateAll((nodes) => nodes.filter((n) => getComputedStyle(n).animationName !== 'none').length)
      expect(running).toBe(0)
    })

    test(`no horizontal scroll at phone width (${path})`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto(path)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    })
  }

  test('the landing page pins its key promises', async ({ page }) => {
    await page.goto('/pickleball')
    const copy = await mainCopy(page)
    for (const claim of ['Free', 'No sign-up', '7 days', 'fewest games']) expect(copy).toContain(claim)
  })

  test('the rotation page explains all four ways to pick the next game, each with a computed example', async ({ page }) => {
    await page.goto('/pickleball/rotation')
    for (const label of ['Paddle stack', 'Winners play winners', 'By standing', 'Balanced teams']) {
      const section = page.getByRole('region', { name: label })
      await expect(section).toBeVisible()
      await expect(section.getByRole('heading', { name: 'Round 1' })).toBeVisible()
    }
    const copy = await mainCopy(page)
    expect(copy).toContain('Keep-together and keep-apart rules are never broken')
    expect(copy).toContain('sat out 2 rounds in a row')
  })

  test('the guide and landing page describe the stacking modes and rules', async ({ page }) => {
    await page.goto('/pickleball/how-it-works')
    const guide = await mainCopy(page)
    for (const claim of ['Winners play winners', 'By standing', 'Balanced teams', 'Keep friends together', 'Hand a court to a captain', 'TV board']) expect(guide).toContain(claim)
    await page.goto('/pickleball')
    const landing = await mainCopy(page)
    for (const claim of ['winners play winners', 'Fairness you can see', 'Keep friends together', 'Court captains', 'TV board']) expect(landing).toContain(claim)
  })

  test('the guide and landing page describe tournaments as built', async ({ page }) => {
    await page.goto('/pickleball/how-it-works')
    const guide = await mainCopy(page)
    for (const claim of ['Or run a tournament', 'pools then a bracket', 'double elimination', 'Edit the draw, then start', 'substitute a player', 'Tournaments, the same way']) expect(guide).toContain(claim)
    await page.goto('/pickleball')
    const landing = await mainCopy(page)
    for (const claim of ['Casual tournaments', 'Can I run a tournament?']) expect(landing).toContain(claim)
  })

  // Spec §1.3: no competitor is named and no comparative claim is made.
  // Real brand names in this market, none of which may appear. (DUPR is
  // covered by the Phase 1 copy guard below rather than listed here.)
  const COMPETITOR_BRANDS = [
    'pickleq',
    'playbypoint',
    'courtreserve',
    'pickleplanner',
    'teamreach',
    'playtime scheduler',
    'pickleball brackets',
    'swingvision',
    'globalpickleball',
    'pickleball den',
  ]
  const COMPARATIVE_LANGUAGE = /\bunlike\b|\bbetter than\b|\bcompared to\b|\bvs\.?\s/i

  for (const path of ['/pickleball', '/pickleball/how-it-works']) {
    test(`names no competitor and makes no comparative claim (${path})`, async ({ page }) => {
      await page.goto(path)

      // Brand names are swept across the WHOLE served document, not just
      // <main>: a competitor named in the <title>, the meta description or
      // an OG tag is just as much a breach of the constraint as one in the
      // body, and those live outside <main>.
      const html = (await (await page.request.get(path)).text()).toLowerCase()
      for (const brand of COMPETITOR_BRANDS) {
        expect(html, `must not name ${brand}`).not.toContain(brand)
      }

      // Comparative language is checked against rendered <main> text only.
      // The whole-document HTML carries CMS-authored nav and footer copy this
      // plan does not own, plus class names and URLs where a bare "vs" would
      // fire constantly — matching there would produce noise, not signal.
      const text = await mainCopy(page)
      expect(text).not.toMatch(COMPARATIVE_LANGUAGE)
    })
  }

  // Spec §1.8: heading hierarchy has no skipped level. Fails if either page
  // ever opens with something other than an <h1>, or jumps a level (an <h2>
  // followed by an <h4>, say) — the shape a screen-reader user navigates by.
  for (const path of ['/pickleball', '/pickleball/how-it-works', '/pickleball/rotation']) {
    test(`skips no heading level (${path})`, async ({ page }) => {
      await page.goto(path)

      const levels = await page
        .locator('main h1, main h2, main h3, main h4, main h5, main h6')
        .evaluateAll((nodes) => nodes.map((node) => Number(node.tagName.slice(1))))

      expect(levels.length).toBeGreaterThan(0)
      expect(levels[0]).toBe(1)
      for (let index = 1; index < levels.length; index += 1) {
        expect(
          levels[index],
          `heading ${index + 1} is h${levels[index]} after h${levels[index - 1]}`,
        ).toBeLessThanOrEqual(levels[index - 1] + 1)
      }
    })
  }

  // Bracket-format features that are not built anywhere. Documenting any of
  // them would be describing a feature that does not exist.
  // The DUPR export is a CSV the host uploads: nothing is ever sent to DUPR by us, and no rating is shown.
  const UNBUILT_CLAIMS = ['third-place', 'consolation', 'bracket reset', 'singles tournament', 'reseed', 'dupr api', 'synced to dupr', 'sent to dupr automatically', 'dupr rating']

  for (const path of ['/pickleball', '/pickleball/how-it-works']) {
    test(`documents no unbuilt feature (${path})`, async ({ page }) => {
      const html = (await (await page.request.get(path)).text()).toLowerCase()
      for (const claim of UNBUILT_CLAIMS) {
        expect(html, `${path} claims "${claim}", which is not built`).not.toContain(claim)
      }
    })
  }

  // Every phrase maps to shipped code: the console's More menu item, DUPR_CLICK_PATH
  // (src/lib/pickleball/open/dupr/email.ts), the email's upload rule, DUPR_EXPORT_LIMIT
  // (dupr/policy.ts) and the My sessions page.
  test('the guide and FAQ describe the DUPR export exactly as shipped', async ({ page }) => {
    await page.goto('/pickleball/how-it-works')
    const guide = await mainCopy(page)
    // The eligibility rule of src/lib/pickleball/open/dupr/export.ts (no tie, MIN_WINNING_POINTS, distinct valid IDs).
    const eligible = 'with a valid score (no tie, a team reached 6) and four different DUPR IDs'
    for (const phrase of ['Email me the DUPR export', 'Matches → Add Matches → Import Matches via CSV', 'Club Director or Organizer', 'Up to 5 exports per session a day', 'My sessions', eligible]) {
      expect(guide).toContain(phrase)
    }
    await page.goto('/pickleball')
    const landing = await mainCopy(page)
    expect(landing).toContain('Can I send results to DUPR?')
    expect(landing).toContain(eligible)
    expect(landing).toContain('open My sessions on any device')
  })

  // These pages are the product's public front door and are linked from
  // /solutions, so they need share metadata rather than a bare <title>. All
  // resolve it through loadPageSeo(), which falls back to src/data/
  // seoContent.js when the CMS has no row — this asserts the fallback is
  // wired, which is what a fresh environment actually serves.
  for (const [path, slugTitle] of [
    ['/pickleball', 'Free Pickleball Open Play Manager: Devlab Pickleball'],
    ['/pickleball/how-it-works', 'How to Run Pickleball Open Play: Devlab Pickleball Guide'],
    ['/pickleball/rotation', 'How Fair Rotation Works: Devlab Pickleball'],
  ]) {
    test(`serves share metadata (${path})`, async ({ page }) => {
      const html = await (await page.request.get(path)).text()

      expect(html).toMatch(/<meta name="description" content="[^"]{60,}"/)
      expect(html).toContain('<meta property="og:image"')
      expect(html).toContain('<meta name="twitter:card" content="summary_large_image">')
      expect(html).toContain(slugTitle)
    })
  }

  // Phase 5 (spec §12) retired the logged-in app. Its pages answer only
  // through the CMS redirects table (rows added by hand per environment, see
  // docs/pickleball/runbook.md), so a local database without the rows 404s
  // and an environment with them 301s to the new page. Nothing else is allowed.
  for (const [path, target] of [
    ['/pickleball/app', '/pickleball/new'],
    ['/pickleball/app/sessions/abc', '/pickleball/new'],
    ['/pickleball/methodology', '/pickleball/rotation'],
    ['/pickleball/live/ABCDE23456', '/pickleball'],
    ['/pickleball/live/ABCDE23456/display', '/pickleball'],
  ]) {
    test(`the retired page is gone (${path})`, async ({ page }) => {
      const response = await page.request.get(path, { maxRedirects: 0 })
      expect([301, 404], `${path} answered ${response.status()}`).toContain(response.status())
      if (response.status() === 301) expect(new URL(response.headers().location).pathname).toBe(target)
    })
  }

  for (const path of ['/pickleball/accept-invite/some-token', '/api/pickleball/sessions', '/api/pickleball/auth/session', '/api/pickleball/public/ABCDE23456/state']) {
    test(`the retired route is gone (${path})`, async ({ page }) => {
      expect((await page.request.get(path, { maxRedirects: 0 })).status()).toBe(404)
    })
  }

  // A browser can still hold the retired app's in-flight sign-in cookie when
  // Google sends it back. The shared callback treats every visit as a host
  // sign-in, so this is a plain failed host sign-in, never a JSON error.
  test('the Google callback answers a stale operator sign-in with a host sign-in failure', async ({ page }) => {
    const response = await page.request.get('/api/pickleball/auth/google/callback?code=x&state=y', {
      headers: { Cookie: 'devlab_pb_oauth=%7B%22state%22%3A%22y%22%7D' },
      maxRedirects: 0,
    })
    expect(response.status()).toBe(302)
    expect(response.headers().location).toBe('/pickleball/my-sessions?signin=failed')
  })

  test('the landing page offers a way to request access', async ({ page }) => {
    await page.goto('/pickleball')

    const section = page.locator('#request-access')
    await expect(section).toBeVisible()
    await expect(section.getByRole('heading', { name: 'Running a club or venue?' })).toBeVisible()
    await expect(section.getByLabel('Your name')).toBeVisible({ timeout: 10000 })
    // The subject field's label and placeholder must ask for the same thing.
    // They previously disagreed ("Your club or venue" labelling a field
    // placeheld "Pickleball early access request"), which is also the only
    // thing marking a submission as a pickleball request: ContactForm.jsx
    // hardcodes `source: 'devlabstudios-contact-form'` and api/contact.ts
    // ignores it, so without the subject these are indistinguishable from a
    // generic contact.
    await expect(section.getByLabel('Subject')).toHaveAttribute('placeholder', 'Pickleball early access request')
  })

  test('the solutions page promotes the free pickleball app', async ({ page }) => {
    await page.goto('/solutions')

    const promo = page.getByTestId('pickleball-promo')
    await expect(promo.getByRole('heading', { name: 'Devlab Pickleball: free open play and tournaments' })).toBeVisible()
    await expect(promo.getByRole('link', { name: 'Start a free session' })).toHaveAttribute('href', '/pickleball/new?ref=solutions')
    await expect(promo.getByRole('link', { name: 'See how it works' })).toHaveAttribute('href', '/pickleball/how-it-works?ref=solutions')
    await expect(promo.getByRole('link', { name: /Run a club or league/ })).toHaveAttribute('href', '/contact')
    await expect(promo.getByTestId('pb-artwork')).toHaveCount(4)
    // The retired early-access copy and its form are gone.
    await expect(page.getByRole('button', { name: 'Be a beta-tester' })).toHaveCount(0)
    await expect(promo).not.toContainText(/beta|pilot/i)
  })

  test('the home page and footer link to the pickleball app', async ({ page }) => {
    await page.goto('/')

    const band = page.getByTestId('home-pickleball')
    await expect(band.getByRole('heading', { name: 'Devlab Pickleball' })).toBeVisible()
    await expect(band.getByRole('link', { name: 'Start a free session' })).toHaveAttribute('href', '/pickleball/new?ref=home')
    await expect(band.getByRole('link', { name: 'See how it works' })).toHaveAttribute('href', '/pickleball?ref=home')
    await expect(
      page.getByRole('contentinfo').getByRole('link', { name: 'Devlab Pickleball (free)' }),
    ).toHaveAttribute('href', '/pickleball?ref=footer')
  })
})

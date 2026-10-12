import { randomInt } from 'node:crypto'
import { test, expect } from '@playwright/test'
import { ADMIN_EMAIL, addSharedAdminSession } from './support/adminSession.js'

/**
 * Opens the CMS as the smoke-test admin WITHOUT signing in.
 *
 * `/api/admin/login` is rate limited per IP (20 attempts / 15 min), counting
 * successes, and the limiter's state survives `wrangler dev` restarts. The
 * admin-auth setup project (tests/e2e/admin.setup.js) signs in once per RUN;
 * this reuses that session. The old once-per-WORKER sign-in was not once: every
 * replacement worker signed in again, and back-to-back runs spent the limit.
 */
async function login(page) {
  await addSharedAdminSession(page)
  await page.goto('/admin')
  await expect(page.getByRole('button', { name: /log ?out/i })).toBeVisible()
}

/**
 * A client address no earlier submission has used, for the per-IP limited
 * public endpoints (/api/contact, /api/inquiries, /api/lead-magnet: 5 per 10
 * minutes). Random rather than counted: the limiter is a Durable Object whose
 * counters persist in .wrangler/state ACROSS runs, so a fixed or per-run
 * counted address is spent again by every run and the sixth run inside ten
 * minutes gets a 429 that has nothing to do with what the test asserts.
 */
function freshClientIp() {
  return `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`
}

async function openAdminNavGroup(page, name) {
  const group = page.getByRole('navigation', { name: 'Admin navigation' }).getByRole('button', { name, exact: true })
  if ((await group.getAttribute('aria-expanded')) === 'false') await group.click()
}

// Creates a project directly via the API (bypassing the bespoke editor UI)
// so each media-focused test starts from a known, isolated project record —
// mirrors the pattern already used by the "creating a project..." and "Work
// editor..." tests above.
async function createProject(page, baseURL, overrides = {}) {
  const id = overrides.id || `smoke-test-media-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const response = await page.request.post(`${baseURL}/api/admin/projects`, {
    data: {
      title: 'Smoke Test Media Project',
      description: 'Created by an e2e test to verify project media handling.',
      type: 'Automation',
      ...overrides,
      id,
    },
  })
  expect(response.ok()).toBeTruthy()
  return id
}

test('health endpoint reports DB and media bucket bindings', async ({ request, baseURL }) => {
  const response = await request.get(`${baseURL}/api/health`)
  expect(response.ok()).toBeTruthy()
  const body = await response.json()
  expect(body.hasDb).toBe(true)
  expect(body.hasMediaBucket).toBe(true)
})

test('rejects an invalid login', async ({ page }) => {
  await page.goto('/admin')
  await page.getByLabel('Email').fill(ADMIN_EMAIL)
  await page.getByLabel('Password', { exact: true }).fill('wrong-password')
  await page.getByRole('button', { name: /sign in/i }).click()
  await expect(page.getByText(/invalid email or password/i)).toBeVisible()
})

test('the sign-in password can be revealed and re-hidden', async ({ page }) => {
  await page.goto('/admin')
  const field = page.getByLabel('Password', { exact: true })
  await field.fill('a-password-to-check')

  // Masked by default.
  await expect(field).toHaveAttribute('type', 'password')

  const toggle = page.getByRole('button', { name: 'Show password' })
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await toggle.click()

  // Same input, now revealed — so the typed value survives the toggle.
  await expect(field).toHaveAttribute('type', 'text')
  await expect(field).toHaveValue('a-password-to-check')

  const hideToggle = page.getByRole('button', { name: 'Hide password' })
  await expect(hideToggle).toHaveAttribute('aria-pressed', 'true')
  await hideToggle.click()
  await expect(field).toHaveAttribute('type', 'password')
  await expect(field).toHaveValue('a-password-to-check')
})

test('admin navigation mirrors public pages and hides unused collections', async ({ page }) => {
  await login(page)
  const navigation = page.getByRole('navigation', { name: 'Admin navigation' })
  await openAdminNavGroup(page, 'Public Pages')
  // Labels mirror src/config/publicSurfaces.js, which is also what the public
  // navigation reads — "Solutions" labels the /solutions route.
  for (const label of ['Home', 'About', 'Solutions', 'Work', 'Insights', 'Founder Profile']) {
    await expect(navigation.getByRole('link', { name: label, exact: true })).toBeVisible()
  }
  await expect(navigation.getByRole('link', { name: 'Testimonials' })).toHaveCount(0)
  await expect(navigation.getByRole('link', { name: 'Case Studies' })).toHaveCount(0)
  await openAdminNavGroup(page, 'Site Management')
  await navigation.getByRole('link', { name: 'Navigation & Footer' }).click()
  await expect(page.getByRole('heading', { name: 'Site Settings', level: 2 })).toBeVisible()
})

test('media library inventories the bound R2 bucket and explains its purpose', async ({ page, baseURL }) => {
  await login(page)

  const response = await page.request.get(`${baseURL}/api/admin/media`)
  expect(response.ok()).toBeTruthy()
  const body = await response.json()
  expect(Array.isArray(body.assets)).toBeTruthy()
  expect(typeof body.summary?.objectCount).toBe('number')
  expect(typeof body.summary?.totalBytes).toBe('number')

  await openAdminNavGroup(page, 'Site Management')
  await page.getByRole('navigation').getByRole('link', { name: 'Media' }).click()
  await expect(page.getByRole('heading', { name: 'Media Library', level: 1 })).toBeVisible()
  await expect(page.getByText(/optimized public images in the current environment/i)).toBeVisible()
  // Labelled for what these now actually count: the images rendered below
  // them, accumulated across however many pages have been loaded. They used
  // to describe every object on the first R2 page, including ones the grid
  // filtered out, so the tiles could disagree with the grid.
  await expect(page.getByText('Images loaded')).toBeVisible()
  await expect(page.getByText('Storage loaded')).toBeVisible()
  await expect(page.getByText('Upload Image')).toBeVisible()
})

// Both tests write the ONE site-settings row (and its version history), so run
// in parallel they read back each other's tagline -- or restore each other's
// version. Serial keeps them on one worker, one after the other.
test.describe('site settings', () => {
  test.describe.configure({ mode: 'serial' })

  test('site settings save round-trip persists across reload', async ({ page }) => {
    await login(page)
    await openAdminNavGroup(page, 'Site Management')
    await page.getByRole('navigation').getByRole('link', { name: 'Navigation & Footer' }).click()
    await expect(page.getByRole('heading', { name: 'Site Settings', level: 2 })).toBeVisible()

    const taglineInput = page.getByLabel(/tagline/i).first()
    const marker = `Smoke test tagline ${Date.now()}`
    await taglineInput.fill(marker)
    await page.getByRole('button', { name: /^save/i }).first().click()
    await expect(page.getByText(/saved/i)).toBeVisible({ timeout: 10_000 })

    await page.reload()
    await openAdminNavGroup(page, 'Site Management')
    await page.getByRole('navigation').getByRole('link', { name: 'Navigation & Footer' }).click()
    await expect(page.getByLabel(/tagline/i).first()).toHaveValue(marker)
  })

  test('site settings changes are versioned and a prior version can be restored', async ({ page }) => {
    await login(page)
    await openAdminNavGroup(page, 'Site Management')
    await page.getByRole('navigation').getByRole('link', { name: 'Navigation & Footer' }).click()
    await expect(page.getByRole('heading', { name: 'Site Settings', level: 2 })).toBeVisible()

    const taglineInput = page.getByLabel(/tagline/i).first()

    const olderMarker = `Version history tagline A ${Date.now()}`
    await taglineInput.fill(olderMarker)
    await page.getByRole('button', { name: /^save/i }).first().click()
    await expect(page.getByText(/saved/i)).toBeVisible({ timeout: 10_000 })

    const newerMarker = `Version history tagline B ${Date.now()}`
    await taglineInput.fill(newerMarker)
    await page.getByRole('button', { name: /^save/i }).first().click()
    await expect(page.getByText(/saved/i)).toBeVisible({ timeout: 10_000 })

    await page.getByRole('button', { name: 'Version History' }).click()
    const versionEntries = page.locator('li').filter({ hasText: /^v\d+/ })
    await expect(versionEntries.first()).toBeVisible()

    // Entries are newest-first: index 0 is the just-saved newerMarker snapshot,
    // index 1 is the snapshot saved right before it (olderMarker).
    page.once('dialog', (dialog) => dialog.accept())
    await versionEntries.nth(1).getByRole('button', { name: /restore/i }).click()

    await expect(page.getByLabel(/tagline/i).first()).toHaveValue(olderMarker)
  })
})

test('hidden testimonials collection remains backward compatible by direct route', async ({ page }) => {
  await login(page)
  await expect(page.getByRole('navigation').getByRole('link', { name: 'Testimonials' })).toHaveCount(0)
  await page.goto('/admin/collections/testimonials')
  await expect(page.getByRole('heading', { name: 'Testimonials', level: 1 })).toBeVisible()

  await page.getByRole('button', { name: /^add testimonial/i }).click()
  const marker = `Smoke test quote ${Date.now()}`
  // sortOrder 0 guarantees this item sorts first (ASC) regardless of what
  // other items already exist, so `.first()` reliably targets it below —
  // `.last()` isn't safe here since ties break on most-recently-updated.
  await page.getByLabel('Quote').last().fill(marker)
  await page.getByLabel('Author Name').last().fill('Smoke Test Author')
  await page.getByLabel('Sort Order').last().fill('0')
  await page.getByRole('button', { name: /^save all/i }).click()
  await expect(page.getByText(/^saved/i)).toBeVisible({ timeout: 10_000 })

  await page.reload()
  await expect(page.getByLabel('Quote').first()).toHaveValue(marker)

  // Clean up so repeated runs don't accumulate smoke-test rows.
  await page.getByRole('button', { name: 'Remove' }).first().click()
  await page.getByRole('button', { name: /^save all/i }).click()
  await expect(page.getByText(/^saved/i)).toBeVisible({ timeout: 10_000 })
})

test('redirects collection: create, verify it actually redirects, then delete', async ({ page }) => {
  await login(page)
  await openAdminNavGroup(page, 'Site Management')
  await page.getByRole('navigation').getByRole('link', { name: 'Redirects' }).click()
  await expect(page.getByRole('heading', { name: 'Redirects', level: 1 })).toBeVisible()

  await page.getByRole('button', { name: /^add new/i }).click()
  const fromPath = `/smoke-test-${Date.now()}`
  await page.getByLabel('From Path').fill(fromPath)
  await page.getByLabel('To Path').fill('/profile')
  await page.getByRole('button', { name: /^save$/i }).click()
  await expect(page.getByText(/^saved/i)).toBeVisible({ timeout: 10_000 })
  await expect(page.getByRole('button', { name: new RegExp(fromPath.replace('/', '\\/')) })).toBeVisible()

  // The middleware only consults the redirects table when a request already
  // 404'd (see src/middleware.ts) — checked via page.request (not page.goto)
  // since a 301 response is otherwise cached by the browser, which would
  // mask the later "deleting it takes effect immediately" check below.
  const beforeDelete = await page.request.get(fromPath, { maxRedirects: 0 })
  expect(beforeDelete.status()).toBe(301)
  expect(new URL(beforeDelete.headers().location, page.url()).pathname).toBe('/profile')

  await page.getByRole('button', { name: new RegExp(fromPath.replace('/', '\\/')) }).click()
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: /^delete$/i }).click()
  await expect(page.getByRole('button', { name: new RegExp(fromPath.replace('/', '\\/')) })).not.toBeVisible()

  // Deleting the redirect must take effect immediately — no stale redirect left behind.
  const afterDelete = await page.request.get(fromPath, { maxRedirects: 0 })
  expect(afterDelete.status()).toBe(404)
})

test('page builder: add a block, save, verify it persists, then remove it', async ({ page }) => {
  await login(page)
  await openAdminNavGroup(page, 'Public Pages')
  await page.getByRole('navigation').getByRole('link', { name: 'Home' }).click()
  await expect(page.getByRole('heading', { name: /^Page:/, level: 1 })).toBeVisible()

  await page.getByRole('button', { name: /^add block/i }).click()
  const marker = `Smoke test heading ${Date.now()}`
  const addedHeading = page.locator('input[id^="block-"][id$="-heading"]').last()
  await addedHeading.fill(marker)
  await page.getByRole('button', { name: /^save page/i }).click()
  await expect(page.getByText(/^saved/i)).toBeVisible({ timeout: 10_000 })

  await page.reload()
  await expect(page.locator('input[id^="block-"][id$="-heading"]').last()).toHaveValue(marker)

  await page.getByRole('button', { name: 'Remove' }).last().click()
  await page.getByRole('button', { name: /^save page/i }).click()
  await expect(page.getByText(/^saved/i)).toBeVisible({ timeout: 10_000 })
})

test('creating a project through the bespoke Projects editor still records a version', async ({ page, baseURL }) => {
  // ProjectsManager keeps its own bespoke UI (image upload, gallery
  // reordering) rather than being rewritten onto SchemaForm, but its
  // /api/admin/projects routes now share the same version/audit-log
  // plumbing as the schema-driven collections — this proves that backend
  // wiring end to end without re-testing the bespoke UI itself.
  await login(page)

  const projectId = `smoke-test-project-${Date.now()}`
  const createResponse = await page.request.post(`${baseURL}/api/admin/projects`, {
    data: {
      id: projectId,
      title: 'Smoke Test Project',
      description: 'Created by an e2e test to verify version recording.',
      type: 'Automation',
    },
  })
  expect(createResponse.ok()).toBeTruthy()

  const versionsResponse = await page.request.get(`${baseURL}/api/admin/versions/projects?id=${projectId}`)
  const versions = await versionsResponse.json()
  expect(versions.length).toBeGreaterThan(0)
  expect(versions[0].snapshot.title).toBe('Smoke Test Project')

  await page.request.delete(`${baseURL}/api/admin/projects/${projectId}`, { headers: { Origin: baseURL } })
})

test('Work editor selects existing Projects and owns its narrative without owning uploads', async ({ page, baseURL }) => {
  await login(page)

  const originalWorkResponse = await page.request.get(`${baseURL}/api/admin/pages/work`)
  expect(originalWorkResponse.ok()).toBeTruthy()
  const originalWork = await originalWorkResponse.json()
  const existingProjectsResponse = await page.request.get(`${baseURL}/api/admin/projects`)
  const existingProjects = await existingProjectsResponse.json()
  const existingProjectIds = new Set(existingProjects.map((project) => project.id))
  const originalReferences = originalWork.blocks
    ?.find((block) => block.type === 'workProjectShowcase')
    ?.props?.items?.map((item) => item.projectId) || []
  const restoreWork = originalReferences.every((projectId) => existingProjectIds.has(projectId))
    ? originalWork
    : { slug: 'work', title: originalWork.title || 'Work', status: 'draft', blocks: [] }
  const projectId = `smoke-work-project-${Date.now()}`
  const projectDescription = `Initial Project description ${Date.now()}`

  const createResponse = await page.request.post(`${baseURL}/api/admin/projects`, {
    data: {
      id: projectId,
      title: 'Smoke Work Linked Project',
      description: projectDescription,
      techStack: ['n8n', 'API'],
      type: 'Automation',
      status: 'published',
      sortOrder: 0,
      galleryImages: [
        { id: `${projectId}-1`, url: 'https://example.com/work-one.png', altText: 'First workflow view', sortOrder: 1 },
        { id: `${projectId}-2`, url: 'https://example.com/work-two.png', altText: 'Second workflow view', sortOrder: 2 },
      ],
    },
  })
  expect(createResponse.ok()).toBeTruthy()

  // A fresh local D1 can legitimately have no Work sections yet. Seed a
  // minimal empty selector state for this test so it exercises the editor's
  // Project-linking behavior without depending on the static fallback's
  // production Project IDs being present in the isolated test database.
  const emptyWorkResponse = await page.request.put(`${baseURL}/api/admin/pages/work`, {
    data: {
      slug: 'work',
      title: 'Work',
      status: 'published',
      blocks: [{
        type: 'workProjectShowcase',
        props: { heading: 'Selected automation projects', subheading: 'Test selection', items: [] },
      }],
    },
  })
  expect(emptyWorkResponse.ok()).toBeTruthy()

  await openAdminNavGroup(page, 'Public Pages')
  await page.getByRole('navigation').getByRole('link', { name: 'Work' }).click()
  await expect(page.getByRole('heading', { name: 'Work', level: 1 })).toBeVisible()
  await expect(page.locator('input[type="file"]')).toHaveCount(0)
  await expect(page.getByRole('link', { name: /manage project images/i })).toHaveAttribute('href', '/admin/content/projects')

  await page.getByPlaceholder('Search title, type, ID, or technology').fill(projectId)
  await page.getByRole('button', { name: /Smoke Work Linked Project/ }).click()
  await expect(page.getByLabel('Work description').last()).toHaveValue(projectDescription)
  await expect(page.getByText('2 image(s)', { exact: false }).last()).toBeVisible()

  await page.getByLabel('Work description').last().fill('Independent Work description')
  await page.getByLabel('Challenge').last().fill('A specific operational challenge.')
  await page.getByLabel('System Architecture').last().fill('A linked multi-stage architecture.')
  await page.getByLabel('Delivery Value').last().fill('A measurable delivery value.')
  await page.getByLabel('Work entry status').last().selectOption('published')
  await page.getByRole('button', { name: 'Save Work' }).click()
  await expect(page.getByText(/Work content saved/i)).toBeVisible({ timeout: 10_000 })

  const savedResponse = await page.request.get(`${baseURL}/api/admin/pages/work`)
  const savedWork = await savedResponse.json()
  const showcase = savedWork.blocks.find((block) => block.type === 'workProjectShowcase')
  const savedEntry = showcase.props.items.find((item) => item.projectId === projectId)
  expect(savedEntry).toMatchObject({
    description: 'Independent Work description',
    challenge: 'A specific operational challenge.',
    systemArchitecture: 'A linked multi-stage architecture.',
    deliveryValue: 'A measurable delivery value.',
    status: 'published',
  })

  const blockedDelete = await page.request.delete(`${baseURL}/api/admin/projects/${projectId}`, {
    headers: { Origin: baseURL },
  })
  expect(blockedDelete.status()).toBe(409)

  const restoreResponse = await page.request.put(`${baseURL}/api/admin/pages/work`, { data: restoreWork })
  expect(restoreResponse.ok()).toBeTruthy()
  const deleteResponse = await page.request.delete(`${baseURL}/api/admin/projects/${projectId}`, {
    headers: { Origin: baseURL },
  })
  expect(deleteResponse.ok()).toBeTruthy()
})

test('a lead persists in D1 and shows a failed delivery attempt when Resend is unreachable', async ({ page, baseURL }) => {
  // .dev.vars points RESEND_API_KEY at a deliberately-invalid key, so Resend
  // rejects it with 401 and delivery is guaranteed to fail here — this is
  // exactly what proves the core Phase 5 guarantee: the lead survives a
  // downstream outage.
  // Both subject and message must be unique per run: findRecentDuplicateLead
  // dedupes on email+message within a 5-minute window, so a repeated message
  // here would be (correctly) treated as a resubmission of the same inquiry
  // and skip a fresh delivery attempt entirely.
  const marker = `Smoke test lead ${Date.now()}`
  const senderEmail = `smoke-test-lead-${Date.now()}@example.com`
  const response = await page.request.post(`${baseURL}/api/contact`, {
    // Its own client address: /api/contact shares the per-IP submission limit
    // with every other test that posts here. See freshClientIp.
    headers: { 'cf-connecting-ip': freshClientIp() },
    data: { name: 'Smoke Test', email: senderEmail, subject: marker, message: `Verifying lead persistence. ${marker}` },
  })
  expect(response.ok(), await response.text()).toBeTruthy()

  await login(page)

  // The Resend attempt runs in the background (waitUntil) — poll briefly for
  // the delivery_attempts row to land rather than assuming it's instant.
  await expect(async () => {
    const leadsResponse = await page.request.get(`${baseURL}/api/admin/leads`)
    const leads = await leadsResponse.json()
    const lead = leads.find((item) => item.subject === marker)
    expect(lead).toBeTruthy()
    expect(lead.status).toBe('failed')
  }).toPass({ timeout: 10_000 })

  // The Inquiries table lists sender/type/status rather than the subject line,
  // so the lead is found by searching for its sender and opened from its row.
  await openAdminNavGroup(page, 'Operations')
  await page.getByRole('navigation').getByRole('link', { name: 'Inquiries' }).click()
  await page.getByLabel('Search inquiries').fill(senderEmail)
  await expect(page.getByText(senderEmail)).toBeVisible()
  await page.getByRole('row').filter({ hasText: senderEmail }).getByRole('button').first().click()

  // Two targets are attempted per inquiry (internal notification and visitor
  // confirmation), so each attempt number legitimately appears more than once.
  await expect(page.getByText(/attempt 1 — resend$/i)).toBeVisible()
  await expect(page.getByText('failure').first()).toBeVisible()
  // The failure must be classified, or the Retry button is a coin flip.
  await expect(page.getByText(/Category:/i).first()).toBeVisible()
})

test('the leads list returns more than one lead when the admin UI omits limit', async ({ page, baseURL }) => {
  // Regression test: GET /api/admin/leads is always called by the admin UI
  // with no `limit` param at all. A prior bug coerced that missing param to
  // 0 via Number(null), which a naive Number.isFinite() guard let through as
  // an explicit "limit 1" instead of falling back to the intended default —
  // silently hiding every lead except the single most recent one.
  const stamp = Date.now()
  const markerA = `Limit regression A ${stamp}`
  const markerB = `Limit regression B ${stamp}`
  const clientIp = freshClientIp()
  for (const [index, marker] of [markerA, markerB].entries()) {
    const response = await page.request.post(`${baseURL}/api/contact`, {
      headers: { 'cf-connecting-ip': clientIp },
      data: { name: 'Smoke Test', email: `smoke-test-limit-${stamp}-${index}@example.com`, subject: marker, message: `Verifying the leads list. ${marker}` },
    })
    expect(response.ok()).toBeTruthy()
  }

  await login(page)

  const leadsResponse = await page.request.get(`${baseURL}/api/admin/leads`)
  const leads = await leadsResponse.json()
  expect(leads.find((item) => item.subject === markerA)).toBeTruthy()
  expect(leads.find((item) => item.subject === markerB)).toBeTruthy()
})

test('staged gallery images are not uploaded until Save is clicked', async ({ page, baseURL }) => {
  await login(page)
  const projectId = await createProject(page, baseURL)

  await page.goto(`/admin/content/projects?projectId=${projectId}`)
  await expect(page.getByLabel('ID')).toHaveValue(projectId)

  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByText('Add Gallery Images', { exact: true }).click(),
  ])
  await fileChooser.setFiles('tests/e2e/fixtures/sample-image.png')
  await expect(page.getByText('Pending')).toBeVisible()

  // Nothing should hit the media upload endpoint just from staging a file —
  // uploadPendingGalleryImages() only runs from saveProject() in
  // ProjectsManager.jsx, which is never triggered here.
  const mediaRequestPromise = page.waitForRequest('**/api/admin/media', { timeout: 2000 }).catch(() => null)
  // Reloading with a staged (unsaved) image trips the beforeunload guard in
  // ProjectsManager.jsx; accept the native "leave site" dialog so the reload
  // actually proceeds instead of Playwright's default dialog handling
  // silently keeping us on the page.
  page.on('dialog', (dialog) => dialog.accept())
  await page.reload()
  await expect(mediaRequestPromise).resolves.toBeNull()

  await expect(page.getByLabel('ID')).toHaveValue(projectId)
  await expect(page.getByText('Pending')).not.toBeVisible()

  await page.request.delete(`${baseURL}/api/admin/projects/${projectId}`, { headers: { Origin: baseURL } })
})

test('selecting a gallery image as thumbnail persists projects.imageUrl on save', async ({ page, baseURL }) => {
  await login(page)
  const projectId = await createProject(page, baseURL)

  await page.goto(`/admin/content/projects?projectId=${projectId}`)
  await expect(page.getByLabel('ID')).toHaveValue(projectId)

  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByText('Add Gallery Images', { exact: true }).click(),
  ])
  await fileChooser.setFiles('tests/e2e/fixtures/sample-image.png')
  await expect(page.getByText('Pending')).toBeVisible()

  // The upload itself, not the "Uploading images…" button label: that label is
  // only on screen for as long as one local upload takes, which is often
  // shorter than an assertion's first poll.
  const upload = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/admin/media' && response.request().method() === 'POST',
  )
  await page.getByRole('button', { name: /Save Project/ }).click()
  expect((await upload).ok(), 'the staged image is uploaded on save').toBe(true)
  await expect(page.getByText(/Project saved at/)).toBeVisible({ timeout: 15_000 })

  // Pick the newly-uploaded gallery image as the thumbnail (first, and only,
  // tile) and save again — no new upload should be needed since the item is
  // no longer "pending".
  await page.locator('[data-testid="thumbnail-picker-tile"]').first().click()
  await page.getByRole('button', { name: /Save Project/ }).click()
  await expect(page.getByText(/Project saved at/)).toBeVisible({ timeout: 15_000 })

  const response = await page.request.get(`${baseURL}/api/admin/projects`)
  const projects = await response.json()
  const saved = projects.find((project) => project.id === projectId)
  expect(saved.imageUrl).toBeTruthy()
  expect(saved.galleryImages.find((image) => image.isThumbnail)?.url).toBe(saved.imageUrl)

  await page.request.delete(`${baseURL}/api/admin/projects/${projectId}`, { headers: { Origin: baseURL } })
})

test('removing the thumbnail-flagged gallery image is blocked', async ({ page, baseURL }) => {
  await login(page)
  // Seeded directly with a thumbnail-flagged gallery image via the API (a
  // plain, non-R2 URL is fine here — this test only exercises the client-side
  // "can't remove the active thumbnail" guard in GalleryImageRow.jsx, not
  // media storage).
  // The gallery image id is still derived per-run (not fixed) for safety —
  // project_gallery_images.id is a global PRIMARY KEY — even though
  // deleteProject() now also deletes a project's gallery rows on cleanup.
  const projectId = `smoke-test-blocked-removal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  await createProject(page, baseURL, {
    id: projectId,
    title: 'Smoke Test Blocked Removal',
    galleryImages: [
      { id: `${projectId}-1`, url: 'https://example.com/blocked-removal.png', altText: 'Thumbnail image', sortOrder: 1, isThumbnail: true },
    ],
  })

  await page.goto(`/admin/content/projects?projectId=${projectId}`)
  await expect(page.getByLabel('ID')).toHaveValue(projectId)
  await expect(page.getByRole('button', { name: 'Remove' }).first()).toBeDisabled()

  await page.request.delete(`${baseURL}/api/admin/projects/${projectId}`, { headers: { Origin: baseURL } })
})

test('deleting a used image shows the conflict dialog and links to the project', async ({ page, baseURL }) => {
  await login(page)
  const projectId = await createProject(page, baseURL, { title: 'Smoke Test Delete Conflict' })

  await page.goto(`/admin/content/projects?projectId=${projectId}`)
  await expect(page.getByLabel('ID')).toHaveValue(projectId)

  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByText('Add Gallery Images', { exact: true }).click(),
  ])
  await fileChooser.setFiles('tests/e2e/fixtures/sample-image.png')
  await expect(page.getByText('Pending')).toBeVisible()

  // Capture the real R2 key the upload endpoint assigns so this test can
  // find *this* asset in the Media Library later, rather than assuming it's
  // whatever the "first" listed asset happens to be (which could be an
  // unrelated, unreferenced object left over from another run).
  const [uploadResponse] = await Promise.all([
    page.waitForResponse((response) => response.url().includes('/api/admin/media') && response.request().method() === 'POST'),
    page.getByRole('button', { name: /Save Project/ }).click(),
  ])
  const { key: uploadedKey } = await uploadResponse.json()
  await expect(page.getByText(/Project saved at/)).toBeVisible({ timeout: 15_000 })

  await page.locator('[data-testid="thumbnail-picker-tile"]').first().click()
  await page.getByRole('button', { name: /Save Project/ }).click()
  await expect(page.getByText(/Project saved at/)).toBeVisible({ timeout: 15_000 })

  await page.goto('/admin/media')
  page.on('dialog', (dialog) => dialog.accept())

  const assetCard = page.locator('article', { hasText: uploadedKey })
  await expect(assetCard).toBeVisible({ timeout: 10_000 })
  await assetCard.getByRole('button', { name: 'Delete' }).click()

  await expect(page.getByText('This image is still in use')).toBeVisible()
  await page.getByRole('button', { name: 'Go to project' }).click()
  await expect(page).toHaveURL(new RegExp(`/admin/content/projects\\?projectId=${projectId}`))

  await page.request.delete(`${baseURL}/api/admin/projects/${projectId}`, { headers: { Origin: baseURL } })
})

test('deleting a project cleans up its exclusive gallery image from R2', async ({ page, baseURL }) => {
  await login(page)
  const projectId = await createProject(page, baseURL, { title: 'Smoke Test Delete Cleanup' })

  await page.goto(`/admin/content/projects?projectId=${projectId}`)
  await expect(page.getByLabel('ID')).toHaveValue(projectId)

  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByText('Add Gallery Images', { exact: true }).click(),
  ])
  await fileChooser.setFiles('tests/e2e/fixtures/sample-image.png')
  await expect(page.getByText('Pending')).toBeVisible()

  const [uploadResponse] = await Promise.all([
    page.waitForResponse((response) => response.url().includes('/api/admin/media') && response.request().method() === 'POST'),
    page.getByRole('button', { name: /Save Project/ }).click(),
  ])
  const { key: uploadedKey } = await uploadResponse.json()
  await expect(page.getByText(/Project saved at/)).toBeVisible({ timeout: 15_000 })

  const beforeDelete = await page.request.get(`${baseURL}/api/admin/media`)
  const { assets: assetsBefore } = await beforeDelete.json()
  expect(assetsBefore.some((asset) => asset.key === uploadedKey)).toBe(true)

  // deleteProject() now cleans up gallery rows *and* their R2/media_assets
  // entries (unless still referenced elsewhere) — this image belongs to no
  // other project, so it should be gone after the project itself is deleted.
  // An explicit Origin header is required — Astro's CSRF check rejects a
  // page.request.delete() with none (see the Work-showcase test above for
  // the same pattern).
  const deleteResponse = await page.request.delete(`${baseURL}/api/admin/projects/${projectId}`, {
    headers: { Origin: baseURL },
  })
  expect(deleteResponse.ok()).toBeTruthy()

  const afterDelete = await page.request.get(`${baseURL}/api/admin/media`)
  const { assets: assetsAfter } = await afterDelete.json()
  expect(assetsAfter.some((asset) => asset.key === uploadedKey)).toBe(false)
})

test('Media Library toggles between Medium icons and Details views', async ({ page, baseURL }) => {
  await login(page)
  await page.goto('/admin/media')

  // MediaAssetTable only renders a real <table> once at least one asset
  // exists (otherwise it shows an empty-state message with no table at
  // all), so upload one here to make the Details view deterministic
  // regardless of what other tests have or haven't uploaded yet.
  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByText('Upload Image').click(),
  ])

  // Capture the real R2 key the upload endpoint assigns (same pattern as the
  // "deleting a used image..." test above) so this test can delete exactly
  // the asset it created, rather than leaving it behind for every CI run.
  const [uploadResponse] = await Promise.all([
    page.waitForResponse((response) => response.url().includes('/api/admin/media') && response.request().method() === 'POST'),
    fileChooser.setFiles('tests/e2e/fixtures/sample-image.png'),
  ])
  const { key: uploadedKey } = await uploadResponse.json()
  await expect(page.getByText(/Optimized image uploaded/i)).toBeVisible({ timeout: 15_000 })

  await expect(page.locator('table')).toHaveCount(0)
  await page.getByRole('button', { name: 'Details' }).click()
  await expect(page.locator('table')).toBeVisible()
  await page.getByRole('button', { name: 'Medium icons' }).click()
  await expect(page.locator('table')).toHaveCount(0)

  await page.request.delete(`${baseURL}/api/admin/media?key=${encodeURIComponent(uploadedKey)}`, { headers: { Origin: baseURL } })
})

/**
 * Structured inquiry pipeline coverage.
 *
 * `.dev.vars` points RESEND_API_KEY at a deliberately-invalid key, so Resend
 * answers 401 and delivery is guaranteed to fail — which is precisely what
 * makes these tests prove the guarantee that matters: the inquiry survives a
 * downstream outage and stays visible and retryable to an administrator.
 */
/**
 * Each submission comes from its own client address.
 *
 * `/api/inquiries` is rate limited to 5 submissions per 10 minutes per IP —
 * a real control that must NOT be relaxed for tests. Without a distinct
 * address per test the sixth test in a run gets a 429 and fails for a reason
 * that has nothing to do with what it asserts. The limiter itself is covered
 * deliberately by its own test below.
 *
 * `cf-connecting-ip` is safe to set here: Cloudflare overwrites it at the
 * edge in production, so a client can never spoof it there; locally it is
 * simply absent unless a test provides one.
 */
async function submitInquiry(page, baseURL, overrides = {}) {
  const clientIp = freshClientIp()
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const payload = {
    inquiryType: 'business_system',
    fullName: 'Inquiry Smoke Test',
    email: `inquiry-${stamp}@example.com`,
    company: 'Smoke Test Co',
    website: 'smoketest.co',
    message: `Our inquiries sit in a shared inbox and nobody owns the follow-up. Marker ${stamp}`,
    desiredOutcome: 'Every inquiry gets an owner and a same-day reply.',
    currentWorkflow: 'A shared inbox and a spreadsheet.',
    currentTools: 'Gmail, Google Sheets',
    teamSize: '2_10',
    timeline: 'within_month',
    budgetRange: '2k_5k',
    preferredContact: 'email',
    attribution: {
      entryPage: '/',
      sourcePage: '/contact',
      formId: 'business-inquiry-form',
      utmSource: 'e2e',
      utmMedium: 'test',
      utmCampaign: `campaign-${stamp}`,
      solutionId: 'lead-intake-followup',
      anonymousId: `anon-${stamp}`,
    },
    consent: { granted: true, consentTextVersion: '2026-09-17', privacyPolicyVersion: '2026-09-17' },
    ...overrides,
  }

  const response = await page.request.post(`${baseURL}/api/inquiries`, {
    data: payload,
    headers: { 'cf-connecting-ip': clientIp },
  })
  return { response, payload, stamp }
}

test('a structured business inquiry is persisted with qualification, attribution, and consent', async ({ page, baseURL }) => {
  const { response, payload } = await submitInquiry(page, baseURL)
  expect(response.ok()).toBeTruthy()

  const body = await response.json()
  expect(body.persisted).toBe(true)
  expect(body.id).toBeTruthy()

  await login(page)

  const detailResponse = await page.request.get(`${baseURL}/api/admin/leads/${body.id}`)
  expect(detailResponse.ok()).toBeTruthy()
  const detail = await detailResponse.json()

  expect(detail.inquiryType).toBe('business_system')
  expect(detail.email).toBe(payload.email.toLowerCase())
  expect(detail.company).toBe('Smoke Test Co')
  // The bare domain is normalized server-side.
  expect(detail.website).toBe('https://smoketest.co')
  expect(detail.pipelineStatus).toBe('new')
  expect(['priority', 'standard', 'nurture', 'review']).toContain(detail.qualification)
  expect(detail.qualificationReasons.length).toBeGreaterThan(0)

  expect(detail.attribution).toBeTruthy()
  expect(detail.attribution.utmSource).toBe('e2e')
  expect(detail.attribution.formId).toBe('business-inquiry-form')
  expect(detail.attribution.solutionId).toBe('lead-intake-followup')

  expect(detail.consents.length).toBeGreaterThan(0)
  expect(detail.consents[0].granted).toBe(true)
  expect(detail.consents[0].privacyPolicyVersion).toBe('2026-09-17')

  expect(detail.activities.some((activity) => activity.activityType === 'received')).toBe(true)
  expect(detail.activities.some((activity) => activity.activityType === 'qualified')).toBe(true)
})

test('an inquiry survives a failed delivery and stays retryable', async ({ page, baseURL }) => {
  const { response } = await submitInquiry(page, baseURL)
  expect(response.ok(), await response.text()).toBeTruthy()
  const { id } = await response.json()

  await login(page)

  await expect(async () => {
    const detailResponse = await page.request.get(`${baseURL}/api/admin/leads/${id}`)
    const detail = await detailResponse.json()
    expect(detail.status).toBe('failed')
    expect(detail.attempts.length).toBeGreaterThan(0)
    // An invalid API key is a configuration problem, not a transient one.
    expect(detail.attempts[0].errorCategory).toBe('configuration')
  }).toPass({ timeout: 15_000 })

  const retryResponse = await page.request.post(`${baseURL}/api/admin/leads/${id}/retry`, { data: {} })
  expect(retryResponse.ok()).toBeTruthy()
  const retried = await retryResponse.json()
  expect(retried.attempts.length).toBeGreaterThan(1)
  expect(retried.activities.some((activity) => activity.activityType === 'delivery_retry')).toBe(true)
})

test('an employment inquiry is stored separately and is never business-qualified', async ({ page, baseURL }) => {
  const { response } = await submitInquiry(page, baseURL, {
    inquiryType: 'employment_opportunity',
    roleTitle: 'Backend Engineer',
    employmentType: 'full_time',
    workArrangement: 'remote',
    timeline: '',
    budgetRange: '',
    desiredOutcome: '',
    attribution: { formId: 'employment-inquiry-form' },
  })
  expect(response.ok()).toBeTruthy()
  const { id } = await response.json()

  await login(page)

  const detail = await (await page.request.get(`${baseURL}/api/admin/leads/${id}`)).json()
  expect(detail.inquiryType).toBe('employment_opportunity')
  expect(detail.roleTitle).toBe('Backend Engineer')
  expect(detail.employmentType).toBe('full_time')
  expect(detail.qualification).toBe('unscored')
  expect(detail.qualificationScore).toBe(0)
})

test('an identical resubmission is collapsed instead of creating a second inquiry', async ({ page, baseURL }) => {
  const { response, payload } = await submitInquiry(page, baseURL)
  expect(response.ok(), await response.text()).toBeTruthy()
  const first = await response.json()

  const repeat = await page.request.post(`${baseURL}/api/inquiries`, {
    data: payload,
    headers: { 'cf-connecting-ip': freshClientIp() },
  })
  expect(repeat.ok()).toBeTruthy()
  const second = await repeat.json()

  expect(second.id).toBe(first.id)
  expect(second.duplicate).toBe(true)
  expect(second.persisted).toBe(true)
})

test('the inquiry endpoint rejects an invalid payload with field-level errors', async ({ page, baseURL }) => {
  const response = await page.request.post(`${baseURL}/api/inquiries`, {
    data: {
      inquiryType: 'business_system',
      fullName: '',
      email: 'not-an-email',
      message: '',
      consent: { granted: false },
    },
  })

  expect(response.status()).toBe(400)
  const body = await response.json()
  expect(body.code).toBe('validation_failed')
  expect(Object.keys(body.fields).length).toBeGreaterThan(0)
  expect(body.fields.email).toBeTruthy()
})

test('the inquiry endpoint refuses an oversized payload before parsing it', async ({ page, baseURL }) => {
  const response = await page.request.post(`${baseURL}/api/inquiries`, {
    data: {
      inquiryType: 'general',
      fullName: 'Too Big',
      email: 'toobig@example.com',
      message: 'x'.repeat(200_000),
      consent: { granted: true },
    },
  })
  expect(response.status()).toBe(413)
})

test('the lead-magnet endpoint rejects an unknown offer', async ({ page, baseURL }) => {
  const response = await page.request.post(`${baseURL}/api/lead-magnet`, {
    headers: { 'cf-connecting-ip': freshClientIp() },
    data: {
      fullName: 'Jo Lim',
      email: `magnet-${Date.now()}@example.com`,
      offerId: 'not-a-real-offer',
      consent: { granted: true, consentTextVersion: '2026-09-17', privacyPolicyVersion: '2026-09-17' },
    },
  })
  expect(response.status()).toBe(404)
})

test('a lead-magnet signup is persisted against the requested offer', async ({ page, baseURL }) => {
  const email = `magnet-${Date.now()}@example.com`
  const response = await page.request.post(`${baseURL}/api/lead-magnet`, {
    data: {
      fullName: 'Jo Lim',
      email,
      offerId: 'lead-intake-checklist',
      attribution: { formId: 'lead-magnet-form', entryPage: '/insights' },
      consent: { granted: true, consentTextVersion: '2026-09-17', privacyPolicyVersion: '2026-09-17' },
    },
  })
  expect(response.ok()).toBeTruthy()
  const { id } = await response.json()

  await login(page)
  const detail = await (await page.request.get(`${baseURL}/api/admin/leads/${id}`)).json()
  expect(detail.source).toBe('lead-magnet')
  expect(detail.solutionInterest).toBe('lead-intake-checklist')
  expect(detail.attribution.offerId).toBe('lead-intake-checklist')
})

test('admin lead routes reject an unauthenticated caller', async ({ request, baseURL }) => {
  for (const path of ['/api/admin/leads', '/api/admin/leads/export']) {
    const response = await request.get(`${baseURL}${path}`)
    expect(response.status(), path).toBe(401)
  }

  const patch = await request.fetch(`${baseURL}/api/admin/leads/anything`, {
    method: 'PATCH',
    data: { pipelineStatus: 'won' },
  })
  expect(patch.status()).toBe(401)
})

test('an admin can filter inquiries by type and qualification', async ({ page, baseURL }) => {
  const { response } = await submitInquiry(page, baseURL)
  expect(response.ok(), await response.text()).toBeTruthy()
  const { id } = await response.json()

  await login(page)
  const detail = await (await page.request.get(`${baseURL}/api/admin/leads/${id}`)).json()

  const byType = await (await page.request.get(`${baseURL}/api/admin/leads?inquiryType=business_system`)).json()
  expect(byType.some((lead) => lead.id === id)).toBe(true)

  const byQualification = await (
    await page.request.get(`${baseURL}/api/admin/leads?qualification=${detail.qualification}`)
  ).json()
  expect(byQualification.some((lead) => lead.id === id)).toBe(true)

  const wrongType = await (await page.request.get(`${baseURL}/api/admin/leads?inquiryType=partnership`)).json()
  expect(wrongType.some((lead) => lead.id === id)).toBe(false)
})

test('an admin can change pipeline status, assign an owner, and archive', async ({ page, baseURL }) => {
  const { response } = await submitInquiry(page, baseURL)
  expect(response.ok(), await response.text()).toBeTruthy()
  const { id } = await response.json()

  await login(page)

  const updated = await (
    await page.request.fetch(`${baseURL}/api/admin/leads/${id}`, {
      method: 'PATCH',
      data: { pipelineStatus: 'in_review', assignedOwner: 'owner@devlabstudios.com', internalNotes: 'Called back.' },
    })
  ).json()

  expect(updated.pipelineStatus).toBe('in_review')
  expect(updated.assignedOwner).toBe('owner@devlabstudios.com')
  expect(updated.internalNotes).toBe('Called back.')
  expect(updated.activities.some((activity) => activity.activityType === 'status_change')).toBe(true)
  // The note's text must never be copied into the activity metadata.
  const noteActivity = updated.activities.find((activity) => activity.activityType === 'note')
  expect(JSON.stringify(noteActivity?.metadata || {})).not.toContain('Called back')

  const archived = await (
    await page.request.fetch(`${baseURL}/api/admin/leads/${id}`, {
      method: 'PATCH',
      data: { pipelineStatus: 'archived' },
    })
  ).json()
  expect(archived.archivedAt).toBeTruthy()

  // Archived inquiries leave the working inbox unless explicitly requested.
  const defaultList = await (await page.request.get(`${baseURL}/api/admin/leads`)).json()
  expect(defaultList.some((lead) => lead.id === id)).toBe(false)

  const withArchived = await (await page.request.get(`${baseURL}/api/admin/leads?includeArchived=true`)).json()
  expect(withArchived.some((lead) => lead.id === id)).toBe(true)
})

test('an admin PATCH cannot rewrite what the visitor actually submitted', async ({ page, baseURL }) => {
  const { response, payload } = await submitInquiry(page, baseURL)
  expect(response.ok(), await response.text()).toBeTruthy()
  const { id } = await response.json()

  await login(page)
  await page.request.fetch(`${baseURL}/api/admin/leads/${id}`, {
    method: 'PATCH',
    data: { pipelineStatus: 'qualified', email: 'attacker@example.com', message: 'rewritten', qualification: 'priority' },
  })

  const detail = await (await page.request.get(`${baseURL}/api/admin/leads/${id}`)).json()
  expect(detail.email).toBe(payload.email.toLowerCase())
  expect(detail.message).toBe(payload.message)
  expect(detail.pipelineStatus).toBe('qualified')
})

test('the CSV export is authorized, complete, and safe to open in a spreadsheet', async ({ page, baseURL }) => {
  const stamp = Date.now()
  const { response } = await submitInquiry(page, baseURL, {
    // A company name that a spreadsheet would otherwise evaluate as a formula.
    company: `=HYPERLINK("http://evil.example","click") ${stamp}`,
  })
  expect(response.ok()).toBeTruthy()

  await login(page)

  const exportResponse = await page.request.get(`${baseURL}/api/admin/leads/export`)
  expect(exportResponse.ok()).toBeTruthy()
  expect(exportResponse.headers()['content-type']).toContain('text/csv')
  expect(exportResponse.headers()['content-disposition']).toContain('attachment')

  const csv = await exportResponse.text()
  expect(csv.split('\r\n')[0]).toContain('Inquiry type')
  // The dangerous cell is neutralized with a leading apostrophe.
  expect(csv).toContain(`'=HYPERLINK`)
  expect(csv).not.toMatch(/(^|,)"?=HYPERLINK/m)
  // The free-text message is deliberately excluded from the export.
  expect(csv).not.toContain('nobody owns the follow-up')
})

test('the Inquiries screen shows qualification reasons, attribution, and consent', async ({ page, baseURL }) => {
  const { response } = await submitInquiry(page, baseURL)
  expect(response.ok(), await response.text()).toBeTruthy()
  const { id } = await response.json()

  await login(page)
  await page.goto(`/admin/leads`)

  await expect(async () => {
    const detailResponse = await page.request.get(`${baseURL}/api/admin/leads/${id}`)
    expect((await detailResponse.json()).attempts.length).toBeGreaterThan(0)
  }).toPass({ timeout: 15_000 })

  await page.reload()
  await page.getByRole('button', { name: /\d/ }).first().click()

  await expect(page.getByRole('heading', { name: 'Why it scored this way' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Where it came from' })).toBeVisible()
  await expect(page.getByRole('heading', { name: /^Consent/ })).toBeVisible()
  await expect(page.getByRole('heading', { name: /^Delivery attempts/ })).toBeVisible()
  await expect(page.getByRole('heading', { name: /^Activity/ })).toBeVisible()
})

test('the inquiry endpoint starts refusing once one address submits too often', async ({ page, baseURL }) => {
  // One fixed address for every attempt: the limiter keys on the client IP, so
  // varying it (as every other test here deliberately does) would spread the
  // attempts across separate counters and never reach the limit.
  const clientIp = '198.51.100.7'
  let sawTooMany = false

  for (let attempt = 1; attempt <= 12; attempt += 1) {
    const response = await page.request.post(`${baseURL}/api/inquiries`, {
      headers: { 'cf-connecting-ip': clientIp },
      data: {
        inquiryType: 'general',
        fullName: 'Rate Limit Probe',
        email: `probe-${Date.now()}-${attempt}@example.com`,
        message: `Probe attempt ${attempt} for the submission rate limiter.`,
        consent: { granted: true, consentTextVersion: '2026-09-17', privacyPolicyVersion: '2026-09-17' },
      },
    })

    if (response.status() === 429) {
      sawTooMany = true
      // A well-behaved client needs to know how long to wait.
      expect(Number(response.headers()['retry-after'] ?? 0)).toBeGreaterThan(0)
      break
    }
    expect(response.ok()).toBeTruthy()
  }

  expect(sawTooMany, 'expected a 429 within 12 submissions from one address').toBe(true)
})

test('the password change endpoint rejects an unauthenticated caller', async ({ request, baseURL }) => {
  const response = await request.post(`${baseURL}/api/admin/password`, {
    data: { currentPassword: 'x', newPassword: 'y'.repeat(12), confirmPassword: 'y'.repeat(12) },
  })
  expect(response.status()).toBe(401)
})

test('the Security screen refuses a wrong current password', async ({ page }) => {
  await login(page)
  await openAdminNavGroup(page, 'Operations')
  await page.getByRole('navigation').getByRole('link', { name: 'Security' }).click()
  await expect(page.getByRole('heading', { name: 'Security', level: 1 })).toBeVisible()

  const replacement = `e2e-does-not-apply-${Date.now()}`
  await page.getByLabel('Current password', { exact: true }).fill('definitely-not-the-password')
  await page.getByLabel('New password', { exact: true }).fill(replacement)
  await page.getByLabel('Confirm new password', { exact: true }).fill(replacement)
  await page.getByRole('button', { name: 'Change password' }).click()

  // Deliberately only the failure path: a test that actually rotated the
  // credential would change the shared fixture password for every later test
  // in the run. The success path is covered by the unit tests, which own their
  // own in-memory credential.
  await expect(page.getByRole('status')).toContainText(/current password is incorrect/i)
  await expect(page.getByLabel('Current password', { exact: true })).toHaveAttribute('aria-invalid', 'true')
})

test('each Security field reveals independently', async ({ page }) => {
  await login(page)
  await page.goto('/admin/security')

  const current = page.getByLabel('Current password', { exact: true })
  const next = page.getByLabel('New password', { exact: true })
  await current.fill('one')
  await next.fill('two')

  await page.getByRole('button', { name: 'Show current password' }).click()
  await expect(current).toHaveAttribute('type', 'text')
  // Revealing the password being replaced must not reveal the new one.
  await expect(next).toHaveAttribute('type', 'password')
})

test('editing a SEO page slug keeps that row selected and leaves the others alone', async ({ page }) => {
  // Selection used to be looked up by pageSlug, which is itself an editable
  // field: one keystroke made the lookup miss, `Math.max(0, -1)` selected row
  // 0, and every further keystroke edited THAT row's slug instead. The editor
  // appeared to "refresh" onto the first page mid-typing.
  //
  // Built from "+ New page" rather than whichever rows happen to exist, so the
  // test does not depend on fixture data.
  await login(page)
  await page.goto('/admin/content/seo')

  const pageList = page.locator('section').filter({ hasText: 'Pages' }).first()
  await expect(page.getByRole('button', { name: '+ New page' })).toBeVisible({ timeout: 15_000 })
  // The editor renders the static fallback first and swaps in the D1 records
  // when the fetch resolves, which reorders the list. Capture the row only
  // once that has happened, or the comparison races the load.
  await expect(page.getByText(/loaded seo content/i)).toBeVisible({ timeout: 15_000 })

  const firstRow = pageList.getByRole('button').first()
  const firstRowName = await firstRow.textContent()

  await page.getByRole('button', { name: '+ New page' }).click()

  const slugField = page.getByLabel('Page Slug')
  await expect(slugField).toHaveValue('')

  await slugField.fill('brand-new-route')

  // Still editing the record that was selected, and the heading tracks it.
  await expect(slugField).toHaveValue('brand-new-route')
  await expect(page.getByRole('heading', { name: /brand-new-route Metadata/i })).toBeVisible()

  // The row that used to absorb those keystrokes is untouched.
  await expect(firstRow).toHaveText(String(firstRowName))
})

test('the SEO editor can add a page record for a route that has none', async ({ page }) => {
  await login(page)
  await page.goto('/admin/content/seo')

  await expect(page.getByRole('button', { name: '+ New page' })).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: '+ New page' }).click()

  await expect(page.getByLabel('Page Slug')).toHaveValue('')
  await expect(page.getByText(/set its page slug to match the route/i)).toBeVisible()
})

import { test, expect } from '@playwright/test'

const ROSTER = ['Ana', 'Ben', 'Carlo', 'Dina', 'Eli', 'Fay', 'Gio', 'Hana', 'Ivan']

// Creation is limited to 10 per IP per day, and under `wrangler dev` every request
// shares one address whose counter persists between runs. Each create therefore
// claims its own address (cf-connecting-ip is overwritten by the edge in production).
const freshIp = () => `10.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 254) + 1}`

export async function createSession(request, overrides = {}) {
  const response = await request.post('/api/pickleball/open/sessions', {
    headers: { 'cf-connecting-ip': freshIp() },
    data: {
      name: 'Sunday Open Play',
      hostDisplayName: 'Coach Mike',
      courtCount: 2,
      settings: { mode: 'PADDLE_STACK', target: 11, winnerOnly: false, scoringStyle: 'SIDEOUT' },
      players: ROSTER.map((name) => ({ name })),
      ...overrides,
    },
  })
  expect(response.status()).toBe(201)
  return response.json()
}

function command(request, code, hostKey, cmd, idempotencyKey = crypto.randomUUID()) {
  return request.post(`/api/pickleball/open/s/${code}/commands`, {
    headers: { 'X-Host-Key': hostKey },
    data: { idempotencyKey, command: cmd },
  })
}

test.describe('open play API', () => {
  test('create, then the public board shows proposals and nothing private', async ({ request }) => {
    const { code, hostKey } = await createSession(request)
    expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{10}$/)
    expect(hostKey.length).toBeGreaterThanOrEqual(20)

    const state = await (await request.get(`/api/pickleball/open/s/${code}/state`)).json()
    expect(state.courts.map((c) => c.state)).toEqual(['UP_NEXT', 'UP_NEXT'])
    expect(JSON.stringify(state)).not.toMatch(/hostKey|host_key|hash/i)
  })

  test('commands need the host key', async ({ request }) => {
    const { code } = await createSession(request)
    const denied = await command(request, code, 'wrong-key-wrong-key', { type: 'END_SESSION' })
    expect(denied.status()).toBe(403)
    const missing = await request.get(`/api/pickleball/open/s/${code}/host`)
    expect(missing.status()).toBe(403)
  })

  test('a game is saved once: replay returns the same answer, a second save is 409', async ({ request }) => {
    const { code, hostKey } = await createSession(request)
    const host = await (await request.get(`/api/pickleball/open/s/${code}/host`, { headers: { 'X-Host-Key': hostKey } })).json()
    const match = host.courts[0].match
    const save = { type: 'RECORD_RESULT', matchId: match.id, winner: 'A', scoreA: 11, scoreB: 7 }

    const first = await command(request, code, hostKey, save, 'same-key-123456')
    expect(first.status()).toBe(200)
    const replay = await command(request, code, hostKey, save, 'same-key-123456')
    expect(replay.status()).toBe(200)
    expect((await replay.json()).version).toBe((await first.json()).version)

    const again = await command(request, code, hostKey, save)
    expect(again.status()).toBe(409)

    const state = await (await request.get(`/api/pickleball/open/s/${code}/state`)).json()
    expect(state.recentResults).toHaveLength(1)
    expect(state.standings[0]).toMatchObject({ wins: 1, losses: 0 })
  })

  test('an impossible score is refused with a reason', async ({ request }) => {
    const { code, hostKey } = await createSession(request)
    const host = await (await request.get(`/api/pickleball/open/s/${code}/host`, { headers: { 'X-Host-Key': hostKey } })).json()
    const response = await command(request, code, hostKey, { type: 'RECORD_RESULT', matchId: host.courts[0].match.id, winner: 'A', scoreA: 12, scoreB: 9 })
    expect(response.status()).toBe(400)
    expect((await response.json()).error).toContain("can't end 12–9")
    // Both endings are accepted: sudden death on one court, win by 2 on the other.
    expect((await command(request, code, hostKey, { type: 'RECORD_RESULT', matchId: host.courts[0].match.id, winner: 'A', scoreA: 11, scoreB: 10 })).status()).toBe(200)
    expect((await command(request, code, hostKey, { type: 'RECORD_RESULT', matchId: host.courts[1].match.id, winner: 'B', scoreA: 10, scoreB: 12 })).status()).toBe(200)
  })

  test('results download as CSV, and delete removes the session for everyone', async ({ request, baseURL }) => {
    const { code, hostKey } = await createSession(request)
    const csv = await request.get(`/api/pickleball/open/s/${code}/results.csv`, { headers: { 'X-Host-Key': hostKey } })
    expect(csv.status()).toBe(200)
    expect(csv.headers()['content-type']).toContain('text/csv')
    expect(await csv.text()).toContain('Rank,Player')

    // A browser always sends Origin on DELETE; Astro's CSRF check rejects a bodyless request without one.
    const removed = await request.delete(`/api/pickleball/open/s/${code}/session`, { headers: { 'X-Host-Key': hostKey, Origin: baseURL } })
    expect(removed.status()).toBe(200)
    expect((await request.get(`/api/pickleball/open/s/${code}/state`)).status()).toBe(404)
  })

  test('bad input is a 400, an unknown code a 404', async ({ request }) => {
    const bad = await request.post('/api/pickleball/open/sessions', { headers: { 'cf-connecting-ip': freshIp() }, data: { name: '', courtCount: 99 } })
    expect(bad.status()).toBe(400)
    expect((await request.get('/api/pickleball/open/s/ZZZZZ22222/state')).status()).toBe(404)
    expect((await request.get('/api/pickleball/open/s/not-a-code/state')).status()).toBe(404)
  })
})

test.describe('open play UI', () => {
  test('a host creates a session in the browser and lands on the console', async ({ page }) => {
    // The form posts from the browser, which shares the local "unknown" IP and its 10/day limit.
    // Only that one request is touched: a header on the Turnstile calls would trigger CORS preflights.
    const ip = freshIp()
    await page.route('**/api/pickleball/open/sessions', (route) =>
      route.request().method() === 'POST'
        ? route.continue({ headers: { ...route.request().headers(), 'cf-connecting-ip': ip } })
        : route.continue(),
    )
    await page.goto('/pickleball/new')
    await page.getByLabel('Your name (shown as "Hosted by")').fill('Coach Mike')
    await page.getByRole('button', { name: 'Next: add players' }).click()
    await page.getByLabel(/Paste names/).fill('1. Ana\n2. Ben\nCarlo, Dina, Eli\nFay\nGio\nHana\nben')
    await expect(page.getByText('8 players found')).toBeVisible()
    // The widget must have issued its token before Start can succeed.
    await expect(page.locator('input[name="cf-turnstile-response"]')).toHaveValue(/.+/, { timeout: 30_000 })
    await page.getByRole('button', { name: /^Start session/ }).click()
    await expect(page.getByRole('heading', { name: 'Two links. Keep the first one to yourself.' })).toBeVisible()
    await page.getByRole('link', { name: 'I saved it — go to courts' }).click()
    await expect(page.getByTestId('court-1')).toContainText('Up next')
    expect(page.url()).not.toContain('#host=')
  })

  test('saving a result updates a second screen and offers undo', async ({ page, browser, request }) => {
    const { code, hostKey } = await createSession(request)
    await page.goto(`/pickleball/s/${code}#host=${hostKey}`)
    const viewerContext = await browser.newContext()
    const viewer = await viewerContext.newPage()
    await viewer.goto(`/pickleball/s/${code}`)
    await expect(viewer.getByText('Walk on now').first()).toBeVisible()

    await page.getByTestId('court-1').getByRole('button', { name: 'Start' }).click()
    await expect(viewer.getByText('Playing').first()).toBeVisible()

    await page.getByTestId('court-1').getByRole('button', { name: 'Game over' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('radio').first().click()
    await dialog.getByRole('button', { name: '7', exact: true }).click()
    await dialog.getByRole('button', { name: 'Save 11–7' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'saved 11–7' })).toBeVisible()
    await expect(viewer.getByText('11–7')).toBeVisible()

    await page.getByRole('button', { name: /^Undo/ }).click()
    await expect(viewer.getByText('11–7')).toHaveCount(0)
    await viewerContext.close()
  })

  test('a loser score of 10 offers sudden death (11–10) and win by 2 (12–10)', async ({ page, request }) => {
    const { code, hostKey } = await createSession(request)
    await page.goto(`/pickleball/s/${code}#host=${hostKey}`)
    await page.getByTestId('court-1').getByRole('button', { name: 'Already played? Enter result' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('radio').first().click()
    await dialog.getByRole('button', { name: '10', exact: true }).click()
    await expect(dialog.getByRole('button', { name: 'Save 11–10' })).toBeEnabled()
    await dialog.getByRole('radio', { name: '12–10 win by 2' }).click()
    await expect(dialog.getByRole('button', { name: 'Save 12–10' })).toBeEnabled()
  })

  test('a deuce score is accepted from the pad', async ({ page, request }) => {
    const { code, hostKey } = await createSession(request)
    await page.goto(`/pickleball/s/${code}#host=${hostKey}`)
    await page.getByTestId('court-1').getByRole('button', { name: 'Already played? Enter result' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('radio').nth(1).click()
    await dialog.getByRole('button', { name: '13', exact: true }).click()
    await expect(dialog.getByRole('button', { name: 'Save 13–15' })).toBeEnabled()
  })

  test('closing the tab loses nothing: the landing page offers to resume', async ({ page, request }) => {
    const { code, hostKey } = await createSession(request, { name: 'Resume Me' })
    await page.goto(`/pickleball/s/${code}#host=${hostKey}`)
    await expect(page.getByTestId('court-1')).toBeVisible()
    await page.goto('/pickleball')
    await expect(page.getByText('Resume Me is saved on this phone')).toBeVisible()
    await page.getByRole('link', { name: 'Resume as host' }).click()
    await expect(page.getByTestId('court-1')).toBeVisible()
  })

  test('an unknown or deleted code shows the ended notice', async ({ page }) => {
    await page.goto('/pickleball/s/ZZZZZ22222')
    await expect(page.getByRole('heading', { name: 'This session has ended and its results were deleted.' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Start your own session' })).toHaveAttribute('href', '/pickleball/new')
  })

  for (const width of [390, 768, 1280, 1920]) {
    test(`console and board fit a ${width}px screen without sideways scrolling`, async ({ page, browser, request }) => {
      const { code, hostKey } = await createSession(request, { courtCount: 8, players: Array.from({ length: 30 }, (_, i) => ({ name: `Player ${i + 1}` })) })
      await page.setViewportSize({ width, height: 900 })
      await page.goto(`/pickleball/s/${code}#host=${hostKey}`)
      await expect(page.getByTestId('court-1')).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      // A fresh context is a true viewer: this one's storage remembers the host key and would resume as host.
      const viewerContext = await browser.newContext({ viewport: { width, height: 900 } })
      const viewer = await viewerContext.newPage()
      await viewer.goto(`/pickleball/s/${code}`)
      await expect(viewer.getByText('Walk on now').first()).toBeVisible()
      expect(await viewer.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await viewerContext.close()
    })
  }
})

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
      settings: { mode: 'PADDLE_STACK', target: 11, scoringStyle: 'SIDEOUT' },
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

async function hostSnapshot(request, code, hostKey) {
  const response = await request.get(`/api/pickleball/open/s/${code}/host`, { headers: { 'X-Host-Key': hostKey } })
  expect(response.status()).toBe(200)
  return response.json()
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

  test('a wrong-key flood from one address does not lock the host out', async ({ request }) => {
    const { code, hostKey } = await createSession(request)
    const attacker = freshIp()
    // hostIpLimited allows 600 per minute per address (a club's captains and host share one Wi-Fi).
    // 620 requests, more than the limit, sent 20 at a time so a slow local
    // worker isn't swamped with hundreds of open requests at once.
    const statuses = []
    for (let batch = 0; batch < 31; batch += 1) {
      const flood = await Promise.all(Array.from({ length: 20 }, () =>
        request.post(`/api/pickleball/open/s/${code}/commands`, {
          headers: { 'X-Host-Key': 'wrong-key-wrong-key', 'cf-connecting-ip': attacker },
          data: { idempotencyKey: crypto.randomUUID(), command: { type: 'END_SESSION' } },
        })))
      statuses.push(...flood.map((r) => r.status()))
    }
    expect(statuses.every((s) => s === 403 || s === 429)).toBe(true)
    expect(statuses).toContain(429)

    const host = await request.post(`/api/pickleball/open/s/${code}/commands`, {
      headers: { 'X-Host-Key': hostKey, 'cf-connecting-ip': freshIp() },
      data: { idempotencyKey: crypto.randomUUID(), command: { type: 'END_SESSION' } },
    })
    expect(host.status()).toBe(200)
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

  test('the host console loads and saves over polling when the live connection is down', async ({ page, request }) => {
    const { code, hostKey } = await createSession(request)
    await page.routeWebSocket(/\/pickleball\/rt\/open\//, (ws) => ws.close({ code: 1011, reason: 'blocked by test' }))
    await page.goto(`/pickleball/s/${code}#host=${hostKey}`)
    await expect(page.getByTestId('court-1')).toContainText('Up next')
    await expect(page.getByText('Reconnecting…')).toBeVisible()
    await page.getByTestId('court-1').getByRole('button', { name: 'Start' }).click()
    await expect(page.getByTestId('court-1').getByRole('button', { name: 'Game over' })).toBeVisible()
  })

  test('a wrong key in the link falls back to the key this phone already saved', async ({ page, request }) => {
    const { code, hostKey } = await createSession(request)
    await page.goto(`/pickleball/s/${code}#host=${hostKey}`)
    await expect(page.getByTestId('court-1')).toBeVisible()
    await page.goto(`/pickleball/s/${code}?from=chat#host=wrong-key-wrong-key`)
    await expect(page.getByTestId('court-1')).toBeVisible()
    expect(new URL(page.url()).search).toBe('?from=chat')
    expect(page.url()).not.toContain('#host=')
    expect(await page.evaluate(() => localStorage.getItem('devlab-pickleball-hosted'))).toContain(hostKey)
  })

  test('ending a session asks first', async ({ page, request }) => {
    const { code, hostKey } = await createSession(request)
    await page.goto(`/pickleball/s/${code}#host=${hostKey}`)
    await expect(page.getByTestId('court-1')).toBeVisible()
    const prompts = []
    page.once('dialog', (dialog) => { prompts.push(dialog.message()); dialog.dismiss() })
    await page.getByRole('button', { name: 'More' }).click()
    await page.getByRole('button', { name: 'End session' }).click()
    expect(prompts[0]).toContain('End this session?')
    await expect(page.getByText('· Ended')).toHaveCount(0)

    page.once('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: 'More' }).click()
    await page.getByRole('button', { name: 'End session' }).click()
    await expect(page.getByText('· Ended')).toBeVisible()
  })

  test('a roster over 128 players says how many to remove and cannot start', async ({ page }) => {
    await page.goto('/pickleball/new')
    await page.getByLabel('Your name (shown as "Hosted by")').fill('Coach Mike')
    await page.getByRole('button', { name: 'Next: add players' }).click()
    await page.getByLabel(/Paste names/).fill(Array.from({ length: 130 }, (_, i) => `Player ${i + 1}`).join('\n'))
    await expect(page.getByText('A session can have up to 128 players — remove 2.')).toBeVisible()
    await expect(page.getByRole('button', { name: /^Start session/ })).toBeDisabled()
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

test.describe('stacking modes, rules and fairness', () => {
  test('the host picks a mode when creating a session and sees it on the console', async ({ page }) => {
    const ip = freshIp()
    await page.route('**/api/pickleball/open/sessions', (route) =>
      route.request().method() === 'POST'
        ? route.continue({ headers: { ...route.request().headers(), 'cf-connecting-ip': ip } })
        : route.continue(),
    )
    await page.goto('/pickleball/new')
    await page.getByLabel('Your name (shown as "Hosted by")').fill('Coach Mike')
    for (const label of ['Paddle stack', 'Winners play winners', 'By standing', 'Balanced teams']) {
      await expect(page.getByRole('radio', { name: new RegExp(`^${label}`) })).toBeVisible()
    }
    await page.getByRole('radio', { name: /^Winners play winners/ }).click()
    await expect(page.getByRole('radio', { name: /^Winners play winners/ })).toHaveAttribute('aria-checked', 'true')
    await page.getByRole('button', { name: 'Next: add players' }).click()
    await page.getByLabel(/Paste names/).fill('Ana\nBen\nCarlo\nDina\nEli')
    await expect(page.locator('input[name="cf-turnstile-response"]')).toHaveValue(/.+/, { timeout: 30_000 })
    await page.getByRole('button', { name: /^Start session/ }).click()
    await page.getByRole('link', { name: 'I saved it — go to courts' }).click()
    await expect(page.getByRole('button', { name: 'Mode: Winners play winners' })).toBeVisible()
  })

  test('switching mode mid-session leaves the proposed game alone and shows on the board', async ({ page, request }) => {
    const { code, hostKey } = await createSession(request)
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto(`/pickleball/s/${code}#host=${hostKey}`)
    await expect(page.getByTestId('court-1')).toContainText('Up next')
    const before = await page.getByTestId('court-1').innerText()
    await page.getByRole('button', { name: 'Mode: Paddle stack' }).click()
    await page.getByRole('dialog', { name: 'Who plays next' }).getByRole('radio', { name: /^By standing/ }).click()
    await expect(page.getByRole('button', { name: 'Mode: By standing' })).toBeVisible()
    expect(await page.getByTestId('court-1').innerText()).toBe(before)
    expect((await hostSnapshot(request, code, hostKey)).settings.mode).toBe('BY_STANDING')
    const viewer = await (await request.get(`/api/pickleball/open/s/${code}/state`)).json()
    expect(viewer.settings.mode).toBe('BY_STANDING')
  })

  test('a keep-together rule added on the console is kept by every proposal', async ({ page, request }) => {
    const { code, hostKey } = await createSession(request)
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto(`/pickleball/s/${code}#host=${hostKey}`)
    const rules = page.getByRole('region', { name: 'Keep together or apart' })
    await rules.getByRole('radio', { name: 'Keep together' }).click()
    await rules.getByLabel('First player').selectOption({ label: 'Ana' })
    await rules.getByLabel('Second player').selectOption({ label: 'Ivan' })
    await rules.getByRole('button', { name: 'Add rule' }).click()
    await expect(rules.getByText('Ana & Ivan: always partners')).toBeVisible()
    const host = await hostSnapshot(request, code, hostKey)
    const ana = host.players.find((p) => p.name === 'Ana').id
    const ivan = host.players.find((p) => p.name === 'Ivan').id
    for (const court of host.courts) {
      const m = court.match
      if (!m) continue
      const four = [...m.teamA, ...m.teamB]
      if (four.includes(ana) || four.includes(ivan)) expect(m.teamA.includes(ana) ? m.teamA : m.teamB).toContain(ivan)
    }
  })

  test('a rule no four can keep leaves the court waiting with a reason', async ({ page, request }) => {
    const { code, hostKey } = await createSession(request, { courtCount: 1, players: ['Ana', 'Ben', 'Carlo', 'Dina'].map((name) => ({ name })) })
    const host = await hostSnapshot(request, code, hostKey)
    const id = (name) => host.players.find((p) => p.name === name).id
    expect((await command(request, code, hostKey, { type: 'ADD_RULE', rule: { kind: 'APART', playerIds: [id('Ana'), id('Ben')] } })).status()).toBe(200)
    await page.goto(`/pickleball/s/${code}#host=${hostKey}`)
    await expect(page.getByTestId('court-1')).toContainText('No four waiting players fit the keep-together and keep-apart rules')
    expect((await command(request, code, hostKey, { type: 'REMOVE_RULE', rule: { kind: 'APART', playerIds: [id('Ana'), id('Ben')] } })).status()).toBe(200)
    await expect(page.getByTestId('court-1')).toContainText('Up next')
  })

  test('the fairness panel shows the games spread, the longest wait and repeat partners', async ({ page, request }) => {
    const { code, hostKey } = await createSession(request)
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto(`/pickleball/s/${code}#host=${hostKey}`)
    const panel = page.getByTestId('fairness')
    for (const label of ['Games spread', 'Longest wait', 'Repeat partners']) await expect(panel).toContainText(label)
  })
})

test.describe('self check-in', () => {
  function selfCheckIn(request, code, data, ip = freshIp()) {
    return request.post(`/api/pickleball/open/s/${code}/check-in`, { headers: { 'cf-connecting-ip': ip }, data })
  }

  test('a player checks in once, a repeat is harmless, and the host can close check-in', async ({ request }) => {
    const { code, hostKey } = await createSession(request)
    const first = await selfCheckIn(request, code, { name: ' 🎾 Zoe ', skill: 3, duprId: 'ab12c3' })
    expect(first.status()).toBe(201)
    const body = await first.json()
    expect(body).toMatchObject({ name: 'Zoe', alreadyCheckedIn: false })
    const again = await selfCheckIn(request, code, { name: 'ZOE' })
    expect(again.status()).toBe(200)
    expect(await again.json()).toMatchObject({ playerId: body.playerId, alreadyCheckedIn: true })
    expect((await selfCheckIn(request, code, { name: 'Yan', skill: 9 })).status()).toBe(400)

    const viewer = await (await request.get(`/api/pickleball/open/s/${code}/state`)).json()
    expect(viewer.roster.filter((p) => p.name === 'Zoe')).toHaveLength(1)
    expect(JSON.stringify(viewer)).not.toContain('AB12C3')

    expect((await command(request, code, hostKey, { type: 'SET_SELF_CHECK_IN', enabled: false })).status()).toBe(200)
    expect((await selfCheckIn(request, code, { name: 'Yuri' })).status()).toBe(403)
  })

  test('a session created with check-in off refuses it', async ({ request }) => {
    const { code } = await createSession(request, { settings: { mode: 'PADDLE_STACK', target: 11, scoringStyle: 'SIDEOUT', selfCheckIn: false } })
    expect((await selfCheckIn(request, code, { name: 'Zoe' })).status()).toBe(403)
  })

  test('a flood of check-ins into one session is cut off, even from many addresses', async ({ request }) => {
    const { code } = await createSession(request)
    const statuses = []
    for (let i = 0; i < 61; i += 1) statuses.push((await selfCheckIn(request, code, { name: `Walk-in ${i}` })).status())
    expect(statuses.slice(0, 60).every((s) => s === 201)).toBe(true)
    expect(statuses[60]).toBe(429)
  })

  test('the check-in page adds the player, and the board then knows who they are', async ({ page, request }) => {
    const { code } = await createSession(request)
    const ip = freshIp()
    await page.route('**/api/pickleball/open/s/*/check-in', (route) =>
      route.continue({ headers: { ...route.request().headers(), 'cf-connecting-ip': ip } }))
    await page.goto(`/pickleball/s/${code}`)
    await page.getByRole('link', { name: 'Not on the list? Check in' }).click()
    await page.getByLabel('Your name').fill('Zoe')
    await page.getByLabel('Skill (optional)').selectOption('3')
    await page.getByRole('button', { name: 'Check in' }).click()
    await expect(page.getByRole('heading', { name: "You're in, Zoe." })).toBeVisible()
    await page.getByRole('link', { name: 'See the board' }).click()
    await expect(page.getByLabel("I'm…").locator('option:checked')).toHaveText('Zoe')
  })

  test('the host shares a check-in QR and can turn check-in off from the share sheet', async ({ page, request }) => {
    const { code, hostKey } = await createSession(request)
    await page.goto(`/pickleball/s/${code}#host=${hostKey}`)
    await page.getByRole('button', { name: 'Share board' }).click()
    const sheet = page.getByRole('dialog', { name: 'Share' })
    await expect(sheet.getByRole('img', { name: 'QR code for self check-in' })).toBeVisible()
    await sheet.getByRole('button', { name: 'Turn self check-in off' }).click()
    await expect(sheet.getByText('Self check-in is off. Only you can add players.')).toBeVisible()
  })
})

test.describe('court captains (API)', () => {
  async function makeCaptain(request, code, hostKey, courtId) {
    const response = await request.post(`/api/pickleball/open/s/${code}/captains`, { headers: { 'X-Host-Key': hostKey }, data: { courtId } })
    expect(response.status()).toBe(201)
    return response.json()
  }
  function asCaptain(request, code, captainKey, cmd) {
    return request.post(`/api/pickleball/open/s/${code}/commands`, {
      headers: { 'X-Captain-Key': captainKey },
      data: { idempotencyKey: crypto.randomUUID(), command: cmd },
    })
  }

  test('a captain runs their own court and nothing else, and a second save says who saved it', async ({ request }) => {
    const { code, hostKey } = await createSession(request)
    const host = await hostSnapshot(request, code, hostKey)
    const [court1, court2] = host.courts
    const { captainKey, label } = await makeCaptain(request, code, hostKey, court1.id)
    expect(label).toBe('Court 1 captain')
    expect((await asCaptain(request, code, captainKey, { type: 'START_MATCH', matchId: court1.match.id })).status()).toBe(200)

    const other = await asCaptain(request, code, captainKey, { type: 'START_MATCH', matchId: court2.match.id })
    expect(other.status()).toBe(403)
    expect((await other.json()).error).toBe('This captain link only runs Court 1.')
    expect((await asCaptain(request, code, captainKey, { type: 'END_SESSION' })).status()).toBe(403)

    const saved = await asCaptain(request, code, captainKey, { type: 'RECORD_RESULT', matchId: court1.match.id, winner: 'A', scoreA: 11, scoreB: 6 })
    expect(saved.status()).toBe(200)
    expect((await saved.json()).captain.court.id).toBe(court1.id)
    const hostAgain = await command(request, code, hostKey, { type: 'RECORD_RESULT', matchId: court1.match.id, winner: 'B', scoreA: 6, scoreB: 11 })
    expect(hostAgain.status()).toBe(409)
    expect((await hostAgain.json()).error).toBe('This game was already saved by Court 1 captain.')

    const snapshot = await (await request.get(`/api/pickleball/open/s/${code}/captain`, { headers: { 'X-Captain-Key': captainKey } })).json()
    expect(JSON.stringify(snapshot)).not.toMatch(/skill|duprId|keyHash|key_hash/)
    const hostView = await hostSnapshot(request, code, hostKey)
    expect(hostView.captains.map((c) => c.label)).toEqual(['Court 1 captain'])
    expect(JSON.stringify(hostView)).not.toContain(captainKey)
  })

  test('a revoked captain link stops working at once; a stranger cannot make or revoke links', async ({ request, baseURL }) => {
    const { code, hostKey } = await createSession(request)
    const host = await hostSnapshot(request, code, hostKey)
    const { captainKey, captainId } = await makeCaptain(request, code, hostKey, host.courts[0].id)
    expect((await request.post(`/api/pickleball/open/s/${code}/captains`, { headers: { 'X-Host-Key': 'wrong-key-wrong-key' }, data: { courtId: host.courts[0].id } })).status()).toBe(403)
    expect((await request.post(`/api/pickleball/open/s/${code}/captains`, { headers: { 'X-Captain-Key': captainKey }, data: { courtId: host.courts[0].id } })).status()).toBe(403)

    // A browser always sends Origin on DELETE; Astro's CSRF check rejects a bodyless request without one.
    const revoked = await request.delete(`/api/pickleball/open/s/${code}/captains/${captainId}`, { headers: { 'X-Host-Key': hostKey, Origin: baseURL } })
    expect(revoked.status()).toBe(200)
    const after = await asCaptain(request, code, captainKey, { type: 'START_MATCH', matchId: host.courts[0].match.id })
    expect(after.status()).toBe(403)
    expect((await after.json()).error).toBe('This captain link is no longer valid.')
    expect((await request.get(`/api/pickleball/open/s/${code}/captain`, { headers: { 'X-Captain-Key': captainKey } })).status()).toBe(403)
  })
})

test.describe('court captains (screens)', () => {
  test('the host makes a captain link on the console, and the captain saves a game from their phone', async ({ page, browser, request }) => {
    const { code, hostKey } = await createSession(request)
    await page.goto(`/pickleball/s/${code}#host=${hostKey}`)
    await page.getByRole('button', { name: 'More' }).click()
    await page.getByRole('button', { name: 'Court captains' }).click()
    await page.getByRole('button', { name: 'Make a link for Court 1' }).click()
    const link = await page.getByLabel('Captain link for Court 1').inputValue()
    expect(link).toContain('#cap=')

    const captainContext = await browser.newContext()
    const captain = await captainContext.newPage()
    await captain.goto(link)
    await expect(captain.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(captain.getByText('Court 1 captain')).toBeVisible()
    expect(captain.url()).not.toContain('#cap=')
    await expect(captain.getByTestId('court-2')).toHaveCount(0)
    await captain.getByTestId('court-1').getByRole('button', { name: 'Start' }).click()
    await captain.getByTestId('court-1').getByRole('button', { name: 'Game over' }).click()
    const dialog = captain.getByRole('dialog')
    await dialog.getByRole('radio').first().click()
    await dialog.getByRole('button', { name: '7', exact: true }).click()
    await dialog.getByRole('button', { name: 'Save 11–7' }).click()
    await expect(page.getByText('11–7').first()).toBeVisible()
    await captainContext.close()
  })

  test('turning a captain link off works at once, even with the captain page open', async ({ page, request, baseURL }) => {
    const { code, hostKey } = await createSession(request)
    const host = await hostSnapshot(request, code, hostKey)
    const made = await request.post(`/api/pickleball/open/s/${code}/captains`, { headers: { 'X-Host-Key': hostKey }, data: { courtId: host.courts[0].id } })
    const { captainKey, captainId } = await made.json()
    await page.goto(`/pickleball/s/${code}#cap=${captainKey}`)
    await expect(page.getByText('Court 1 captain')).toBeVisible()
    const revoked = await request.delete(`/api/pickleball/open/s/${code}/captains/${captainId}`, { headers: { 'X-Host-Key': hostKey, Origin: baseURL } })
    expect(revoked.status()).toBe(200)
    await expect(page.getByText('This captain link was turned off by the host.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Start' })).toHaveCount(0)
    // Reopening the link later lands on the public board too.
    await page.goto(`/pickleball/s/${code}`)
    await expect(page.getByText('Walk on now').first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Start' })).toHaveCount(0)
  })

  for (const width of [390, 768, 1280, 1920]) {
    test(`captain console and captains sheet fit a ${width}px screen without sideways scrolling`, async ({ page, browser, request }) => {
      const { code, hostKey } = await createSession(request, { courtCount: 8, players: Array.from({ length: 30 }, (_, i) => ({ name: `Player ${i + 1}` })) })
      await page.setViewportSize({ width, height: 900 })
      await page.goto(`/pickleball/s/${code}#host=${hostKey}`)
      await page.getByRole('button', { name: 'More' }).click()
      // The menu must sit on screen: anchored to a wrapped More button it once ran off the left edge.
      const item = await page.getByRole('button', { name: 'Court captains' }).boundingBox()
      expect(item.x >= 0 && item.x + item.width <= width).toBe(true)
      await page.getByRole('button', { name: 'Court captains' }).click()
      await page.getByRole('button', { name: 'Make a link for Court 1' }).click()
      const link = await page.getByLabel('Captain link for Court 1').inputValue()
      const sheet = page.getByRole('dialog', { name: 'Court captains' })
      await expect(sheet.getByRole('img', { name: 'QR code for the Court 1 captain link' })).toBeVisible()
      expect(await sheet.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

      const captainContext = await browser.newContext({ viewport: { width, height: 900 } })
      const captain = await captainContext.newPage()
      await captain.goto(link)
      await expect(captain.getByTestId('court-1')).toBeVisible()
      expect(await captain.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await captainContext.close()
    })
  }
})

test.describe('court captains: keys survive server hiccups', () => {
  /** Answers every socket AUTH with `type` instead of passing it to the server; everything else goes through. */
  async function answerAuthWith(page, type) {
    const seen = { auth: 0, connectedAt: [] }
    await page.routeWebSocket(/\/pickleball\/rt\/open\//, (ws) => {
      seen.connectedAt.push(Date.now())
      const server = ws.connectToServer()
      ws.onMessage((message) => {
        if (JSON.parse(String(message)).type === 'AUTH') {
          seen.auth += 1
          ws.send(JSON.stringify({ type }))
        } else {
          server.send(message)
        }
      })
    })
    return seen
  }

  async function makeCaptain(request, code, hostKey, courtId) {
    const response = await request.post(`/api/pickleball/open/s/${code}/captains`, { headers: { 'X-Host-Key': hostKey }, data: { courtId } })
    expect(response.status()).toBe(201)
    return response.json()
  }

  test('a server error while the host signs in on the socket keeps the console and the key', async ({ page, context, request }) => {
    const { code, hostKey } = await createSession(request)
    const seen = await answerAuthWith(page, 'AUTH_ERROR')
    await page.goto(`/pickleball/s/${code}#host=${hostKey}`)
    await expect(page.getByRole('button', { name: 'More' })).toBeVisible()
    // The socket is dropped and opened again, so sign-in is retried with the same key.
    await expect.poll(() => seen.auth, { timeout: 15_000 }).toBeGreaterThanOrEqual(2)
    await expect(page.getByRole('button', { name: 'More' })).toBeVisible()
    await page.getByTestId('court-1').getByRole('button', { name: 'Start' }).click()
    await expect(page.getByTestId('court-1').getByRole('button', { name: 'Game over' })).toBeVisible()
    const again = await context.newPage()
    await again.goto(`/pickleball/s/${code}`)
    await expect(again.getByRole('button', { name: 'More' })).toBeVisible()
  })

  test('a server error while a captain signs in on the socket keeps the captain console and the key', async ({ page, context, request }) => {
    const { code, hostKey } = await createSession(request)
    const host = await hostSnapshot(request, code, hostKey)
    const { captainKey } = await makeCaptain(request, code, hostKey, host.courts[0].id)
    const seen = await answerAuthWith(page, 'AUTH_ERROR')
    await page.goto(`/pickleball/s/${code}#cap=${captainKey}`)
    await expect(page.getByText('Court 1 captain')).toBeVisible()
    await expect.poll(() => seen.auth, { timeout: 15_000 }).toBeGreaterThanOrEqual(2)
    await expect(page.getByText('Court 1 captain')).toBeVisible()
    await expect(page.getByText('This captain link was turned off by the host.')).toHaveCount(0)
    const again = await context.newPage()
    await again.goto(`/pickleball/s/${code}`)
    await expect(again.getByText('Court 1 captain')).toBeVisible()
  })

  test('while sign-in keeps failing, the host console still refreshes by polling and reconnects back off', async ({ page, request }) => {
    test.setTimeout(60_000)
    const { code, hostKey } = await createSession(request)
    const seen = await answerAuthWith(page, 'AUTH_ERROR')
    await page.goto(`/pickleball/s/${code}#host=${hostKey}`)
    await expect(page.getByTestId('court-1').getByRole('button', { name: 'Start' })).toBeVisible()
    // Someone else starts court 1. This socket never signs in, so only the HTTP poll can show it.
    const host = await hostSnapshot(request, code, hostKey)
    expect((await command(request, code, hostKey, { type: 'START_MATCH', matchId: host.courts[0].match.id })).status()).toBe(200)
    await expect(page.getByTestId('court-1').getByRole('button', { name: 'Game over' })).toBeVisible({ timeout: 15_000 })
    // Reconnects wait 1, 2, 4 s… instead of hammering the server every second.
    await expect.poll(() => seen.connectedAt.length, { timeout: 20_000 }).toBeGreaterThanOrEqual(4)
    const gaps = seen.connectedAt.slice(1).map((t, i) => t - seen.connectedAt[i])
    expect(gaps[2]).toBeGreaterThan(gaps[0] + 1500)
  })

  test('while sign-in keeps failing, the captain console still refreshes by polling', async ({ page, request }) => {
    test.setTimeout(60_000)
    const { code, hostKey } = await createSession(request)
    const host = await hostSnapshot(request, code, hostKey)
    const { captainKey } = await makeCaptain(request, code, hostKey, host.courts[0].id)
    await answerAuthWith(page, 'AUTH_ERROR')
    await page.goto(`/pickleball/s/${code}#cap=${captainKey}`)
    await expect(page.getByTestId('court-1').getByRole('button', { name: 'Start' })).toBeVisible()
    expect((await command(request, code, hostKey, { type: 'START_MATCH', matchId: host.courts[0].match.id })).status()).toBe(200)
    await expect(page.getByTestId('court-1').getByRole('button', { name: 'Game over' })).toBeVisible({ timeout: 15_000 })
  })

  test('a captain key the socket refuses (AUTH_FAILED) still drops to the board and is forgotten', async ({ page, context, request }) => {
    const { code, hostKey } = await createSession(request)
    const host = await hostSnapshot(request, code, hostKey)
    const { captainKey } = await makeCaptain(request, code, hostKey, host.courts[0].id)
    await answerAuthWith(page, 'AUTH_FAILED')
    await page.goto(`/pickleball/s/${code}#cap=${captainKey}`)
    await expect(page.getByText('This captain link was turned off by the host.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Start' })).toHaveCount(0)
    const again = await context.newPage()
    await again.goto(`/pickleball/s/${code}`)
    await expect(again.getByText('Walk on now').first()).toBeVisible()
    await expect(again.getByText('Court 1 captain')).toHaveCount(0)
  })

  test('a host key the socket refuses (AUTH_FAILED) still drops to the board', async ({ page, request }) => {
    const { code, hostKey } = await createSession(request)
    await answerAuthWith(page, 'AUTH_FAILED')
    await page.goto(`/pickleball/s/${code}#host=${hostKey}`)
    await expect(page.getByText("That host link isn't valid for this session.")).toBeVisible()
    await expect(page.getByRole('button', { name: 'More' })).toHaveCount(0)
  })

  test('a turned-off captain link falls back to the live captain key this phone already had', async ({ page, request, baseURL }) => {
    const { code, hostKey } = await createSession(request)
    const host = await hostSnapshot(request, code, hostKey)
    const old = await makeCaptain(request, code, hostKey, host.courts[0].id)
    const live = await makeCaptain(request, code, hostKey, host.courts[0].id)
    expect(live.label).toBe('Court 1 captain 2')
    expect((await request.delete(`/api/pickleball/open/s/${code}/captains/${old.captainId}`, { headers: { 'X-Host-Key': hostKey, Origin: baseURL } })).status()).toBe(200)
    await page.goto(`/pickleball/s/${code}#cap=${live.captainKey}`)
    await expect(page.getByText('Court 1 captain 2')).toBeVisible()
    await page.goto('about:blank')
    await page.goto(`/pickleball/s/${code}#cap=${old.captainKey}`)
    await expect(page.getByText('Court 1 captain 2')).toBeVisible()
    await expect(page.getByText('This captain link was turned off by the host.')).toHaveCount(0)
    await page.goto('about:blank')
    await page.goto(`/pickleball/s/${code}`)
    await expect(page.getByText('Court 1 captain 2')).toBeVisible()
  })

  test('a host who opens a captain link stays the host and does not keep the captain key', async ({ page, request }) => {
    const { code, hostKey } = await createSession(request)
    const host = await hostSnapshot(request, code, hostKey)
    const { captainKey } = await makeCaptain(request, code, hostKey, host.courts[0].id)
    await page.goto(`/pickleball/s/${code}#host=${hostKey}`)
    await expect(page.getByRole('button', { name: 'More' })).toBeVisible()
    await page.goto('about:blank')
    await page.goto(`/pickleball/s/${code}#cap=${captainKey}`)
    await expect(page.getByRole('button', { name: 'More' })).toBeVisible()
    expect(await page.evaluate(() => localStorage.getItem('devlab-pickleball-captain') ?? '')).not.toContain(captainKey)
  })

  test('sending a captain link says whether it was copied, and turning one off sends one request', async ({ page, request }) => {
    const { code, hostKey } = await createSession(request)
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'share', { value: undefined, configurable: true })
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async (text) => { if (window.failCopy) throw new Error('denied'); window.copied = text } },
      })
      window.confirm = () => true
    })
    await page.goto(`/pickleball/s/${code}#host=${hostKey}`)
    await page.getByRole('button', { name: 'More' }).click()
    await page.getByRole('button', { name: 'Court captains' }).click()
    await page.getByRole('button', { name: 'Make a link for Court 1' }).click()
    await page.getByRole('button', { name: 'Send link' }).click()
    await expect(page.getByText('Copied', { exact: true })).toBeVisible()
    expect(await page.evaluate(() => window.copied)).toContain('#cap=')
    await page.evaluate(() => { window.failCopy = true })
    await page.getByRole('button', { name: 'Send link' }).click()
    await expect(page.getByText("Couldn't copy — copy the link below")).toBeVisible()

    let deletes = 0
    page.on('request', (r) => { if (r.method() === 'DELETE' && r.url().includes('/captains/')) deletes += 1 })
    // Two taps in the same frame, before React re-renders the button as disabled.
    await page.getByRole('button', { name: 'Turn off Court 1 captain' }).evaluate((button) => { button.click(); button.click() })
    await expect(page.getByRole('button', { name: 'Turn off Court 1 captain' })).toHaveCount(0)
    expect(deletes).toBe(1)
  })
})

test.describe('TV board', () => {
  for (const [width, height] of [[1920, 1080], [1280, 720]]) {
    test(`16 courts fit a ${width}×${height} screen with no scrolling, in type readable across a hall`, async ({ page, request }) => {
      const { code } = await createSession(request, { courtCount: 16, players: Array.from({ length: 70 }, (_, i) => ({ name: `Player ${i + 1}` })) })
      await page.setViewportSize({ width, height })
      await page.goto(`/pickleball/s/${code}/tv`)
      await expect(page.getByTestId('tv-court')).toHaveCount(16)
      await page.waitForTimeout(600) // type is fitted to each card a frame after it renders
      const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth && document.documentElement.scrollHeight <= window.innerHeight)
      expect(fits).toBe(true)
      // Every card holds its own content: nothing spills out of a court.
      const spill = await page.getByTestId('tv-court').evaluateAll((cards) => cards.filter((el) => el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1).length)
      expect(spill).toBe(0)
      const size = await page.getByTestId('tv-court').first().evaluate((el) => parseFloat(getComputedStyle(el.querySelector('p')).fontSize))
      // About 5 m from a 1080p screen: names at least 24 px tall; at 720p the floor is 18 px.
      expect(size).toBeGreaterThanOrEqual(height === 1080 ? 24 : 18)
        })
  }

  test('the TV shows the fairness panel and the check-in QR, and updates when a result is saved', async ({ page, request }) => {
    const { code, hostKey } = await createSession(request)
    await page.setViewportSize({ width: 1920, height: 1080 })
    await page.goto(`/pickleball/s/${code}/tv`)
    await expect(page.getByTestId('fairness')).toBeVisible()
    await expect(page.getByRole('img', { name: 'QR code for self check-in' })).toBeVisible()
    const host = await hostSnapshot(request, code, hostKey)
    expect((await command(request, code, hostKey, { type: 'RECORD_RESULT', matchId: host.courts[0].match.id, winner: 'A', scoreA: 11, scoreB: 4 })).status()).toBe(200)
    // The side panel swaps standings and results every 15 s, so accept either view of the saved game.
    await expect(page.getByTestId('tv-panel')).toContainText(/1–0|11–4/)
  })

  for (const courtCount of [4, 12]) {
    for (const [width, height] of [[1920, 1080], [1280, 720]]) {
      test(`${courtCount} courts of 40-character names are never truncated or spilling at ${width}×${height}`, async ({ page, request }) => {
        const longName = (i) => `Maximilian-Alexandrovich Montgomery ${String(i).padStart(2, '0')}`.slice(0, 40)
        const { code } = await createSession(request, { courtCount, players: Array.from({ length: courtCount * 4 + 6 }, (_, i) => ({ name: longName(i) })) })
        await page.setViewportSize({ width, height })
        await page.goto(`/pickleball/s/${code}/tv`)
        await expect(page.getByTestId('tv-court')).toHaveCount(courtCount)
        // Fitting is measured after layout and again when the web font lands, so wait for it to settle.
        await page.evaluate(() => document.fonts.ready)
        await expect.poll(() => page.getByTestId('tv-court').evaluateAll((cards) => cards.filter((el) => el.scrollHeight > el.clientHeight + 1).length)).toBe(0)
        await expect.poll(() => page.evaluate(() => [...document.querySelectorAll('body *')]
          .filter((el) => el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0)
          .map((el) => `${el.tagName}.${String(el.className).slice(0, 40)}`))).toEqual([])
        expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight)).toBe(true)
      })
    }
  }

  test('an ended session says so in big type instead of showing courts', async ({ page, request }) => {
    const { code, hostKey } = await createSession(request)
    expect((await command(request, code, hostKey, { type: 'END_SESSION' })).status()).toBe(200)
    await page.setViewportSize({ width: 1920, height: 1080 })
    await page.goto(`/pickleball/s/${code}/tv`)
    await expect(page.getByText('Session ended')).toBeVisible()
    await expect(page.getByTestId('tv-court')).toHaveCount(0)
  })

  test('the host opens the TV board from Share', async ({ page, request }) => {
    const { code, hostKey } = await createSession(request)
    await page.goto(`/pickleball/s/${code}#host=${hostKey}`)
    await page.getByRole('button', { name: 'Share board' }).click()
    await expect(page.getByRole('link', { name: 'Open the TV board' })).toHaveAttribute('href', new RegExp(`/pickleball/s/${code}/tv$`))
  })

  // Spec §11: every key screen at 390, 768, 1280 and 1920 px with no sideways scroll.
  for (const width of [390, 768, 1280, 1920]) {
    test(`check-in, captain and TV screens fit a ${width}px screen without sideways scrolling`, async ({ browser, request }) => {
      const { code, hostKey } = await createSession(request, { courtCount: 8, players: Array.from({ length: 30 }, (_, i) => ({ name: `Player ${i + 1}` })) })
      const host = await hostSnapshot(request, code, hostKey)
      const made = await request.post(`/api/pickleball/open/s/${code}/captains`, { headers: { 'X-Host-Key': hostKey }, data: { courtId: host.courts[0].id } })
      const { captainKey } = await made.json()
      for (const path of [`/pickleball/s/${code}/check-in`, `/pickleball/s/${code}#cap=${captainKey}`, `/pickleball/s/${code}/tv`]) {
        // A fresh context per screen, so a remembered captain key never leaks into the next one.
        const context = await browser.newContext({ viewport: { width, height: 900 } })
        const screen = await context.newPage()
        await screen.goto(path)
        await expect(screen.locator('main, [data-testid="court-1"]').first()).toBeVisible()
        expect(await screen.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), path).toBe(true)
        await context.close()
      }
    })
  }
})

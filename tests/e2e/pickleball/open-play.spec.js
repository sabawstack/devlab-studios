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
    const flood = await Promise.all(Array.from({ length: 125 }, () =>
      request.post(`/api/pickleball/open/s/${code}/commands`, {
        headers: { 'X-Host-Key': 'wrong-key-wrong-key', 'cf-connecting-ip': attacker },
        data: { idempotencyKey: crypto.randomUUID(), command: { type: 'END_SESSION' } },
      })))
    const statuses = flood.map((r) => r.status())
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

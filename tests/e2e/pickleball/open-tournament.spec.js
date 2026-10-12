// Free tournaments (spec §6): generate → edit → start → play to a champion for
// every format, plus the edits the draw refuses. API tests drive the real
// Worker and Durable Object; the screen tests drive the console and board.
import { test, expect } from '@playwright/test'

const NAMES = ['Ana', 'Ben', 'Cy', 'Di', 'Eva', 'Fin', 'Gus', 'Hal', 'Ivy', 'Jo', 'Kai', 'Lu', 'Max', 'Ned', 'Oz', 'Pia', 'Quin', 'Rae']

// Each create claims its own address: creation is limited to 10 per IP per day (see open-play.spec.js).
const freshIp = () => `10.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 254) + 1}`

async function createTournament(request, { players = 8, courtCount = 2, format = 'ROUND_ROBIN', names = NAMES } = {}) {
  const response = await request.post('/api/pickleball/open/sessions', {
    headers: { 'cf-connecting-ip': freshIp() },
    data: {
      name: 'Saturday Cup', hostDisplayName: 'Coach Mike', courtCount, kind: 'TOURNAMENT', tournament: { format },
      settings: { mode: 'PADDLE_STACK', target: 11, scoringStyle: 'SIDEOUT' },
      players: names.slice(0, players).map((name, i) => ({ name, skill: 5 - (i % 5), duprId: 'AB12C3' })),
    },
  })
  expect(response.status()).toBe(201)
  return response.json()
}

// Host routes allow 120 requests a minute per address, and parallel tests share
// one local address, so every call in this file comes from its test's own address.
const testIp = new Map()
const ipFor = (code) => testIp.get(code) ?? testIp.set(code, freshIp()).get(code)

function command(request, code, hostKey, cmd) {
  return request.post(`/api/pickleball/open/s/${code}/commands`, {
    headers: { 'X-Host-Key': hostKey, 'cf-connecting-ip': ipFor(code) },
    data: { idempotencyKey: crypto.randomUUID(), command: cmd },
  })
}

async function ok(request, code, hostKey, cmd) {
  const response = await command(request, code, hostKey, cmd)
  expect(response.status(), `${cmd.type}: ${await response.text()}`).toBe(200)
  return (await response.json()).host
}

async function refused(request, code, hostKey, cmd) {
  const response = await command(request, code, hostKey, cmd)
  expect(response.status()).toBe(409)
  return (await response.json()).error
}

async function hostSnapshot(request, code, hostKey) {
  const response = await request.get(`/api/pickleball/open/s/${code}/host`, { headers: { 'X-Host-Key': hostKey, 'cf-connecting-ip': ipFor(code) } })
  expect(response.status()).toBe(200)
  return response.json()
}

/** Starts and saves the game on the first busy court (side A wins 11–6) until the tournament is over. */
async function playToChampion(request, code, hostKey) {
  let host = await hostSnapshot(request, code, hostKey)
  for (let guard = 0; guard < 80; guard += 1) {
    if (host.viewer.tournament.phase === 'FINISHED') return host
    const match = host.courts.map((c) => c.match).find(Boolean)
    expect(match, 'a free court always gets the next playable game').toBeTruthy()
    if (match.status === 'PROPOSED') await ok(request, code, hostKey, { type: 'START_MATCH', matchId: match.id })
    host = await ok(request, code, hostKey, { type: 'RECORD_RESULT', matchId: match.id, winner: 'A', scoreA: 11, scoreB: 6 })
  }
  throw new Error('the tournament did not finish')
}

test.describe('tournaments (API)', () => {
  for (const [format, players, pairing, seeding, games] of [
    ['ROUND_ROBIN', 8, 'RANDOM', 'RANDOM', 6],
    ['POOL_TO_BRACKET', 16, 'BALANCED', 'BY_SKILL', 15],
    ['SINGLE_ELIMINATION', 10, 'MANUAL', 'MANUAL', 4],
    ['DOUBLE_ELIMINATION', 8, 'BALANCED', 'RANDOM', 6],
  ]) {
    test(`${format}: generate, edit the draft, start, and play to a champion`, async ({ request }) => {
      const { code, hostKey } = await createTournament(request, { players, format })
      let host = await ok(request, code, hostKey, { type: 'GENERATE_DRAW', format, pairing, seeding })
      const t = host.viewer.tournament
      expect(t.phase).toBe('DRAFT')
      expect(t.fixtures).toHaveLength(games)
      expect(host.courts.every((c) => c.match === null)).toBe(true)

      // An unrestricted draft edit: two players in different pairs trade places.
      const [first, second] = t.pairs
      host = await ok(request, code, hostKey, { type: 'EDIT_DRAW', edit: { kind: 'SWAP_PLAYERS', playerIds: [first.playerIds[0], second.playerIds[0]] } })
      expect(host.viewer.tournament.pairs[0].playerIds).toEqual([second.playerIds[0], first.playerIds[1]])

      host = await ok(request, code, hostKey, { type: 'START_TOURNAMENT' })
      expect(host.courts.map((c) => c.fixtureLabel).every(Boolean)).toBe(true)

      const done = await playToChampion(request, code, hostKey)
      expect(done.viewer.tournament.fixtures.every((f) => f.status === 'FINISHED')).toBe(true)
      const board = await (await request.get(`/api/pickleball/open/s/${code}/state`)).json()
      expect(board.tournament.champion?.name).toMatch(/ & /)
      expect(JSON.stringify(board)).not.toMatch(/AB12C3|skill|duprId/)

      const csv = await (await request.get(`/api/pickleball/open/s/${code}/results.csv`, { headers: { 'X-Host-Key': hostKey, 'cf-connecting-ip': ipFor(code) } })).text()
      expect(csv).toContain('Game,Stage,Court')
      expect(csv).toContain('Rank,Pool,Pair,Played,Won,Lost')
    })
  }

  test('edits that break the draw are refused with the reason', async ({ request }) => {
    const { code, hostKey } = await createTournament(request, { players: 9 })
    let host = await ok(request, code, hostKey, { type: 'GENERATE_DRAW', format: 'ROUND_ROBIN', pairing: 'MANUAL', seeding: 'MANUAL' })
    const t = host.viewer.tournament
    const [g1, g2] = t.fixtures.filter((f) => f.roundNumber === 1)
    expect(await refused(request, code, hostKey, { type: 'EDIT_DRAW', edit: { kind: 'SET_OPPONENT', fixtureId: g1.id, side: 'B', entrantId: g2.entrantBId } }))
      .toMatch(/would play each other twice\.$/)
    expect(await refused(request, code, hostKey, { type: 'EDIT_DRAW', edit: { kind: 'MOVE_PAIR', entrantId: t.pairs[0].id, poolLabel: 'B' } }))
      .toBe('Only a draw with pools has pools to move between.')
    expect(await refused(request, code, hostKey, { type: 'START_TOURNAMENT' })).toBe('Ivy has no partner. Swap them into a pair, or put them on a break to keep them as a substitute.')
    expect(await refused(request, code, hostKey, { type: 'SET_MODE', mode: 'BALANCED' })).toBe('That is for open play. In a tournament the draw decides who plays whom.')

    const ivy = host.players.find((p) => p.name === 'Ivy')
    await ok(request, code, hostKey, { type: 'SET_PLAYER_STATUS', playerId: ivy.id, status: 'BREAK' })
    host = await ok(request, code, hostKey, { type: 'START_TOURNAMENT' })
    expect(await refused(request, code, hostKey, { type: 'EDIT_DRAW', edit: { kind: 'SWAP_PLAYERS', playerIds: [t.pairs[0].playerIds[0], t.pairs[1].playerIds[0]] } }))
      .toMatch(/^The draw is locked once the tournament starts\./)
    expect(await refused(request, code, hostKey, { type: 'GENERATE_DRAW', format: 'ROUND_ROBIN', pairing: 'RANDOM', seeding: 'RANDOM' })).toBe('The draw is locked once the tournament starts.')

    const game = host.courts[0].match
    await ok(request, code, hostKey, { type: 'START_MATCH', matchId: game.id })
    const pairOnCourt = host.viewer.tournament.pairs.find((p) => p.playerIds.includes(game.teamA[0]))
    expect(await refused(request, code, hostKey, { type: 'SUBSTITUTE_PLAYER', entrantId: pairOnCourt.id, outPlayerId: game.teamA[0], inPlayerId: ivy.id }))
      .toMatch(/are on court\. Substitute after their game\.$/)
    const later = host.viewer.tournament.fixtures.find((f) => f.roundNumber === 2)
    expect(await refused(request, code, hostKey, { type: 'SWAP_OPPONENTS', fixtureId: g1.id, side: 'B', otherFixtureId: later.id, otherSide: 'B' }))
      .toMatch(/same round|already started/)
    expect(await refused(request, code, hostKey, { type: 'SET_PLAYER_STATUS', playerId: game.teamA[0], status: 'LEFT' })).toMatch(/is playing|Substitute them first/)
  })

  test('a substitute takes a player’s place in a pair that is not on court', async ({ request }) => {
    const { code, hostKey } = await createTournament(request, { players: 9, courtCount: 1 })
    await ok(request, code, hostKey, { type: 'GENERATE_DRAW', format: 'ROUND_ROBIN', pairing: 'MANUAL', seeding: 'MANUAL' })
    let host = await hostSnapshot(request, code, hostKey)
    const ivy = host.players.find((p) => p.name === 'Ivy')
    await ok(request, code, hostKey, { type: 'SET_PLAYER_STATUS', playerId: ivy.id, status: 'BREAK' })
    host = await ok(request, code, hostKey, { type: 'START_TOURNAMENT' })
    const onCourt = new Set([...host.courts[0].match.teamA, ...host.courts[0].match.teamB])
    const resting = host.viewer.tournament.pairs.find((p) => !p.playerIds.some((id) => onCourt.has(id)))
    host = await ok(request, code, hostKey, { type: 'SUBSTITUTE_PLAYER', entrantId: resting.id, outPlayerId: resting.playerIds[1], inPlayerId: ivy.id })
    const after = host.viewer.tournament.pairs.find((p) => p.id === resting.id)
    expect(after.playerIds).toEqual([resting.playerIds[0], ivy.id])
    expect(host.players.find((p) => p.id === ivy.id).status).toBe('ACTIVE')
  })

  test('a court captain saves results on their tournament court, and nothing else', async ({ request }) => {
    const { code, hostKey } = await createTournament(request, { players: 8 })
    await ok(request, code, hostKey, { type: 'GENERATE_DRAW', format: 'SINGLE_ELIMINATION', pairing: 'MANUAL', seeding: 'MANUAL' })
    const host = await ok(request, code, hostKey, { type: 'START_TOURNAMENT' })
    const made = await request.post(`/api/pickleball/open/s/${code}/captains`, { headers: { 'X-Host-Key': hostKey, 'cf-connecting-ip': ipFor(code) }, data: { courtId: host.courts[0].id } })
    const { captainKey } = await made.json()
    const asCaptain = (cmd) => request.post(`/api/pickleball/open/s/${code}/commands`, {
      headers: { 'X-Captain-Key': captainKey }, data: { idempotencyKey: crypto.randomUUID(), command: cmd },
    })
    const view = await (await request.get(`/api/pickleball/open/s/${code}/captain`, { headers: { 'X-Captain-Key': captainKey } })).json()
    expect(view.court.fixtureLabel).toBe('Semi-final 1')
    const saved = await asCaptain({ type: 'RECORD_RESULT', matchId: host.courts[0].match.id, winner: 'B', scoreA: 9, scoreB: 11 })
    expect(saved.status()).toBe(200)
    // The final still waits for the other semi-final, so this court has nothing to play yet.
    expect((await saved.json()).captain.court.blocked).toBe('Waiting for a result that decides the next game.')
    expect((await asCaptain({ type: 'START_TOURNAMENT' })).status()).toBe(403)
    const board = await (await request.get(`/api/pickleball/open/s/${code}/state`)).json()
    expect(board.tournament.fixtures.find((f) => f.label === 'Final').nameA).not.toBeNull()
  })

  test('a retried Generate (same idempotency key) never draws again', async ({ request }) => {
    const { code, hostKey } = await createTournament(request, { players: 8 })
    const send = () => request.post(`/api/pickleball/open/s/${code}/commands`, {
      headers: { 'X-Host-Key': hostKey, 'cf-connecting-ip': ipFor(code) },
      data: { idempotencyKey: 'generate-once-1234', command: { type: 'GENERATE_DRAW', format: 'ROUND_ROBIN', pairing: 'RANDOM', seeding: 'RANDOM' } },
    })
    const first = await (await send()).json()
    const again = await (await send()).json()
    expect(again.version).toBe(first.version)
    expect(again.host.viewer.tournament.pairs).toEqual(first.host.viewer.tournament.pairs)
  })
})

/** A tournament created, drawn and (optionally) started over the API, ready for a screen test. */
async function readyTournament(request, { players = 8, courtCount = 2, format = 'SINGLE_ELIMINATION', start = true, names = NAMES } = {}) {
  const session = await createTournament(request, { players, courtCount, format, names })
  await ok(request, session.code, session.hostKey, { type: 'GENERATE_DRAW', format, pairing: 'MANUAL', seeding: 'MANUAL' })
  if (start) await ok(request, session.code, session.hostKey, { type: 'START_TOURNAMENT' })
  return session
}

const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)

test.describe('tournament setup and draft (screens)', () => {
  test('a host sets up a tournament in the browser: format, draw, a swap, then start', async ({ page }) => {
    const ip = freshIp()
    await page.route('**/api/pickleball/open/sessions', (route) =>
      route.request().method() === 'POST' ? route.continue({ headers: { ...route.request().headers(), 'cf-connecting-ip': ip } }) : route.continue())
    await page.goto('/pickleball/new')
    await page.getByRole('radio', { name: /^Tournament/ }).click()
    await page.getByRole('radio', { name: /^Single elimination/ }).click()
    await page.getByLabel('Your name (shown as "Hosted by")').fill('Coach Mike')
    await page.getByRole('button', { name: 'Next: add players' }).click()
    await page.getByLabel(/Paste names/).fill(NAMES.slice(0, 8).join('\n'))
    await expect(page.locator('input[name="cf-turnstile-response"]')).toHaveValue(/.+/, { timeout: 30_000 })
    await page.getByRole('button', { name: /^Start session/ }).click()
    await page.getByRole('link', { name: 'I saved it — go to courts' }).click()

    await expect(page.getByRole('heading', { name: 'Set up the draw' })).toBeVisible()
    await page.getByRole('radio', { name: /^In list order/ }).click()
    await page.getByRole('radio', { name: /^You choose/ }).click()
    await page.getByRole('button', { name: 'Generate the draw' }).click()
    await expect(page.getByRole('heading', { name: 'Draft draw · Single elimination' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Seed 1: Ana & Ben' })).toBeVisible()

    // Tap-to-select: Ana, then Cy, swaps them between pairs 1 and 2.
    await page.getByRole('button', { name: 'Select Ana' }).click()
    await page.getByRole('button', { name: 'Select Cy' }).click()
    await expect(page.getByRole('button', { name: 'Seed 1: Cy & Ben' })).toBeVisible()

    page.once('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: 'Start tournament' }).click()
    await expect(page.getByTestId('court-1')).toContainText('Semi-final 1')
    await expect(page.getByTestId('court-1').getByRole('button', { name: 'Edit' })).toHaveCount(0)
  })

  test('on a phone, Generate lands on the draft and Start lands on the courts', async ({ page, request }) => {
    const { code, hostKey } = await createTournament(request, { players: 8, format: 'SINGLE_ELIMINATION' })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`/pickleball/s/${code}#host=${hostKey}`)
    await page.getByRole('radio', { name: /^Single elimination/ }).click()
    await page.getByRole('button', { name: 'Generate the draw' }).click()
    const draft = page.getByRole('heading', { name: 'Draft draw · Single elimination' })
    await expect(draft).toBeFocused()
    await expect(draft).toBeInViewport()
    // The pickers fold into a summary; Change setup opens them again.
    await expect(page.getByRole('heading', { name: 'Change the draw' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Change setup' }).click()
    await expect(page.getByRole('heading', { name: 'Change the draw' })).toBeVisible()
    await page.getByRole('button', { name: 'Keep this draft' }).click()

    page.once('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: 'Start tournament' }).click()
    await expect(page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: 'Courts' })).toHaveAttribute('aria-current', 'true')
    await expect(page.getByTestId('court-1')).toBeVisible()
  })

  test('an edit the draw cannot take is refused on screen with the reason', async ({ page, request }) => {
    const { code, hostKey } = await readyTournament(request, { format: 'ROUND_ROBIN', start: false })
    // A phone, where the games sit well below the top of the page.
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`/pickleball/s/${code}#host=${hostKey}`)
    // Round 1: Ana & Ben v Gus & Hal, Cy & Di v Eva & Fin. Swapping Gus & Hal for Eva & Fin repeats games from later rounds.
    await page.getByRole('article', { name: 'Round 1 · Game 1' }).getByRole('button', { name: 'Gus & Hal' }).click()
    await expect(page.getByText('Selected: Gus & Hal in Round 1 · Game 1')).toBeVisible()
    await page.getByRole('article', { name: 'Round 1 · Game 2' }).getByRole('button', { name: 'Eva & Fin' }).click()
    await expect(page.getByRole('alert')).toContainText('would play each other twice')
    await expect(page.getByRole('alert')).toBeInViewport()
    await expect(page.getByRole('article', { name: 'Round 1 · Game 1' })).toContainText('Gus & Hal')
  })

  for (const width of [390, 768, 1280, 1920]) {
    test(`the draft editor fits a ${width}px screen without sideways scrolling`, async ({ page, request }) => {
      const { code, hostKey } = await readyTournament(request, { players: 16, courtCount: 4, format: 'POOL_TO_BRACKET', start: false })
      await page.setViewportSize({ width, height: 900 })
      await page.goto(`/pickleball/s/${code}#host=${hostKey}`)
      await expect(page.getByRole('heading', { name: /^Draft draw/ })).toBeVisible()
      expect(await noSideScroll(page)).toBe(true)
    })
  }
})

async function playCourt(page, testId, loser = '6') {
  const card = page.getByTestId(testId)
  await card.getByRole('button', { name: 'Start' }).click()
  await card.getByRole('button', { name: 'Game over' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('radio').first().click()
  await dialog.getByRole('button', { name: loser, exact: true }).click()
  await dialog.getByRole('button', { name: `Save 11–${loser}` }).click()
  await expect(dialog).toHaveCount(0)
}

test.describe('running a tournament (screens)', () => {
  test('the host plays a knockout to a champion from the console', async ({ page, request }) => {
    const { code, hostKey } = await readyTournament(request)
    await page.goto(`/pickleball/s/${code}#host=${hostKey}`)
    await playCourt(page, 'court-1')
    await expect(page.getByRole('article', { name: 'Final', exact: true })).toContainText('Ana & Ben')
    await playCourt(page, 'court-2')
    await expect(page.getByTestId('court-1')).toContainText('Final')
    await playCourt(page, 'court-1')
    await expect(page.getByTestId('podium-1')).toContainText('Ana & Ben')
  })

  test('the host substitutes a player and swaps opponents from the console', async ({ page, request }) => {
    const { code, hostKey } = await createTournament(request, { players: 17, courtCount: 1, format: 'SINGLE_ELIMINATION' })
    await ok(request, code, hostKey, { type: 'GENERATE_DRAW', format: 'SINGLE_ELIMINATION', pairing: 'MANUAL', seeding: 'MANUAL' })
    const host = await hostSnapshot(request, code, hostKey)
    await ok(request, code, hostKey, { type: 'SET_PLAYER_STATUS', playerId: host.players.find((p) => p.name === 'Quin').id, status: 'BREAK' })
    await ok(request, code, hostKey, { type: 'START_TOURNAMENT' })
    // A late arrival who sorts after the player on a break: the break player is still offered first.
    await ok(request, code, hostKey, { type: 'ADD_PLAYERS', names: ['Zed'] })
    await page.goto(`/pickleball/s/${code}#host=${hostKey}`)

    await page.getByRole('button', { name: 'Substitute a player' }).click()
    const sheet = page.getByRole('dialog')
    await expect(sheet.getByRole('combobox', { name: 'Substitute' }).locator('option')).toHaveText(['Pick one', 'Quin (on a break)', 'Zed'])
    // Seeds 1–8 in list order: quarter-final 3 is Cy & Di v Max & Ned, quarter-final 4 Eva & Fin v Kai & Lu.
    await sheet.getByRole('combobox', { name: 'Pair' }).selectOption({ label: 'Kai & Lu' })
    await sheet.getByRole('combobox', { name: 'Player coming off' }).selectOption({ label: 'Lu' })
    await sheet.getByRole('combobox', { name: 'Substitute' }).selectOption({ label: 'Quin (on a break)' })
    await sheet.getByRole('button', { name: 'Substitute' }).click()
    await expect(page.getByRole('article', { name: 'Quarter-final 4' })).toContainText('Kai & Quin')

    // Quarter-finals 3 and 4 have not started: swap their second pairs.
    await page.getByRole('article', { name: 'Quarter-final 3' }).getByRole('button', { name: 'Max & Ned' }).click()
    await page.getByRole('article', { name: 'Quarter-final 4' }).getByRole('button', { name: 'Kai & Quin' }).click()
    await expect(page.getByRole('article', { name: 'Quarter-final 3' })).toContainText('Kai & Quin')
    await expect(page.getByRole('article', { name: 'Quarter-final 4' })).toContainText('Max & Ned')
  })
})

/** The phone tab bar is hidden from lg, where the draw is always on screen. */
async function openDraw(page) {
  const nav = page.getByRole('navigation', { name: 'Sections' })
  if (await nav.isVisible()) await nav.getByRole('button', { name: 'Draw' }).click()
}

test.describe('running a tournament (refusals, motion, widths)', () => {
  test('a refused substitute keeps its reason and its picks inside the sheet', async ({ page, request }) => {
    const { code, hostKey } = await createTournament(request, { players: 17, courtCount: 1, format: 'SINGLE_ELIMINATION' })
    await ok(request, code, hostKey, { type: 'GENERATE_DRAW', format: 'SINGLE_ELIMINATION', pairing: 'MANUAL', seeding: 'MANUAL' })
    const host = await hostSnapshot(request, code, hostKey)
    await ok(request, code, hostKey, { type: 'SET_PLAYER_STATUS', playerId: host.players.find((p) => p.name === 'Quin').id, status: 'BREAK' })
    await ok(request, code, hostKey, { type: 'START_TOURNAMENT' })
    await page.route(`**/api/pickleball/open/s/${code}/commands`, (route) =>
      route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'Kai & Lu are on court. Substitute after their game.' }) }))
    await page.goto(`/pickleball/s/${code}#host=${hostKey}`)
    await page.getByRole('button', { name: 'Substitute a player' }).click()
    const sheet = page.getByRole('dialog')
    await sheet.getByRole('combobox', { name: 'Pair' }).selectOption({ label: 'Kai & Lu' })
    await sheet.getByRole('combobox', { name: 'Player coming off' }).selectOption({ label: 'Lu' })
    await sheet.getByRole('combobox', { name: 'Substitute' }).selectOption({ label: 'Quin (on a break)' })
    await sheet.getByRole('button', { name: 'Substitute' }).click()
    await expect(sheet.getByRole('alert')).toContainText('are on court')
    await expect(sheet.getByRole('combobox', { name: 'Player coming off' })).toHaveValue(/.+/)
    await expect(sheet.getByRole('combobox', { name: 'Substitute' })).toHaveValue(/.+/)
  })

  test('a pair on court cannot be picked as the pair to substitute in', async ({ page, request }) => {
    const { code, hostKey } = await readyTournament(request)
    await page.goto(`/pickleball/s/${code}#host=${hostKey}`)
    await page.getByTestId('court-1').getByRole('button', { name: 'Start' }).click()
    await openDraw(page)
    await page.getByRole('button', { name: 'Substitute a player' }).click()
    await expect(page.getByRole('dialog').getByRole('option', { name: 'Ana & Ben (on court)' })).toHaveAttribute('disabled', '')
  })

  test('a refused opponent swap shows its reason in view and clears the selection', async ({ page, request }) => {
    const { code, hostKey } = await readyTournament(request, { players: 16, courtCount: 1 })
    await page.goto(`/pickleball/s/${code}#host=${hostKey}`)
    // Whatever the server says about the swap is shown, and the pair stops being selected.
    await openDraw(page)
    const first = page.getByRole('article', { name: /Quarter-final 3/ }).getByRole('button').first()
    await first.click()
    await expect(first).toHaveAttribute('aria-pressed', 'true')
    await page.route(`**/api/pickleball/open/s/${code}/commands`, (route) =>
      route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'One of those games has already started.' }) }))
    await page.getByRole('article', { name: /Quarter-final 4/ }).getByRole('button').first().click()
    await expect(page.getByRole('alert')).toContainText('already started')
    await expect(first).toHaveAttribute('aria-pressed', 'false')
  })

  test('the podium celebration does not animate under reduced motion, and the champions are announced', async ({ page, request }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const { code, hostKey } = await readyTournament(request)
    await page.goto(`/pickleball/s/${code}#host=${hostKey}`)
    await playCourt(page, 'court-1')
    await playCourt(page, 'court-2')
    await playCourt(page, 'court-1')
    const podium = page.getByTestId('podium-1')
    await expect(podium).toBeVisible()
    const animated = podium.locator('.pb-rise, .pb-fade-in')
    expect(await animated.count()).toBeGreaterThan(0)
    const names = await animated.evaluateAll((els) => els.map((el) => getComputedStyle(el).animationName))
    expect(names.every((name) => name === 'none')).toBe(true)
    // The live region stays mounted from the start, so the announcement is heard (the podium replaced the banner).
    await expect(page.getByTestId('champion-announcement')).toHaveText('Champions: Ana & Ben')
  })

  for (const width of [390, 768, 1280, 1920]) {
    test(`a running tournament fits a ${width}px screen without sideways scrolling`, async ({ page, request }) => {
      const { code, hostKey } = await readyTournament(request, { players: 16, courtCount: 4, format: 'POOL_TO_BRACKET' })
      await page.setViewportSize({ width, height: 900 })
      await page.goto(`/pickleball/s/${code}#host=${hostKey}`)
      await expect(page.getByTestId('court-1')).toBeVisible()
      expect(await noSideScroll(page)).toBe(true)
      if (width < 1024) {
        await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: 'Draw' }).click()
        expect(await noSideScroll(page)).toBe(true)
      }
    })
  }
})

test.describe('tournament board and TV (screens)', () => {
  test('a second screen sees the bracket fill as results are saved, then the champions', async ({ page, request }) => {
    const { code, hostKey } = await readyTournament(request)
    await page.goto(`/pickleball/s/${code}`)
    const final = page.getByRole('article', { name: 'Final', exact: true })
    await expect(final).toContainText('Winner of Semi-final 1')
    const host = await hostSnapshot(request, code, hostKey)
    await ok(request, code, hostKey, { type: 'RECORD_RESULT', matchId: host.courts[0].match.id, winner: 'A', scoreA: 11, scoreB: 4 })
    await expect(final).toContainText('Ana & Ben')
    await playToChampion(request, code, hostKey)
    await expect(page.getByTestId('podium-1')).toContainText('Ana & Ben')
    // The courts are idle once there are champions, so the board drops them.
    await expect(page.getByRole('region', { name: 'Courts' })).toHaveCount(0)
  })

  test('a player who picks their name sees their next game', async ({ page, request }) => {
    const { code, hostKey } = await readyTournament(request, { courtCount: 1 })
    const host = await hostSnapshot(request, code, hostKey)
    await page.goto(`/pickleball/s/${code}`)
    await page.getByLabel("I'm…").selectOption({ label: 'Cy' })
    await expect(page.getByRole('status').filter({ hasText: 'Your next game: Semi-final 2' })).toBeVisible()
    await ok(request, code, hostKey, { type: 'RECORD_RESULT', matchId: host.courts[0].match.id, winner: 'A', scoreA: 11, scoreB: 4 })
    await expect(page.getByRole('status').filter({ hasText: "You're up on Court 1: walk on" })).toBeVisible()
  })

  test('the TV board names the game on each court, then shows the champions', async ({ page, request }) => {
    const { code, hostKey } = await readyTournament(request)
    await page.setViewportSize({ width: 1920, height: 1080 })
    await page.goto(`/pickleball/s/${code}/tv`)
    await expect(page.getByTestId('tv-court').first()).toContainText('Semi-final 1')
    await expect(page.getByTestId('fairness')).toHaveCount(0)
    await playToChampion(request, code, hostKey)
    await expect(page.getByTestId('podium-1')).toContainText('Ana & Ben')
  })

  for (const width of [390, 768, 1280, 1920]) {
    test(`the board's draw and the TV fit a ${width}px screen without sideways scrolling`, async ({ page, request }) => {
      const { code } = await readyTournament(request, { players: 16, courtCount: 4, format: 'POOL_TO_BRACKET' })
      await page.setViewportSize({ width, height: 900 })
      await page.goto(`/pickleball/s/${code}`)
      if (width < 1024) await page.getByRole('tab', { name: 'Draw' }).click()
      await expect(page.getByRole('region', { name: 'Pool A' })).toBeVisible()
      expect(await noSideScroll(page)).toBe(true)
      await page.goto(`/pickleball/s/${code}/tv`)
      await expect(page.getByTestId('tv-court')).toHaveCount(4)
      expect(await noSideScroll(page)).toBe(true)
    })
  }

  // The same standard as the open-play TV (open-play.spec.js): legible across a hall, nothing truncated or spilling.
  const LONG_NAMES = NAMES.map((name, i) => (i % 3 === 0 ? `${name} Montgomery-Alexandrovich` : name))
  // A visually hidden live region (sr-only, the champions announcement) is clipped by design, not truncated text.
  const spilling = (page) => page.evaluate(() => [...document.querySelectorAll('body *')]
    .filter((el) => (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0 && el.dataset.marquee !== 'scrolling' && !el.classList.contains('sr-only')) || (el.dataset.testid === 'tv-court' && el.scrollHeight > el.clientHeight + 1))
    .map((el) => `${el.tagName}.${String(el.className).slice(0, 40)}`))
  for (const [format, players, courtCount] of [['POOL_TO_BRACKET', 16, 4], ['SINGLE_ELIMINATION', 16, 2]]) {
    for (const [width, height] of [[1920, 1080], [1280, 720]]) {
      test(`a running ${format} TV with long names fits ${width}×${height}, nothing truncated, type readable across a hall`, async ({ page, request }) => {
        const { code } = await readyTournament(request, { players, courtCount, format, names: LONG_NAMES })
        await page.setViewportSize({ width, height })
        await page.goto(`/pickleball/s/${code}/tv`)
        await expect(page.getByTestId('tv-court')).toHaveCount(courtCount)
        await expect(page.getByRole('region', { name: 'Coming up' })).toBeVisible()
        await page.evaluate(() => document.fonts.ready)
        await expect.poll(() => spilling(page)).toEqual([])
        expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight && document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
        // Names at least 24 px tall at 1080p and 18 px at 720p, as for open play.
        const sizes = await page.getByTestId('tv-court').evaluateAll((cards) => cards.map((el) => parseFloat(getComputedStyle(el).fontSize)))
        for (const size of sizes) expect(size).toBeGreaterThanOrEqual(height === 1080 ? 24 : 18)
        const comingUp = await page.getByRole('region', { name: 'Coming up' }).locator('li').evaluateAll((rows) => rows.map((el) => parseFloat(getComputedStyle(el).fontSize)))
        expect(comingUp.length).toBeGreaterThan(0)
        for (const size of comingUp) expect(size).toBeGreaterThanOrEqual(height === 1080 ? 24 : 18)
      })
    }
  }

  for (const [width, height] of [[1920, 1080], [1280, 720]]) {
    test(`the TV's champions fit ${width}×${height} with nothing truncated`, async ({ page, request }) => {
      const { code, hostKey } = await readyTournament(request, { names: LONG_NAMES })
      await playToChampion(request, code, hostKey)
      await page.setViewportSize({ width, height })
      await page.goto(`/pickleball/s/${code}/tv`)
      await expect(page.getByTestId('podium-1')).toBeVisible()
      await expect(page.getByRole('region', { name: 'Coming up' })).toHaveCount(0)
      await page.evaluate(() => document.fonts.ready)
      // The celebration scales the banner for a moment; measure once it has settled.
      await expect.poll(() => spilling(page), { timeout: 5000 }).toEqual([])
      expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight)).toBe(true)
    })
  }

  test('an ended tournament shows its final results on the TV, champions on top', async ({ page, request }) => {
    const { code, hostKey } = await readyTournament(request)
    await playToChampion(request, code, hostKey)
    await ok(request, code, hostKey, { type: 'END_SESSION' })
    await page.setViewportSize({ width: 1920, height: 1080 })
    await page.goto(`/pickleball/s/${code}/tv`)
    await expect(page.getByTestId('podium-1')).toContainText('Ana & Ben')
    await expect(page.getByTestId('final-results')).toHaveCount(1)
    await expect(page.getByTestId('tv-court')).toHaveCount(0)
    await expect.poll(() => spilling(page), { timeout: 5000 }).toEqual([])
  })

  test('before the start the TV says the draw is coming instead of showing empty courts', async ({ page, request }) => {
    const { code } = await readyTournament(request, { start: false })
    await page.setViewportSize({ width: 1280, height: 720 })
    await page.goto(`/pickleball/s/${code}/tv`)
    await expect(page.getByTestId('tv-draw-note')).toContainText('may still change')
    await expect(page.getByTestId('tv-court')).toHaveCount(0)
    await expect(page.getByRole('region', { name: 'Coming up' })).toHaveCount(0)
  })
})

test.describe('tournament final results (screens)', () => {
  test('a round robin played to the end: the board opens on the podium of pairs, in standings order, and shares it', async ({ page, request, baseURL }) => {
    const { code, hostKey } = await readyTournament(request, { format: 'ROUND_ROBIN' })
    await playToChampion(request, code, hostKey)
    const board = await (await request.get(`/api/pickleball/open/s/${code}/state`)).json()
    const table = board.tournament.standings
    await page.addInitScript(() => {
      window.__shared = []
      navigator.share = (data) => { window.__shared.push(data); return Promise.resolve() }
    })
    await page.goto(`/pickleball/s/${code}`)
    await expect(page.getByTestId('final-results')).toBeVisible()
    for (const [place, row] of [[1, table[0]], [2, table[1]], [3, table[2]]]) {
      await expect(page.getByTestId(`podium-${place}`)).toContainText(row.name)
      expect(row.name).toMatch(/ & /)
    }
    await expect(page.getByTestId('final-results').getByRole('table')).toContainText(table[3].name)
    await expect(page.getByRole('region', { name: 'Courts' })).toHaveCount(0)
    // The draw stays on the board under the results.
    await expect(page.getByRole('region', { name: 'Draw' })).toBeVisible()
    // Each player hears how their pair finished.
    const champion = table[0].name.split(' & ')[0]
    await page.getByLabel("I'm…").selectOption({ label: champion })
    await expect(page.getByRole('status').filter({ hasText: `Hi ${champion}! Your pair won the tournament! 🏆` })).toBeVisible()
    const fourth = table[3].name.split(' & ')[1]
    await page.getByLabel("I'm…").selectOption({ label: fourth })
    await expect(page.getByRole('status').filter({ hasText: `Hi ${fourth}! Your pair finished 4th` })).toBeVisible()
    await page.getByRole('button', { name: 'Share results' }).click()
    const wl = (row) => `${row.wins}–${row.losses}`
    await expect.poll(() => page.evaluate(() => window.__shared.length)).toBe(1)
    expect(await page.evaluate(() => window.__shared[0])).toEqual({
      title: 'Final standings · Saturday Cup',
      text: [
        '🏆 Saturday Cup — final standings',
        `🥇 ${table[0].name} (${wl(table[0])})  🥈 ${table[1].name} (${wl(table[1])})  🥉 ${table[2].name} (${wl(table[2])})`,
        `Full results: ${baseURL}/pickleball/s/${code}`,
      ].join('\n'),
      url: `${baseURL}/pickleball/s/${code}`,
    })
  })

  test('a knockout: the two losing semi-finalists share 3rd on the host console, which keeps the CSV download', async ({ page, request }) => {
    const { code, hostKey } = await readyTournament(request)
    await playToChampion(request, code, hostKey)
    await page.goto(`/pickleball/s/${code}#host=${hostKey}`)
    await expect(page.getByTestId('podium-1')).toContainText('Ana & Ben')
    await expect(page.getByTestId('podium-3').getByRole('listitem')).toHaveCount(2)
    const download = page.waitForEvent('download')
    await page.getByTestId('final-results').getByRole('button', { name: 'Download results (CSV)' }).click()
    expect((await download).suggestedFilename()).toMatch(/\.csv$/)
    // The poster of pairs renders at its full size.
    await page.getByTestId('final-results').getByRole('button', { name: 'Save poster' }).click()
    const preview = page.getByRole('dialog', { name: 'Results poster' }).getByTestId('poster-preview')
    await expect(preview).toBeVisible()
    expect(await preview.evaluate(async (img) => {
      const decoded = new Image()
      decoded.src = img.src
      await decoded.decode()
      return [decoded.naturalWidth, decoded.naturalHeight]
    })).toEqual([1080, 1350])
    const poster = page.waitForEvent('download')
    await page.getByRole('dialog', { name: 'Results poster' }).getByRole('link', { name: 'Download' }).click()
    expect((await poster).suggestedFilename()).toBe('saturday-cup-results.png')
  })
})

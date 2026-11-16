// The queue as players, the TV, the host and captains see it (PB-QUEUE-01..07):
// one vocabulary, a status card for every player state, an unnumbered waiting
// list, and "Next four" only when the server has fixed them. Synthetic names.
import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const NAMES = ['Ana', 'Ben', 'Carlo', 'Dina', 'Eli', 'Fay', 'Gio', 'Hana', 'Ivan', 'Jun', 'Kai', 'Lia', 'Mo', 'Nia']
const freshIp = () => `10.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 254) + 1}`

async function createSession(request, players = 14, courtCount = 2) {
  const response = await request.post('/api/pickleball/open/sessions', {
    headers: { 'cf-connecting-ip': freshIp() },
    data: {
      name: 'Queue Night', hostDisplayName: 'Coach Sam', courtCount,
      settings: { mode: 'PADDLE_STACK', target: 11, scoringStyle: 'SIDEOUT' },
      players: NAMES.slice(0, players).map((name) => ({ name })),
    },
  })
  expect(response.status()).toBe(201)
  return response.json()
}

async function command(request, code, hostKey, cmd) {
  const response = await request.post(`/api/pickleball/open/s/${code}/commands`, {
    headers: { 'X-Host-Key': hostKey, 'cf-connecting-ip': freshIp() },
    data: { idempotencyKey: crypto.randomUUID(), command: cmd },
  })
  expect(response.status(), await response.text()).toBe(200)
  return response.json()
}

async function hostSnapshot(request, code, hostKey) {
  return (await request.get(`/api/pickleball/open/s/${code}/host`, { headers: { 'X-Host-Key': hostKey, 'cf-connecting-ip': freshIp() } })).json()
}

const pickName = async (page, name) => page.getByLabel('Who are you?').selectOption({ label: name })
const card = (page) => page.getByTestId('status-card')

test.describe('player board status card (PB-QUEUE-02)', () => {
  test('asks who you are first, then states playing, up next, waiting and on break in one line', async ({ page, request }) => {
    const { code, hostKey } = await createSession(request)
    let host = await hostSnapshot(request, code, hostKey)
    await command(request, code, hostKey, { type: 'START_MATCH', matchId: host.courts[0].match.id })
    host = await hostSnapshot(request, code, hostKey)
    const name = (id) => host.players.find((p) => p.id === id).name
    const playing = name(host.courts[0].match.teamA[0])
    const upNext = name(host.courts[1].match.teamB[1])
    const waiting = host.viewer.waiting[0].name

    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`/pickleball/s/${code}`)
    // No name yet: a prominent prompt where the card goes, and no status.
    await expect(card(page)).toHaveAttribute('data-kind', 'PICK')
    await expect(card(page).getByLabel('Who are you?')).toBeVisible()

    await pickName(page, playing)
    await expect(card(page)).toHaveAttribute('data-kind', 'PLAYING')
    const status = card(page).getByRole('status')
    await expect(status).toHaveText(`Hi ${playing}. Playing · Court 1`)
    await expect(status).toHaveAttribute('aria-live', 'polite')
    // The card is the first thing after the header on a phone.
    const cardBox = await card(page).boundingBox()
    const courtsBox = await page.getByRole('region', { name: 'Courts' }).boundingBox()
    expect(cardBox.y).toBeLessThan(courtsBox.y)

    await card(page).getByText(`Not ${playing}?`).click()
    await card(page).getByLabel('Pick your name').selectOption({ label: upNext })
    await expect(status).toHaveText(`Hi ${upNext}. Up next · Court 2 · walk on now`)

    await card(page).getByText(`Not ${upNext}?`).click()
    await card(page).getByLabel('Pick your name').selectOption({ label: waiting })
    await expect(status).toHaveText(`Hi ${waiting}. Waiting · order can change`)
    await expect(page.getByTestId('waiting-list')).toContainText('Fewest games go first. The next four are picked when a court opens.')
    // Never a place in line.
    await expect(page.getByText(/#\d|in line/)).toHaveCount(0)

    // The live region follows the server: the host puts this player on a break.
    await command(request, code, hostKey, { type: 'SET_PLAYER_STATUS', playerId: host.viewer.waiting[0].id, status: 'BREAK' })
    await expect(status).toHaveText(`Hi ${waiting}. On break`)
  })

  test('names the next four only once every court is playing and the server has fixed them', async ({ page, request }) => {
    const { code, hostKey } = await createSession(request)
    let host = await hostSnapshot(request, code, hostKey)
    for (const c of host.courts) await command(request, code, hostKey, { type: 'START_MATCH', matchId: c.match.id })
    host = await hostSnapshot(request, code, hostKey)
    expect(host.viewer.nextUp?.players).toHaveLength(4)
    const four = host.viewer.nextUp.players.map((p) => p.name)
    const notInFour = host.viewer.waiting.find((w) => !four.includes(w.name)).name

    await page.goto(`/pickleball/s/${code}`)
    await pickName(page, four[0])
    await expect(card(page).getByRole('status')).toHaveText(`Hi ${four[0]}. Next four · when a court opens`)
    const panel = page.getByTestId('next-four')
    await expect(panel).toBeVisible()
    for (const n of four) await expect(panel).toContainText(n)

    // Board order (PB-QUEUE-03): status card, courts, next four, then waiting.
    const y = async (locator) => (await locator.boundingBox()).y
    expect(await y(card(page))).toBeLessThan(await y(page.getByTestId('next-four')))
    expect(await y(page.getByTestId('next-four'))).toBeLessThan(await y(page.getByTestId('waiting-list')))
    await expect(page.getByTestId('waiting-list').getByRole('heading')).toHaveText('Waiting (6)')
    await expect(page.getByTestId('waiting-list').getByRole('listitem').first()).not.toContainText(/^\d/)

    await card(page).getByText(`Not ${four[0]}?`).click()
    await card(page).getByLabel('Pick your name').selectOption({ label: notInFour })
    await expect(card(page).getByRole('status')).toHaveText(`Hi ${notInFour}. Waiting · order can change`)
  })

  test('says the next four are decided when a game ends, when the server has not fixed them', async ({ page, request }) => {
    const { code, hostKey } = await createSession(request, 11, 2)
    const host = await hostSnapshot(request, code, hostKey)
    for (const c of host.courts) await command(request, code, hostKey, { type: 'START_MATCH', matchId: c.match.id })
    await page.goto(`/pickleball/s/${code}`)
    await expect(page.getByTestId('waiting-list')).toContainText('The next four are decided when a game ends.')
    await expect(page.getByTestId('next-four')).toHaveCount(0)
  })

  test('the board has no serious accessibility issues', async ({ page, request }) => {
    const { code } = await createSession(request)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`/pickleball/s/${code}`)
    await expect(card(page)).toBeVisible()
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
    const blocking = results.violations.filter((v) => ['serious', 'critical'].includes(v.impact))
    expect(blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
  })
})

test.describe('TV queue panel (PB-QUEUE-04)', () => {
  test('is called Waiting, is unnumbered, shows the next four, and has a compact version on narrow screens', async ({ page, request }) => {
    const { code, hostKey } = await createSession(request)
    const host = await hostSnapshot(request, code, hostKey)
    for (const c of host.courts) await command(request, code, hostKey, { type: 'START_MATCH', matchId: c.match.id })
    await page.setViewportSize({ width: 1920, height: 1080 })
    await page.goto(`/pickleball/s/${code}/tv`)
    const waiting = page.getByTestId('tv-waiting')
    await expect(waiting.getByRole('heading')).toHaveText('Waiting (6)')
    await expect(waiting.getByRole('listitem').first()).not.toContainText(/^\d/)
    await expect(page.getByRole('region', { name: 'Up next' })).toHaveCount(0)
    await expect(page.getByTestId('tv-next-four').getByRole('listitem')).toHaveCount(4)
    await expect(page.getByTestId('tv-court').first()).toContainText(/playing/i)
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
    expect(results.violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => v.id)).toEqual([])

    await page.setViewportSize({ width: 390, height: 844 })
    const compact = page.getByTestId('tv-compact-queue')
    await expect(compact).toBeVisible()
    await expect(compact).toContainText('Waiting (6)')
    await expect(compact).toContainText('Next four')
  })

  test('a confirmed call stays on its court tile as "Up next"', async ({ page, request }) => {
    const { code } = await createSession(request)
    await page.setViewportSize({ width: 1920, height: 1080 })
    await page.goto(`/pickleball/s/${code}/tv`)
    await expect(page.getByTestId('tv-court').first()).toContainText(/Up next · walk on now/i)
    await expect(page.getByTestId('tv-next-four')).toHaveCount(0)
  })
})

test.describe('host and captain queue (PB-QUEUE-05, PB-UX)', () => {
  test('the host sees calls, empty courts with the reason, the next four, waiting with games, and breaks', async ({ page, request }) => {
    const { code, hostKey } = await createSession(request, 14, 3)
    let host = await hostSnapshot(request, code, hostKey)
    await command(request, code, hostKey, { type: 'START_MATCH', matchId: host.courts[0].match.id })
    host = await hostSnapshot(request, code, hostKey)
    await command(request, code, hostKey, { type: 'SET_PLAYER_STATUS', playerId: host.viewer.waiting[0].id, status: 'BREAK' })
    await page.goto(`/pickleball/s/${code}#host=${hostKey}`)
    const queue = page.getByTestId('host-queue')
    await expect(queue).toContainText('Up next')
    await expect(queue).toContainText('Court 2:')
    await expect(queue).toContainText(/Waiting \(\d+\)/)
    await expect(queue).toContainText('0 games · sat out 0')
    await expect(queue).toContainText('On break (1)')
    // No queue numbers anywhere on the host screen.
    await expect(page.getByRole('region', { name: 'Courts' }).getByText(/^\d+ · /)).toHaveCount(0)
    await expect(page.getByRole('list').getByText(/^\d+ · /)).toHaveCount(0)
  })

  test('a captain sees the call on their court and how many are waiting', async ({ page, request }) => {
    const { code, hostKey } = await createSession(request)
    const host = await hostSnapshot(request, code, hostKey)
    const made = await request.post(`/api/pickleball/open/s/${code}/captains`, { headers: { 'X-Host-Key': hostKey, 'cf-connecting-ip': freshIp() }, data: { courtId: host.courts[0].id } })
    expect(made.status()).toBe(201)
    const { captainKey } = await made.json()
    await page.goto(`/pickleball/s/${code}#cap=${captainKey}`)
    const queue = page.getByTestId('captain-queue')
    await expect(queue).toContainText('Up next on Court 1')
    await expect(queue).toContainText('Waiting: 6 players.')
  })
})

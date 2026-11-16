// PB-REALTIME-01/02: "LIVE" means recent server contact, a dead socket that
// still says "open" is noticed, and stale data never tells a player to walk on.
// Timings measured here are logged (test output) and recorded in
// docs/pickleball/realtime.md; they are measurements on the local stack, not
// guarantees. Synthetic names only.
import { test, expect } from '@playwright/test'
import { REALTIME } from '../../../src/pickleball-open/lib/realtimeConfig.js'

const NAMES = ['Ana', 'Ben', 'Carlo', 'Dina', 'Eli', 'Fay', 'Gio', 'Hana', 'Ivan', 'Jun']
const freshIp = () => `10.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 254) + 1}`

async function createSession(request) {
  const response = await request.post('/api/pickleball/open/sessions', {
    headers: { 'cf-connecting-ip': freshIp() },
    data: { name: 'Realtime Night', hostDisplayName: 'Coach Sam', courtCount: 2, settings: { mode: 'PADDLE_STACK', target: 11, scoringStyle: 'SIDEOUT' }, players: NAMES.map((name) => ({ name })) },
  })
  expect(response.status()).toBe(201)
  return response.json()
}

/** Proxies the board's socket so a test can cut it silently (frames dropped, socket left "open"). */
async function cuttableSocket(page) {
  const link = { alive: true, sent: [] }
  await page.routeWebSocket(/\/pickleball\/rt\/open\//, (ws) => {
    const server = ws.connectToServer()
    ws.onMessage((message) => {
      link.sent.push(message)
      if (link.alive) server.send(message)
    })
    server.onMessage((message) => {
      if (link.alive) ws.send(message)
    })
  })
  return link
}

test.describe('realtime freshness (PB-REALTIME-01)', () => {
  test('the runtime answers a heartbeat ping with pong', async ({ page, request }) => {
    const { code } = await createSession(request)
    await page.goto(`/pickleball/s/${code}`)
    const roundTrip = await page.evaluate((c) => new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://${location.host}/pickleball/rt/open/${c}`)
      let sentAt = 0
      ws.onmessage = (event) => {
        if (event.data === 'pong') {
          resolve(performance.now() - sentAt)
          ws.close()
        } else if (!sentAt) {
          sentAt = performance.now()
          ws.send('ping')
        }
      }
      setTimeout(() => reject(new Error('no pong')), 5000)
    }), code)
    console.log(`heartbeat round trip (local): ${Math.round(roundTrip)} ms`)
    expect(roundTrip).toBeLessThan(2000)
  })

  test('a quiet session stays LIVE past the stale window: the heartbeat keeps contact', async ({ page, request }) => {
    test.setTimeout(120_000)
    const { code } = await createSession(request)
    const link = await cuttableSocket(page)
    await page.goto(`/pickleball/s/${code}`)
    await expect(page.getByText('LIVE', { exact: true })).toBeVisible()
    // Longer than staleMs with no state change at all.
    await page.waitForTimeout(REALTIME.staleMs + 5000)
    await expect(page.getByText('LIVE', { exact: true })).toBeVisible()
    expect(link.sent.filter((m) => m === 'ping').length).toBeGreaterThanOrEqual(2)
  })

  test('a socket that dies while "open" is noticed; stale data says "Last known" and never "walk on now"; it recovers', async ({ page, request }) => {
    test.setTimeout(150_000)
    const { code } = await createSession(request)
    const link = await cuttableSocket(page)
    await page.goto(`/pickleball/s/${code}`)
    await page.getByLabel('Who are you?').selectOption({ label: 'Eli' })
    const state = await (await request.get(`/api/pickleball/open/s/${code}/state`)).json()
    const eliCourt = state.courts.find((c) => [...c.teamA, ...c.teamB].includes('Eli')).label
    const status = page.getByTestId('status-card').getByRole('status')
    await expect(status).toHaveText(`Hi Eli. Up next · ${eliCourt} · walk on now`)

    // The network goes: socket frames dropped (it still says open) and polls fail.
    await page.route(`**/api/pickleball/open/s/${code}/state`, (route) => route.abort('internetdisconnected'))
    const cutAt = Date.now()
    link.alive = false
    await expect(page.getByText(/Offline · showing data from/)).toBeVisible({ timeout: REALTIME.staleMs + 20_000 })
    const staleAfter = Date.now() - cutAt
    await expect(status).toHaveText(new RegExp(`^Hi Eli\\. Last known \\(.+\\): Up next · ${eliCourt}$`))
    // No imperative anywhere on the stale board.
    await expect(page.getByText(/walk on now/i)).toHaveCount(0)

    // Back: frames flow and polls succeed again.
    const backAt = Date.now()
    link.alive = true
    await page.unroute(`**/api/pickleball/open/s/${code}/state`)
    await expect(page.getByText('LIVE', { exact: true })).toBeVisible({ timeout: 30_000 })
    const liveAfter = Date.now() - backAt
    await expect(status).toHaveText(`Hi Eli. Up next · ${eliCourt} · walk on now`)
    console.log(`dead socket: stale shown after ${staleAfter} ms (staleMs ${REALTIME.staleMs}); live again after ${liveAfter} ms`)
    expect(staleAfter).toBeLessThan(REALTIME.staleMs + 20_000)
  })

  test('coming back to the page polls at once and asks an open socket to RESYNC', async ({ page, request }) => {
    const { code } = await createSession(request)
    const link = await cuttableSocket(page)
    await page.goto(`/pickleball/s/${code}`)
    await expect(page.getByText('LIVE', { exact: true })).toBeVisible()
    const polled = page.waitForRequest((r) => r.url().endsWith(`/api/pickleball/open/s/${code}/state`), { timeout: 3000 })
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
    await polled
    await expect.poll(() => link.sent.some((m) => typeof m === 'string' && m.includes('"RESYNC"'))).toBe(true)
    await page.evaluate(() => window.dispatchEvent(new Event('online')))
    await expect.poll(() => link.sent.filter((m) => typeof m === 'string' && m.includes('"RESYNC"')).length).toBe(2)
  })
})

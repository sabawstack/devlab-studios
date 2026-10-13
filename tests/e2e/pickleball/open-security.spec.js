// Abuse limits on the open-play routes (security audit 2026-10-13, M1/M2),
// end to end against the real Worker and Durable Object: oversized command and
// check-in bodies are refused with 413 before they reach the session, and a
// WebSocket that sends an oversized message or floods RESYNC is closed.
import { test, expect } from '@playwright/test'

// Creation is limited per IP per day and the host routes per minute, and every
// local request shares one address, so each test claims its own (see open-play.spec.js).
const freshIp = () => `10.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 254) + 1}`

async function createSession(request) {
  const response = await request.post('/api/pickleball/open/sessions', {
    headers: { 'cf-connecting-ip': freshIp() },
    data: {
      name: 'Security Night', hostDisplayName: 'Coach Mo', courtCount: 1,
      settings: { mode: 'PADDLE_STACK', target: 11, scoringStyle: 'SIDEOUT' },
      players: [{ name: 'Ana' }, { name: 'Ben' }, { name: 'Cy' }, { name: 'Di' }],
    },
  })
  expect(response.status(), await response.text()).toBe(201)
  return response.json()
}

test.describe('open-play request body caps', () => {
  test('an oversized command body is refused with 413 and changes nothing', async ({ request }) => {
    const { code, hostKey } = await createSession(request)
    const ip = freshIp()
    const response = await request.post(`/api/pickleball/open/s/${code}/commands`, {
      headers: { 'X-Host-Key': hostKey, 'cf-connecting-ip': ip, 'Content-Type': 'application/json' },
      data: JSON.stringify({ idempotencyKey: crypto.randomUUID(), command: { type: 'END_SESSION' }, pad: 'x'.repeat(64 * 1024) }),
    })
    expect(response.status()).toBe(413)
    expect(await response.json()).toEqual({ error: 'That request is too large.' })
    const host = await request.get(`/api/pickleball/open/s/${code}/host`, { headers: { 'X-Host-Key': hostKey, 'cf-connecting-ip': ip } })
    expect((await host.json()).viewer.status).not.toBe('ENDED')
  })

  test('a largest-legitimate ADD_PLAYERS still goes through', async ({ request }) => {
    const { code, hostKey } = await createSession(request)
    const names = Array.from({ length: 120 }, (_, i) => `Player number ${i} with a long pasted name`)
    const response = await request.post(`/api/pickleball/open/s/${code}/commands`, {
      headers: { 'X-Host-Key': hostKey, 'cf-connecting-ip': freshIp() },
      data: { idempotencyKey: crypto.randomUUID(), command: { type: 'ADD_PLAYERS', names } },
    })
    expect(response.status(), await response.text()).toBe(200)
  })

  test('an oversized check-in body is refused with 413 and adds nobody', async ({ request }) => {
    const { code } = await createSession(request)
    const response = await request.post(`/api/pickleball/open/s/${code}/check-in`, {
      headers: { 'cf-connecting-ip': freshIp(), 'Content-Type': 'application/json' },
      data: JSON.stringify({ name: 'Mallory', pad: 'x'.repeat(16 * 1024) }),
    })
    expect(response.status()).toBe(413)
    const state = await (await request.get(`/api/pickleball/open/s/${code}/state`, { headers: { 'cf-connecting-ip': freshIp() } })).json()
    expect(JSON.stringify(state)).not.toContain('Mallory')
  })

  test('a repeat check-in for a name already playing is a 200 no-op', async ({ request }) => {
    const { code } = await createSession(request)
    const checkIn = () => request.post(`/api/pickleball/open/s/${code}/check-in`, { headers: { 'cf-connecting-ip': freshIp() }, data: { name: 'Ana' } })
    const first = await checkIn()
    expect(first.status()).toBe(200)
    expect(await first.json()).toMatchObject({ alreadyCheckedIn: true })
  })
})

test.describe('open-play WebSocket limits', () => {
  /** Opens a socket from the page, sends `messages`, and reports how it closed (or null if it stayed open). */
  async function socketOutcome(page, code, messages, { waitMs = 3000 } = {}) {
    return page.evaluate(async ({ code, messages, waitMs }) => {
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
      const ws = new WebSocket(`${protocol}://${window.location.host}/pickleball/rt/open/${code}`)
      const received = []
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          ws.close()
          resolve({ closed: null, received })
        }, waitMs)
        ws.onmessage = (event) => received.push(JSON.parse(event.data).type)
        ws.onopen = () => {
          for (const message of messages) ws.send(message)
        }
        ws.onclose = (event) => {
          clearTimeout(timer)
          resolve({ closed: event.code, received })
        }
      })
    }, { code, messages, waitMs })
  }

  test('an oversized message closes the socket with 1009', async ({ page, request }) => {
    const { code } = await createSession(request)
    await page.goto('/pickleball')
    const outcome = await socketOutcome(page, code, [JSON.stringify({ type: 'RESYNC', pad: 'x'.repeat(8 * 1024) })])
    expect(outcome.closed).toBe(1009)
  })

  test('a RESYNC flood closes the socket with 1008 after the allowance', async ({ page, request }) => {
    const { code } = await createSession(request)
    await page.goto('/pickleball')
    const outcome = await socketOutcome(page, code, Array(50).fill(JSON.stringify({ type: 'RESYNC' })))
    expect(outcome.closed).toBe(1008)
    // The first VIEWER is the snapshot on connect; then at most 10 RESYNC answers.
    expect(outcome.received.length).toBeLessThanOrEqual(11)
  })

  test('a normal socket (one RESYNC) stays open', async ({ page, request }) => {
    const { code } = await createSession(request)
    await page.goto('/pickleball')
    const outcome = await socketOutcome(page, code, [JSON.stringify({ type: 'RESYNC' })], { waitMs: 1500 })
    expect(outcome.closed).toBeNull()
    expect(outcome.received).toEqual(['VIEWER', 'VIEWER'])
  })
})

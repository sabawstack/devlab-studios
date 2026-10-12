// Google-verified hosts and the DUPR export (spec §9), end to end against the
// real Worker, Durable Object and local D1. Google itself is replaced by the
// env-gated test login (spec §13): POST /api/pickleball/open/host/test-login
// answers only when PICKLEBALL_TEST_AUTH_ENABLED=true (.dev.vars), and with
// that flag on the export is never emailed: the response carries the outbox.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect } from '@playwright/test'

const TEMPLATE = readFileSync(join(process.cwd(), 'tests/fixtures/dupr-import-template.csv'), 'utf8').split(/\r?\n/)[0]
const ROSTER = [
  { name: 'Ana', duprId: 'AAA111' }, { name: 'Ben', duprId: 'BBB222' }, { name: 'Cy', duprId: 'CCC333' },
  { name: 'Di', duprId: 'DDD444' }, { name: 'Eve' },
]

// Creation is limited per IP per day and the host routes per minute, and every
// local request shares one address, so each test claims its own (see open-play.spec.js).
const freshIp = () => `10.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 254) + 1}`
const testIp = new Map()
const ipFor = (key) => testIp.get(key) ?? testIp.set(key, freshIp()).get(key)
const uniqueEmail = (who) => `${who}-${crypto.randomUUID().slice(0, 8)}@example.com`

async function createSession(request, name = 'Saturday Social') {
  const response = await request.post('/api/pickleball/open/sessions', {
    headers: { 'cf-connecting-ip': freshIp() },
    data: { name, hostDisplayName: 'Coach Mo', courtCount: 1, settings: { mode: 'PADDLE_STACK', target: 11, scoringStyle: 'SIDEOUT' }, players: ROSTER },
  })
  expect(response.status()).toBe(201)
  return response.json()
}

/** Every write to a host route says where it came from, as a browser would. */
const writeHeaders = (baseURL, code, extra = {}) => ({ Origin: baseURL, 'cf-connecting-ip': ipFor(code), ...extra })

async function signIn(request, baseURL, email, key = email) {
  const response = await request.post('/api/pickleball/open/host/test-login', {
    headers: writeHeaders(baseURL, key), data: { email, name: 'Coach Mo' },
  })
  expect(response.status(), await response.text()).toBe(200)
  return (await response.json()).host
}

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

/** Plays one game on Court 1 with exactly these teams and score. */
async function play(request, code, hostKey, teamA, teamB, scoreA, scoreB) {
  let host = (await (await request.get(`/api/pickleball/open/s/${code}/host`, { headers: { 'X-Host-Key': hostKey, 'cf-connecting-ip': ipFor(code) } })).json())
  const id = (name) => host.players.find((p) => p.name === name).id
  const match = host.courts[0].match
  host = await ok(request, code, hostKey, { type: 'EDIT_PROPOSAL', matchId: match.id, teamA: teamA.map(id), teamB: teamB.map(id) })
  await ok(request, code, hostKey, { type: 'START_MATCH', matchId: match.id })
  return ok(request, code, hostKey, { type: 'RECORD_RESULT', matchId: match.id, winner: scoreA > scoreB ? 'A' : 'B', scoreA, scoreB })
}

const dupr = (request, code, hostKey, tz = 'UTC') =>
  request.get(`/api/pickleball/open/s/${code}/dupr?tz=${encodeURIComponent(tz)}`, { headers: { 'X-Host-Key': hostKey, 'cf-connecting-ip': ipFor(code) } })
const claim = (request, baseURL, code, hostKey, headers = {}) =>
  request.post(`/api/pickleball/open/s/${code}/claim`, { headers: writeHeaders(baseURL, code, { 'X-Host-Key': hostKey, ...headers }) })
const exportDupr = (request, baseURL, code, hostKey, timeZone = 'UTC') =>
  request.post(`/api/pickleball/open/s/${code}/dupr-export`, { headers: writeHeaders(baseURL, code, { 'X-Host-Key': hostKey }), data: { timeZone } })
const setClubId = (request, baseURL, key, duprClubId = '12345') =>
  request.patch('/api/pickleball/open/host/me', { headers: writeHeaders(baseURL, key), data: { duprClubId } })

/** A session linked to a freshly signed-in host with a Club ID and one exportable game. */
async function readyToExport(request, baseURL) {
  const session = await createSession(request)
  const email = uniqueEmail('mo')
  await signIn(request, baseURL, email, session.code)
  expect((await setClubId(request, baseURL, session.code)).status()).toBe(200)
  expect((await claim(request, baseURL, session.code, session.hostKey)).status()).toBe(200)
  await play(request, session.code, session.hostKey, ['Ana', 'Ben'], ['Cy', 'Di'], 11, 7)
  return { ...session, email }
}

test.describe('linking a session, and My sessions (API)', () => {
  test('a session is linked once: another account, a wrong host key and no sign-in are all refused', async ({ request, playwright, baseURL }) => {
    const { code, hostKey } = await readyToExport(request, baseURL)
    const other = await playwright.request.newContext({ baseURL })
    await signIn(other, baseURL, uniqueEmail('bo'), `${code}-bo`)
    expect((await setClubId(other, baseURL, `${code}-bo`)).status()).toBe(200)
    const taken = await claim(other, baseURL, code, hostKey)
    expect(taken.status()).toBe(409)
    expect((await taken.json()).error).toBe('This session is already linked to another Google account.')
    expect((await (await dupr(other, code, hostKey)).json()).claim).toBe('OTHER')

    expect((await claim(request, baseURL, code, 'not-the-host-key-at-all')).status()).toBe(403)
    const stranger = await playwright.request.newContext({ baseURL })
    expect((await claim(stranger, baseURL, code, hostKey)).status()).toBe(401)
    expect((await (await dupr(stranger, code, hostKey)).json())).toMatchObject({ host: null, claim: 'OTHER' })
    expect((await dupr(stranger, code, 'wrong-key-wrong-key')).status()).toBe(403)
    await other.dispose()
    await stranger.dispose()
  })

  test('My sessions lists linked sessions only, and reopens one with a new host link that leaves the old one working', async ({ request, playwright, baseURL }) => {
    const { code, hostKey } = await readyToExport(request, baseURL)
    const unlinked = await createSession(request, 'Not linked')
    const list = await (await request.get('/api/pickleball/open/host/sessions', { headers: { 'cf-connecting-ip': ipFor(code) } })).json()
    expect(list.sessions.map((s) => s.code)).toEqual([code])
    expect(list.sessions.map((s) => s.code)).not.toContain(unlinked.code)
    expect(list.sessions[0]).toMatchObject({ name: 'Saturday Social', kind: 'OPEN_PLAY', status: 'ACTIVE' })

    const reopened = await request.post(`/api/pickleball/open/host/sessions/${code}/reopen`, { headers: writeHeaders(baseURL, code) })
    expect(reopened.status()).toBe(201)
    const { hostKey: freshKey } = await reopened.json()
    expect(freshKey).not.toBe(hostKey)
    for (const key of [freshKey, hostKey]) {
      expect((await request.get(`/api/pickleball/open/s/${code}/host`, { headers: { 'X-Host-Key': key, 'cf-connecting-ip': ipFor(code) } })).status()).toBe(200)
    }
    expect((await command(request, code, freshKey, { type: 'SET_SELF_CHECK_IN', enabled: false })).status()).toBe(200)

    const other = await playwright.request.newContext({ baseURL })
    await signIn(other, baseURL, uniqueEmail('bo'), `${code}-bo`)
    expect((await other.post(`/api/pickleball/open/host/sessions/${code}/reopen`, { headers: writeHeaders(baseURL, `${code}-bo`) })).status()).toBe(403)
    expect((await (await other.get('/api/pickleball/open/host/sessions', { headers: { 'cf-connecting-ip': ipFor(`${code}-bo`) } })).json()).sessions).toEqual([])
    const stranger = await playwright.request.newContext({ baseURL })
    expect((await stranger.get('/api/pickleball/open/host/sessions')).status()).toBe(401)
    await other.dispose()
    await stranger.dispose()
  })

  test('a session has at most 10 extra host links', async ({ request, baseURL }) => {
    const { code } = await readyToExport(request, baseURL)
    const reopen = () => request.post(`/api/pickleball/open/host/sessions/${code}/reopen`, { headers: writeHeaders(baseURL, code) })
    for (let i = 0; i < 10; i += 1) expect((await reopen()).status()).toBe(201)
    const capped = await reopen()
    expect(capped.status()).toBe(409)
    expect((await capped.json()).error).toBe('This session already has 10 extra host links. Open it on a device you used before.')
  })

  test('sign-in never leaves the site except for Google, and the registered callback belongs to host sign-in', async ({ request }) => {
    const { code } = await createSession(request)
    const start = await request.get(`/api/pickleball/open/host/sign-in?return=/pickleball/s/${code}`, { maxRedirects: 0 })
    expect(start.status()).toBe(302)
    const location = start.headers()['location']
    if (location.startsWith('/')) {
      // No GOOGLE_OAUTH_CLIENT_SECRET in this environment: the host is sent straight back with a reason.
      expect(location).toBe(`/pickleball/s/${code}?signin=unavailable`)
    } else {
      const google = new URL(location)
      expect(google.origin + google.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
      expect(google.searchParams.get('redirect_uri')).toMatch(/\/api\/pickleball\/auth\/google\/callback$/)
    }
    const offsite = await request.get('/api/pickleball/open/host/sign-in?return=https://evil.example/', { maxRedirects: 0 })
    expect(offsite.headers()['location']).not.toContain('evil.example')

    const callback = await request.get('/api/pickleball/auth/google/callback?code=x&state=y', { maxRedirects: 0 })
    expect(callback.status()).toBe(302)
    expect(callback.headers()['location']).toBe('/pickleball/my-sessions?signin=failed')
  })
})

test.describe('the DUPR export (API)', () => {
  test('sign in, add a Club ID, link, then export: the CSV matches the DUPR template and the email lists what was left out', async ({ request, baseURL }) => {
    const { code, hostKey } = await createSession(request)
    const email = uniqueEmail('mo')
    const before = await (await dupr(request, code, hostKey)).json()
    expect(before).toMatchObject({ host: null, claim: 'UNCLAIMED', exported: 0, exportsLeft: 5, exportLimit: 5 })

    const host = await signIn(request, baseURL, email, code)
    expect(host).toEqual({ email, displayName: 'Coach Mo', duprClubId: null, marketingOptIn: false })
    expect(JSON.stringify(host)).not.toMatch(/sub|test-/)

    const noClub = await exportDupr(request, baseURL, code, hostKey)
    expect(noClub.status()).toBe(409)
    expect((await noClub.json()).error).toBe('Add your DUPR Club ID first.')
    expect((await setClubId(request, baseURL, code, 'bad id!')).status()).toBe(400)
    expect((await (await setClubId(request, baseURL, code, 'CLUB-42')).json()).host.duprClubId).toBe('CLUB-42')

    const unclaimed = await exportDupr(request, baseURL, code, hostKey)
    expect(unclaimed.status()).toBe(409)
    expect((await unclaimed.json()).error).toBe('Link this session to your Google account first.')
    expect((await (await claim(request, baseURL, code, hostKey)).json())).toEqual({ claim: 'MINE' })
    expect((await claim(request, baseURL, code, hostKey)).status()).toBe(200)

    const empty = await exportDupr(request, baseURL, code, hostKey)
    expect(empty.status()).toBe(409)
    expect((await empty.json()).error).toMatch(/^No game can go to DUPR yet/)

    await play(request, code, hostKey, ['Ana', 'Ben'], ['Cy', 'Di'], 11, 7)
    await play(request, code, hostKey, ['Ana', 'Eve'], ['Cy', 'Di'], 11, 4)
    const status = await (await dupr(request, code, hostKey)).json()
    expect(status).toMatchObject({ claim: 'MINE', exported: 1, missingIds: [{ name: 'Eve' }] })
    expect(status.skipped).toEqual([{ game: 2, court: 'Court 1', summary: 'Ana & Eve 11–4 Cy & Di', reason: 'Eve has no DUPR ID.' }])

    const sent = await exportDupr(request, baseURL, code, hostKey, 'Asia/Manila')
    expect(sent.status(), await sent.text()).toBe(200)
    const body = await sent.json()
    expect(body).toMatchObject({ delivery: 'SUPPRESSED', to: email, exported: 1, skipped: 1, exportsLeft: 4 })
    const [header, row, ...rest] = body.outbox.csv.split('\r\n')
    expect(header).toBe(TEMPLATE)
    expect(rest).toEqual([])
    const cells = row.split(',')
    expect(cells).toHaveLength(27)
    expect(cells.slice(0, 2)).toEqual(['D', 'Saturday Social'])
    expect(cells[2]).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect([cells[3], cells[4], cells[15], cells[16], cells[26]]).toEqual(['Ana', 'AAA111', '11', '7', 'SIDEOUT'])
    expect(body.outbox.filename).toMatch(/^dupr-saturday-social-\d{4}-\d{2}-\d{2}\.csv$/)
    expect(body.outbox.text).toContain('Game 2, Court 1: Ana & Eve 11–4 Cy & Di. Eve has no DUPR ID.')
    expect(body.outbox.text).toContain('Club ID CLUB-42')
    expect(body.outbox.text).toContain('Import Matches via CSV')
    expect(body.outbox.text).toContain('Club Director or Organizer')

    const eve = status.missingIds[0].id
    await ok(request, code, hostKey, { type: 'SET_PLAYER_DUPR_ID', playerId: eve, duprId: 'eee555' })
    expect(await (await dupr(request, code, hostKey)).json()).toMatchObject({ exported: 2, skipped: [], missingIds: [], exportsLeft: 4 })
  })

  test('five exports per session a day, then a refusal that says when', async ({ request, baseURL }) => {
    const { code, hostKey } = await readyToExport(request, baseURL)
    for (let n = 4; n >= 0; n -= 1) {
      const sent = await exportDupr(request, baseURL, code, hostKey)
      expect(sent.status()).toBe(200)
      expect((await sent.json()).exportsLeft).toBe(n)
    }
    const sixth = await exportDupr(request, baseURL, code, hostKey)
    expect(sixth.status()).toBe(429)
    expect((await sixth.json()).error).toMatch(/^A session can be sent to DUPR 5 times a day\. Try again in about \d+ hours?\.$/)
    const retryAfter = Number(sixth.headers()['retry-after'])
    expect(retryAfter).toBeGreaterThan(23 * 3600)
    expect(retryAfter).toBeLessThanOrEqual(24 * 3600)
    expect((await (await dupr(request, code, hostKey)).json()).exportsLeft).toBe(0)
  })

  test('only the account the session is linked to can export it', async ({ request, playwright, baseURL }) => {
    const { code, hostKey } = await readyToExport(request, baseURL)
    const other = await playwright.request.newContext({ baseURL })
    await signIn(other, baseURL, uniqueEmail('bo'), `${code}-bo`)
    expect((await setClubId(other, baseURL, `${code}-bo`)).status()).toBe(200)
    const refused = await exportDupr(other, baseURL, code, hostKey)
    expect(refused.status()).toBe(403)
    expect((await refused.json()).error).toBe('Only the Google account this session is linked to can export it.')
    expect((await exportDupr(request, baseURL, code, hostKey)).status()).toBe(200)
    await other.dispose()
  })
  test('no sign-in, a wrong host key or a made-up time zone is refused, and none of them uses up an export', async ({ request, playwright, baseURL }) => {
    const { code, hostKey } = await readyToExport(request, baseURL)
    const stranger = await playwright.request.newContext({ baseURL })
    const signedOut = await exportDupr(stranger, baseURL, code, hostKey)
    expect(signedOut.status()).toBe(401)
    expect((await signedOut.json()).error).toBe('Sign in with Google first.')
    await stranger.dispose()

    const wrongKey = await exportDupr(request, baseURL, code, 'not-the-host-key-at-all')
    expect(wrongKey.status()).toBe(403)
    expect((await wrongKey.json()).error).toBe('Only the host can do that.')

    const badZone = await exportDupr(request, baseURL, code, hostKey, 'Mars/Olympus')
    expect(badZone.status()).toBe(400)
    expect((await badZone.json()).error).toMatch(/time zone/)

    expect((await (await dupr(request, code, hostKey)).json()).exportsLeft).toBe(5)
  })
})

test.describe('account deletion and cross-site requests (API)', () => {
  test('deleting the account unlinks its sessions, keeps them running and signs it out on every device', async ({ request, playwright, baseURL }) => {
    const { code, hostKey, email } = await readyToExport(request, baseURL)
    const laptop = await playwright.request.newContext({ baseURL })
    await signIn(laptop, baseURL, email, `${code}-laptop`)

    const deleted = await request.delete('/api/pickleball/open/host/me', { headers: writeHeaders(baseURL, code) })
    expect(deleted.status()).toBe(200)
    expect(await deleted.json()).toEqual({ deleted: true, unlinkedSessions: 1 })
    expect(deleted.headers()['set-cookie']).toContain('devlab_pb_host=;')
    expect((await (await laptop.get('/api/pickleball/open/host/me', { headers: { 'cf-connecting-ip': ipFor(`${code}-laptop`) } })).json()).host).toBeNull()

    // The session is untouched apart from the link, and can be linked again by a new sign-in.
    expect((await request.get(`/api/pickleball/open/s/${code}/host`, { headers: { 'X-Host-Key': hostKey, 'cf-connecting-ip': ipFor(code) } })).status()).toBe(200)
    expect((await (await dupr(request, code, hostKey)).json())).toMatchObject({ host: null, claim: 'UNCLAIMED', exported: 1 })
    const again = await signIn(request, baseURL, email, `${code}-again`)
    expect(again).toMatchObject({ email, duprClubId: null, marketingOptIn: false })
    expect((await claim(request, baseURL, code, hostKey)).status()).toBe(200)
    await laptop.dispose()
  })

  test('host routes refuse a request from another site, or one that does not say where it came from', async ({ request, baseURL }) => {
    const { code, hostKey } = await readyToExport(request, baseURL)
    const evil = { Origin: 'https://evil.example', 'cf-connecting-ip': ipFor(code) }
    expect((await request.post(`/api/pickleball/open/s/${code}/claim`, { headers: { ...evil, 'X-Host-Key': hostKey } })).status()).toBe(403)
    expect((await request.post(`/api/pickleball/open/s/${code}/dupr-export`, { headers: { ...evil, 'X-Host-Key': hostKey }, data: {} })).status()).toBe(403)
    expect((await request.patch('/api/pickleball/open/host/me', { headers: evil, data: { marketingOptIn: true } })).status()).toBe(403)
    expect((await request.delete('/api/pickleball/open/host/me', { headers: evil })).status()).toBe(403)
    expect((await request.delete('/api/pickleball/open/host/me', { headers: { 'cf-connecting-ip': ipFor(code) } })).status()).toBe(403)
    const me = await (await request.get('/api/pickleball/open/host/me', { headers: { 'cf-connecting-ip': ipFor(code) } })).json()
    expect(me.host).toMatchObject({ duprClubId: '12345', marketingOptIn: false })
  })
})

test.describe('the DUPR sheet (screens)', () => {
  test('the host links the session, adds a Club ID and a missing DUPR ID, and emails the export from the console', async ({ page, request, baseURL }) => {
    const { code, hostKey } = await createSession(request)
    await play(request, code, hostKey, ['Ana', 'Eve'], ['Cy', 'Di'], 11, 4)
    await play(request, code, hostKey, ['Ana', 'Ben'], ['Cy', 'Di'], 11, 7)
    await signIn(page.request, baseURL, uniqueEmail('mo'), code)
    await page.goto(`/pickleball/s/${code}#host=${hostKey}`)
    await page.getByRole('button', { name: 'More' }).click()
    await page.getByRole('button', { name: 'Email me the DUPR export' }).click()
    const sheet = page.getByRole('dialog', { name: 'Email me the DUPR export' })
    await sheet.getByRole('button', { name: 'Link to my account' }).click()
    await sheet.getByLabel('Your DUPR Club ID').fill('12345')
    await sheet.getByRole('button', { name: 'Save Club ID' }).click()
    await expect(sheet.getByText('1 game can go to DUPR; 1 game left out.')).toBeVisible()
    await expect(sheet.getByRole('list', { name: 'Left out' })).toContainText('Eve has no DUPR ID.')
    await sheet.getByLabel('DUPR ID for Eve').fill('eee555')
    await sheet.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(sheet.getByText('2 games can go to DUPR.')).toBeVisible()
    await sheet.getByRole('button', { name: 'Email me the export' }).click()
    await expect(sheet.getByRole('status')).toContainText('Test environment: nothing was emailed. 2 games')
    await expect(sheet.getByText('4 of 5 exports left today')).toBeVisible()
  })

  test('signed out, the sheet offers Google with the news box unticked, and coming back from Google reopens it', async ({ page, request, baseURL }) => {
    const { code, hostKey } = await createSession(request)
    await page.goto(`/pickleball/s/${code}#host=${hostKey}`)
    await page.getByRole('button', { name: 'More' }).click()
    await page.getByRole('button', { name: 'Email me the DUPR export' }).click()
    const sheet = page.getByRole('dialog', { name: 'Email me the DUPR export' })
    const signInLink = sheet.getByRole('link', { name: 'Sign in with Google' })
    const news = sheet.getByLabel('Email me occasional Devlab Pickleball news')
    await expect(news).not.toBeChecked()
    await expect(signInLink).toHaveAttribute('href', `/api/pickleball/open/host/sign-in?return=%2Fpickleball%2Fs%2F${code}`)
    await news.check()
    await expect(signInLink).toHaveAttribute('href', `/api/pickleball/open/host/sign-in?return=%2Fpickleball%2Fs%2F${code}&optIn=1`)

    await signIn(page.request, baseURL, uniqueEmail('mo'), code)
    await page.goto(`/pickleball/s/${code}?signin=ok`)
    await expect(page.getByRole('dialog', { name: 'Email me the DUPR export' }).getByRole('button', { name: 'Link to my account' })).toBeVisible()
    expect(new URL(page.url()).search).toBe('')
    await page.goto(`/pickleball/s/${code}?signin=unverified`)
    await expect(page.getByRole('dialog', { name: 'Email me the DUPR export' }).getByRole('alert')).toContainText('no verified email')
  })

  test('the public board and a captain never see the DUPR export or the link', async ({ browser, request, baseURL }) => {
    const { code, hostKey } = await readyToExport(request, baseURL)
    const courtId = (await (await request.get(`/api/pickleball/open/s/${code}/host`, { headers: { 'X-Host-Key': hostKey, 'cf-connecting-ip': ipFor(code) } })).json()).courts[0].id
    const { captainKey } = await (await request.post(`/api/pickleball/open/s/${code}/captains`, { headers: { 'X-Host-Key': hostKey, 'cf-connecting-ip': ipFor(code) }, data: { courtId } })).json()
    const context = await browser.newContext()
    const viewer = await context.newPage()
    await viewer.goto(`/pickleball/s/${code}`)
    await expect(viewer.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(viewer.getByText(/dupr|link to my account|sign in with google/i)).toHaveCount(0)
    const captain = await (await browser.newContext()).newPage()
    await captain.goto(`/pickleball/s/${code}#cap=${captainKey}`)
    await expect(captain.getByText('Court 1 captain')).toBeVisible()
    await expect(captain.getByText(/dupr|link to my account|sign in with google/i)).toHaveCount(0)
    const state = await (await request.get(`/api/pickleball/open/s/${code}/state`)).json()
    expect(JSON.stringify(state)).not.toMatch(/dupr|hostId|host_id|claim/i)
    await context.close()
  })
})

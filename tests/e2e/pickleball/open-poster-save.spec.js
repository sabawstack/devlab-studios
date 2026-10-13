// tests/e2e/pickleball/open-poster-save.spec.js
// The results poster leaves the device on laptops, Android and iPhone, and
// in-app browsers (which drop downloads) are told how to get it instead.
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { test, expect, devices, webkit } from '@playwright/test'

const FILENAME = 'sunday-open-play-results.png'
const MESSENGER_ANDROID = 'Mozilla/5.0 (Linux; Android 13; Pixel 6 Build/TQ3A.230901.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.6478.71 Mobile Safari/537.36 [FB_IAB/MESSENGER;FBAV/460.0.0.36.109;]'
// Screenshots for a human check, only when asked for.
const SHOTS = process.env.POSTER_SHOTS_DIR

// Context options only: a describe block cannot switch the browser type.
const emulate = ({ defaultBrowserType: _ignored, ...rest }) => rest

// Session creation is rate-limited per IP; each create claims its own (see open-play.spec.js).
const freshIp = () => `10.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 254) + 1}`

async function endedSession(request) {
  const created = await request.post('/api/pickleball/open/sessions', {
    headers: { 'cf-connecting-ip': freshIp() },
    data: {
      name: 'Sunday Open Play', hostDisplayName: 'Coach Mike', courtCount: 1,
      settings: { mode: 'PADDLE_STACK', target: 11, scoringStyle: 'SIDEOUT' },
      players: ['Ana', 'Ben', 'Carlo', 'Dina', 'Eli'].map((name) => ({ name })),
    },
  })
  expect(created.status()).toBe(201)
  const { code, hostKey } = await created.json()
  const host = await (await request.get(`/api/pickleball/open/s/${code}/host`, { headers: { 'X-Host-Key': hostKey } })).json()
  const send = (command) => request.post(`/api/pickleball/open/s/${code}/commands`, {
    headers: { 'X-Host-Key': hostKey }, data: { idempotencyKey: crypto.randomUUID(), command },
  })
  expect((await send({ type: 'RECORD_RESULT', matchId: host.courts[0].match.id, winner: 'A', scoreA: 11, scoreB: 4 })).status()).toBe(200)
  expect((await send({ type: 'END_SESSION' })).status()).toBe(200)
  return code
}

async function openPoster(page, request) {
  const code = await endedSession(request)
  await page.goto(`/pickleball/s/${code}`)
  await page.getByTestId('final-results').getByRole('button', { name: 'Save poster' }).click()
  const sheet = page.getByRole('dialog', { name: 'Results poster' })
  const preview = sheet.getByTestId('poster-preview')
  await expect.poll(() => preview.evaluate((img) => img.complete && img.naturalWidth)).toBe(1080)
  return sheet
}

/** PNG signature, then IHDR's big-endian width and height. */
function pngSize(bytes) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  expect([...bytes.subarray(0, 8)]).toEqual(signature)
  expect(bytes.subarray(12, 16).toString('ascii')).toBe('IHDR')
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

async function expectRealPng(download) {
  expect(download.suggestedFilename()).toBe(FILENAME)
  const bytes = await readFile(await download.path())
  expect(pngSize(bytes)).toEqual({ width: 1080, height: 1350 })
  expect(bytes.length).toBeGreaterThan(10_000)
}

// Records share() calls; canShare takes files only when `files` is true.
const stubShare = (files = true) => {
  window.__shares = []
  Object.defineProperty(navigator, 'canShare', { configurable: true, value: (data) => files && Array.isArray(data?.files) })
  Object.defineProperty(navigator, 'share', {
    configurable: true,
    value: (data) => {
      window.__shares.push({ keys: Object.keys(data), files: (data.files ?? []).map((f) => ({ name: f.name, type: f.type, size: f.size, isFile: f instanceof File })) })
      return Promise.resolve()
    },
  })
}
const shares = (page) => page.evaluate(() => window.__shares)
const expectFilesOnly = (calls) => {
  expect(calls).toHaveLength(1)
  expect(calls[0].keys).toEqual(['files'])
  expect(calls[0].files).toHaveLength(1)
  expect(calls[0].files[0]).toMatchObject({ name: FILENAME, type: 'image/png', isFile: true })
  expect(calls[0].files[0].size).toBeGreaterThan(10_000)
}
// After the sheet's entrance animation has settled.
const shot = async (page, name) => { if (SHOTS) await page.waitForTimeout(800).then(() => page.screenshot({ path: path.join(SHOTS, `${name}.png`) })) }

test.describe('poster on a laptop', () => {
  test('Download PNG saves a real 1080×1350 PNG file', async ({ page, request }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    const sheet = await openPoster(page, request)
    await expect(sheet.getByText('Tip: tap and hold the poster to save it')).toHaveCount(0)
    await shot(page, 'desktop-1280')
    const download = page.waitForEvent('download')
    await sheet.getByRole('button', { name: 'Download PNG' }).click()
    await expectRealPng(await download)
    await expect(sheet.getByRole('alert')).toHaveCount(0)
  })

  test('Download PNG works in WebKit (Safari) too', async ({ request, baseURL }) => {
    let browser
    try {
      browser = await webkit.launch()
    } catch {
      test.skip(true, 'WebKit is not installed for this Playwright version (npx playwright install webkit)')
    }
    try {
      const page = await browser.newPage({ baseURL, acceptDownloads: true })
      const sheet = await openPoster(page, request)
      const download = page.waitForEvent('download')
      await sheet.getByRole('button', { name: 'Download PNG' }).click()
      await expectRealPng(await download)
    } finally {
      await browser.close()
    }
  })
})

test.describe('poster on Android', () => {
  test.use(emulate(devices['Pixel 7']))

  test('Download saves the PNG, and Share hands over the file only', async ({ page, request }) => {
    await page.addInitScript(stubShare)
    const sheet = await openPoster(page, request)
    await expect(sheet.getByText('Tip: tap and hold the poster to save it')).toBeVisible()
    const save = sheet.getByRole('button', { name: 'Download', exact: true })
    expect((await save.boundingBox()).height).toBeGreaterThanOrEqual(44)
    await page.setViewportSize({ width: 390, height: 844 })
    await shot(page, 'android-390')
    const download = page.waitForEvent('download')
    await save.click()
    await expectRealPng(await download)
    expect(await shares(page)).toEqual([])
    await sheet.getByRole('button', { name: 'Share' }).click()
    await expect.poll(() => shares(page).then((s) => s.length)).toBe(1)
    expectFilesOnly(await shares(page))
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })

  test('without file sharing there is no Share button, and the page says why', async ({ page, request }) => {
    await page.addInitScript(stubShare, false)
    const sheet = await openPoster(page, request)
    await expect(sheet.getByRole('button', { name: 'Share' })).toHaveCount(0)
    await expect(sheet.getByText("This browser can't share the image directly")).toBeVisible()
  })
})

test.describe('poster on iPhone', () => {
  test.use(emulate(devices['iPhone 14']))

  test('Save to Photos opens the share sheet with one PNG file and nothing else', async ({ page, request }) => {
    await page.addInitScript(stubShare)
    let downloaded = false
    page.on('download', () => { downloaded = true })
    const sheet = await openPoster(page, request)
    await expect(sheet.getByText('Tip: tap and hold the poster to save it')).toBeVisible()
    await shot(page, 'iphone-390')
    const save = sheet.getByRole('button', { name: 'Save to Photos' })
    expect((await save.boundingBox()).height).toBeGreaterThanOrEqual(44)
    await save.click()
    await expect.poll(() => shares(page).then((s) => s.length)).toBe(1)
    expectFilesOnly(await shares(page))
    await expect(sheet.getByRole('button', { name: 'Share' })).toBeVisible()
    expect(downloaded).toBe(false)
  })

  test('without file sharing, Save to Photos explains tap and hold', async ({ page, request }) => {
    await page.addInitScript(stubShare, false)
    const sheet = await openPoster(page, request)
    await sheet.getByRole('button', { name: 'Save to Photos' }).click()
    await expect(sheet.getByRole('alert')).toContainText('Tap and hold the poster, then choose Save to Photos')
  })
})

test.describe('poster in Messenger', () => {
  test.use({ ...emulate(devices['Pixel 7']), userAgent: MESSENGER_ANDROID })

  test('says how to open it in a browser and never tries a download', async ({ page, request }) => {
    await page.addInitScript(stubShare, false)
    let downloaded = false
    page.on('download', () => { downloaded = true })
    const sheet = await openPoster(page, request)
    await expect(sheet.getByTestId('poster-in-app')).toContainText('Open this page in your browser (⋯ menu → Open in browser) to save the poster')
    await expect(sheet.getByText('Tip: tap and hold the poster to save it')).toBeVisible()
    await expect(sheet.getByRole('button', { name: /Download|Save to Photos/ })).toHaveCount(0)
    await page.setViewportSize({ width: 390, height: 844 })
    await shot(page, 'in-app-390')
    await page.waitForTimeout(500)
    expect(downloaded).toBe(false)
  })
})

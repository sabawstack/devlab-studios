/**
 * Captures the Admin workspace and the Pickleball app on the LOCAL fixture
 * stack (wrangler dev on :8787 with the e2e fixtures) for before/after review
 * of the admin and pickleball brand alignment
 * (docs/plans/devlab-admin-pickleball-brand-alignment-audit.md).
 *
 *   node scripts/visual/capture-apps.mjs <outDir> [--reduced-motion] [--base=http://localhost:8787]
 *
 * Every session it creates uses synthetic names. Screenshots can still show
 * whatever the local D1 holds (admin inquiries, mailbox fixtures), so they are
 * written outside the repository and never committed.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium, request as pwRequest } from '@playwright/test'

const args = process.argv.slice(2)
const outDir = args.find((a) => !a.startsWith('--'))
const reducedMotion = args.includes('--reduced-motion')
const base = (args.find((a) => a.startsWith('--base=')) ?? '--base=http://localhost:8787').slice(7)
if (!outDir) {
  console.error('Usage: node scripts/visual/capture-apps.mjs <outDir> [--reduced-motion] [--base=URL]')
  process.exit(1)
}
mkdirSync(outDir, { recursive: true })

const WIDTHS = [
  { name: '390', width: 390, height: 844 },
  { name: '820', width: 820, height: 1180 },
  { name: '1440', width: 1440, height: 900 },
]
const TV = [...WIDTHS, { name: '1920', width: 1920, height: 1080 }]

const ADMIN_EMAIL = 'smoke-test@devlabstudios.com'
const ADMIN_PASSWORD = 'smoke-test-password-123'

const SHORT = ['Ana', 'Ben', 'Carlo', 'Dina', 'Eli', 'Fay', 'Gio', 'Hana', 'Ivan', 'Jun', 'Kai', 'Lia', 'Mo', 'Nia', 'Oli', 'Pat']
const LONG = Array.from({ length: 72 }, (_, i) => `Maximiliana-Bartholomew ${String.fromCharCode(65 + (i % 26))}${i} Delacroix-Villanueva`.slice(0, 40))

const freshIp = () => `10.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 254) + 1}`

async function api() {
  return pwRequest.newContext({ baseURL: base })
}

async function createSession(ctx, data) {
  const response = await ctx.post('/api/pickleball/open/sessions', {
    headers: { 'cf-connecting-ip': freshIp() },
    data: { hostDisplayName: 'Coach Sam', settings: { mode: 'PADDLE_STACK', target: 11, scoringStyle: 'SIDEOUT' }, ...data },
  })
  if (response.status() !== 201) throw new Error(`create failed: ${response.status()} ${await response.text()}`)
  return response.json()
}

async function command(ctx, code, hostKey, cmd) {
  const response = await ctx.post(`/api/pickleball/open/s/${code}/commands`, {
    headers: { 'X-Host-Key': hostKey, 'cf-connecting-ip': freshIp() },
    data: { idempotencyKey: crypto.randomUUID(), command: cmd },
  })
  if (!response.ok()) throw new Error(`${cmd.type} failed: ${response.status()} ${await response.text()}`)
  return response.json()
}

async function host(ctx, code, hostKey) {
  return (await ctx.get(`/api/pickleball/open/s/${code}/host`, { headers: { 'X-Host-Key': hostKey, 'cf-connecting-ip': freshIp() } })).json()
}

async function startAll(ctx, code, hostKey) {
  let snap = await host(ctx, code, hostKey)
  for (const c of snap.courts) if (c.match?.status === 'PROPOSED') await command(ctx, code, hostKey, { type: 'START_MATCH', matchId: c.match.id })
  snap = await host(ctx, code, hostKey)
  return snap
}

/** Sessions used by the captures, all with synthetic names. */
async function scenarios() {
  const ctx = await api()
  // Mixed: court 1 playing, court 2 proposed, one on a break, the rest waiting.
  const mixed = await createSession(ctx, { name: 'Tuesday Social', courtCount: 2, players: SHORT.slice(0, 12).map((name) => ({ name })) })
  let snap = await host(ctx, mixed.code, mixed.hostKey)
  await command(ctx, mixed.code, mixed.hostKey, { type: 'START_MATCH', matchId: snap.courts[0].match.id })
  snap = await host(ctx, mixed.code, mixed.hostKey)
  const name = (id) => snap.players.find((p) => p.id === id)?.name
  const playingId = snap.courts[0].match.teamA[0]
  const upNextId = snap.courts[1].match.teamA[0]
  const waitingIds = snap.viewer.waiting.map((w) => w.id)
  await command(ctx, mixed.code, mixed.hostKey, { type: 'SET_PLAYER_STATUS', playerId: waitingIds[waitingIds.length - 1], status: 'BREAK' })
  const breakId = waitingIds[waitingIds.length - 1]
  const waitingId = waitingIds[0]
  // Every court playing: the "next four" state, when the server fixes it.
  const busy = await createSession(ctx, { name: 'Thursday Ladder', courtCount: 2, players: SHORT.slice(0, 14).map((n) => ({ name: n })) })
  const busySnap = await startAll(ctx, busy.code, busy.hostKey)
  const busyWaitingId = busySnap.viewer.waiting[0]?.id
  // TV sizes.
  const tv1 = await createSession(ctx, { name: 'Morning Drop-in', courtCount: 1, players: SHORT.slice(0, 7).map((n) => ({ name: n })) })
  await startAll(ctx, tv1.code, tv1.hostKey)
  const tv4 = await createSession(ctx, { name: 'Club Night', courtCount: 4, players: SHORT.map((n) => ({ name: n })).concat(['Quin', 'Rae', 'Sol', 'Tao', 'Uma'].map((n) => ({ name: n }))) })
  const tv4Snap = await host(ctx, tv4.code, tv4.hostKey)
  for (const c of tv4Snap.courts.slice(0, 2)) await command(ctx, tv4.code, tv4.hostKey, { type: 'START_MATCH', matchId: c.match.id })
  const tv16 = await createSession(ctx, { name: 'Regional Open Play Marathon with a Long Name', courtCount: 16, players: LONG.map((n) => ({ name: n })) })
  const tv16Snap = await host(ctx, tv16.code, tv16.hostKey)
  for (const c of tv16Snap.courts.slice(0, 10)) await command(ctx, tv16.code, tv16.hostKey, { type: 'START_MATCH', matchId: c.match.id })
  // Tournament: draw running, one game played.
  const cup = await createSession(ctx, {
    name: 'Saturday Cup', courtCount: 2, kind: 'TOURNAMENT', tournament: { format: 'ROUND_ROBIN' },
    players: SHORT.slice(0, 8).map((n, i) => ({ name: n, skill: 5 - (i % 5) })),
  })
  await command(ctx, cup.code, cup.hostKey, { type: 'GENERATE_DRAW', format: 'ROUND_ROBIN', pairing: 'RANDOM', seeding: 'RANDOM' })
  let cupSnap = await command(ctx, cup.code, cup.hostKey, { type: 'START_TOURNAMENT' })
  const first = cupSnap.host?.courts?.[0]?.match ?? (await host(ctx, cup.code, cup.hostKey)).courts[0].match
  await command(ctx, cup.code, cup.hostKey, { type: 'START_MATCH', matchId: first.id })
  await command(ctx, cup.code, cup.hostKey, { type: 'RECORD_RESULT', matchId: first.id, winner: 'A', scoreA: 11, scoreB: 7 })
  // Results: an open session played a little and ended.
  const done = await createSession(ctx, { name: 'Weekend Wrap-up', courtCount: 2, players: SHORT.slice(0, 8).map((n) => ({ name: n })) })
  let doneSnap = await startAll(ctx, done.code, done.hostKey)
  for (const c of doneSnap.courts) await command(ctx, done.code, done.hostKey, { type: 'RECORD_RESULT', matchId: c.match.id, winner: 'A', scoreA: 11, scoreB: 5 })
  await command(ctx, done.code, done.hostKey, { type: 'END_SESSION' })
  await ctx.dispose()
  return {
    mixed, busy, tv1, tv4, tv16, cup, done,
    me: { playing: playingId, upNext: upNextId, waiting: waitingId, onBreak: breakId, busyWaiting: busyWaitingId },
    names: { playing: name(playingId), upNext: name(upNextId) },
  }
}

async function shoot(browser, path, file, viewports, { storageState, setup, waitFor } = {}) {
  for (const vp of viewports) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      reducedMotion: reducedMotion ? 'reduce' : 'no-preference',
      storageState,
    })
    const page = await context.newPage()
    if (setup) await page.addInitScript(setup)
    await page.goto(`${base}${path}`, { waitUntil: 'networkidle' }).catch(() => {})
    if (waitFor) await page.waitForSelector(waitFor, { timeout: 15_000 }).catch(() => {})
    await page.waitForTimeout(800)
    const tv = file.startsWith('pb-tv')
    await page.screenshot({ path: join(outDir, `${file}-${vp.name}.jpg`), type: 'jpeg', quality: 70, fullPage: !tv })
    await context.close()
  }
}

const meScript = (code, id) => `try { localStorage.setItem('devlab-pickleball-me:${code}', '${id ?? ''}') } catch {}`

const browser = await chromium.launch()
// Admin: sign in once (the login limiter allows 20 per 15 minutes).
const adminState = join(outDir, '.admin-state.json')
{
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(`${base}/admin`)
  await shoot(browser, '/admin', 'admin-login', WIDTHS, { waitFor: 'form' })
  await page.getByLabel('Email').fill(ADMIN_EMAIL)
  await page.getByLabel('Password', { exact: true }).fill(ADMIN_PASSWORD)
  await page.getByRole('button', { name: /sign in/i }).click()
  await page.getByRole('button', { name: /log ?out/i }).first().waitFor({ timeout: 20_000 })
  await context.storageState({ path: adminState })
  await context.close()
}
const adminPages = [
  ['/admin', 'admin-home'],
  ['/admin/content/site-settings', 'admin-cms-editor'],
  ['/admin/lead-crm', 'admin-crm-dashboard'],
  ['/admin/lead-crm/review', 'admin-review-queue'],
  ['/admin/mailbox', 'admin-mailbox'],
]
for (const [path, file] of adminPages) await shoot(browser, path, file, WIDTHS, { storageState: adminState })

const s = await scenarios()
await shoot(browser, '/pickleball', 'pb-landing', WIDTHS)
await shoot(browser, '/pickleball/new', 'pb-create', WIDTHS)
await shoot(browser, `/pickleball/s/${s.mixed.code}#host=${s.mixed.hostKey}`, 'pb-host', WIDTHS, { waitFor: '[data-testid="court-1"]' })
for (const [state, id] of [['none', ''], ['playing', s.me.playing], ['upnext', s.me.upNext], ['waiting', s.me.waiting], ['break', s.me.onBreak]]) {
  await shoot(browser, `/pickleball/s/${s.mixed.code}`, `pb-board-${state}`, WIDTHS, { setup: meScript(s.mixed.code, id), waitFor: 'h1' })
}
await shoot(browser, `/pickleball/s/${s.busy.code}`, 'pb-board-allbusy-waiting', WIDTHS, { setup: meScript(s.busy.code, s.me.busyWaiting), waitFor: 'h1' })
for (const [file, sess] of [['pb-tv-1', s.tv1], ['pb-tv-4', s.tv4], ['pb-tv-16-long', s.tv16], ['pb-tv-busy', s.busy]]) {
  await shoot(browser, `/pickleball/s/${sess.code}/tv`, file, TV, { waitFor: '[data-testid="tv-court"]' })
}
await shoot(browser, `/pickleball/s/${s.cup.code}`, 'pb-tournament-board', WIDTHS, { waitFor: 'h1' })
await shoot(browser, `/pickleball/s/${s.cup.code}/tv`, 'pb-tournament-tv', TV, { waitFor: 'h1' })
await shoot(browser, `/pickleball/s/${s.done.code}`, 'pb-results', WIDTHS, { waitFor: 'h1' })
await browser.close()
writeFileSync(join(outDir, 'sessions.json'), JSON.stringify({ base, codes: Object.fromEntries(Object.entries(s).filter(([, v]) => v?.code).map(([k, v]) => [k, v.code])) }, null, 2))
console.log(`Captured into ${outDir}`)

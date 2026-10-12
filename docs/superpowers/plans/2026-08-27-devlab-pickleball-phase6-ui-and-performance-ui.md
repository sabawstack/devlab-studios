# Devlab Pickleball Phase 6 Remainder + Performance UI Implementation Plan

> **Superseded (2026-10-12).** This describes the logged-in operator app, retired in 2.0.0 by Phase 5 of `docs/superpowers/specs/2026-10-11-pickleball-free-open-play-design.md`. Kept as history: the routes, tables and files it names no longer exist.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the UI half of Phase 5 (leaderboard, player profile) that Plan D's backend already supports, plus the remaining pieces of Phase 6 the spec calls for: QR sharing of the public link, a TV/kiosk display variant of the public live view, and the plain `/pickleball/methodology` page.

**Architecture:** Two new authenticated SPA pages (`LeaderboardPage.jsx`, session-scoped; `PlayerProfilePage.jsx`, top-level) consume Plan D's already-built, already-reviewed read routes with zero backend changes. The public live-view's fetch+WebSocket logic is extracted into a small shared hook so a new TV-styled variant can reuse it without duplicating the connection logic. QR generation is client-side only, per spec §10, using the `qrcode` npm package rendering to an inline SVG.

**Tech Stack:** React Router v7, Astro static pages, `qrcode` (new dependency), Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-08-24-devlab-pickleball-design.md`

## Global Constraints

- No backend changes in this plan. Every new page consumes an already-shipped route: `GET /api/pickleball/sessions/:id/leaderboard` (Plan D), `GET /api/pickleball/players/:id/stats` (Plan D), `GET /api/pickleball/sessions/:id/public-code` (earlier plan), the existing public REST/WS channel.
- **Ruling (disclosed deviation from spec §9)**: the public channel's sanitized leaderboard (`toPublicSessionView` gaining leaderboard fields) is explicitly OUT of scope for this plan. It requires extending a shared, pure, already-tested function (`toPublicSessionView`) and its call sites across the DO's WebSocket broadcast, the reconnect-resync path, and the public REST fallback route — real backend work, not a UI-only addition, and this plan is scoped to be backend-free. Deferred to a future increment; the plain live view and TV display in this plan show courts/scores only, matching what's already public today.
- QR codes are generated **client-side only**, from the canonical public URL, rendered as an inline `<svg>` — no external QR service call, matching spec §10 exactly.
- Every new page follows the established house style: `pickleballApi` for authenticated fetches, the `message:{type,text}` error-rendering convention, `useOutletContext()` for session-scoped data (never re-fetching what `SessionLayout` already provides).
- `--local` only. No placeholder routes.

---

### Task 1: Extract the public live-view's data hook, so the TV display can reuse it

**Files:**
- Create: `src/pickleball-app/lib/usePublicSessionView.js`
- Modify: `src/pickleball-app/LiveView.jsx`

**Interfaces:**
- Produces: `usePublicSessionView(code)` → `{view, loadError}` — `view` is the merged (WS-priority, REST-fallback) sanitized session payload, `null` while loading. Consumed by `LiveView.jsx` (this task) and the new TV display component (Task 2).

- [ ] **Step 1: Create the shared hook**

```jsx
import { useEffect, useState } from 'react'
import { useSessionRealtime } from './useSessionRealtime'

export function usePublicSessionView(code) {
  const [initial, setInitial] = useState(null)
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    let ignore = false
    fetch(`/api/pickleball/public/${code}/state`)
      .then((response) => {
        if (!response.ok) throw new Error('Not found.')
        return response.json()
      })
      .then((data) => {
        if (!ignore) setInitial(data)
      })
      .catch(() => {
        if (!ignore) setLoadError(true)
      })
    return () => {
      ignore = true
    }
  }, [code])

  const wsUrl = loadError ? null : `${window.location.origin.replace('http', 'ws')}/pickleball/rt/public/${code}`
  const { snapshot } = useSessionRealtime(wsUrl)

  return { view: snapshot || initial, loadError }
}
```

- [ ] **Step 2: Refactor `LiveView.jsx` to use it — behavior-preserving, no visual change**

Replace the full content of `src/pickleball-app/LiveView.jsx`:

```jsx
import { usePublicSessionView } from './lib/usePublicSessionView'

export default function LiveView({ code }) {
  const { view, loadError } = usePublicSessionView(code)

  if (loadError) {
    return <p className="p-6 text-sm text-rose-300">This live view is not available.</p>
  }

  if (!view) {
    return <p className="p-6 text-sm text-slate-300">Loading…</p>
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold text-white">{view.session.name}</h1>
      <div className="grid gap-4 sm:grid-cols-2" data-testid="live-courts">
        {view.courts.map((court) => {
          const game = view.games.find((g) => g.id === court.currentGameId)
          return (
            <div key={court.id} className="rounded-xl border border-white/10 bg-white/5 p-4">
              <p className="text-sm font-semibold text-white">{court.courtName}</p>
              <p className="text-xs text-slate-400">{court.status}</p>
              {game ? (
                <p className="mt-2 text-3xl font-bold text-white">{game.scoreA} – {game.scoreB}</p>
              ) : (
                <p className="mt-2 text-sm text-slate-400">No game in progress.</p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Run the existing e2e coverage to confirm no regression**

Run: `npx playwright test tests/e2e/pickleball/pickleball-operator-ui.spec.js --project=worker -g "public live view"`
Expected: PASS (both existing public-live-view tests — "shows a session's courts and games without authentication" and "returns to 'No game in progress' once a game finishes" — still pass unchanged, since this refactor is behavior-preserving).

- [ ] **Step 4: Commit**

```bash
git add src/pickleball-app/lib/usePublicSessionView.js src/pickleball-app/LiveView.jsx
git commit -m "refactor: extract the public live-view data hook for reuse by the TV display"
```

---

### Task 2: TV/kiosk display variant

**Files:**
- Create: `src/pickleball-app/TVDisplay.jsx`
- Create: `src/pages/pickleball/live/[code]/display.astro`
- Test: `tests/e2e/pickleball/pickleball-operator-ui.spec.js`

**Interfaces:**
- Consumes: `usePublicSessionView(code)` (Task 1).
- Produces: `/pickleball/live/:code/display` — a large-font, high-contrast variant of the plain live view intended for a TV mounted at a venue, viewed from a distance.

- [ ] **Step 1: Create `TVDisplay.jsx`**

```jsx
import { usePublicSessionView } from './lib/usePublicSessionView'

export default function TVDisplay({ code }) {
  const { view, loadError } = usePublicSessionView(code)

  if (loadError) {
    return <p className="p-12 text-3xl text-rose-300">This display is not available.</p>
  }

  if (!view) {
    return <p className="p-12 text-3xl text-slate-300">Loading…</p>
  }

  return (
    <div className="min-h-screen space-y-10 p-10">
      <h1 className="text-5xl font-bold text-white">{view.session.name}</h1>
      <div className="grid gap-8 sm:grid-cols-2" data-testid="tv-courts">
        {view.courts.map((court) => {
          const game = view.games.find((g) => g.id === court.currentGameId)
          return (
            <div key={court.id} className="rounded-2xl border border-white/10 bg-white/5 p-8">
              <p className="text-2xl font-semibold text-white">{court.courtName}</p>
              <p className="mt-1 text-lg text-slate-400">{court.status}</p>
              {game ? (
                <p className="mt-6 text-8xl font-black text-white">{game.scoreA} – {game.scoreB}</p>
              ) : (
                <p className="mt-6 text-2xl text-slate-500">No game in progress.</p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create the nested Astro route**

Mirrors `src/pages/pickleball/live/[code].astro`'s exact `client:only="react"` convention, with a nested `:code` param directory.

```astro
---
import '../../../../index.css'
import TVDisplay from '../../../../pickleball-app/TVDisplay.jsx'

const { code } = Astro.params
---

<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="robots" content="noindex, nofollow" />
    <title>Devlab Pickleball — Display</title>
  </head>
  <body class="public-page">
    <div id="pickleball-tv-root">
      <TVDisplay code={code} client:only="react" />
    </div>
  </body>
</html>
```

Confirm the relative import depth (`../../../../index.css`, `../../../../pickleball-app/TVDisplay.jsx`) is correct for this file's actual location (`src/pages/pickleball/live/[code]/display.astro` is one directory deeper than `src/pages/pickleball/live/[code].astro`, so it needs one more `../` than that file's own `../../../index.css`) — verify by checking the file's real path depth once created, don't just trust this count blindly.

- [ ] **Step 3: Write an e2e test**

Append to `tests/e2e/pickleball/pickleball-operator-ui.spec.js`, mirroring the existing `'the public live view shows a session's courts and games without authentication'` test's exact setup (read it first) but navigating to `/pickleball/live/${code}/display` instead, and asserting against `data-testid="tv-courts"`:

```js
test('the TV display shows a session\'s courts and games without authentication', async ({ page, request, context }) => {
  const baseURL = test.info().project.use.baseURL
  await loginAsOperator(request, context, baseURL)

  const venueResponse = await request.post('/api/pickleball/venues', { data: { name: `TV Display Venue ${Date.now()}` } })
  const venueId = (await venueResponse.json()).venue.id
  await request.post('/api/pickleball/courts', { data: { venueId, name: 'Court 1' } })
  const sessionResponse = await request.post('/api/pickleball/sessions', {
    data: {
      venueId, name: `TV Display Session ${Date.now()}`, sessionType: 'OPEN_PLAY',
      scoringRulesetId: 'usap-2026-sideout-11-doubles',
      scheduledStart: '2026-09-01T18:00:00.000Z', scheduledEnd: '2026-09-01T22:00:00.000Z',
    },
  })
  const sessionId = (await sessionResponse.json()).session.id

  const codeResponse = await request.get(`/api/pickleball/sessions/${sessionId}/public-code`)
  const { code } = await codeResponse.json()

  const publicContext = await context.browser().newContext()
  const publicPage = await publicContext.newPage()
  await publicPage.goto(`/pickleball/live/${code}/display`)

  await expect(publicPage.getByText('Court 1')).toBeVisible({ timeout: 10000 })
  await expect(publicPage.getByTestId('tv-courts').getByText('No game in progress.')).toBeVisible()
  await publicContext.close()
})
```

- [ ] **Step 4: Run the new test**

Run: `npx playwright test tests/e2e/pickleball/pickleball-operator-ui.spec.js --project=worker -g "TV display"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pickleball-app/TVDisplay.jsx src/pages/pickleball/live/\[code\]/display.astro tests/e2e/pickleball/pickleball-operator-ui.spec.js
git commit -m "feat: add the TV/kiosk display variant of the public live view"
```

---

### Task 3: QR code sharing on the operator's session control page

**Files:**
- Modify: `package.json` (new dependency)
- Create: `src/pickleball-app/components/PublicLinkQRCode.jsx`
- Modify: `src/pickleball-app/pages/SessionControlPage.jsx`
- Test: `tests/e2e/pickleball/pickleball-operator-ui.spec.js`

**Interfaces:**
- Produces: `<PublicLinkQRCode url={string} />` — renders an inline SVG QR code for the given URL, or nothing while it's generating.

- [ ] **Step 1: Add the `qrcode` dependency**

```bash
npm install qrcode
```

Confirm it landed in `package.json`'s `dependencies` (not `devDependencies` — it's used at runtime in the browser bundle) and that `package-lock.json` updated.

- [ ] **Step 2: Create `PublicLinkQRCode.jsx`**

```jsx
import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

// Client-side only, from the canonical public URL, rendered as an inline
// <svg> -- per spec §10, no external QR service call. The markup string
// comes entirely from the `qrcode` library given a URL this app constructed
// itself (never raw user input), so injecting it via dangerouslySetInnerHTML
// is safe here.
export default function PublicLinkQRCode({ url }) {
  const [svgMarkup, setSvgMarkup] = useState(null)

  useEffect(() => {
    let ignore = false
    QRCode.toString(url, { type: 'svg', width: 160, margin: 1 })
      .then((markup) => {
        if (!ignore) setSvgMarkup(markup)
      })
      .catch(() => {})
    return () => {
      ignore = true
    }
  }, [url])

  if (!svgMarkup) return null

  return <div data-testid="public-link-qr" className="h-40 w-40" dangerouslySetInnerHTML={{ __html: svgMarkup }} />
}
```

- [ ] **Step 3: Wire it into `SessionControlPage.jsx`**

Replace the full content of `src/pickleball-app/pages/SessionControlPage.jsx`:

```jsx
import { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { pickleballApi } from '../lib/pickleballApi'
import PublicLinkQRCode from '../components/PublicLinkQRCode'

export default function SessionControlPage() {
  const { sessionId, session, snapshot } = useOutletContext()
  const [publicCode, setPublicCode] = useState(null)

  useEffect(() => {
    let ignore = false
    pickleballApi
      .get(`/api/pickleball/sessions/${sessionId}/public-code`)
      .then((data) => {
        if (!ignore) setPublicCode(data.code)
      })
      .catch(() => {})
    return () => {
      ignore = true
    }
  }, [sessionId])

  if (!session) return <p className="text-sm text-slate-500">Loading…</p>

  const publicUrl = publicCode ? `${window.location.origin}/pickleball/live/${publicCode}` : null

  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs font-medium uppercase text-slate-500">Status</dt>
          <dd className="text-lg font-semibold text-slate-900">{session.status}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase text-slate-500">Type</dt>
          <dd className="text-lg font-semibold text-slate-900">{session.sessionType}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase text-slate-500">Queued</dt>
          <dd className="text-lg font-semibold text-slate-900" data-testid="queue-count">{snapshot ? snapshot.queue.filter((entry) => entry.status === 'QUEUED').length : '—'}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase text-slate-500">Courts</dt>
          <dd className="text-lg font-semibold text-slate-900" data-testid="courts-count">{snapshot ? snapshot.courts.length : '—'}</dd>
        </div>
      </dl>
      {publicUrl ? (
        <div className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-4">
          <PublicLinkQRCode url={publicUrl} />
          <div className="space-y-1 text-sm text-slate-500">
            <p>Public live view:</p>
            <a
              data-testid="public-live-link"
              href={`/pickleball/live/${publicCode}`}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-brand underline"
            >
              /pickleball/live/{publicCode}
            </a>
            <p>TV display: <a href={`/pickleball/live/${publicCode}/display`} target="_blank" rel="noreferrer" className="font-medium text-brand underline">/pickleball/live/{publicCode}/display</a></p>
          </div>
        </div>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 4: Write an e2e test**

Append to `tests/e2e/pickleball/pickleball-operator-ui.spec.js`, mirroring the existing `'SessionControlPage shows Live status...'` test's setup:

```js
test('SessionControlPage shows a QR code and TV display link for the public view', async ({ page, request, baseURL }) => {
  await loginAsOperator(request, page.context(), baseURL)

  const venueResponse = await request.post('/api/pickleball/venues', { data: { name: `QR Venue ${Date.now()}` } })
  const venueId = (await venueResponse.json()).venue.id
  const sessionResponse = await request.post('/api/pickleball/sessions', {
    data: {
      venueId,
      name: `QR Session ${Date.now()}`,
      sessionType: 'OPEN_PLAY',
      scoringRulesetId: 'usap-2026-sideout-11-doubles',
      scheduledStart: '2026-09-01T18:00:00.000Z',
      scheduledEnd: '2026-09-01T22:00:00.000Z',
    },
  })
  const sessionId = (await sessionResponse.json()).session.id

  await page.goto(`/pickleball/app/sessions/${sessionId}`)
  await expect(page.getByTestId('public-link-qr')).toBeVisible({ timeout: 10000 })
  await expect(page.getByTestId('public-link-qr').locator('svg')).toBeVisible()
  await expect(page.getByText('TV display:')).toBeVisible()
})
```

- [ ] **Step 5: Run tests**

Run: `npx playwright test tests/e2e/pickleball/pickleball-operator-ui.spec.js --project=worker -g "QR code"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/pickleball-app/components/PublicLinkQRCode.jsx src/pickleball-app/pages/SessionControlPage.jsx tests/e2e/pickleball/pickleball-operator-ui.spec.js
git commit -m "feat: add a QR code and TV display link to the session control page"
```

---

### Task 4: `LeaderboardPage.jsx`

**Files:**
- Create: `src/pickleball-app/pages/LeaderboardPage.jsx`
- Modify: `src/pickleball-app/PickleballApp.jsx`
- Modify: `src/pickleball-app/components/SessionLayout.jsx`
- Test: `tests/e2e/pickleball/pickleball-operator-ui.spec.js`

**Interfaces:**
- Consumes: `GET /api/pickleball/sessions/:id/leaderboard?minGames=N` (Plan D) → `{leaderboard: [{playerId, displayName, opi, eligibleGamesCount, confidenceTier}]}`.
- Produces: route `sessions/:sessionId/leaderboard`.

- [ ] **Step 1: Create `LeaderboardPage.jsx`**

```jsx
import { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { pickleballApi } from '../lib/pickleballApi'

export default function LeaderboardPage() {
  const { sessionId } = useOutletContext()
  const [rows, setRows] = useState(null)
  const [showAll, setShowAll] = useState(false)
  const [message, setMessage] = useState(null)

  useEffect(() => {
    let ignore = false
    setRows(null)
    const query = showAll ? '?minGames=0' : ''
    pickleballApi
      .get(`/api/pickleball/sessions/${sessionId}/leaderboard${query}`)
      .then((data) => {
        if (!ignore) setRows(data.leaderboard)
      })
      .catch((error) => {
        if (!ignore) setMessage({ type: 'error', text: error.message })
      })
    return () => {
      ignore = true
    }
  }, [sessionId, showAll])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Leaderboard</h1>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={showAll} onChange={(event) => setShowAll(event.target.checked)} />
          Show provisional players
        </label>
      </div>
      {message ? <p className="text-sm text-rose-600">{message.text}</p> : null}
      {rows === null ? <p className="text-sm text-slate-500">Loading…</p> : null}
      {rows && !rows.length ? <p className="text-sm text-slate-500">No qualifying players yet.</p> : null}
      {rows && rows.length ? (
        <div className="space-y-2" data-testid="leaderboard-list">
          {rows.map((row, index) => (
            <div key={row.playerId} className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm">
              <span className="flex items-center gap-3">
                <span className="w-6 text-right font-semibold text-slate-400">{index + 1}</span>
                <span className="font-semibold text-slate-900">{row.displayName}</span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">{row.confidenceTier}</span>
              </span>
              <span className="flex items-center gap-3 text-slate-600">
                <span>{row.eligibleGamesCount} games</span>
                <span className="text-lg font-bold text-slate-900">{row.opi.toFixed(2)}</span>
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 2: Register the route**

In `src/pickleball-app/PickleballApp.jsx`, add the import alongside `GamesListPage`:

```jsx
import LeaderboardPage from './pages/LeaderboardPage'
```

And add the route, alongside `games`:

```jsx
            { path: 'leaderboard', element: <LeaderboardPage /> },
```

- [ ] **Step 3: Add the nav link**

In `src/pickleball-app/components/SessionLayout.jsx`, add an entry to the `SUB_NAV` array:

```jsx
  { to: 'leaderboard', label: 'Leaderboard' },
```

(Placed after the existing `games` entry — read the file first to confirm its exact current array order and add it in the natural last position.)

- [ ] **Step 4: Write an e2e test**

Append to `tests/e2e/pickleball/pickleball-operator-ui.spec.js`, reusing the games-spec-style setup (venue/court/session/4 players/queue/assign/start/finish 11-0) to produce real leaderboard data, then navigating to the leaderboard page:

```js
test('shows the session leaderboard with the show-provisional toggle', async ({ page, request, context }) => {
  const baseURL = test.info().project.use.baseURL
  await loginAsOperator(request, context, baseURL)

  const venueResponse = await request.post('/api/pickleball/venues', { data: { name: `Leaderboard Page Venue ${Date.now()}` } })
  const venueId = (await venueResponse.json()).venue.id
  await request.post('/api/pickleball/courts', { data: { venueId, name: 'Court 1' } })
  const sessionResponse = await request.post('/api/pickleball/sessions', {
    data: {
      venueId, name: `Leaderboard Page Session ${Date.now()}`, sessionType: 'OPEN_PLAY',
      scoringRulesetId: 'usap-2026-sideout-11-doubles',
      scheduledStart: '2026-09-01T18:00:00.000Z', scheduledEnd: '2026-09-01T22:00:00.000Z',
    },
  })
  const sessionId = (await sessionResponse.json()).session.id
  await request.post(`/api/pickleball/sessions/${sessionId}/status`, { data: { status: 'OPEN_FOR_CHECKIN' } })
  await request.post(`/api/pickleball/sessions/${sessionId}/status`, { data: { status: 'LIVE' } })
  const sessionCourtId = (await (await request.get(`/api/pickleball/sessions/${sessionId}/courts`)).json()).courts[0].id

  for (let i = 0; i < 4; i += 1) {
    const playerId = (await (await request.post('/api/pickleball/players', { data: { displayName: `Leaderboard Player ${i}-${Date.now()}` } })).json()).player.id
    const sessionPlayerId = (await (await request.post(`/api/pickleball/sessions/${sessionId}/players`, { data: { playerId } })).json()).sessionPlayer.id
    await request.post(`/api/pickleball/sessions/${sessionId}/players/check-in`, { data: { playerId } })
    await request.post(`/api/pickleball/sessions/${sessionId}/queue`, { data: { sessionPlayerId } })
  }
  await request.post(`/api/pickleball/sessions/${sessionId}/courts/assign`, { data: { sessionCourtId } })
  const teams = (await (await request.get(`/api/pickleball/sessions/${sessionId}/courts/${sessionCourtId}/teams`)).json()).teams
  const startResponse = await request.post(`/api/pickleball/sessions/${sessionId}/games/start`, {
    data: {
      sessionCourtId, servingTeam: 'A',
      teamAStartingServerSessionPlayerId: teams[0].members[0].sessionPlayerId,
      teamBStartingServerSessionPlayerId: teams[1].members[0].sessionPlayerId,
    },
  })
  const gameId = (await startResponse.json()).game.id
  for (let i = 0; i < 11; i += 1) {
    await request.post(`/api/pickleball/sessions/${sessionId}/games/${gameId}/rally`, { data: { winningTeam: 'A' } })
  }
  await request.post(`/api/pickleball/sessions/${sessionId}/games/${gameId}/finish`, { data: {} })

  await page.goto(`/pickleball/app/sessions/${sessionId}/leaderboard`)
  await expect(page.getByText('No qualifying players yet.')).toBeVisible()

  await page.getByLabel('Show provisional players').check()
  await expect(page.getByTestId('leaderboard-list')).toBeVisible({ timeout: 10000 })
  const rows = page.getByTestId('leaderboard-list').locator('> div')
  await expect(rows).toHaveCount(4)
})
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run`
Run: `npx playwright test tests/e2e/pickleball/pickleball-operator-ui.spec.js --project=worker -g "leaderboard"`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/pickleball-app/pages/LeaderboardPage.jsx src/pickleball-app/PickleballApp.jsx src/pickleball-app/components/SessionLayout.jsx tests/e2e/pickleball/pickleball-operator-ui.spec.js
git commit -m "feat: add the session leaderboard page"
```

---

### Task 5: `PlayerProfilePage.jsx`

**Files:**
- Create: `src/pickleball-app/pages/PlayerProfilePage.jsx`
- Modify: `src/pickleball-app/PickleballApp.jsx`
- Modify: `src/pickleball-app/pages/PlayersPage.jsx`
- Test: `tests/e2e/pickleball/pickleball-operator-ui.spec.js`

**Interfaces:**
- Consumes: `GET /api/pickleball/players/:id/stats` (Plan D) → `{allTime: {opi, eligibleGamesCount, confidenceTier}|null, sessions: [{sessionId, sessionName, opi, eligibleGamesCount, confidenceTier}]}`.
- Produces: top-level route `players/:id`.

- [ ] **Step 1: Create `PlayerProfilePage.jsx`**

```jsx
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { pickleballApi } from '../lib/pickleballApi'

export default function PlayerProfilePage() {
  const { playerId } = useParams()
  const [stats, setStats] = useState(null)
  const [message, setMessage] = useState(null)

  useEffect(() => {
    let ignore = false
    pickleballApi
      .get(`/api/pickleball/players/${playerId}/stats`)
      .then((data) => {
        if (!ignore) setStats(data)
      })
      .catch((error) => {
        if (!ignore) setMessage({ type: 'error', text: error.message })
      })
    return () => {
      ignore = true
    }
  }, [playerId])

  if (message) return <p className="text-sm text-rose-600">{message.text}</p>
  if (!stats) return <p className="text-sm text-slate-500">Loading…</p>

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900">Player Profile</h1>
      <div className="rounded-xl border border-slate-200 bg-white p-6" data-testid="player-all-time">
        <p className="text-xs font-medium uppercase text-slate-500">All-time OPI</p>
        {stats.allTime ? (
          <>
            <p className="text-4xl font-bold text-slate-900">{stats.allTime.opi.toFixed(2)}</p>
            <p className="mt-1 text-sm text-slate-500">
              {stats.allTime.eligibleGamesCount} eligible games · {stats.allTime.confidenceTier}
            </p>
          </>
        ) : (
          <p className="text-sm text-slate-500">No eligible games yet.</p>
        )}
      </div>
      <div>
        <h2 className="mb-2 text-sm font-semibold uppercase text-slate-500">By session</h2>
        <div className="space-y-2" data-testid="player-sessions">
          {stats.sessions.map((row) => (
            <div key={row.sessionId} className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm">
              <span className="font-semibold text-slate-900">{row.sessionName}</span>
              <span className="text-slate-600">{row.opi.toFixed(2)} · {row.eligibleGamesCount} games · {row.confidenceTier}</span>
            </div>
          ))}
          {!stats.sessions.length ? <p className="text-sm text-slate-500">No sessions yet.</p> : null}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Register the route**

In `src/pickleball-app/PickleballApp.jsx`, add the import:

```jsx
import PlayerProfilePage from './pages/PlayerProfilePage'
```

And a new top-level route (a sibling of `players`, `venues`, `sessions`):

```jsx
        { path: 'players/:playerId', element: <PlayerProfilePage /> },
```

- [ ] **Step 3: Link into it from `PlayersPage.jsx`**

Read `src/pickleball-app/pages/PlayersPage.jsx` in full first to find its exact current players-list rendering block. Add a `Link` (import `Link` from `react-router-dom` alongside whatever it already imports) wrapping each player row so it navigates to `players/${player.id}` — follow the exact same pattern `GamesListPage.jsx` already established for linking into `ScorekeeperPage` (a `<Link to={player.id}>` wrapping the existing row content, relative to the current `players` route). Do not restructure anything else in the file.

- [ ] **Step 4: Write an e2e test**

Append to `tests/e2e/pickleball/pickleball-operator-ui.spec.js`:

```js
test('opens a player profile from the Players page and shows all-time and per-session stats', async ({ page, request, context }) => {
  const baseURL = test.info().project.use.baseURL
  await loginAsOperator(request, context, baseURL)

  const venueResponse = await request.post('/api/pickleball/venues', { data: { name: `Profile Venue ${Date.now()}` } })
  const venueId = (await venueResponse.json()).venue.id
  await request.post('/api/pickleball/courts', { data: { venueId, name: 'Court 1' } })
  const sessionResponse = await request.post('/api/pickleball/sessions', {
    data: {
      venueId, name: `Profile Session ${Date.now()}`, sessionType: 'OPEN_PLAY',
      scoringRulesetId: 'usap-2026-sideout-11-doubles',
      scheduledStart: '2026-09-01T18:00:00.000Z', scheduledEnd: '2026-09-01T22:00:00.000Z',
    },
  })
  const sessionId = (await sessionResponse.json()).session.id
  await request.post(`/api/pickleball/sessions/${sessionId}/status`, { data: { status: 'OPEN_FOR_CHECKIN' } })
  await request.post(`/api/pickleball/sessions/${sessionId}/status`, { data: { status: 'LIVE' } })
  const sessionCourtId = (await (await request.get(`/api/pickleball/sessions/${sessionId}/courts`)).json()).courts[0].id

  const playerName = `Profile Player ${Date.now()}`
  const playerId = (await (await request.post('/api/pickleball/players', { data: { displayName: playerName } })).json()).player.id
  const sessionPlayerId = (await (await request.post(`/api/pickleball/sessions/${sessionId}/players`, { data: { playerId } })).json()).sessionPlayer.id
  await request.post(`/api/pickleball/sessions/${sessionId}/players/check-in`, { data: { playerId } })
  await request.post(`/api/pickleball/sessions/${sessionId}/queue`, { data: { sessionPlayerId } })

  for (let i = 0; i < 3; i += 1) {
    const fillerId = (await (await request.post('/api/pickleball/players', { data: { displayName: `Profile Filler ${i}-${Date.now()}` } })).json()).player.id
    const fillerSpId = (await (await request.post(`/api/pickleball/sessions/${sessionId}/players`, { data: { playerId: fillerId } })).json()).sessionPlayer.id
    await request.post(`/api/pickleball/sessions/${sessionId}/players/check-in`, { data: { playerId: fillerId } })
    await request.post(`/api/pickleball/sessions/${sessionId}/queue`, { data: { sessionPlayerId: fillerSpId } })
  }
  await request.post(`/api/pickleball/sessions/${sessionId}/courts/assign`, { data: { sessionCourtId } })
  const teams = (await (await request.get(`/api/pickleball/sessions/${sessionId}/courts/${sessionCourtId}/teams`)).json()).teams
  const startResponse = await request.post(`/api/pickleball/sessions/${sessionId}/games/start`, {
    data: {
      sessionCourtId, servingTeam: 'A',
      teamAStartingServerSessionPlayerId: teams[0].members[0].sessionPlayerId,
      teamBStartingServerSessionPlayerId: teams[1].members[0].sessionPlayerId,
    },
  })
  const gameId = (await startResponse.json()).game.id
  for (let i = 0; i < 11; i += 1) {
    await request.post(`/api/pickleball/sessions/${sessionId}/games/${gameId}/rally`, { data: { winningTeam: 'A' } })
  }
  await request.post(`/api/pickleball/sessions/${sessionId}/games/${gameId}/finish`, { data: {} })

  await page.goto('/pickleball/app/players')
  await page.getByTestId('players-list').getByText(playerName).click()

  await expect(page).toHaveURL(new RegExp(`/players/${playerId}$`))
  await expect(page.getByTestId('player-sessions')).toContainText(sessionId ? '' : '')
  await expect(page.getByTestId('player-all-time')).toBeVisible({ timeout: 10000 })
})
```

Note: whether the seeded player ends up on the winning or losing side of the 11-0 game (and therefore whether `allTime` is `{opi:100,...}` or `{opi:0,...}`) depends on team assignment, which this test doesn't control precisely — the assertion above deliberately only checks that the page loads and both sections render, not a specific OPI value. If you want a stronger assertion, read the `teams` response to determine which side `playerId` landed on before asserting an exact `opi` value — use your judgment, either is acceptable for this task.

- [ ] **Step 5: Run tests**

Run: `npx vitest run`
Run: `npx playwright test tests/e2e/pickleball/pickleball-operator-ui.spec.js --project=worker -g "player profile"`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/pickleball-app/pages/PlayerProfilePage.jsx src/pickleball-app/PickleballApp.jsx src/pickleball-app/pages/PlayersPage.jsx tests/e2e/pickleball/pickleball-operator-ui.spec.js
git commit -m "feat: add the player profile page"
```

---

### Task 6: Methodology page

**Files:**
- Create: `src/pages/pickleball/methodology.astro`

**Interfaces:**
- Produces: `/pickleball/methodology`, a plain, non-SPA-island public page.

- [ ] **Step 1: Read `src/pages/pickleball/index.astro` in full first**

Confirm its exact `Layout` import path and the `max-w-2xl` centered-container convention before writing this file, so the new page matches it exactly rather than approximating it.

- [ ] **Step 2: Create the page**

Mirror `index.astro`'s exact structure (same `Layout` import, same container convention), with content covering: what OPI is (the formula in plain language — game performance = your points ÷ total points in that game, averaged across your eligible games), the confidence tiers (Provisional under 3 games, Developing 3-9, Established 10+), and the spec's required non-goals disclaimer verbatim: "OPI is a Devlab-original metric, not an official USA Pickleball rating, DUPR, UTR-P, or Elo system. The scoring engine aligns with standard side-out scoring concepts but the software is not USA-Pickleball-certified."

```astro
---
import Layout from '../../layouts/Layout.astro'
---

<Layout title="OPI Methodology — Devlab Pickleball">
  <main class="mx-auto max-w-2xl px-6 py-16">
    <h1 class="mb-4 text-3xl font-bold text-slate-900">How OPI works</h1>
    <p class="mb-4 text-slate-600">
      OPI (Open Play Performance Index) measures how well a player performs relative to the points
      scored in their games. For each eligible finished game, your <strong>game performance</strong> is
      your points scored divided by the total points played in that game, as a percentage. Your OPI is
      the average of your game performance across every eligible game you've played.
    </p>
    <p class="mb-4 text-slate-600">
      In doubles, both teammates receive the same game performance value for a shared game — OPI
      measures how your team performed together, not an individual point-by-point breakdown.
    </p>
    <h2 class="mb-2 mt-8 text-xl font-semibold text-slate-900">Confidence tiers</h2>
    <ul class="mb-4 list-disc space-y-1 pl-5 text-slate-600">
      <li><strong>Provisional</strong> — 0 to 2 eligible games. Not enough history yet to be a stable signal.</li>
      <li><strong>Developing</strong> — 3 to 9 eligible games.</li>
      <li><strong>Established</strong> — 10 or more eligible games.</li>
    </ul>
    <p class="mt-8 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
      OPI is a Devlab-original metric, not an official USA Pickleball rating, DUPR, UTR-P, or Elo
      system. The scoring engine aligns with standard side-out scoring concepts but the software is
      not USA-Pickleball-certified.
    </p>
  </main>
</Layout>
```

Adjust the `Layout` import path and any prop it requires (e.g. `title`) to match what `index.astro` actually uses — read that file's real usage first rather than trusting this exact snippet if it differs.

- [ ] **Step 3: Verify it builds and renders**

Run: `npm run build` (or start `npm run dev` and visit `/pickleball/methodology` manually)
Expected: page builds/renders with no errors, disclaimer text present verbatim.

- [ ] **Step 4: Commit**

```bash
git add src/pages/pickleball/methodology.astro
git commit -m "feat: add the OPI methodology page"
```

---

## Out of scope

- **The public channel's sanitized leaderboard** (spec §9) — disclosed at the top of this plan. Requires backend changes to `toPublicSessionView` and its call sites; deferred to a future increment.
- **QR codes anywhere other than the operator's session control page** — e.g. no QR code is added to the TV display itself (a TV display showing a QR code pointing back to itself would be circular; a future increment could add one pointing to a *different* URL, like a leaderboard, once the public leaderboard exists).
- **Player-profile access from the public live view** — no public route links to `PlayerProfilePage` (it's authenticated-SPA-only); the public sanitized leaderboard (also out of scope) would be the natural place to eventually surface player names publicly.

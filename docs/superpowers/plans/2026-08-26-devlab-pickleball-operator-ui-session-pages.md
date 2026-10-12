# Devlab Pickleball Operator UI — Session Pages Implementation Plan

> **Superseded (2026-10-12).** This describes the logged-in operator app, retired in 2.0.0 by Phase 5 of `docs/superpowers/specs/2026-10-11-pickleball-free-open-play-design.md`. Kept as history: the routes, tables and files it names no longer exist.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the four session-scoped operator pages this branch's foundation was built for: Check-in, Queue, Courts, and Games (list + start-a-game), all consuming the `SessionLayout`/`useSessionRealtime` foundation from Plan A.

**Architecture:** Each page is a route nested under `sessions/:sessionId` (registered in Plan A's `SessionLayout`), consuming `{ sessionId, session, status, snapshot, error }` via `useOutletContext()`. Reads come from `snapshot` where the underlying mutation broadcasts (queue join/leave, check-in, court assign/release, game start) and from a direct `pickleballApi.get()` call where it doesn't yet (court enable/disable — a known, previously-ruled gap from the realtime-infrastructure sub-project). All actions are REST calls through `pickleballApi`; the UI never manually merges an action's response into local state for anything that broadcasts — it lets the next `STATE` message update the view, exactly as Plan A's `SessionControlPage` already does for its counts.

**Tech Stack:** React 19, React Router v7, Tailwind, Playwright (`worker` project), the shared `loginAsOperator` e2e helper from Plan A's fix wave.

**Spec:** `docs/superpowers/specs/2026-08-26-devlab-pickleball-operator-ui-design.md` (this plan's authority), plus `docs/superpowers/specs/2026-08-24-devlab-pickleball-design.md` §11.

## Global Constraints

- Every page reads its live data from `useOutletContext().snapshot` (via `SessionLayout`), never a separate `pickleballApi.get()` poll for anything the DO already broadcasts. The one confirmed exception is court `enabled`/session `status` (not yet broadcasting, per the realtime sub-project's own final review — Plans B/C inherit this gap, not fix it here) — those two fields are fetched directly and refreshed manually after the action that changes them.
- Every mutating action uses `pickleballApi.post(...)`; on success, do NOT manually splice the response into local state for anything covered by `snapshot` — let the next broadcast update the view. On failure, show the error via each page's own `message` state (matching Plan A's established `{type, text}` pattern).
- Role-gated actions use `session.role` (already available via Plan A's `AppShell`/`session` prop chain — pass it down or read it via context as each page's brief specifies) to hide (not just disable) controls a role can't use, matching Plan A's established convention.
- Every new e2e test uses the shared `loginAsOperator(request, context, baseURL)` helper from `tests/e2e/pickleball/helpers.js` (built in Plan A's fix wave) — never a fresh inline cookie-bridging block.
- `--local` only for D1/wrangler. Never `--remote`. Terminate any manually-started `wrangler dev` before finishing a task.
- No placeholder pages/routes. Every route this plan registers is a real, working page.

## Pre-flight ruling

**Ruling: a small necessary backend addition is needed — `GET /api/pickleball/sessions/:id/courts/:sessionCourtId/teams`.** Starting a game (Task 4) requires the operator to pick a serving team and starting servers from the two teams currently assigned to a court, but no existing route exposes "which players are on court X's two teams" after the initial `assignCourt` response (which is the only place this shape is ever returned today). `SessionCoordinatorDO.startGame` already does the equivalent lookup inline (`SELECT id FROM teams WHERE session_court_id = ? AND session_id = ?`, then `getTeamWithMembers` per team) — Task 1 extracts that into a reusable repository function and a new read-only route, mirroring the realtime-infrastructure sub-project's `listScoringRulesets` gap-fill (same class of "small, necessary, additive" addition).

**Ruling: "replace a player on an assigned court" (`POST courts/replace`) is out of scope for this plan.** It's a real, already-built API endpoint, but it needs its own picker UI (outgoing seated player + incoming eligible player + a disposition choice) that's a meaningfully separate flow from the basic assign/release/enable/disable this plan's `CourtsPage` covers. Deferred as a follow-up, not silently dropped — noted here so it isn't mistaken for an oversight.

---

### Task 1: `listTeamsForCourt` repository function + route

**Files:**
- Modify: `src/worker/repositories/pickleball/teams.js` (add `listTeamsForCourt`)
- Create: `src/pages/api/pickleball/sessions/[id]/courts/[courtId]/teams.ts`
- Test: `tests/e2e/pickleball/pickleball-crud.spec.js` (append)

**Interfaces:**
- Produces: `listTeamsForCourt(db, sessionId, sessionCourtId): Promise<Array<{id, sessionId, sessionCourtId, kind, createdAt, members: Array<{sessionPlayerId, playerId, displayName}>}>>` — 0, 1, or 2 teams (0/1 for a not-currently-assigned or mid-transition court; 2 for a normally ASSIGNED/PLAYING court).
- Produces: `GET /api/pickleball/sessions/:id/courts/:courtId/teams` → `{ teams: [...] }`. Task 4 uses this to build the start-game form.

- [ ] **Step 1: Write the failing e2e test**

Append to `tests/e2e/pickleball/pickleball-crud.spec.js` (reuse this file's existing helper pattern for creating a session/venue/court/checked-in-and-queued players — read the file first for its exact existing helper functions and follow them, do not invent a new setup pattern):

```js
test('lists the two teams currently assigned to a court', async ({ request }) => {
  await request.post('/api/pickleball/auth/test-login', { data: { email: 'operator@example.com' } })
  const venueResponse = await request.post('/api/pickleball/venues', { data: { name: `Teams Route Venue ${Date.now()}` } })
  const venueId = (await venueResponse.json()).venue.id
  await request.post('/api/pickleball/courts', { data: { venueId, name: 'Court 1' } })

  const sessionResponse = await request.post('/api/pickleball/sessions', {
    data: {
      venueId, name: `Teams Route Session ${Date.now()}`, sessionType: 'OPEN_PLAY',
      scoringRulesetId: 'usap-2026-sideout-11-doubles',
      scheduledStart: '2026-09-01T18:00:00.000Z', scheduledEnd: '2026-09-01T22:00:00.000Z',
    },
  })
  const sessionId = (await sessionResponse.json()).session.id
  await request.post(`/api/pickleball/sessions/${sessionId}/status`, { data: { status: 'OPEN_FOR_CHECKIN' } })
  await request.post(`/api/pickleball/sessions/${sessionId}/status`, { data: { status: 'LIVE' } })
  const sessionCourtId = (await (await request.get(`/api/pickleball/sessions/${sessionId}/courts`)).json()).courts[0].id

  for (let i = 0; i < 4; i += 1) {
    const playerId = (await (await request.post('/api/pickleball/players', { data: { displayName: `Teams Route Player ${i}-${Date.now()}` } })).json()).player.id
    const sessionPlayerId = (await (await request.post(`/api/pickleball/sessions/${sessionId}/players`, { data: { playerId } })).json()).sessionPlayer.id
    await request.post(`/api/pickleball/sessions/${sessionId}/players/check-in`, { data: { playerId } })
    await request.post(`/api/pickleball/sessions/${sessionId}/queue`, { data: { sessionPlayerId } })
  }
  await request.post(`/api/pickleball/sessions/${sessionId}/courts/assign`, { data: { sessionCourtId } })

  const response = await request.get(`/api/pickleball/sessions/${sessionId}/courts/${sessionCourtId}/teams`)
  expect(response.ok()).toBe(true)
  const body = await response.json()
  expect(body.teams).toHaveLength(2)
  expect(body.teams[0].members).toHaveLength(2)
  expect(body.teams[1].members).toHaveLength(2)
})
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `npx playwright test tests/e2e/pickleball/pickleball-crud.spec.js --project=worker -g "lists the two teams"`
Expected: FAIL — route doesn't exist (404).

- [ ] **Step 3: Add the repository function**

In `src/worker/repositories/pickleball/teams.js`, add right after `getTeamWithMembers`:

```js
// Both teams currently bound to a court, each with its full member roster —
// the same lookup startGame's inline SQL already does (SessionCoordinatorDO.ts),
// extracted here so a read-only route can serve it without duplicating the
// query. Returns 0, 1, or 2 teams depending on the court's actual state; a
// normally ASSIGNED/PLAYING court has exactly 2.
export async function listTeamsForCourt(db, sessionId, sessionCourtId) {
  const result = await db
    .prepare(`SELECT id FROM teams WHERE session_court_id = ? AND session_id = ?`)
    .bind(sessionCourtId, sessionId)
    .all()
  const teamIds = (result.results || []).map((row) => row.id)
  const teams = await Promise.all(teamIds.map((id) => getTeamWithMembers(db, id)))
  return teams.filter(Boolean)
}
```

- [ ] **Step 4: Add the route**

`src/pages/api/pickleball/sessions/[id]/courts/[courtId]/teams.ts` (new file):

```ts
import type { APIRoute } from 'astro'
import { requirePickleballSession } from '../../../../../../../worker/pickleball/authContext.js'
import { getSession } from '../../../../../../../worker/repositories/pickleball/sessions.js'
import { listTeamsForCourt } from '../../../../../../../worker/repositories/pickleball/teams.js'
import { jsonResponse } from '../../../../../../../worker/utils/responses.js'
import { getEnv } from '../../../../../../../lib/env'

export const GET: APIRoute = async ({ request, params }) => {
  const env = getEnv()
  try {
    const session = await requirePickleballSession(request, env)
    const sessionId = params.id as string
    const pickleballSession = await getSession(env.PICKLEBALL_DB, sessionId, session.activeOrgId)
    if (!pickleballSession) return jsonResponse({ error: 'Not found.' }, 404)

    const teams = await listTeamsForCourt(env.PICKLEBALL_DB, sessionId, params.courtId as string)
    return jsonResponse({ teams }, 200)
  } catch (error: any) {
    return jsonResponse({ error: error.message }, error.status || 500)
  }
}
```

- [ ] **Step 5: Run the test, confirm it passes**

Run: `npx playwright test tests/e2e/pickleball/pickleball-crud.spec.js --project=worker -g "lists the two teams"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/worker/repositories/pickleball/teams.js src/pages/api/pickleball/sessions/\[id\]/courts/\[courtId\]/teams.ts tests/e2e/pickleball/pickleball-crud.spec.js
git commit -m "feat: add a route to list the two teams currently assigned to a court"
```

---

### Task 2: `CheckInPage`

**Files:**
- Create: `src/pickleball-app/pages/CheckInPage.jsx`
- Modify: `src/pickleball-app/components/SessionLayout.jsx` (register `check-in` as a child route — read the current file, the `children` array already has `SUB_NAV` entries pointing at `check-in`/`queue`/`courts`/`games`, but only `index` is registered as an actual route; add this task's route the same way Plan A registered `index`)
- Modify: `src/pickleball-app/PickleballApp.jsx` (add the nested route)
- Test: `tests/e2e/pickleball/pickleball-operator-ui.spec.js` (append)

**Interfaces:**
- Consumes: `useOutletContext()` → `{ sessionId, session, snapshot }`; `GET /api/pickleball/sessions/:id/players` → `{players, counts}` (each player: `{id, sessionId, playerId, displayName, registrationStatus, attendanceStatus, availabilityStatus, checkedInAt, gamesPlayed, registeredAt, createdAt, updatedAt}`); `GET /api/pickleball/players` → `{players}` (org-wide roster, for the "register a player" picker — each: `{id, organizationId, displayName, normalizedName, linkedUserId, active, publicVisible, createdAt}`); `POST .../players` (register, body `{playerId}`); `POST .../players/check-in` (body `{playerId}`); `POST .../players/check-in-bulk` (body `{playerIds}`); `POST .../players/availability` (body `{playerId, status}`, status is `'AVAILABLE'|'TEMPORARILY_UNAVAILABLE'|'RESTING'`); `POST .../players/cancel` (body `{playerId}`); `POST .../players/leave` (body `{playerId}`).

- [ ] **Step 1: Write the page**

`src/pickleball-app/pages/CheckInPage.jsx` (new file):

```jsx
import { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { pickleballApi } from '../lib/pickleballApi'

const AVAILABILITY_LABELS = { AVAILABLE: 'Available', TEMPORARILY_UNAVAILABLE: 'Unavailable', RESTING: 'Resting' }

export default function CheckInPage() {
  const { sessionId } = useOutletContext()
  const [sessionPlayers, setSessionPlayers] = useState([])
  const [counts, setCounts] = useState(null)
  const [orgPlayers, setOrgPlayers] = useState([])
  const [status, setStatus] = useState('loading')
  const [message, setMessage] = useState(null)
  const [selectedNewPlayerId, setSelectedNewPlayerId] = useState('')

  async function reload() {
    const [sessionData, orgData] = await Promise.all([
      pickleballApi.get(`/api/pickleball/sessions/${sessionId}/players`),
      pickleballApi.get('/api/pickleball/players'),
    ])
    setSessionPlayers(sessionData.players)
    setCounts(sessionData.counts)
    setOrgPlayers(orgData.players)
    setStatus('ready')
  }

  useEffect(() => {
    let ignore = false
    reload().catch(() => !ignore && setStatus('error'))
    return () => {
      ignore = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  const registeredPlayerIds = new Set(sessionPlayers.map((p) => p.playerId))
  const registerableOrgPlayers = orgPlayers.filter((p) => p.active && !registeredPlayerIds.has(p.id))

  async function runAction(actionPromise) {
    setMessage(null)
    try {
      await actionPromise
      await reload()
    } catch (error) {
      setMessage({ type: 'error', text: error.message })
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Check-in</h1>
        {counts ? (
          <p className="text-sm text-slate-500" data-testid="attendance-counts">
            {counts.checkedIn} checked in / {counts.registered} registered
          </p>
        ) : null}
      </div>

      {status === 'loading' ? <p className="text-sm text-slate-500">Loading…</p> : null}
      {status === 'error' ? <p className="text-sm text-rose-600">Could not load check-in data.</p> : null}
      {message ? <p className="text-sm text-rose-600">{message.text}</p> : null}

      <div className="flex gap-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <select
          value={selectedNewPlayerId}
          onChange={(event) => setSelectedNewPlayerId(event.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          data-testid="register-player-select"
        >
          <option value="">Register a player…</option>
          {registerableOrgPlayers.map((p) => (
            <option key={p.id} value={p.id}>{p.displayName}</option>
          ))}
        </select>
        <button
          type="button"
          disabled={!selectedNewPlayerId}
          onClick={() => runAction(pickleballApi.post(`/api/pickleball/sessions/${sessionId}/players`, { playerId: selectedNewPlayerId })).then(() => setSelectedNewPlayerId(''))}
          className="shrink-0 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:brightness-95 disabled:opacity-50"
        >
          Register
        </button>
      </div>

      <div className="space-y-2" data-testid="checkin-list">
        {sessionPlayers.map((player) => (
          <div key={player.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm">
            <span className="min-w-[10rem] font-semibold text-slate-900">{player.displayName}</span>
            <span className="text-slate-500">{player.attendanceStatus}</span>
            {player.attendanceStatus === 'CHECKED_IN' ? (
              <span className="text-slate-500">{AVAILABILITY_LABELS[player.availabilityStatus] || player.availabilityStatus}</span>
            ) : null}
            <div className="ml-auto flex gap-2">
              {player.attendanceStatus === 'NOT_CHECKED_IN' ? (
                <>
                  <button type="button" onClick={() => runAction(pickleballApi.post(`/api/pickleball/sessions/${sessionId}/players/check-in`, { playerId: player.playerId }))} className="rounded border border-slate-300 px-3 py-1 text-xs font-semibold hover:bg-slate-50">
                    Check in
                  </button>
                  <button type="button" onClick={() => runAction(pickleballApi.post(`/api/pickleball/sessions/${sessionId}/players/cancel`, { playerId: player.playerId }))} className="rounded border border-rose-300 px-3 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50">
                    Cancel
                  </button>
                </>
              ) : null}
              {player.attendanceStatus === 'CHECKED_IN' ? (
                <>
                  {player.availabilityStatus !== 'AVAILABLE' ? (
                    <button type="button" onClick={() => runAction(pickleballApi.post(`/api/pickleball/sessions/${sessionId}/players/availability`, { playerId: player.playerId, status: 'AVAILABLE' }))} className="rounded border border-slate-300 px-3 py-1 text-xs font-semibold hover:bg-slate-50">
                      Set available
                    </button>
                  ) : (
                    <button type="button" onClick={() => runAction(pickleballApi.post(`/api/pickleball/sessions/${sessionId}/players/availability`, { playerId: player.playerId, status: 'TEMPORARILY_UNAVAILABLE' }))} className="rounded border border-slate-300 px-3 py-1 text-xs font-semibold hover:bg-slate-50">
                      Set unavailable
                    </button>
                  )}
                  <button type="button" onClick={() => runAction(pickleballApi.post(`/api/pickleball/sessions/${sessionId}/players/leave`, { playerId: player.playerId }))} className="rounded border border-rose-300 px-3 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50">
                    Leave
                  </button>
                </>
              ) : null}
            </div>
          </div>
        ))}
        {!sessionPlayers.length && status === 'ready' ? <p className="text-sm text-slate-500">No players registered yet.</p> : null}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Register the route**

In `SessionLayout.jsx`, add `check-in` to the nested `children` array Plan A registered for `sessions/:sessionId` in `PickleballApp.jsx` (NOT inside `SessionLayout.jsx` itself — `SessionLayout` is the layout component, the route TREE is registered in `PickleballApp.jsx`'s `buildRouter`). Read `PickleballApp.jsx`'s current `sessions/:sessionId` route entry first, then add:

```jsx
import CheckInPage from './pages/CheckInPage'
```

and add `{ path: 'check-in', element: <CheckInPage /> }` to that route's `children` array, alongside the existing `{ index: true, element: <SessionControlPage /> }`.

- [ ] **Step 3: Write the e2e test**

Append to `tests/e2e/pickleball/pickleball-operator-ui.spec.js`, importing and using `loginAsOperator` from `./helpers.js` (read the file's existing import line for the exact relative path already in use):

```js
test('checks in a registered player through the Check-in page', async ({ page, request, context }) => {
  const baseURL = test.info().project.use.baseURL
  await loginAsOperator(request, context, baseURL)

  const venueResponse = await request.post('/api/pickleball/venues', { data: { name: `Checkin UI Venue ${Date.now()}` } })
  const venueId = (await venueResponse.json()).venue.id
  const sessionResponse = await request.post('/api/pickleball/sessions', {
    data: {
      venueId, name: `Checkin UI Session ${Date.now()}`, sessionType: 'OPEN_PLAY',
      scoringRulesetId: 'usap-2026-sideout-11-doubles',
      scheduledStart: '2026-09-01T18:00:00.000Z', scheduledEnd: '2026-09-01T22:00:00.000Z',
    },
  })
  const sessionId = (await sessionResponse.json()).session.id
  const playerName = `Checkin UI Player ${Date.now()}`
  const playerId = (await (await request.post('/api/pickleball/players', { data: { displayName: playerName } })).json()).player.id
  await request.post(`/api/pickleball/sessions/${sessionId}/players`, { data: { playerId } })

  await page.goto(`/pickleball/app/sessions/${sessionId}/check-in`)
  await expect(page.getByTestId('checkin-list').getByText(playerName)).toBeVisible()
  await expect(page.getByTestId('checkin-list').getByText('NOT_CHECKED_IN')).toBeVisible()

  await page.getByRole('button', { name: 'Check in' }).click()
  await expect(page.getByTestId('checkin-list').getByText('CHECKED_IN')).toBeVisible({ timeout: 10000 })
})
```

- [ ] **Step 4: Run the test, confirm it passes**

Run: `npx playwright test tests/e2e/pickleball/pickleball-operator-ui.spec.js --project=worker`
Expected: PASS, all tests including this new one.

- [ ] **Step 5: Commit**

```bash
git add src/pickleball-app/pages/CheckInPage.jsx src/pickleball-app/PickleballApp.jsx tests/e2e/pickleball/pickleball-operator-ui.spec.js
git commit -m "feat: add the Check-in page"
```

---

### Task 3: `QueuePage`

**Files:**
- Create: `src/pickleball-app/pages/QueuePage.jsx`
- Modify: `src/pickleball-app/PickleballApp.jsx` (register the route)
- Test: `tests/e2e/pickleball/pickleball-operator-ui.spec.js` (append)

**Interfaces:**
- Consumes: `useOutletContext()` → `{ sessionId, snapshot }`. `snapshot.queue` (from the WS broadcast — an array of `{id, sessionId, sessionPlayerId, playerId, displayName, gamesPlayed, status, queuedAt, assignedAt}`, no `reasons` field — the REST-only `GET queue` route adds `reasons` via a live fairness computation the snapshot doesn't carry; this page is a good candidate for a REST-fetched `reasons` overlay, but per this plan's Global Constraint about using `snapshot` where broadcasting already covers it, keep this simple: render from `snapshot.queue` directly without `reasons` for now — a `reasons` overlay is a legitimate future enhancement, not required for this task). `POST .../queue` (body `{sessionPlayerId}`) to join; `POST .../queue/leave` (body `{sessionPlayerId}`) to leave.

- [ ] **Step 1: Write the page**

`src/pickleball-app/pages/QueuePage.jsx` (new file):

```jsx
import { useOutletContext } from 'react-router-dom'
import { useState } from 'react'
import { pickleballApi } from '../lib/pickleballApi'

export default function QueuePage() {
  const { sessionId, snapshot } = useOutletContext()
  const [message, setMessage] = useState(null)

  async function handleLeave(sessionPlayerId) {
    setMessage(null)
    try {
      await pickleballApi.post(`/api/pickleball/sessions/${sessionId}/queue/leave`, { sessionPlayerId })
    } catch (error) {
      setMessage({ type: 'error', text: error.message })
    }
  }

  if (!snapshot) return <p className="text-sm text-slate-500">Loading…</p>

  const queued = snapshot.queue.filter((entry) => entry.status === 'QUEUED')
  const assigned = snapshot.queue.filter((entry) => entry.status !== 'QUEUED')

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900">Queue</h1>
      {message ? <p className="text-sm text-rose-600">{message.text}</p> : null}

      <div>
        <h2 className="mb-2 text-sm font-semibold uppercase text-slate-500">Waiting ({queued.length})</h2>
        <div className="space-y-2" data-testid="queue-waiting-list">
          {queued.map((entry) => (
            <div key={entry.id} className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm">
              <span>{entry.displayName} <span className="text-slate-400">({entry.gamesPlayed} played)</span></span>
              <button type="button" onClick={() => handleLeave(entry.sessionPlayerId)} className="rounded border border-rose-300 px-3 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50">
                Leave queue
              </button>
            </div>
          ))}
          {!queued.length ? <p className="text-sm text-slate-500">Nobody waiting.</p> : null}
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold uppercase text-slate-500">On courts ({assigned.length})</h2>
        <div className="space-y-2" data-testid="queue-assigned-list">
          {assigned.map((entry) => (
            <div key={entry.id} className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
              {entry.displayName} — {entry.status}
            </div>
          ))}
          {!assigned.length ? <p className="text-sm text-slate-500">Nobody currently assigned.</p> : null}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Register the route**

In `PickleballApp.jsx`: import `QueuePage`, add `{ path: 'queue', element: <QueuePage /> }` to the `sessions/:sessionId` route's `children`.

- [ ] **Step 3: Write the e2e test**

Append to `tests/e2e/pickleball/pickleball-operator-ui.spec.js`, following Task 2's `loginAsOperator` pattern:

```js
test('a queued player appears on the Queue page and can leave the queue', async ({ page, request, context }) => {
  const baseURL = test.info().project.use.baseURL
  await loginAsOperator(request, context, baseURL)

  const venueResponse = await request.post('/api/pickleball/venues', { data: { name: `Queue UI Venue ${Date.now()}` } })
  const venueId = (await venueResponse.json()).venue.id
  const sessionResponse = await request.post('/api/pickleball/sessions', {
    data: {
      venueId, name: `Queue UI Session ${Date.now()}`, sessionType: 'OPEN_PLAY',
      scoringRulesetId: 'usap-2026-sideout-11-doubles',
      scheduledStart: '2026-09-01T18:00:00.000Z', scheduledEnd: '2026-09-01T22:00:00.000Z',
    },
  })
  const sessionId = (await sessionResponse.json()).session.id
  const playerName = `Queue UI Player ${Date.now()}`
  const playerId = (await (await request.post('/api/pickleball/players', { data: { displayName: playerName } })).json()).player.id
  const sessionPlayerId = (await (await request.post(`/api/pickleball/sessions/${sessionId}/players`, { data: { playerId } })).json()).sessionPlayer.id
  await request.post(`/api/pickleball/sessions/${sessionId}/players/check-in`, { data: { playerId } })

  await page.goto(`/pickleball/app/sessions/${sessionId}/queue`)
  await expect(page.getByTestId('queue-waiting-list').getByText('Nobody waiting.')).toBeVisible()

  await request.post(`/api/pickleball/sessions/${sessionId}/queue`, { data: { sessionPlayerId } })
  await expect(page.getByTestId('queue-waiting-list').getByText(playerName)).toBeVisible({ timeout: 10000 })

  await page.getByRole('button', { name: 'Leave queue' }).click()
  await expect(page.getByTestId('queue-waiting-list').getByText('Nobody waiting.')).toBeVisible({ timeout: 10000 })
})
```

- [ ] **Step 4: Run the test, confirm it passes**

Run: `npx playwright test tests/e2e/pickleball/pickleball-operator-ui.spec.js --project=worker`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pickleball-app/pages/QueuePage.jsx src/pickleball-app/PickleballApp.jsx tests/e2e/pickleball/pickleball-operator-ui.spec.js
git commit -m "feat: add the Queue page"
```

---

### Task 4: `CourtsPage`

**Files:**
- Create: `src/pickleball-app/pages/CourtsPage.jsx`
- Modify: `src/pickleball-app/PickleballApp.jsx` (register the route)
- Test: `tests/e2e/pickleball/pickleball-operator-ui.spec.js` (append)

**Interfaces:**
- Consumes: `useOutletContext()` → `{ sessionId, snapshot }` for `status`/`currentGameId` (broadcasting). `GET /api/pickleball/sessions/:id/courts` → `{courts}` (including `enabled` — fetched directly on mount and re-fetched after every enable/disable action, since that field doesn't broadcast, per this plan's Global Constraints). `POST .../courts/assign` (body `{sessionCourtId}`); `POST .../courts/release` (body `{sessionCourtId}`); `POST .../courts/enable` / `.../courts/disable` (body `{sessionCourtId}`, both return `{court}`).

- [ ] **Step 1: Write the page**

`src/pickleball-app/pages/CourtsPage.jsx` (new file):

```jsx
import { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { pickleballApi } from '../lib/pickleballApi'

export default function CourtsPage() {
  const { sessionId, snapshot } = useOutletContext()
  const [enabledByCourtId, setEnabledByCourtId] = useState({})
  const [message, setMessage] = useState(null)

  async function loadEnabledFlags() {
    const { courts } = await pickleballApi.get(`/api/pickleball/sessions/${sessionId}/courts`)
    setEnabledByCourtId(Object.fromEntries(courts.map((c) => [c.id, c.enabled])))
  }

  useEffect(() => {
    let ignore = false
    loadEnabledFlags().catch(() => {})
    return () => {
      ignore = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  async function runAction(actionPromise, { refreshEnabled } = {}) {
    setMessage(null)
    try {
      await actionPromise
      if (refreshEnabled) await loadEnabledFlags()
    } catch (error) {
      setMessage({ type: 'error', text: error.message })
    }
  }

  if (!snapshot) return <p className="text-sm text-slate-500">Loading…</p>

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900">Courts</h1>
      {message ? <p className="text-sm text-rose-600">{message.text}</p> : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="courts-grid">
        {snapshot.courts.map((court) => {
          const enabled = enabledByCourtId[court.id]
          return (
            <div key={court.id} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-900">{court.courtName}</span>
                <span className="text-xs text-slate-500">{court.status}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {court.status === 'AVAILABLE' ? (
                  <button type="button" onClick={() => runAction(pickleballApi.post(`/api/pickleball/sessions/${sessionId}/courts/assign`, { sessionCourtId: court.id }))} className="rounded bg-brand px-3 py-1 text-xs font-semibold text-white hover:brightness-95">
                    Assign
                  </button>
                ) : null}
                {court.status === 'ASSIGNED' ? (
                  <button type="button" onClick={() => runAction(pickleballApi.post(`/api/pickleball/sessions/${sessionId}/courts/release`, { sessionCourtId: court.id }))} className="rounded border border-slate-300 px-3 py-1 text-xs font-semibold hover:bg-slate-50">
                    Release
                  </button>
                ) : null}
                {enabled === false ? (
                  <button type="button" onClick={() => runAction(pickleballApi.post(`/api/pickleball/sessions/${sessionId}/courts/enable`, { sessionCourtId: court.id }), { refreshEnabled: true })} className="rounded border border-slate-300 px-3 py-1 text-xs font-semibold hover:bg-slate-50">
                    Enable
                  </button>
                ) : (
                  <button type="button" onClick={() => runAction(pickleballApi.post(`/api/pickleball/sessions/${sessionId}/courts/disable`, { sessionCourtId: court.id }), { refreshEnabled: true })} className="rounded border border-slate-300 px-3 py-1 text-xs font-semibold hover:bg-slate-50">
                    Disable
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Register the route**

In `PickleballApp.jsx`: import `CourtsPage`, add `{ path: 'courts', element: <CourtsPage /> }` to `sessions/:sessionId`'s `children`.

- [ ] **Step 3: Write the e2e test**

Append to `tests/e2e/pickleball/pickleball-operator-ui.spec.js`, following the established pattern — this test needs 4 checked-in-and-queued players (matching the setup shape already used in Plan A's `SessionControlPage` broadcast test and the realtime plan's own broadcast test — read one of those for the exact setup sequence) so `assign` has enough eligible players:

```js
test('assigns and releases a court through the Courts page', async ({ page, request, context }) => {
  const baseURL = test.info().project.use.baseURL
  await loginAsOperator(request, context, baseURL)

  const venueResponse = await request.post('/api/pickleball/venues', { data: { name: `Courts UI Venue ${Date.now()}` } })
  const venueId = (await venueResponse.json()).venue.id
  await request.post('/api/pickleball/courts', { data: { venueId, name: 'Court 1' } })
  const sessionResponse = await request.post('/api/pickleball/sessions', {
    data: {
      venueId, name: `Courts UI Session ${Date.now()}`, sessionType: 'OPEN_PLAY',
      scoringRulesetId: 'usap-2026-sideout-11-doubles',
      scheduledStart: '2026-09-01T18:00:00.000Z', scheduledEnd: '2026-09-01T22:00:00.000Z',
    },
  })
  const sessionId = (await sessionResponse.json()).session.id
  await request.post(`/api/pickleball/sessions/${sessionId}/status`, { data: { status: 'OPEN_FOR_CHECKIN' } })
  await request.post(`/api/pickleball/sessions/${sessionId}/status`, { data: { status: 'LIVE' } })

  for (let i = 0; i < 4; i += 1) {
    const playerId = (await (await request.post('/api/pickleball/players', { data: { displayName: `Courts UI Player ${i}-${Date.now()}` } })).json()).player.id
    const sessionPlayerId = (await (await request.post(`/api/pickleball/sessions/${sessionId}/players`, { data: { playerId } })).json()).sessionPlayer.id
    await request.post(`/api/pickleball/sessions/${sessionId}/players/check-in`, { data: { playerId } })
    await request.post(`/api/pickleball/sessions/${sessionId}/queue`, { data: { sessionPlayerId } })
  }

  await page.goto(`/pickleball/app/sessions/${sessionId}/courts`)
  await expect(page.getByTestId('courts-grid').getByText('AVAILABLE')).toBeVisible()

  await page.getByRole('button', { name: 'Assign' }).click()
  await expect(page.getByTestId('courts-grid').getByText('ASSIGNED')).toBeVisible({ timeout: 10000 })

  await page.getByRole('button', { name: 'Release' }).click()
  await expect(page.getByTestId('courts-grid').getByText('AVAILABLE')).toBeVisible({ timeout: 10000 })
})
```

- [ ] **Step 4: Run the test, confirm it passes**

Run: `npx playwright test tests/e2e/pickleball/pickleball-operator-ui.spec.js --project=worker`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pickleball-app/pages/CourtsPage.jsx src/pickleball-app/PickleballApp.jsx tests/e2e/pickleball/pickleball-operator-ui.spec.js
git commit -m "feat: add the Courts page"
```

---

### Task 5: `GamesListPage` (list + start-a-game)

**Files:**
- Create: `src/pickleball-app/pages/GamesListPage.jsx`
- Modify: `src/pickleball-app/PickleballApp.jsx` (register the route)
- Test: `tests/e2e/pickleball/pickleball-operator-ui.spec.js` (append)

**Interfaces:**
- Consumes: `useOutletContext()` → `{ sessionId, snapshot }` for `snapshot.games` (broadcasting — each: `{id, sessionId, sessionCourtId, scoringRulesetId, format, status, teamAId, teamBId, revision, scoreA, scoreB, servingTeam, serverNumber, ..., winningTeamId, finalScoreA, finalScoreB, startedAt, finishedAt, ...}`) and `snapshot.courts` (to find ASSIGNED courts eligible to start a game on). `GET /api/pickleball/sessions/:id/courts/:courtId/teams` (Task 1) → `{teams: [{id, kind, members: [{sessionPlayerId, playerId, displayName}]}, ...]}` for the start-game form. `POST .../games/start` (body `{sessionCourtId, servingTeam, teamAStartingServerSessionPlayerId, teamBStartingServerSessionPlayerId}`).

- [ ] **Step 1: Write the page**

`src/pickleball-app/pages/GamesListPage.jsx` (new file):

```jsx
import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { pickleballApi } from '../lib/pickleballApi'

function StartGameForm({ sessionId, court, onStarted }) {
  const [teams, setTeams] = useState(null)
  const [servingTeam, setServingTeam] = useState('A')
  const [teamAServerId, setTeamAServerId] = useState('')
  const [teamBServerId, setTeamBServerId] = useState('')
  const [message, setMessage] = useState(null)

  async function loadTeams() {
    const data = await pickleballApi.get(`/api/pickleball/sessions/${sessionId}/courts/${court.id}/teams`)
    setTeams(data.teams)
  }

  if (teams === null) {
    loadTeams().catch(() => setMessage({ type: 'error', text: 'Could not load this court\'s teams.' }))
    return <p className="text-sm text-slate-500">Loading teams…</p>
  }

  const [teamA, teamB] = teams

  async function handleStart() {
    setMessage(null)
    try {
      await pickleballApi.post(`/api/pickleball/sessions/${sessionId}/games/start`, {
        sessionCourtId: court.id,
        servingTeam,
        teamAStartingServerSessionPlayerId: teamAServerId,
        teamBStartingServerSessionPlayerId: teamBServerId,
      })
      onStarted()
    } catch (error) {
      setMessage({ type: 'error', text: error.message })
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm" data-testid={`start-game-form-${court.id}`}>
      <p className="font-semibold text-slate-900">Start a game on {court.courtName}</p>
      {message ? <p className="text-sm text-rose-600">{message.text}</p> : null}
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-slate-700">Serving team</span>
        <select value={servingTeam} onChange={(event) => setServingTeam(event.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
          <option value="A">Team A</option>
          <option value="B">Team B</option>
        </select>
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-slate-700">Team A starting server</span>
        <select value={teamAServerId} onChange={(event) => setTeamAServerId(event.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" data-testid="team-a-server-select">
          <option value="">Select…</option>
          {(teamA?.members || []).map((m) => (
            <option key={m.sessionPlayerId} value={m.sessionPlayerId}>{m.displayName}</option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-slate-700">Team B starting server</span>
        <select value={teamBServerId} onChange={(event) => setTeamBServerId(event.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" data-testid="team-b-server-select">
          <option value="">Select…</option>
          {(teamB?.members || []).map((m) => (
            <option key={m.sessionPlayerId} value={m.sessionPlayerId}>{m.displayName}</option>
          ))}
        </select>
      </label>
      <button
        type="button"
        disabled={!teamAServerId || !teamBServerId}
        onClick={handleStart}
        className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:brightness-95 disabled:opacity-50"
      >
        Start game
      </button>
    </div>
  )
}

export default function GamesListPage() {
  const { sessionId, snapshot } = useOutletContext()
  const [startingCourtId, setStartingCourtId] = useState(null)

  if (!snapshot) return <p className="text-sm text-slate-500">Loading…</p>

  const assignedCourtsWithoutGame = snapshot.courts.filter((c) => c.status === 'ASSIGNED')

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900">Games</h1>

      {assignedCourtsWithoutGame.length ? (
        <div>
          <h2 className="mb-2 text-sm font-semibold uppercase text-slate-500">Ready to start</h2>
          <div className="space-y-2">
            {assignedCourtsWithoutGame.map((court) =>
              startingCourtId === court.id ? (
                <StartGameForm key={court.id} sessionId={sessionId} court={court} onStarted={() => setStartingCourtId(null)} />
              ) : (
                <button
                  key={court.id}
                  type="button"
                  onClick={() => setStartingCourtId(court.id)}
                  className="block w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-left text-sm hover:border-slate-300"
                >
                  {court.courtName} — assigned, no game started
                </button>
              ),
            )}
          </div>
        </div>
      ) : null}

      <div>
        <h2 className="mb-2 text-sm font-semibold uppercase text-slate-500">Games</h2>
        <div className="space-y-2" data-testid="games-list">
          {snapshot.games.map((game) => (
            <div key={game.id} className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm">
              <span>{game.scoreA} – {game.scoreB}</span>
              <span className="text-slate-500">{game.status}</span>
            </div>
          ))}
          {!snapshot.games.length ? <p className="text-sm text-slate-500">No games yet.</p> : null}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Register the route**

In `PickleballApp.jsx`: import `GamesListPage`, add `{ path: 'games', element: <GamesListPage /> }` to `sessions/:sessionId`'s `children`.

- [ ] **Step 3: Write the e2e test**

Append to `tests/e2e/pickleball/pickleball-operator-ui.spec.js`:

```js
test('starts a game through the Games page and it appears in the games list', async ({ page, request, context }) => {
  const baseURL = test.info().project.use.baseURL
  await loginAsOperator(request, context, baseURL)

  const venueResponse = await request.post('/api/pickleball/venues', { data: { name: `Games UI Venue ${Date.now()}` } })
  const venueId = (await venueResponse.json()).venue.id
  await request.post('/api/pickleball/courts', { data: { venueId, name: 'Court 1' } })
  const sessionResponse = await request.post('/api/pickleball/sessions', {
    data: {
      venueId, name: `Games UI Session ${Date.now()}`, sessionType: 'OPEN_PLAY',
      scoringRulesetId: 'usap-2026-sideout-11-doubles',
      scheduledStart: '2026-09-01T18:00:00.000Z', scheduledEnd: '2026-09-01T22:00:00.000Z',
    },
  })
  const sessionId = (await sessionResponse.json()).session.id
  await request.post(`/api/pickleball/sessions/${sessionId}/status`, { data: { status: 'OPEN_FOR_CHECKIN' } })
  await request.post(`/api/pickleball/sessions/${sessionId}/status`, { data: { status: 'LIVE' } })
  const sessionCourtId = (await (await request.get(`/api/pickleball/sessions/${sessionId}/courts`)).json()).courts[0].id

  for (let i = 0; i < 4; i += 1) {
    const playerId = (await (await request.post('/api/pickleball/players', { data: { displayName: `Games UI Player ${i}-${Date.now()}` } })).json()).player.id
    const sessionPlayerId = (await (await request.post(`/api/pickleball/sessions/${sessionId}/players`, { data: { playerId } })).json()).sessionPlayer.id
    await request.post(`/api/pickleball/sessions/${sessionId}/players/check-in`, { data: { playerId } })
    await request.post(`/api/pickleball/sessions/${sessionId}/queue`, { data: { sessionPlayerId } })
  }
  await request.post(`/api/pickleball/sessions/${sessionId}/courts/assign`, { data: { sessionCourtId } })

  await page.goto(`/pickleball/app/sessions/${sessionId}/games`)
  await expect(page.getByText('Court 1 — assigned, no game started')).toBeVisible()
  await page.getByText('Court 1 — assigned, no game started').click()

  await expect(page.getByTestId('team-a-server-select')).toBeVisible()
  await page.getByTestId('team-a-server-select').selectOption({ index: 1 })
  await page.getByTestId('team-b-server-select').selectOption({ index: 1 })
  await page.getByRole('button', { name: 'Start game' }).click()

  await expect(page.getByTestId('games-list').getByText('IN_PROGRESS')).toBeVisible({ timeout: 10000 })
  await expect(page.getByTestId('games-list').getByText('0 – 0')).toBeVisible()
})
```

- [ ] **Step 4: Run the test, confirm it passes**

Run: `npx playwright test tests/e2e/pickleball/pickleball-operator-ui.spec.js --project=worker`
Expected: PASS, all tests.

- [ ] **Step 5: Run this plan's full e2e coverage plus a light regression check**

Run: `npx playwright test tests/e2e/pickleball/pickleball-operator-ui.spec.js tests/e2e/pickleball/pickleball-crud.spec.js --project=worker`
Expected: PASS, no regressions. (Individually/in this small group — per this plan's inherited local-harness caveat, do not run the entire `tests/e2e/pickleball` directory in one invocation.)

- [ ] **Step 6: Commit**

```bash
git add src/pickleball-app/pages/GamesListPage.jsx src/pickleball-app/PickleballApp.jsx tests/e2e/pickleball/pickleball-operator-ui.spec.js
git commit -m "feat: add the Games list page with a start-game form"
```

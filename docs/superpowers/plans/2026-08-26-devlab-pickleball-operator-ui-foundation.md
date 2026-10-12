# Devlab Pickleball Operator UI — Foundation Implementation Plan

> **Superseded (2026-10-12).** This describes the logged-in operator app, retired in 2.0.0 by Phase 5 of `docs/superpowers/specs/2026-10-11-pickleball-free-open-play-design.md`. Kept as history: the routes, tables and files it names no longer exist.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the foundation every later operator-UI plan depends on: the API client, the WebSocket realtime hook, the session-scoped layout route, and the three simplest real pages (Players, Venues, Sessions list/create, and a session's overview page) — establishing this codebase's first-ever UI-level Playwright e2e pattern along the way.

**Architecture:** Extends `src/pickleball-app/` (currently a login page + stub dashboard) following `src/admin-app/`'s established conventions exactly: `createBrowserRouter` with nested `<Outlet/>` layout routes, a thin `fetch`-based API client, Tailwind utility classes, no state-management library. One new piece: a `useSessionRealtime` hook opening the operator WebSocket channel (built in the prior, merged realtime-infrastructure sub-project) and sharing its state with nested routes via React Router's built-in `useOutletContext()`.

**Tech Stack:** React 19, React Router v7 (`createBrowserRouter`), Tailwind, native browser `WebSocket`, Vitest (pure logic only), Playwright (`worker` project, real Chromium against `wrangler dev --local`).

**Spec:** `docs/superpowers/specs/2026-08-26-devlab-pickleball-operator-ui-design.md` (this plan's authority), plus `docs/superpowers/specs/2026-08-24-devlab-pickleball-design.md` §11 (route list) and `docs/superpowers/specs/2026-08-25-devlab-pickleball-realtime-design.md` (the WebSocket layer this plan consumes).

## Global Constraints

- Mirror `src/admin-app/`'s conventions exactly where they apply: `adminApi.js`'s `request()` shape (fetch + `credentials: 'include'` + JSON auto-detect + `Error` with `.status`/`.issues` on failure), `AdminApp.jsx`'s `buildRouter(...)` factory pattern, `AdminShell.jsx`'s `<Outlet/>`-based layout routing. Do NOT reuse `SchemaForm`/`PER_ITEM_REGISTRY` (CMS-content-type machinery, wrong fit for pickleball's fixed, simple field sets) — write plain, purpose-built forms instead, matching `PerItemCollectionPage.jsx`'s list/select/edit/save *structure* (status state machine: `'loading' | 'ready' | 'error'`; a `message: {type, text}` feedback pattern) without its generic field-descriptor system.
- Every API call goes through the new `pickleballApi` client, never a raw `fetch()` in a page component.
- `session.role` (from `GET /api/pickleball/auth/session`, already fetched in `PickleballApp.jsx`) is the source of truth for role-gating anywhere this plan needs it — no new auth state.
- No placeholder pages. Every route this plan registers renders a real, working page — never a stub "coming soon" component.
- `--local` only for D1/wrangler in every test and dev command. Never `--remote`.
- If `wrangler dev` is started manually for any task, terminate all wrangler/workerd/esbuild processes before finishing that task.
- Playwright UI tests use the existing `worker` project (already real Chromium via `...devices['Desktop Chrome']`, baseURL `http://localhost:8787`) — no new Playwright project needed. `page.goto(...)` after `request.post('/api/pickleball/auth/test-login', ...)` shares the browser context's cookies by default (Playwright's documented behavior, already relied on by the realtime plan's tests); if a specific test finds this doesn't attach cookies, fall back to `page.context().addCookies([...])` extracted from the login response, the same fallback already used elsewhere in this codebase's e2e suite.

---

### Task 1: List scoring rulesets (small necessary backend addition)

The session-creation form (Task 6) needs to let an operator pick a real `scoringRulesetId` — there is currently no route to list them, only `getScoringRuleset(db, id, organizationId)` for a single lookup by id. This is a small, necessary, low-risk addition following an exact existing pattern (the same org-scoped-or-global filter `getScoringRuleset` already uses), not new design.

**Files:**
- Modify: `src/worker/repositories/pickleball/sessions.js` (add `listScoringRulesets`)
- Create: `src/pages/api/pickleball/scoring-rulesets/index.ts`
- Test: `tests/e2e/pickleball/pickleball-crud.spec.js` (append one test)

**Interfaces:**
- Produces: `listScoringRulesets(db, organizationId): Promise<Array<{id, organizationId, name, targetScore, winBy, format}>>` — every global (`organization_id IS NULL`) ruleset plus this org's own private ones.
- Produces: `GET /api/pickleball/scoring-rulesets` → `{ rulesets: [...] }`, 200.

- [ ] **Step 1: Write the failing e2e test**

Append to `tests/e2e/pickleball/pickleball-crud.spec.js`:

```js
test('lists scoring rulesets, including the global seeded ones', async ({ request }) => {
  await request.post('/api/pickleball/auth/test-login', { data: { email: 'operator@example.com' } })
  const response = await request.get('/api/pickleball/scoring-rulesets')
  expect(response.ok()).toBe(true)
  const body = await response.json()
  expect(Array.isArray(body.rulesets)).toBe(true)
  expect(body.rulesets.some((r) => r.id === 'usap-2026-sideout-11-doubles')).toBe(true)
})
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `npx playwright test tests/e2e/pickleball/pickleball-crud.spec.js --project=worker`
Expected: FAIL — `GET /api/pickleball/scoring-rulesets` 404s (route doesn't exist yet).

- [ ] **Step 3: Add the repository function**

In `src/worker/repositories/pickleball/sessions.js`, add right after `getScoringRuleset` (which already has `toScoringRuleset` defined above it — reuse that mapper, don't duplicate it):

```js
// Same tenancy rule as getScoringRuleset (a NULL organization_id is a global
// built-in every org may use): every global ruleset plus this org's own.
export async function listScoringRulesets(db, organizationId) {
  const result = await db
    .prepare(
      `SELECT id, organization_id, name, target_score, win_by, format
       FROM scoring_rulesets
       WHERE organization_id IS NULL OR organization_id = ?
       ORDER BY organization_id IS NULL DESC, name ASC`,
    )
    .bind(organizationId)
    .all()
  return (result.results || []).map(toScoringRuleset)
}
```

- [ ] **Step 4: Add the route**

`src/pages/api/pickleball/scoring-rulesets/index.ts` (new file):

```ts
import type { APIRoute } from 'astro'
import { requirePickleballSession } from '../../../../worker/pickleball/authContext.js'
import { listScoringRulesets } from '../../../../worker/repositories/pickleball/sessions.js'
import { getEnv } from '../../../../lib/env'
import { jsonResponse } from '../../../../worker/utils/responses.js'

export const GET: APIRoute = async ({ request }) => {
  const env = getEnv()
  try {
    const session = await requirePickleballSession(request, env)
    const rulesets = await listScoringRulesets(env.PICKLEBALL_DB, session.activeOrgId)
    return jsonResponse({ rulesets }, 200)
  } catch (error: any) {
    return jsonResponse({ error: error.message }, error.status || 500)
  }
}
```

- [ ] **Step 5: Run the test, confirm it passes**

Run: `npx playwright test tests/e2e/pickleball/pickleball-crud.spec.js --project=worker`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/worker/repositories/pickleball/sessions.js src/pages/api/pickleball/scoring-rulesets/index.ts tests/e2e/pickleball/pickleball-crud.spec.js
git commit -m "feat: add a scoring rulesets list route for the session-creation form"
```

---

### Task 2: `pickleballApi.js` — the fetch client

**Files:**
- Create: `src/pickleball-app/lib/pickleballApi.js`

**Interfaces:**
- Produces: `pickleballApi.get(path)`, `.post(path, body)`, `.put(path, body)`, `.delete(path)` — every later page-building task in this plan and Plans B/C uses this exclusively for REST calls.

- [ ] **Step 1: Write the file**

`src/pickleball-app/lib/pickleballApi.js` (new file — direct structural copy of `src/admin-app/lib/adminApi.js`, renamed):

```js
async function request(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'include',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    ...options,
  })

  const isJson = response.headers.get('content-type')?.includes('application/json')
  const data = isJson ? await response.json() : null

  if (!response.ok) {
    const message = (data && data.error) || `Request failed with status ${response.status}`
    const error = new Error(message)
    error.status = response.status
    error.issues = data?.issues
    throw error
  }

  return data
}

export const pickleballApi = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body: JSON.stringify(body) }),
  put: (path, body) => request(path, { method: 'PUT', body: JSON.stringify(body) }),
  delete: (path) => request(path, { method: 'DELETE' }),
}
```

- [ ] **Step 2: Commit**

```bash
git add src/pickleball-app/lib/pickleballApi.js
git commit -m "feat: add the pickleball SPA's API client"
```

(No dedicated test — this mirrors `adminApi.js`, which also has none; it's exercised by every page that uses it starting with Task 4.)

---

### Task 3: `useSessionRealtime` — the WebSocket hook

**Files:**
- Create: `src/pickleball-app/lib/useSessionRealtime.js`
- Create: `src/pickleball-app/lib/useSessionRealtime.test.js`

**Interfaces:**
- Produces: `useSessionRealtime(wsUrl: string | null): { status: 'connecting'|'open'|'closed', snapshot: unknown | null, error: string | null }` — pass `null` to not connect yet (e.g. while a sessionId isn't known). Task 7's `SessionLayout` is the first real consumer; Plans B/C's pages all consume it transitively via `useOutletContext()`.
- Produces (pure, exported for the test and for reuse): `nextBackoffDelayMs(attempt: number): number` — capped exponential backoff (1s, 2s, 4s, 8s, then holds at 8s).

- [ ] **Step 1: Write the failing test for the pure backoff function**

`src/pickleball-app/lib/useSessionRealtime.test.js` (new file):

```js
import { describe, it, expect } from 'vitest'
import { nextBackoffDelayMs } from './useSessionRealtime'

describe('nextBackoffDelayMs', () => {
  it('doubles starting from 1000ms', () => {
    expect(nextBackoffDelayMs(0)).toBe(1000)
    expect(nextBackoffDelayMs(1)).toBe(2000)
    expect(nextBackoffDelayMs(2)).toBe(4000)
    expect(nextBackoffDelayMs(3)).toBe(8000)
  })

  it('caps at 8000ms for any further attempt', () => {
    expect(nextBackoffDelayMs(4)).toBe(8000)
    expect(nextBackoffDelayMs(10)).toBe(8000)
  })
})
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `npx vitest run src/pickleball-app/lib/useSessionRealtime.test.js`
Expected: FAIL — `useSessionRealtime.js` doesn't exist yet.

- [ ] **Step 3: Write the hook**

`src/pickleball-app/lib/useSessionRealtime.js` (new file):

```js
import { useEffect, useRef, useState } from 'react'

export function nextBackoffDelayMs(attempt) {
  return Math.min(1000 * 2 ** attempt, 8000)
}

// Opens `wsUrl` (an operator or public /pickleball/rt/... URL) and keeps
// `snapshot` as the LATEST full STATE payload -- the realtime design's own
// full-snapshot-not-diff choice means this never needs merge/patch logic,
// just "replace on every message." On close, reconnects with capped
// backoff, keeping the last known snapshot visible (status flips to
// 'closed' so callers can render a small "reconnecting..." indicator)
// rather than blanking the UI -- matching the realtime design's own
// reconnect-is-just-a-fresh-connect philosophy (see the realtime spec's
// Decision 3 and the reconnect e2e test in pickleball-realtime.spec.js).
export function useSessionRealtime(wsUrl) {
  const [status, setStatus] = useState('connecting')
  const [snapshot, setSnapshot] = useState(null)
  const [error, setError] = useState(null)
  const attemptRef = useRef(0)

  useEffect(() => {
    if (!wsUrl) return undefined

    let socket
    let reconnectTimer
    let cancelled = false

    function connect() {
      setStatus('connecting')
      socket = new WebSocket(wsUrl)

      socket.onopen = () => {
        attemptRef.current = 0
        setStatus('open')
        setError(null)
      }

      socket.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data)
          if (parsed.type === 'STATE') setSnapshot(parsed.payload)
        } catch {
          // Malformed message -- ignore, the next one will still be valid.
        }
      }

      socket.onerror = () => {
        setError('Connection error.')
      }

      socket.onclose = () => {
        if (cancelled) return
        setStatus('closed')
        const delay = nextBackoffDelayMs(attemptRef.current)
        attemptRef.current += 1
        reconnectTimer = setTimeout(connect, delay)
      }
    }

    connect()

    return () => {
      cancelled = true
      clearTimeout(reconnectTimer)
      socket?.close()
    }
  }, [wsUrl])

  return { status, snapshot, error }
}
```

- [ ] **Step 4: Run the test, confirm it passes**

Run: `npx vitest run src/pickleball-app/lib/useSessionRealtime.test.js`
Expected: PASS (2/2). (The hook's actual WebSocket connection is proven end-to-end by Task 7's e2e test, which uses it inside a real page against a real server — that's the appropriate place for it, per this plan's Global Constraints on what gets Vitest vs. e2e coverage.)

- [ ] **Step 5: Commit**

```bash
git add src/pickleball-app/lib/useSessionRealtime.js src/pickleball-app/lib/useSessionRealtime.test.js
git commit -m "feat: add the operator WebSocket realtime hook"
```

---

### Task 4: Players page — establishes the first UI e2e pattern

This is the first page in this codebase's history to be driven end-to-end through Playwright's `page` fixture against real rendered DOM (every existing pickleball e2e test is API-level only, via the `request` fixture). Get the pattern right here since Tasks 5-7 and both later plans copy it.

**Files:**
- Create: `src/pickleball-app/pages/PlayersPage.jsx`
- Modify: `src/pickleball-app/PickleballApp.jsx` (register the `/players` route)
- Create: `tests/e2e/pickleball/pickleball-operator-ui.spec.js`

**Interfaces:**
- Consumes: `pickleballApi` (Task 2); `GET/POST /api/pickleball/players`, `PUT /api/pickleball/players/:id` (existing routes — `GET` returns `{players: [...]}`, `POST` body `{displayName}` returns `{player}` 201, `PUT` body `{displayName?, active?}` returns `{player}` 200; `player` shape: `{id, organizationId, displayName, normalizedName, linkedUserId, active, publicVisible, createdAt}`).
- Produces: the `/pickleball/app/players` route, matching `AppShell`'s existing nav link (currently 404s).

- [ ] **Step 1: Write the page**

`src/pickleball-app/pages/PlayersPage.jsx` (new file):

```jsx
import { useEffect, useState } from 'react'
import { pickleballApi } from '../lib/pickleballApi'

const EMPTY_PLAYER = { id: null, displayName: '' }

export default function PlayersPage() {
  const [players, setPlayers] = useState([])
  const [status, setStatus] = useState('loading')
  const [selected, setSelected] = useState(null)
  const [message, setMessage] = useState(null)

  useEffect(() => {
    let ignore = false
    pickleballApi
      .get('/api/pickleball/players')
      .then((data) => {
        if (!ignore) {
          setPlayers(data.players)
          setStatus('ready')
        }
      })
      .catch(() => !ignore && setStatus('error'))
    return () => {
      ignore = true
    }
  }, [])

  function startNew() {
    setSelected({ ...EMPTY_PLAYER })
    setMessage(null)
  }

  function selectPlayer(player) {
    setSelected(player)
    setMessage(null)
  }

  async function handleSave() {
    setMessage(null)
    try {
      if (selected.id) {
        const { player } = await pickleballApi.put(`/api/pickleball/players/${selected.id}`, { displayName: selected.displayName })
        setPlayers((current) => current.map((p) => (p.id === player.id ? player : p)))
        setSelected(player)
      } else {
        const { player } = await pickleballApi.post('/api/pickleball/players', { displayName: selected.displayName })
        setPlayers((current) => [...current, player])
        setSelected(player)
      }
      setMessage({ type: 'success', text: 'Saved.' })
    } catch (error) {
      setMessage({ type: 'error', text: error.message })
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Players</h1>
        <button type="button" onClick={startNew} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:brightness-95">
          Add Player
        </button>
      </div>

      {status === 'loading' ? <p className="text-sm text-slate-500">Loading…</p> : null}
      {status === 'error' ? <p className="text-sm text-rose-600">Could not load players.</p> : null}

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <div className="space-y-2" data-testid="players-list">
          {players.map((player) => (
            <button
              key={player.id}
              type="button"
              onClick={() => selectPlayer(player)}
              className={`block w-full rounded-lg border px-3 py-2 text-left text-sm ${selected?.id === player.id ? 'border-brand bg-brand/10 font-semibold' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'}`}
            >
              {player.displayName}
            </button>
          ))}
          {!players.length && status === 'ready' ? <p className="text-sm text-slate-500">No players yet.</p> : null}
        </div>

        <div>
          {selected ? (
            <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-slate-700">Display name</span>
                <input
                  type="text"
                  value={selected.displayName}
                  onChange={(event) => setSelected({ ...selected, displayName: event.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </label>

              {message ? <p className={message.type === 'success' ? 'text-sm text-emerald-700' : 'text-sm text-rose-600'}>{message.text}</p> : null}

              <button type="button" onClick={handleSave} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:brightness-95">
                Save
              </button>
            </div>
          ) : (
            <p className="text-sm text-slate-500">Select a player to edit, or add a new one.</p>
          )}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Register the route**

In `src/pickleball-app/PickleballApp.jsx`, add the import and register the child route:

```jsx
import PlayersPage from './pages/PlayersPage'
```

Change the `children` array in `buildRouter`:

```jsx
      children: [
        { index: true, element: <DashboardPage /> },
        { path: 'players', element: <PlayersPage /> },
      ],
```

- [ ] **Step 3: Write the first-ever UI e2e test**

`tests/e2e/pickleball/pickleball-operator-ui.spec.js` (new file — this is the pattern Tasks 5-7 and both later plans extend):

```js
import { test, expect } from '@playwright/test'

test('creates a player through the Players page and it appears in the list', async ({ page, request }) => {
  await request.post('/api/pickleball/auth/test-login', { data: { email: 'operator@example.com' } })

  await page.goto('/pickleball/app/players')
  await expect(page.getByRole('heading', { name: 'Players' })).toBeVisible()

  await page.getByRole('button', { name: 'Add Player' }).click()
  const name = `UI Test Player ${Date.now()}`
  await page.getByLabel('Display name').fill(name)
  await page.getByRole('button', { name: 'Save' }).click()

  await expect(page.getByText('Saved.')).toBeVisible()
  await expect(page.getByTestId('players-list').getByText(name)).toBeVisible()

  // Reload to prove it was actually persisted server-side, not just held in
  // local component state.
  await page.reload()
  await expect(page.getByTestId('players-list').getByText(name)).toBeVisible()
})
```

- [ ] **Step 4: Run the test, confirm it passes**

Run: `npx playwright test tests/e2e/pickleball/pickleball-operator-ui.spec.js --project=worker`
Expected: PASS. If `page.goto` doesn't carry the test-login cookie (see this plan's Global Constraints), fall back to extracting `Set-Cookie` from the login response and `page.context().addCookies([...])`.

- [ ] **Step 5: Commit**

```bash
git add src/pickleball-app/pages/PlayersPage.jsx src/pickleball-app/PickleballApp.jsx tests/e2e/pickleball/pickleball-operator-ui.spec.js
git commit -m "feat: add the Players management page"
```

---

### Task 5: Venues page (with per-venue court management)

**Files:**
- Create: `src/pickleball-app/pages/VenuesPage.jsx`
- Modify: `src/pickleball-app/PickleballApp.jsx` (register the `/venues` route)
- Modify: `tests/e2e/pickleball/pickleball-operator-ui.spec.js`

**Interfaces:**
- Consumes: `pickleballApi`; `GET/POST /api/pickleball/venues` (`GET` → `{venues: [...]}`, `POST` body `{name, address?, timezone?}` → `{venue}` 201; no `PUT` exists — venues are create-only in this UI, matching the actual API surface); `GET /api/pickleball/courts?venueId=X` → `{courts: [...]}`; `POST /api/pickleball/courts` body `{venueId, name, sortOrder?}` → `{court}` 201.

- [ ] **Step 1: Write the page**

`src/pickleball-app/pages/VenuesPage.jsx` (new file):

```jsx
import { useEffect, useState } from 'react'
import { pickleballApi } from '../lib/pickleballApi'

export default function VenuesPage() {
  const [venues, setVenues] = useState([])
  const [status, setStatus] = useState('loading')
  const [selected, setSelected] = useState(null)
  const [courts, setCourts] = useState([])
  const [newVenueName, setNewVenueName] = useState('')
  const [newCourtName, setNewCourtName] = useState('')
  const [message, setMessage] = useState(null)

  useEffect(() => {
    let ignore = false
    pickleballApi
      .get('/api/pickleball/venues')
      .then((data) => {
        if (!ignore) {
          setVenues(data.venues)
          setStatus('ready')
        }
      })
      .catch(() => !ignore && setStatus('error'))
    return () => {
      ignore = true
    }
  }, [])

  useEffect(() => {
    if (!selected) {
      setCourts([])
      return
    }
    let ignore = false
    pickleballApi.get(`/api/pickleball/courts?venueId=${selected.id}`).then((data) => {
      if (!ignore) setCourts(data.courts)
    })
    return () => {
      ignore = true
    }
  }, [selected])

  async function handleCreateVenue() {
    setMessage(null)
    try {
      const { venue } = await pickleballApi.post('/api/pickleball/venues', { name: newVenueName })
      setVenues((current) => [...current, venue])
      setNewVenueName('')
      setSelected(venue)
      setMessage({ type: 'success', text: 'Venue added.' })
    } catch (error) {
      setMessage({ type: 'error', text: error.message })
    }
  }

  async function handleAddCourt() {
    setMessage(null)
    try {
      const { court } = await pickleballApi.post('/api/pickleball/courts', { venueId: selected.id, name: newCourtName })
      setCourts((current) => [...current, court])
      setNewCourtName('')
      setMessage({ type: 'success', text: 'Court added.' })
    } catch (error) {
      setMessage({ type: 'error', text: error.message })
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900">Venues</h1>

      {status === 'loading' ? <p className="text-sm text-slate-500">Loading…</p> : null}
      {status === 'error' ? <p className="text-sm text-rose-600">Could not load venues.</p> : null}

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <div className="space-y-2" data-testid="venues-list">
          {venues.map((venue) => (
            <button
              key={venue.id}
              type="button"
              onClick={() => setSelected(venue)}
              className={`block w-full rounded-lg border px-3 py-2 text-left text-sm ${selected?.id === venue.id ? 'border-brand bg-brand/10 font-semibold' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'}`}
            >
              {venue.name}
            </button>
          ))}
          <div className="flex gap-2 pt-2">
            <input
              type="text"
              value={newVenueName}
              onChange={(event) => setNewVenueName(event.target.value)}
              placeholder="New venue name"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            <button type="button" onClick={handleCreateVenue} disabled={!newVenueName.trim()} className="shrink-0 rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white hover:brightness-95 disabled:opacity-50">
              Add
            </button>
          </div>
        </div>

        <div>
          {selected ? (
            <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-900">{selected.name} — Courts</h2>

              {message ? <p className={message.type === 'success' ? 'text-sm text-emerald-700' : 'text-sm text-rose-600'}>{message.text}</p> : null}

              <ul className="space-y-1" data-testid="courts-list">
                {courts.map((court) => (
                  <li key={court.id} className="rounded border border-slate-200 px-3 py-2 text-sm">
                    {court.name}
                  </li>
                ))}
                {!courts.length ? <li className="text-sm text-slate-500">No courts yet.</li> : null}
              </ul>

              <div className="flex gap-2">
                <input
                  type="text"
                  value={newCourtName}
                  onChange={(event) => setNewCourtName(event.target.value)}
                  placeholder="New court name"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
                <button type="button" onClick={handleAddCourt} disabled={!newCourtName.trim()} className="shrink-0 rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white hover:brightness-95 disabled:opacity-50">
                  Add Court
                </button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-500">Select a venue to manage its courts.</p>
          )}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Register the route**

In `PickleballApp.jsx`, add `import VenuesPage from './pages/VenuesPage'` and add `{ path: 'venues', element: <VenuesPage /> }` to the `children` array.

- [ ] **Step 3: Add the e2e test**

Append to `tests/e2e/pickleball/pickleball-operator-ui.spec.js`:

```js
test('creates a venue and adds a court to it through the Venues page', async ({ page, request }) => {
  await request.post('/api/pickleball/auth/test-login', { data: { email: 'operator@example.com' } })

  await page.goto('/pickleball/app/venues')
  await expect(page.getByRole('heading', { name: 'Venues' })).toBeVisible()

  const venueName = `UI Test Venue ${Date.now()}`
  await page.getByPlaceholder('New venue name').fill(venueName)
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByTestId('venues-list').getByText(venueName)).toBeVisible()

  await expect(page.getByRole('heading', { name: `${venueName} — Courts` })).toBeVisible()
  const courtName = `Court ${Date.now()}`
  await page.getByPlaceholder('New court name').fill(courtName)
  await page.getByRole('button', { name: 'Add Court' }).click()
  await expect(page.getByTestId('courts-list').getByText(courtName)).toBeVisible()
})
```

- [ ] **Step 4: Run the test, confirm it passes**

Run: `npx playwright test tests/e2e/pickleball/pickleball-operator-ui.spec.js --project=worker`
Expected: PASS (2/2).

- [ ] **Step 5: Commit**

```bash
git add src/pickleball-app/pages/VenuesPage.jsx src/pickleball-app/PickleballApp.jsx tests/e2e/pickleball/pickleball-operator-ui.spec.js
git commit -m "feat: add the Venues management page with per-venue court list"
```

---

### Task 6: Sessions list + create page

**Files:**
- Create: `src/pickleball-app/pages/SessionsListPage.jsx`
- Modify: `src/pickleball-app/PickleballApp.jsx` (register the `/sessions` route)
- Modify: `tests/e2e/pickleball/pickleball-operator-ui.spec.js`

**Interfaces:**
- Consumes: `pickleballApi`; `GET/POST /api/pickleball/sessions` (`GET` → `{sessions: [...]}`, `POST` body `{venueId, name, sessionType, scoringRulesetId, scheduledStart, scheduledEnd}` (all required; `sessionType` is `'OPEN_PLAY'|'FIXED_PAIRS'`, `scheduledStart`/`scheduledEnd` are ISO datetime strings) → `{session}` 201); `GET /api/pickleball/venues` → `{venues}`; `GET /api/pickleball/scoring-rulesets` → `{rulesets}` (Task 1).
- Produces: the `/pickleball/app/sessions` route, and a `sessionRowLink(session)`-shaped `<Link to={`/pickleball/app/sessions/${session.id}`}>` for Task 7's route to receive traffic from.

- [ ] **Step 1: Write the page**

`src/pickleball-app/pages/SessionsListPage.jsx` (new file):

```jsx
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { pickleballApi } from '../lib/pickleballApi'

const EMPTY_FORM = { venueId: '', name: '', sessionType: 'OPEN_PLAY', scoringRulesetId: '', scheduledStart: '', scheduledEnd: '' }

export default function SessionsListPage() {
  const [sessions, setSessions] = useState([])
  const [venues, setVenues] = useState([])
  const [rulesets, setRulesets] = useState([])
  const [status, setStatus] = useState('loading')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [message, setMessage] = useState(null)

  useEffect(() => {
    let ignore = false
    Promise.all([
      pickleballApi.get('/api/pickleball/sessions'),
      pickleballApi.get('/api/pickleball/venues'),
      pickleballApi.get('/api/pickleball/scoring-rulesets'),
    ])
      .then(([sessionsData, venuesData, rulesetsData]) => {
        if (ignore) return
        setSessions(sessionsData.sessions)
        setVenues(venuesData.venues)
        setRulesets(rulesetsData.rulesets)
        setStatus('ready')
      })
      .catch(() => !ignore && setStatus('error'))
    return () => {
      ignore = true
    }
  }, [])

  async function handleCreate() {
    setMessage(null)
    try {
      const payload = {
        ...form,
        scheduledStart: new Date(form.scheduledStart).toISOString(),
        scheduledEnd: new Date(form.scheduledEnd).toISOString(),
      }
      const { session } = await pickleballApi.post('/api/pickleball/sessions', payload)
      setSessions((current) => [session, ...current])
      setForm(EMPTY_FORM)
      setShowForm(false)
      setMessage({ type: 'success', text: 'Session created.' })
    } catch (error) {
      setMessage({ type: 'error', text: error.message })
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Sessions</h1>
        <button type="button" onClick={() => setShowForm((v) => !v)} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:brightness-95">
          New Session
        </button>
      </div>

      {status === 'loading' ? <p className="text-sm text-slate-500">Loading…</p> : null}
      {status === 'error' ? <p className="text-sm text-rose-600">Could not load sessions.</p> : null}
      {message ? <p className={message.type === 'success' ? 'text-sm text-emerald-700' : 'text-sm text-rose-600'}>{message.text}</p> : null}

      {showForm ? (
        <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">Name</span>
            <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">Venue</span>
            <select value={form.venueId} onChange={(e) => setForm({ ...form, venueId: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
              <option value="">Select a venue</option>
              {venues.map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">Scoring ruleset</span>
            <select value={form.scoringRulesetId} onChange={(e) => setForm({ ...form, scoringRulesetId: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
              <option value="">Select a ruleset</option>
              {rulesets.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">Start</span>
            <input type="datetime-local" value={form.scheduledStart} onChange={(e) => setForm({ ...form, scheduledStart: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">End</span>
            <input type="datetime-local" value={form.scheduledEnd} onChange={(e) => setForm({ ...form, scheduledEnd: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <button
            type="button"
            onClick={handleCreate}
            disabled={!form.name.trim() || !form.venueId || !form.scoringRulesetId || !form.scheduledStart || !form.scheduledEnd}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:brightness-95 disabled:opacity-50"
          >
            Create
          </button>
        </div>
      ) : null}

      <div className="space-y-2" data-testid="sessions-list">
        {sessions.map((session) => (
          <Link
            key={session.id}
            to={`/pickleball/app/sessions/${session.id}`}
            className="block rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm hover:border-slate-300"
          >
            <span className="font-semibold text-slate-900">{session.name}</span>
            <span className="ml-2 text-slate-500">{session.status}</span>
          </Link>
        ))}
        {!sessions.length && status === 'ready' ? <p className="text-sm text-slate-500">No sessions yet.</p> : null}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Register the route**

In `PickleballApp.jsx`, add `import SessionsListPage from './pages/SessionsListPage'` and `{ path: 'sessions', element: <SessionsListPage /> }` to `children`.

- [ ] **Step 3: Add the e2e test**

Append to `tests/e2e/pickleball/pickleball-operator-ui.spec.js`:

```js
test('creates a session through the Sessions page with a real venue and ruleset', async ({ page, request }) => {
  await request.post('/api/pickleball/auth/test-login', { data: { email: 'operator@example.com' } })
  const venueResponse = await request.post('/api/pickleball/venues', { data: { name: `Session UI Venue ${Date.now()}` } })
  const venue = (await venueResponse.json()).venue

  await page.goto('/pickleball/app/sessions')
  await page.getByRole('button', { name: 'New Session' }).click()

  const sessionName = `UI Test Session ${Date.now()}`
  await page.getByLabel('Name').fill(sessionName)
  await page.getByLabel('Venue').selectOption(venue.id)
  await page.getByLabel('Scoring ruleset').selectOption('usap-2026-sideout-11-doubles')
  await page.getByLabel('Start').fill('2026-09-01T18:00')
  await page.getByLabel('End').fill('2026-09-01T22:00')
  await page.getByRole('button', { name: 'Create' }).click()

  await expect(page.getByText('Session created.')).toBeVisible()
  await expect(page.getByTestId('sessions-list').getByText(sessionName)).toBeVisible()
})
```

- [ ] **Step 4: Run the test, confirm it passes**

Run: `npx playwright test tests/e2e/pickleball/pickleball-operator-ui.spec.js --project=worker`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add src/pickleball-app/pages/SessionsListPage.jsx src/pickleball-app/PickleballApp.jsx tests/e2e/pickleball/pickleball-operator-ui.spec.js
git commit -m "feat: add the Sessions list and create page"
```

---

### Task 7: `SessionLayout` + `SessionControlPage` — the realtime-connected session shell

The task that actually proves the whole point of this plan: a real page, in the real SPA, holding open a real WebSocket connection to the operator channel and re-rendering when a broadcast arrives.

**Files:**
- Create: `src/pickleball-app/components/SessionLayout.jsx`
- Create: `src/pickleball-app/pages/SessionControlPage.jsx`
- Modify: `src/pickleball-app/PickleballApp.jsx` (register the nested `/sessions/:sessionId` route tree)
- Modify: `tests/e2e/pickleball/pickleball-operator-ui.spec.js`

**Interfaces:**
- Consumes: `useSessionRealtime` (Task 3); `GET /api/pickleball/sessions/:id` (existing route, org-scoped, → `{session}`) for the initial page-title render before the socket's first message arrives.
- Produces: `<Outlet context={{ sessionId, session, status, snapshot, error }} />` — every page Plan B adds (`CheckInPage`, `QueuePage`, `CourtsPage`, `GamesListPage`) and Plan C's `ScorekeeperPage` reads this via `useOutletContext()`. This exact shape (`sessionId`, `session`, `status`, `snapshot`, `error`) is the contract those later plans are written against — do not change these key names.

- [ ] **Step 1: Write `SessionLayout`**

`src/pickleball-app/components/SessionLayout.jsx` (new file):

```jsx
import { useEffect, useState } from 'react'
import { NavLink, Outlet, useParams } from 'react-router-dom'
import { useSessionRealtime } from '../lib/useSessionRealtime'
import { pickleballApi } from '../lib/pickleballApi'

const SUB_NAV = [
  { to: '', label: 'Overview', end: true },
  { to: 'check-in', label: 'Check-in' },
  { to: 'queue', label: 'Queue' },
  { to: 'courts', label: 'Courts' },
  { to: 'games', label: 'Games' },
]

export default function SessionLayout() {
  const { sessionId } = useParams()
  const [session, setSession] = useState(null)

  useEffect(() => {
    let ignore = false
    pickleballApi.get(`/api/pickleball/sessions/${sessionId}`).then((data) => {
      if (!ignore) setSession(data.session)
    })
    return () => {
      ignore = true
    }
  }, [sessionId])

  const wsUrl = `${window.location.origin.replace('http', 'ws')}/pickleball/rt/${sessionId}`
  const { status, snapshot, error } = useSessionRealtime(wsUrl)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between border-b border-slate-200 pb-3">
        <h1 className="text-xl font-semibold text-slate-900">{session ? session.name : 'Loading…'}</h1>
        <span
          data-testid="realtime-status"
          className={`rounded-full px-2 py-1 text-xs font-medium ${status === 'open' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}
        >
          {status === 'open' ? 'Live' : status === 'connecting' ? 'Connecting…' : 'Reconnecting…'}
        </span>
      </div>

      <nav className="flex gap-1 border-b border-slate-200 pb-2">
        {SUB_NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => `rounded px-3 py-1.5 text-sm ${isActive ? 'bg-brand/10 font-semibold text-brand' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            {item.label}
          </NavLink>
        ))}
      </nav>

      <Outlet context={{ sessionId, session, status, snapshot, error }} />
    </div>
  )
}
```

- [ ] **Step 2: Write `SessionControlPage`**

`src/pickleball-app/pages/SessionControlPage.jsx` (new file):

```jsx
import { useOutletContext } from 'react-router-dom'

export default function SessionControlPage() {
  const { session, snapshot } = useOutletContext()

  if (!session) return <p className="text-sm text-slate-500">Loading…</p>

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
          <dd className="text-lg font-semibold text-slate-900" data-testid="queue-count">{snapshot ? snapshot.queue.length : '—'}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase text-slate-500">Courts</dt>
          <dd className="text-lg font-semibold text-slate-900" data-testid="courts-count">{snapshot ? snapshot.courts.length : '—'}</dd>
        </div>
      </dl>
    </div>
  )
}
```

- [ ] **Step 3: Register the nested route tree**

In `PickleballApp.jsx`, add the imports:

```jsx
import SessionLayout from './components/SessionLayout'
import SessionControlPage from './pages/SessionControlPage'
```

Add to `children`:

```jsx
        {
          path: 'sessions/:sessionId',
          element: <SessionLayout />,
          children: [{ index: true, element: <SessionControlPage /> }],
        },
```

- [ ] **Step 4: Add the e2e test — proves a live broadcast reaches the rendered page**

Append to `tests/e2e/pickleball/pickleball-operator-ui.spec.js` (this test creates a session with zero courts/queue entries, navigates to it, waits for the "Live" status, then joins a player to the queue via a SEPARATE REST call and asserts the on-screen queue count updates WITHOUT a reload — the actual proof this whole plan exists to deliver):

```js
test('SessionControlPage shows Live status and its queue count updates from a broadcast without a reload', async ({ page, request }) => {
  await request.post('/api/pickleball/auth/test-login', { data: { email: 'operator@example.com' } })
  const venueResponse = await request.post('/api/pickleball/venues', { data: { name: `Control UI Venue ${Date.now()}` } })
  const venueId = (await venueResponse.json()).venue.id
  const sessionResponse = await request.post('/api/pickleball/sessions', {
    data: {
      venueId,
      name: `Control UI Session ${Date.now()}`,
      sessionType: 'OPEN_PLAY',
      scoringRulesetId: 'usap-2026-sideout-11-doubles',
      scheduledStart: '2026-09-01T18:00:00.000Z',
      scheduledEnd: '2026-09-01T22:00:00.000Z',
    },
  })
  const sessionId = (await sessionResponse.json()).session.id

  await page.goto(`/pickleball/app/sessions/${sessionId}`)
  await expect(page.getByTestId('realtime-status')).toHaveText('Live', { timeout: 10000 })
  await expect(page.getByTestId('queue-count')).toHaveText('0')

  const playerResponse = await request.post('/api/pickleball/players', { data: { displayName: `Control UI Player ${Date.now()}` } })
  const playerId = (await playerResponse.json()).player.id
  const registerResponse = await request.post(`/api/pickleball/sessions/${sessionId}/players`, { data: { playerId } })
  const sessionPlayerId = (await registerResponse.json()).sessionPlayer.id
  await request.post(`/api/pickleball/sessions/${sessionId}/players/check-in`, { data: { playerId } })
  await request.post(`/api/pickleball/sessions/${sessionId}/queue`, { data: { sessionPlayerId } })

  await expect(page.getByTestId('queue-count')).toHaveText('1', { timeout: 10000 })
})
```

- [ ] **Step 5: Run the test, confirm it passes**

Run: `npx playwright test tests/e2e/pickleball/pickleball-operator-ui.spec.js --project=worker`
Expected: PASS (4/4).

- [ ] **Step 6: Run the full set of this plan's Playwright coverage plus a light regression check**

Run: `npx playwright test tests/e2e/pickleball/pickleball-operator-ui.spec.js tests/e2e/pickleball/pickleball-crud.spec.js --project=worker`
Expected: PASS, no regressions.

- [ ] **Step 7: Commit**

```bash
git add src/pickleball-app/components/SessionLayout.jsx src/pickleball-app/pages/SessionControlPage.jsx src/pickleball-app/PickleballApp.jsx tests/e2e/pickleball/pickleball-operator-ui.spec.js
git commit -m "feat: add the session-scoped realtime layout and overview page"
```

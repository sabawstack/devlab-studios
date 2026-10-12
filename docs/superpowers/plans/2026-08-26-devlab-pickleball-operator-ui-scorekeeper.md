# Devlab Pickleball Operator UI — Plan C: Scorekeeper, Correction Panel, and Public Live View Implementation Plan

> **Superseded (2026-10-12).** This describes the logged-in operator app, retired in 2.0.0 by Phase 5 of `docs/superpowers/specs/2026-10-11-pickleball-free-open-play-design.md`. Kept as history: the routes, tables and files it names no longer exist.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the interactive scorekeeper/correction screen (`/sessions/:id/games/:gameId`) and the plain public live-view page (`/pickleball/live/:code`) that close out the Devlab Pickleball operator UI sub-project.

**Architecture:** Extend the existing session-scoped SPA (`src/pickleball-app/`, built by Plans A and B) with one more nested route whose page reads a single game out of the already-live `snapshot`, imports the already-built pure scoring-display functions to compute what to show, and posts REST actions whose responses are used only for error handling — the score update comes from the next broadcast, exactly like every earlier page in this sub-project. A new, separate, unauthenticated Astro page mounts a second, tiny React island that speaks to the existing public REST/WebSocket channel.

**Tech Stack:** React Router v7 (`useOutletContext`, nested routes), the existing `pickleballApi` fetch client and `useSessionRealtime` WebSocket hook (Plan A, unchanged), the already-built and already-unit-tested `src/lib/pickleball/scoring/display.ts` module, Tailwind, Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-08-26-devlab-pickleball-operator-ui-design.md`

## Global Constraints

- Live data comes from `useOutletContext()`'s `snapshot`; every mutating action is a REST POST via `pickleballApi` whose own response is used only for error handling — the UI update comes from the next broadcast. Never manually splice a POST response into `snapshot`-covered state. (Spec Decision 1, inherited from Plans A/B.)
- The scorekeeper screen implements spec §7.4 literally: Team A/Team B occupy fixed rows for the whole game (never reordered on a side-out); only the serving indicator and the score-call digit order change; the two rally buttons plus "UNDO LAST RALLY" are the only primary controls — no `-1`/`+1` steppers anywhere near them; the correction panel is a visually separate section. (Spec Decision 2.)
- `officialScoreCall`, `isGamePoint`, `contextualState`, `hasGameBeenWon` are imported directly from `src/lib/pickleball/scoring/display.ts` — the screen never re-derives this logic.
- Role-gated UI: the correction panel (reopen/correct) is rendered only for `ADMIN`/`SESSION_FACILITATOR` — a `SCOREKEEPER` never sees the controls at all, not disabled ones. The REST layer already enforces this server-side; this is a UX choice, not the security boundary. (Spec Decision 6.)
- The public live view is plain — no TV-specific styling. It reuses the existing public REST (`GET /api/pickleball/public/:code/state`) and WebSocket (`/pickleball/rt/public/:code`) endpoints unchanged. (Spec Decision 3.)
- `SessionLayout`'s `useOutletContext()` shape is frozen at `{sessionId, session, status, snapshot, error}` (Plan A). This plan may only ADD a new field (`authRole`) — never remove, rename, or change the meaning of the existing five.
- `pickleballApi` client shape (`get/post/put/delete`, throws `Error` with `.message`/`.status`/`.issues` on non-2xx) and `useSessionRealtime(wsUrl)` hook (`{status, snapshot, error}`, pass `null` to not connect, replaces `snapshot` wholesale on every `STATE` message) are already built — reuse them, do not modify their public shape.
- Error messages render as `{message ? <p className="text-sm text-rose-600">{message.text}</p> : null}` — matching every session sub-page shipped in Plan B (`QueuePage.jsx`, `CourtsPage.jsx`).
- Every e2e test that logs in reuses `loginAsOperator`/`loginAs` from `tests/e2e/pickleball/helpers.js` — never a fresh inline cookie-bridging block.
- `--local` only. No placeholder routes. Follow the exact code given in each task's steps; where a task's own decision has a nuance worth a one-line note, it is called out inline in that step.

---

### Task 1: Auth-role plumbing, the Scorekeeper route, and a link into it from the Games list

The correction panel (Task 4) needs to know the caller's role, and nothing today threads it past `AppShell`. This task adds that plumbing, registers the new route, and gives operators a way to reach it — a self-contained, testable slice before any scoring logic exists.

**Files:**
- Modify: `src/pickleball-app/components/AppShell.jsx`
- Modify: `src/pickleball-app/components/SessionLayout.jsx`
- Modify: `src/pickleball-app/PickleballApp.jsx`
- Modify: `src/pickleball-app/pages/GamesListPage.jsx`
- Create: `src/pickleball-app/pages/ScorekeeperPage.jsx`
- Test: `tests/e2e/pickleball/pickleball-operator-ui.spec.js`

**Interfaces:**
- Consumes: `pickleballApi` (`src/pickleball-app/lib/pickleballApi.js`), `useSessionRealtime` (`src/pickleball-app/lib/useSessionRealtime.js`), the frozen `SessionLayout` outlet context.
- Produces: `SessionLayout`'s outlet context grows to `{sessionId, session, status, snapshot, error, authRole}` — `authRole` is one of `'ADMIN' | 'SESSION_FACILITATOR' | 'SCOREKEEPER'` (the string from `GET /api/pickleball/auth/session`'s `role` field). Route `sessions/:sessionId/games/:gameId` → `ScorekeeperPage`, consumed directly by the browser via the games-list link this task also adds.

- [ ] **Step 1: Thread `authRole` from `AppShell` to `SessionLayout` via `Outlet context`**

`AppShell.jsx` already receives the full auth `session` object (which has a `role` field, confirmed by `GET /api/pickleball/auth/session`'s response shape) as a prop, but its `<Outlet />` currently passes no context at all. Change the last few lines:

```jsx
      <main className="flex-1 p-6">
        <Outlet context={{ authRole: session.role }} />
      </main>
```

(Only that one line changes — the rest of `AppShell.jsx` is unchanged.)

- [ ] **Step 2: Read `authRole` in `SessionLayout` and add it to its own outlet context**

`SessionLayout.jsx` is itself rendered inside `AppShell`'s `<Outlet>`, so it can read `{ authRole }` via `useOutletContext()` — the same mechanism it already gives its own children. Replace the full file with:

```jsx
import { useEffect, useState } from 'react'
import { NavLink, Outlet, useOutletContext, useParams } from 'react-router-dom'
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
  const { authRole } = useOutletContext()
  const [session, setSession] = useState(null)
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    let ignore = false
    pickleballApi
      .get(`/api/pickleball/sessions/${sessionId}`)
      .then((data) => {
        if (!ignore) setSession(data.session)
      })
      .catch(() => {
        if (!ignore) setLoadError(true)
      })
    return () => {
      ignore = true
    }
  }, [sessionId])

  const wsUrl = `${window.location.origin.replace('http', 'ws')}/pickleball/rt/${sessionId}`
  const { status, snapshot, error } = useSessionRealtime(loadError ? null : wsUrl)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between border-b border-slate-200 pb-3">
        <h1 className="text-xl font-semibold text-slate-900">
          {loadError ? 'Could not load this session.' : session ? session.name : 'Loading…'}
        </h1>
        {loadError ? null : (
          <span
            data-testid="realtime-status"
            className={`rounded-full px-2 py-1 text-xs font-medium ${status === 'open' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}
          >
            {status === 'open' ? 'Live' : status === 'connecting' ? 'Connecting…' : 'Reconnecting…'}
          </span>
        )}
      </div>

      {loadError ? (
        <p className="text-sm text-rose-600">Could not load this session. It may not exist, or you may not have access to it.</p>
      ) : (
        <>
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

          <Outlet context={{ sessionId, session, status, snapshot, error, authRole }} />
        </>
      )}
    </div>
  )
}
```

(Only the `useOutletContext` import, the `const { authRole } = useOutletContext()` line, and `authRole` appended to the final `<Outlet context={{...}}/>` are new — everything else is byte-for-byte the file Plan A/B shipped.)

- [ ] **Step 3: Create a minimal `ScorekeeperPage.jsx`**

Just enough to prove the route and link work — reads the game out of `snapshot`, handles "not found." Later tasks in this plan extend this same file.

```jsx
import { useOutletContext, useParams } from 'react-router-dom'

export default function ScorekeeperPage() {
  const { gameId } = useParams()
  const { snapshot } = useOutletContext()

  if (!snapshot) return <p className="text-sm text-slate-500">Loading…</p>

  const game = snapshot.games.find((g) => g.id === gameId)
  if (!game) return <p className="text-sm text-rose-600">Game not found.</p>

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900">Scorekeeper</h1>
      <p data-testid="scorekeeper-score" className="text-4xl font-bold text-slate-900">{game.scoreA} – {game.scoreB}</p>
    </div>
  )
}
```

- [ ] **Step 4: Register the route in `PickleballApp.jsx`**

Add the import and the new child route, right after `games`:

```jsx
import ScorekeeperPage from './pages/ScorekeeperPage'
```

(add alongside the existing `GamesListPage` import)

```jsx
            { path: 'games', element: <GamesListPage /> },
            { path: 'games/:gameId', element: <ScorekeeperPage /> },
```

- [ ] **Step 5: Link into it from `GamesListPage`'s games list**

`GamesListPage.jsx` currently renders each game as a plain `<div>`. Change the import line and the games-list block:

```jsx
import { Link, useOutletContext } from 'react-router-dom'
```

```jsx
        <div className="space-y-2" data-testid="games-list">
          {snapshot.games.map((game) => (
            <Link
              key={game.id}
              to={game.id}
              className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm hover:border-slate-300"
            >
              <span>{game.scoreA} – {game.scoreB}</span>
              <span className="text-slate-500">{game.status}</span>
            </Link>
          ))}
          {!snapshot.games.length ? <p className="text-sm text-slate-500">No games yet.</p> : null}
        </div>
```

(The rest of `GamesListPage.jsx`, including `StartGameForm`, is unchanged.)

- [ ] **Step 6: Write the e2e test**

Append to `tests/e2e/pickleball/pickleball-operator-ui.spec.js`. This reuses the exact venue/court/session/players/queue/court-assignment/start-game setup from the existing `'starts a game through the Games page...'` test in this same file, then continues past where that test stops:

```js
test('opens the Scorekeeper page for an in-progress game from the Games list', async ({ page, request, context }) => {
  const baseURL = test.info().project.use.baseURL
  await loginAsOperator(request, context, baseURL)

  const venueResponse = await request.post('/api/pickleball/venues', { data: { name: `Scorekeeper Nav Venue ${Date.now()}` } })
  const venueId = (await venueResponse.json()).venue.id
  await request.post('/api/pickleball/courts', { data: { venueId, name: 'Court 1' } })
  const sessionResponse = await request.post('/api/pickleball/sessions', {
    data: {
      venueId, name: `Scorekeeper Nav Session ${Date.now()}`, sessionType: 'OPEN_PLAY',
      scoringRulesetId: 'usap-2026-sideout-11-doubles',
      scheduledStart: '2026-09-01T18:00:00.000Z', scheduledEnd: '2026-09-01T22:00:00.000Z',
    },
  })
  const sessionId = (await sessionResponse.json()).session.id
  await request.post(`/api/pickleball/sessions/${sessionId}/status`, { data: { status: 'OPEN_FOR_CHECKIN' } })
  await request.post(`/api/pickleball/sessions/${sessionId}/status`, { data: { status: 'LIVE' } })
  const sessionCourtId = (await (await request.get(`/api/pickleball/sessions/${sessionId}/courts`)).json()).courts[0].id

  for (let i = 0; i < 4; i += 1) {
    const playerId = (await (await request.post('/api/pickleball/players', { data: { displayName: `Scorekeeper Nav Player ${i}-${Date.now()}` } })).json()).player.id
    const sessionPlayerId = (await (await request.post(`/api/pickleball/sessions/${sessionId}/players`, { data: { playerId } })).json()).sessionPlayer.id
    await request.post(`/api/pickleball/sessions/${sessionId}/players/check-in`, { data: { playerId } })
    await request.post(`/api/pickleball/sessions/${sessionId}/queue`, { data: { sessionPlayerId } })
  }
  await request.post(`/api/pickleball/sessions/${sessionId}/courts/assign`, { data: { sessionCourtId } })

  const teams = (await (await request.get(`/api/pickleball/sessions/${sessionId}/courts/${sessionCourtId}/teams`)).json()).teams
  const startResponse = await request.post(`/api/pickleball/sessions/${sessionId}/games/start`, {
    data: {
      sessionCourtId,
      servingTeam: 'A',
      teamAStartingServerSessionPlayerId: teams[0].members[0].sessionPlayerId,
      teamBStartingServerSessionPlayerId: teams[1].members[0].sessionPlayerId,
    },
  })
  expect(startResponse.ok()).toBe(true)

  await page.goto(`/pickleball/app/sessions/${sessionId}/games`)
  await expect(page.getByTestId('games-list').getByText('0 – 0')).toBeVisible()
  await page.getByTestId('games-list').getByRole('link').click()

  await expect(page).toHaveURL(new RegExp(`/games/[^/]+$`))
  await expect(page.getByTestId('scorekeeper-score')).toHaveText('0 – 0')
})
```

Note: `teams[0]`/`teams[1]` ordering from `GET .../courts/:courtId/teams` is not guaranteed to be "team A first" — that's fine here, since the test only needs *a* valid starting-server id from each of the two teams, not a specific team-A/team-B assignment (the `games/start` route itself resolves which supplied id belongs to which team by membership, not by array position — see `SessionCoordinatorDO.startGame`).

- [ ] **Step 7: Run the new test**

Run: `npx playwright test tests/e2e/pickleball/pickleball-operator-ui.spec.js --project=worker -g "opens the Scorekeeper page"`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/pickleball-app/components/AppShell.jsx src/pickleball-app/components/SessionLayout.jsx src/pickleball-app/PickleballApp.jsx src/pickleball-app/pages/GamesListPage.jsx src/pickleball-app/pages/ScorekeeperPage.jsx tests/e2e/pickleball/pickleball-operator-ui.spec.js
git commit -m "feat: add the Scorekeeper route, auth-role plumbing, and a games-list link into it"
```

---

### Task 2: Wire the scoring-display module into a read-only Scorekeeper screen

Adds the official score call, the contextual banner, and win detection — all computed by the already-built, already-unit-tested `src/lib/pickleball/scoring/display.ts`, never re-derived here. Still no rally-recording actions; those are Task 3.

**Files:**
- Create: `src/pickleball-app/components/ContextualBanner.jsx`
- Modify: `src/pickleball-app/pages/ScorekeeperPage.jsx`
- Test: `tests/e2e/pickleball/pickleball-operator-ui.spec.js`

**Interfaces:**
- Consumes: `officialScoreCall(state, format)`, `contextualState(state, ruleset, lastOutcome)`, `hasGameBeenWon(state, ruleset)` from `src/lib/pickleball/scoring/display.ts` (types from `src/lib/pickleball/scoring/gameState.ts`: `GameState {scoreA, scoreB, servingTeam, serverNumber}`, `ScoringRulesetLike {format, targetScore, winBy}`). `GET /api/pickleball/scoring-rulesets` → `{rulesets: [{id, organizationId, name, targetScore, winBy, format}]}` (already built in Plan A).
- Produces: `ContextualBanner` component, prop `value: 'SIDE_OUT' | 'GAME_POINT' | 'TIED_WIN_BY_TWO' | null` — renders nothing when `null`. Both are reused by Task 3/4's further edits to `ScorekeeperPage.jsx`.

- [ ] **Step 1: Create `ContextualBanner.jsx`**

A pure display component — no state, no fetching.

```jsx
const BANNER_COPY = {
  SIDE_OUT: { text: 'Side out', className: 'bg-amber-100 text-amber-800' },
  GAME_POINT: { text: 'Game point', className: 'bg-rose-100 text-rose-800' },
  TIED_WIN_BY_TWO: { text: 'Tied — win by two', className: 'bg-sky-100 text-sky-800' },
}

export default function ContextualBanner({ value }) {
  if (!value) return null
  const copy = BANNER_COPY[value]
  return (
    <p data-testid="contextual-banner" className={`inline-block rounded-full px-3 py-1 text-sm font-semibold ${copy.className}`}>
      {copy.text}
    </p>
  )
}
```

- [ ] **Step 2: Wire it into `ScorekeeperPage.jsx`**

Replace the full file. This fetches the org's scoring rulesets once on mount (the same "fetch supplementary REST data the snapshot doesn't carry" pattern `CheckInPage.jsx` and `CourtsPage.jsx` already use), finds the ruleset matching this game's `scoringRulesetId`, and computes the display values. `lastOutcome` is always `null` here — Task 3 is what ever sets it (a `SIDE_OUT` banner is only meaningful to the client that just caused it; see that task's note).

```jsx
import { useEffect, useState } from 'react'
import { useOutletContext, useParams } from 'react-router-dom'
import { pickleballApi } from '../lib/pickleballApi'
import { officialScoreCall, contextualState, hasGameBeenWon } from '../../lib/pickleball/scoring/display'
import ContextualBanner from '../components/ContextualBanner'

export default function ScorekeeperPage() {
  const { gameId } = useParams()
  const { snapshot } = useOutletContext()
  const [rulesets, setRulesets] = useState(null)

  useEffect(() => {
    let ignore = false
    pickleballApi
      .get('/api/pickleball/scoring-rulesets')
      .then((data) => {
        if (!ignore) setRulesets(data.rulesets)
      })
      .catch(() => {
        if (!ignore) setRulesets([])
      })
    return () => {
      ignore = true
    }
  }, [])

  if (!snapshot || rulesets === null) return <p className="text-sm text-slate-500">Loading…</p>

  const game = snapshot.games.find((g) => g.id === gameId)
  if (!game) return <p className="text-sm text-rose-600">Game not found.</p>

  const ruleset = rulesets.find((r) => r.id === game.scoringRulesetId)
  if (!ruleset) return <p className="text-sm text-rose-600">Unknown scoring ruleset for this game.</p>

  const state = { scoreA: game.scoreA, scoreB: game.scoreB, servingTeam: game.servingTeam, serverNumber: game.serverNumber }
  const gameWon = hasGameBeenWon(state, ruleset)
  const banner = contextualState(state, ruleset, null)

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900">Scorekeeper</h1>
      <ContextualBanner value={banner} />
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-center">
        <p data-testid="scorekeeper-score" className="text-4xl font-bold text-slate-900">{game.scoreA} – {game.scoreB}</p>
        <p data-testid="scorekeeper-official-call" className="mt-2 text-sm text-slate-500">
          Serving: Team {game.servingTeam} · Call: {officialScoreCall(state, ruleset.format)}
        </p>
        {gameWon ? <p className="mt-2 text-sm font-semibold text-emerald-700">Game point reached.</p> : null}
      </div>
    </div>
  )
}
```

Import path check: `src/pickleball-app/pages/ScorekeeperPage.jsx` → `../../lib/pickleball/scoring/display` resolves to `src/lib/pickleball/scoring/display.ts` (two levels up from `pages/` reaches `src/`).

- [ ] **Step 3: Write the e2e test**

The ruleset used everywhere in this test suite (`usap-2026-sideout-11-doubles`) is `{targetScore: 11, winBy: 2, format: 'DOUBLES'}` (`migrations/pickleball/0002_default_ruleset.sql`). A doubles game opens with `serverNumber: 2` (`initialGameState`), so the opening official call is `"0-0-2"`. Ten straight rallies won by the already-serving Team A never causes a side-out (a side-out only happens when the *receiving* team wins), so Team A stays serving throughout, landing at 10-0 — one point short of the valid final score 11-0, which is exactly `isGamePoint`'s definition. Append to `tests/e2e/pickleball/pickleball-operator-ui.spec.js`:

```js
test('shows the official score call and contextual banner on the Scorekeeper page', async ({ page, request, context }) => {
  const baseURL = test.info().project.use.baseURL
  await loginAsOperator(request, context, baseURL)

  const venueResponse = await request.post('/api/pickleball/venues', { data: { name: `Scorekeeper Display Venue ${Date.now()}` } })
  const venueId = (await venueResponse.json()).venue.id
  await request.post('/api/pickleball/courts', { data: { venueId, name: 'Court 1' } })
  const sessionResponse = await request.post('/api/pickleball/sessions', {
    data: {
      venueId, name: `Scorekeeper Display Session ${Date.now()}`, sessionType: 'OPEN_PLAY',
      scoringRulesetId: 'usap-2026-sideout-11-doubles',
      scheduledStart: '2026-09-01T18:00:00.000Z', scheduledEnd: '2026-09-01T22:00:00.000Z',
    },
  })
  const sessionId = (await sessionResponse.json()).session.id
  await request.post(`/api/pickleball/sessions/${sessionId}/status`, { data: { status: 'OPEN_FOR_CHECKIN' } })
  await request.post(`/api/pickleball/sessions/${sessionId}/status`, { data: { status: 'LIVE' } })
  const sessionCourtId = (await (await request.get(`/api/pickleball/sessions/${sessionId}/courts`)).json()).courts[0].id

  for (let i = 0; i < 4; i += 1) {
    const playerId = (await (await request.post('/api/pickleball/players', { data: { displayName: `Scorekeeper Display Player ${i}-${Date.now()}` } })).json()).player.id
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

  await page.goto(`/pickleball/app/sessions/${sessionId}/games/${gameId}`)
  await expect(page.getByTestId('scorekeeper-score')).toHaveText('0 – 0')
  await expect(page.getByTestId('scorekeeper-official-call')).toContainText('Call: 0-0-2')
  await expect(page.getByTestId('contextual-banner')).toHaveCount(0)

  for (let i = 0; i < 10; i += 1) {
    const rallyResponse = await request.post(`/api/pickleball/sessions/${sessionId}/games/${gameId}/rally`, { data: { winningTeam: 'A' } })
    expect(rallyResponse.ok()).toBe(true)
  }

  await expect(page.getByTestId('scorekeeper-score')).toHaveText('10 – 0', { timeout: 10000 })
  await expect(page.getByTestId('contextual-banner')).toHaveText('Game point', { timeout: 10000 })
})
```

- [ ] **Step 4: Run the new test**

Run: `npx playwright test tests/e2e/pickleball/pickleball-operator-ui.spec.js --project=worker -g "official score call"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pickleball-app/components/ContextualBanner.jsx src/pickleball-app/pages/ScorekeeperPage.jsx tests/e2e/pickleball/pickleball-operator-ui.spec.js
git commit -m "feat: wire the scoring-display module into the Scorekeeper page"
```

---

### Task 3: `ScorekeeperControls` — record a rally, undo, finish the game

The two rally buttons plus undo (spec §7.4), and the "Finish game" action a won-but-not-yet-finished game needs — `recordRally` refuses any further rally once `hasGameBeenWon` is true, so the UI must offer an explicit way forward at that point.

**Files:**
- Create: `src/pickleball-app/components/ScorekeeperControls.jsx`
- Modify: `src/pickleball-app/pages/ScorekeeperPage.jsx`
- Test: `tests/e2e/pickleball/pickleball-operator-ui.spec.js`

**Interfaces:**
- Consumes: `POST /api/pickleball/sessions/:id/games/:gameId/rally` body `{winningTeam: 'A'|'B'}` → `{ok:true, state, outcome, servingPlayerId, game}`; `POST .../undo` (empty body) → `{ok:true, state, game}`; `POST .../finish` body `{}` → `{ok:true, winningTeamId, finalScoreA, finalScoreB, releasedSessionPlayerIds, requeued, game}`. All three 409 with `{error: <message>}` on refusal (e.g. `"This game is under correction; use correctGame instead of recording a new rally."`), surfaced via `pickleballApi`'s thrown `Error.message`.
- Produces: `ScorekeeperControls` component, props `{onRally(team), onUndo(), onFinish(), isGameWon}`. `ScorekeeperPage`'s local `lastOutcome` state (`{revision, outcome} | null`), read by Task 2's `contextualState` call — a `SIDE_OUT` banner is only shown to the client whose own rally caused it, and only until the next event on this specific game (tracked by `game.revision`, which increments per-game on every scoring event); every other viewer, and this same client after any newer event, sees `lastOutcome` as `null`, falling back to the purely score-derived `GAME_POINT`/`TIED_WIN_BY_TWO` checks. This is a deliberate design choice: no snapshot anywhere carries rally history, so `SIDE_OUT` genuinely cannot be reconstructed for a client that didn't just cause it.

- [ ] **Step 1: Create `ScorekeeperControls.jsx`**

```jsx
export default function ScorekeeperControls({ onRally, onUndo, onFinish, isGameWon }) {
  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          disabled={isGameWon}
          onClick={() => onRally('A')}
          className="rounded-lg bg-brand px-4 py-3 text-sm font-semibold text-white hover:brightness-95 disabled:opacity-50"
        >
          TEAM A WON RALLY
        </button>
        <button
          type="button"
          disabled={isGameWon}
          onClick={() => onRally('B')}
          className="rounded-lg bg-brand px-4 py-3 text-sm font-semibold text-white hover:brightness-95 disabled:opacity-50"
        >
          TEAM B WON RALLY
        </button>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onUndo}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          UNDO LAST RALLY
        </button>
        {isGameWon ? (
          <button
            type="button"
            onClick={onFinish}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
          >
            Finish game
          </button>
        ) : null}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Wire actions into `ScorekeeperPage.jsx`**

Replace the full file:

```jsx
import { useEffect, useState } from 'react'
import { useOutletContext, useParams } from 'react-router-dom'
import { pickleballApi } from '../lib/pickleballApi'
import { officialScoreCall, contextualState, hasGameBeenWon } from '../../lib/pickleball/scoring/display'
import ContextualBanner from '../components/ContextualBanner'
import ScorekeeperControls from '../components/ScorekeeperControls'

export default function ScorekeeperPage() {
  const { gameId } = useParams()
  const { sessionId, snapshot } = useOutletContext()
  const [rulesets, setRulesets] = useState(null)
  const [message, setMessage] = useState(null)
  const [lastOutcome, setLastOutcome] = useState(null)

  useEffect(() => {
    let ignore = false
    pickleballApi
      .get('/api/pickleball/scoring-rulesets')
      .then((data) => {
        if (!ignore) setRulesets(data.rulesets)
      })
      .catch(() => {
        if (!ignore) setRulesets([])
      })
    return () => {
      ignore = true
    }
  }, [])

  if (!snapshot || rulesets === null) return <p className="text-sm text-slate-500">Loading…</p>

  const game = snapshot.games.find((g) => g.id === gameId)
  if (!game) return <p className="text-sm text-rose-600">Game not found.</p>

  const ruleset = rulesets.find((r) => r.id === game.scoringRulesetId)
  if (!ruleset) return <p className="text-sm text-rose-600">Unknown scoring ruleset for this game.</p>

  const state = { scoreA: game.scoreA, scoreB: game.scoreB, servingTeam: game.servingTeam, serverNumber: game.serverNumber }
  const gameWon = hasGameBeenWon(state, ruleset)
  const activeOutcome = lastOutcome && lastOutcome.revision === game.revision ? lastOutcome.outcome : null
  const banner = contextualState(state, ruleset, activeOutcome)

  async function handleRally(winningTeam) {
    setMessage(null)
    try {
      const result = await pickleballApi.post(`/api/pickleball/sessions/${sessionId}/games/${gameId}/rally`, { winningTeam })
      setLastOutcome({ revision: result.game.revision, outcome: result.outcome })
    } catch (error) {
      setMessage({ type: 'error', text: error.message })
    }
  }

  async function handleUndo() {
    setMessage(null)
    try {
      await pickleballApi.post(`/api/pickleball/sessions/${sessionId}/games/${gameId}/undo`, {})
      setLastOutcome(null)
    } catch (error) {
      setMessage({ type: 'error', text: error.message })
    }
  }

  async function handleFinish() {
    setMessage(null)
    try {
      await pickleballApi.post(`/api/pickleball/sessions/${sessionId}/games/${gameId}/finish`, {})
    } catch (error) {
      setMessage({ type: 'error', text: error.message })
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900">Scorekeeper</h1>
      {message ? <p className="text-sm text-rose-600">{message.text}</p> : null}
      <ContextualBanner value={banner} />
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-center">
        <p data-testid="scorekeeper-score" className="text-4xl font-bold text-slate-900">{game.scoreA} – {game.scoreB}</p>
        <p data-testid="scorekeeper-official-call" className="mt-2 text-sm text-slate-500">
          Serving: Team {game.servingTeam} · Call: {officialScoreCall(state, ruleset.format)}
        </p>
      </div>
      {game.status === 'IN_PROGRESS' && !game.correctionPending ? (
        <ScorekeeperControls onRally={handleRally} onUndo={handleUndo} onFinish={handleFinish} isGameWon={gameWon} />
      ) : null}
      {game.status === 'IN_PROGRESS' && game.correctionPending ? (
        <p className="text-sm text-amber-700">This game is under correction. Use the correction panel below.</p>
      ) : null}
      {game.status === 'FINISHED' ? (
        <p className="text-sm text-slate-600">Game finished: {game.finalScoreA} – {game.finalScoreB}.</p>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 3: Write the e2e test**

Append to `tests/e2e/pickleball/pickleball-operator-ui.spec.js`. Records one rally and undoes it through the actual UI buttons (proving the button-click → broadcast → re-render path), then drives the remaining points via REST for speed before exercising the "Finish game" button through the UI:

```js
test('records rallies, undoes the last one, and finishes a game from the Scorekeeper page', async ({ page, request, context }) => {
  const baseURL = test.info().project.use.baseURL
  await loginAsOperator(request, context, baseURL)

  const venueResponse = await request.post('/api/pickleball/venues', { data: { name: `Scorekeeper Controls Venue ${Date.now()}` } })
  const venueId = (await venueResponse.json()).venue.id
  await request.post('/api/pickleball/courts', { data: { venueId, name: 'Court 1' } })
  const sessionResponse = await request.post('/api/pickleball/sessions', {
    data: {
      venueId, name: `Scorekeeper Controls Session ${Date.now()}`, sessionType: 'OPEN_PLAY',
      scoringRulesetId: 'usap-2026-sideout-11-doubles',
      scheduledStart: '2026-09-01T18:00:00.000Z', scheduledEnd: '2026-09-01T22:00:00.000Z',
    },
  })
  const sessionId = (await sessionResponse.json()).session.id
  await request.post(`/api/pickleball/sessions/${sessionId}/status`, { data: { status: 'OPEN_FOR_CHECKIN' } })
  await request.post(`/api/pickleball/sessions/${sessionId}/status`, { data: { status: 'LIVE' } })
  const sessionCourtId = (await (await request.get(`/api/pickleball/sessions/${sessionId}/courts`)).json()).courts[0].id

  for (let i = 0; i < 4; i += 1) {
    const playerId = (await (await request.post('/api/pickleball/players', { data: { displayName: `Scorekeeper Controls Player ${i}-${Date.now()}` } })).json()).player.id
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

  await page.goto(`/pickleball/app/sessions/${sessionId}/games/${gameId}`)
  await expect(page.getByTestId('scorekeeper-score')).toHaveText('0 – 0')

  await page.getByRole('button', { name: 'TEAM A WON RALLY' }).click()
  await expect(page.getByTestId('scorekeeper-score')).toHaveText('1 – 0', { timeout: 10000 })

  await page.getByRole('button', { name: 'UNDO LAST RALLY' }).click()
  await expect(page.getByTestId('scorekeeper-score')).toHaveText('0 – 0', { timeout: 10000 })

  for (let i = 0; i < 11; i += 1) {
    const rallyResponse = await request.post(`/api/pickleball/sessions/${sessionId}/games/${gameId}/rally`, { data: { winningTeam: 'A' } })
    expect(rallyResponse.ok()).toBe(true)
  }

  await expect(page.getByTestId('scorekeeper-score')).toHaveText('11 – 0', { timeout: 10000 })
  await expect(page.getByRole('button', { name: 'Finish game' })).toBeVisible()
  await page.getByRole('button', { name: 'Finish game' }).click()
  await expect(page.getByText('Game finished: 11 – 0.')).toBeVisible({ timeout: 10000 })
})
```

- [ ] **Step 4: Run the new test**

Run: `npx playwright test tests/e2e/pickleball/pickleball-operator-ui.spec.js --project=worker -g "records rallies, undoes"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pickleball-app/components/ScorekeeperControls.jsx src/pickleball-app/pages/ScorekeeperPage.jsx tests/e2e/pickleball/pickleball-operator-ui.spec.js
git commit -m "feat: add rally, undo, and finish actions to the Scorekeeper page"
```

---

### Task 4: `CorrectionPanel` — role-gated reopen/correct, and the role-gating e2e proof

**Files:**
- Create: `src/pickleball-app/components/CorrectionPanel.jsx`
- Modify: `src/pickleball-app/pages/ScorekeeperPage.jsx`
- Modify: `tests/e2e/pickleball/helpers.js`
- Test: `tests/e2e/pickleball/pickleball-operator-ui.spec.js`

**Interfaces:**
- Consumes: `POST .../reopen` (empty body) → `{ok:true, game}`, requires `game.status === 'FINISHED'` server-side ("Only a finished game can be reopened."). `POST .../correct` body `{scoreA, scoreB, servingTeam, serverNumber}` → `{ok:true, game}`, requires `game.status === 'IN_PROGRESS'` server-side ("Reopen the game before correcting its score.") — works whether or not `correctionPending` is set, i.e. it also covers "fix a live mistake before the game even finishes," not only the reopen-then-correct flow. `authRole` from Task 1's outlet-context addition.
- Produces: `CorrectionPanel` component, props `{game, onReopen(), onCorrect(correctedState)}`. `loginAs(request, context, baseURL, email)` in `helpers.js`, a generalization of the existing `loginAsOperator` (which becomes a thin wrapper) — every existing call site of `loginAsOperator` keeps working unchanged.

- [ ] **Step 1: Generalize the login helper**

Replace the full file `tests/e2e/pickleball/helpers.js`:

```js
// Playwright's `request` and `page` fixtures do NOT share a cookie jar in
// this project's Playwright version -- confirmed by a diagnostic run where
// `page.request.get('/api/pickleball/auth/session')` came back 401 right
// after `request.post('/api/pickleball/auth/test-login', ...)` had already
// succeeded. The fallback is to pull the Set-Cookie header off the login
// response and hand it to `page.context().addCookies([...])` explicitly
// before the WebSocket ever opens in the page. Every spec that logs in via
// `request` and then opens a socket (or navigates) via `page` should reuse
// this same helper rather than re-implementing the cookie-bridging inline.
export async function loginAs(request, context, baseURL, email) {
  const loginResponse = await request.post('/api/pickleball/auth/test-login', { data: { email } })
  const setCookie = loginResponse.headers()['set-cookie']
  const [nameValue] = setCookie.split(';')
  const separatorIndex = nameValue.indexOf('=')
  const name = nameValue.slice(0, separatorIndex)
  const value = nameValue.slice(separatorIndex + 1)
  await context.addCookies([{ name, value, url: baseURL }])
  return loginResponse
}

export async function loginAsOperator(request, context, baseURL) {
  return loginAs(request, context, baseURL, 'operator@example.com')
}
```

- [ ] **Step 2: Create `CorrectionPanel.jsx`**

```jsx
import { useState } from 'react'

export default function CorrectionPanel({ game, onReopen, onCorrect }) {
  const [scoreA, setScoreA] = useState(String(game.scoreA))
  const [scoreB, setScoreB] = useState(String(game.scoreB))
  const [servingTeam, setServingTeam] = useState(game.servingTeam)
  const [serverNumber, setServerNumber] = useState(String(game.serverNumber))

  function handleSubmit(event) {
    event.preventDefault()
    onCorrect({
      scoreA: Number(scoreA),
      scoreB: Number(scoreB),
      servingTeam,
      serverNumber: Number(serverNumber),
    })
  }

  return (
    <div className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4" data-testid="correction-panel">
      <p className="text-sm font-semibold text-amber-900">Correction panel</p>

      {game.status === 'FINISHED' ? (
        <button
          type="button"
          onClick={onReopen}
          className="rounded border border-amber-400 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100"
        >
          Reopen game
        </button>
      ) : null}

      {game.status === 'IN_PROGRESS' ? (
        <form className="space-y-2" onSubmit={handleSubmit}>
          <div className="flex gap-2">
            <label className="block text-xs">
              <span className="mb-1 block font-medium text-amber-900">Score A</span>
              <input
                type="number"
                min="0"
                value={scoreA}
                onChange={(event) => setScoreA(event.target.value)}
                data-testid="correction-score-a"
                className="w-20 rounded border border-amber-300 px-2 py-1 text-sm"
              />
            </label>
            <label className="block text-xs">
              <span className="mb-1 block font-medium text-amber-900">Score B</span>
              <input
                type="number"
                min="0"
                value={scoreB}
                onChange={(event) => setScoreB(event.target.value)}
                data-testid="correction-score-b"
                className="w-20 rounded border border-amber-300 px-2 py-1 text-sm"
              />
            </label>
          </div>
          <label className="block text-xs">
            <span className="mb-1 block font-medium text-amber-900">Serving team</span>
            <select value={servingTeam} onChange={(event) => setServingTeam(event.target.value)} className="rounded border border-amber-300 px-2 py-1 text-sm">
              <option value="A">Team A</option>
              <option value="B">Team B</option>
            </select>
          </label>
          {game.format === 'DOUBLES' ? (
            <label className="block text-xs">
              <span className="mb-1 block font-medium text-amber-900">Server number</span>
              <select value={serverNumber} onChange={(event) => setServerNumber(event.target.value)} className="rounded border border-amber-300 px-2 py-1 text-sm">
                <option value="1">1</option>
                <option value="2">2</option>
              </select>
            </label>
          ) : null}
          <button type="submit" className="rounded bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700">
            Save correction
          </button>
        </form>
      ) : null}
    </div>
  )
}
```

Note: the server-number field is hidden entirely for `SINGLES` games — singles has no server-1/server-2 concept (`gameState.ts`'s `initialGameState` never gives a singles game `serverNumber: 2`), so exposing the selector would let an operator submit a value the format doesn't mean anything for.

- [ ] **Step 3: Wire it into `ScorekeeperPage.jsx`, gated on `authRole`**

Replace the full file:

```jsx
import { useEffect, useState } from 'react'
import { useOutletContext, useParams } from 'react-router-dom'
import { pickleballApi } from '../lib/pickleballApi'
import { officialScoreCall, contextualState, hasGameBeenWon } from '../../lib/pickleball/scoring/display'
import ContextualBanner from '../components/ContextualBanner'
import ScorekeeperControls from '../components/ScorekeeperControls'
import CorrectionPanel from '../components/CorrectionPanel'

export default function ScorekeeperPage() {
  const { gameId } = useParams()
  const { sessionId, snapshot, authRole } = useOutletContext()
  const [rulesets, setRulesets] = useState(null)
  const [message, setMessage] = useState(null)
  const [lastOutcome, setLastOutcome] = useState(null)

  useEffect(() => {
    let ignore = false
    pickleballApi
      .get('/api/pickleball/scoring-rulesets')
      .then((data) => {
        if (!ignore) setRulesets(data.rulesets)
      })
      .catch(() => {
        if (!ignore) setRulesets([])
      })
    return () => {
      ignore = true
    }
  }, [])

  if (!snapshot || rulesets === null) return <p className="text-sm text-slate-500">Loading…</p>

  const game = snapshot.games.find((g) => g.id === gameId)
  if (!game) return <p className="text-sm text-rose-600">Game not found.</p>

  const ruleset = rulesets.find((r) => r.id === game.scoringRulesetId)
  if (!ruleset) return <p className="text-sm text-rose-600">Unknown scoring ruleset for this game.</p>

  const state = { scoreA: game.scoreA, scoreB: game.scoreB, servingTeam: game.servingTeam, serverNumber: game.serverNumber }
  const gameWon = hasGameBeenWon(state, ruleset)
  const activeOutcome = lastOutcome && lastOutcome.revision === game.revision ? lastOutcome.outcome : null
  const banner = contextualState(state, ruleset, activeOutcome)
  const canCorrect = authRole === 'ADMIN' || authRole === 'SESSION_FACILITATOR'

  async function handleRally(winningTeam) {
    setMessage(null)
    try {
      const result = await pickleballApi.post(`/api/pickleball/sessions/${sessionId}/games/${gameId}/rally`, { winningTeam })
      setLastOutcome({ revision: result.game.revision, outcome: result.outcome })
    } catch (error) {
      setMessage({ type: 'error', text: error.message })
    }
  }

  async function handleUndo() {
    setMessage(null)
    try {
      await pickleballApi.post(`/api/pickleball/sessions/${sessionId}/games/${gameId}/undo`, {})
      setLastOutcome(null)
    } catch (error) {
      setMessage({ type: 'error', text: error.message })
    }
  }

  async function handleFinish() {
    setMessage(null)
    try {
      await pickleballApi.post(`/api/pickleball/sessions/${sessionId}/games/${gameId}/finish`, {})
    } catch (error) {
      setMessage({ type: 'error', text: error.message })
    }
  }

  async function handleReopen() {
    setMessage(null)
    try {
      await pickleballApi.post(`/api/pickleball/sessions/${sessionId}/games/${gameId}/reopen`, {})
    } catch (error) {
      setMessage({ type: 'error', text: error.message })
    }
  }

  async function handleCorrect(correctedState) {
    setMessage(null)
    try {
      await pickleballApi.post(`/api/pickleball/sessions/${sessionId}/games/${gameId}/correct`, correctedState)
    } catch (error) {
      setMessage({ type: 'error', text: error.message })
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900">Scorekeeper</h1>
      {message ? <p className="text-sm text-rose-600">{message.text}</p> : null}
      <ContextualBanner value={banner} />
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-center">
        <p data-testid="scorekeeper-score" className="text-4xl font-bold text-slate-900">{game.scoreA} – {game.scoreB}</p>
        <p data-testid="scorekeeper-official-call" className="mt-2 text-sm text-slate-500">
          Serving: Team {game.servingTeam} · Call: {officialScoreCall(state, ruleset.format)}
        </p>
      </div>
      {game.status === 'IN_PROGRESS' && !game.correctionPending ? (
        <ScorekeeperControls onRally={handleRally} onUndo={handleUndo} onFinish={handleFinish} isGameWon={gameWon} />
      ) : null}
      {game.status === 'IN_PROGRESS' && game.correctionPending ? (
        <p className="text-sm text-amber-700">This game is under correction. Use the correction panel below.</p>
      ) : null}
      {game.status === 'FINISHED' ? (
        <p className="text-sm text-slate-600">Game finished: {game.finalScoreA} – {game.finalScoreB}.</p>
      ) : null}
      {canCorrect ? <CorrectionPanel game={game} onReopen={handleReopen} onCorrect={handleCorrect} /> : null}
    </div>
  )
}
```

- [ ] **Step 4: Write the e2e test**

Reuses the existing `scorekeeper@example.com` SCOREKEEPER-provisioning pattern already established in `pickleball-crud.spec.js` (`POST /api/pickleball/organizations/:activeOrgId/memberships` with `{invitedEmail, role}`). Append to `tests/e2e/pickleball/pickleball-operator-ui.spec.js` (update the import line at the top of the file first: `import { loginAsOperator, loginAs } from './helpers.js'`):

```js
test('the correction panel is visible to an ADMIN, hidden from a SCOREKEEPER, and reopen/correct work', async ({ page, request, context, browser }) => {
  const baseURL = test.info().project.use.baseURL
  await loginAsOperator(request, context, baseURL)

  const venueResponse = await request.post('/api/pickleball/venues', { data: { name: `Correction Panel Venue ${Date.now()}` } })
  const venueId = (await venueResponse.json()).venue.id
  await request.post('/api/pickleball/courts', { data: { venueId, name: 'Court 1' } })
  const sessionResponse = await request.post('/api/pickleball/sessions', {
    data: {
      venueId, name: `Correction Panel Session ${Date.now()}`, sessionType: 'OPEN_PLAY',
      scoringRulesetId: 'usap-2026-sideout-11-doubles',
      scheduledStart: '2026-09-01T18:00:00.000Z', scheduledEnd: '2026-09-01T22:00:00.000Z',
    },
  })
  const sessionId = (await sessionResponse.json()).session.id
  await request.post(`/api/pickleball/sessions/${sessionId}/status`, { data: { status: 'OPEN_FOR_CHECKIN' } })
  await request.post(`/api/pickleball/sessions/${sessionId}/status`, { data: { status: 'LIVE' } })
  const sessionCourtId = (await (await request.get(`/api/pickleball/sessions/${sessionId}/courts`)).json()).courts[0].id

  for (let i = 0; i < 4; i += 1) {
    const playerId = (await (await request.post('/api/pickleball/players', { data: { displayName: `Correction Panel Player ${i}-${Date.now()}` } })).json()).player.id
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
  const finishResponse = await request.post(`/api/pickleball/sessions/${sessionId}/games/${gameId}/finish`, { data: {} })
  expect(finishResponse.ok()).toBe(true)

  await page.goto(`/pickleball/app/sessions/${sessionId}/games/${gameId}`)
  await expect(page.getByTestId('correction-panel')).toBeVisible()

  await page.getByRole('button', { name: 'Reopen game' }).click()
  await expect(page.getByText('This game is under correction.')).toBeVisible({ timeout: 10000 })

  await page.getByTestId('correction-score-a').fill('9')
  await page.getByTestId('correction-score-b').fill('7')
  await page.getByRole('button', { name: 'Save correction' }).click()
  await expect(page.getByTestId('scorekeeper-score')).toHaveText('9 – 7', { timeout: 10000 })

  const sessionInfo = await (await request.get('/api/pickleball/auth/session')).json()
  const inviteResponse = await request.post(`/api/pickleball/organizations/${sessionInfo.activeOrgId}/memberships`, {
    data: { invitedEmail: 'scorekeeper@example.com', role: 'SCOREKEEPER' },
  })
  expect(inviteResponse.ok()).toBe(true)

  const scorekeeperContext = await browser.newContext()
  const scorekeeperPage = await scorekeeperContext.newPage()
  await loginAs(request, scorekeeperContext, baseURL, 'scorekeeper@example.com')
  await scorekeeperPage.goto(`/pickleball/app/sessions/${sessionId}/games/${gameId}`)
  await expect(scorekeeperPage.getByTestId('scorekeeper-score')).toBeVisible({ timeout: 10000 })
  await expect(scorekeeperPage.getByTestId('correction-panel')).toHaveCount(0)
  await scorekeeperContext.close()
})
```

- [ ] **Step 5: Run the new test**

Run: `npx playwright test tests/e2e/pickleball/pickleball-operator-ui.spec.js --project=worker -g "correction panel is visible"`
Expected: PASS.

- [ ] **Step 6: Run the full touched-file regression**

Run: `npx playwright test tests/e2e/pickleball/pickleball-operator-ui.spec.js --project=worker`
Expected: all tests in the file pass (this file's own established convention — see this plan's Global Constraints and every prior task's regression step).

- [ ] **Step 7: Commit**

```bash
git add src/pickleball-app/components/CorrectionPanel.jsx src/pickleball-app/pages/ScorekeeperPage.jsx tests/e2e/pickleball/helpers.js tests/e2e/pickleball/pickleball-operator-ui.spec.js
git commit -m "feat: add the role-gated correction panel to the Scorekeeper page"
```

---

### Task 5: Public live-view page

A small, new, unauthenticated Astro page + React island, plus the one missing piece of backend plumbing an operator needs to actually find their session's public link: nothing today exposes a session's public join-code to the SPA.

**Files:**
- Modify: `src/worker/repositories/pickleball/publicSessionTokens.js`
- Create: `src/pages/api/pickleball/sessions/[id]/public-code.ts`
- Modify: `src/pickleball-app/pages/SessionControlPage.jsx`
- Create: `src/pickleball-app/LiveView.jsx`
- Create: `src/pages/pickleball/live/[code].astro`
- Test: `tests/e2e/pickleball/pickleball-operator-ui.spec.js`

**Interfaces:**
- Consumes: `GET /api/pickleball/public/:code/state` → sanitized `{session:{id,name,sessionType,status}, courts:[{id,courtName,status,currentGameId}], games:[{id,sessionCourtId,format,status,scoreA,scoreB,servingTeam,serverNumber,winningTeamId,finalScoreA,finalScoreB}]}` (already built). `useSessionRealtime(wsUrl)` pointed at `/pickleball/rt/public/:code` — same hook, same sanitized payload shape on every `STATE` message (already built, the DO's public channel branch already returns `toPublicSessionView(...)`).
- Produces: `getPublicCodeForSession(db, sessionId, organizationId)` → `string | null`. `GET /api/pickleball/sessions/:id/public-code` → `{code}` or 404. Every new session already gets a public token row at creation (`buildCreatePublicSessionTokenStatement`, called by `POST /api/pickleball/sessions` — confirmed already wired, no change needed there), and `public_view_enabled` defaults to `1` — so this route works for every session that exists today without any further setup.

- [ ] **Step 1: Add the tenancy-safe repository lookup**

Append to `src/worker/repositories/pickleball/publicSessionTokens.js`:

```js
// Tenancy-safe lookup for the operator UI: joins through pickleball_sessions
// so a caller can never resolve another org's session's code by guessing a
// session id -- same tenancy pattern as getSession's own organization_id
// filter.
export async function getPublicCodeForSession(db, sessionId, organizationId) {
  const row = await db
    .prepare(
      `SELECT t.public_code
       FROM public_session_tokens t
       JOIN pickleball_sessions s ON s.id = t.session_id
       WHERE t.session_id = ? AND s.organization_id = ? AND t.revoked_at IS NULL`,
    )
    .bind(sessionId, organizationId)
    .first()
  return row ? row.public_code : null
}
```

- [ ] **Step 2: Add the route**

Create `src/pages/api/pickleball/sessions/[id]/public-code.ts` (same 5-level relative import depth as its sibling `src/pages/api/pickleball/sessions/[id]/status.ts`):

```ts
import type { APIRoute } from 'astro'
import { requirePickleballSession } from '../../../../../worker/pickleball/authContext.js'
import { getSession } from '../../../../../worker/repositories/pickleball/sessions.js'
import { getPublicCodeForSession } from '../../../../../worker/repositories/pickleball/publicSessionTokens.js'
import { jsonResponse } from '../../../../../worker/utils/responses.js'
import { getEnv } from '../../../../../lib/env'

export const GET: APIRoute = async ({ request, params }) => {
  const env = getEnv()
  try {
    const session = await requirePickleballSession(request, env)
    const sessionId = params.id as string
    const pickleballSession = await getSession(env.PICKLEBALL_DB, sessionId, session.activeOrgId)
    if (!pickleballSession) return jsonResponse({ error: 'Not found.' }, 404)

    const code = await getPublicCodeForSession(env.PICKLEBALL_DB, sessionId, session.activeOrgId)
    if (!code) return jsonResponse({ error: 'No public link for this session.' }, 404)

    return jsonResponse({ code }, 200)
  } catch (error: any) {
    return jsonResponse({ error: error.message }, error.status || 500)
  }
}
```

No `can()` permission check — matches every other session-scoped read route in this codebase (confirmed convention: any org member who can view the session can see its public link).

- [ ] **Step 3: Surface the link on `SessionControlPage.jsx`**

Replace the full file:

```jsx
import { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { pickleballApi } from '../lib/pickleballApi'

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
      {publicCode ? (
        <p className="text-sm text-slate-500">
          Public live view:{' '}
          <a
            data-testid="public-live-link"
            href={`/pickleball/live/${publicCode}`}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-brand underline"
          >
            /pickleball/live/{publicCode}
          </a>
        </p>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 4: Create the React island `LiveView.jsx`**

A top-level file (like `PickleballApp.jsx`), not under `pages/` — it is not part of the authenticated SPA's router.

```jsx
import { useEffect, useState } from 'react'
import { useSessionRealtime } from './lib/useSessionRealtime'

export default function LiveView({ code }) {
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
  const view = snapshot || initial

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

- [ ] **Step 5: Create the Astro page**

Mirrors `src/pages/pickleball/app/[...path].astro`'s `client:only="react"` convention, with the `public-page` body class (`src/index.css`'s existing dark public theme) and a single dynamic `:code` param — the first Astro page in this subtree to take one.

```astro
---
import '../../../index.css'
import LiveView from '../../../pickleball-app/LiveView.jsx'

const { code } = Astro.params
---

<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="robots" content="noindex, nofollow" />
    <title>Devlab Pickleball — Live</title>
  </head>
  <body class="public-page">
    <div id="pickleball-live-root">
      <LiveView code={code} client:only="react" />
    </div>
  </body>
</html>
```

- [ ] **Step 6: Write the e2e test**

```js
test('the public live view shows a session\'s courts and games without authentication', async ({ page, request, context }) => {
  const baseURL = test.info().project.use.baseURL
  await loginAsOperator(request, context, baseURL)

  const venueResponse = await request.post('/api/pickleball/venues', { data: { name: `Public View Venue ${Date.now()}` } })
  const venueId = (await venueResponse.json()).venue.id
  await request.post('/api/pickleball/courts', { data: { venueId, name: 'Court 1' } })
  const sessionResponse = await request.post('/api/pickleball/sessions', {
    data: {
      venueId, name: `Public View Session ${Date.now()}`, sessionType: 'OPEN_PLAY',
      scoringRulesetId: 'usap-2026-sideout-11-doubles',
      scheduledStart: '2026-09-01T18:00:00.000Z', scheduledEnd: '2026-09-01T22:00:00.000Z',
    },
  })
  const sessionId = (await sessionResponse.json()).session.id

  const codeResponse = await request.get(`/api/pickleball/sessions/${sessionId}/public-code`)
  expect(codeResponse.ok()).toBe(true)
  const { code } = await codeResponse.json()

  // A brand-new, unauthenticated browser context -- no cookies at all --
  // proves this page genuinely needs no login.
  const publicContext = await context.browser().newContext()
  const publicPage = await publicContext.newPage()
  await publicPage.goto(`/pickleball/live/${code}`)

  await expect(publicPage.getByText('Court 1')).toBeVisible({ timeout: 10000 })
  await expect(publicPage.getByTestId('live-courts').getByText('No game in progress.')).toBeVisible()
  await publicContext.close()
})
```

- [ ] **Step 7: Run the new test**

Run: `npx playwright test tests/e2e/pickleball/pickleball-operator-ui.spec.js --project=worker -g "public live view shows"`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/worker/repositories/pickleball/publicSessionTokens.js src/pages/api/pickleball/sessions/\[id\]/public-code.ts src/pickleball-app/pages/SessionControlPage.jsx src/pickleball-app/LiveView.jsx src/pages/pickleball/live/\[code\].astro tests/e2e/pickleball/pickleball-operator-ui.spec.js
git commit -m "feat: add the public live-view page and a way for operators to find its link"
```

---

### Task 6: Two-browser-context live-update proof (spec's Testing section requirement)

The spec's Testing section calls for "a two-browser-context test proving a live update in one operator's browser appears in a second connected client's browser without a reload — the actual point of this whole sub-project." Plan B's own final review confirmed this specific coverage still didn't exist anywhere in the sub-project. This task closes it, using exactly the two screens this plan just built: an operator recording a rally through the real Scorekeeper UI, and a second, fully independent, unauthenticated browser context watching the public live view update from its own broadcast.

**Files:**
- Test: `tests/e2e/pickleball/pickleball-operator-ui.spec.js`

**Interfaces:**
- Consumes: everything built in Tasks 1-5 of this plan. No production code changes in this task — it is a pure test-coverage capstone.

- [ ] **Step 1: Write the test**

```js
test('a rally recorded by an operator through the Scorekeeper page appears on the public live view without a reload', async ({ page, request, context }) => {
  const baseURL = test.info().project.use.baseURL
  await loginAsOperator(request, context, baseURL)

  const venueResponse = await request.post('/api/pickleball/venues', { data: { name: `Two Context Venue ${Date.now()}` } })
  const venueId = (await venueResponse.json()).venue.id
  await request.post('/api/pickleball/courts', { data: { venueId, name: 'Court 1' } })
  const sessionResponse = await request.post('/api/pickleball/sessions', {
    data: {
      venueId, name: `Two Context Session ${Date.now()}`, sessionType: 'OPEN_PLAY',
      scoringRulesetId: 'usap-2026-sideout-11-doubles',
      scheduledStart: '2026-09-01T18:00:00.000Z', scheduledEnd: '2026-09-01T22:00:00.000Z',
    },
  })
  const sessionId = (await sessionResponse.json()).session.id
  await request.post(`/api/pickleball/sessions/${sessionId}/status`, { data: { status: 'OPEN_FOR_CHECKIN' } })
  await request.post(`/api/pickleball/sessions/${sessionId}/status`, { data: { status: 'LIVE' } })
  const sessionCourtId = (await (await request.get(`/api/pickleball/sessions/${sessionId}/courts`)).json()).courts[0].id

  for (let i = 0; i < 4; i += 1) {
    const playerId = (await (await request.post('/api/pickleball/players', { data: { displayName: `Two Context Player ${i}-${Date.now()}` } })).json()).player.id
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

  const code = (await (await request.get(`/api/pickleball/sessions/${sessionId}/public-code`)).json()).code

  // Second, fully independent browser context: no cookies, no shared state
  // with the operator's `page`/`context` at all -- this is the "second
  // connected client" the spec's Testing section describes.
  const publicContext = await context.browser().newContext()
  const publicPage = await publicContext.newPage()
  await publicPage.goto(`/pickleball/live/${code}`)
  await expect(publicPage.getByTestId('live-courts').getByText('0 – 0')).toBeVisible({ timeout: 10000 })

  // The operator records a rally through the actual Scorekeeper UI.
  await page.goto(`/pickleball/app/sessions/${sessionId}/games/${gameId}`)
  await page.getByRole('button', { name: 'TEAM A WON RALLY' }).click()
  await expect(page.getByTestId('scorekeeper-score')).toHaveText('1 – 0', { timeout: 10000 })

  // The public viewer's own DOM updates from its own broadcast -- no reload
  // anywhere in this test, and no interaction with `publicPage` at all
  // between its initial `goto` and this assertion.
  await expect(publicPage.getByTestId('live-courts').getByText('1 – 0')).toBeVisible({ timeout: 10000 })

  await publicContext.close()
})
```

- [ ] **Step 2: Run the new test**

Run: `npx playwright test tests/e2e/pickleball/pickleball-operator-ui.spec.js --project=worker -g "appears on the public live view without a reload"`
Expected: PASS.

- [ ] **Step 3: Run the full touched-file regression one more time**

Run: `npx playwright test tests/e2e/pickleball/pickleball-operator-ui.spec.js --project=worker`
Run: `npx playwright test tests/e2e/pickleball/pickleball-crud.spec.js --project=worker`
Run: `npx vitest run`
Expected: all pass (per this sub-project's documented wrangler-under-full-multi-file-run flakiness, a combined cross-file Playwright run is not the bar — these individual/touched-file runs are).

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/pickleball/pickleball-operator-ui.spec.js
git commit -m "test: add the two-browser-context live-update proof for the operator/public split"
```

---

## Out of scope

- **`Abandon` (`POST .../abandon`)** — a real, already-built REST capability, but spec §7.4's UI description names only the two rally buttons, undo, and the correction panel; there is no "abandon this game" control in the spec's own interaction model, and nothing in the golden path dead-ends without it (unlike Finish, which the UI must offer once a game is won). Left unbuilt; a real gap if a future need arises, not a silent one.
- **TV-specific styling for the public view** — explicitly deferred by the spec itself (Decision 3 / Out of scope): the same feed will serve a TV layout later with no backend change.
- **A UI toggle for `publicViewEnabled`** — every session already has public view enabled by default at creation (`public_view_enabled` defaults to `1` in `buildCreateSessionStatement`), and nothing in the spec calls for an operator-facing way to turn it off. Every session's public link is reachable today; opting out is a future capability, not a silent gap in this one.
- **The three still-non-broadcasting mutations** (session status, court enable/disable) flagged by the realtime infrastructure sub-project's final review — inherited, unrelated to anything this plan touches.
- **OPI/leaderboard display** — Phase 5, no data exists yet.

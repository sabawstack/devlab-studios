# Devlab Pickleball — Operator SPA, Scorekeeper, and Public Live View Design

> **Superseded (2026-10-12).** This describes the logged-in operator app, retired in 2.0.0 by Phase 5 of `docs/superpowers/specs/2026-10-11-pickleball-free-open-play-design.md`. Kept as history: the routes, tables and files it names no longer exist.

**Sub-project 2 of Phase 4.1** (sub-project 1, realtime infrastructure, is merged to `main`). This spec covers the entire remaining UI surface for Phase 4.1: the authenticated operator SPA (players/venues/sessions management, check-in, queue, courts, games), the interactive scorekeeper/correction screen, and a plain (non-TV-styled) public live view page. Parent specs: `docs/superpowers/specs/2026-08-24-devlab-pickleball-design.md` (§7, §11), `docs/superpowers/specs/2026-08-25-devlab-pickleball-realtime-design.md` (the WebSocket layer this UI consumes).

## Context

`src/pickleball-app/` currently has only a login page and a stub dashboard ("Session and queue management arrive in later phases") — no session/queue/court/games UI exists. The realtime infrastructure sub-project built the entire backend this UI needs: an operator WebSocket channel (full session state, broadcasts on every mutation), a public channel (sanitized, anonymous), and a REST API surface covering every command. This sub-project builds the UI on top of that already-complete backend — no new backend work is anticipated, though gaps discovered during implementation get ledgered and ruled on the same way every prior phase in this project has handled them.

House style, confirmed by direct inspection of `src/admin-app/` (the established precedent this SPA must mirror): `createBrowserRouter` + nested layout routes using `<Outlet/>`, a thin `fetch`-based API client (`get/post/put/delete`, `credentials: 'include'`, errors as `Error` with `.status`/`.issues`), Tailwind utility classes, no state-management library, `client:only="react"` mounted via an Astro catch-all route.

## Decisions

1. **Live-data wiring: WebSocket-driven from the start**, not REST-poll-then-upgrade-later. A new session-scoped layout route (`SessionLayout`) opens the operator WebSocket connection once per session and shares the resulting snapshot with every nested page via React Router's built-in `useOutletContext()` — the router's own mechanism for "shell provides state to nested routes," not a new state-management concept for this codebase. Every action (join queue, assign court, record rally, etc.) is a REST call whose own response is used only for error handling; the UI update comes from the next broadcast, which is the actual point of the realtime layer existing.
2. **Games page scope: the full interactive scorekeeper screen, not a read-only list.** Originally scoped as a separate sub-project 3; the user chose to fold it into this one. `/sessions/:id/games/:gameId` implements spec §7.4's contract literally.
3. **Plain public live view is in this cycle**, not deferred. `/pickleball/live/[code]` (a separate Astro page, outside the authenticated SPA, per §11) uses the same WebSocket-hook pattern pointed at the public channel — no TV-specific styling, that stays deferred, but the page exists and works.
4. **Players/Venues management pages are in this cycle.** The `AppShell`'s nav already links to `/players` and `/venues` (currently 404 — no routes registered). Basic list+create pages, mirroring `PerItemCollectionPage.jsx`'s pattern, round out the SPA so every nav link works.
5. **Session detail is separate routed pages, not a single tabbed page** — `/sessions/:id/check-in`, `/queue`, `/courts`, `/games` as distinct routes under the `SessionLayout` wrapper, matching spec §11's own route list and `admin-app`'s one-page-per-concern convention. Each is independently linkable and refreshable.
6. **Role-gated UI: hide, don't disable.** The scorekeeper screen's correction panel (reopen/correct) is rendered only for ADMIN/FACILITATOR roles — a SCOREKEEPER never sees the controls at all, rather than seeing them disabled. Matches least-surprise; the REST layer already enforces this server-side regardless, so this is a UX choice, not the security boundary.

## Architecture

```
src/pickleball-app/
  PickleballApp.jsx              (router registration extended)
  components/
    AppShell.jsx                 (extended: real nav links wired to real routes)
    SessionLayout.jsx             (NEW — opens the operator WS connection, renders session header + sub-nav + <Outlet context={...}/>)
    ScorekeeperControls.jsx       (NEW — the 2 rally buttons + undo, per spec §7.4)
    CorrectionPanel.jsx           (NEW — reopen/correct form, ADMIN/FACILITATOR only)
    ContextualBanner.jsx          (NEW — SIDE_OUT/GAME_POINT/TIED_WIN_BY_TWO banner)
  lib/
    pickleballApi.js              (NEW — direct copy of adminApi.js's shape: get/post/put/delete)
    useSessionRealtime.js         (NEW — WS connection hook: connect, reconnect w/ backoff, parse STATE messages, expose {status, snapshot, error})
  pages/
    DashboardPage.jsx             (existing, unchanged)
    LoginPage.jsx                 (existing, unchanged)
    PlayersPage.jsx               (NEW)
    VenuesPage.jsx                (NEW)
    SessionsListPage.jsx          (NEW)
    SessionControlPage.jsx        (NEW — session overview/status, the SessionLayout's index route)
    CheckInPage.jsx                (NEW)
    QueuePage.jsx                  (NEW)
    CourtsPage.jsx                 (NEW)
    GamesListPage.jsx              (NEW)
    ScorekeeperPage.jsx            (NEW — composes ScorekeeperControls + ContextualBanner + CorrectionPanel)

src/pages/pickleball/
  live/[code].astro               (NEW — public live view, separate from the authenticated SPA)
```

**Routes** (all under `/pickleball/app` unless noted):
```
/players                      list + create
/venues                       list + create (courts managed per-venue)
/sessions                     list + "New Session"
/sessions/:id                 SessionLayout (opens WS; children below share it via useOutletContext())
  (index)                     SessionControlPage
  /check-in                   CheckInPage
  /queue                      QueuePage
  /courts                     CourtsPage
  /games                      GamesListPage
  /games/:gameId               ScorekeeperPage

/pickleball/live/:code        (public, unauthenticated, outside the SPA entirely)
```

## Live-data pattern

`useSessionRealtime(sessionId, channel)` — a hook, not a bespoke Context class — owns the WebSocket lifecycle:
- Opens `wss://.../pickleball/rt/{sessionId}` (operator) or `wss://.../pickleball/rt/public/{code}` (public) on mount.
- State: `{ status: 'connecting' | 'open' | 'closed', snapshot: null | SnapshotShape, error: string | null }`.
- On a `STATE` message: replace `snapshot` wholesale (the full-snapshot broadcast design means no merge/patch logic is ever needed client-side — this is the payoff of that backend design choice reaching the UI).
- On close: reconnect with simple capped backoff (1s, 2s, 4s, 8s cap), keeping the last known `snapshot` displayed with a `status: 'closed'` (rendered as a small "reconnecting…" indicator) rather than blanking the page — matches the realtime design's own reconnect-is-just-a-fresh-connect philosophy.
- `SessionLayout` calls this hook once and passes `{ sessionId, ...hookResult }` to `<Outlet context={...}/>`; every nested page reads it via `useOutletContext()`. The public live view page calls the same hook directly (no layout route needed, since it's a single page, not a nested tree).

## Scorekeeper screen (spec §7.4, implemented literally)

- Team A/Team B occupy fixed rows for the whole game — never reordered on a side-out. Only the "Serving" indicator and the official score call's digit order change.
- Always visible: both scores, serving team, current server (doubles), server number, the official score call, and the contextual banner when one applies.
- `officialScoreCall`, `isGamePoint`, `contextualState`, `hasGameBeenWon` are imported directly from `src/lib/pickleball/scoring/display.ts` (already built, already unit-tested) — the screen never re-derives this logic, eliminating any chance of the UI's banner logic drifting from the engine's.
- Two primary buttons only: "TEAM A WON RALLY" / "TEAM B WON RALLY", plus "UNDO LAST RALLY" beside them. No `-1`/`+1` steppers anywhere near this control group.
- Correction panel (reopen/correct) is a visually separate section, rendered only for ADMIN/FACILITATOR (Decision 6).

## Testing

Playwright e2e, following the established house pattern (`tests/e2e/pickleball/`) but genuinely new ground: no UI-level e2e test exists anywhere in this codebase's pickleball suite today, only API-level ones. The first implementation task establishes the pattern (how to drive the React SPA through Playwright's `page` fixture, how to assert on rendered DOM rather than JSON responses) carefully rather than assuming one exists to copy. Coverage: create-a-session-through-check-in-to-a-scored-game as one full happy-path UI test, plus one test per page verifying its core read+write behavior, plus a two-browser-context test proving a live update in one operator's browser appears in a second connected client's browser without a reload (the actual point of this whole sub-project).

## Out of scope

- TV-specific styling/layout for the public view (deferred, per the earlier cost/design discussion — the same feed serves it later with no backend change).
- The three still-non-broadcasting mutations (session status, court enable/disable) flagged by the realtime infrastructure's final review — that gap is inherited, not fixed here, unless discovered to block a specific page (e.g. if `SessionControlPage` needs live status updates, this may need to be revisited — ledgered as a watch item for whichever task builds that page).
- OPI/leaderboard display (Phase 5, not built yet — no data exists for it).

# Pickleball Operator UI/UX Redesign Implementation Plan

> **Superseded (2026-10-12).** This describes the logged-in operator app, retired in 2.0.0 by Phase 5 of `docs/superpowers/specs/2026-10-11-pickleball-free-open-play-design.md`. Kept as history: the routes, tables and files it names no longer exist.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the authenticated Pickleball operator app (`src/pickleball-app/`) into a premium, game-dashboard-style experience — reusing Devlab Studio's existing design tokens exclusively — without touching any backend/scoring/queue/OPI/auth/DB/Durable-Object semantics.

**Architecture:** Extend the existing `.pb-*` CSS layer (`src/pickleball-app/pickleball.css`) and existing `hasPermission`-gated `AppShell.jsx` nav rather than replacing them. Add a small set of new reusable components (metric card, court card, scoreboard, rally panel, queue row, status chip, empty state, illustrations). Bring the app up to a responsive standard already established elsewhere in the repo (`src/admin-app/components/AdminShell.jsx`'s sidebar/drawer pattern). Surface two real backend capabilities the current UI never reads (queue `reasons`, bulk check-in).

**Tech Stack:** Astro 7 (SSR shell) + React 19 / react-router-dom v7 SPA island, Tailwind (default breakpoints, existing `tailwind.config.js` tokens + `src/index.css` custom properties), `lucide-react` (already installed, only icon library in the repo), Playwright 1.62 (existing e2e coverage — no component-level unit-test convention exists in this codebase for React).

**Spec:** docs/superpowers/specs/2026-09-01-pickleball-operator-ui-redesign-design.md

## Global Constraints

- No changes to any file under `src/worker/`, `src/pages/api/pickleball/` (route handlers), `src/lib/pickleball/opi.ts`, `queueEngine.ts`, or any migration. UI reads existing API response shapes; it does not add fields to them.
- `permissions.ts`'s `hasPermission`/`can` logic itself is never modified — only read, exactly as `AppShell.jsx` already does.
- Every new color derives from existing `--brand-*`/`--devlab-dark-*`/`--surface-*`/`--text-*`/`--border-*` tokens (spec Decision 1) or the new `--pb-status-*` set (spec Decision 2) — no new hex values invented ad hoc in a component.
- `lucide-react` is the only icon library, imported via `src/components/icons/icons.js`'s barrel (spec Decision 3) — never `import ... from 'lucide-react'` directly inside a `pickleball-app` file.
- Illustrations are original SVG components under `src/pickleball-app/components/illustrations/` (spec Decision 4) — no third-party vector assets, no raster images.
- Every existing `data-testid`, heading text, button accessible name, and form label currently asserted by the 10 specs under `tests/e2e/pickleball/` must survive unchanged, UNLESS a task's own scope requires a genuinely new element with no prior selector — new selectors are added additively, never by renaming an existing one (spec Decision 8). Each task that touches a page with existing e2e coverage runs that spec file before completing and reports the result.
- No dark/light theme toggle is introduced (spec Decision 9).
- This codebase does not unit-test React components (confirmed by audit) — verification for these tasks is: `npx tsc --noEmit`, the relevant existing Playwright spec(s), a manual/visual check (screenshot where the task's own steps call for it), and `npm run build`. Do not invent a new component-testing convention for this plan.
- Respect `prefers-reduced-motion` for every new animation (live-pulse, hover elevation, card entrance), matching the existing `.pb-live-dot`/`AnimatedIcon` precedent.
- Every status must be communicated by icon + text, never color alone (accessibility, spec Decision 2).

## File Structure

- `src/pickleball-app/pickleball.css` — extended (not replaced): new `--pb-status-*`/`--pb-bg`/`--pb-surface`/etc. custom properties, `.pb-eyebrow`, `.pb-metric-card`, `.pb-court-card` state variants, sidebar collapsed/drawer styles.
- `src/components/icons/icons.js` — additive: new named icon re-exports used by the Pickleball app (Trophy, UserCheck, ListOrdered, Grid, Swords/Activity, LayoutDashboard, Users, Settings, History, Medal, etc.), alongside the ~65 already exported.
- `src/pickleball-app/components/AppShell.jsx` — responsive rework.
- `src/pickleball-app/components/MetricCard.jsx` (new)
- `src/pickleball-app/components/CourtCard.jsx` (new)
- `src/pickleball-app/components/GameScoreboard.jsx` (new)
- `src/pickleball-app/components/RallyActionPanel.jsx` (new)
- `src/pickleball-app/components/QueuePlayerRow.jsx` (new)
- `src/pickleball-app/components/RecommendedMatchCard.jsx` (new)
- `src/pickleball-app/components/PlayerStatusChip.jsx` (new)
- `src/pickleball-app/components/EmptyState.jsx` (new, Pickleball-scoped)
- `src/pickleball-app/components/illustrations/PickleballHeroGraphic.jsx`, `EmptyQueueGraphic.jsx`, `EmptyCourtGraphic.jsx`, `EmptySessionGraphic.jsx` (new)
- `src/pickleball-app/pages/DashboardPage.jsx`, `CourtsPage.jsx`, `GamesListPage.jsx`, `ScorekeeperPage.jsx`, `QueuePage.jsx`, `CheckInPage.jsx`, `PlayerProfilePage.jsx`, `LeaderboardPage.jsx`, `SessionsListPage.jsx`, `SessionControlPage.jsx` — modified to consume the new components.
- `src/pickleball-app/components/ScorekeeperControls.jsx` — logic extracted into `RallyActionPanel.jsx`, file itself may shrink to a thin wrapper or be removed if `RallyActionPanel` fully replaces it (implementer's call, documented in the task report).
- `tests/e2e/pickleball/*.spec.js` — selector/text updates only where Decision 8 requires them.

---

### Task 1: App shell — responsive sidebar/drawer + icon-forward nav

**Files:**
- Modify: `src/pickleball-app/components/AppShell.jsx`
- Modify: `src/pickleball-app/pickleball.css` (sidebar collapsed/drawer styles, `.pb-eyebrow` per spec Decision 6)
- Modify: `src/components/icons/icons.js` (add nav icons)

**Interfaces:**
- Consumes: existing `hasPermission(session, permission)` from `src/lib/pickleball/permissions.ts` (unchanged), existing `NAV_ITEMS` gating pattern (`permission`/`platformAdminOnly` fields).
- Produces: `AppShell.jsx`'s outlet context gains no new fields in this task (isPlatformAdmin/authRole/activeOrgId already present from prior work this session) — this task is pure shell/nav, not data-flow.

- [ ] **Step 1: Read `src/admin-app/components/AdminShell.jsx` in full** to confirm its exact responsive pattern (breakpoint used, drawer markup, backdrop click-to-close, hamburger placement) before writing any new markup — reuse the same structural approach (not the same Tailwind classes verbatim; those follow `.pb-*` styling), so the two shells behave consistently for a user who's used one.

- [ ] **Step 2: Group `NAV_ITEMS` into sections** per the spec's Component Architecture: Overview (Dashboard), Play (Active Session/Check-In/Queue/Courts/Games — these are children of a session, so "Play" section only renders when a session context exists; otherwise these items are omitted, not disabled), Performance (Leaderboard, Players), Management (Sessions, Venues, Operators), System (Settings, Audit Log, Platform). Preserve every existing `permission`/`platformAdminOnly` gate exactly — this is a visual regrouping of the same gated array, not a permission change.

- [ ] **Step 3: Add a `lucide-react` icon per nav item**, importing from `src/components/icons/icons.js` (add any missing icons to that barrel first). Suggested mapping (adjust only if a chosen icon is unavailable in the installed lucide version): Dashboard→`LayoutDashboard`, Sessions→`Calendar`, Check-In→`UserCheck`, Queue→`ListOrdered`, Courts→`Grid3x3` (or `Grid` if that's the actual export name — verify against the installed lucide-react version), Games→`Swords`, Players→`Users`, Leaderboard→`Trophy`, Venues→`MapPin`, Operators→`ShieldCheck`, Settings→`Settings`, Audit Log→`History`, Platform→`Building2`.

- [ ] **Step 4: Implement the responsive shell.** Desktop (`md:` and up): persistent sidebar, collapsible via a `useState` toggle (collapsed state shows icons only, with a tooltip or visually-hidden label per accessibility requirements — do not just hide the label from all users). Below `md`: sidebar becomes a `fixed inset-0` slide-over drawer with a semi-transparent backdrop, triggered by a hamburger button in a new thin top bar that only renders below `md`. Closing: backdrop click, or an explicit close button, or route change.

- [ ] **Step 5: Define `.pb-eyebrow` in `pickleball.css`** (spec Decision 6): small-caps or letter-spaced uppercase, `--text-muted` or `--pb-text-muted`, small font-size — a label style for section headings, since `DashboardPage.jsx:61` already references this class name with no definition today.

- [ ] **Step 6: Verify** — `npx tsc --noEmit -p tsconfig.json`; run `npx playwright test --project=worker tests/e2e/pickleball/pickleball-operator-ui.spec.js` (this is the spec most likely to assert on nav structure — read it first to confirm which assertions apply, e.g. nav link text/hrefs) and any other spec that navigates via sidebar links; fix any selector break by updating the spec per Decision 8, never by reverting the visual change without cause. `npm run build`.

- [ ] **Step 7: Commit.**

---

### Task 2: Dashboard hero + metric cards

**Files:**
- Create: `src/pickleball-app/components/MetricCard.jsx`
- Modify: `src/pickleball-app/pages/DashboardPage.jsx`
- Modify: `src/pickleball-app/pickleball.css` (`.pb-metric-card`)

**Interfaces:**
- Consumes: existing `DashboardPage.jsx` data fetch (session/player counts — read the file first to see its exact current fetch shape; do not add a new API call, this task only changes presentation of already-fetched data).
- Produces: `MetricCard({ icon, label, value, subValue, status })` — reused by Task 3 (court overview count) and any future task needing a metric tile.

- [ ] **Step 1: Read `DashboardPage.jsx` in full** (current: 3 stat tiles + live/upcoming session lists + admin-only quick links) to enumerate every real data field already being fetched — do not invent a metric this page doesn't already have data for (e.g. "games completed today" is only valid if the current fetch already returns it; if it doesn't, this task does not add a new API call to get it — flag as a gap in the task report instead, per Global Constraints' backend-boundary rule).

- [ ] **Step 2: Build `MetricCard.jsx`** — icon (top-left or leading), large numeric value (reuse `.pb-score` styling for numeric emphasis), label, optional `subValue` (e.g. "20 / 24" style comparison), optional `status` chip. Uses `.pb-metric-card` (new class: `--radius-lg`, `--shadow-sm`, hover elevation to `--shadow-md`, existing `--surface-card` background).

- [ ] **Step 3: Build the dashboard hero** — replace the generic heading with a time-of-day greeting ("Good afternoon") + the active/next session's name + a row of `MetricCard`s for that session's real counts (registered/checked-in/queued/playing — only include a metric if the current page's fetch already provides that count; if it currently only provides fewer than these four, use what's real and note the gap). Add "Manage Session" / "Public View" actions if the current dashboard already links to these (check `SessionControlPage.jsx`'s route and the public view link pattern used elsewhere, e.g. `SessionControlPage.jsx`'s existing QR/public-link generation) — do not invent a new route.

- [ ] **Step 4: Add the `.pb-eyebrow` + `.pb-rule` accent** (existing classes, the latter already used elsewhere) above the hero and each major section for visual consistency with the rest of the app.

- [ ] **Step 5: Verify** — `npx tsc --noEmit`; run any Playwright spec asserting on `dashboard-live-sessions`/`dashboard-upcoming-sessions` testids (search `tests/e2e/pickleball/` for `dashboard-`) and confirm these testids are preserved on whatever new markup replaces the old tiles; `npm run build`.

- [ ] **Step 6: Commit.**

---

### Task 3: Court cards + game scoreboard component

**Files:**
- Create: `src/pickleball-app/components/CourtCard.jsx`
- Create: `src/pickleball-app/components/GameScoreboard.jsx`
- Modify: `src/pickleball-app/pages/CourtsPage.jsx`
- Modify: `src/pickleball-app/pages/GamesListPage.jsx`
- Modify: `src/pickleball-app/pickleball.css` (`.pb-court-card` state variants)

**Interfaces:**
- Consumes: existing court/game data shapes already fetched by `CourtsPage.jsx`/`GamesListPage.jsx` (read both files first — do not add new fields).
- Produces: `CourtCard({ court, status: 'LIVE'|'AVAILABLE'|'OUT_OF_SERVICE', game?, onAssign, onOpen })`; `GameScoreboard({ game, variant: 'full'|'compact' })` — `compact` used by `GamesListPage.jsx`'s recent-games list, `full` used by `ScorekeeperPage.jsx` in Task 6.

- [ ] **Step 1: Read `CourtsPage.jsx` and `GamesListPage.jsx` in full**, and the scoring-display helpers at `src/lib/pickleball/scoring/display` (already used by `ScorekeeperPage.jsx` for `officialScoreCall`/`contextualState`/`hasGameBeenWon`) — these display helpers are reused by `GameScoreboard`, not reimplemented.

- [ ] **Step 2: Build `CourtCard.jsx`** per the spec's three states (LIVE shows both team names + score + serving indicator via a compact `GameScoreboard`; AVAILABLE shows "Ready for next match" + an assign action; OUT_OF_SERVICE shows a muted disabled-looking treatment) — every state differentiated by an icon + text label, not color alone. Preserve `CourtsPage.jsx`'s existing assign/release/enable/disable action wiring (same handlers, new visual container).

- [ ] **Step 3: Build `GameScoreboard.jsx`** — team names, large scores either side of a "VS" divider (reusing `.pb-scoreboard`/`.pb-score`), serving team + server number, the official score call string (from the existing display helper), and game-point/tied-win-by-2 state text (from `contextualState`, already computed server-derived — this component only renders it, never recomputes win-by-2 logic itself). `compact` variant drops the VS divider emphasis and server detail for a denser recent-games-list row.

- [ ] **Step 4: Verify** — `npx tsc --noEmit`; run `npx playwright test --project=worker tests/e2e/pickleball/pickleball-games.spec.js` and any spec asserting on `courts-grid`/`games-list`/court action buttons; `npm run build`.

- [ ] **Step 5: Commit.**

---

### Task 4: Queue + recommended-match UI (surfaces `reasons`)

**Files:**
- Create: `src/pickleball-app/components/QueuePlayerRow.jsx`
- Create: `src/pickleball-app/components/RecommendedMatchCard.jsx`
- Modify: `src/pickleball-app/pages/QueuePage.jsx`

**Interfaces:**
- Consumes: `entry.reasons: string[]` — already present on every entry in the `GET /api/pickleball/sessions/[id]/queue/index.ts` response today (spec Context, confirmed by audit) — this task reads it for the first time, does not request a backend change.
- Produces: `QueuePlayerRow({ position, player, gamesPlayed, waitMinutes, reasons? })`; `RecommendedMatchCard({ candidates, onAssign })`.

- [ ] **Step 1: Read `QueuePage.jsx` in full** and confirm the exact current shape of the queue-fetch response (it should already include `reasons` per the backend route read during the audit — verify this by reading `src/pages/api/pickleball/sessions/[id]/queue/index.ts` directly before writing any UI against it).

- [ ] **Step 2: Build `QueuePlayerRow.jsx`** — position number, player name (avatar/initial circle), games-played count, wait-time display, and (new) a small expandable/visible `reasons` list when present — per the brief's Section 16 example ("2 games · waiting 14m"). Preserve the existing "Leave queue" action and its handler.

- [ ] **Step 3: Build `RecommendedMatchCard.jsx`** for the "on courts"/assignment-adjacent panel, if `QueuePage.jsx` currently has (or a sibling page has) a court-assignment entry point that already calls into `selectNextPlayers`'s output — read the relevant assign-court API route/flow first (likely surfaced via `GamesListPage.jsx`'s "ready to start" court list, per the audit) to confirm where the "why these players" reasons should actually render; wire `RecommendedMatchCard` into whichever existing flow already performs the assignment, rather than inventing a new assignment entry point.

- [ ] **Step 4: Verify** — `npx tsc --noEmit`; run `npx playwright test --project=worker tests/e2e/pickleball/pickleball-queue.spec.js`, confirm `queue-waiting-list`/`queue-assigned-list`/`queue-count` testids survive; `npm run build`.

- [ ] **Step 5: Commit.**

---

### Task 5: Check-in + availability UI (surfaces bulk check-in)

**Files:**
- Modify: `src/pickleball-app/pages/CheckInPage.jsx`
- Modify: `src/pickleball-app/components/PlayerStatusChip.jsx` (create if not already created by an earlier task; if Task 3 or 4 hasn't created it yet, create it here)

**Interfaces:**
- Consumes: `POST /api/pickleball/sessions/[id]/players/check-in-bulk.ts` — already implemented, idempotent, permission-gated by `CHECK_IN_PLAYERS` (confirmed by audit) — this task calls it for the first time from the UI.
- Produces: `PlayerStatusChip({ status, icon, label })` used by any page rendering a player's attendance/availability state.

- [ ] **Step 1: Read `CheckInPage.jsx` in full** and the `check-in-bulk.ts` route to confirm its exact request/response shape (does it take an array of player ids? does it return per-player results or a simple success count? — implement against what's actually there).

- [ ] **Step 2: Add a search/filter input** (client-side filter over the already-fetched player list — no new API call) and "Check All" / "Uncheck All" buttons per the brief's Section 17, calling the bulk endpoint. Preserve the existing per-row individual check-in/cancel/availability actions unchanged.

- [ ] **Step 3: Build/reuse `PlayerStatusChip.jsx`** for CHECKED_IN/QUEUED/PLAYING/AVAILABLE/RESTING/etc., each with a distinct icon + text label (never color alone, per Global Constraints).

- [ ] **Step 4: Verify** — `npx tsc --noEmit`; run `npx playwright test --project=worker tests/e2e/pickleball/pickleball-attendance.spec.js`, confirm `checkin-list`/`attendance-counts` testids survive and add new testids for the bulk controls (e.g. `checkin-check-all`, `checkin-uncheck-all`) additively; `npm run build`.

- [ ] **Step 5: Commit.**

---

### Task 6: Scorekeeper screen visual pass

**Files:**
- Modify: `src/pickleball-app/pages/ScorekeeperPage.jsx`
- Modify: `src/pickleball-app/components/ScorekeeperControls.jsx` → extract into `src/pickleball-app/components/RallyActionPanel.jsx` (new)

**Interfaces:**
- Consumes: `GameScoreboard` (Task 3, `full` variant), all existing `ScorekeeperPage.jsx` data/handlers (rally submission, undo, finish, correction-pending gate) — unchanged.
- Produces: `RallyActionPanel({ teamAName, teamBName, onTeamAWon, onTeamBWon, onUndo, canUndo, disabled })`.

- [ ] **Step 1: Read `ScorekeeperPage.jsx` and `ScorekeeperControls.jsx` in full.** Confirm the exact current props/handlers for rally submission, undo, finish, and the `correctionPending` disable gate — this task changes visual presentation only; every handler call and permission gate (`CORRECT_GAME`-gated correction panel) must remain wired identically.

- [ ] **Step 2: Extract `RallyActionPanel.jsx`** from `ScorekeeperControls.jsx`'s existing rally-button logic — two large, mobile-thumb-friendly buttons ("TEAM A WON RALLY" / "TEAM B WON RALLY", using real team names, not literally "TEAM A/B"), an "UNDO LAST RALLY" button, and a conditional "Finish game" button when the game is won. Hard constraint (brief Section 13, non-negotiable): no manual `[-] score [+]` control, no manual "side out" button — the rally-winner buttons are the only scoring input, exactly as today.

- [ ] **Step 3: Rebuild `ScorekeeperPage.jsx`'s visual layout** around `GameScoreboard` (full variant, Task 3) + `RallyActionPanel` + the existing contextual banner (game-point/tied-win-by-2/side-out — reuse `ContextualBanner.jsx` if that's still the right place for this text, per the existing component from earlier this session's sporty restyle) — mobile-first layout ordering per the brief's Section 29 (header → teams/score → serve info → context → rally actions, in that vertical order on narrow viewports).

- [ ] **Step 4: Verify** — `npx tsc --noEmit`; run `npx playwright test --project=worker tests/e2e/pickleball/pickleball-games.spec.js` (covers scoring flows) and confirm `scorekeeper-score`/`scorekeeper-official-call`/`scorekeeper-team-a-row`/`scorekeeper-team-b-row` testids survive exactly; `npm run build`.

- [ ] **Step 5: Commit.**

---

### Task 7: Players / leaderboard / session cards

**Files:**
- Modify: `src/pickleball-app/pages/PlayerProfilePage.jsx`
- Modify: `src/pickleball-app/pages/LeaderboardPage.jsx`
- Modify: `src/pickleball-app/pages/SessionsListPage.jsx`

**Interfaces:**
- Consumes: real OPI data (`PlayerProfilePage.jsx`/`LeaderboardPage.jsx`'s existing fetches — already real per audit, no placeholder needed), existing session status values (DRAFT/CHECK-IN OPEN/LIVE/PAUSED/COMPLETED/CANCELLED — read `SessionsListPage.jsx` to confirm the exact existing status vocabulary before styling it).

- [ ] **Step 1: Read all three files in full** to confirm exact current data shapes — this task is a visual pass over already-real data, not a new fetch.

- [ ] **Step 2: Restyle `PlayerProfilePage.jsx`'s OPI card** per the brief's Section 19 (large OPI number via `.pb-score`, confidence-tier label, games/wins/losses row, points-won percentage, recent-form indicator if the current data includes a per-game recent-results sequence — only if it's already there, do not fabricate one). Add the `[ ? How OPI works ]` tooltip linking to `/pickleball/methodology` (already exists) with the exact non-endorsement copy from the brief's Section 21 if no such tooltip exists yet.

- [ ] **Step 3: Restyle `LeaderboardPage.jsx`** per Section 20 — restrained rank emphasis (top-3 subtle distinction, not a "casino" treatment), OPI + confidence tier + games-played per row, preserving the existing "show provisional players" toggle.

- [ ] **Step 4: Restyle `SessionsListPage.jsx`'s session cards** per Section 23 — status chip using the existing status vocabulary (via `PlayerStatusChip`-style treatment or a dedicated session-status variant), date/time range, registered/checked-in/court counts (only those already fetched), "Open Control Center" action linking to the existing `SessionControlPage.jsx` route.

- [ ] **Step 5: Verify** — `npx tsc --noEmit`; run `npx playwright test --project=worker tests/e2e/pickleball/pickleball-crud.spec.js` and confirm `player-all-time`/`player-sessions`/`leaderboard-list`/`sessions-list` testids survive; `npm run build`.

- [ ] **Step 6: Commit.**

---

### Task 8: Empty/loading/error states + illustrations

**Files:**
- Create: `src/pickleball-app/components/EmptyState.jsx`
- Create: `src/pickleball-app/components/illustrations/PickleballHeroGraphic.jsx`, `EmptyQueueGraphic.jsx`, `EmptyCourtGraphic.jsx`, `EmptySessionGraphic.jsx`
- Modify: any page currently rendering a bare `<p>Loading…</p>` / `<p>No X</p>` (identify via grep across `src/pickleball-app/pages/` for these patterns before starting)

**Interfaces:**
- Produces: `EmptyState({ title, description, illustration?, action? })` — Pickleball-scoped, distinct from `src/components/ui/EmptyState.jsx` (marketing-site, untouched).

- [ ] **Step 1: Grep `src/pickleball-app/pages/` for every hand-rolled "Loading…"/empty-list/error-message string** to build a concrete inventory of every spot this task must touch — do not skip any found.

- [ ] **Step 2: Build the four illustration components** — simple, original SVG compositions (paddle + perforated ball, abstract court lines, ball motion trail, crossed paddles — per spec Decision 4), `currentColor`-based so they inherit from `--brand-*`/`--text-muted` depending on context, `aria-hidden="true"`, no embedded text, kept small (a single `<svg>` with a handful of `<circle>`/`<path>`/`<line>` elements — not an elaborate multi-layer composition).

- [ ] **Step 3: Build `EmptyState.jsx`** — title, description, optional illustration slot, optional CTA button (reusing `.pb-btn-primary`). Wire it into every location found in Step 1: "no active session" (dashboard), "queue empty," "no courts configured," etc., using copy adapted from the brief's Section 26 examples but matching this app's actual real states (do not invent a state that can't currently occur).

- [ ] **Step 4: Add lightweight skeleton-card loading states** (per the brief's Section 34) for the pages that currently show a bare "Loading…" text, sized to roughly match the eventual content's layout so there's no drastic layout shift — reuse `.pb-metric-card`/`.pb-court-card`'s existing dimensions as the skeleton's shape where applicable rather than inventing new skeleton-specific CSS.

- [ ] **Step 5: Verify** — `npx tsc --noEmit`; spot-check (via the project's dev server or a quick Playwright script) that each empty state actually renders on a fresh/empty fixture rather than crashing on missing data; `npm run build`.

- [ ] **Step 6: Commit.**

---

### Task 9: Responsive refinement pass

**Files:**
- Modify: any page/component from Tasks 1-8 found to need `md:`/`lg:` breakpoint adjustments during this pass.

**Interfaces:**
- Consumes: all components built in Tasks 1-8.

- [ ] **Step 1: Using the project's Playwright/browser workflow, render every major screen at three widths** (mobile ~390px, tablet ~820px, desktop ~1440px): Dashboard, Court cards, Active game/Scorekeeper, Queue, Check-in, Players/Leaderboard, Sessions list. Take screenshots at each width for each screen.

- [ ] **Step 2: Fix every issue found** — overflow, text clipping, awkward card-height mismatches in a grid row, touch targets under ~44px on mobile/tablet, wrapping issues in the sidebar/drawer, anything requiring horizontal scroll unintentionally. Prioritize per the brief's Sections 28-30: tablet-first for facilitator screens (Courts/Queue/Check-in), mobile-first for the Scorekeeper screen.

- [ ] **Step 3: Re-screenshot fixed screens** to confirm resolution.

- [ ] **Step 4: Verify** — `npx tsc --noEmit`; run the full `tests/e2e/pickleball/` directory if the sandbox allows it, otherwise run each spec file individually (this repo has documented pre-existing `wrangler dev --local` instability under heavy sequential load in some sandboxes — if hit, report honestly which files were verified individually rather than claiming a full clean directory run); `npm run build`.

- [ ] **Step 5: Commit.**

---

### Task 10: Accessibility + final visual polish

**Files:**
- Modify: any component from Tasks 1-9 found lacking in this pass.

- [ ] **Step 1: Audit for WCAG-oriented contrast** on every new/changed text-on-background combination introduced by this plan (metric cards, status chips, court card states, sidebar collapsed state) — verify against the existing `--text-*`/`--surface-*` token pairings already known to pass contrast elsewhere in the site; flag and fix any new combination that doesn't.

- [ ] **Step 2: Verify keyboard navigation and focus rings** across the new sidebar/drawer, metric cards (if interactive), court card actions, rally buttons, and the check-in bulk controls — every interactive element must have a visible focus state and be reachable via Tab in a sensible order.

- [ ] **Step 3: Verify every status is communicated by icon + text**, not color alone (re-confirm across all of Tasks 1-8's status chips/court states/session status badges).

- [ ] **Step 4: Verify `prefers-reduced-motion` is respected** for every new animated element (card entrance, hover elevation, live-pulse reuse, sidebar collapse transition, drawer open/close transition).

- [ ] **Step 5: Final full checklist**: `npx tsc --noEmit -p tsconfig.json`, `npx vitest run` (repo-wide — confirm no regression outside pickleball, since this plan is UI-only and touches no shared non-pickleball files, but verify), `npm run build`, and either a full `tests/e2e/pickleball/` run or an honest per-file account if the sandbox's documented instability prevents one continuous run.

- [ ] **Step 6: Commit.**

---

## Final checklist

- [ ] `npx tsc --noEmit -p tsconfig.json` clean
- [ ] `npx vitest run` — no regressions (repo-wide; this plan touches no non-UI logic, so this should be unaffected, but confirm)
- [ ] `tests/e2e/pickleball/` — every spec passes (run as one directory if the sandbox allows, else per-file with an honest account)
- [ ] `npm run build` succeeds
- [ ] Every existing `data-testid`/heading/button-name/label from the pre-redesign UI is either unchanged or has a corresponding, deliberate spec update (per Global Constraints)
- [ ] No file under `src/worker/`, `src/pages/api/pickleball/`, `src/lib/pickleball/opi.ts`, `queueEngine.ts`, or any migration was touched
- [ ] Manually walk the facilitator flow end-to-end (arrive → check players in → see queue → assign court → open game → score → finish game) per the brief's Section 47 and confirm it can be operated with minimal explanation

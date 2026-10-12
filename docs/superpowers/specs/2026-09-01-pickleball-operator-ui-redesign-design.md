# Devlab Pickleball — Operator UI/UX Redesign Design

> **Superseded (2026-10-12).** This describes the logged-in operator app, retired in 2.0.0 by Phase 5 of `docs/superpowers/specs/2026-10-11-pickleball-free-open-play-design.md`. Kept as history: the routes, tables and files it names no longer exist.

A UI/UX-only pass over the authenticated Pickleball operator app (`src/pickleball-app/`). No backend, scoring, queue, OPI, auth, database, or Durable Object semantics change. Every visual/interaction decision below is grounded in an audit of the actual current codebase, not invented from scratch — see Context.

## Context

**Devlab Studio's existing design tokens** (`src/index.css:7-65`, `tailwind.config.js`) are the only palette this redesign uses:
- Brand: `--brand-blue #0800ff`, `--brand-indigo #4500ff`, `--brand-violet #6800ff`, `--brand-purple #9200ff`, `--brand-magenta #c000ff`, `--brand-cyan #7d8dff`, `--brand-gradient: linear-gradient(120deg,#c000ff 0%,#7600ff 40%,#1800ff 100%)`.
- Dark scale: `--devlab-dark-950/-900/-850/-800/-750`.
- Surfaces: `--surface-nav`, `--surface-dark`, `--surface-dark-elevated`, `--surface-dark-soft`, `--surface-page`, `--surface-subtle`, `--surface-alt`, `--surface-brand-soft`, `--surface-card`.
- Text: `--text-primary/-secondary/-muted`, `--text-on-dark/-on-dark-secondary/-on-dark-muted`.
- Border: `--border-subtle/-medium/-dark/-dark-strong/-brand-soft`.
- Radius: `--radius-sm 0.75rem / -md 1rem / -lg 1.5rem / -xl 2rem`. Shadows: `--shadow-sm/-md/-elevated`.
- Font: Plus Jakarta Sans (`body`, `src/index.css:79`). No dark/light theme toggle exists anywhere in the site (confirmed absent) — the site is fixed-theme; this redesign introduces no theme system.
- No existing semantic success/warning/danger/info tokens — status colors today are ad-hoc Tailwind utilities scattered per-component. This redesign establishes a small `--pb-status-*` set (Decision 3) rather than continuing that ad-hoc pattern.

**An existing `.pb-*` sporty layer already exists** (`src/pickleball-app/pickleball.css`, 138 lines, added earlier this session): `.pb-sidebar`, `.pb-nav-link`/`--active`, `.pb-rule` (the gradient "serve line" accent), `.pb-tab`/`--active`, `.pb-scoreboard`, `.pb-score`, `.pb-btn-primary`, `.pb-live-dot`. Its own header comment states it composes only `index.css` tokens. This redesign **extends this file**, not replaces it. One latent bug found: `DashboardPage.jsx:61` references a `.pb-eyebrow` class that doesn't exist in `pickleball.css` — fix this as part of Slice 2.

**`AdminShell.jsx` (`src/admin-app/components/AdminShell.jsx:64-141`) is the in-repo precedent for a responsive authenticated shell** — desktop `hidden md:flex` sidebar + mobile `fixed inset-0 md:hidden` slide-over drawer with backdrop, grouped nav sections, hamburger trigger. The current Pickleball `AppShell.jsx` (63 lines) has none of this: fixed `w-56` sidebar, zero responsive breakpoints, no drawer. This redesign brings `AppShell.jsx` up to the same responsive standard, adapted to the `.pb-*` visual language rather than `AdminShell`'s own styling.

**Icon library: `lucide-react` (already `^0.562.0` in `package.json`), re-exported via `src/components/icons/icons.js`.** This is the sole icon system in the repo (also `simple-icons`, unrelated — brand logos only). The Pickleball app currently imports zero icons anywhere. This redesign is the first place icons appear in it, added to the existing `icons.js` barrel rather than importing `lucide-react` directly in page files (matching the codebase's own convention).

**Responsive precedent: none exists in the Pickleball app today.** Only 8 total `sm:`/`lg:` breakpoint usages across the whole app, no `md:` at all, no drawer, no mobile handling — it is effectively desktop-only. Default Tailwind breakpoints are in effect (no `screens` override in `tailwind.config.js`): `sm`640/`md`768/`lg`1024/`xl`1280/`2xl`1536.

**Two real backend capabilities are implemented but currently invisible in the UI — this redesign surfaces both, per the brief's "no fake features" principle applied in reverse (real capability, missing UI, not the other way around):**
1. `src/lib/pickleball/queueEngine.ts`'s `selectNextPlayers()` returns a `reasons: string[]` array per candidate (fewest-games-played, longest-wait, repeat-avoidance) already attached by `GET /api/pickleball/sessions/[id]/queue/index.ts:20-27` to every queue-response entry. `QueuePage.jsx` never reads `entry.reasons` today.
2. `POST /api/pickleball/sessions/[id]/players/check-in-bulk.ts` exists, is permission-gated (`CHECK_IN_PLAYERS`), and is explicitly designed idempotent for a "check all" action. `CheckInPage.jsx` never calls it and has no bulk UI at all.

**OPI, realtime live-view (via `SessionCoordinatorDO`), and rally-driven scoring are all fully implemented, not stubs** — confirmed by reading `opi.ts`, `SessionCoordinatorDO.ts`, `ScorekeeperControls.jsx`, and their consuming pages. This redesign can build rich, real UI against all three with no placeholder/loading-only treatment needed for "not yet implemented" — because they already are.

**Existing shared UI primitives are fragmented and marketing/admin-scoped, not reusable as-is for Pickleball:** `PrimaryButton.jsx` (pill-shaped gradient button) and `GlassCard.jsx`/`EmptyState.jsx`/`ErrorState.jsx` (dark glassmorphism) exist but are never used inside `src/pickleball-app/` — Pickleball already has its own parallel `.pb-btn-primary` button style. This redesign does not attempt to unify these two systems (out of scope, see below); it continues and completes the `.pb-*` system.

**Test-selector surface that must survive this redesign, or be updated in lockstep:** 10 Playwright specs under `tests/e2e/pickleball/` assert on real UI structure — exact heading text, button accessible names, form labels, and ~35 named `data-testid` values (`players-list`, `venues-list`, `courts-list`, `sessions-list`, `checkin-list`, `attendance-counts`, `queue-waiting-list`, `queue-assigned-list`, `courts-grid`, `games-list`, `scorekeeper-score`, `scorekeeper-official-call`, `scorekeeper-team-a-row`/`-team-b-row`, `leaderboard-list`, `audit-events-list`, `operators-list`, `scoring-rulesets-list`, `platform-organizations-list`, `platform-invites-list`, `dashboard-live-sessions`/`-upcoming-sessions`, `player-all-time`, `player-sessions`, `realtime-status`, `live-courts`, `live-leaderboard`, `tv-courts`, `tv-leaderboard`, `public-live-link`, `queue-count`, `courts-count`, `register-player-select`, `session-venue-select`, `session-ruleset-select`, `team-a-server-select`/`team-b-server-select`, `start-game-form-{id}`). Decision 8 below governs how each task handles this.

## Decisions

1. **No new color system.** Every new visual element (metric cards, court cards, status chips, illustrations) derives its color from the existing `--brand-*`/`--devlab-dark-*`/`--surface-*`/`--text-*`/`--border-*` custom properties. New Pickleball-scoped aliases are added to `pickleball.css` as a thin semantic layer on top (`--pb-bg`, `--pb-surface`, `--pb-surface-elevated`, `--pb-border`, `--pb-text`, `--pb-text-muted`, `--pb-primary` → `--brand-indigo`, `--pb-accent` → `--brand-violet`), never as new hex values.

2. **A new status-color set is added, since none currently exists**: `--pb-status-success`, `--pb-status-warning`, `--pb-status-danger`, `--pb-status-info`, chosen from Tailwind's existing emerald/amber/rose/sky families already used ad-hoc across the app today (so this formalizes existing color choices rather than introducing new ones) — mapped to LIVE/AVAILABLE/PLAYING/WAITING/RESTING/OFFLINE per the brief's Section 3, always paired with a text label or icon, never color-alone (accessibility requirement, Section 18/31).

3. **`lucide-react` is the only icon library.** New icons are added to the existing `src/components/icons/icons.js` barrel (not imported directly from `lucide-react` in page files, matching the codebase's own convention). Icon choices per the brief's Section 38 (Trophy for leaderboard, UserCheck for check-in, ListOrdered for queue, Grid for courts, Swords/Activity for games, etc.) — no controller/joystick/gamepad icons anywhere (Section 39).

4. **Illustrations are original, minimal SVG React components**, not raster art and not copied from any reference image. Location: `src/pickleball-app/components/illustrations/` (`PickleballHeroGraphic.jsx`, `EmptyQueueGraphic.jsx`, `EmptyCourtGraphic.jsx`, `EmptySessionGraphic.jsx`), built from simple paddle/ball/court-line geometry using `currentColor` and existing brand tokens, `aria-hidden="true"`, no embedded text. No third-party vector asset is needed given the brief's own preference order places "small original SVG/CSS compositions" ahead of external libraries, and the required motifs (ball perforation, court lines, paddle silhouette) are simple enough to hand-author.

5. **Responsive strategy follows `AdminShell.jsx`'s existing pattern**, restyled to the `.pb-*` dark-sidebar visual language rather than copying `AdminShell`'s own look: desktop `hidden md:flex` persistent sidebar (collapsible via a stored preference, Section 4), mobile/tablet `fixed inset-0 md:hidden` drawer with backdrop and hamburger trigger. Default Tailwind breakpoints (no config change). Tablet is a primary target for the facilitator screens (courts/queue/check-in); mobile is a primary target for the scorekeeper screen — per the brief's Sections 28-30, this drives which screens get bespoke mobile layouts (scorekeeper) versus responsive reflow (dashboard, courts).

6. **`DashboardPage.jsx`'s dead `.pb-eyebrow` class reference is fixed** by defining `.pb-eyebrow` in `pickleball.css` (small-caps, muted, letter-spaced label style — a natural companion to the existing `.pb-rule` accent) rather than removing the reference, since an "eyebrow" label above section headings fits the brief's hero/dashboard design language (Section 6, 9).

7. **The queue's `reasons` array and the bulk check-in endpoint are wired into the UI** as part of this redesign (Slices 4 and 5) — both are real, already-implemented backend capabilities with zero backend risk to surface; this is explicitly not "faking a feature," it's completing UI coverage of an existing API.

8. **Test-selector preservation policy:** every existing `data-testid` and every heading/button/label text string asserted by the 10 existing Playwright specs is preserved exactly, unless a task's own scope requires a genuinely new UI element that has no prior selector (e.g. new bulk check-in buttons, new queue-reasons display) — those get new `data-testid`s additively, never by renaming an existing one. Each implementation task that touches a page with existing e2e coverage must run that spec file and confirm it still passes before completing; if a redesign genuinely requires changing an existing selector's shape (rare — flagged case by case in the plan), the task updates the corresponding spec assertion in the same commit, never leaving a broken test.

9. **No dark/light theme toggle is introduced.** The site has no such mechanism today and the brief does not require one; `pickleball.css` continues to target the single fixed visual treatment it already has (a light `--surface-page` app shell with a dark `.pb-sidebar`/`.pb-scoreboard` for nav and score-critical surfaces — this is the existing convention, not a new "dark mode").

10. **Scope boundary, restated concretely against this codebase**: no changes to `src/worker/pickleball/SessionCoordinatorDO.ts`, any file under `src/worker/repositories/pickleball/`, any file under `src/pages/api/pickleball/` (route handlers), `src/lib/pickleball/opi.ts`, `queueEngine.ts`, `permissions.ts`'s permission *logic* (UI may read `hasPermission`/`session.isPlatformAdmin` to decide what to render, exactly as it already does — it must not change what the function returns or add new permission-bypass logic), or any migration. Every implementation task in the plan touches only `src/pickleball-app/**`, `src/pages/pickleball/**.astro` (thin Astro wrapper pages), `src/pickleball-app/pickleball.css`, `src/components/icons/icons.js` (additive icon exports only), and the corresponding Playwright spec files where selector updates are needed per Decision 8.

## Visual Direction

Premium, technical, energetic, athletic sports-operations dashboard — Devlab Studio's existing brand identity (Plus Jakarta Sans, brand-gradient accents, dark nav/scoreboard surfaces already established by `.pb-*`) combined with modern game-dashboard structure: prominent cards, strong hierarchy, rounded panels (`--radius-lg`/`-xl`), a visually interesting dashboard hero, compact icon-forward sidebar, controlled semantic status color, rich court/game cards, restrained motion (live-pulse, hover elevation, score-change emphasis — all respecting `prefers-reduced-motion`, matching the existing `.pb-live-dot`/`AnimatedIcon` precedent). Explicitly avoided: neon/esports overload, glassmorphism beyond what `GlassCard` already establishes elsewhere in the site (not imported into Pickleball), gambling/casino framing, gamepad/controller iconography, invented colors outside the existing palette.

## Component Architecture

New/changed components, named to fit this codebase's existing `PascalCase.jsx` convention under `src/pickleball-app/`:

- `components/AppShell.jsx` — responsive rework (Decision 5), collapsible desktop sidebar + mobile drawer, icon-forward `NAV_ITEMS` (reusing the existing permission-gated array, now rendering a `lucide-react` icon per item), grouped headers (Overview/Play/Performance/Management/System per the brief's Section 5).
- `components/MetricCard.jsx` — new: icon + number + label + optional micro-status/comparison, used by `DashboardPage.jsx` and `SessionControlPage.jsx`.
- `components/CourtCard.jsx` — new: the three court-state visual treatments (LIVE/AVAILABLE/OUT_OF_SERVICE) described in the brief's Section 11, replacing `CourtsPage.jsx`'s current plain card markup.
- `components/GameScoreboard.jsx` — new, extends the existing `.pb-scoreboard`/`.pb-score` classes into a reusable component (team names, large scores, VS, serving indicator, official call, game-point/tied-win-by-2 state) — used by both `ScorekeeperPage.jsx` and `GamesListPage.jsx`'s recent-game cards, in a `compact` vs full variant.
- `components/RallyActionPanel.jsx` — new: extracts `ScorekeeperControls.jsx`'s rally buttons into a dedicated, mobile-optimized large-touch-target component (Decision unchanged: still only "Team A/B won rally" + undo, never a manual +/- control, per the brief's Section 13 hard constraint).
- `components/QueuePlayerRow.jsx` + `components/RecommendedMatchCard.jsx` — new: surface `entry.reasons` (Decision 7) and the existing `selectNextPlayers` recommendation shape, replacing `QueuePage.jsx`'s current bare list.
- `components/PlayerStatusChip.jsx` — new: the CHECKED_IN/QUEUED/PLAYING/AVAILABLE/RESTING/etc. chip (icon + text + `--pb-status-*` color, never color-alone).
- `components/EmptyState.jsx` (new, Pickleball-scoped — distinct from the marketing-site `src/components/ui/EmptyState.jsx`, which stays untouched) — headline + copy + optional illustration + optional CTA, used across Dashboard/Queue/Courts/Sessions.
- `components/illustrations/*.jsx` — per Decision 4.
- `pickleball.css` — extended with `.pb-eyebrow`, `--pb-status-*` tokens, `.pb-metric-card`, `.pb-court-card` state variants, sidebar collapsed-state styles, drawer/backdrop styles.

## Slices (maps to the implementation plan's task breakdown)

1. App shell + responsive sidebar/drawer + icon-forward nav
2. Dashboard hero + metric cards (+ `.pb-eyebrow` fix)
3. Court cards + active game/scoreboard component
4. Queue + recommended-match UI (surfaces `reasons`)
5. Check-in + availability UI (surfaces bulk check-in)
6. Scorekeeper screen visual pass (rally-driven interaction preserved exactly)
7. Players/leaderboard/session cards (real OPI/session data, no fabrication)
8. Empty/loading/error states + illustrations
9. Responsive refinement pass across all of the above
10. Accessibility + visual polish + Playwright visual review

## Testing

- Existing 10 Playwright specs must continue passing, per Decision 8 — run the relevant spec file(s) after every task that touches a covered page.
- New `data-testid`s added for genuinely new elements (bulk check-in controls, queue-reasons display, collapsed-sidebar toggle, mobile drawer trigger) so future e2e coverage can target them, though writing *new* e2e tests for them is optional per-task (not mandated the way the platform-pilot plan mandated new tests, since this is a visual/UX pass over already-tested flows).
- A final visual review pass (Slice 10) uses the project's Playwright/screenshot workflow to inspect desktop, tablet, and mobile renders of: dashboard, court cards, active game, scorekeeper (mobile), queue, check-in, empty states — fixing any overflow/clipping/contrast/touch-target issues found before declaring the pass complete.
- `npx tsc --noEmit`, `npx vitest run`, `npm run build` after every task, matching this session's established convention.

## Explicitly out of scope

- Any change to scoring rules, win-by-2 target logic, queue selection algorithm, OPI calculation, or permission logic (UI reads these, never redefines them).
- Any change to `SessionCoordinatorDO`, D1 schema/migrations, or API route handlers/response shapes (UI adapts to existing shapes; if a genuinely missing field is needed, that is a finding to report, not something to add to the backend in this pass).
- Unifying the marketing-site (`PrimaryButton`/`GlassCard`) and Pickleball (`.pb-*`) visual systems — they remain two intentionally separate systems, as they are today.
- A dark/light theme toggle.
- Public-view (`LiveView.jsx`/`TVDisplay.jsx`) redesign beyond extracting shared read-only visual primitives (`CourtScoreCard`, `TeamScore`, `LiveBadge`, `LeaderboardRow`, `GameStatusBadge`) that the authenticated views also use — per the brief's Section 42, these primitives may be shared, but no new authenticated action may be coupled into a public component.
- Adding a third-party icon or illustration library — `lucide-react` plus original SVG covers every stated need.

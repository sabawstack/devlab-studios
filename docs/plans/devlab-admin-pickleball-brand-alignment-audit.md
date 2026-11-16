# DevLab Admin and Pickleball: queue clarity, defects and brand alignment

**Status:** specification, being implemented (Phase 15 in `PROGRESS.md`).
**Written:** 2026-11-16 at `2984387` (release 2.6.0). `main`, `origin/main`
and `origin/development` were all at that commit when work started.
**Scope:** DevLab Pickleball (highest priority: a player must always know
whether they are playing, confirmed next, or waiting), DevLab Admin (verified
defects, then a quiet operational workspace on the approved brand), and one
set of shared brand tokens both products consume.

This file is the contract for the work. It is kept current as the work moves:
every engineering deviation is recorded under **Deviations** with its reason,
and the testing matrix names the test that proves each requirement.

## How to read this

- Requirement IDs are stable and used in commits, the CHANGELOG and `PROGRESS.md`.
- P0 = must ship for the group to count as done; P1 = should; P2 = when the
  group has room. Nothing P0 or P1 is dropped silently: if it is not done it is
  listed under **Not done** with the reason.
- File and line references were read at `2984387`. "(reported)" marks a
  reference that came from a search agent and was confirmed before use.

## Owner decisions applied

1. Admin display name **"DevLab Workspace"**: display strings and the document
   title only. Routes, APIs, tables, cookies and storage keys keep their names.
2. Product casing **"DevLab Pickleball"** (written "Devlab Pickleball" 58 times
   at the start).
3. Typography: Admin moves to Space Grotesk, with JetBrains Mono for labels and
   identifiers. Pickleball moves to Space Grotesk **only if** the TV fit tests
   and the 16-court and long-name visual checks show no regression; otherwise it
   keeps Plus Jakarta Sans and the reason is recorded here.
4. Players see "Next four" names only when the server's current state already
   fixes who they are (PB-QUEUE-06). Otherwise no names.
5. The next four are **not** reserved in advance. No matchmaking algorithm changes.
6. "Met least" stays ranked above "waited longest".
7. "Mark do not contact" asks, in its confirmation dialog, whether to suppress
   the whole domain (two screens disagree today).

## Binding rules (summary)

Preview first; production only with the owner's explicit approval. One branch
and one PR per group, stacked so `main` can later be fast-forwarded. CHANGELOG
`[Unreleased]` entry in the same commit as each change; no version bump. TDD
for logic and bug fixes. No new dependency, no D1 migration, no send path, no
change to `LEAD_*` flags, the outbox token logic or any dormant switch.
Synthetic data only. API contracts change additively only; the viewer snapshot
stays an allowlist.

---

## Group 1: verified defects

| ID | Pri | Finding (at `2984387`) | Requirement |
|---|---|---|---|
| CRM-01 | P0 | `SuppressionPage.jsx:116` calls `adminApi.delete(path, { reason })`; `adminApi.delete` (`lib/adminApi.js:30`) takes only a path, so the body is dropped and the route (`api/admin/lead-crm/suppression/index.ts:85-97`, schema `lead-engine/schemas/route.ts:46-64`) answers 400. Removal from the UI always fails. | `adminApi.delete(path, body?)` sends an optional JSON body. Every other caller passes no body and keeps its behaviour. |
| CRM-02 | P1 | `SourcesPage.jsx`: `patch()` catches its own error, then the caller's `.then(() => setIsEditing(false))` closes the editor even after a failed save. | Close the policy editor only on success. |
| ADMIN-05 | P0 | Nothing reacts to a 401 after sign-in. Legacy editors use raw `fetch` and print "Sign in through Cloudflare Access". | One 401 handler in the API client: a re-sign-in dialog over the current screen; the router stays mounted so unsaved edits survive. The legacy editors' raw calls go through the same handler; the Cloudflare Access text is replaced. |
| MAIL-01 | P1 | `ThreadView.jsx` `setThreadState` has `try/finally` without `catch`: a failed state change is silent. | Surface the error. |

## Group 2: Pickleball queue, server read model

### Background (verified in source)

- Proposals are late-bound: `fillProposals` (`open/propose.ts`) proposes one
  `PROPOSED` match per **free** court after every command. While every court is
  playing, nobody is assigned next.
- `queueOrder` (`fairness.ts`) is a priority order (fewest games, then the
  sit-out guard's forced players, then longest wait), not the calling order.
  Each mode then picks four from the fair pool (`modes/shared.ts fairPool`),
  choosing within the last games tier by "met least" (`modes/social.ts`).
- The viewer snapshot (`snapshot.ts toViewerSnapshot`) is an allowlist, guarded
  by `snapshot*.test.ts` and `OpenSessionDO.security.test.ts`.

### Requirements

| ID | Pri | Requirement |
|---|---|---|
| PB-QUEUE-08 | P1 (first) | A test-only simulator that drives `applyCommand` + `finalizeCommand` (the existing `testing/simulate.ts` calls `fillProposals` directly and skips the reducer). Measure per mode and size how often queue positions 1–4 equal the real next four, and how often a state-gated projection is right. Record the numbers below. |
| PB-QUEUE-06 | P1 | Additive viewer fields, no matchmaking or persistence change: `nextUp: { players: Array<{ id, name }> } \| null` and `ViewerCourt.idle`. Both computed in one pure function beside `proposeForCourt`, called from `toViewerSnapshot`; host and captain snapshots embed the viewer snapshot. |
| PB-TOURNAMENT-01 | P1 | `TournamentView.comingUp: Array<{ fixtureId, held: 'PAIR_PLAYING' \| 'ON_BREAK' \| null }>` from `toTournamentView`, reusing the server's own fixture order and busy computation. The client's `nextGames` becomes a lookup. |
| SEC-01 | P1 | Allowlist tests updated with exact key lists for every new field; `nextUp` entries have exactly `id` and `name`; no player is both on an `UP_NEXT` court and in `nextUp`; `nextUp` is null with any proposed match, a free court, fewer than four waiting, an ended session and a tournament. |

**`nextUp` contract (the invariant).** Whenever `nextUp` is non-null it equals
the set of four players the server proposes after any live game ends, whichever
side wins and by any valid score. A property test holds this in all four modes
with keep-together and keep-apart rules, and also asserts `nextUp` is non-null
some of the time so the gate cannot go dead. No team split and no court is
exposed.

**Gate.** Open play; session active; game cap not reached; every enabled court
has a game in progress; nothing proposed; at least four waiting; no
keep-together pair split between court and queue; the fair pool over the
waiting players resolves to a games tier, and every on-court player would have
more games than that tier after finishing (so no finisher can re-enter the
candidate pool). By standing adds two conditions: no two ranked candidates tie
in the standings (a finisher joining a tie group could reorder it by
head-to-head), and the proposal comes from a standings window, not the
rank-distance fallback (which reads absolute ranks the finishers can shift).

**`idle` values.** For an enabled court with no game: `TOO_FEW_PLAYERS`,
`WAITING_FOR_HOST` (no four fit the pairing rules, or the game cap),
`TOURNAMENT_NOT_STARTED`, `WAITING_FOR_RESULT`, `PLAYER_ON_BREAK`,
`SESSION_OVER`; null when the court has a game or is off. The host's free-text
`blocked` string never reaches viewers (it can reveal that pairing rules exist,
and the viewer JSON is tested to contain no `rules` substring).

## Group 3: Pickleball queue, interface

One vocabulary for every role, defined once (`src/pickleball-open/lib/queueVocabulary.js`):

| State | Server truth | Label |
|---|---|---|
| Playing | match `IN_PROGRESS` | "Playing · Court 2" |
| Up next (confirmed) | match `PROPOSED` on a court | "Up next · Court 2 · walk on now" |
| Next four (provisional) | `nextUp` non-null | "Next four · when a court opens" |
| Waiting | active, in no match | "Waiting · order can change" |
| On break | status `BREAK` | "On break" |

At the start the same proposed match was "Up next" on the host card
(`CourtCard.jsx:28`) and "Walk on now" on the board (`ViewerBoard.jsx:22`) and
TV (`TvCourt.jsx:3`), while the TV's "Up next" panel (`TvBoard.jsx:102-112`)
was the waiting list.

| ID | Pri | Requirement |
|---|---|---|
| PB-QUEUE-01 | P0 | The vocabulary on host, board, TV and captain. "Up next" means a confirmed call and nothing else. |
| PB-QUEUE-02 | P0 | Phone-first status card at the top of the board, one line, from `lib/myStatus.js`, with a `NEXT_FOUR` kind and no place number ("You're #3 in line" is a promise the server does not make). No name picked: a prominent "Who are you?" prompt in the card's place. Storage stays `lib/me.js`. |
| PB-QUEUE-03 | P0 | Board order: status card, confirmed calls with courts, courts, "Next four" when present, "Waiting (N)". No visible numbering. The rule in words: fewest games go first; the next four are picked when a court opens. With `nextUp` null and every court busy: "The next four are decided when a game ends." |
| PB-QUEUE-04 | P0 | TV: the waiting panel is "Waiting"; "Next four" when present; confirmed calls stay on the court tiles; below `lg` a compact queue instead of nothing; nothing truncated. |
| PB-QUEUE-05 | P1 | Host: one queue panel on the Courts tab (confirmed calls per court, next four, waiting in priority order with games and rounds sat out, on break, why a court is empty). No fourth tab. The roster's queue-number prefix (`PlayersPanel.jsx:40`) goes. |
| PB-QUEUE-07 | P1 | A player's state change is announced once through a polite live region; never colour alone; no animation on waiting chips or "Next four"; reduced motion honoured. |
| PB-UX | P2 | `Sheet` gains Escape, a focus trap and focus return; `window.confirm` in `HostConsole.jsx` becomes a sheet; the captain screen shows its confirmed call and the waiting count. |

## Group 4: Pickleball realtime

| ID | Pri | Requirement |
|---|---|---|
| PB-REALTIME-01 | P0 | "LIVE" comes from the last server contact, not socket state. On `visibilitychange` (visible) and `online`: poll at once; if the socket is open send `RESYNC` and treat no reply as a dead socket. A heartbeat that does not wake the Durable Object (hibernation auto-response), chosen from the current Cloudflare docs and cited. Timings measured, not promised. |
| PB-REALTIME-02 | P1 | Freshness unknown: the confirmed call and "Next four" lose the imperative, and the status card reads "Last known: …" with the time. Polling fallback and reconnection never fabricate a confirmed call. |

## Group 5: brand foundation

| ID | Pri | Requirement |
|---|---|---|
| BRAND-01 | P1 | Split `brand.css` into tokens (font faces, `:root` tokens, the dark-surface remap) and components. Public output unchanged. `brandTokens.test.ts` retargeted to the tokens file, every assertion kept. |
| BRAND-02 | P1 | Admin semantic layer scoped to `.admin-page` in its own stylesheet; the `.admin-*` rules leave `index.css`; vector field, radial gradients and backdrop blur removed; the active nav item uses the selected token, not a gradient. |
| BRAND-03 | P1 | Pickleball semantic layer for the app shell: navy and lime stay for play; the non-game primary button moves from legacy `#4500ff` to the brand indigo; shared focus, radius and type rules. |
| BRAND-04 | P1 | Naming decisions 1 and 2 everywhere (incl. `og:site_name`, the results poster band, tests, docs); a restrained "by DevLab Studios" endorsement with the logo mark in Pickleball footers; no Node in Admin or Pickleball gameplay screens. |
| BRAND-05 | P1 | Admin uses the local `/branding/logo-only.svg` instead of a production R2 URL. |
| BRAND-06 | P1 | Guard tests pin the semantic mappings and their contrast, and a ratchet stops the count of raw hex values and legacy colour tokens in `src/admin-app` and `src/pickleball-open` from growing. |
| ADR-0016 | P1 | Product themes on shared brand tokens: who owns which tokens, what is inherited, what stays product-specific, how a brand change propagates. |

## Group 6: Admin workspace

| ID | Pri | Requirement |
|---|---|---|
| ADMIN-06 | P1 | Primitives (Button, Input, Select, Textarea, Field, Badge, Panel, Table, Dialog, ConfirmDialog, Feedback, EmptyState, PageHeader) from `lead-crm/shared.jsx` and `format.js`. Dialog: focus trap, Escape, initial focus, focus return. Every `window.confirm`/`window.prompt` becomes ConfirmDialog (typed confirmation for privacy erase); confirmation added for project delete, "Mark do not contact" (decision 7), draft discard, page-block remove; mobile nav drawer becomes a dialog. |
| ADMIN-01 | P1 | Login: stone background, one white card, logo, "DevLab Workspace", environment badge, the form; the dark panel, blur glows, capability cards and fetched tagline go; error `role="alert"`. |
| ADMIN-02 | P1 | Shell on the brand surfaces; page title in the header; per-route document titles; a 404 route and a route error screen. |
| ADMIN-09 | P1 | Environment from `GET /api/admin/session` (a deployment variable set in both `wrangler.jsonc` environments), hostname fallback; "Open live site" / "Open preview site"; production destructive confirmations name the environment. |
| ADMIN-03 | P1 | Sidebar regrouped into Home, Website, Inquiries, Lead CRM, Mailbox, Admin. Routes unchanged. Attention counts from real endpoints only; no duplicate "Dashboard" labels or repeated icons. |
| ADMIN-04 | P1 | Home: "Needs attention" first from `/api/admin/leads`, `/api/admin/lead-crm/dashboard`, `/api/admin/mailbox/diagnostics` in parallel, each with its own loading and failure state; totals and activity below; "Leads" tile renamed "Inquiries"; no new metrics. |
| ADMIN-07 | P2 | Missing error states (CRM conversations, sources, suppression, activity, settings; dashboard audit feed); loading/empty/error on the primitives. |
| ADMIN-10 | P2 | Keyboard-reachable clickable rows; labels for placeholder-only inputs; pressed state on toggle groups; live-region roles on feedback. |
| CRM-03 | P1 | Lead CRM list paging (capped at 100 today while showing the full total); honour `/admin/lead-crm/leads?lead=…`. |
| CRM-05 | P1 | Draft editor seeded from props once (`LeadDetail.jsx`, `RepliesPage.jsx`): confirm with a test that "Regenerate" leaves old text, then fix. |
| CRM-06, CRM-07 | P2 | Debounce the activity and suppression filters; the "switched off" notice uses the router link. |
| MAIL-02..05 | P2 | Compose on the Dialog primitive with a real "Discard"; folder badges on Diagnostics; the stale comment in `mailbox/compose.ts`. |
| CMS-01..04 | P2 | Legacy editors adopt the primitives for buttons, inputs and errors only; "Navigation & Footer" vs "Site Settings" label mismatch; per-item accessible names on repeated Remove/Up/Down. |

## Acceptance criteria for the queue work

1. A player can clearly identify a confirmed next court assignment when one exists.
2. A player who is only waiting sees a labelled priority order, never a false confirmed assignment.
3. The host can tell playing, up next, next four, waiting, on break and left apart.
4. The player board shows this on a phone without confusing navigation.
5. The TV presents upcoming information accurately and legibly.
6. Tournament upcoming games come from fixture state, not the open-play queue.
7. Everything shown reflects authoritative server state.
8. A proposal edit, skip, break, return or mode change leaves no stale lineup visible.
9. Reconnection and polling never fabricate a confirmed assignment.
10. The existing fairness and matchmaking tests pass unchanged.
11. Host and captain credentials and host-only state stay out of viewer data.
12. It works from 1 to 16 courts and up to 128 players.
13. Status changes are announced to screen readers and never rely on colour alone.
14. No scheduling logic is added to the client.

## Measurements

### PB-QUEUE-08: does queue position predict the next four?

Filled in by `src/lib/pickleball/open/nextUp.simulation.test.ts` (see the
testing matrix). Numbers below are from the committed test's own output.

_Pending._

### PB-REALTIME-01: timings

_Pending._

## Testing matrix

| ID | Test |
|---|---|
| CRM-01 | `src/admin-app/lib/adminApi.test.js` (delete with and without a body; RED before the fix); `tests/e2e/lead-crm.spec.js` "a suppression can be removed with a reason and is kept as removed" (RED before the fix) |
| CRM-02 | `tests/e2e/lead-crm.spec.js` "a failed policy review keeps the editor open with the error" (synthetic source, failed PATCH; RED before the fix) |
| ADMIN-05 | `adminApi.test.js` (pause on 401, one notice, retry after sign-in, sign-out rejects, login 401 exempt, no listener = old behaviour); `tests/e2e/session-expiry.admin.spec.js` (revoke mid-page, dialog over the page, typed value kept, sign in, request retried; wrong password, Escape ignored, Sign out) |
| MAIL-01 | `tests/e2e/mailbox.spec.js` "a failed archive says so instead of failing silently" (RED before the fix) |
| PB-QUEUE-08 | _pending_ |
| PB-QUEUE-06 | _pending_ |
| PB-TOURNAMENT-01 | _pending_ |
| SEC-01 | _pending_ |
| PB-QUEUE-01..05, 07, PB-UX | _pending_ |
| PB-REALTIME-01, 02 | _pending_ |
| BRAND-01..06 | _pending_ |
| ADMIN-01..10, CRM-03..07, MAIL-02..05, CMS-01..04 | _pending_ |

## Deviations

None yet.

## Not done

None yet.

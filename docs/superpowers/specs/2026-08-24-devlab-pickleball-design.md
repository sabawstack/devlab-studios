# Devlab Pickleball — Design Spec

> **Superseded (2026-10-12).** This describes the logged-in operator app, retired in 2.0.0 by Phase 5 of `docs/superpowers/specs/2026-10-11-pickleball-free-open-play-design.md`. Kept as history: the routes, tables and files it names no longer exist.

**Status:** Draft for review
**Date:** 2026-08-24
**Scope:** Full architecture and data model for the Devlab Pickleball operational subsystem. Implementation proceeds phase-by-phase from this spec (see §14).

## 1. Purpose & boundary

Devlab Pickleball is an operational platform for running recreational pickleball sessions: check-in, queueing, court assignment, live scoring, statistics, and a custom performance index (OPI), plus anonymous realtime public viewing.

It is **not** CMS content. It lives beside the existing public website and Admin CMS as a third, independent subsystem:

```
devlab-studios (Worker)
├── Public website          (existing — untouched)
├── Admin CMS                (existing — untouched)
└── Devlab Pickleball        (new — this spec)
```

The three share one Astro/Worker deployment but nothing else load-bearing: separate D1 database, separate auth mechanism, separate session cookie, separate migrations, separate repositories, separate UI shell. A facilitator's Google login has no relationship to the CMS admin password login. Pickleball data can never be queried alongside CMS content by construction (different `env` binding).

**Non-goals / explicit disclaimers:** OPI is a Devlab-original metric, not an official USA Pickleball rating, DUPR, UTR-P, or Elo system. The scoring engine aligns with standard side-out scoring concepts but the software is not USA-Pickleball-certified. This language appears in the methodology page and is never contradicted elsewhere in the UI.

## 2. Foundational architecture (approved)

1. **UI shell** — a React Router SPA island (`src/pickleball-app/`) mounted at `src/pages/pickleball/app/[...path].astro` (`client:only="react"`), mirroring the existing `admin-app/` pattern, for the authenticated operator experience. Public marketing/methodology pages are plain Astro. The public live view and TV/kiosk display are Astro pages with one React island each for the realtime-subscribing widget.
2. **Data isolation** — a dedicated D1 database, bindings `PICKLEBALL_DB` (prod: `devlab-pickleball`) and its preview counterpart (`devlab-pickleball-preview`), added to `wrangler.jsonc` and its `env.preview` block. Own migrations folder `migrations/pickleball/`, own repositories `src/worker/repositories/pickleball/`, own Zod schemas `src/lib/schemas/pickleball/`.
3. **Auth** — Google OAuth 2.0 + PKCE via `arctic` (edge-native, zero-dependency, actively maintained OAuth client library — added as a new, minimal dependency). Stateless HMAC-SHA256-signed session cookie (`devlab_pb_session`), styled after the existing `adminAuth.js` convention but a fully independent mechanism with its own users/membership tables.
4. **Realtime & concurrency** — one Durable Object per pickleball session (`SessionCoordinatorDO`), serializing every mutating command and broadcasting WebSocket diffs to operators and public viewers. D1 is the durable source of truth; the DO is a rehydratable coordinator/cache, never the only copy of anything.

## 3. Multi-tenancy, identity & RBAC

### 3.1 Entities

- **Organization** — a club/venue operator's tenant. All operational data is scoped by `organization_id`.
- **User** — an authenticated operator, identified by Google `sub`. A User has no role of its own; role is a property of membership.
- **OrganizationMembership** — join of User × Organization with a `role` (`ADMIN` | `SESSION_FACILITATOR` | `SCOREKEEPER`) and status (`ACTIVE` | `REVOKED`). A User can hold different roles in different organizations (multi-org membership, confirmed in brainstorming). Memberships are **invite-only**: an ADMIN creates a membership row for an email before that person ever signs in; sign-in only succeeds in resolving pickleball access if a matching `ACTIVE` membership exists for the authenticated email.
- **Player** — a participant, not an authenticated entity. Belongs to one Organization. May optionally link to a `user_id` (nullable) if the player is later given operator access — but never required to have an account.

### 3.2 Google OAuth flow

1. `GET /api/pickleball/auth/google/start` — generates PKCE verifier + challenge and a random `state`, stores both in a short-lived signed cookie (`devlab_pb_oauth`, 10 min TTL), redirects to Google's authorization endpoint via `arctic`.
2. `GET /api/pickleball/auth/google/callback` — validates `state` against the cookie (CSRF protection), exchanges the code (with PKCE verifier) for tokens via `arctic`, fetches the Google profile (`sub`, `email`, `name`, `picture`).
3. Upsert `User` by `google_sub`. Look up `OrganizationMembership` rows for that user's verified email that are `ACTIVE`. If none exist, redirect to `/pickleball/login?error=no_access` — **no self-serve org creation**, per the invite-only decision. If exactly one, set it as the active org. If multiple, the SPA shows an org switcher on first load.
4. Issue `devlab_pb_session`: HttpOnly, Secure, SameSite=Strict, HMAC-SHA256-signed payload `{ userId, googleSub, activeOrgId, iat, exp }`, 8-hour `Max-Age` (matches existing admin session TTL convention). The token carries *which* org is active for UI convenience only — every request still re-resolves the membership/role from `OrganizationMembership` in D1, never trusting the cookie for authorization. Switching orgs re-issues the cookie with a new `activeOrgId` after re-verifying membership.
5. No tokens (Google or session) are ever placed in localStorage or exposed to client JS; the SPA only ever knows "am I logged in / what's my role" via `GET /api/pickleball/auth/session`.

### 3.3 Authorization

Every mutating and every non-public read endpoint:
1. Validates the session cookie signature + expiry.
2. Resolves `(userId, activeOrgId)` → membership row → role. 401 if no valid session, 403 if no active membership in the org the request targets (checked from the URL/body's `organization_id` or session/court id's owning org — never trust a client-supplied `organization_id` blindly; it's always cross-checked against the resource's actual owning org to prevent IDOR).
3. Applies the permission matrix (§3.4) server-side. The SPA hides controls the role can't use, but that is UX only — every command handler re-checks permissions independently.

### 3.4 Permission matrix

| Action | ADMIN | FACILITATOR | SCOREKEEPER |
|---|---|---|---|
| Manage venues/courts | ✓ | ✓ (assign/status only) | – |
| Manage operator roles | ✓ | – | – |
| Create/configure sessions | ✓ | ✓ | – |
| Check-in / bulk check-in | ✓ | ✓ | – |
| Manage queue / availability | ✓ | ✓ | – |
| Assign / replace court players | ✓ | ✓ | – |
| Score a live game (assigned) | ✓ | ✓ | ✓ (session-scoped grant) |
| Finish / undo / correct game | ✓ | ✓ | Finish + undo only, no reopen/correct |
| Reopen a finalized game | ✓ | ✓ | – |
| View audit log | ✓ | – | – |
| Configure system defaults | ✓ | – | – |

SCOREKEEPER access to a specific session is granted by a FACILITATOR/ADMIN assigning them to it (a `session_operator_grants` row), not implicit org-wide access — this satisfies "access assigned/authorized sessions" from the brief.

## 4. Domain model

All tables live in `PICKLEBALL_DB`, follow the repo's existing SQLite conventions: `TEXT PRIMARY KEY` (UUID v4 via `crypto.randomUUID()`), `created_at`/`updated_at` as ISO-8601 UTC `TEXT`, enums as `CHECK` constraints, `idx_<table>_<cols>` index names, `ON DELETE CASCADE` for owned children.

### 4.1 Identity & tenancy

- **organizations**: id, name, slug (unique), created_at, updated_at
- **users**: id, google_sub (unique), email, name, avatar_url, created_at, updated_at
- **organization_memberships**: id, organization_id, user_id, role CHECK IN (ADMIN, SESSION_FACILITATOR, SCOREKEEPER), status CHECK IN (ACTIVE, REVOKED), invited_email, created_at, updated_at — UNIQUE(organization_id, user_id)
- **session_operator_grants**: id, session_id, user_id, granted_by_user_id, created_at — UNIQUE(session_id, user_id); scoping table for SCOREKEEPER session access

### 4.2 Players, venues, courts

- **players**: id, organization_id, display_name, normalized_name, linked_user_id (nullable), active (bool), public_visible (bool, default true), created_at, updated_at — idx(organization_id, active)
- **venues**: id, organization_id, name, address, timezone, created_at, updated_at
- **courts**: id, venue_id, organization_id, name, sort_order, created_at, updated_at

### 4.3 Rulesets

- **scoring_rulesets**: id, organization_id (nullable — null = a global built-in profile like `USAP-2026-SIDEOUT-11`), name, rules_version, scoring_method CHECK IN (SIDE_OUT), target_score, win_by, format CHECK IN (SINGLES, DOUBLES), active (bool), created_at, updated_at

Every game persists the `scoring_ruleset_id` it was played under. Global defaults changing never mutates a historical game's ruleset reference — new sessions simply pick up the new default at creation time.

### 4.4 Sessions

- **pickleball_sessions**: id, organization_id, venue_id, name, session_type CHECK IN (OPEN_PLAY, FIXED_PAIRS), status CHECK IN (DRAFT, OPEN_FOR_CHECKIN, LIVE, PAUSED, COMPLETED, CANCELLED), scoring_ruleset_id, scheduled_start, scheduled_end, actual_start, actual_end, post_game_rotation_policy CHECK IN (AUTO_REQUEUE_ALL, MANUAL_REQUEUE) DEFAULT AUTO_REQUEUE_ALL, leaderboard_min_games INTEGER DEFAULT 3, public_view_enabled (bool) DEFAULT true, public_leaderboard_enabled (bool) DEFAULT true, created_by_user_id, created_at, updated_at
- **session_courts**: id, session_id, court_id, enabled (bool), status CHECK IN (AVAILABLE, ASSIGNED, WARMUP, PLAYING, FINISHING, OUT_OF_SERVICE), current_game_id (nullable), created_at, updated_at — UNIQUE(session_id, court_id)
- **public_session_tokens**: id, session_id, public_code (unique, opaque, 8-char Crockford base32 via `crypto.getRandomValues`, collision-checked on insert), created_at, revoked_at (nullable)

Session status transitions are enforced by an explicit state machine module (`src/lib/pickleball/sessionStateMachine.ts`), not string comparisons scattered through handlers: `DRAFT → OPEN_FOR_CHECKIN → LIVE ⇄ PAUSED → COMPLETED`, with `CANCELLED` reachable from any pre-`COMPLETED` state. Each transition is a named function (`openForCheckIn(session)`, `completeSession(session)`, …) that validates preconditions and returns the allowed next status or throws a domain error.

### 4.5 Registration, attendance, availability, queue — kept as four independent columns

Per the brief's explicit requirement, these are four separate state dimensions on **session_players**, not one collapsed status:

- **session_players**: id, session_id, player_id, registration_status CHECK IN (REGISTERED, CANCELLED), attendance_status CHECK IN (NOT_CHECKED_IN, CHECKED_IN, LEFT_SESSION) DEFAULT NOT_CHECKED_IN, availability_status CHECK IN (AVAILABLE, TEMPORARILY_UNAVAILABLE, RESTING) DEFAULT AVAILABLE, checked_in_at (nullable), games_played INTEGER DEFAULT 0, registered_at, created_at, updated_at — UNIQUE(session_id, player_id)

Queue status is **not** a column here — it is derived from the presence/state of a **queue_entries** row, because a player's queue lifecycle has its own timestamps that a single enum can't carry cleanly:

- **queue_entries**: id, session_id, session_player_id, status CHECK IN (QUEUED, ASSIGNED, PLAYING), queued_at, assigned_at (nullable), created_at, updated_at

Eligibility for automatic selection (§5) is computed by joining `session_players` (registration=REGISTERED, attendance=CHECKED_IN, availability=AVAILABLE) with an active `queue_entries.status = QUEUED` row — never inferred from a single flattened field. A player only ever has **at most one** open `queue_entries` row per session (enforced at the application layer inside the DO's serialized command handler, not a DB constraint, since "open" isn't expressible as a simple unique index — `PLAYING`/`ASSIGNED`/`QUEUED` are all "open").

Late arrival correctness: `queue_entries.queued_at` is set when `joinQueue()` actually runs, never backdated to `session_players.registered_at`. This directly satisfies §11 of the brief.

### 4.6 Teams, fixed pairs & matchmaking history

- **teams**: id, session_id, kind CHECK IN (AD_HOC, FIXED_PAIR), created_at — an `AD_HOC` team exists only for the lifetime of one game (Open Play); a `FIXED_PAIR` team persists for the whole session
- **team_members**: id, team_id, session_player_id — exactly 1 (singles) or 2 (doubles) rows per team
- **matchmaking_history**: id, session_id, player_id, other_player_id, relation CHECK IN (PARTNER, OPPONENT), pairing_count INTEGER DEFAULT 1, last_game_at — UNIQUE(session_id, player_id, other_player_id, relation); upserted (count incremented) on every game finalization, read by the queue engine's repeat-avoidance tiebreak (§5) and by player-profile "unique partners/opponents" stats (§36)

### 4.7 Games & scoring (event-sourced)

- **games**: id, session_id, session_court_id, scoring_ruleset_id, format CHECK IN (SINGLES, DOUBLES), status CHECK IN (SCHEDULED, IN_PROGRESS, FINISHED, ABANDONED, CANCELLED), team_a_id, team_b_id, revision INTEGER DEFAULT 0 (optimistic-lock version, bumped by every applied event), winning_team_id (nullable), final_score_a, final_score_b (nullable until finished), started_at, finished_at, created_at, updated_at
- **game_participants**: id, game_id, session_player_id, team_id — normalized participant relationships (never bare name strings, per the brief)
- **score_events**: id, game_id, sequence INTEGER (monotonic per game), event_type CHECK IN (GAME_STARTED, POINT_AWARDED, POINT_REVERSED, SERVE_CHANGED, SIDE_OUT, SCORE_CORRECTED, GAME_FINISHED, GAME_REOPENED), actor_user_id, payload_json, created_at — UNIQUE(game_id, sequence)

Canonical state is the event log; `games` (score, status) is a materialized projection kept in sync inside the same DO-serialized transaction that appends an event, for fast reads. **Rebuild path**: `rebuildGameProjection(gameId)` in `src/worker/pickleball/gameProjection.ts` replays `score_events` in `sequence` order and rewrites the `games` row — this is the recovery mechanism for §59 ("derived data must be reproducible") and is exercised by a real test, not just described.

Idempotency for `finishGame`/`recordPoint` etc.: every command handler accepts a client-generated `idempotency_key`; the DO keeps a short-lived (session lifetime) in-memory + D1-persisted `idempotency_keys(key, game_id, result_json)` record so a duplicated request returns the original result instead of re-applying.

### 4.8 Statistics (derived, rebuildable)

- **player_game_stats**: id, game_id, player_id, points_for, points_against, game_performance (REAL, high precision), is_win (bool), eligible_for_opi (bool) — one row per player per finished game, the atomic unit everything else aggregates from
- **player_performance_snapshots**: id, player_id, scope_type CHECK IN (SESSION, ALL_TIME), scope_id (session_id or NULL for all-time), opi_version TEXT DEFAULT 'OPI_V1_SCORE_SHARE', eligible_games_count INTEGER, performance_sum REAL, opi (REAL, `performance_sum / eligible_games_count`), updated_at
- **pair_stats**: id, team_id (FIXED_PAIR team), games_together, wins, losses, points_for, points_against, pair_opi, updated_at

Snapshots are **maintained incrementally** on game finalization for read performance, but are fully rebuildable from `player_game_stats` (itself rebuildable from `score_events` via the projection). A `recomputePlayerSnapshots(playerId, scope)` function is the single source of the OPI formula — the UI and any future report call this function's output, never reimplement the math (§38 requirement).

### 4.9 Audit

- **audit_events**: id, organization_id, session_id (nullable), actor_user_id, action TEXT (e.g. `PLAYER_CHECKED_IN`), entity_type, entity_id, previous_state_json, new_state_json, metadata_json, created_at — idx(organization_id, created_at DESC), idx(entity_type, entity_id)

Never exposed on any public endpoint; only reachable via the ADMIN-only `/pickleball/app/audit` route and its API.

## 5. Queue engine

Eligibility gate (all must hold): `registration_status = REGISTERED`, `attendance_status = CHECKED_IN`, `availability_status = AVAILABLE`, an open `queue_entries.status = QUEUED` row, not already a participant in an `IN_PROGRESS`/`SCHEDULED` game.

Selection order among eligible players (deterministic, pure function `selectNextPlayers(eligiblePlayers, count)` in `src/lib/pickleball/queueEngine.ts`, unit-testable with no DB):
1. Fewest `session_players.games_played` first.
2. Longest `queue_entries.queued_at` wait next.
3. Prefer combinations that avoid an immediate repeat of the *last* partner/opponent (checked against `matchmaking_history`, a lightweight derived table of `{player_id, other_player_id, relation: PARTNER|OPPONENT, last_game_at}` maintained on finalization) — this is a tiebreak, never overrides rule 1 or 2, and is skipped entirely once fewer than 5 eligible players remain (graceful degradation, §56).
4. OPI is *not* an input to this function at all — it is applied afterward, only to decide how the already-selected 4 (or 2, for singles) players are paired into two sides for balance (`balanceTeams(selectedPlayers)`, a separate function, minimizing the OPI sum difference between sides).

Every recommendation returned to the UI carries a `reasons: string[]` array built from the same fields the function used to decide (games played, wait time, repeat-avoidance) — the explainability requirement is satisfied by the function's return shape, not a separate translation layer that could drift from the real logic.

Temporarily-unavailable policy (§12 decision, now explicit): marking a player `TEMPORARILY_UNAVAILABLE` closes their open `queue_entries` row (`status` transition is not modeled as "paused" — it's removed from eligibility) but the row is *not deleted*; a new `queue_entries` row is created with a fresh `queued_at` when they return to `AVAILABLE` and rejoin. Their original entry remains in the table for audit/history. This is the documented "resume at the back, not indefinite hold" default from the brief.

## 6. Court assignment & concurrency — SessionCoordinatorDO

A Durable Object class `SessionCoordinatorDO`, one instance per `session_id` (via `idFromName(sessionId)`).

**Responsibilities:**
- Exposes a WebSocket upgrade endpoint (`/pickleball/rt/:sessionId`) for three client kinds: `OPERATOR` (authenticated, receives full state), `PUBLIC` (anonymous, receives the sanitized public projection only), and internally validates the connecting client's auth/role before accepting.
- Exposes an internal RPC surface (called from Astro API routes via the DO stub, never reachable directly from the internet) for every mutating command: `checkIn`, `bulkCheckIn`, `joinQueue`, `leaveQueue`, `markUnavailable`, `markAvailable`, `assignCourt`, `replaceAssignedPlayer`, `startGame`, `recordPoint`, `sideOut`, `undoScoreEvent`, `finishGame`, `reopenGame`, `correctGame`, `completeSession`.
- Because a Durable Object processes one request at a time per instance, two simultaneous `assignCourt` calls for the same session are **naturally serialized** — the second call re-reads state (already updated by the first) before deciding, so it cannot select the same player twice. This is the concurrency mechanism for §16, verified by a real test that fires two concurrent `assignCourt` RPCs at the same DO instance and asserts no player appears on two courts.
- Each command handler: validates the domain rule → writes to D1 (source of truth) → updates in-memory projection → broadcasts a diff to connected WebSocket clients → returns the result (or the idempotent cached result).
- On DO startup (cold start / eviction recovery), state is rehydrated from D1 by reading the session's current rows — the DO never has data D1 doesn't also have.
- Reconnecting clients (operator or public) receive a full current-state snapshot immediately on WebSocket open, then incremental diffs after — no "catch-up gap."

**Why this satisfies §58 (concurrent scorekeepers):** `games.revision` is bumped by the DO on every applied score event; if a client's local revision is behind when it sends a command, the DO's serialized handler still applies the command against *current* truth and the client simply receives a state snapshot showing it's now ahead — there is no lost-update window because there is only one place, ever, where the mutation happens.

## 7. Scoring engine

`src/lib/pickleball/scoring/` contains the ruleset-driven engine, framework-agnostic (pure functions over a `GameState` + `ScoringRuleset`).

### 7.1 Rally-driven interaction model

The scorekeeper never enters a raw score delta or manually declares a side-out. The only primary input is **who won the rally**, and the engine derives every consequence — this replaces manual +/- and manual side-out controls entirely as the primary interface (a privileged correction flow, §7.3, is the only path back to editing a number directly).

`GameState` carries `{ scoreA, scoreB, servingTeam: 'A' | 'B', serverNumber: 1 | 2 }`. A new game starts `{ scoreA: 0, scoreB: 0, servingTeam: <whichever team serves first>, serverNumber: 2 }` — starting `serverNumber` at `2`, not `1`, is what produces the traditional "0-0-2" opening: the first serving side effectively plays only one server's turn, so losing the opening rally is an immediate side-out with no intermediate server-1-to-server-2 step. This one initialization choice encodes the whole opening-service rule without a separate "is this the first serve of the game" flag.

`recordRally(state, ruleset, winningTeam): GameState` — the single function every rally-result button calls:
- **Serving team wins the rally**: award it one point; `servingTeam` and `serverNumber` are unchanged.
- **Receiving team wins while `serverNumber === 1`** (doubles only — see below): no point is awarded; `serverNumber` becomes `2`; `servingTeam` is unchanged.
- **Receiving team wins while `serverNumber === 2`**: no point is awarded; this is a **side out** — `servingTeam` flips to the winning team and `serverNumber` resets to `1`.

For `format = SINGLES`, there is no server-1/server-2 distinction — every receiving-team win is an immediate side out (equivalent to treating singles as permanently "on server 2"). `recordRally` special-cases this: singles games never set `serverNumber` above `1` and a receiving-team win always flips `servingTeam` directly.

`recordRally` is pure and fully unit-tested as a deterministic state machine — no D1, no DO, just `GameState → GameState`. The DO-serialized command handler (§6) wraps it: append a `POINT_AWARDED` or `SIDE_OUT` score event carrying the resulting state, update the `games` projection, broadcast the diff.

### 7.2 Display derivation (also pure functions)

- `officialScoreCall(state, format)` → for doubles, `${servingSideScore}-${receivingSideScore}-${serverNumber}` (server's own score always called first, regardless of whether that's Team A or Team B); for singles, `${servingSideScore}-${receivingSideScore}` (no third number — singles has no server-number concept to call). This is what changes on a side out, never the on-screen team rows (§7.4).
- `isGamePoint(state, ruleset)` → true if the serving team winning one more rally would satisfy `isValidFinalScore` for their side.
- `contextualState(state, ruleset)` → one of `SIDE_OUT` (transient, shown immediately after a side out event), `GAME_POINT` (per `isGamePoint`), `TIED_WIN_BY_TWO` (both scores equal and at or above `targetScore - 1`), or `null` (no special banner).
- `isValidFinalScore(scoreA, scoreB, ruleset)` → unchanged from the original design: `max(scoreA,scoreB) >= ruleset.targetScore && Math.abs(scoreA - scoreB) >= ruleset.winBy` — never a hardcoded `=== 11`.

### 7.3 Undo and correction

- **Undo Last Rally** — the primary, always-visible control next to the two rally-result buttons. Pops the most recent `POINT_AWARDED`/`SIDE_OUT` event by appending a compensating inverse event (never deleting history — the audit trail is append-only) and recomputes `GameState` by replaying. Available for the immediate last action only, not a general history scrubber.
- **Correction flow** (ADMIN/FACILITATOR only, separate from the rally buttons entirely — no `-1` button lives beside them) — for mistakes noticed after further rallies have already been played. Opens `reopenGame` → lets the operator set the game back to a specific prior `GameState` (score + serving side + server number, all three, since correcting one without the others could desync the call) → re-finish. This triggers `invalidateAndRecompute(gameId)` exactly as in the original design: delete the game's `player_game_stats` rows and matching `player_performance_snapshots` contribution (subtracting, not layering on top), then re-derive once finished again — satisfying §25's "never apply corrected statistics on top of the old statistics."
- `finishGame` still refuses to transition to `FINISHED` unless `isValidFinalScore` passes on the current `GameState`; returns a domain error the UI surfaces inline, never a generic 500.

### 7.4 Scorekeeper UI contract

- Team A and Team B occupy **fixed screen rows** for the entire game — service changes never reorder or swap them. Only the serving indicator (which row shows "Serving") and the official score call's digit order change.
- Always visible: Team A score, Team B score, which team is serving, the current server (player name, for doubles), the server number, the official score call (§7.2), and the contextual state banner when one applies.
- The two primary buttons are rally results only: **TEAM A WON RALLY** / **TEAM B WON RALLY** — labeled by team, not by "point"/"side out", since the engine (not the operator) decides which one occurred. **UNDO LAST RALLY** sits beside them. Large touch targets, no `-1`/`+1` stepper controls anywhere near this primary control group.

## 8. OPI — Open Play Performance Index

Formula, exactly as specified, implemented once in `src/lib/pickleball/opi.ts`:

```
gamePerformance(pf, pa) = (pf / (pf + pa)) * 100
opi(games) = mean(games.map(g => gamePerformance(g.pf, g.pa)))
```

- Stored/summed at full floating-point precision (`performance_sum`, `eligible_games_count` in `player_performance_snapshots`); only rounded to 2 decimals at display time.
- Doubles: both teammates receive the *same* `game_performance` value for that game (team score share), written as two `player_game_stats` rows.
- Eligibility (`player_game_stats.eligible_for_opi`): true only for `games.status = FINISHED` with a valid final score under its ruleset; false for `ABANDONED`, `CANCELLED`, forfeits, or zero-point games. Set once at finalization time, never inferred later from "does a row exist."
- Versioned as `OPI_V1_SCORE_SHARE` on every snapshot row. A future `OPI_V2_*` ships as a new function plus a new `opi_version` value on new snapshots — old snapshots are never silently reinterpreted, and since `player_game_stats` retains full per-game PF/PA, any version can be recomputed retroactively via `recomputePlayerSnapshots(playerId, scope, version)`.
- Confidence tiers (configurable thresholds, defaulted 0-2/3-9/10+ → PROVISIONAL/DEVELOPING/ESTABLISHED) are a pure display-layer function of `eligible_games_count` — never fed back into the `opi` value itself.
- Leaderboard ranking sorts by `opi` (ties broken by player display name for render order only, never by games played) with `leaderboard_min_games` (session-configurable, default 3) filtering the *primary* ranking view; a "show provisional players" toggle reveals the rest without altering anyone's number.
- Canonical unit tests (specified in the brief, §65) assert 11-7 → 61.111..., 9-11 → 45, 11-5 → 68.75, mean → 58.287..., display 58.29 — using integer-safe rational arithmetic internally to avoid float-equality flakiness in assertions (compare rounded-to-6-decimals, not exact float equality).

## 9. Realtime protocol

WebSocket message envelope: `{ type, sessionId, seq, payload }`. `seq` is a per-DO monotonic counter so clients can detect gaps and request a fresh snapshot (`type: 'RESYNC_REQUEST'`) if one occurs — pragmatic reconnect handling rather than full CRDT sync.

- **Operator channel** (`/pickleball/rt/:sessionId?role=operator`, session cookie required, role-checked): full state including registration/attendance detail, queue internals, audit-adjacent fields (but never raw emails beyond what the role already sees via REST).
- **Public channel** (`/pickleball/rt/:sessionId?code=<publicCode>`, no auth): a strictly sanitized DTO — court states, team display names, scores, serving side, session name/status, sanitized leaderboard (display name, opi, rank, confidence tier only). Built by a dedicated `toPublicSessionView(state)` mapper (never the internal shape with a few fields stripped — an explicit allowlist mapper, so a newly added internal field can never leak by omission).
- If the DO is unreachable (rare), the public live page and TV display fall back to polling `GET /api/pickleball/public/:code/state` every 5s until the socket reconnects — graceful degradation, never a blank screen.

## 10. Public API & sanitization

Public REST endpoints (`/api/pickleball/public/:code/...`) resolve `publicCode → session_id` via `public_session_tokens` (revoked tokens 404), then call the same `toPublicSessionView` mapper used by the WebSocket broadcast — one function, two transports, no drift. Rate-limited per-IP (reuse the existing in-memory sliding-window pattern from `adminAuth.js`'s login limiter, generalized into a small shared `rateLimit()` helper) since these endpoints are unauthenticated.

QR codes are generated client-side in the SPA from the canonical public URL using a small, zero-dependency QR-generation routine (e.g. `qrcode` npm package rendering to an inline `<svg>` — no external QR service call, so nothing about a session leaks to a third party).

## 11. Routes

**Public (Astro):** `/pickleball`, `/pickleball/live/[code]`, `/pickleball/live/[code]/display`, `/pickleball/methodology`, `/pickleball/login`

**Authenticated SPA (`/pickleball/app/[...path].astro` → React Router):** `/dashboard`, `/sessions`, `/sessions/new`, `/sessions/:id`, `/sessions/:id/control`, `/sessions/:id/check-in`, `/sessions/:id/queue`, `/sessions/:id/courts`, `/sessions/:id/games`, `/sessions/:id/leaderboard`, `/players`, `/players/:id`, `/courts`, `/settings` (ADMIN), `/operators` (ADMIN), `/audit` (ADMIN)

**API (`src/pages/api/pickleball/**`):** mirrors the command list in §6 as `POST` endpoints (e.g. `POST /api/pickleball/sessions/:id/check-in`), plus standard `GET` list/detail reads. Every write endpoint: Zod-parse body → resolve auth/role → forward to the session's DO stub (for session-scoped commands) or repository directly (for org-level CRUD like venues/players outside a live session) → `jsonResponse`.

## 12. Testing strategy

- **Vitest, colocated**: `opi.test.ts` (the exact canonical numbers from §8/§65), `queueEngine.test.ts` (all the §57 numbered-player-count edge cases run as parametrized cases), `scoring.test.ts` — `recordRally` as a deterministic state machine: serving side wins → point awarded, server/serverNumber unchanged; receiving side wins on server 1 → no point, server advances to 2; receiving side wins on server 2 → side out, service transfers, new server is 1; opening `{0, 0, servingTeam, serverNumber: 2}` loses immediately to one lost rally; singles never exposes a server-1 state; `officialScoreCall` digit order flips on side out while `scoreA`/`scoreB` never swap; win-by/target-score validation matrix; undo reverses exactly one rally — plus `sessionStateMachine.test.ts`.
- **Playwright, `tests/e2e/pickleball/`, `worker` project (against local `wrangler dev` with `PICKLEBALL_DB` + DO bindings)**: check-in → queue → assign → score → finish happy path; late-arrival flow; replacement flow; reopen/correct flow; **the concurrency test** — two parallel `fetch()` calls invoking `assignCourt` for two different courts with overlapping eligible players, asserting exactly one succeeds in claiming the contested player; public live view reflects a score change without a page reload (via a real WebSocket client in the test).
- Idempotency test: fire `finishGame` twice with the same idempotency key, assert stats applied once.

## 13. Environment & migrations

New `wrangler.jsonc` additions (root + mirrored under `env.preview`): `d1_databases` entry for `PICKLEBALL_DB`, a `durable_objects` binding + matching `migrations` block for `SessionCoordinatorDO` (Cloudflare DO classes require their own first-use migration entry, separate from the D1 SQL migrations), and new `vars`/secrets: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` (secret), `PICKLEBALL_SESSION_SECRET` (secret), `PICKLEBALL_OAUTH_REDIRECT_BASE_URL`. All added to `.env.example` as placeholders, real values only ever via `wrangler secret put` / dashboard, never committed — matching the existing convention exactly.

`migrations/pickleball/0001_foundation.sql` through subsequent numbered files, applied via `wrangler d1 migrations apply devlab-pickleball --local|--remote`, following the exact guard style (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`) and "never edit an applied migration" rule already documented in this repo's `ARCHITECTURE.md`.

Seed data (`scripts/pickleball/seed/`, fresh-DB-only, mirroring `scripts/cms/generate-project-seed.mjs`'s pattern): 1 organization, 1 venue, 4 courts, ~16 players, 1 DRAFT session, 1 LIVE session with a populated queue and two finished games, enough `player_game_stats` history to exercise all three OPI confidence tiers.

## 14. Phased implementation order (for the plan)

1. **Foundation** — migrations, D1/DO bindings, Google OAuth, orgs/users/memberships/RBAC, players/venues/courts/sessions CRUD, empty SPA shell.
2. **Attendance** — registration/check-in/bulk-check-in/availability, late arrival.
3. **Open Play core** — queue engine, eligibility, SessionCoordinatorDO scaffolding, court assignment, replacement, post-game rotation.
4. **Game engine** — rulesets, side-out scoring, event log, undo, finalization, reopen/correction.
5. **Performance** — player_game_stats, OPI v1, snapshots, leaderboards, pair stats (Fixed Pairs), player profile.
6. **Realtime & public** — WebSocket broadcast, public live view, TV/kiosk display, QR sharing, methodology page.
7. **Polish** — audit log UI, facilitator dashboard consolidation, documentation.

## 15. Documented edge-case decisions (§57 of the brief)

| # | Case | Decision |
|---|---|---|
| 1-8 | N players waiting (1 through 8+) | `selectNextPlayers` degrades gracefully: below 4 (doubles) or 2 (singles) eligible players, no assignment is offered, UI shows "not enough players"; repeat-avoidance (rule 3) is skipped below 5 eligible so it never blocks an otherwise-valid match. |
| 9 | Multiple courts free simultaneously | Serialized by the DO — sequential internally even if requests arrive concurrently. |
| 10 | Registered, not arrived | Excluded from all queue eligibility gates; never blocks anything. |
| 11 | Checked-in, never queues | Simply has no `queue_entries` row; visible in check-in counts, absent from queue. |
| 12 | Queued player goes unavailable | Their `queue_entries` row closes; original record retained for audit. |
| 13 | Returns from unavailable | New `queue_entries` row, fresh `queued_at` — joins at the back. |
| 14 | Player declines assignment | Modeled as `replaceAssignedPlayer` — facilitator action, not a player-initiated one in v1. |
| 15 | Leaves early | `attendance_status = LEFT_SESSION`; excluded from eligibility, queue entry closed. |
| 16 | Facilitator replaces assigned player | `replaceAssignedPlayer` command, released player's own state resets per their real current availability, not auto-requeued if they were actually leaving. |
| 17 | Court goes out of service mid-session | `session_courts.status = OUT_OF_SERVICE`; if it had a live game, that game is not auto-abandoned — facilitator explicitly abandons or moves it. |
| 18 | Game abandoned | `status = ABANDONED`; excluded from OPI; court released. |
| 19 | Score entered incorrectly (live) | `undo` before finish; `correctGame` after. |
| 20-21 | Finished game reopened / correction changes winner | `reopenGame` → `correctGame` → re-finish triggers full stat invalidate-and-recompute (§7). |
| 22 | Duplicate "Finish Game" | Idempotency key; second call returns cached result. |
| 23 | Duplicate queue-join | Application-layer check inside the DO's serialized handler: a session_player with an existing open queue_entries row is rejected, not duplicated. |
| 24 | Network reconnect during scoring | WebSocket reconnect gets a full snapshot; D1 already has the true state regardless of client connectivity. |
| 25 | Two scorekeepers edit same game | See §6/§58 — DO serialization, `revision` counter for client-side staleness detection only (not blocking). |
| 26-27 | Spectator reconnects / session completes while watching | Snapshot-on-reconnect; a `COMPLETED` session's public view renders final state and stops expecting further diffs. |
| 28 | Fixed pair member unavailable | The whole `FIXED_PAIR` team drops out of eligibility together — no partial-pair play in v1. |
| 29 | <4 eligible players remain | Queue simply can't fill a doubles court; UI states this plainly. |
| 30 | Pair already scheduled on another court | Eligibility check includes "not already a participant in an active game," which a `team_members` join makes true for both pair members simultaneously. |

## 16. Documentation deliverables

`docs/pickleball/` — `architecture.md` (this spec, condensed), `schema.md`, `opi-methodology.md` (also the source for the public `/pickleball/methodology` page copy), `realtime.md`, `runbook.md` (local dev, migrations, seeding). One new ADR: `docs/architecture/decisions/0006-pickleball-durable-objects-realtime.md`, following the existing ADR format, documenting why Durable Objects were introduced (first net-new architectural pattern in the repo).

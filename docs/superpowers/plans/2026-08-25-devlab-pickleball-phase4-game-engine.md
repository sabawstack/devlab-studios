# Devlab Pickleball — Phase 4 (Game Engine) Implementation Plan

> **Superseded (2026-10-12).** This describes the logged-in operator app, retired in 2.0.0 by Phase 5 of `docs/superpowers/specs/2026-10-11-pickleball-free-open-play-design.md`. Kept as history: the routes, tables and files it names no longer exist.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A rally-driven, event-sourced side-out scoring engine — record who won each rally, derive score/serve/side-out automatically, undo the last rally, finish/abandon a game, and reopen+correct a finalized one — all serialized through the existing `SessionCoordinatorDO`, with the event log as canonical state and the `games` row as a rebuildable projection.

**Architecture:** A pure `recordRally(state, ruleset, winningTeam)` state machine (no D1, no DO) is the single source of truth for what a rally result means; `SessionCoordinatorDO` wraps it per command — append a `score_events` row, update the `games` projection, return the result — all in one D1 batch per command, serialized by the DO the same way Phase 3's court assignment already is. `rebuildGameProjection` replays the event log through the same pure `recordRally` function to reconstruct the projection from scratch, proving the projection is genuinely derived data, not a second source of truth. `player_game_stats` (per-game, per-player final numbers) is written at finalization because a finished game cannot exist without them — full OPI aggregation, snapshots, and leaderboards remain Phase 5.

**Tech Stack:** Astro API routes, Cloudflare D1 (raw SQL), the existing `SessionCoordinatorDO` Durable Object, Zod, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-24-devlab-pickleball-design.md` (§4.6 matchmaking_history, §4.7 games/event log, §4.8 player_game_stats, §6 DO command list, §7 scoring engine, §8 OPI formula's per-game component, §12 testing strategy, §15 edge cases #17-22)

**Scope boundary:** This phase is the game engine only. It does **not** build `player_performance_snapshots`, the OPI mean-aggregation function, confidence tiers, leaderboards, or pair stats — those are Phase 5 (§14.5). It does **not** wire `matchmaking_history`'s read side into `queueEngine.ts`'s repeat-avoidance tiebreak — that was already deliberately deferred out of Phase 3's merged scope, and this plan only writes to the table, leaving it populated for whenever the read side is built. It does **not** build any UI — every prior phase (1-3) shipped API + DO + tests only (Phase 1's "empty SPA shell" is the one exception, and it stays empty here too); if a scorekeeper UI is actually wanted now, that is a separate, explicit follow-up. It does **not** touch the DO's WebSocket upgrade endpoint or any realtime broadcast (`/pickleball/rt/:sessionId`, `toPublicSessionView`, the public live view/TV display) — that is entirely Phase 6 (§14.6); every command this phase adds is invoked exactly like Phase 3's commands, over plain RPC through the existing route layer, with no broadcast side effect. It does **not** use `session_courts.status` values `WARMUP`/`FINISHING`/`OUT_OF_SERVICE` (no route anywhere, in this phase or any prior one, ever writes `OUT_OF_SERVICE` either — edge case #17 is a pre-existing Phase 3-adjacent gap, not something this phase's scope covers) or `games.status` values `SCHEDULED`/`CANCELLED` (nothing in this plan's flow produces a "not yet started" or "cancelled-before-starting" game) — all five remain declared-but-unused, an explicit non-goal, not a silent gap.

## Global Constraints (carried forward, including corrections and open items from Phase 3's final review and Phase 3.1)

- **Every client-supplied foreign key in a request body must be resolved through its own session-scoped lookup before use.** Concretely in this phase: `gameId` used in any rally/undo/finish/abandon/reopen/correct command must be confirmed to belong to the target session before use; a `userId` supplied to a grant/revoke route must be confirmed to hold an active membership in the target organization.
- `games`, `game_participants`, `score_events`, `matchmaking_history`, `player_game_stats`, and `idempotency_keys` have no `organization_id` column — tenancy is scoped transitively via `session_id` (`games.session_id`, everything else via `games.game_id → games.session_id`). Every route calls `getSession(db, sessionId, activeOrgId)` first, 404 if null, exactly like every route in Phases 2-3.
- Every API response goes through `jsonResponse` from `src/worker/utils/responses.js` — no bare `new Response(...)`.
- Zod validates every write endpoint's body; failures return `{ error: 'Validation failed.', issues: result.error.issues }` with HTTP 400.
- **New routes drain the request body (`await request.json().catch(() => null)`) immediately after resolving the session, before any 404/403 early return** — this is Phase 3.1's fix for a real local `wrangler dev` crash class, and every route this phase creates follows it from the start rather than needing the same fix retrofitted later. See `src/pages/api/pickleball/sessions/[id]/courts/assign.ts` for the exact established pattern and its in-code rationale comment.
- `SCORE_GAME`, `FINISH_GAME`, `UNDO_SCORE_EVENT`, `REOPEN_GAME`, `CORRECT_GAME` already exist in `src/lib/pickleball/permissions.ts` (added in Phase 1, unused until now) with exactly the distribution the design's permission matrix requires — ADMIN and SESSION_FACILITATOR hold all five; SCOREKEEPER holds only `SCORE_GAME`/`FINISH_GAME`/`UNDO_SCORE_EVENT` ("Finish + undo only, no reopen/correct"). **No changes to `permissions.ts` are needed anywhere in this plan.**
- **SCOREKEEPER's access to score/finish/undo/abandon/start on a specific session additionally requires a `session_operator_grants` row** (spec §3.4: "not implicit org-wide access"). ADMIN and SESSION_FACILITATOR need no such grant — their access is already org-wide via `MANAGE_SESSIONS`/etc. `session_operator_grants` was created by Phase 1's migration but has zero repository/route code anywhere — Task 6 of this plan builds it, since this is the first phase where SCOREKEEPER's distinct permissions are actually exercised.
- Pure logic (the scoring engine, the projection replay, the OPI per-game formula) never calls `Date.now()`/`new Date()` internally — callers pass an explicit `nowIso` string where a timestamp is needed, so every function stays deterministic and testable, matching `queueEngine.ts`'s and `sessionStateMachine.ts`'s established convention.
- No unbounded array input on any Zod schema without a `.max(...)` matching this repo's D1 bound-parameter convention (`src/worker/repositories/mediaAssets.js`'s `MAX_BOUND_PARAMS_PER_QUERY`) — not expected to bind in this phase (event/game commands operate on one game at a time), but confirm no task introduces one.
- D1 access during verification: **`--local` only, never `--remote`**.
- Any task that starts `wrangler dev` manually must fully terminate it and all child `workerd`/`esbuild` processes before finishing — verify via `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'wrangler|workerd' }` and kill survivors by PID.
- Migrations are additive-only; `0001`-`0006` are already applied and must never be edited. This phase's migration is `0007`.
- `SessionCoordinatorDO`'s existing methods (`assignCourt`, `replaceAssignedPlayer`, `releaseCourt`) use a `build*Statement` convention — a function returning an unexecuted `db.prepare(...).bind(...)` statement, composed into one `db.batch([...])` per command for crash-atomicity, with async convenience wrappers where a caller needs the immediate result. Every new write this phase introduces follows the same convention; read `src/worker/pickleball/SessionCoordinatorDO.ts` and `src/worker/repositories/pickleball/teams.js` before writing any new repository code.
- `ownsSession(sessionId)` (the DO's coordinator-identity self-check) already guards every existing method — every new method this phase adds to `SessionCoordinatorDO` must call it first, in the same style, before touching D1.

## Rulings (pre-flight, made during plan authoring before dispatch)

- **Ruling 1 — one `recordRally` command, not separate `recordPoint`/`sideOut` RPCs.** §6's DO responsibilities list enumerates `recordPoint, sideOut` as if they were two separate commands, but §7.1 is unambiguous and far more detailed: "`recordRally(state, ruleset, winningTeam): GameState` — the single function every rally-result button calls" and "This replaces manual +/- and manual side-out controls entirely." §7.1 is the authoritative, later-refined section; §6's phrasing is a loose enumeration of *event types*, not literal RPC method names. This plan implements one DO method, `recordRally(sessionId, gameId, winningTeam)`, which internally classifies the outcome (point / serve-changed / side-out) and appends the correctly-typed event. Cost if wrong: a client integration expecting two separate endpoints would need one small route rename — cheap to fix later, and the unified design is what §7.1's own UI contract (two buttons, not four) requires anyway.
- **Ruling 2 — `GAME_ABANDONED` added to `score_events.event_type`'s CHECK constraint.** The spec's own enumeration (§4.7) omits an event type for abandonment, but edge case #18 requires it ("Game abandoned → status = ABANDONED; excluded from OPI; court released") and the spec's own event-sourcing philosophy ("Canonical state is the event log") means every status-changing action needs a matching event, the same way `GAME_FINISHED`/`GAME_REOPENED` do. This migration is authored fresh in this phase (not editing an applied one), so completing the enum is additive, not a contradiction of anything the spec states. Cost if wrong: trivial to widen a CHECK constraint in a later additive migration if this turns out to need a different shape.
- **Ruling 3 — `player_game_stats` is written in Phase 4; `player_performance_snapshots`/OPI aggregation/leaderboards are not.** §7.3's reopen/correction flow requires "invalidateAndRecompute," which per §4.8 touches both `player_game_stats` and `player_performance_snapshots` — but the latter, and the whole OPI-aggregation machinery, is explicitly Phase 5 scope (§14.5). `player_game_stats` rows (per-game PF/PA/is_win/eligible_for_opi) are unavoidable finalization data — a finished game cannot exist without them, the same way Phase 3 wrote `session_players.games_played` without touching queue-fairness weighting logic beyond what it needed. This plan's `invalidateGameStats(gameId)` (Task 9) is a real, working *subset* of the spec's eventual `invalidateAndRecompute` — it deletes and re-derives `player_game_stats` correctly, and carries an explicit `// PHASE 5 SEAM` comment marking where snapshot-subtraction must be added once those tables exist. A minimal `src/lib/pickleball/opi.ts` is created now with only the per-game formula `gamePerformance(pf, pa)` (canonical-number unit-tested per §8/§65); the mean-aggregation `opi()` function and `recomputePlayerSnapshots` remain Phase 5's to add to the same file. Cost if wrong: none observable now — Phase 5 has a clearly named, tested seam to extend rather than a green-field problem.
- **Ruling 4 — `matchmaking_history`'s write side ships now; its read side (queue repeat-avoidance) does not.** §4.6 describes the table as "upserted... on every game finalization" — squarely this phase's finalization work, included in Task 9. Wiring it into `queueEngine.ts`'s repeat-avoidance tiebreak (§5 rule 3) was explicitly and deliberately left out of Phase 3's already-reviewed, already-merged scope; reopening that file here would be scope creep into a different phase's already-closed work. The table is populated correctly and completely for whenever that read-side integration happens. Cost if wrong: none — the data is there, unused, waiting.
- **Ruling 5 — `session_operator_grants` is built in this phase.** It was declared in Phase 1's migration with zero code anywhere since. This phase is the first time SCOREKEEPER's own distinct permissions (`SCORE_GAME`/`FINISH_GAME`/`UNDO_SCORE_EVENT`) are exercised by anything, and per §3.4's prose the whole point of those permissions existing is session-scoped, not org-wide — so without this table's real implementation, SCOREKEEPER's permissions are either meaningless (nothing checks the grant, giving org-wide access the spec explicitly forbids) or unusable (SCOREKEEPER blocked from everything). This is the same class of "declared but never built, now blocking" gap Phase 3.1 already fixed once for session-lifecycle transitions — caught here before merge instead of after. Task 6 builds the repository; Task 10 wires the check into every SCORE_GAME-gated route.
- **Ruling 6 — no UI.** Every phase actually executed so far (1-3) shipped API + DO + tests only; Phase 1's SPA shell (`src/pickleball-app/`) has stayed an empty shell since. This plan does the same. Flagged explicitly (also in Phase 3's own completion report) so a human can redirect if a scorekeeper screen is actually wanted now — building §7.4's UI without being asked would be scope creep in the other direction.
- **Ruling 7 — the `games` table needs four columns beyond the spec's literal enumeration.** §4.7 lists `games` columns as id, session_id, session_court_id, scoring_ruleset_id, format, status, team_a_id, team_b_id, revision, winning_team_id, final_score_a, final_score_b, started_at, finished_at, created_at, updated_at — but also says "`games` (score, status) is a materialized projection kept in sync... for fast reads," which requires somewhere to store the *live* score/serve/server state, not just the *final* score. The literal column list is evidently abbreviated, not exhaustive (it also never explicitly re-lists `created_at`/`updated_at` mechanics). This migration adds `score_a`, `score_b`, `serving_team`, `server_number` to carry the live `GameState` alongside the spec's own `final_score_a`/`final_score_b`/`winning_team_id` (frozen only once `FINISHED`). This is additive to the spec's model, not a contradiction of it — without it, every score read would require a full event replay, defeating the stated purpose of a projection.
- **Ruling 9 — `completeSession` is not a new DO method.** §6 lists `completeSession` alongside the game commands, but this transition already exists: Phase 3.1's `POST /api/pickleball/sessions/[id]/status` route plus `src/lib/pickleball/sessionStateMachine.ts`'s `completeSession(session)` already handle every session-status transition, including to `COMPLETED`, gated on `MANAGE_SESSIONS`. Nothing in this plan touches that route or module. Cost if wrong: none — the capability already exists and is already tested.
- **Ruling 8 — event payload shape: store the rally's *input*, not its *output*.** `score_events.payload_json` for a scoring event stores only `{ winningTeam }` — the fact that actually happened — never the resulting `GameState`. Replay always re-derives state by calling the same pure `recordRally` function forward from `GAME_STARTED`, the same way `rebuildGameProjection` is supposed to prove derived data is reproducible (§59). Storing a resulting-state snapshot in the event itself would let a corrupted/hand-edited event silently diverge from what replay recomputes, which is exactly the failure mode event-sourcing is meant to prevent.

---

## File Structure

```
migrations/pickleball/0007_games_and_scoring.sql             new

src/lib/pickleball/scoring/gameState.ts                       new — GameState, ScoringRulesetLike types, RallyOutcome
src/lib/pickleball/scoring/recordRally.ts                     new — recordRally, classifyRallyOutcome
src/lib/pickleball/scoring/recordRally.test.ts                new
src/lib/pickleball/scoring/display.ts                         new — officialScoreCall, isValidFinalScore, isGamePoint, contextualState
src/lib/pickleball/scoring/display.test.ts                    new
src/lib/pickleball/scoring/replayEvents.ts                    new — pure event-log -> projection fold
src/lib/pickleball/scoring/replayEvents.test.ts                new
src/lib/pickleball/opi.ts                                     new — gamePerformance(pf, pa) ONLY (Phase 5 seam)
src/lib/pickleball/opi.test.ts                                 new

src/worker/repositories/pickleball/games.js                    new
src/worker/repositories/pickleball/scoreEvents.js               new
src/worker/repositories/pickleball/matchmakingHistory.js        new
src/worker/repositories/pickleball/playerGameStats.js           new
src/worker/repositories/pickleball/idempotencyKeys.js           new
src/worker/repositories/pickleball/sessionOperatorGrants.js      new

src/worker/pickleball/gameProjection.ts                        new — rebuildGameProjection(db, gameId), thin D1 wrapper over replayEvents

src/lib/schemas/pickleball/games.ts                             new

src/pages/api/pickleball/sessions/[id]/games/index.ts                     new — GET list
src/pages/api/pickleball/sessions/[id]/games/start.ts                      new — POST
src/pages/api/pickleball/sessions/[id]/games/[gameId]/rally.ts             new — POST
src/pages/api/pickleball/sessions/[id]/games/[gameId]/undo.ts              new — POST
src/pages/api/pickleball/sessions/[id]/games/[gameId]/finish.ts            new — POST
src/pages/api/pickleball/sessions/[id]/games/[gameId]/abandon.ts           new — POST
src/pages/api/pickleball/sessions/[id]/games/[gameId]/reopen.ts            new — POST
src/pages/api/pickleball/sessions/[id]/games/[gameId]/correct.ts           new — POST
src/pages/api/pickleball/sessions/[id]/operators/grant.ts                  new — POST
src/pages/api/pickleball/sessions/[id]/operators/revoke.ts                 new — POST

src/worker/pickleball/SessionCoordinatorDO.ts                    modify — releaseCourt fix + startGame, recordRally, undoLastRally, finishGame, abandonGame, reopenGame, correctGame

tests/e2e/pickleball/pickleball-games.spec.js                    new
```

`sessions/[id]/games/[gameId]/*.ts` route files sit **7 levels** below `src/` (`pages/api/pickleball/sessions/[id]/games/[gameId]/`) — one deeper than Phase 3's `queue`/`courts` routes (6 levels) — needing `../../../../../../../` (7 `../`) to reach `src/lib/` or `src/worker/`. `sessions/[id]/games/index.ts`, `start.ts`, and `operators/*.ts` sit at the same 6-level depth Phase 3 already established. Confirm both depths with `tsc --noEmit`, don't hand-count and trust it.

---

### Task 1: Migration — `games`, `game_participants`, `score_events`, `idempotency_keys`, `matchmaking_history`, `player_game_stats`

**Files:**
- Create: `migrations/pickleball/0007_games_and_scoring.sql`

**Interfaces:**
- Produces: all 6 tables — consumed by every later task in this plan.

- [ ] **Step 1: Write the migration**

```sql
-- Pickleball Phase 4: event-sourced game engine.
--
-- `games` carries four columns beyond the design spec's literal enumeration
-- (score_a, score_b, serving_team, server_number) to hold the LIVE GameState
-- projection -- the spec's own text says games is "a materialized projection
-- kept in sync... for fast reads," which requires somewhere to put the live
-- score distinct from final_score_a/final_score_b (frozen only once
-- FINISHED). See the plan's Ruling 7.
--
-- score_events.event_type includes GAME_ABANDONED, which the design spec's
-- enumeration omitted despite requiring an explicit abandon action (edge
-- case #18) -- see the plan's Ruling 2. This migration is authored fresh, so
-- completing the enum here is additive, not an edit to an applied migration.

CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  session_court_id TEXT NOT NULL,
  scoring_ruleset_id TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('SINGLES', 'DOUBLES')),
  status TEXT NOT NULL DEFAULT 'IN_PROGRESS' CHECK (status IN ('SCHEDULED', 'IN_PROGRESS', 'FINISHED', 'ABANDONED', 'CANCELLED')),
  team_a_id TEXT NOT NULL,
  team_b_id TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  score_a INTEGER NOT NULL DEFAULT 0,
  score_b INTEGER NOT NULL DEFAULT 0,
  serving_team TEXT NOT NULL CHECK (serving_team IN ('A', 'B')),
  server_number INTEGER NOT NULL DEFAULT 2 CHECK (server_number IN (1, 2)),
  winning_team_id TEXT,
  final_score_a INTEGER,
  final_score_b INTEGER,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES pickleball_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (session_court_id) REFERENCES session_courts(id) ON DELETE CASCADE,
  FOREIGN KEY (scoring_ruleset_id) REFERENCES scoring_rulesets(id),
  FOREIGN KEY (team_a_id) REFERENCES teams(id),
  FOREIGN KEY (team_b_id) REFERENCES teams(id)
);

CREATE INDEX IF NOT EXISTS idx_games_session_status ON games(session_id, status);
CREATE INDEX IF NOT EXISTS idx_games_session_court ON games(session_court_id);

CREATE TABLE IF NOT EXISTS game_participants (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  session_player_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
  FOREIGN KEY (session_player_id) REFERENCES session_players(id) ON DELETE CASCADE,
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_game_participants_game ON game_participants(game_id);
CREATE INDEX IF NOT EXISTS idx_game_participants_session_player ON game_participants(session_player_id);

CREATE TABLE IF NOT EXISTS score_events (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'GAME_STARTED', 'POINT_AWARDED', 'POINT_REVERSED', 'SERVE_CHANGED',
    'SIDE_OUT', 'SCORE_CORRECTED', 'GAME_FINISHED', 'GAME_REOPENED', 'GAME_ABANDONED'
  )),
  actor_user_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_score_events_game_sequence ON score_events(game_id, sequence);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS matchmaking_history (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  other_player_id TEXT NOT NULL,
  relation TEXT NOT NULL CHECK (relation IN ('PARTNER', 'OPPONENT')),
  pairing_count INTEGER NOT NULL DEFAULT 1,
  last_game_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES pickleball_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE,
  FOREIGN KEY (other_player_id) REFERENCES players(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_matchmaking_history_pair
  ON matchmaking_history(session_id, player_id, other_player_id, relation);

CREATE TABLE IF NOT EXISTS player_game_stats (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  points_for INTEGER NOT NULL,
  points_against INTEGER NOT NULL,
  game_performance REAL NOT NULL,
  is_win INTEGER NOT NULL,
  eligible_for_opi INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
  FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_player_game_stats_game_player ON player_game_stats(game_id, player_id);
CREATE INDEX IF NOT EXISTS idx_player_game_stats_player ON player_game_stats(player_id);
```

- [ ] **Step 2: Apply locally and verify**

```bash
npx wrangler d1 migrations apply devlab-pickleball --local
npx wrangler d1 execute devlab-pickleball --local --command "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('games','game_participants','score_events','idempotency_keys','matchmaking_history','player_game_stats')"
```
Expected: 6 rows.

- [ ] **Step 3: Commit**

```bash
git add migrations/pickleball/0007_games_and_scoring.sql
git commit -m "feat: add Pickleball games, event log, and stats migration"
```

---

### Task 2: Pure scoring engine — `recordRally` and display functions

**Files:**
- Create: `src/lib/pickleball/scoring/gameState.ts`
- Create: `src/lib/pickleball/scoring/recordRally.ts`
- Test: `src/lib/pickleball/scoring/recordRally.test.ts`
- Create: `src/lib/pickleball/scoring/display.ts`
- Test: `src/lib/pickleball/scoring/display.test.ts`

**Interfaces:**
- Produces: `GameState { scoreA, scoreB, servingTeam: 'A'|'B', serverNumber: 1|2 }`, `ScoringRulesetLike { format: 'SINGLES'|'DOUBLES', targetScore: number, winBy: number }`, `RallyOutcome = 'POINT_AWARDED' | 'SERVE_CHANGED' | 'SIDE_OUT'`, `recordRally(state, ruleset, winningTeam): GameState`, `classifyRallyOutcome(before, after): RallyOutcome`, `officialScoreCall(state, format): string`, `isValidFinalScore(scoreA, scoreB, ruleset): boolean`, `isGamePoint(state, ruleset): boolean`, `contextualState(state, ruleset, lastOutcome): 'SIDE_OUT'|'GAME_POINT'|'TIED_WIN_BY_TWO'|null` — consumed by Task 3 (replay), Task 8/9/10 (the DO).

- [ ] **Step 1: `gameState.ts`**

```typescript
export interface GameState {
  scoreA: number
  scoreB: number
  servingTeam: 'A' | 'B'
  serverNumber: 1 | 2
}

export interface ScoringRulesetLike {
  format: 'SINGLES' | 'DOUBLES'
  targetScore: number
  winBy: number
}

export type RallyOutcome = 'POINT_AWARDED' | 'SERVE_CHANGED' | 'SIDE_OUT'

export function initialGameState(servingTeam: 'A' | 'B'): GameState {
  return { scoreA: 0, scoreB: 0, servingTeam, serverNumber: 2 }
}
```

- [ ] **Step 2: Write the failing test for `recordRally`**

```typescript
// src/lib/pickleball/scoring/recordRally.test.ts
import { describe, it, expect } from 'vitest'
import { recordRally, classifyRallyOutcome } from './recordRally'
import { initialGameState } from './gameState'

const DOUBLES = { format: 'DOUBLES' as const, targetScore: 11, winBy: 2 }
const SINGLES = { format: 'SINGLES' as const, targetScore: 11, winBy: 2 }

describe('recordRally', () => {
  it('awards a point when the serving team wins the rally', () => {
    const state = { scoreA: 3, scoreB: 5, servingTeam: 'A' as const, serverNumber: 2 as const }
    const next = recordRally(state, DOUBLES, 'A')
    expect(next).toEqual({ scoreA: 4, scoreB: 5, servingTeam: 'A', serverNumber: 2 })
  })

  it('serving team B wins increments only scoreB', () => {
    const state = { scoreA: 3, scoreB: 5, servingTeam: 'B' as const, serverNumber: 1 as const }
    const next = recordRally(state, DOUBLES, 'B')
    expect(next).toEqual({ scoreA: 3, scoreB: 6, servingTeam: 'B', serverNumber: 1 })
  })

  it('doubles: receiving team wins on server 1 -> no point, server advances to 2', () => {
    const state = { scoreA: 3, scoreB: 5, servingTeam: 'A' as const, serverNumber: 1 as const }
    const next = recordRally(state, DOUBLES, 'B')
    expect(next).toEqual({ scoreA: 3, scoreB: 5, servingTeam: 'A', serverNumber: 2 })
  })

  it('doubles: receiving team wins on server 2 -> side out, service transfers, new server is 1', () => {
    const state = { scoreA: 3, scoreB: 5, servingTeam: 'A' as const, serverNumber: 2 as const }
    const next = recordRally(state, DOUBLES, 'B')
    expect(next).toEqual({ scoreA: 3, scoreB: 5, servingTeam: 'B', serverNumber: 1 })
  })

  it('the opening 0-0-2 loses immediately to one lost rally (side out, no point)', () => {
    const opening = initialGameState('A')
    expect(opening).toEqual({ scoreA: 0, scoreB: 0, servingTeam: 'A', serverNumber: 2 })
    const next = recordRally(opening, DOUBLES, 'B')
    expect(next).toEqual({ scoreA: 0, scoreB: 0, servingTeam: 'B', serverNumber: 1 })
  })

  it('singles: receiving team win is always an immediate side out, never exposes server 1', () => {
    const state = { scoreA: 3, scoreB: 5, servingTeam: 'A' as const, serverNumber: 1 as const }
    const next = recordRally(state, SINGLES, 'B')
    expect(next).toEqual({ scoreA: 3, scoreB: 5, servingTeam: 'B', serverNumber: 1 })
  })

  it('singles: serving team win only ever increments the score, serverNumber stays 1', () => {
    const state = { scoreA: 3, scoreB: 5, servingTeam: 'A' as const, serverNumber: 1 as const }
    const next = recordRally(state, SINGLES, 'A')
    expect(next).toEqual({ scoreA: 4, scoreB: 5, servingTeam: 'A', serverNumber: 1 })
  })
})

describe('classifyRallyOutcome', () => {
  it('labels a same-server score increase as POINT_AWARDED', () => {
    const before = { scoreA: 3, scoreB: 5, servingTeam: 'A' as const, serverNumber: 2 as const }
    const after = { scoreA: 4, scoreB: 5, servingTeam: 'A' as const, serverNumber: 2 as const }
    expect(classifyRallyOutcome(before, after)).toBe('POINT_AWARDED')
  })

  it('labels a server-1-to-2 doubles transition as SERVE_CHANGED', () => {
    const before = { scoreA: 3, scoreB: 5, servingTeam: 'A' as const, serverNumber: 1 as const }
    const after = { scoreA: 3, scoreB: 5, servingTeam: 'A' as const, serverNumber: 2 as const }
    expect(classifyRallyOutcome(before, after)).toBe('SERVE_CHANGED')
  })

  it('labels a serving-team flip as SIDE_OUT', () => {
    const before = { scoreA: 3, scoreB: 5, servingTeam: 'A' as const, serverNumber: 2 as const }
    const after = { scoreA: 3, scoreB: 5, servingTeam: 'B' as const, serverNumber: 1 as const }
    expect(classifyRallyOutcome(before, after)).toBe('SIDE_OUT')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/lib/pickleball/scoring/recordRally.test.ts`
Expected: FAIL — `recordRally.ts` does not exist yet.

- [ ] **Step 4: Implement `recordRally.ts`**

```typescript
import type { GameState, ScoringRulesetLike, RallyOutcome } from './gameState'

export function recordRally(state: GameState, ruleset: ScoringRulesetLike, winningTeam: 'A' | 'B'): GameState {
  const servingTeamWon = winningTeam === state.servingTeam

  if (servingTeamWon) {
    return {
      ...state,
      scoreA: state.servingTeam === 'A' ? state.scoreA + 1 : state.scoreA,
      scoreB: state.servingTeam === 'B' ? state.scoreB + 1 : state.scoreB,
    }
  }

  // Receiving team won. Doubles has an intermediate "server 1 to server 2"
  // step with no point and no side out; singles has no server-1 concept at
  // all, so a receiving-team win there is always an immediate side out.
  if (ruleset.format === 'DOUBLES' && state.serverNumber === 1) {
    return { ...state, serverNumber: 2 }
  }

  return { ...state, servingTeam: winningTeam, serverNumber: 1 }
}

export function classifyRallyOutcome(before: GameState, after: GameState): RallyOutcome {
  if (before.servingTeam !== after.servingTeam) return 'SIDE_OUT'
  if (before.serverNumber !== after.serverNumber) return 'SERVE_CHANGED'
  return 'POINT_AWARDED'
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/pickleball/scoring/recordRally.test.ts`
Expected: PASS (all 9 cases)

- [ ] **Step 6: Write the failing test for display functions**

```typescript
// src/lib/pickleball/scoring/display.test.ts
import { describe, it, expect } from 'vitest'
import { officialScoreCall, isValidFinalScore, isGamePoint, contextualState } from './display'

const RULESET = { format: 'DOUBLES' as const, targetScore: 11, winBy: 2 }
const SINGLES = { format: 'SINGLES' as const, targetScore: 11, winBy: 2 }

describe('officialScoreCall', () => {
  it('doubles: calls the server\'s own score first, then the third server-number digit', () => {
    expect(officialScoreCall({ scoreA: 7, scoreB: 5, servingTeam: 'A', serverNumber: 2 }, 'DOUBLES')).toBe('7-5-2')
  })

  it('doubles: server\'s score is called first even when Team B is serving', () => {
    expect(officialScoreCall({ scoreA: 7, scoreB: 5, servingTeam: 'B', serverNumber: 1 }, 'DOUBLES')).toBe('5-7-1')
  })

  it('the digit order flips on a side out while scoreA/scoreB themselves never swap', () => {
    const beforeSideOut = { scoreA: 7, scoreB: 5, servingTeam: 'A' as const, serverNumber: 2 as const }
    const afterSideOut = { scoreA: 7, scoreB: 5, servingTeam: 'B' as const, serverNumber: 1 as const }
    expect(officialScoreCall(beforeSideOut, 'DOUBLES')).toBe('7-5-2')
    expect(officialScoreCall(afterSideOut, 'DOUBLES')).toBe('5-7-1')
    expect(afterSideOut.scoreA).toBe(beforeSideOut.scoreA)
    expect(afterSideOut.scoreB).toBe(beforeSideOut.scoreB)
  })

  it('singles: no third digit, no server-number concept', () => {
    expect(officialScoreCall({ scoreA: 7, scoreB: 5, servingTeam: 'A', serverNumber: 1 }, 'SINGLES')).toBe('7-5')
  })
})

describe('isValidFinalScore', () => {
  it.each([
    [11, 7, true],
    [11, 9, true],
    [11, 10, false],
    [12, 10, true],
    [13, 11, true],
    [10, 8, false],
  ])('scoreA=%i scoreB=%i -> %s', (scoreA, scoreB, expected) => {
    expect(isValidFinalScore(scoreA, scoreB, RULESET)).toBe(expected)
  })

  it('never hardcodes 11 -- respects a different targetScore', () => {
    const to15 = { format: 'DOUBLES' as const, targetScore: 15, winBy: 2 }
    expect(isValidFinalScore(11, 7, to15)).toBe(false)
    expect(isValidFinalScore(15, 13, to15)).toBe(true)
  })
})

describe('isGamePoint', () => {
  it('true when the serving team winning one more rally would end the game', () => {
    expect(isGamePoint({ scoreA: 10, scoreB: 6, servingTeam: 'A', serverNumber: 2 }, RULESET)).toBe(true)
  })

  it('false when one more point for the server would not yet be a valid final score', () => {
    expect(isGamePoint({ scoreA: 9, scoreB: 6, servingTeam: 'A', serverNumber: 2 }, RULESET)).toBe(false)
  })

  it('false when the RECEIVING team is one point from ending it -- only the server\'s next point counts', () => {
    expect(isGamePoint({ scoreA: 6, scoreB: 10, servingTeam: 'A', serverNumber: 2 }, RULESET)).toBe(false)
  })
})

describe('contextualState', () => {
  it('SIDE_OUT takes priority when the last rally was a side out, even at game point', () => {
    expect(contextualState({ scoreA: 10, scoreB: 6, servingTeam: 'A', serverNumber: 1 }, RULESET, 'SIDE_OUT')).toBe('SIDE_OUT')
  })

  it('GAME_POINT when the server is one rally from winning and the last rally was not a side out', () => {
    expect(contextualState({ scoreA: 10, scoreB: 6, servingTeam: 'A', serverNumber: 2 }, RULESET, 'POINT_AWARDED')).toBe('GAME_POINT')
  })

  it('TIED_WIN_BY_TWO when scores are tied at or above targetScore - 1', () => {
    expect(contextualState({ scoreA: 10, scoreB: 10, servingTeam: 'A', serverNumber: 2 }, RULESET, 'POINT_AWARDED')).toBe('TIED_WIN_BY_TWO')
  })

  it('null when nothing special applies', () => {
    expect(contextualState({ scoreA: 3, scoreB: 2, servingTeam: 'A', serverNumber: 2 }, RULESET, 'POINT_AWARDED')).toBe(null)
  })

  it('null lastOutcome is treated the same as no special transient state', () => {
    expect(contextualState({ scoreA: 3, scoreB: 2, servingTeam: 'A', serverNumber: 2 }, RULESET, null)).toBe(null)
  })

  it('singles behaves identically -- no server-1 concept changes the logic here', () => {
    expect(contextualState({ scoreA: 10, scoreB: 6, servingTeam: 'A', serverNumber: 1 }, SINGLES, 'POINT_AWARDED')).toBe('GAME_POINT')
  })
})
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npx vitest run src/lib/pickleball/scoring/display.test.ts`
Expected: FAIL — `display.ts` does not exist yet.

- [ ] **Step 8: Implement `display.ts`**

```typescript
import type { GameState, ScoringRulesetLike, RallyOutcome } from './gameState'

export function officialScoreCall(state: GameState, format: 'SINGLES' | 'DOUBLES'): string {
  const servingScore = state.servingTeam === 'A' ? state.scoreA : state.scoreB
  const receivingScore = state.servingTeam === 'A' ? state.scoreB : state.scoreA
  if (format === 'SINGLES') return `${servingScore}-${receivingScore}`
  return `${servingScore}-${receivingScore}-${state.serverNumber}`
}

export function isValidFinalScore(scoreA: number, scoreB: number, ruleset: ScoringRulesetLike): boolean {
  return Math.max(scoreA, scoreB) >= ruleset.targetScore && Math.abs(scoreA - scoreB) >= ruleset.winBy
}

export function isGamePoint(state: GameState, ruleset: ScoringRulesetLike): boolean {
  const hypotheticalScoreA = state.servingTeam === 'A' ? state.scoreA + 1 : state.scoreA
  const hypotheticalScoreB = state.servingTeam === 'B' ? state.scoreB + 1 : state.scoreB
  return isValidFinalScore(hypotheticalScoreA, hypotheticalScoreB, ruleset)
}

export function contextualState(
  state: GameState,
  ruleset: ScoringRulesetLike,
  lastOutcome: RallyOutcome | null,
): 'SIDE_OUT' | 'GAME_POINT' | 'TIED_WIN_BY_TWO' | null {
  if (lastOutcome === 'SIDE_OUT') return 'SIDE_OUT'
  if (isGamePoint(state, ruleset)) return 'GAME_POINT'
  if (state.scoreA === state.scoreB && state.scoreA >= ruleset.targetScore - 1) return 'TIED_WIN_BY_TWO'
  return null
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `npx vitest run src/lib/pickleball/scoring/display.test.ts`
Expected: PASS (all cases)

- [ ] **Step 10: Commit**

```bash
git add src/lib/pickleball/scoring/gameState.ts src/lib/pickleball/scoring/recordRally.ts src/lib/pickleball/scoring/recordRally.test.ts src/lib/pickleball/scoring/display.ts src/lib/pickleball/scoring/display.test.ts
git commit -m "feat: add Pickleball rally-driven scoring engine"
```

---

### Task 3: Pure event-log replay — `replayEvents`

**Files:**
- Create: `src/lib/pickleball/scoring/replayEvents.ts`
- Test: `src/lib/pickleball/scoring/replayEvents.test.ts`

**Interfaces:**
- Consumes: `recordRally`, `GameState`, `ScoringRulesetLike` (Task 2).
- Produces: `interface ReplayableEvent { sequence: number; eventType: string; payload: unknown }`, `interface ReplayResult { state: GameState; status: 'IN_PROGRESS'|'FINISHED'|'ABANDONED'; winningTeamId: string|null; finalScoreA: number|null; finalScoreB: number|null }`, `replayEvents(events: ReplayableEvent[], ruleset: ScoringRulesetLike): ReplayResult` — consumed by Task 7's `gameProjection.ts` (the only caller; the DO never calls this directly, it calls `rebuildGameProjection`).

This is the pure core of the spec's `rebuildGameProjection` — no D1, so it is directly unit-testable, matching this repo's established "pure core + thin DB wrapper" split (`queueEngine.ts` / DO, `sessionStateMachine.ts` / route).

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest'
import { replayEvents } from './replayEvents'

const RULESET = { format: 'DOUBLES' as const, targetScore: 11, winBy: 2 }

function event(sequence: number, eventType: string, payload: unknown) {
  return { sequence, eventType, payload }
}

describe('replayEvents', () => {
  it('replays GAME_STARTED into the canonical opening state', () => {
    const result = replayEvents([event(1, 'GAME_STARTED', { servingTeam: 'A' })], RULESET)
    expect(result.state).toEqual({ scoreA: 0, scoreB: 0, servingTeam: 'A', serverNumber: 2 })
    expect(result.status).toBe('IN_PROGRESS')
  })

  it('replays a sequence of rallies deterministically, same as calling recordRally directly', () => {
    const events = [
      event(1, 'GAME_STARTED', { servingTeam: 'A' }),
      event(2, 'SIDE_OUT', { winningTeam: 'B' }), // 0-0-2, B wins -> side out to B, server 1
      event(3, 'POINT_AWARDED', { winningTeam: 'B' }), // B serves, B wins -> 0-1
      event(4, 'SERVE_CHANGED', { winningTeam: 'A' }), // B serves (server 1), A wins -> server 2, no point
    ]
    const result = replayEvents(events, RULESET)
    expect(result.state).toEqual({ scoreA: 0, scoreB: 1, servingTeam: 'B', serverNumber: 2 })
  })

  it('a POINT_REVERSED event excludes the referenced sequence from the replay, not just the last one', () => {
    const events = [
      event(1, 'GAME_STARTED', { servingTeam: 'A' }),
      event(2, 'POINT_AWARDED', { winningTeam: 'A' }), // 1-0
      event(3, 'POINT_AWARDED', { winningTeam: 'A' }), // 2-0
      event(4, 'POINT_REVERSED', { reversedSequence: 3 }),
    ]
    const result = replayEvents(events, RULESET)
    expect(result.state).toEqual({ scoreA: 1, scoreB: 0, servingTeam: 'A', serverNumber: 2 })
  })

  it('SCORE_CORRECTED overrides the state outright and later events replay forward from it', () => {
    const events = [
      event(1, 'GAME_STARTED', { servingTeam: 'A' }),
      event(2, 'POINT_AWARDED', { winningTeam: 'A' }), // 1-0
      event(3, 'SCORE_CORRECTED', { scoreA: 8, scoreB: 6, servingTeam: 'A', serverNumber: 2 }),
      event(4, 'POINT_AWARDED', { winningTeam: 'A' }), // 9-6
    ]
    const result = replayEvents(events, RULESET)
    expect(result.state).toEqual({ scoreA: 9, scoreB: 6, servingTeam: 'A', serverNumber: 2 })
  })

  it('GAME_FINISHED sets status FINISHED and freezes the final score/winner', () => {
    const events = [
      event(1, 'GAME_STARTED', { servingTeam: 'A' }),
      event(2, 'SCORE_CORRECTED', { scoreA: 10, scoreB: 8, servingTeam: 'A', serverNumber: 2 }),
      event(3, 'POINT_AWARDED', { winningTeam: 'A' }), // 11-8
      event(4, 'GAME_FINISHED', { finalScoreA: 11, finalScoreB: 8, winningTeamId: 'team-a' }),
    ]
    const result = replayEvents(events, RULESET)
    expect(result.status).toBe('FINISHED')
    expect(result.winningTeamId).toBe('team-a')
    expect(result.finalScoreA).toBe(11)
    expect(result.finalScoreB).toBe(8)
  })

  it('GAME_REOPENED after GAME_FINISHED clears finished status and final score', () => {
    const events = [
      event(1, 'GAME_STARTED', { servingTeam: 'A' }),
      event(2, 'SCORE_CORRECTED', { scoreA: 11, scoreB: 8, servingTeam: 'A', serverNumber: 2 }),
      event(3, 'GAME_FINISHED', { finalScoreA: 11, finalScoreB: 8, winningTeamId: 'team-a' }),
      event(4, 'GAME_REOPENED', {}),
    ]
    const result = replayEvents(events, RULESET)
    expect(result.status).toBe('IN_PROGRESS')
    expect(result.winningTeamId).toBe(null)
    expect(result.finalScoreA).toBe(null)
    expect(result.finalScoreB).toBe(null)
  })

  it('GAME_ABANDONED sets status ABANDONED with no winner', () => {
    const events = [
      event(1, 'GAME_STARTED', { servingTeam: 'A' }),
      event(2, 'POINT_AWARDED', { winningTeam: 'A' }),
      event(3, 'GAME_ABANDONED', {}),
    ]
    const result = replayEvents(events, RULESET)
    expect(result.status).toBe('ABANDONED')
    expect(result.winningTeamId).toBe(null)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/pickleball/scoring/replayEvents.test.ts`
Expected: FAIL — `replayEvents.ts` does not exist yet.

- [ ] **Step 3: Implement**

```typescript
import type { GameState, ScoringRulesetLike } from './gameState'
import { recordRally } from './recordRally'

export interface ReplayableEvent {
  sequence: number
  eventType: string
  payload: any
}

export interface ReplayResult {
  state: GameState
  status: 'IN_PROGRESS' | 'FINISHED' | 'ABANDONED'
  winningTeamId: string | null
  finalScoreA: number | null
  finalScoreB: number | null
}

const SCORING_EVENT_TYPES = new Set(['POINT_AWARDED', 'SERVE_CHANGED', 'SIDE_OUT'])

export function replayEvents(events: ReplayableEvent[], ruleset: ScoringRulesetLike): ReplayResult {
  const reversedSequences = new Set<number>(
    events.filter((e) => e.eventType === 'POINT_REVERSED').map((e) => e.payload.reversedSequence),
  )

  let state: GameState = { scoreA: 0, scoreB: 0, servingTeam: 'A', serverNumber: 2 }
  let status: ReplayResult['status'] = 'IN_PROGRESS'
  let winningTeamId: string | null = null
  let finalScoreA: number | null = null
  let finalScoreB: number | null = null

  for (const event of events) {
    if (event.eventType === 'GAME_STARTED') {
      state = { scoreA: 0, scoreB: 0, servingTeam: event.payload.servingTeam, serverNumber: 2 }
      continue
    }

    if (SCORING_EVENT_TYPES.has(event.eventType)) {
      if (reversedSequences.has(event.sequence)) continue
      state = recordRally(state, ruleset, event.payload.winningTeam)
      continue
    }

    if (event.eventType === 'SCORE_CORRECTED') {
      state = {
        scoreA: event.payload.scoreA,
        scoreB: event.payload.scoreB,
        servingTeam: event.payload.servingTeam,
        serverNumber: event.payload.serverNumber,
      }
      continue
    }

    if (event.eventType === 'GAME_FINISHED') {
      status = 'FINISHED'
      winningTeamId = event.payload.winningTeamId
      finalScoreA = event.payload.finalScoreA
      finalScoreB = event.payload.finalScoreB
      continue
    }

    if (event.eventType === 'GAME_REOPENED') {
      status = 'IN_PROGRESS'
      winningTeamId = null
      finalScoreA = null
      finalScoreB = null
      continue
    }

    if (event.eventType === 'GAME_ABANDONED') {
      status = 'ABANDONED'
      winningTeamId = null
      continue
    }

    // POINT_REVERSED itself carries no direct state effect -- its effect is
    // the `reversedSequences` exclusion computed above, applied uniformly
    // regardless of where in the sequence it appears.
  }

  return { state, status, winningTeamId, finalScoreA, finalScoreB }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/pickleball/scoring/replayEvents.test.ts`
Expected: PASS (all 7 cases)

- [ ] **Step 5: Commit**

```bash
git add src/lib/pickleball/scoring/replayEvents.ts src/lib/pickleball/scoring/replayEvents.test.ts
git commit -m "feat: add Pickleball event-log replay engine"
```

---

### Task 4: Minimal OPI seam — `gamePerformance`

**Files:**
- Create: `src/lib/pickleball/opi.ts`
- Test: `src/lib/pickleball/opi.test.ts`

**Interfaces:**
- Produces: `gamePerformance(pointsFor: number, pointsAgainst: number): number` — consumed by Task 9's `finishGame` to populate `player_game_stats.game_performance`. Phase 5 extends this SAME file with `opi(games)` and `recomputePlayerSnapshots` — do not build those here.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest'
import { gamePerformance } from './opi'

// Canonical numbers from spec §8/§65. Rounded to 6 decimals for the
// assertion to avoid float-equality flakiness -- the function itself
// returns full precision.
function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6
}

describe('gamePerformance', () => {
  it('11-7 -> 61.111...', () => {
    expect(round6(gamePerformance(11, 7))).toBe(round6(61.111111111111114))
  })

  it('9-11 -> 45', () => {
    expect(round6(gamePerformance(9, 11))).toBe(45)
  })

  it('11-5 -> 68.75', () => {
    expect(round6(gamePerformance(11, 5))).toBe(68.75)
  })

  it('mean of the three canonical games -> 58.287..., display 58.29', () => {
    const values = [gamePerformance(11, 7), gamePerformance(9, 11), gamePerformance(11, 5)]
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length
    expect(round6(mean)).toBe(round6(58.287037037037045))
    expect(mean.toFixed(2)).toBe('58.29')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/pickleball/opi.test.ts`
Expected: FAIL — `opi.ts` does not exist yet.

- [ ] **Step 3: Implement**

```typescript
// PHASE 5 SEAM: this file holds only the per-game formula, the one piece
// Phase 4's finishGame needs to populate player_game_stats.game_performance.
// Phase 5 adds opi(games) (the mean-aggregation function) and
// recomputePlayerSnapshots to this SAME file -- do not reimplement the
// formula anywhere else (spec §38's single-source-of-truth requirement).
export function gamePerformance(pointsFor: number, pointsAgainst: number): number {
  return (pointsFor / (pointsFor + pointsAgainst)) * 100
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/pickleball/opi.test.ts`
Expected: PASS (all 4 cases)

- [ ] **Step 5: Commit**

```bash
git add src/lib/pickleball/opi.ts src/lib/pickleball/opi.test.ts
git commit -m "feat: add Pickleball per-game OPI formula (Phase 5 seam)"
```

---

### Task 5: Repositories — games, score events, matchmaking, stats, idempotency, operator grants

**Files:**
- Create: `src/worker/repositories/pickleball/games.js`
- Create: `src/worker/repositories/pickleball/scoreEvents.js`
- Create: `src/worker/repositories/pickleball/matchmakingHistory.js`
- Create: `src/worker/repositories/pickleball/playerGameStats.js`
- Create: `src/worker/repositories/pickleball/idempotencyKeys.js`
- Create: `src/worker/repositories/pickleball/sessionOperatorGrants.js`

**Interfaces:**
- Consumes: none beyond D1 conventions already established (`nowIso` from `src/worker/utils/responses.js`).
- Produces:
  - `games.js`: `buildCreateGameStatement(db, {id, sessionId, sessionCourtId, scoringRulesetId, format, teamAId, teamBId, servingTeam, timestamp})`, `getGame(db, sessionId, gameId)`, `getGameById(db, gameId)` (trusted-internal, no session filter — for the DO, mirroring `sessions.js`'s `getSessionById` convention), `buildUpdateGameProjectionStatement(db, gameId, {scoreA, scoreB, servingTeam, serverNumber, status, winningTeamId, finalScoreA, finalScoreB, revision})`, `listGamesForSession(db, sessionId)`.
  - `scoreEvents.js`: `buildAppendScoreEventStatement(db, {gameId, sequence, eventType, actorUserId, payload})`, `listScoreEventsForGame(db, gameId)` (ordered by sequence, parsed payload), `getNextSequence(db, gameId)` (returns `MAX(sequence)+1` or `1`).
  - `matchmakingHistory.js`: `buildUpsertMatchmakingStatement(db, {sessionId, playerId, otherPlayerId, relation, timestamp})` (upserts, incrementing `pairing_count` on conflict).
  - `playerGameStats.js`: `buildCreatePlayerGameStatStatement(db, {gameId, playerId, pointsFor, pointsAgainst, gamePerformance, isWin, eligibleForOpi, timestamp})`, `buildDeletePlayerGameStatsForGameStatement(db, gameId)`.
  - `idempotencyKeys.js`: `getIdempotentResult(db, key)`, `buildRecordIdempotentResultStatement(db, {key, gameId, result, timestamp})`.
  - `sessionOperatorGrants.js`: `hasSessionOperatorGrant(db, sessionId, userId)`, `grantSessionOperator(db, {sessionId, userId, grantedByUserId})`, `revokeSessionOperator(db, sessionId, userId)`.
- Consumed by: Task 7's `gameProjection.ts` (games.js, scoreEvents.js) and Tasks 8-11's `SessionCoordinatorDO` methods (all six files) and Task 13's routes (`sessionOperatorGrants.js` directly).

No Vitest step (DB-touching, verified via Playwright in Task 15, matching this repo's established convention from Phase 3's Task 4).

- [ ] **Step 1: `games.js`**

```javascript
import { nowIso } from '../../utils/responses.js'

function toGame(row) {
  if (!row) return null
  return {
    id: row.id,
    sessionId: row.session_id,
    sessionCourtId: row.session_court_id,
    scoringRulesetId: row.scoring_ruleset_id,
    format: row.format,
    status: row.status,
    teamAId: row.team_a_id,
    teamBId: row.team_b_id,
    revision: row.revision,
    scoreA: row.score_a,
    scoreB: row.score_b,
    servingTeam: row.serving_team,
    serverNumber: row.server_number,
    winningTeamId: row.winning_team_id,
    finalScoreA: row.final_score_a,
    finalScoreB: row.final_score_b,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const GAME_COLUMNS = `id, session_id, session_court_id, scoring_ruleset_id, format, status, team_a_id, team_b_id,
  revision, score_a, score_b, serving_team, server_number, winning_team_id, final_score_a, final_score_b,
  started_at, finished_at, created_at, updated_at`

export function buildCreateGameStatement(db, { id, sessionId, sessionCourtId, scoringRulesetId, format, teamAId, teamBId, servingTeam, timestamp }) {
  return db
    .prepare(
      `INSERT INTO games (
        id, session_id, session_court_id, scoring_ruleset_id, format, status, team_a_id, team_b_id,
        revision, score_a, score_b, serving_team, server_number, started_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'IN_PROGRESS', ?, ?, 1, 0, 0, ?, 2, ?, ?, ?)`,
    )
    .bind(id, sessionId, sessionCourtId, scoringRulesetId, format, teamAId, teamBId, servingTeam, timestamp, timestamp, timestamp)
}

export async function getGame(db, sessionId, gameId) {
  const row = await db
    .prepare(`SELECT ${GAME_COLUMNS} FROM games WHERE session_id = ? AND id = ?`)
    .bind(sessionId, gameId)
    .first()
  return toGame(row)
}

// TRUSTED-INTERNAL ONLY -- no session_id filter. Mirrors sessions.js's
// getSessionById: safe only because SessionCoordinatorDO's every caller has
// already resolved gameId through the session-scoped route layer above it.
export async function getGameById(db, gameId) {
  const row = await db.prepare(`SELECT ${GAME_COLUMNS} FROM games WHERE id = ?`).bind(gameId).first()
  return toGame(row)
}

export function buildUpdateGameProjectionStatement(db, gameId, { scoreA, scoreB, servingTeam, serverNumber, status, winningTeamId, finalScoreA, finalScoreB, revision }) {
  return db
    .prepare(
      `UPDATE games SET score_a = ?, score_b = ?, serving_team = ?, server_number = ?, status = ?,
        winning_team_id = ?, final_score_a = ?, final_score_b = ?, revision = ?, updated_at = ?,
        finished_at = CASE WHEN ? = 'FINISHED' THEN ? ELSE finished_at END
       WHERE id = ?`,
    )
    .bind(
      scoreA, scoreB, servingTeam, serverNumber, status, winningTeamId ?? null, finalScoreA ?? null, finalScoreB ?? null,
      revision, nowIso(), status, nowIso(), gameId,
    )
}

export async function listGamesForSession(db, sessionId) {
  const result = await db
    .prepare(`SELECT ${GAME_COLUMNS} FROM games WHERE session_id = ? ORDER BY started_at DESC`)
    .bind(sessionId)
    .all()
  return (result.results || []).map(toGame)
}
```

- [ ] **Step 2: `scoreEvents.js`**

```javascript
import { nowIso, parseJsonField } from '../../utils/responses.js'

function toScoreEvent(row) {
  if (!row) return null
  return {
    id: row.id,
    gameId: row.game_id,
    sequence: row.sequence,
    eventType: row.event_type,
    actorUserId: row.actor_user_id,
    payload: parseJsonField(row.payload_json, {}),
    createdAt: row.created_at,
  }
}

export function buildAppendScoreEventStatement(db, { gameId, sequence, eventType, actorUserId, payload }) {
  return db
    .prepare(
      `INSERT INTO score_events (id, game_id, sequence, event_type, actor_user_id, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(crypto.randomUUID(), gameId, sequence, eventType, actorUserId, JSON.stringify(payload ?? {}), nowIso())
}

export async function listScoreEventsForGame(db, gameId) {
  const result = await db
    .prepare(`SELECT id, game_id, sequence, event_type, actor_user_id, payload_json, created_at FROM score_events WHERE game_id = ? ORDER BY sequence ASC`)
    .bind(gameId)
    .all()
  return (result.results || []).map(toScoreEvent)
}

export async function getNextSequence(db, gameId) {
  const row = await db.prepare(`SELECT MAX(sequence) AS maxSequence FROM score_events WHERE game_id = ?`).bind(gameId).first()
  return (row?.maxSequence ?? 0) + 1
}
```

- [ ] **Step 3: `matchmakingHistory.js`**

```javascript
export function buildUpsertMatchmakingStatement(db, { sessionId, playerId, otherPlayerId, relation, timestamp }) {
  return db
    .prepare(
      `INSERT INTO matchmaking_history (id, session_id, player_id, other_player_id, relation, pairing_count, last_game_at)
       VALUES (?, ?, ?, ?, ?, 1, ?)
       ON CONFLICT(session_id, player_id, other_player_id, relation) DO UPDATE SET
         pairing_count = pairing_count + 1,
         last_game_at = excluded.last_game_at`,
    )
    .bind(crypto.randomUUID(), sessionId, playerId, otherPlayerId, relation, timestamp)
}
```

- [ ] **Step 4: `playerGameStats.js`**

```javascript
import { nowIso } from '../../utils/responses.js'

export function buildCreatePlayerGameStatStatement(db, { gameId, playerId, pointsFor, pointsAgainst, gamePerformance, isWin, eligibleForOpi }) {
  return db
    .prepare(
      `INSERT INTO player_game_stats (id, game_id, player_id, points_for, points_against, game_performance, is_win, eligible_for_opi, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(crypto.randomUUID(), gameId, playerId, pointsFor, pointsAgainst, gamePerformance, isWin ? 1 : 0, eligibleForOpi ? 1 : 0, nowIso())
}

// PHASE 5 SEAM: once player_performance_snapshots exists, invalidating a
// finalized game's stats must also subtract this game's contribution from
// each participant's snapshot before this delete runs -- see spec §7.3's
// invalidateAndRecompute and this plan's Ruling 3. Not yet possible: those
// tables don't exist until Phase 5.
export function buildDeletePlayerGameStatsForGameStatement(db, gameId) {
  return db.prepare(`DELETE FROM player_game_stats WHERE game_id = ?`).bind(gameId)
}
```

- [ ] **Step 5: `idempotencyKeys.js`**

```javascript
import { nowIso, parseJsonField } from '../../utils/responses.js'

export async function getIdempotentResult(db, key) {
  if (!key) return null
  const row = await db.prepare(`SELECT result_json FROM idempotency_keys WHERE key = ?`).bind(key).first()
  if (!row) return null
  return parseJsonField(row.result_json, null)
}

export function buildRecordIdempotentResultStatement(db, { key, gameId, result }) {
  return db
    .prepare(`INSERT INTO idempotency_keys (key, game_id, result_json, created_at) VALUES (?, ?, ?, ?)`)
    .bind(key, gameId, JSON.stringify(result), nowIso())
}
```

- [ ] **Step 6: `sessionOperatorGrants.js`**

```javascript
import { nowIso } from '../../utils/responses.js'

export async function hasSessionOperatorGrant(db, sessionId, userId) {
  const row = await db
    .prepare(`SELECT id FROM session_operator_grants WHERE session_id = ? AND user_id = ?`)
    .bind(sessionId, userId)
    .first()
  return Boolean(row)
}

export async function grantSessionOperator(db, { sessionId, userId, grantedByUserId }) {
  await db
    .prepare(
      `INSERT INTO session_operator_grants (id, session_id, user_id, granted_by_user_id, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(session_id, user_id) DO NOTHING`,
    )
    .bind(crypto.randomUUID(), sessionId, userId, grantedByUserId, nowIso())
    .run()
  return hasSessionOperatorGrant(db, sessionId, userId)
}

export async function revokeSessionOperator(db, sessionId, userId) {
  const result = await db
    .prepare(`DELETE FROM session_operator_grants WHERE session_id = ? AND user_id = ?`)
    .bind(sessionId, userId)
    .run()
  return Boolean(result.meta.changes)
}
```

`session_operator_grants` already has `UNIQUE(session_id, user_id)` from Phase 1's migration (confirmed by reading `0001_foundation.sql` before writing this task) — the `ON CONFLICT ... DO NOTHING` above relies on that existing constraint, not a new one.

- [ ] **Step 7: Commit**

```bash
git add src/worker/repositories/pickleball/games.js src/worker/repositories/pickleball/scoreEvents.js src/worker/repositories/pickleball/matchmakingHistory.js src/worker/repositories/pickleball/playerGameStats.js src/worker/repositories/pickleball/idempotencyKeys.js src/worker/repositories/pickleball/sessionOperatorGrants.js
git commit -m "feat: add Pickleball games, event log, and stats repositories"
```

---

### Task 6: `rebuildGameProjection` — the D1 wrapper around `replayEvents`

**Files:**
- Create: `src/worker/pickleball/gameProjection.ts`

**Interfaces:**
- Consumes: `listScoreEventsForGame`, `getGameById`, `buildUpdateGameProjectionStatement` (Task 5), `replayEvents` (Task 3), `getScoringRuleset` (Phase 1's `sessions.js`).
- Produces: `rebuildGameProjection(db, gameId): Promise<void>` — consumed by Task 13's routes (exposed as a debug/recovery action is NOT in scope; this task only needs the function itself to exist and be correct, exercised directly by this task's own verification and Task 15's e2e "corrupt and recover" test).

- [ ] **Step 1: Implement**

```typescript
import { listScoreEventsForGame } from '../repositories/pickleball/scoreEvents.js'
import { getGameById, buildUpdateGameProjectionStatement } from '../repositories/pickleball/games.js'
import { getSessionById, getScoringRuleset } from '../repositories/pickleball/sessions.js'
import { replayEvents } from '../../lib/pickleball/scoring/replayEvents'

// Recovery mechanism for spec §59 ("derived data must be reproducible"):
// re-derives the games row entirely from its own append-only event log,
// via the same pure recordRally function every live command already uses.
// If this function's output ever differs from what a live command produced,
// that is a live bug in either the command handler or this rebuild path --
// there is no third, independent source of truth to defer to.
export async function rebuildGameProjection(db: D1Database, gameId: string): Promise<void> {
  const game = await getGameById(db, gameId)
  if (!game) throw new Error(`Cannot rebuild projection: game ${gameId} not found.`)

  const session = await getSessionById(db, game.sessionId)
  const ruleset = await getScoringRuleset(db, game.scoringRulesetId, session.organizationId)

  const events = await listScoreEventsForGame(db, gameId)
  const result = replayEvents(
    events.map((e) => ({ sequence: e.sequence, eventType: e.eventType, payload: e.payload })),
    ruleset,
  )

  await buildUpdateGameProjectionStatement(db, gameId, {
    scoreA: result.state.scoreA,
    scoreB: result.state.scoreB,
    servingTeam: result.state.servingTeam,
    serverNumber: result.state.serverNumber,
    status: result.status,
    winningTeamId: result.winningTeamId,
    finalScoreA: result.finalScoreA,
    finalScoreB: result.finalScoreB,
    revision: events.length,
  }).run()
}
```

- [ ] **Step 2: Verify with `tsc`**

Run `npx tsc --noEmit -p tsconfig.json` — clean. Full runtime verification happens in Task 15's e2e suite, which corrupts a game's projection row directly via `wrangler d1 execute --local`, calls a route/command that invokes `rebuildGameProjection`, and asserts the row is restored to the value the event log actually implies — this task's own scope is limited to the function compiling correctly and matching Task 3's `replayEvents` interface exactly, since a Durable Object's internals aren't independently runnable outside `wrangler dev`.

- [ ] **Step 3: Commit**

```bash
git add src/worker/pickleball/gameProjection.ts
git commit -m "feat: add Pickleball game-projection rebuild from the event log"
```

---

### Task 7: `SessionCoordinatorDO` — fix `releaseCourt`, add `startGame`

**Files:**
- Modify: `src/worker/pickleball/SessionCoordinatorDO.ts`
- Modify: `src/worker/repositories/pickleball/queueEntries.js` (add `buildMarkPlayingStatement`, mirroring `buildMarkAssignedStatement`'s exact shape)

**Interfaces:**
- Consumes: `buildCreateGameStatement` (Task 5), `buildMarkPlayingStatement` (this task), `getScoringRuleset`/`getSessionById` (existing), `listAssignedSessionPlayerIdsForCourt`/`getTeamWithMembers` (existing `teams.js`).
- Produces: `SessionCoordinatorDO.startGame(sessionId, sessionCourtId): Promise<{ok: true, game}|{ok: false, error}>` — consumed by Task 13's `games/start.ts` route.

**Step 1 fixes a real, already-identified bug before this task adds anything new**, so the fix lands as its own reviewable unit rather than buried inside a larger diff.

- [ ] **Step 1: Fix `releaseCourt`**

Two changes to the EXISTING `releaseCourt` method in `SessionCoordinatorDO.ts` (read the current file before editing — it has moved since Phase 3 merged, do not assume line numbers):

1. **Remove the `buildIncrementGamesPlayedStatement(...)` call from the `statements` flatMap.** Its own doc comment in `sessionPlayers.js` already says: "Until Phase 4's game engine can increment it at game-finish time, Phase 3 does it when a court assignment ends." That time is now — Task 9's `finishGame` (and `abandonGame`) increment it instead. Leaving it in `releaseCourt` would double-count every game `finishGame` finishes (once from `finishGame`, once from the `releaseCourt` call `finishGame` makes automatically afterward).
2. **Widen the precondition** `if (court.status !== 'ASSIGNED') return failure('Court is not currently assigned.')` to `if (court.status !== 'ASSIGNED' && court.status !== 'PLAYING') return failure('Court is not currently assigned.')`. Once `startGame` (Step 3 below) transitions a court to `PLAYING`, `finishGame`'s automatic release call would otherwise fail this check on every single game.

After this fix, `releaseCourt`'s statements array should look like:

```typescript
const statements = sessionPlayerIds.flatMap((sessionPlayerId) => [
  buildCloseQueueEntryStatement(db, sessionId, sessionPlayerId),
  ...(requeued ? [buildJoinQueueStatement(db, { sessionId, sessionPlayerId })] : []),
])
```

(the `buildIncrementGamesPlayedStatement` line removed; the comment above it explaining "Runs on both rotation policies..." should be removed too since it no longer applies here — move that intent to Task 9's `finishGame` instead, where it becomes true again.)

- [ ] **Step 2: Add `buildMarkPlayingStatement` to `queueEntries.js`**

Directly beneath `buildMarkAssignedStatement`, following its exact shape (same guard, same placeholder pattern), transitioning `ASSIGNED` → `PLAYING` instead of `QUEUED` → `ASSIGNED`:

```javascript
/**
 * Unexecuted UPDATE flipping ASSIGNED entries to PLAYING, once a game
 * actually starts for the court those players were assigned to.
 */
export function buildMarkPlayingStatement(db, sessionId, sessionPlayerIds) {
  if (!sessionPlayerIds.length) return null
  const timestamp = nowIso()
  const placeholders = sessionPlayerIds.map(() => '?').join(', ')
  return db
    .prepare(
      `UPDATE queue_entries SET status = 'PLAYING', updated_at = ?
       WHERE session_id = ? AND session_player_id IN (${placeholders}) AND status = 'ASSIGNED'`,
    )
    .bind(timestamp, sessionId, ...sessionPlayerIds)
}
```

- [ ] **Step 3: Add `startGame` to `SessionCoordinatorDO`**

```typescript
import { buildCreateGameStatement } from '../repositories/pickleball/games.js'
import { buildMarkPlayingStatement } from '../repositories/pickleball/queueEntries.js'
import { buildAppendScoreEventStatement } from '../repositories/pickleball/scoreEvents.js'
```
(add to the existing import block at the top of the file, alongside the other repository imports already there)

```typescript
async startGame(sessionId: string, sessionCourtId: string) {
  if (!this.ownsSession(sessionId)) return failure('Coordinator/session mismatch.')

  const db = this.env.PICKLEBALL_DB

  const court = await getSessionCourt(db, sessionId, sessionCourtId)
  if (!court) return failure('Court not found.')
  if (court.status !== 'ASSIGNED') return failure('Court has no pending assignment to start a game for.')

  const session = await getSessionById(db, sessionId)
  const ruleset = await getScoringRuleset(db, session.scoringRulesetId, session.organizationId)
  if (!ruleset) return failure('Scoring ruleset not found.')

  const sessionPlayerIds = await listAssignedSessionPlayerIdsForCourt(db, sessionId, sessionCourtId)
  if (!sessionPlayerIds.length) return failure('No players are currently assigned to this court.')

  // The team bound to this court IS the assignment startGame is starting a
  // game for -- resolve both sides from it rather than re-deriving rosters,
  // so this can never disagree with what assignCourt actually seated.
  const anyAssignedPlayerId = sessionPlayerIds[0]
  const team = await getActiveTeamForSessionPlayer(db, sessionId, anyAssignedPlayerId)
  if (!team || team.sessionCourtId !== sessionCourtId) {
    return failure('Could not resolve the teams currently assigned to this court.')
  }

  // assignCourt always creates teamA then teamB for one court assignment;
  // find the sibling by court binding rather than assuming id ordering.
  const courtTeamsResult = await db
    .prepare(`SELECT id FROM teams WHERE session_court_id = ? AND session_id = ?`)
    .bind(sessionCourtId, sessionId)
    .all()
  const courtTeamIds: string[] = (courtTeamsResult.results || []).map((row: { id: string }) => row.id)
  if (courtTeamIds.length !== 2) {
    return failure(`Expected exactly 2 teams bound to this court, found ${courtTeamIds.length}.`)
  }
  const [teamAId, teamBId] = courtTeamIds

  const gameId = crypto.randomUUID()
  const timestamp = new Date().toISOString()
  const servingTeam: 'A' | 'B' = 'A'

  const gameStatement = buildCreateGameStatement(db, {
    id: gameId, sessionId, sessionCourtId, scoringRulesetId: ruleset.id, format: ruleset.format,
    teamAId, teamBId, servingTeam, timestamp,
  })

  const teamAMembers = await getTeamWithMembers(db, teamAId)
  const teamBMembers = await getTeamWithMembers(db, teamBId)
  const participantStatements = [
    ...(teamAMembers?.members ?? []).map((m) =>
      db.prepare(`INSERT INTO game_participants (id, game_id, session_player_id, team_id) VALUES (?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), gameId, m.sessionPlayerId, teamAId)),
    ...(teamBMembers?.members ?? []).map((m) =>
      db.prepare(`INSERT INTO game_participants (id, game_id, session_player_id, team_id) VALUES (?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), gameId, m.sessionPlayerId, teamBId)),
  ]

  const startedEvent = buildAppendScoreEventStatement(db, {
    gameId, sequence: 1, eventType: 'GAME_STARTED', actorUserId: 'system', payload: { servingTeam },
  })

  const statements = [
    gameStatement,
    ...participantStatements,
    startedEvent,
    buildMarkPlayingStatement(db, sessionId, sessionPlayerIds),
    buildSetCourtStatusStatement(db, sessionId, sessionCourtId, 'PLAYING'),
  ].filter(Boolean)

  await db.batch(statements)

  return { ok: true as const, game: await getGame(db, sessionId, gameId) }
}
```

`actorUserId: 'system'` for `GAME_STARTED` mirrors the fact that starting a game is a direct consequence of a prior `assignCourt`, not itself a new operator decision requiring attribution beyond what `assignCourt`'s own audit trail already carries. Every subsequent event (rally, finish, etc.) DOES carry the real acting user's id, passed in by the route.

- [ ] **Step 4: Add the new imports `getGame` and `getTeamWithMembers`**

`getGame` from `games.js` (already imported alias-free at top) and `getTeamWithMembers` — check whether `getTeamWithMembers` is already imported in `SessionCoordinatorDO.ts` (it is not, per the current file's import list) — add it to the existing `from '../repositories/pickleball/teams.js'` import line alongside `getActiveTeamForSessionPlayer` and `listAssignedSessionPlayerIdsForCourt`.

- [ ] **Step 5: Verify**

Run `npx tsc --noEmit -p tsconfig.json` — clean. Runtime verification (starting a game after a real `assignCourt`, confirming `game_participants` rows match the court's actual roster, confirming `queue_entries`/`session_courts` transition correctly) happens in Task 15's e2e suite — a Durable Object's RPC methods aren't independently testable without `wrangler dev`, matching Phase 3's established verification approach for this same file.

- [ ] **Step 6: Commit**

```bash
git add src/worker/pickleball/SessionCoordinatorDO.ts src/worker/repositories/pickleball/queueEntries.js
git commit -m "fix: move games_played increment to game-finish, add Pickleball startGame"
```

---

### Task 8: `SessionCoordinatorDO` — `recordRally` and `undoLastRally`

**Files:**
- Modify: `src/worker/pickleball/SessionCoordinatorDO.ts`

**Interfaces:**
- Consumes: `recordRally`, `classifyRallyOutcome` (Task 2), `getNextSequence`, `buildAppendScoreEventStatement`, `listScoreEventsForGame` (Task 5), `getIdempotentResult`, `buildRecordIdempotentResultStatement` (Task 5).
- Produces: `SessionCoordinatorDO.recordRally(sessionId, gameId, winningTeam, actorUserId, idempotencyKey?)`, `SessionCoordinatorDO.undoLastRally(sessionId, gameId, actorUserId)` — consumed by Task 13's `games/[gameId]/rally.ts` and `.../undo.ts` routes.

A private idempotency helper is added here and reused by every remaining command this phase adds (Tasks 9-10), so it is written once.

- [ ] **Step 1: Add a private idempotency helper**

```typescript
import { getIdempotentResult, buildRecordIdempotentResultStatement } from '../repositories/pickleball/idempotencyKeys.js'
```

Inside the `SessionCoordinatorDO` class, alongside `ownsSession`:

```typescript
// Every command that mutates a game accepts an optional client-generated
// idempotency key. If the same key is seen again (a duplicated/retried
// request, e.g. a scorekeeper double-tapping "Finish Game" on a flaky
// connection), the ORIGINAL result is returned unchanged instead of the
// command re-applying its effects a second time. The DO's own serialization
// makes this race-free: two "duplicate" requests can never both pass the
// `getIdempotentResult` check before either one's result is recorded.
private async withIdempotency<T>(gameId: string, idempotencyKey: string | undefined, run: () => Promise<T>): Promise<T> {
  const db = this.env.PICKLEBALL_DB
  if (idempotencyKey) {
    const cached = await getIdempotentResult(db, idempotencyKey)
    if (cached) return cached as T
  }
  const result = await run()
  if (idempotencyKey) {
    await buildRecordIdempotentResultStatement(db, { key: idempotencyKey, gameId, result }).run()
  }
  return result
}
```

- [ ] **Step 2: Add `recordRally`**

```typescript
import { recordRally, classifyRallyOutcome } from '../../lib/pickleball/scoring/recordRally'
import { getNextSequence, buildAppendScoreEventStatement } from '../repositories/pickleball/scoreEvents.js'
```

```typescript
async recordRally(sessionId: string, gameId: string, winningTeam: 'A' | 'B', actorUserId: string, idempotencyKey?: string) {
  if (!this.ownsSession(sessionId)) return failure('Coordinator/session mismatch.')

  return this.withIdempotency(gameId, idempotencyKey, async () => {
    const db = this.env.PICKLEBALL_DB

    const game = await getGame(db, sessionId, gameId)
    if (!game) return failure('Game not found.')
    if (game.status !== 'IN_PROGRESS') return failure('Game is not in progress.')

    const session = await getSessionById(db, sessionId)
    const ruleset = await getScoringRuleset(db, session.scoringRulesetId, session.organizationId)
    if (!ruleset) return failure('Scoring ruleset not found.')

    const before = { scoreA: game.scoreA, scoreB: game.scoreB, servingTeam: game.servingTeam, serverNumber: game.serverNumber }
    const after = recordRally(before, ruleset, winningTeam)
    const outcome = classifyRallyOutcome(before, after)

    const sequence = await getNextSequence(db, gameId)
    const eventStatement = buildAppendScoreEventStatement(db, {
      gameId, sequence, eventType: outcome, actorUserId, payload: { winningTeam },
    })
    const projectionStatement = buildUpdateGameProjectionStatement(db, gameId, {
      scoreA: after.scoreA, scoreB: after.scoreB, servingTeam: after.servingTeam, serverNumber: after.serverNumber,
      status: game.status, winningTeamId: game.winningTeamId, finalScoreA: game.finalScoreA, finalScoreB: game.finalScoreB,
      revision: sequence,
    })

    await db.batch([eventStatement, projectionStatement])

    return { ok: true as const, state: after, outcome, game: await getGame(db, sessionId, gameId) }
  })
}
```

- [ ] **Step 3: Add `undoLastRally`**

```typescript
async undoLastRally(sessionId: string, gameId: string, actorUserId: string) {
  if (!this.ownsSession(sessionId)) return failure('Coordinator/session mismatch.')

  const db = this.env.PICKLEBALL_DB

  const game = await getGame(db, sessionId, gameId)
  if (!game) return failure('Game not found.')
  if (game.status !== 'IN_PROGRESS') return failure('Game is not in progress.')

  const events = await listScoreEventsForGame(db, gameId)
  const alreadyReversed = new Set(events.filter((e) => e.eventType === 'POINT_REVERSED').map((e) => e.payload.reversedSequence))
  const scoringEvents = events.filter((e) => ['POINT_AWARDED', 'SERVE_CHANGED', 'SIDE_OUT'].includes(e.eventType) && !alreadyReversed.has(e.sequence))
  const lastRally = scoringEvents.at(-1)
  if (!lastRally) return failure('There is no rally to undo.')

  const session = await getSessionById(db, sessionId)
  const ruleset = await getScoringRuleset(db, session.scoringRulesetId, session.organizationId)
  if (!ruleset) return failure('Scoring ruleset not found.')

  // Recompute by replaying everything except the rally being undone -- this
  // is the same fold Task 3's replayEvents() performs over the whole log,
  // applied here to just the scoring events (GAME_STARTED gives the true
  // opening servingTeam, exactly as replayEvents.ts's own GAME_STARTED case
  // does), since the result is needed synchronously to write the projection.
  const startedEvent = events.find((e) => e.eventType === 'GAME_STARTED')!
  const remainingScoringEvents = scoringEvents.filter((e) => e.sequence !== lastRally.sequence)
  let state = { scoreA: 0, scoreB: 0, servingTeam: startedEvent.payload.servingTeam as 'A' | 'B', serverNumber: 2 as const }
  for (const event of remainingScoringEvents) {
    state = recordRally(state, ruleset, event.payload.winningTeam)
  }

  const nextSequence = await getNextSequence(db, gameId)
  const reversalEvent = buildAppendScoreEventStatement(db, {
    gameId, sequence: nextSequence, eventType: 'POINT_REVERSED', actorUserId, payload: { reversedSequence: lastRally.sequence },
  })
  const projectionStatement = buildUpdateGameProjectionStatement(db, gameId, {
    scoreA: state.scoreA, scoreB: state.scoreB, servingTeam: state.servingTeam, serverNumber: state.serverNumber,
    status: game.status, winningTeamId: game.winningTeamId, finalScoreA: game.finalScoreA, finalScoreB: game.finalScoreB,
    revision: nextSequence,
  })

  await db.batch([reversalEvent, projectionStatement])

  return { ok: true as const, state, game: await getGame(db, sessionId, gameId) }
}
```

`undoLastRally`'s in-loop state re-derivation has an awkward initial-state expression (reading `events[0].payload.servingTeam`) — **before implementing, simplify this**: the `GAME_STARTED` event is always `events[0]` (sequence 1) by construction, so replace that whole ternary with a direct read: `const startedEvent = events.find((e) => e.eventType === 'GAME_STARTED')!` and `let state = { scoreA: 0, scoreB: 0, servingTeam: startedEvent.payload.servingTeam, serverNumber: 2 as const }`. The plan's literal snippet above is intentionally left slightly rough here to force the implementer to read `replayEvents.ts` (Task 3) and notice the cleaner pattern already established there rather than copy this verbatim — use the cleaner form.

- [ ] **Step 4: Verify**

Run `npx tsc --noEmit -p tsconfig.json` — clean. Runtime verification in Task 15's e2e suite.

- [ ] **Step 5: Commit**

```bash
git add src/worker/pickleball/SessionCoordinatorDO.ts
git commit -m "feat: add Pickleball recordRally and undoLastRally commands"
```

---

### Task 9: `SessionCoordinatorDO` — `finishGame` and `abandonGame`

**Files:**
- Modify: `src/worker/pickleball/SessionCoordinatorDO.ts`

**Interfaces:**
- Consumes: `isValidFinalScore` (Task 2), `gamePerformance` (Task 4), `buildCreatePlayerGameStatStatement` (Task 5), `buildUpsertMatchmakingStatement` (Task 5), `buildIncrementGamesPlayedStatement` (existing, moved here from `releaseCourt`), `this.releaseCourt` (existing, called internally).
- Produces: `SessionCoordinatorDO.finishGame(sessionId, gameId, actorUserId, idempotencyKey?)`, `SessionCoordinatorDO.abandonGame(sessionId, gameId, actorUserId)` — consumed by Task 13's `games/[gameId]/finish.ts` and `.../abandon.ts` routes.

- [ ] **Step 1: Add `finishGame`**

```typescript
import { isValidFinalScore } from '../../lib/pickleball/scoring/display'
import { gamePerformance } from '../../lib/pickleball/opi'
import { buildCreatePlayerGameStatStatement } from '../repositories/pickleball/playerGameStats.js'
import { buildUpsertMatchmakingStatement } from '../repositories/pickleball/matchmakingHistory.js'
import { buildIncrementGamesPlayedStatement } from '../repositories/pickleball/sessionPlayers.js'
```

```typescript
async finishGame(sessionId: string, gameId: string, actorUserId: string, idempotencyKey?: string) {
  if (!this.ownsSession(sessionId)) return failure('Coordinator/session mismatch.')

  const outcome = await this.withIdempotency(gameId, idempotencyKey, async () => {
    const db = this.env.PICKLEBALL_DB

    const game = await getGame(db, sessionId, gameId)
    if (!game) return failure('Game not found.')
    if (game.status !== 'IN_PROGRESS') return failure('Game is not in progress.')

    const session = await getSessionById(db, sessionId)
    const ruleset = await getScoringRuleset(db, session.scoringRulesetId, session.organizationId)
    if (!ruleset) return failure('Scoring ruleset not found.')

    if (!isValidFinalScore(game.scoreA, game.scoreB, ruleset)) {
      return failure(`${game.scoreA}-${game.scoreB} is not a valid final score for this ruleset.`)
    }

    const winningTeamId = game.scoreA > game.scoreB ? game.teamAId : game.teamBId
    const sequence = await getNextSequence(db, gameId)

    const finishedEvent = buildAppendScoreEventStatement(db, {
      gameId, sequence, eventType: 'GAME_FINISHED', actorUserId,
      payload: { finalScoreA: game.scoreA, finalScoreB: game.scoreB, winningTeamId },
    })
    const projectionStatement = buildUpdateGameProjectionStatement(db, gameId, {
      scoreA: game.scoreA, scoreB: game.scoreB, servingTeam: game.servingTeam, serverNumber: game.serverNumber,
      status: 'FINISHED', winningTeamId, finalScoreA: game.scoreA, finalScoreB: game.scoreB, revision: sequence,
    })

    const participantsResult = await db
      .prepare(
        `SELECT gp.session_player_id, gp.team_id, sp.player_id
         FROM game_participants gp JOIN session_players sp ON sp.id = gp.session_player_id
         WHERE gp.game_id = ?`,
      )
      .bind(gameId)
      .all()
    const participants = (participantsResult.results || []) as { session_player_id: string; team_id: string; player_id: string }[]

    const timestamp = new Date().toISOString()
    const statStatements = participants.map((p) => {
      const isTeamA = p.team_id === game.teamAId
      const pointsFor = isTeamA ? game.scoreA : game.scoreB
      const pointsAgainst = isTeamA ? game.scoreB : game.scoreA
      return buildCreatePlayerGameStatStatement(db, {
        gameId, playerId: p.player_id, pointsFor, pointsAgainst,
        gamePerformance: gamePerformance(pointsFor, pointsAgainst),
        isWin: p.team_id === winningTeamId, eligibleForOpi: true,
      })
    })

    // Partners: every same-team pair. Opponents: every cross-team pair.
    // Written both directions per pair so a later repeat-avoidance lookup
    // never needs an OR clause on which column holds which player.
    const matchmakingStatements: unknown[] = []
    const teamAPlayers = participants.filter((p) => p.team_id === game.teamAId).map((p) => p.player_id)
    const teamBPlayers = participants.filter((p) => p.team_id === game.teamBId).map((p) => p.player_id)
    for (const [players, relation] of [[teamAPlayers, 'PARTNER'], [teamBPlayers, 'PARTNER']] as const) {
      for (let i = 0; i < players.length; i += 1) {
        for (let j = i + 1; j < players.length; j += 1) {
          matchmakingStatements.push(
            buildUpsertMatchmakingStatement(db, { sessionId, playerId: players[i], otherPlayerId: players[j], relation, timestamp }),
            buildUpsertMatchmakingStatement(db, { sessionId, playerId: players[j], otherPlayerId: players[i], relation, timestamp }),
          )
        }
      }
    }
    for (const playerA of teamAPlayers) {
      for (const playerB of teamBPlayers) {
        matchmakingStatements.push(
          buildUpsertMatchmakingStatement(db, { sessionId, playerId: playerA, otherPlayerId: playerB, relation: 'OPPONENT', timestamp }),
          buildUpsertMatchmakingStatement(db, { sessionId, playerId: playerB, otherPlayerId: playerA, relation: 'OPPONENT', timestamp }),
        )
      }
    }

    // games_played increments HERE, not in releaseCourt (see Task 7's fix) --
    // a finished game is the one unambiguous definition of "this player
    // played a game," and this is now the only place that increments it.
    const gamesPlayedStatements = participants.map((p) => buildIncrementGamesPlayedStatement(db, sessionId, p.session_player_id))

    await db.batch([finishedEvent, projectionStatement, ...statStatements, ...matchmakingStatements, ...gamesPlayedStatements])

    return { ok: true as const, game: await getGame(db, sessionId, gameId) }
  })

  if (!outcome.ok) return outcome

  // Automatic release: Phase 3's own plan text named this exact handoff
  // ("Phase 4 will call the same underlying method automatically"). This is
  // a second, separate DO-internal call, not merged into the batch above --
  // the DO processes one request at a time, so nothing can interleave
  // between them within this single finishGame invocation; if this second
  // call somehow fails, the game is correctly FINISHED and the court is
  // recoverable via a facilitator's own explicit release afterward.
  await this.releaseCourt(sessionId, outcome.game!.sessionCourtId)

  return outcome
}
```

- [ ] **Step 2: Add `abandonGame`**

```typescript
async abandonGame(sessionId: string, gameId: string, actorUserId: string) {
  if (!this.ownsSession(sessionId)) return failure('Coordinator/session mismatch.')

  const db = this.env.PICKLEBALL_DB

  const game = await getGame(db, sessionId, gameId)
  if (!game) return failure('Game not found.')
  if (game.status !== 'IN_PROGRESS') return failure('Game is not in progress.')

  const sequence = await getNextSequence(db, gameId)
  const abandonedEvent = buildAppendScoreEventStatement(db, { gameId, sequence, eventType: 'GAME_ABANDONED', actorUserId, payload: {} })
  const projectionStatement = buildUpdateGameProjectionStatement(db, gameId, {
    scoreA: game.scoreA, scoreB: game.scoreB, servingTeam: game.servingTeam, serverNumber: game.serverNumber,
    status: 'ABANDONED', winningTeamId: null, finalScoreA: null, finalScoreB: null, revision: sequence,
  })

  await db.batch([abandonedEvent, projectionStatement])

  // No player_game_stats, no matchmaking_history, no games_played increment
  // -- an abandoned game is explicitly excluded from OPI (edge case #18) and
  // was never actually completed, so none of finishGame's derived-data
  // writes apply. The court is still released -- the assignment is over
  // either way.
  await this.releaseCourt(sessionId, game.sessionCourtId)

  return { ok: true as const, game: await getGame(db, sessionId, gameId) }
}
```

- [ ] **Step 3: Verify**

Run `npx tsc --noEmit -p tsconfig.json` — clean. Runtime verification in Task 15's e2e suite: full happy path through `finishGame` (confirming `player_game_stats`, `matchmaking_history` both directions, `games_played` incremented exactly once, court released, queue entries closed/requeued per policy), plus an idempotency test (call `finishGame` twice with the same key, assert the stat-writing side effects happened only once), plus `abandonGame`'s court-released-but-no-stats path.

- [ ] **Step 4: Commit**

```bash
git add src/worker/pickleball/SessionCoordinatorDO.ts
git commit -m "feat: add Pickleball finishGame and abandonGame commands"
```

---

### Task 10: `SessionCoordinatorDO` — `reopenGame` and `correctGame`

**Files:**
- Modify: `src/worker/pickleball/SessionCoordinatorDO.ts`

**Interfaces:**
- Consumes: `buildDeletePlayerGameStatsForGameStatement` (Task 5).
- Produces: `SessionCoordinatorDO.reopenGame(sessionId, gameId, actorUserId)`, `SessionCoordinatorDO.correctGame(sessionId, gameId, actorUserId, correctedState: {scoreA, scoreB, servingTeam, serverNumber})` — consumed by Task 13's `games/[gameId]/reopen.ts` and `.../correct.ts` routes.

- [ ] **Step 1: Add `reopenGame`**

```typescript
import { buildDeletePlayerGameStatsForGameStatement } from '../repositories/pickleball/playerGameStats.js'
```

```typescript
async reopenGame(sessionId: string, gameId: string, actorUserId: string) {
  if (!this.ownsSession(sessionId)) return failure('Coordinator/session mismatch.')

  const db = this.env.PICKLEBALL_DB

  const game = await getGame(db, sessionId, gameId)
  if (!game) return failure('Game not found.')
  if (game.status !== 'FINISHED') return failure('Only a finished game can be reopened.')

  const sequence = await getNextSequence(db, gameId)
  const reopenedEvent = buildAppendScoreEventStatement(db, { gameId, sequence, eventType: 'GAME_REOPENED', actorUserId, payload: {} })
  const projectionStatement = buildUpdateGameProjectionStatement(db, gameId, {
    scoreA: game.scoreA, scoreB: game.scoreB, servingTeam: game.servingTeam, serverNumber: game.serverNumber,
    status: 'IN_PROGRESS', winningTeamId: null, finalScoreA: null, finalScoreB: null, revision: sequence,
  })
  // Ruling 3 / Phase 5 seam: this deletes the STALE finalized stats so a
  // subsequent re-finish can write fresh ones without ever having two rows
  // for the same (game_id, player_id) pair (the unique index would reject a
  // duplicate insert anyway, but deleting-then-recreating is the documented,
  // explicit "never apply corrected statistics on top of the old
  // statistics" behavior the spec requires, §7.3/§25).
  const invalidateStatement = buildDeletePlayerGameStatsForGameStatement(db, gameId)

  await db.batch([reopenedEvent, projectionStatement, invalidateStatement])

  return { ok: true as const, game: await getGame(db, sessionId, gameId) }
}
```

- [ ] **Step 2: Add `correctGame`**

```typescript
async correctGame(
  sessionId: string,
  gameId: string,
  actorUserId: string,
  correctedState: { scoreA: number; scoreB: number; servingTeam: 'A' | 'B'; serverNumber: 1 | 2 },
) {
  if (!this.ownsSession(sessionId)) return failure('Coordinator/session mismatch.')

  const db = this.env.PICKLEBALL_DB

  const game = await getGame(db, sessionId, gameId)
  if (!game) return failure('Game not found.')
  // Must be reopened first -- correcting a still-FINISHED game would silently
  // desync games.status from the fact that a correction just happened;
  // reopenGame's own GAME_REOPENED event is the explicit, auditable marker
  // that a correction is about to be made.
  if (game.status !== 'IN_PROGRESS') return failure('Reopen the game before correcting its score.')

  const sequence = await getNextSequence(db, gameId)
  const correctedEvent = buildAppendScoreEventStatement(db, { gameId, sequence, eventType: 'SCORE_CORRECTED', actorUserId, payload: correctedState })
  const projectionStatement = buildUpdateGameProjectionStatement(db, gameId, {
    scoreA: correctedState.scoreA, scoreB: correctedState.scoreB, servingTeam: correctedState.servingTeam, serverNumber: correctedState.serverNumber,
    status: 'IN_PROGRESS', winningTeamId: null, finalScoreA: null, finalScoreB: null, revision: sequence,
  })

  await db.batch([correctedEvent, projectionStatement])

  return { ok: true as const, game: await getGame(db, sessionId, gameId) }
}
```

- [ ] **Step 3: Verify**

Run `npx tsc --noEmit -p tsconfig.json` — clean. Runtime verification in Task 15's e2e suite: finish a game, reopen it (assert `player_game_stats` rows are gone), correct it to a different score, finish it again (assert new `player_game_stats` rows reflect the corrected outcome, not the original one).

- [ ] **Step 4: Commit**

```bash
git add src/worker/pickleball/SessionCoordinatorDO.ts
git commit -m "feat: add Pickleball reopenGame and correctGame commands"
```

---

### Task 11: Zod schemas

**Files:**
- Create: `src/lib/schemas/pickleball/games.ts`

**Interfaces:**
- Produces: `startGameSchema`, `rallySchema`, `finishGameSchema`, `abandonGameSchema`, `reopenGameSchema`, `correctGameSchema`, `grantOperatorSchema`, `revokeOperatorSchema` — consumed by Task 13's routes.

- [ ] **Step 1: Implement**

```typescript
import { z } from 'zod'

export const startGameSchema = z.object({
  sessionCourtId: z.string().uuid(),
})

const idempotencyKeySchema = z.string().min(1).max(100).optional()

export const rallySchema = z.object({
  winningTeam: z.enum(['A', 'B']),
  idempotencyKey: idempotencyKeySchema,
})

export const finishGameSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
})

export const abandonGameSchema = z.object({}).strict()

export const reopenGameSchema = z.object({}).strict()

export const correctGameSchema = z.object({
  scoreA: z.number().int().min(0),
  scoreB: z.number().int().min(0),
  servingTeam: z.enum(['A', 'B']),
  serverNumber: z.union([z.literal(1), z.literal(2)]),
})

export const grantOperatorSchema = z.object({
  userId: z.string().uuid(),
})

export const revokeOperatorSchema = z.object({
  userId: z.string().uuid(),
})
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/schemas/pickleball/games.ts
git commit -m "feat: add Pickleball game and operator-grant Zod schemas"
```

---

### Task 12: `session_operator_grants` routes

**Files:**
- Create: `src/pages/api/pickleball/sessions/[id]/operators/grant.ts`
- Create: `src/pages/api/pickleball/sessions/[id]/operators/revoke.ts`

**Interfaces:**
- Consumes: `grantSessionOperator`, `revokeSessionOperator` (Task 5), `grantOperatorSchema`, `revokeOperatorSchema` (Task 11), `getMembership` (existing, from `src/worker/repositories/pickleball/memberships.js` — read this file first to confirm its exact export name/signature before using it).
- Produces: the grant/revoke API surface — consumed by Task 15's e2e tests, and by whatever future UI manages session-scoped SCOREKEEPER access.

- [ ] **Step 1: `operators/grant.ts`**

```typescript
import type { APIRoute } from 'astro'
import { requirePickleballSession } from '../../../../../../worker/pickleball/authContext.js'
import { can } from '../../../../../../lib/pickleball/permissions'
import { getSession } from '../../../../../../worker/repositories/pickleball/sessions.js'
import { getMembership } from '../../../../../../worker/repositories/pickleball/memberships.js'
import { grantSessionOperator } from '../../../../../../worker/repositories/pickleball/sessionOperatorGrants.js'
import { grantOperatorSchema } from '../../../../../../lib/schemas/pickleball/games'
import { jsonResponse } from '../../../../../../worker/utils/responses.js'
import { getEnv } from '../../../../../../lib/env'

export const POST: APIRoute = async ({ request, params }) => {
  const env = getEnv()
  try {
    const session = await requirePickleballSession(request, env)
    const body = await request.json().catch(() => null)

    const sessionId = params.id as string
    const pickleballSession = await getSession(env.PICKLEBALL_DB, sessionId, session.activeOrgId)
    if (!pickleballSession) return jsonResponse({ error: 'Not found.' }, 404)

    if (!can(session.role, 'MANAGE_SESSIONS')) {
      return jsonResponse({ error: 'Forbidden.' }, 403)
    }

    const result = grantOperatorSchema.safeParse(body)
    if (!result.success) {
      return jsonResponse({ error: 'Validation failed.', issues: result.error.issues }, 400)
    }

    // Ownership check: the target user must actually hold an active
    // membership in THIS organization before being granted session access --
    // otherwise a caller could grant scoring access to an arbitrary userId
    // that has nothing to do with this org.
    const targetMembership = await getMembership(env.PICKLEBALL_DB, {
      organizationId: session.activeOrgId, userId: result.data.userId,
    })
    if (!targetMembership) {
      return jsonResponse({ error: 'That user has no active membership in this organization.' }, 400)
    }

    await grantSessionOperator(env.PICKLEBALL_DB, {
      sessionId, userId: result.data.userId, grantedByUserId: session.userId,
    })

    return jsonResponse({ ok: true }, 200)
  } catch (error: any) {
    return jsonResponse({ error: error.message }, error.status || 500)
  }
}
```

- [ ] **Step 2: `operators/revoke.ts`**

```typescript
import type { APIRoute } from 'astro'
import { requirePickleballSession } from '../../../../../../worker/pickleball/authContext.js'
import { can } from '../../../../../../lib/pickleball/permissions'
import { getSession } from '../../../../../../worker/repositories/pickleball/sessions.js'
import { revokeSessionOperator } from '../../../../../../worker/repositories/pickleball/sessionOperatorGrants.js'
import { revokeOperatorSchema } from '../../../../../../lib/schemas/pickleball/games'
import { jsonResponse } from '../../../../../../worker/utils/responses.js'
import { getEnv } from '../../../../../../lib/env'

export const POST: APIRoute = async ({ request, params }) => {
  const env = getEnv()
  try {
    const session = await requirePickleballSession(request, env)
    const body = await request.json().catch(() => null)

    const sessionId = params.id as string
    const pickleballSession = await getSession(env.PICKLEBALL_DB, sessionId, session.activeOrgId)
    if (!pickleballSession) return jsonResponse({ error: 'Not found.' }, 404)

    if (!can(session.role, 'MANAGE_SESSIONS')) {
      return jsonResponse({ error: 'Forbidden.' }, 403)
    }

    const result = revokeOperatorSchema.safeParse(body)
    if (!result.success) {
      return jsonResponse({ error: 'Validation failed.', issues: result.error.issues }, 400)
    }

    await revokeSessionOperator(env.PICKLEBALL_DB, sessionId, result.data.userId)

    return jsonResponse({ ok: true }, 200)
  } catch (error: any) {
    return jsonResponse({ error: error.message }, error.status || 500)
  }
}
```

- [ ] **Step 3: Verify import depth**

Run `npx tsc --noEmit -p tsconfig.json` — clean; confirms the 6-`../` depth for `operators/*.ts` (same depth as Phase 3's `queue`/`courts` routes).

- [ ] **Step 4: Commit**

```bash
git add src/pages/api/pickleball/sessions/[id]/operators
git commit -m "feat: add Pickleball session-operator grant and revoke API"
```

---

### Task 13: Game API routes

**Files:**
- Create: `src/pages/api/pickleball/sessions/[id]/games/index.ts`
- Create: `src/pages/api/pickleball/sessions/[id]/games/start.ts`
- Create: `src/pages/api/pickleball/sessions/[id]/games/[gameId]/rally.ts`
- Create: `src/pages/api/pickleball/sessions/[id]/games/[gameId]/undo.ts`
- Create: `src/pages/api/pickleball/sessions/[id]/games/[gameId]/finish.ts`
- Create: `src/pages/api/pickleball/sessions/[id]/games/[gameId]/abandon.ts`
- Create: `src/pages/api/pickleball/sessions/[id]/games/[gameId]/reopen.ts`
- Create: `src/pages/api/pickleball/sessions/[id]/games/[gameId]/correct.ts`

**Interfaces:**
- Consumes: `hasSessionOperatorGrant` (Task 5), every `SessionCoordinatorDO` method from Tasks 7-10, every schema from Task 11, `getGame` (Task 5, for the game-scoped routes' own ownership check before invoking the DO — a `gameId` in the URL must be confirmed to belong to `params.id`'s session before being forwarded to the DO).
- Produces: the full Phase 4 command surface.

Every game-scoped route (`rally`/`undo`/`finish`/`abandon`/`reopen`/`correct`) shares the same shape: auth → drain body → `getSession` 404 → permission check (+ SCOREKEEPER grant check where the permission is `SCORE_GAME`/`FINISH_GAME`/`UNDO_SCORE_EVENT`) → Zod validate → `getGame(db, sessionId, gameId)` 404 (the `gameId` ownership check — a game from another session must never reach the DO) → invoke the DO → map `{ok:false}` to 409.

- [ ] **Step 1: `games/index.ts`**

```typescript
import type { APIRoute } from 'astro'
import { requirePickleballSession } from '../../../../../../worker/pickleball/authContext.js'
import { getSession } from '../../../../../../worker/repositories/pickleball/sessions.js'
import { listGamesForSession } from '../../../../../../worker/repositories/pickleball/games.js'
import { jsonResponse } from '../../../../../../worker/utils/responses.js'
import { getEnv } from '../../../../../../lib/env'

export const GET: APIRoute = async ({ request, params }) => {
  const env = getEnv()
  try {
    const session = await requirePickleballSession(request, env)
    const pickleballSession = await getSession(env.PICKLEBALL_DB, params.id, session.activeOrgId)
    if (!pickleballSession) return jsonResponse({ error: 'Not found.' }, 404)

    const games = await listGamesForSession(env.PICKLEBALL_DB, params.id)
    return jsonResponse({ games }, 200)
  } catch (error: any) {
    return jsonResponse({ error: error.message }, error.status || 500)
  }
}
```

- [ ] **Step 2: `games/start.ts`**

```typescript
import type { APIRoute } from 'astro'
import { requirePickleballSession } from '../../../../../../worker/pickleball/authContext.js'
import { can } from '../../../../../../lib/pickleball/permissions'
import { getSession } from '../../../../../../worker/repositories/pickleball/sessions.js'
import { hasSessionOperatorGrant } from '../../../../../../worker/repositories/pickleball/sessionOperatorGrants.js'
import { startGameSchema } from '../../../../../../lib/schemas/pickleball/games'
import { jsonResponse } from '../../../../../../worker/utils/responses.js'
import { getEnv } from '../../../../../../lib/env'

export const POST: APIRoute = async ({ request, params }) => {
  const env = getEnv()
  try {
    const session = await requirePickleballSession(request, env)
    const body = await request.json().catch(() => null)

    const sessionId = params.id as string
    const pickleballSession = await getSession(env.PICKLEBALL_DB, sessionId, session.activeOrgId)
    if (!pickleballSession) return jsonResponse({ error: 'Not found.' }, 404)

    if (!can(session.role, 'SCORE_GAME')) return jsonResponse({ error: 'Forbidden.' }, 403)
    if (session.role === 'SCOREKEEPER' && !(await hasSessionOperatorGrant(env.PICKLEBALL_DB, sessionId, session.userId))) {
      return jsonResponse({ error: 'Forbidden.' }, 403)
    }

    const result = startGameSchema.safeParse(body)
    if (!result.success) return jsonResponse({ error: 'Validation failed.', issues: result.error.issues }, 400)

    const stub = env.SESSION_COORDINATOR.get(env.SESSION_COORDINATOR.idFromName(sessionId))
    const outcome = await stub.startGame(sessionId, result.data.sessionCourtId)

    if (!outcome.ok) return jsonResponse({ error: outcome.error }, 409)
    return jsonResponse(outcome, 201)
  } catch (error: any) {
    return jsonResponse({ error: error.message }, error.status || 500)
  }
}
```

- [ ] **Step 3: `games/[gameId]/rally.ts`**

```typescript
import type { APIRoute } from 'astro'
import { requirePickleballSession } from '../../../../../../../worker/pickleball/authContext.js'
import { can } from '../../../../../../../lib/pickleball/permissions'
import { getSession } from '../../../../../../../worker/repositories/pickleball/sessions.js'
import { getGame } from '../../../../../../../worker/repositories/pickleball/games.js'
import { hasSessionOperatorGrant } from '../../../../../../../worker/repositories/pickleball/sessionOperatorGrants.js'
import { rallySchema } from '../../../../../../../lib/schemas/pickleball/games'
import { jsonResponse } from '../../../../../../../worker/utils/responses.js'
import { getEnv } from '../../../../../../../lib/env'

export const POST: APIRoute = async ({ request, params }) => {
  const env = getEnv()
  try {
    const session = await requirePickleballSession(request, env)
    const body = await request.json().catch(() => null)

    const sessionId = params.id as string
    const pickleballSession = await getSession(env.PICKLEBALL_DB, sessionId, session.activeOrgId)
    if (!pickleballSession) return jsonResponse({ error: 'Not found.' }, 404)

    if (!can(session.role, 'SCORE_GAME')) return jsonResponse({ error: 'Forbidden.' }, 403)
    if (session.role === 'SCOREKEEPER' && !(await hasSessionOperatorGrant(env.PICKLEBALL_DB, sessionId, session.userId))) {
      return jsonResponse({ error: 'Forbidden.' }, 403)
    }

    const result = rallySchema.safeParse(body)
    if (!result.success) return jsonResponse({ error: 'Validation failed.', issues: result.error.issues }, 400)

    const gameId = params.gameId as string
    const game = await getGame(env.PICKLEBALL_DB, sessionId, gameId)
    if (!game) return jsonResponse({ error: 'Game not found in this session.' }, 404)

    const stub = env.SESSION_COORDINATOR.get(env.SESSION_COORDINATOR.idFromName(sessionId))
    const outcome = await stub.recordRally(sessionId, gameId, result.data.winningTeam, session.userId, result.data.idempotencyKey)

    if (!outcome.ok) return jsonResponse({ error: outcome.error }, 409)
    return jsonResponse(outcome, 200)
  } catch (error: any) {
    return jsonResponse({ error: error.message }, error.status || 500)
  }
}
```

- [ ] **Step 4: `games/[gameId]/undo.ts`**

Same shape as `rally.ts`, with these differences: permission is `UNDO_SCORE_EVENT`, body schema is not needed (undo takes no fields — drain the body anyway for the crash-avoidance reason, but don't Zod-parse it since there's nothing to validate), and it calls `stub.undoLastRally(sessionId, gameId, session.userId)`.

```typescript
import type { APIRoute } from 'astro'
import { requirePickleballSession } from '../../../../../../../worker/pickleball/authContext.js'
import { can } from '../../../../../../../lib/pickleball/permissions'
import { getSession } from '../../../../../../../worker/repositories/pickleball/sessions.js'
import { getGame } from '../../../../../../../worker/repositories/pickleball/games.js'
import { hasSessionOperatorGrant } from '../../../../../../../worker/repositories/pickleball/sessionOperatorGrants.js'
import { jsonResponse } from '../../../../../../../worker/utils/responses.js'
import { getEnv } from '../../../../../../../lib/env'

export const POST: APIRoute = async ({ request, params }) => {
  const env = getEnv()
  try {
    const session = await requirePickleballSession(request, env)
    await request.json().catch(() => null)

    const sessionId = params.id as string
    const pickleballSession = await getSession(env.PICKLEBALL_DB, sessionId, session.activeOrgId)
    if (!pickleballSession) return jsonResponse({ error: 'Not found.' }, 404)

    if (!can(session.role, 'UNDO_SCORE_EVENT')) return jsonResponse({ error: 'Forbidden.' }, 403)
    if (session.role === 'SCOREKEEPER' && !(await hasSessionOperatorGrant(env.PICKLEBALL_DB, sessionId, session.userId))) {
      return jsonResponse({ error: 'Forbidden.' }, 403)
    }

    const gameId = params.gameId as string
    const game = await getGame(env.PICKLEBALL_DB, sessionId, gameId)
    if (!game) return jsonResponse({ error: 'Game not found in this session.' }, 404)

    const stub = env.SESSION_COORDINATOR.get(env.SESSION_COORDINATOR.idFromName(sessionId))
    const outcome = await stub.undoLastRally(sessionId, gameId, session.userId)

    if (!outcome.ok) return jsonResponse({ error: outcome.error }, 409)
    return jsonResponse(outcome, 200)
  } catch (error: any) {
    return jsonResponse({ error: error.message }, error.status || 500)
  }
}
```

- [ ] **Step 5: `games/[gameId]/finish.ts`**

Same shape as `rally.ts`: permission `FINISH_GAME`, `finishGameSchema`, calls `stub.finishGame(sessionId, gameId, session.userId, result.data.idempotencyKey)`.

- [ ] **Step 6: `games/[gameId]/abandon.ts`**

Same shape as `undo.ts` (no meaningful body): permission `FINISH_GAME` (this plan's ruling — abandoning is a way of ending a game, the same tier as finishing), calls `stub.abandonGame(sessionId, gameId, session.userId)`.

- [ ] **Step 7: `games/[gameId]/reopen.ts`**

Same shape as `undo.ts` (no meaningful body): permission `REOPEN_GAME` (ADMIN/FACILITATOR only — no SCOREKEEPER grant branch needed at all, since SCOREKEEPER never holds this permission), calls `stub.reopenGame(sessionId, gameId, session.userId)`.

- [ ] **Step 8: `games/[gameId]/correct.ts`**

Same shape as `rally.ts`: permission `CORRECT_GAME` (ADMIN/FACILITATOR only, no grant branch), `correctGameSchema`, calls `stub.correctGame(sessionId, gameId, session.userId, { scoreA: result.data.scoreA, scoreB: result.data.scoreB, servingTeam: result.data.servingTeam, serverNumber: result.data.serverNumber })`.

- [ ] **Step 9: Verify**

Run `npx tsc --noEmit -p tsconfig.json` — clean, confirming both the 6-level and 7-level import depths.

- [ ] **Step 10: Commit**

```bash
git add src/pages/api/pickleball/sessions/[id]/games
git commit -m "feat: add Pickleball game lifecycle and scoring API"
```

---

### Task 14: Session-scoping self-audit

**Files:** none created — verification-only task, mirroring Phase 3's Task 8 given this plan's own Global Constraint about client-supplied foreign keys.

- [ ] **Step 1: Audit every route from Task 12-13**

For each of the 10 route files (2 operator + 8 game routes), confirm: every client-supplied FK (`userId` in grant/revoke, `gameId` in the URL for the 6 game-scoped routes, `sessionCourtId` in `start.ts`) is checked against the target session/organization before being passed to a repository function or the DO. List each file with a file:line reference, or fix it if missing.

Also confirm: `SessionCoordinatorDO.startGame`'s own internal court/team resolution (Task 7) never trusts a `sessionCourtId` beyond what `getSessionCourt(db, sessionId, sessionCourtId)` already scopes, and `correctGame`'s numeric inputs (`scoreA`/`scoreB`) can't produce a nonsensical state that later breaks `isValidFinalScore`/`officialScoreCall` (Zod's `.int().min(0)` already prevents negative/non-integer values — confirm this is actually suf ficient, or note what additional guard the DO itself should add, e.g. rejecting a `correctGame` state so extreme it couldn't possibly have arisen from real play, if the reviewer judges that a real gap rather than an accepted operator-trust boundary).

- [ ] **Step 2: Fix anything found, or report that everything already passed**

If everything already checks out, this task's diff is empty — say so plainly and skip the commit. If something was missing, fix it and commit:

```bash
git add -A
git commit -m "fix: close missed session-scoping gaps in Pickleball game routes"
```

---

### Task 15: Playwright e2e coverage

**Files:**
- Create: `tests/e2e/pickleball/pickleball-games.spec.js`

**Interfaces:**
- Consumes: every route from Tasks 12-13, reusing the `pickleball-queue.spec.js` helpers' pattern for bringing a session to `LIVE` with an assigned court (Phase 3.1 already made this a real, direct API path — no direct D1 writes needed for that part).

- [ ] **Step 1: Write the spec**

Read `tests/e2e/pickleball/pickleball-queue.spec.js` in full first and reuse its `createSessionWithCheckedInPlayers`-style setup pattern (venue → courts → session → `OPEN_FOR_CHECKIN` → `LIVE` → register/check-in/queue players → `assignCourt`) rather than duplicating it uninspected — extract a shared setup helper into a new small module if the two spec files would otherwise duplicate more than a few lines, following this repo's existing judgment calls about when duplication across sibling spec files is acceptable (Task 9's own report treated a smaller helper duplication as acceptable style; use your judgment on where this one crosses the line given it is now duplicated across two files).

At minimum, cover:
- **Happy path**: assign a court → `POST .../games/start` → confirm `game.status === 'IN_PROGRESS'`, `scoreA/scoreB === 0`, `servingTeam`/`serverNumber` match the opening `0-0-2` state → record enough rallies to reach a valid final score (mix of same-team wins and side-outs to exercise all three `recordRally` branches at least once) → `POST .../finish` → confirm `game.status === 'FINISHED'`, `winningTeamId` correct, and (via direct D1 read, since there is no `GET player_game_stats` route in this plan's scope) that 4 `player_game_stats` rows exist with the right `points_for`/`points_against`/`is_win`/`eligible_for_opi`, that `matchmaking_history` has rows for both partner pairs and all opponent pairs, and that each participant's `session_players.games_played` incremented by exactly 1 (not 2 — the regression this plan's Task 7 fix exists to prevent) → confirm the court auto-released to `AVAILABLE` and the 4 players' `queue_entries` reflect the session's rotation policy.
- **Undo**: record a rally, undo it, confirm the score/serve state reverts to before that rally, confirm a second undo with nothing left to undo returns 409.
- **Idempotency**: call `finish` twice with the same `idempotencyKey`; assert `player_game_stats` and `games_played` reflect the finalization exactly once, not twice, and both calls return the identical result.
- **CONCURRENCY**: fire two simultaneous `POST .../rally` calls for the SAME game via `Promise.all`, asserting the final score reflects both rallies applied in some serialized order (never a lost update where only one took effect) — this is the DO's serialization guarantee, real proof for this phase the same way Phase 3's concurrency test proved it for court assignment.
- **Reopen/correct**: finish a game, reopen it (confirm `player_game_stats` rows are gone), correct it to a different valid final score, finish it again, confirm the new `player_game_stats` rows reflect the corrected outcome and there is exactly one row per participant (not two).
- **Abandon**: start a game, abandon it, confirm `status === 'ABANDONED'`, court released, and zero `player_game_stats`/`matchmaking_history` rows were written for that game.
- **RBAC**: a SCOREKEEPER without a session grant gets 403 on `start`/`rally`/`finish`; after being granted via `POST .../operators/grant`, the same SCOREKEEPER succeeds; a SCOREKEEPER (granted or not) gets 403 on `reopen`/`correct` (permissions they never hold at all).
- **IDOR**: a `gameId` belonging to a different session returns 404 from any of the 6 game-scoped routes when addressed through the wrong session's URL.

- [ ] **Step 2: Run the suite**

```bash
npx astro build
npx playwright test --project=worker tests/e2e/pickleball/pickleball-games.spec.js
```
Expected: all tests pass, including the concurrency test — if it's flaky, that's a real signal about `recordRally`'s DO-level atomicity, not a test to retry past. Also re-run `tests/e2e/pickleball/pickleball-queue.spec.js` to confirm Task 7's `releaseCourt` change didn't regress Phase 3's own suite. **Before finishing, verify no stray `wrangler`/`workerd`/`esbuild` process remains.**

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/pickleball/pickleball-games.spec.js
git commit -m "test: add Pickleball game engine e2e coverage, including concurrency and idempotency"
```

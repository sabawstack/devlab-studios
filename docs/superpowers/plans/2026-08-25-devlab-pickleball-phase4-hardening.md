# Devlab Pickleball — Phase 4 Hardening Pass Implementation Plan

> **Superseded (2026-10-12).** This describes the logged-in operator app, retired in 2.0.0 by Phase 5 of `docs/superpowers/specs/2026-10-11-pickleball-free-open-play-design.md`. Kept as history: the routes, tables and files it names no longer exist.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close ~10 confirmed correctness/design gaps in the in-flight Phase 4 (Game Engine) implementation — serving-player identity, singles initialization, terminal-score enforcement, legally-reachable final-score validation, undo/replay duplication, command-scoped and crash-atomic idempotency, atomic finish+release, and a correction-only lifecycle that never reclaims a released court — before Tasks 9-15 of the original Phase 4 plan are built on top of them.

**Architecture:** This plan supersedes Tasks 9-15 of `docs/superpowers/plans/2026-08-25-devlab-pickleball-phase4-game-engine.md` entirely (finishGame/abandonGame/reopenGame/correctGame, the games API routes, and the e2e suite were never built — this plan builds them correctly from the start instead of retrofitting them) and amends two already-shipped pieces: Task 7's `startGame` (currently hardcodes `servingTeam: 'A'`) and Task 8's `recordRally`/`undoLastRally` (no terminal-score guard; `undoLastRally` duplicates replay logic instead of reusing `replayEvents`, and does not account for a `SCORE_CORRECTED` event appearing between the undone rally and the game's start). Tasks 1-6 of the original plan (migration 0007, the pure scoring/replay/OPI engines, the repositories, `gameProjection.ts`) are untouched and remain correct as built — this plan's own migration is additive (0008) and its own new pure functions live alongside, not instead of, Tasks 2-4's files.

**Tech Stack:** Same as the base Phase 4 plan — Astro API routes, D1, `SessionCoordinatorDO`, Zod, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-24-devlab-pickleball-design.md` plus the hardening directive that authorized this plan (§7.1 rally-driven scoring, §7.3 undo/correction, §59 rebuildable derived data, edge cases #18-22).

**Scope boundary:** Still no UI (per the base plan's Ruling 6 — unchanged). Still no Phase 5 (`player_performance_snapshots`, `opi()` aggregation, confidence tiers, leaderboards, pair stats) — `gamePerformance` stays the only OPI-related function that exists. `matchmaking_history`'s read side (queue repeat-avoidance) is still not wired — this plan adds a tracked follow-up note rather than building it (see Ruling 10). The scorekeeper-serving-player derivation this plan adds is a domain/API capability only — no UI consumes it yet, but every field a future scorekeeper screen needs (current server's `session_player_id`, official score call, contextual banner) is now genuinely derivable from stable data.

## Global Constraints (carried forward + new)

- Every DO method calls `this.ownsSession(sessionId)` first, exactly like every existing method.
- Every multi-statement write goes through one `db.batch([...])` — this plan tightens that requirement further: **idempotency recording must be IN THE SAME batch as the mutation it records** (Ruling 8), and **finishGame/abandonGame's court release must be IN THE SAME batch as the game-finish/abandon writes** (Ruling 7) — both are correctness fixes to gaps the original Task 8/9 design would otherwise have shipped with.
- **Never edit migration 0001-0007.** This plan's schema changes are `migrations/pickleball/0008_phase4_hardening.sql`, additive except for one documented, data-preserving table rebuild (idempotency_keys' primary key, justified in Task 1).
- New routes drain the request body before any early return, per the established Phase 3.1 convention.
- Client-supplied `sessionPlayerId`s used as starting-server identity must be validated against the actual team roster before being trusted — the same ownership discipline every prior phase has followed for client-supplied FKs.
- Pure logic (scoring, server-rotation derivation, terminal-score checks) never calls `Date.now()`/`new Date()`.
- D1 `--local` only. `wrangler dev` process hygiene as established.

## Rulings

- **Ruling 1 — serving-player identity is tracked explicitly, not purely derived from score.** Real doubles server rotation (which of a team's two players currently holds "server 1") depends on how many times that team has *previously regained* the serve, not on the instantaneous score — information a stateless function cannot reconstruct from `GameState` alone without replaying the whole log. This plan tracks it as explicit, persisted, event-driven state (`teamACurrentServerSessionPlayerId`/`teamBCurrentServerSessionPlayerId`, updated by the same rally-outcome classification `recordRally` already computes), with a genuinely pure, stateless `deriveServingPlayer(state, identity)` lookup on top — satisfying the letter of "a pure helper for derivation" while keeping the correctness-critical memory explicit and auditable. **This models the standard USA Pickleball doubles rotation rule (a team's own two players swap which one serves first each time that specific team regains the serve, not on every rally) as best understood — flagged explicitly in the final report for domain-expert confirmation, since getting real sport rules exactly right from a written description carries residual risk.**
- **Ruling 2 — `games.status`'s CHECK constraint is not widened.** A new `CORRECTION_PENDING` status value would need a full table rebuild of `games` (SQLite can't ALTER a CHECK constraint in place), which is materially riskier than necessary here. Per the hardening directive's own fallback guidance, this plan uses a boolean flag column (`correction_pending`) instead — `games.status` stays `IN_PROGRESS` during a correction (unchanged existing semantics for every reader of that column), and `correction_pending = 1` is the signal that blocks ordinary `recordRally` while still allowing `correctGame`/re-`finishGame`. Same invariant, lower migration risk.
- **Ruling 3 — the terminal-score guard lives in the DO command handler, not inside the pure `recordRally` function.** Task 2's `recordRally.ts` (already reviewed clean, already depended on by `replayEvents.ts`) stays a total, non-throwing function — changing its contract to a partial/throwing one would ripple into replay, which must faithfully reconstruct history even from a hypothetically-already-terminal state without erroring. Instead, a new pure `hasGameBeenWon(state, ruleset)` function is added (alongside `isValidFinalScore`, reusing it), and the DO's `recordRally` command checks it *before* calling the pure `recordRally` — rejecting with a clear domain error. `replayEvents` and the pure engine are untouched.
- **Ruling 4 — `isValidFinalScore` is rewritten to the "legally reachable final score" rule**, exactly as specified: `winner === targetScore → loser <= targetScore - winBy`; `winner > targetScore → winner - loser === winBy`. This is a **behavior change** to an already-shipped, already-tested function (Task 2) — `12-9` (game to 11, win by 2) now correctly returns `false` where the old simple rule returned `true`. `isGamePoint` and `contextualState` are unchanged (they already call `isValidFinalScore` and inherit the fix automatically) but their existing tests must be re-verified against the new rule.
- **Ruling 5 — `undoLastRally` is rewritten to call the canonical `replayEvents` (Task 3) instead of its own duplicated fold.** This fixes a real, confirmed gap in the original Task 8 brief: the shipped `undoLastRally` re-derives state by folding only scoring events from `GAME_STARTED`, silently ignoring any `SCORE_CORRECTED` event in between — so undoing a rally recorded after a correction would incorrectly discard the correction too. `replayEvents` already handles `SCORE_CORRECTED` correctly; `undoLastRally` now constructs the hypothetical event list (existing events + a new `POINT_REVERSED` referencing the rally being undone) and calls `replayEvents` on it directly, the same function `gameProjection.ts` already trusts.
- **Ruling 6 — idempotency keys become `(game_id, command_type, key)`-scoped**, requiring a table rebuild of `idempotency_keys` (its current `key TEXT PRIMARY KEY` is a real, already-shipped correctness gap: `key` alone must currently be unique across every game and every command in the whole database). The rebuild preserves existing rows (a `command_type = 'UNKNOWN'` backfill for anything already present — in practice nothing, since no command has used this table yet in production or dev).
- **Ruling 7 — `finishGame` and `abandonGame` release the court in the SAME `db.batch()` as everything else**, not via a second sequential DO-internal call (the original Task 9 design, never actually built). This closes a real inconsistency window the hardening review correctly flagged. `releaseCourt`'s existing statement-building logic is extracted into `build*Statement` helpers so both `releaseCourt` (still independently callable by a facilitator) and `finishGame`/`abandonGame` can compose them into their own batches.
- **Ruling 8 — idempotency recording joins the same batch as the mutation it records**, closing the crash window where a mutation commits but a separate, later idempotency-record write never happens (making a retried request re-apply the mutation). Each command computes its full result in memory, builds every statement (mutation + idempotency record) as one array, and calls `db.batch()` once. The generic `withIdempotency` wrapper Task 8 added is removed — it structurally cannot satisfy this atomicity requirement (it calls the command, then separately persists afterward) — replaced by a plain `getIdempotentResult` read at the top of each command and an inline `buildRecordIdempotentResultStatement` call folded into that command's own batch.
- **Ruling 9 — idempotency never caches a domain-validation failure.** Only a result from a batch that actually committed a mutation is recorded. A `finishGame` call that fails `isValidFinalScore` (e.g. `10-10`) returns its error WITHOUT writing an idempotency row — a retry with the same key after the score legitimately changes (e.g. to `12-10`) is not poisoned by the earlier failure.
- **Ruling 10 — the matchmaking-history read-side gap gets a tracked, non-orphaned follow-up note.** This plan does not wire `matchmaking_history` into `queueEngine.ts`'s repeat-avoidance tiebreak (still out of scope, per the base plan's Ruling 4) — but Task 9 of this plan adds an explicit `// TODO(Phase 5 or 7):` marker at the exact function this belongs in, so it's a locatable, named gap rather than a requirement mentioned only in prose that a future reader has to rediscover.
- **Ruling 11 — `games_played` and `matchmaking_history` are corrected by full recomputation, not incremental subtraction**, per the hardening directive's own stated preference. `games_played` recomputes as `COUNT(*)` of `FINISHED` games a session_player participated in (one SQL statement, no negative-count risk). `matchmaking_history` recomputes by deleting every row for the session and re-deriving from every currently-`FINISHED` game's participants, processed oldest-to-newest so `last_game_at` naturally ends up correct without any special-casing "was this the most recent game" logic.

---

## File Structure

```
migrations/pickleball/0008_phase4_hardening.sql                       new

src/lib/pickleball/scoring/serverRotation.ts                           new — nextServerIdentity, deriveServingPlayer
src/lib/pickleball/scoring/serverRotation.test.ts                       new
src/lib/pickleball/scoring/gameState.ts                                 modify — format-aware initialGameState
src/lib/pickleball/scoring/gameState.test.ts                             new (initialGameState had no direct test before)
src/lib/pickleball/scoring/display.ts                                   modify — isValidFinalScore rewrite, +hasGameBeenWon
src/lib/pickleball/scoring/display.test.ts                              modify — new terminal/reachable-final matrix

src/worker/repositories/pickleball/idempotencyKeys.js                   modify — command-scoped signature
src/worker/repositories/pickleball/games.js                             modify — +buildUpdateServerIdentityStatement, starting-server columns
src/worker/repositories/pickleball/sessionCourts.js                     modify — extract buildReleaseCourtStatements-adjacent pieces if needed (see Task 6)
src/worker/repositories/pickleball/sessionPlayers.js                    modify — +buildRecomputeGamesPlayedStatement
src/worker/repositories/pickleball/matchmakingHistory.js                modify — +recomputeMatchmakingHistoryStatements

src/lib/schemas/pickleball/games.ts                                     modify — startGameSchema gains serving-player fields; +finishGameSchema (exists)/correctGameSchema (exists, unchanged)

src/worker/pickleball/SessionCoordinatorDO.ts                           modify — startGame rewrite, recordRally terminal guard + identity tracking + idempotency rewrite, undoLastRally rewrite, +finishGame, +abandonGame, +reopenGame, +correctGame

src/pages/api/pickleball/sessions/[id]/games/[gameId]/finish.ts          new
src/pages/api/pickleball/sessions/[id]/games/[gameId]/abandon.ts         new
src/pages/api/pickleball/sessions/[id]/games/[gameId]/reopen.ts          new
src/pages/api/pickleball/sessions/[id]/games/[gameId]/correct.ts         new

tests/e2e/pickleball/pickleball-games.spec.js                            new
```

---

### Task 1: Migration 0008 — starting-server identity, correction flag, command-scoped idempotency

**Files:**
- Create: `migrations/pickleball/0008_phase4_hardening.sql`

**Interfaces:**
- Produces: 5 new nullable/defaulted columns on `games`; a rebuilt `idempotency_keys` table — consumed by every later task in this plan.

- [ ] **Step 1: Write the migration**

```sql
-- Pickleball Phase 4 hardening pass. Additive except the idempotency_keys
-- rebuild below, which is a genuine primary-key correction (see the plan's
-- Ruling 6) done via the standard SQLite rename/recreate/copy/drop sequence
-- since ALTER TABLE cannot change a PRIMARY KEY in place. migrations 0001-0007
-- are NOT touched.

-- Serving-player identity (Ruling 1) and the correction-mode flag (Ruling 2).
-- All five are nullable/defaulted so every existing row (there should be
-- none yet in any real environment, but this is safe regardless) remains
-- valid without a backfill.
ALTER TABLE games ADD COLUMN team_a_starting_server_session_player_id TEXT;
ALTER TABLE games ADD COLUMN team_b_starting_server_session_player_id TEXT;
ALTER TABLE games ADD COLUMN team_a_current_server_session_player_id TEXT;
ALTER TABLE games ADD COLUMN team_b_current_server_session_player_id TEXT;
ALTER TABLE games ADD COLUMN correction_pending INTEGER NOT NULL DEFAULT 0;

-- idempotency_keys rebuild: `key` alone was globally unique across every
-- game and every command, which defeats the purpose of an idempotency key
-- scoped to one command on one game (see Ruling 6).
ALTER TABLE idempotency_keys RENAME TO idempotency_keys_old;

CREATE TABLE idempotency_keys (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  command_type TEXT NOT NULL CHECK (command_type IN (
    'RECORD_RALLY', 'UNDO_LAST_RALLY', 'FINISH_GAME', 'ABANDON_GAME', 'REOPEN_GAME', 'CORRECT_GAME'
  )),
  key TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_idempotency_keys_game_command_key ON idempotency_keys(game_id, command_type, key);

-- Preserve any existing rows (expected: none in practice, since no command
-- used this table before this migration) under a placeholder command_type
-- the CHECK constraint above must therefore also accept.
INSERT INTO idempotency_keys (id, game_id, command_type, key, result_json, created_at)
  SELECT lower(hex(randomblob(16))), game_id, 'RECORD_RALLY', key, result_json, created_at
  FROM idempotency_keys_old;

DROP TABLE idempotency_keys_old;
```

Wait — the CHECK constraint above doesn't include a placeholder value for pre-existing rows, and the backfill `INSERT` assigns `'RECORD_RALLY'` to them, which IS one of the allowed values, so this is consistent; no separate placeholder value is needed. Double-check this reasoning holds before running Step 2 — if the target D1 database already has real idempotency rows from a command type other than what `'RECORD_RALLY'` would imply, note it in your report (it should not, but verify rather than assume).

- [ ] **Step 2: Apply locally and verify**

```bash
npx wrangler d1 migrations list devlab-pickleball --local
npx wrangler d1 migrations apply devlab-pickleball --local
npx wrangler d1 execute devlab-pickleball --local --command "SELECT sql FROM sqlite_master WHERE type='table' AND name IN ('games','idempotency_keys')"
```
Confirm: `games`'s schema shows the 5 new columns; `idempotency_keys`'s schema shows the new composite unique index and `id` as its primary key, not `key`.

- [ ] **Step 3: Commit**

```bash
git add migrations/pickleball/0008_phase4_hardening.sql
git commit -m "feat: add Pickleball hardening migration (serving identity, correction flag, scoped idempotency)"
```

---

### Task 2: Pure domain hardening — server rotation, format-aware init, terminal-score rule

**Files:**
- Create: `src/lib/pickleball/scoring/serverRotation.ts`
- Test: `src/lib/pickleball/scoring/serverRotation.test.ts`
- Modify: `src/lib/pickleball/scoring/gameState.ts`
- Test: `src/lib/pickleball/scoring/gameState.test.ts`
- Modify: `src/lib/pickleball/scoring/display.ts`
- Modify: `src/lib/pickleball/scoring/display.test.ts`

**Interfaces:**
- Produces: `interface ServerIdentity { teamACurrentServerId: string; teamBCurrentServerId: string }`, `nextServerIdentity(identity: ServerIdentity, before: GameState, after: GameState, teamAOtherPlayerId: string | null, teamBOtherPlayerId: string | null): ServerIdentity`, `deriveServingPlayer(state: GameState, identity: ServerIdentity): string`, `initialGameState(servingTeam: 'A' | 'B', format: 'SINGLES' | 'DOUBLES'): GameState` (signature change — format-aware), `hasGameBeenWon(state: GameState, ruleset: ScoringRulesetLike): boolean`, `isValidFinalScore` (rewritten body, same signature) — consumed by Task 4/5's DO methods.

- [ ] **Step 1: Update `gameState.ts` — format-aware `initialGameState`**

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

// Doubles opens on server 2 -- the traditional "0-0-2" start, where the very
// first serving side effectively gets only one server's turn before an
// immediate side out on a lost rally (see recordRally.ts's own comment).
// Singles has no server-1/server-2 distinction at all, so it must never
// carry a semantically meaningless serverNumber: 2 -- it opens (and stays)
// on 1 until the concept becomes relevant, which for singles is never.
export function initialGameState(servingTeam: 'A' | 'B', format: 'SINGLES' | 'DOUBLES'): GameState {
  return { scoreA: 0, scoreB: 0, servingTeam, serverNumber: format === 'DOUBLES' ? 2 : 1 }
}
```

- [ ] **Step 2: Write `gameState.test.ts`**

```typescript
import { describe, it, expect } from 'vitest'
import { initialGameState } from './gameState'

describe('initialGameState', () => {
  it('doubles opens on server 2 (the traditional 0-0-2 start)', () => {
    expect(initialGameState('A', 'DOUBLES')).toEqual({ scoreA: 0, scoreB: 0, servingTeam: 'A', serverNumber: 2 })
  })

  it('singles opens on server 1 -- never exposes a meaningless server 2', () => {
    expect(initialGameState('B', 'SINGLES')).toEqual({ scoreA: 0, scoreB: 0, servingTeam: 'B', serverNumber: 1 })
  })
})
```

Run `npx vitest run src/lib/pickleball/scoring/gameState.test.ts` — expect PASS immediately (this step documents the fixed behavior; there was no pre-existing test to go RED against, since `initialGameState` had none before this task).

- [ ] **Step 3: Find every existing caller of `initialGameState` and update the call site**

```bash
grep -rn "initialGameState(" src/ tests/
```
Every call site must now pass a `format` argument. As of this task, the only caller inside the pure engine's own test suite is `recordRally.test.ts` (Task 2 of the base plan) — update its one call site (`initialGameState('A')` → `initialGameState('A', 'DOUBLES')`, since that test's own ruleset constant is `DOUBLES`) and re-run `npx vitest run src/lib/pickleball/scoring/recordRally.test.ts` to confirm it still passes. Task 4/8's DO code (`SessionCoordinatorDO.ts`) does NOT currently call `initialGameState` directly (it inlines the opening state) — Task 4 of THIS plan will introduce the first DO call site, with the format argument from day one.

- [ ] **Step 4: Rewrite `isValidFinalScore` and add `hasGameBeenWon` in `display.ts`**

```typescript
import type { GameState, ScoringRulesetLike, RallyOutcome } from './gameState'

export function officialScoreCall(state: GameState, format: 'SINGLES' | 'DOUBLES'): string {
  const servingScore = state.servingTeam === 'A' ? state.scoreA : state.scoreB
  const receivingScore = state.servingTeam === 'A' ? state.scoreB : state.scoreA
  if (format === 'SINGLES') return `${servingScore}-${receivingScore}`
  return `${servingScore}-${receivingScore}-${state.serverNumber}`
}

// A LEGALLY REACHABLE final score, not merely "the win condition is
// mathematically satisfied." The naive `max >= target && diff >= winBy` rule
// also accepts scores the game should never have reached under normal
// sequential play (e.g. 12-9 in a game to 11 win-by-2: the game would have
// already ended at 11-9). Two cases:
//  - the winner finished EXACTLY at targetScore: the loser must be at or
//    below targetScore - winBy (the game couldn't have gone further once the
//    winner hit target with a sufficient margin already in hand).
//  - the winner finished ABOVE targetScore (a deuce game that kept extending
//    on repeated ties): the margin over the loser must be EXACTLY winBy --
//    any wider margin means the game should have already ended earlier.
export function isValidFinalScore(scoreA: number, scoreB: number, ruleset: ScoringRulesetLike): boolean {
  const winner = Math.max(scoreA, scoreB)
  const loser = Math.min(scoreA, scoreB)
  if (winner < ruleset.targetScore) return false
  if (winner === ruleset.targetScore) return loser <= ruleset.targetScore - ruleset.winBy
  return winner - loser === ruleset.winBy
}

export function isGamePoint(state: GameState, ruleset: ScoringRulesetLike): boolean {
  const hypotheticalScoreA = state.servingTeam === 'A' ? state.scoreA + 1 : state.scoreA
  const hypotheticalScoreB = state.servingTeam === 'B' ? state.scoreB + 1 : state.scoreB
  return isValidFinalScore(hypotheticalScoreA, hypotheticalScoreB, ruleset)
}

// True once the CURRENT score already satisfies isValidFinalScore -- i.e.
// the game is already over and no further rally should be accepted. This is
// deliberately the same check as isValidFinalScore (a final score IS a
// state where the game has been won), exposed under its own name so DO
// command handlers can guard "reject a new rally" with a name that reads
// as intent, not as a score-validation call reused for an unrelated purpose.
export function hasGameBeenWon(state: GameState, ruleset: ScoringRulesetLike): boolean {
  return isValidFinalScore(state.scoreA, state.scoreB, ruleset)
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

- [ ] **Step 5: Rewrite `display.test.ts`'s `isValidFinalScore`/terminal-score coverage**

Replace the existing `isValidFinalScore` `describe` block (keep `officialScoreCall`/`isGamePoint`/`contextualState`'s blocks — re-verify they still pass unchanged, since they call the rewritten function but their own test expectations were already written against legally-reachable scores) with:

```typescript
describe('isValidFinalScore / hasGameBeenWon — legally reachable finals only', () => {
  const TO_11 = { format: 'DOUBLES' as const, targetScore: 11, winBy: 2 }
  const TO_15 = { format: 'DOUBLES' as const, targetScore: 15, winBy: 2 }
  const TO_21 = { format: 'DOUBLES' as const, targetScore: 21, winBy: 2 }

  it.each([
    // [scoreA, scoreB, ruleset, expected]
    [11, 9, TO_11, true],
    [11, 10, TO_11, false],
    [12, 10, TO_11, true],
    [12, 9, TO_11, false],
    [12, 11, TO_11, false],
    [13, 11, TO_11, true],
    [13, 10, TO_11, false],
    [13, 12, TO_11, false],
    [14, 11, TO_11, false],
    [20, 20, TO_11, false],
    [22, 20, TO_11, true],
    [21, 20, TO_11, false],
    [15, 13, TO_15, true],
    [15, 12, TO_15, false],
    [21, 19, TO_21, true],
    [21, 18, TO_21, false],
  ])('scoreA=%i scoreB=%i target=%o -> %s', (scoreA, scoreB, ruleset, expected) => {
    expect(isValidFinalScore(scoreA, scoreB, ruleset)).toBe(expected)
    // hasGameBeenWon is the same check by construction -- assert the two
    // never disagree, so a future edit to one without the other is caught.
    expect(hasGameBeenWon({ scoreA, scoreB, servingTeam: 'A', serverNumber: 2 }, ruleset)).toBe(expected)
  })

  it('repeated ties never hit an artificial cap -- 20-20 continuing to 22-20 is valid, not capped at some "first to 13" rule', () => {
    expect(isValidFinalScore(20, 20, TO_11)).toBe(false)
    expect(isValidFinalScore(21, 21, TO_11)).toBe(false)
    expect(isValidFinalScore(22, 20, TO_11)).toBe(true)
    expect(isValidFinalScore(23, 21, TO_11)).toBe(true)
  })
})
```

Update the import line to include `hasGameBeenWon`.

- [ ] **Step 6: Run the full test file**

Run: `npx vitest run src/lib/pickleball/scoring/display.test.ts`
Expected: PASS. If `isGamePoint`/`contextualState`'s pre-existing test cases fail under the new rule, that means one of THOSE test's fixture scores was itself an unreachable score under the old lenient rule — fix the fixture score to a legally-reachable one that still demonstrates the same behavior, do not weaken `isValidFinalScore`'s new logic to make an unreachable fixture pass.

- [ ] **Step 7: Write `serverRotation.ts` and its failing test**

```typescript
// src/lib/pickleball/scoring/serverRotation.test.ts
import { describe, it, expect } from 'vitest'
import { nextServerIdentity, deriveServingPlayer } from './serverRotation'
import type { GameState } from './gameState'

const P_A1 = 'sp-a1'
const P_A2 = 'sp-a2'
const P_B1 = 'sp-b1'
const P_B2 = 'sp-b2'

function state(overrides: Partial<GameState>): GameState {
  return { scoreA: 0, scoreB: 0, servingTeam: 'A', serverNumber: 2, ...overrides }
}

describe('nextServerIdentity', () => {
  it('a point awarded (serving team keeps serving) never changes identity', () => {
    const identity = { teamACurrentServerId: P_A1, teamBCurrentServerId: P_B1 }
    const before = state({ servingTeam: 'A', serverNumber: 2 })
    const after = state({ servingTeam: 'A', serverNumber: 2, scoreA: 1 })
    expect(nextServerIdentity(identity, before, after, P_A2, P_B2)).toEqual(identity)
  })

  it('doubles SERVE_CHANGED (server1 -> server2, same team) flips that team\'s OWN current server to their partner', () => {
    const identity = { teamACurrentServerId: P_A1, teamBCurrentServerId: P_B1 }
    const before = state({ servingTeam: 'A', serverNumber: 1 })
    const after = state({ servingTeam: 'A', serverNumber: 2 })
    expect(nextServerIdentity(identity, before, after, P_A2, P_B2)).toEqual({ teamACurrentServerId: P_A2, teamBCurrentServerId: P_B1 })
  })

  it('side out flips the NEWLY-serving team\'s own current server to their partner; the team that just lost serve is untouched', () => {
    const identity = { teamACurrentServerId: P_A1, teamBCurrentServerId: P_B1 }
    const before = state({ servingTeam: 'A', serverNumber: 2 })
    const after = state({ servingTeam: 'B', serverNumber: 1 })
    expect(nextServerIdentity(identity, before, after, P_A2, P_B2)).toEqual({ teamACurrentServerId: P_A1, teamBCurrentServerId: P_B2 })
  })

  it('singles never flips -- the "other player" is null, so identity is a no-op regardless of outcome', () => {
    const identity = { teamACurrentServerId: P_A1, teamBCurrentServerId: P_B1 }
    const before = state({ servingTeam: 'A', serverNumber: 1 })
    const after = state({ servingTeam: 'B', serverNumber: 1 })
    expect(nextServerIdentity(identity, before, after, null, null)).toEqual(identity)
  })

  it('a second side-out back to team A continues rotation from where team A left off, not back to the original starting server', () => {
    // Team A already rotated to P_A2 (from the earlier side-out test). Team A
    // regains serve again -- rotation must continue to swap AGAIN, landing
    // back on P_A1, not staying on P_A2 or resetting to the original starter
    // in some other way.
    const identity = { teamACurrentServerId: P_A2, teamBCurrentServerId: P_B2 }
    const before = state({ servingTeam: 'B', serverNumber: 2 })
    const after = state({ servingTeam: 'A', serverNumber: 1 })
    expect(nextServerIdentity(identity, before, after, P_A1, P_B1)).toEqual({ teamACurrentServerId: P_A1, teamBCurrentServerId: P_B2 })
  })
})

describe('deriveServingPlayer', () => {
  it('returns team A\'s current server when A is serving', () => {
    const identity = { teamACurrentServerId: P_A1, teamBCurrentServerId: P_B1 }
    expect(deriveServingPlayer(state({ servingTeam: 'A' }), identity)).toBe(P_A1)
  })

  it('returns team B\'s current server when B is serving', () => {
    const identity = { teamACurrentServerId: P_A1, teamBCurrentServerId: P_B1 }
    expect(deriveServingPlayer(state({ servingTeam: 'B' }), identity)).toBe(P_B1)
  })
})
```

Run: `npx vitest run src/lib/pickleball/scoring/serverRotation.test.ts` — expect FAIL, module doesn't exist yet.

- [ ] **Step 8: Implement `serverRotation.ts`**

```typescript
import type { GameState } from './gameState'

export interface ServerIdentity {
  teamACurrentServerId: string
  teamBCurrentServerId: string
}

// Models the standard doubles server-rotation rule: each team's own two
// players swap which one currently holds the "serves first" position
// exactly when (a) that team is doubles and just went server1 -> server2
// (the partner takes over for this same service turn), or (b) that team
// just regained the serve via a side out (the player who did NOT serve last
// time that team had the serve now serves first this time). A team that is
// NOT currently affected by either transition keeps its stored identity
// unchanged, so rotation correctly continues from wherever that team left
// off the next time they regain serve, rather than resetting.
//
// Singles passes `null` for both "other player" arguments -- there is no
// second player to rotate to, so identity is always a no-op for singles.
export function nextServerIdentity(
  identity: ServerIdentity,
  before: GameState,
  after: GameState,
  teamAOtherPlayerId: string | null,
  teamBOtherPlayerId: string | null,
): ServerIdentity {
  const servingTeamChanged = before.servingTeam !== after.servingTeam
  const serverNumberChanged = before.serverNumber !== after.serverNumber

  if (!servingTeamChanged && !serverNumberChanged) {
    // POINT_AWARDED -- no rotation change.
    return identity
  }

  if (!servingTeamChanged && serverNumberChanged) {
    // SERVE_CHANGED (doubles only): the serving team's own player swaps.
    if (before.servingTeam === 'A') {
      return teamAOtherPlayerId ? { ...identity, teamACurrentServerId: teamAOtherPlayerId } : identity
    }
    return teamBOtherPlayerId ? { ...identity, teamBCurrentServerId: teamBOtherPlayerId } : identity
  }

  // SIDE_OUT: the team that just gained serve (after.servingTeam) rotates
  // its own player; the team that just lost serve is untouched.
  if (after.servingTeam === 'A') {
    return teamAOtherPlayerId ? { ...identity, teamACurrentServerId: teamAOtherPlayerId } : identity
  }
  return teamBOtherPlayerId ? { ...identity, teamBCurrentServerId: teamBOtherPlayerId } : identity
}

export function deriveServingPlayer(state: GameState, identity: ServerIdentity): string {
  return state.servingTeam === 'A' ? identity.teamACurrentServerId : identity.teamBCurrentServerId
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `npx vitest run src/lib/pickleball/scoring/serverRotation.test.ts`
Expected: PASS (all 6 cases).

- [ ] **Step 10: Commit**

```bash
git add src/lib/pickleball/scoring/serverRotation.ts src/lib/pickleball/scoring/serverRotation.test.ts src/lib/pickleball/scoring/gameState.ts src/lib/pickleball/scoring/gameState.test.ts src/lib/pickleball/scoring/display.ts src/lib/pickleball/scoring/display.test.ts src/lib/pickleball/scoring/recordRally.test.ts
git commit -m "fix: legally-reachable final-score rule, format-aware init, server-rotation identity"
```

---

### Task 3: Idempotency repository rewrite — command-scoped

**Files:**
- Modify: `src/worker/repositories/pickleball/idempotencyKeys.js`

**Interfaces:**
- Produces: `getIdempotentResult(db, { gameId, commandType, key }): Promise<unknown|null>`, `buildRecordIdempotentResultStatement(db, { gameId, commandType, key, result })` — consumed by Task 5/6/7's DO commands.

- [ ] **Step 1: Rewrite**

```javascript
import { nowIso, parseJsonField } from '../../utils/responses.js'

export async function getIdempotentResult(db, { gameId, commandType, key }) {
  if (!key) return null
  const row = await db
    .prepare(`SELECT result_json FROM idempotency_keys WHERE game_id = ? AND command_type = ? AND key = ?`)
    .bind(gameId, commandType, key)
    .first()
  if (!row) return null
  return parseJsonField(row.result_json, null)
}

// Only ever call this after a command's mutation statements are ALREADY in
// the same statements array this will be batched with -- see the plan's
// Ruling 8/9. Never call this for a command that is about to fail domain
// validation; only for one that is about to commit a real mutation.
export function buildRecordIdempotentResultStatement(db, { gameId, commandType, key, result }) {
  return db
    .prepare(`INSERT INTO idempotency_keys (id, game_id, command_type, key, result_json, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), gameId, commandType, key, JSON.stringify(result), nowIso())
}
```

- [ ] **Step 2: Confirm no other caller depends on the old signature**

```bash
grep -rn "getIdempotentResult\|buildRecordIdempotentResultStatement\|withIdempotency" src/
```
As of this task, the only caller is `SessionCoordinatorDO.ts`'s `withIdempotency` helper (added in the base plan's Task 8) — Task 5 of THIS plan removes that helper and updates its call sites to the new signature directly. Confirm this task does not itself need to touch `SessionCoordinatorDO.ts` — that's Task 5's job; this task only prepares the repository layer.

- [ ] **Step 3: Verify with a syntax check**

```bash
node --check src/worker/repositories/pickleball/idempotencyKeys.js
```

- [ ] **Step 4: Commit**

```bash
git add src/worker/repositories/pickleball/idempotencyKeys.js
git commit -m "fix: scope Pickleball idempotency keys to (game_id, command_type, key)"
```

---

### Task 4: `startGame` hardening — explicit serving assignment, no hardcoded `'A'`

**Files:**
- Modify: `src/worker/pickleball/SessionCoordinatorDO.ts`
- Modify: `src/lib/schemas/pickleball/games.ts`
- Modify: `src/worker/repositories/pickleball/games.js`

**Interfaces:**
- Consumes: `initialGameState` (Task 2, now format-aware), `ServerIdentity` shape (Task 2).
- Produces: `startGameSchema` gains `servingTeam`, `teamAStartingServerSessionPlayerId`, `teamBStartingServerSessionPlayerId` (doubles) fields; `SessionCoordinatorDO.startGame`'s signature gains these as parameters — consumed by Task 8 (base plan)'s route, which this task also updates.

- [ ] **Step 1: Update `games.js` — `buildCreateGameStatement` gains the identity columns**

Read the current function first (it was written in the base plan's Task 5). Add the 4 new columns to its INSERT:

```javascript
export function buildCreateGameStatement(db, {
  id, sessionId, sessionCourtId, scoringRulesetId, format, teamAId, teamBId, servingTeam,
  teamAStartingServerSessionPlayerId, teamBStartingServerSessionPlayerId, timestamp,
}) {
  return db
    .prepare(
      `INSERT INTO games (
        id, session_id, session_court_id, scoring_ruleset_id, format, status, team_a_id, team_b_id,
        revision, score_a, score_b, serving_team, server_number,
        team_a_starting_server_session_player_id, team_b_starting_server_session_player_id,
        team_a_current_server_session_player_id, team_b_current_server_session_player_id,
        started_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'IN_PROGRESS', ?, ?, 1, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id, sessionId, sessionCourtId, scoringRulesetId, format, teamAId, teamBId, servingTeam,
      format === 'DOUBLES' ? 2 : 1,
      teamAStartingServerSessionPlayerId, teamBStartingServerSessionPlayerId,
      teamAStartingServerSessionPlayerId, teamBStartingServerSessionPlayerId,
      timestamp, timestamp, timestamp,
    )
}
```

The `team_a_current_server`/`team_b_current_server` columns start equal to the STARTING server columns — rotation only diverges from the starting assignment once a `SERVE_CHANGED`/`SIDE_OUT` actually happens.

Also update `toGame`'s row mapper and `GAME_COLUMNS` constant to include the 4 new columns (camelCase: `teamAStartingServerSessionPlayerId`, `teamBStartingServerSessionPlayerId`, `teamACurrentServerSessionPlayerId`, `teamBCurrentServerSessionPlayerId`), and add a new `buildUpdateServerIdentityStatement(db, gameId, { teamACurrentServerSessionPlayerId, teamBCurrentServerSessionPlayerId })`:

```javascript
export function buildUpdateServerIdentityStatement(db, gameId, { teamACurrentServerSessionPlayerId, teamBCurrentServerSessionPlayerId }) {
  return db
    .prepare(`UPDATE games SET team_a_current_server_session_player_id = ?, team_b_current_server_session_player_id = ? WHERE id = ?`)
    .bind(teamACurrentServerSessionPlayerId, teamBCurrentServerSessionPlayerId, gameId)
}
```

- [ ] **Step 2: Update `startGameSchema` in `src/lib/schemas/pickleball/games.ts`**

```typescript
export const startGameSchema = z.object({
  sessionCourtId: z.string().uuid(),
  servingTeam: z.enum(['A', 'B']),
  teamAStartingServerSessionPlayerId: z.string().uuid(),
  teamBStartingServerSessionPlayerId: z.string().uuid(),
})
```

Both starting-server fields are required even for SINGLES (where each team has exactly one member) — the route/DO layer validates each supplied id actually IS the sole member of its team; for DOUBLES, it validates the supplied id is ONE of that team's two members (not necessarily "the first" in any stored order, since there's no meaningful ordering to violate — the facilitator is explicitly choosing who serves first).

- [ ] **Step 3: Rewrite `startGame` in `SessionCoordinatorDO.ts`**

Read the current method first (base plan's Task 7). Replace the hardcoded `const servingTeam: 'A' | 'B' = 'A'` and add validation + identity columns:

```typescript
async startGame(
  sessionId: string,
  sessionCourtId: string,
  servingTeam: 'A' | 'B',
  teamAStartingServerSessionPlayerId: string,
  teamBStartingServerSessionPlayerId: string,
) {
  if (!this.ownsSession(sessionId)) return failure('Coordinator/session mismatch.')

  const db = this.env.PICKLEBALL_DB

  const court = await getSessionCourt(db, sessionId, sessionCourtId)
  if (!court) return failure('Court not found.')
  if (court.status !== 'ASSIGNED') return failure('Court has no pending assignment to start a game for.')

  const session = await getSessionById(db, sessionId)
  if (!session) return failure('Session not found.')
  const ruleset = await getScoringRuleset(db, session.scoringRulesetId, session.organizationId)
  if (!ruleset) return failure('Scoring ruleset not found.')

  const sessionPlayerIds = await listAssignedSessionPlayerIdsForCourt(db, sessionId, sessionCourtId)
  if (!sessionPlayerIds.length) return failure('No players are currently assigned to this court.')

  const anyAssignedPlayerId = sessionPlayerIds[0]
  const team = await getActiveTeamForSessionPlayer(db, sessionId, anyAssignedPlayerId)
  if (!team || team.sessionCourtId !== sessionCourtId) {
    return failure('Could not resolve the teams currently assigned to this court.')
  }

  const courtTeamsResult = await db
    .prepare(`SELECT id FROM teams WHERE session_court_id = ? AND session_id = ?`)
    .bind(sessionCourtId, sessionId)
    .all<{ id: string }>()
  const courtTeamIds = (courtTeamsResult.results || []).map((row) => row.id)
  if (courtTeamIds.length !== 2) {
    return failure(`Expected exactly 2 teams bound to this court, found ${courtTeamIds.length}.`)
  }
  const [firstTeamId, secondTeamId] = courtTeamIds

  const firstTeamMembers = await getTeamWithMembers(db, firstTeamId)
  const secondTeamMembers = await getTeamWithMembers(db, secondTeamId)

  // The court binding doesn't itself distinguish "team A" from "team B" --
  // that label only matters for which of the two supplied starting-server
  // ids belongs to which side, so resolve by MEMBERSHIP: whichever team
  // actually contains teamAStartingServerSessionPlayerId is team A.
  const firstContainsA = (firstTeamMembers?.members ?? []).some((m) => m.sessionPlayerId === teamAStartingServerSessionPlayerId)
  const secondContainsA = (secondTeamMembers?.members ?? []).some((m) => m.sessionPlayerId === teamAStartingServerSessionPlayerId)
  if (firstContainsA === secondContainsA) {
    // Either neither team contains it (invalid id) or both do (shouldn't be
    // possible given team_members are exclusive, but treat ambiguity the
    // same as an invalid id -- fail closed).
    return failure('teamAStartingServerSessionPlayerId does not belong to exactly one of the two teams on this court.')
  }
  const teamAId = firstContainsA ? firstTeamId : secondTeamId
  const teamBId = firstContainsA ? secondTeamId : firstTeamId
  const teamAMembers = firstContainsA ? firstTeamMembers : secondTeamMembers
  const teamBMembers = firstContainsA ? secondTeamMembers : firstTeamMembers

  const teamAMemberIds = (teamAMembers?.members ?? []).map((m) => m.sessionPlayerId)
  const teamBMemberIds = (teamBMembers?.members ?? []).map((m) => m.sessionPlayerId)
  if (!teamBMemberIds.includes(teamBStartingServerSessionPlayerId)) {
    return failure('teamBStartingServerSessionPlayerId does not belong to team B on this court.')
  }
  if (ruleset.format === 'SINGLES' && (teamAMemberIds.length !== 1 || teamBMemberIds.length !== 1)) {
    return failure('Singles requires exactly one player per team.')
  }

  const gameId = crypto.randomUUID()
  const timestamp = new Date().toISOString()

  const gameStatement = buildCreateGameStatement(db, {
    id: gameId, sessionId, sessionCourtId, scoringRulesetId: ruleset.id, format: ruleset.format,
    teamAId, teamBId, servingTeam,
    teamAStartingServerSessionPlayerId, teamBStartingServerSessionPlayerId, timestamp,
  })

  const participantStatements = [
    ...teamAMemberIds.map((sessionPlayerId) =>
      db.prepare(`INSERT INTO game_participants (id, game_id, session_player_id, team_id) VALUES (?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), gameId, sessionPlayerId, teamAId)),
    ...teamBMemberIds.map((sessionPlayerId) =>
      db.prepare(`INSERT INTO game_participants (id, game_id, session_player_id, team_id) VALUES (?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), gameId, sessionPlayerId, teamBId)),
  ]

  const startedEvent = buildAppendScoreEventStatement(db, {
    gameId, sequence: 1, eventType: 'GAME_STARTED', actorUserId: 'system',
    payload: { servingTeam, teamAStartingServerSessionPlayerId, teamBStartingServerSessionPlayerId },
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

This replaces the original implementation's team-A/team-B resolution (which arbitrarily called whichever court-bound team came first "team A") with membership-based resolution driven by the caller's own choice of starting server — the caller decides who's on which labeled side by choosing which starting-server id is "team A's."

- [ ] **Step 4: Update the route**

Read `src/pages/api/pickleball/sessions/[id]/games/start.ts` (base plan's Task 13) and update its `stub.startGame(...)` call to pass the 3 new fields from `result.data`, matching the new schema and DO signature.

- [ ] **Step 5: Verify**

Run `npx tsc --noEmit -p tsconfig.json` — clean.

- [ ] **Step 6: Commit**

```bash
git add src/worker/pickleball/SessionCoordinatorDO.ts src/lib/schemas/pickleball/games.ts src/worker/repositories/pickleball/games.js src/pages/api/pickleball/sessions/[id]/games/start.ts
git commit -m "fix: startGame no longer hardcodes servingTeam, validates starting-server membership"
```

---

### Task 5: `recordRally`/`undoLastRally` hardening — terminal guard, identity tracking, atomic non-caching idempotency

**Files:**
- Modify: `src/worker/pickleball/SessionCoordinatorDO.ts`

**Interfaces:**
- Consumes: `hasGameBeenWon` (Task 2), `nextServerIdentity` (Task 2), `replayEvents` (base plan Task 3), `getIdempotentResult`/`buildRecordIdempotentResultStatement` (Task 3 of this plan, new signature).
- Produces: rewritten `recordRally`, `undoLastRally` — the `withIdempotency` private helper is REMOVED.

- [ ] **Step 1: Remove the `withIdempotency` helper**

Delete the private `withIdempotency` method added in the base plan's Task 8 entirely — per Ruling 8, it cannot satisfy same-batch atomicity and is replaced by inline `getIdempotentResult`/`buildRecordIdempotentResultStatement` calls in each command.

- [ ] **Step 2: Rewrite `recordRally`**

```typescript
import { hasGameBeenWon } from '../../lib/pickleball/scoring/display'
import { nextServerIdentity } from '../../lib/pickleball/scoring/serverRotation'
import { getIdempotentResult, buildRecordIdempotentResultStatement } from '../repositories/pickleball/idempotencyKeys.js'
import { buildUpdateServerIdentityStatement } from '../repositories/pickleball/games.js'
```

```typescript
async recordRally(sessionId: string, gameId: string, winningTeam: 'A' | 'B', actorUserId: string, idempotencyKey?: string) {
  if (!this.ownsSession(sessionId)) return failure('Coordinator/session mismatch.')

  const db = this.env.PICKLEBALL_DB

  if (idempotencyKey) {
    const cached = await getIdempotentResult(db, { gameId, commandType: 'RECORD_RALLY', key: idempotencyKey })
    if (cached) return cached
  }

  const game = await getGame(db, sessionId, gameId)
  if (!game) return failure('Game not found.')
  if (game.status !== 'IN_PROGRESS') return failure('Game is not in progress.')
  if (game.correctionPending) return failure('This game is under correction; use correctGame instead of recording a new rally.')

  const session = await getSessionById(db, sessionId)
  if (!session) return failure('Session not found.')
  const ruleset = await getScoringRuleset(db, session.scoringRulesetId, session.organizationId)
  if (!ruleset) return failure('Scoring ruleset not found.')

  const before = { scoreA: game.scoreA, scoreB: game.scoreB, servingTeam: game.servingTeam, serverNumber: game.serverNumber }

  // The terminal-score guard lives HERE, not inside the pure recordRally --
  // see the plan's Ruling 3. A game that already reached a valid final score
  // must not accept another rally; finishGame (or correctGame) is the only
  // path forward from here.
  if (hasGameBeenWon(before, ruleset)) {
    return failure(`This game already has a final score (${before.scoreA}-${before.scoreB}) -- finish it instead of recording another rally.`)
  }

  const after = recordRally(before, ruleset, winningTeam)
  const outcome = classifyRallyOutcome(before, after)

  const identity = { teamACurrentServerId: game.teamACurrentServerSessionPlayerId, teamBCurrentServerId: game.teamBCurrentServerSessionPlayerId }
  const teamAMembers = await getTeamWithMembers(db, game.teamAId)
  const teamBMembers = await getTeamWithMembers(db, game.teamBId)
  const teamAOtherPlayerId = (teamAMembers?.members ?? []).map((m) => m.sessionPlayerId).find((id) => id !== identity.teamACurrentServerId) ?? null
  const teamBOtherPlayerId = (teamBMembers?.members ?? []).map((m) => m.sessionPlayerId).find((id) => id !== identity.teamBCurrentServerId) ?? null
  const nextIdentity = nextServerIdentity(identity, before, after, teamAOtherPlayerId, teamBOtherPlayerId)

  const sequence = await getNextSequence(db, gameId)
  const eventStatement = buildAppendScoreEventStatement(db, {
    gameId, sequence, eventType: outcome, actorUserId, payload: { winningTeam },
  })
  const projectionStatement = buildUpdateGameProjectionStatement(db, gameId, {
    scoreA: after.scoreA, scoreB: after.scoreB, servingTeam: after.servingTeam, serverNumber: after.serverNumber,
    status: game.status, winningTeamId: game.winningTeamId, finalScoreA: game.finalScoreA, finalScoreB: game.finalScoreB,
    revision: sequence,
  })
  const identityStatement = buildUpdateServerIdentityStatement(db, gameId, {
    teamACurrentServerSessionPlayerId: nextIdentity.teamACurrentServerId,
    teamBCurrentServerSessionPlayerId: nextIdentity.teamBCurrentServerId,
  })

  const result = { ok: true as const, state: after, outcome, servingPlayerId: deriveServingPlayer(after, nextIdentity) }

  const statements = [eventStatement, projectionStatement, identityStatement]
  if (idempotencyKey) {
    statements.push(buildRecordIdempotentResultStatement(db, { gameId, commandType: 'RECORD_RALLY', key: idempotencyKey, result }))
  }

  await db.batch(statements)

  return { ...result, game: await getGame(db, sessionId, gameId) }
}
```

Add `deriveServingPlayer` to the `serverRotation` import line. Note the idempotency record is now built from `result` (computed purely in-memory before the batch, per Ruling 8) rather than a post-batch re-fetch — the cached-hit path above returns exactly this same shape, minus the fresh `game` re-fetch (a cache hit doesn't re-fetch `game`; document this minor shape difference in your report if you keep it, or fetch `game` fresh in both paths for exact symmetry, your call, but note which you chose).

- [ ] **Step 3: Rewrite `undoLastRally` to call the canonical `replayEvents`**

```typescript
import { replayEvents } from '../../lib/pickleball/scoring/replayEvents'
```

```typescript
async undoLastRally(sessionId: string, gameId: string, actorUserId: string) {
  if (!this.ownsSession(sessionId)) return failure('Coordinator/session mismatch.')

  const db = this.env.PICKLEBALL_DB

  const game = await getGame(db, sessionId, gameId)
  if (!game) return failure('Game not found.')
  if (game.status !== 'IN_PROGRESS') return failure('Game is not in progress.')

  const events = await listScoreEventsForGame(db, gameId)
  const alreadyReversed = new Set(
    events.filter((e) => e.eventType === 'POINT_REVERSED').map((e) => e.payload.reversedSequence as number),
  )
  const scoringEvents = events.filter(
    (e) => ['POINT_AWARDED', 'SERVE_CHANGED', 'SIDE_OUT'].includes(e.eventType) && !alreadyReversed.has(e.sequence),
  )
  const lastRally = scoringEvents.at(-1)
  if (!lastRally) return failure('There is no rally to undo.')

  const session = await getSessionById(db, sessionId)
  if (!session) return failure('Session not found.')
  const ruleset = await getScoringRuleset(db, session.scoringRulesetId, session.organizationId)
  if (!ruleset) return failure('Scoring ruleset not found.')

  // Reuse the SAME canonical replay engine gameProjection.ts trusts, over the
  // hypothetical event list with the new reversal already appended -- this
  // is what correctly accounts for a SCORE_CORRECTED event sitting between
  // the undone rally and the start of the game (the original per-task-8
  // design re-derived state with its own fold that ignored SCORE_CORRECTED
  // entirely; this fixes that real gap -- see Ruling 5).
  const hypotheticalEvents = [
    ...events.map((e) => ({ sequence: e.sequence, eventType: e.eventType, payload: e.payload })),
    { sequence: (await getNextSequence(db, gameId)), eventType: 'POINT_REVERSED', payload: { reversedSequence: lastRally.sequence } },
  ]
  const replayed = replayEvents(hypotheticalEvents, ruleset)

  const nextSequence = hypotheticalEvents.at(-1)!.sequence
  const reversalEvent = buildAppendScoreEventStatement(db, {
    gameId, sequence: nextSequence, eventType: 'POINT_REVERSED', actorUserId, payload: { reversedSequence: lastRally.sequence },
  })
  const projectionStatement = buildUpdateGameProjectionStatement(db, gameId, {
    scoreA: replayed.state.scoreA, scoreB: replayed.state.scoreB, servingTeam: replayed.state.servingTeam, serverNumber: replayed.state.serverNumber,
    status: replayed.status, winningTeamId: replayed.winningTeamId, finalScoreA: replayed.finalScoreA, finalScoreB: replayed.finalScoreB,
    revision: nextSequence,
  })

  await db.batch([reversalEvent, projectionStatement])

  return { ok: true as const, state: replayed.state, game: await getGame(db, sessionId, gameId) }
}
```

Note: `undoLastRally` does NOT update server identity in this pass — recomputing identity backward through an undo would require replaying the IDENTITY rotation the same way `replayEvents` replays GameState, which `replayEvents` does not currently track (it only folds `GameState`, not `ServerIdentity`). This is a deliberate, documented scope limit: add a code comment noting that `team_a_current_server_session_player_id`/`team_b_current_server_session_player_id` are NOT rolled back by undo in this pass (they reflect the state as of the undone rally, not the pre-undo rotation) — flag this in your report as a known, narrow limitation for the controller to decide whether it's acceptable or needs a follow-up (extending `replayEvents`'s `ReplayResult` to also carry identity is the natural fix, but is additional scope beyond what this task's brief covers).

- [ ] **Step 4: Verify**

Run `npx tsc --noEmit -p tsconfig.json` — clean.

- [ ] **Step 5: Commit**

```bash
git add src/worker/pickleball/SessionCoordinatorDO.ts
git commit -m "fix: recordRally terminal guard + identity tracking, undoLastRally uses canonical replay"
```

---

### Task 6: Atomic finish + release; `abandonGame`

**Files:**
- Modify: `src/worker/pickleball/SessionCoordinatorDO.ts`
- Modify: `src/worker/repositories/pickleball/sessionCourts.js` (if `buildSetCourtStatusStatement` needs no change, confirm; the release-side statements already live in `teams.js`/`queueEntries.js`/`sessionPlayers.js` as `build*Statement` functions from the base plan — this task composes them directly rather than calling `this.releaseCourt(...)` as a second sequential call)

**Interfaces:**
- Consumes: `isValidFinalScore`/`hasGameBeenWon` (Task 2), `gamePerformance` (base plan Task 4), `buildCreatePlayerGameStatStatement`/`buildUpsertMatchmakingStatement`/`buildIncrementGamesPlayedStatement` (base plan Task 5), the existing release-composing statements already used by `releaseCourt` (`buildCloseQueueEntryStatement`, `buildJoinQueueStatement`, `buildClearTeamCourtBindingStatement`, `buildSetCourtStatusStatement`, `listAssignedSessionPlayerIdsForCourt`).
- Produces: `SessionCoordinatorDO.finishGame(sessionId, gameId, actorUserId, idempotencyKey?)`, `SessionCoordinatorDO.abandonGame(sessionId, gameId, actorUserId)`.

- [ ] **Step 1: Add `finishGame` — atomic finish + release in ONE batch**

```typescript
import { buildCreatePlayerGameStatStatement } from '../repositories/pickleball/playerGameStats.js'
import { buildUpsertMatchmakingStatement } from '../repositories/pickleball/matchmakingHistory.js'
import { buildIncrementGamesPlayedStatement } from '../repositories/pickleball/sessionPlayers.js'
```

```typescript
async finishGame(sessionId: string, gameId: string, actorUserId: string, idempotencyKey?: string) {
  if (!this.ownsSession(sessionId)) return failure('Coordinator/session mismatch.')

  const db = this.env.PICKLEBALL_DB

  if (idempotencyKey) {
    const cached = await getIdempotentResult(db, { gameId, commandType: 'FINISH_GAME', key: idempotencyKey })
    if (cached) return cached
  }

  const game = await getGame(db, sessionId, gameId)
  if (!game) return failure('Game not found.')
  if (game.status !== 'IN_PROGRESS') return failure('Game is not in progress.')

  const session = await getSessionById(db, sessionId)
  if (!session) return failure('Session not found.')
  const ruleset = await getScoringRuleset(db, session.scoringRulesetId, session.organizationId)
  if (!ruleset) return failure('Scoring ruleset not found.')

  if (!isValidFinalScore(game.scoreA, game.scoreB, ruleset)) {
    // Do NOT record an idempotency result here -- see Ruling 9. A retry
    // with the same key after the score legitimately changes must not be
    // poisoned by this failed attempt.
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
    .all<{ session_player_id: string; team_id: string; player_id: string }>()
  const participants = participantsResult.results || []

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

  const matchmakingStatements: unknown[] = []
  const teamAPlayers = participants.filter((p) => p.team_id === game.teamAId).map((p) => p.player_id)
  const teamBPlayers = participants.filter((p) => p.team_id === game.teamBId).map((p) => p.player_id)
  for (const players of [teamAPlayers, teamBPlayers]) {
    for (let i = 0; i < players.length; i += 1) {
      for (let j = i + 1; j < players.length; j += 1) {
        matchmakingStatements.push(
          buildUpsertMatchmakingStatement(db, { sessionId, playerId: players[i], otherPlayerId: players[j], relation: 'PARTNER', timestamp }),
          buildUpsertMatchmakingStatement(db, { sessionId, playerId: players[j], otherPlayerId: players[i], relation: 'PARTNER', timestamp }),
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

  const gamesPlayedStatements = participants.map((p) => buildIncrementGamesPlayedStatement(db, sessionId, p.session_player_id))

  // Atomic release (Ruling 7): the SAME statements releaseCourt itself
  // builds, composed directly into THIS batch rather than calling
  // this.releaseCourt(...) as a second, separate DO call afterward -- no
  // window where the game is FINISHED but the court/queue still say
  // otherwise. releaseCourt itself remains independently callable (a
  // facilitator can still release a court with no finished game behind it).
  const releasedSessionPlayerIds = participants.map((p) => p.session_player_id)
  const requeued = session.postGameRotationPolicy === 'AUTO_REQUEUE_ALL'
  const releaseStatements = releasedSessionPlayerIds.flatMap((sessionPlayerId) => [
    buildCloseQueueEntryStatement(db, sessionId, sessionPlayerId),
    ...(requeued ? [buildJoinQueueStatement(db, { sessionId, sessionPlayerId })] : []),
  ])
  releaseStatements.push(buildClearTeamCourtBindingStatement(db, sessionId, game.sessionCourtId))
  releaseStatements.push(buildSetCourtStatusStatement(db, sessionId, game.sessionCourtId, 'AVAILABLE'))

  const result = {
    ok: true as const, winningTeamId, finalScoreA: game.scoreA, finalScoreB: game.scoreB,
    releasedSessionPlayerIds, requeued,
  }

  const statements = [finishedEvent, projectionStatement, ...statStatements, ...matchmakingStatements, ...gamesPlayedStatements, ...releaseStatements]
  if (idempotencyKey) {
    statements.push(buildRecordIdempotentResultStatement(db, { gameId, commandType: 'FINISH_GAME', key: idempotencyKey, result }))
  }

  await db.batch(statements)

  return { ...result, game: await getGame(db, sessionId, gameId) }
}
```

`releaseCourt` itself is UNCHANGED by this task — it remains available for a facilitator to call directly on a court with no game (e.g. cancelling an assignment before any game started). This task only stops `finishGame` from calling it as a second, non-atomic step.

- [ ] **Step 2: Add `abandonGame`**

```typescript
async abandonGame(sessionId: string, gameId: string, actorUserId: string) {
  if (!this.ownsSession(sessionId)) return failure('Coordinator/session mismatch.')

  const db = this.env.PICKLEBALL_DB

  const game = await getGame(db, sessionId, gameId)
  if (!game) return failure('Game not found.')
  if (game.status !== 'IN_PROGRESS') return failure('Game is not in progress.')

  const session = await getSessionById(db, sessionId)
  if (!session) return failure('Session not found.')

  const sequence = await getNextSequence(db, gameId)
  const abandonedEvent = buildAppendScoreEventStatement(db, { gameId, sequence, eventType: 'GAME_ABANDONED', actorUserId, payload: {} })
  const projectionStatement = buildUpdateGameProjectionStatement(db, gameId, {
    scoreA: game.scoreA, scoreB: game.scoreB, servingTeam: game.servingTeam, serverNumber: game.serverNumber,
    status: 'ABANDONED', winningTeamId: null, finalScoreA: null, finalScoreB: null, revision: sequence,
  })

  // No player_game_stats, no matchmaking_history, no games_played increment
  // -- an abandoned game is explicitly excluded from OPI (edge case #18) and
  // was never actually completed. Court/queue release IS atomic with the
  // abandonment, same principle as finishGame.
  const sessionPlayerIds = await listAssignedSessionPlayerIdsForCourt(db, sessionId, game.sessionCourtId)
  const requeued = session.postGameRotationPolicy === 'AUTO_REQUEUE_ALL'
  const releaseStatements = sessionPlayerIds.flatMap((sessionPlayerId) => [
    buildCloseQueueEntryStatement(db, sessionId, sessionPlayerId),
    ...(requeued ? [buildJoinQueueStatement(db, { sessionId, sessionPlayerId })] : []),
  ])
  releaseStatements.push(buildClearTeamCourtBindingStatement(db, sessionId, game.sessionCourtId))
  releaseStatements.push(buildSetCourtStatusStatement(db, sessionId, game.sessionCourtId, 'AVAILABLE'))

  await db.batch([abandonedEvent, projectionStatement, ...releaseStatements])

  return { ok: true as const, releasedSessionPlayerIds: sessionPlayerIds, requeued, game: await getGame(db, sessionId, gameId) }
}
```

- [ ] **Step 3: Verify**

Run `npx tsc --noEmit -p tsconfig.json` — clean.

- [ ] **Step 4: Commit**

```bash
git add src/worker/pickleball/SessionCoordinatorDO.ts
git commit -m "feat: add atomic Pickleball finishGame and abandonGame (finish+release in one batch)"
```

---

### Task 7: Recomputation repositories; `reopenGame` and `correctGame` with a correction-only lifecycle

**Files:**
- Modify: `src/worker/repositories/pickleball/sessionPlayers.js` (add `buildRecomputeGamesPlayedStatement`)
- Modify: `src/worker/repositories/pickleball/matchmakingHistory.js` (add `recomputeMatchmakingHistoryStatements`)
- Modify: `src/worker/repositories/pickleball/playerGameStats.js` (confirm `buildDeletePlayerGameStatsForGameStatement` already exists — it does, from the base plan)
- Modify: `src/worker/pickleball/SessionCoordinatorDO.ts`

**Interfaces:**
- Produces: `buildRecomputeGamesPlayedStatement(db, sessionId, sessionPlayerId)`, `recomputeMatchmakingHistoryStatements(db, sessionId): Promise<unknown[]>`, `SessionCoordinatorDO.reopenGame`, `SessionCoordinatorDO.correctGame` — consumed by Task 8's routes.

- [ ] **Step 1: `buildRecomputeGamesPlayedStatement` in `sessionPlayers.js`**

```javascript
// Deterministic recomputation (Ruling 11) rather than incremental
// subtraction: games_played always equals the COUNT of FINISHED games this
// session_player actually participated in. No negative-count risk, no
// double-counting risk across reopen/correct/re-finish cycles.
export function buildRecomputeGamesPlayedStatement(db, sessionId, sessionPlayerId) {
  return db
    .prepare(
      `UPDATE session_players SET games_played = (
        SELECT COUNT(*) FROM game_participants gp
        JOIN games g ON g.id = gp.game_id
        WHERE gp.session_player_id = ? AND g.status = 'FINISHED'
      ), updated_at = ?
       WHERE id = ? AND session_id = ?`,
    )
    .bind(sessionPlayerId, nowIso(), sessionPlayerId, sessionId)
}
```

- [ ] **Step 2: `recomputeMatchmakingHistoryStatements` in `matchmakingHistory.js`**

```javascript
import { nowIso } from '../../utils/responses.js'

// Full session-scoped rebuild (Ruling 11): delete everything for this
// session, then re-derive every partner/opponent pair from every currently
// FINISHED game, processed oldest-finished-first so last_game_at naturally
// ends up correct (each upsert overwrites it with the latest timestamp
// processed) with no special-casing for "was the corrected game the most
// recent one." Returns an array of UNEXECUTED statements for the caller to
// fold into its own db.batch() -- this function only READS before building
// them, it does not execute anything itself.
export async function recomputeMatchmakingHistoryStatements(db, sessionId) {
  const deleteStatement = db.prepare(`DELETE FROM matchmaking_history WHERE session_id = ?`).bind(sessionId)

  const gamesResult = await db
    .prepare(`SELECT id, team_a_id, team_b_id, finished_at FROM games WHERE session_id = ? AND status = 'FINISHED' ORDER BY finished_at ASC`)
    .bind(sessionId)
    .all()
  const games = gamesResult.results || []

  const upsertStatements = []
  for (const game of games) {
    const participantsResult = await db
      .prepare(
        `SELECT gp.team_id, sp.player_id FROM game_participants gp
         JOIN session_players sp ON sp.id = gp.session_player_id
         WHERE gp.game_id = ?`,
      )
      .bind(game.id)
      .all()
    const participants = participantsResult.results || []
    const teamAPlayers = participants.filter((p) => p.team_id === game.team_a_id).map((p) => p.player_id)
    const teamBPlayers = participants.filter((p) => p.team_id === game.team_b_id).map((p) => p.player_id)
    const timestamp = game.finished_at || nowIso()

    for (const players of [teamAPlayers, teamBPlayers]) {
      for (let i = 0; i < players.length; i += 1) {
        for (let j = i + 1; j < players.length; j += 1) {
          upsertStatements.push(
            buildUpsertMatchmakingStatement(db, { sessionId, playerId: players[i], otherPlayerId: players[j], relation: 'PARTNER', timestamp }),
            buildUpsertMatchmakingStatement(db, { sessionId, playerId: players[j], otherPlayerId: players[i], relation: 'PARTNER', timestamp }),
          )
        }
      }
    }
    for (const playerA of teamAPlayers) {
      for (const playerB of teamBPlayers) {
        upsertStatements.push(
          buildUpsertMatchmakingStatement(db, { sessionId, playerId: playerA, otherPlayerId: playerB, relation: 'OPPONENT', timestamp }),
          buildUpsertMatchmakingStatement(db, { sessionId, playerId: playerB, otherPlayerId: playerA, relation: 'OPPONENT', timestamp }),
        )
      }
    }
  }

  return [deleteStatement, ...upsertStatements]
}
```

`buildUpsertMatchmakingStatement` is already defined above this in the same file (base plan's Task 5) — this function calls it, it doesn't redefine it.

- [ ] **Step 3: Add `reopenGame` to `SessionCoordinatorDO.ts`**

```typescript
import { buildDeletePlayerGameStatsForGameStatement } from '../repositories/pickleball/playerGameStats.js'
import { buildRecomputeGamesPlayedStatement } from '../repositories/pickleball/sessionPlayers.js'
import { recomputeMatchmakingHistoryStatements } from '../repositories/pickleball/matchmakingHistory.js'
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
  // status returns to IN_PROGRESS (so existing readers of `status` keep
  // working unchanged, per Ruling 2) but correction_pending = 1 is the real
  // signal: recordRally checks this and refuses ordinary rallies, and this
  // reopen does NOT touch the court or queue at all -- the court was
  // already released and its players already moved on (issue #12: this is
  // a HISTORICAL correction, not resumed live play).
  const projectionStatement = buildUpdateGameProjectionStatement(db, gameId, {
    scoreA: game.scoreA, scoreB: game.scoreB, servingTeam: game.servingTeam, serverNumber: game.serverNumber,
    status: 'IN_PROGRESS', winningTeamId: null, finalScoreA: null, finalScoreB: null, revision: sequence,
  })
  const correctionFlagStatement = db.prepare(`UPDATE games SET correction_pending = 1 WHERE id = ?`).bind(gameId)
  const invalidateStatsStatement = buildDeletePlayerGameStatsForGameStatement(db, gameId)

  const participantsResult = await db
    .prepare(`SELECT DISTINCT gp.session_player_id FROM game_participants gp WHERE gp.game_id = ?`)
    .bind(gameId)
    .all<{ session_player_id: string }>()
  const sessionPlayerIds = (participantsResult.results || []).map((row) => row.session_player_id)
  const gamesPlayedStatements = sessionPlayerIds.map((id) => buildRecomputeGamesPlayedStatement(db, sessionId, id))
  const matchmakingStatements = await recomputeMatchmakingHistoryStatements(db, sessionId)

  await db.batch([
    reopenedEvent, projectionStatement, correctionFlagStatement, invalidateStatsStatement,
    ...gamesPlayedStatements, ...matchmakingStatements,
  ])

  return { ok: true as const, game: await getGame(db, sessionId, gameId) }
}
```

Because `game.status` becomes `IN_PROGRESS` (unchanged from `FINISHED` -> reopened, per Ruling 2's data-model choice) but the game's court/queue were never touched, this game is now IN_PROGRESS-in-name-with-correction-pending, still bound to a court that has moved on to other business — this is intentional and matches the plan's Ruling 2/section 12 requirement precisely.

- [ ] **Step 4: Add `correctGame`**

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

`correctGame` itself is usable whether or not `correction_pending` is set — it can correct a mistake noticed while a game is still genuinely, physically live (`correction_pending = 0`) or a historically-reopened one (`correction_pending = 1`); what changes based on that flag is whether `recordRally` will accept an ORDINARY rally afterward, not whether `correctGame` itself is reachable. This is deliberate — re-read section 7 of the hardening directive if this seems surprising: it explicitly allows correction "while IN_PROGRESS" without requiring the game to have gone through `reopenGame` first, for the mid-game-mistake case.

- [ ] **Step 5: Make `finishGame` correction-aware — the "re-finish after correction" path**

Modify Step 1 of Task 6's `finishGame` (already committed by that point) to branch on `game.correctionPending`. Read the current method, then insert this branch right after the `isValidFinalScore` check passes and before building `finishedEvent`:

```typescript
if (game.correctionPending) {
  // Re-finish after a historical correction: the court was already
  // released and players already moved on when this game first finished --
  // do NOT release it again, do NOT re-increment games_played incrementally
  // (recompute instead, since this game's contribution may already be
  // counted once from before the reopen), and clear correction_pending.
  const clearCorrectionStatement = db.prepare(`UPDATE games SET correction_pending = 0 WHERE id = ?`).bind(gameId)
  const gamesPlayedStatements = participants.map((p) => buildRecomputeGamesPlayedStatement(db, sessionId, p.session_player_id))
  const matchmakingRecomputeStatements = await recomputeMatchmakingHistoryStatements(db, sessionId)

  const result = { ok: true as const, winningTeamId, finalScoreA: game.scoreA, finalScoreB: game.scoreB, releasedSessionPlayerIds: [] as string[], requeued: false }
  const statements = [finishedEvent, projectionStatement, clearCorrectionStatement, ...statStatements, ...gamesPlayedStatements, ...matchmakingRecomputeStatements]
  if (idempotencyKey) {
    statements.push(buildRecordIdempotentResultStatement(db, { gameId, commandType: 'FINISH_GAME', key: idempotencyKey, result }))
  }
  await db.batch(statements)
  return { ...result, game: await getGame(db, sessionId, gameId) }
}
```

This branch reuses `finishedEvent`/`projectionStatement`/`statStatements` already computed earlier in the method (they're identical regardless of which path is taken — only the release/games_played/matchmaking handling differs), and reuses the recomputation-based `gamesPlayedStatements`/`recomputeMatchmakingHistoryStatements` instead of the incremental-increment version the normal first-finish path uses, per Ruling 11. `statStatements` for the re-finish path relies on `buildCreatePlayerGameStatStatement`'s target having been cleared by `reopenGame`'s `invalidateStatsStatement` already, so this INSERT does not collide with the unique `(game_id, player_id)` index.

- [ ] **Step 6: Add a tracked TODO for matchmaking's read side (Ruling 10)**

In `src/lib/pickleball/queueEngine.ts` (base plan's, from Phase 3 — read it first), locate `selectNextPlayers`'s rule-3 comment about repeat-avoidance being out of scope, and add directly beneath it:

```typescript
// TODO(Phase 5 or 7): wire matchmaking_history's repeat-avoidance tiebreak
// here once a phase actually owns this read side. matchmaking_history is
// fully populated by Phase 4's finishGame (both PARTNER and OPPONENT
// relations, both directions) -- only the read/tiebreak logic is missing.
```

Do not implement the actual tiebreak — this is a locatable marker only, per Ruling 10.

- [ ] **Step 7: Verify**

Run `npx tsc --noEmit -p tsconfig.json` — clean.

- [ ] **Step 8: Commit**

```bash
git add src/worker/repositories/pickleball/sessionPlayers.js src/worker/repositories/pickleball/matchmakingHistory.js src/worker/pickleball/SessionCoordinatorDO.ts src/lib/pickleball/queueEngine.ts
git commit -m "feat: add Pickleball reopenGame/correctGame with a correction-only lifecycle"
```

---

### Task 8: API routes for finish/abandon/reopen/correct

**Files:**
- Create: `src/pages/api/pickleball/sessions/[id]/games/[gameId]/finish.ts`
- Create: `src/pages/api/pickleball/sessions/[id]/games/[gameId]/abandon.ts`
- Create: `src/pages/api/pickleball/sessions/[id]/games/[gameId]/reopen.ts`
- Create: `src/pages/api/pickleball/sessions/[id]/games/[gameId]/correct.ts`
- Modify: `src/lib/schemas/pickleball/games.ts` (confirm `finishGameSchema`/`correctGameSchema` already match — they do, from the base plan's Task 11; no change needed unless verification finds a mismatch)

**Interfaces:**
- Consumes: `hasSessionOperatorGrant` (base plan Task 5), the DO methods from Tasks 6-7 of this plan, `finishGameSchema`/`correctGameSchema` (base plan Task 11, unchanged).
- Produces: the finish/abandon/reopen/correct API surface — consumed by Task 10's e2e suite.

Every route follows the exact shape already established by `src/pages/api/pickleball/sessions/[id]/games/[gameId]/rally.ts` and `.../undo.ts` (base plan Task 13, already built and reviewed clean for `rally.ts`/`undo.ts`'s siblings): auth → drain body → `getSession` 404 → permission check (+ SCOREKEEPER grant check for `SCORE_GAME`/`FINISH_GAME`-gated routes) → Zod validate (where there's a body) → `getGame(db, sessionId, gameId)` 404 (ownership) → invoke the DO → map `{ok:false}` to 409.

- [ ] **Step 1: `finish.ts`**

```typescript
import type { APIRoute } from 'astro'
import { requirePickleballSession } from '../../../../../../../worker/pickleball/authContext.js'
import { can } from '../../../../../../../lib/pickleball/permissions'
import { getSession } from '../../../../../../../worker/repositories/pickleball/sessions.js'
import { getGame } from '../../../../../../../worker/repositories/pickleball/games.js'
import { hasSessionOperatorGrant } from '../../../../../../../worker/repositories/pickleball/sessionOperatorGrants.js'
import { finishGameSchema } from '../../../../../../../lib/schemas/pickleball/games'
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

    if (!can(session.role, 'FINISH_GAME')) return jsonResponse({ error: 'Forbidden.' }, 403)
    if (session.role === 'SCOREKEEPER' && !(await hasSessionOperatorGrant(env.PICKLEBALL_DB, sessionId, session.userId))) {
      return jsonResponse({ error: 'Forbidden.' }, 403)
    }

    const result = finishGameSchema.safeParse(body)
    if (!result.success) return jsonResponse({ error: 'Validation failed.', issues: result.error.issues }, 400)

    const gameId = params.gameId as string
    const game = await getGame(env.PICKLEBALL_DB, sessionId, gameId)
    if (!game) return jsonResponse({ error: 'Game not found in this session.' }, 404)

    const stub = env.SESSION_COORDINATOR.get(env.SESSION_COORDINATOR.idFromName(sessionId))
    const outcome = await stub.finishGame(sessionId, gameId, session.userId, result.data.idempotencyKey)

    if (!outcome.ok) return jsonResponse({ error: outcome.error }, 409)
    return jsonResponse(outcome, 200)
  } catch (error: any) {
    return jsonResponse({ error: error.message }, error.status || 500)
  }
}
```

- [ ] **Step 2: `abandon.ts`**

Same shape as `finish.ts`, but no meaningful body (drain, don't Zod-parse — matching `undo.ts`'s established pattern), permission `FINISH_GAME` (this plan's ruling, same tier as the base plan's original ruling: abandoning is a way of ending a game), calls `stub.abandonGame(sessionId, gameId, session.userId)`.

- [ ] **Step 3: `reopen.ts`**

Same no-body shape, permission `REOPEN_GAME` (ADMIN/FACILITATOR only — no SCOREKEEPER grant branch at all, since SCOREKEEPER never holds this permission), calls `stub.reopenGame(sessionId, gameId, session.userId)`.

- [ ] **Step 4: `correct.ts`**

Same shape as `finish.ts` (has a body), permission `CORRECT_GAME` (ADMIN/FACILITATOR only, no grant branch), `correctGameSchema`, calls `stub.correctGame(sessionId, gameId, session.userId, { scoreA: result.data.scoreA, scoreB: result.data.scoreB, servingTeam: result.data.servingTeam, serverNumber: result.data.serverNumber })`.

- [ ] **Step 5: Verify**

Run `npx tsc --noEmit -p tsconfig.json` — clean.

- [ ] **Step 6: Commit**

```bash
git add src/pages/api/pickleball/sessions/[id]/games/[gameId]/finish.ts src/pages/api/pickleball/sessions/[id]/games/[gameId]/abandon.ts src/pages/api/pickleball/sessions/[id]/games/[gameId]/reopen.ts src/pages/api/pickleball/sessions/[id]/games/[gameId]/correct.ts
git commit -m "feat: add Pickleball finish/abandon/reopen/correct API routes"
```

---

### Task 9: Ownership/session-scoping self-audit

**Files:** none created — verification-only, mirroring the base plan's Task 14.

- [ ] **Step 1: Audit every route from Task 8, plus Task 4's `start.ts` update**

For each of the 5 route files, confirm every client-supplied FK (`gameId` in the URL, `teamAStartingServerSessionPlayerId`/`teamBStartingServerSessionPlayerId` in `start.ts`'s body) is checked against the target session/team before being passed to the DO. Confirm `startGame`'s membership-resolution logic (Task 4, Step 3) genuinely rejects an id that doesn't belong to either court-bound team, and that `correctGame`'s numeric inputs can't produce a state that breaks `isValidFinalScore`/`officialScoreCall` (Zod's `.int().min(0)` already exists on `correctGameSchema` from the base plan — confirm it's still adequate given the new terminal-score rule, or note what additional guard should exist).

- [ ] **Step 2: Fix anything found, or report empty diff**

```bash
git add -A
git commit -m "fix: close missed session-scoping gaps in Pickleball hardening routes"
```
Skip the commit if nothing was found.

---

### Task 10: Playwright e2e coverage for the hardening pass

**Files:**
- Create: `tests/e2e/pickleball/pickleball-games.spec.js` (this is the base plan's Task 15, never built — this task builds it with the hardening requirements included from the start, not retrofitted)

**Interfaces:**
- Consumes: every route from the base plan's Task 13 (`start`, `rally`, `undo`) and this plan's Task 8 (`finish`, `abandon`, `reopen`, `correct`); reuse `pickleball-queue.spec.js`'s established setup helpers (session → `LIVE` → checked-in/queued players → `assignCourt`) rather than duplicating them uninspected.

- [ ] **Step 1: Write the spec**

Read `tests/e2e/pickleball/pickleball-queue.spec.js` in full first for the established setup pattern. Cover at minimum:

- **Happy path with explicit serving assignment**: assign a court → `POST .../games/start` with an explicit `servingTeam`/starting-server ids (NOT hardcoded to team A — pick team B in this test specifically, to prove the hardcode is really gone) → confirm the response's `game.servingTeam` matches what was requested, not always `'A'` → record rallies to a legally-reachable final score → `finish` → confirm `player_game_stats`/`matchmaking_history` (both directions)/`games_played` (+1, not +2) exactly as the base plan's original happy-path test already checked.
- **Terminal-score rejection**: record rallies until the score is a valid final (e.g. `11-9` for an 11/2 ruleset) → confirm a further `rally` call returns 409 with a message indicating the game already has a final score → confirm `finish` still succeeds from that same state.
- **Unreachable final-score rejection**: manufacture a state that would have been `12-9` under the old lenient rule is naturally unreachable through real rallies now (the terminal guard prevents ever reaching it) — instead, directly test `correctGame` rejecting an attempt to `finish` after correcting to an unreachable score like `12-9` (reopen a finished game, correct to `12-9`, attempt finish, expect 409).
- **Undo across a correction**: finish a game, reopen it, correct to `8-6`, record one rally (`9-6`), undo → confirm the state returns to `8-6`, not some state derived by ignoring the correction.
- **Idempotency, non-caching of failures**: attempt `finish` at a non-final score with an idempotency key (expect 409), then continue play to a real final score, retry `finish` with the SAME key (expect 200, not still poisoned by the earlier failure).
- **Idempotency, command-scoping**: use the SAME idempotency key value for both a `rally` call and a `finish` call on the same game — confirm they don't collide (both succeed independently).
- **Atomic finish+release**: finish a game, confirm in ONE check that court is `AVAILABLE`, game is `FINISHED`, and queue state is consistent — no intermediate-state assertions needed since atomicity means there's nothing to observe in between.
- **Abandon**: start a game, abandon it, confirm `ABANDONED`, court released, zero `player_game_stats`/`matchmaking_history` rows, `games_played` unchanged.
- **Correction-only lifecycle**: after `reopenGame`, confirm an ordinary `rally` call on that game returns 409 (correction-pending blocks it), confirm `correctGame` + re-`finish` succeeds, confirm the court (already reassigned to a NEW game by this point, if your test setup does that) is untouched by the reopen/re-finish.
- **Serving-player derivation**: after `start` with explicit starting servers, call `rally` enough times to force a `SERVE_CHANGED` and then a `SIDE_OUT`, and confirm (via whatever the `rally` response's `servingPlayerId` field reports, per Task 5's `recordRally` response shape) that the currently-serving player identity rotates correctly through both transitions.

- [ ] **Step 2: Run the suite**

```bash
npx astro build
npx playwright test --project=worker tests/e2e/pickleball/pickleball-games.spec.js
npx playwright test --project=worker tests/e2e/pickleball/pickleball-queue.spec.js
```
Expected: all pass. Re-running the queue suite confirms Task 4-6's changes to `SessionCoordinatorDO.ts` didn't regress Phase 3's own court-assignment/concurrency guarantees. **Verify no stray `wrangler`/`workerd`/`esbuild` process remains before finishing.**

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/pickleball/pickleball-games.spec.js
git commit -m "test: add Pickleball hardening e2e coverage (terminal-score, undo-after-correction, idempotency, correction lifecycle)"
```

# Devlab Pickleball Phase 5 — Performance/OPI Backend Implementation Plan

> **Superseded (2026-10-12).** This describes the logged-in operator app, retired in 2.0.0 by Phase 5 of `docs/superpowers/specs/2026-10-11-pickleball-free-open-play-design.md`. Kept as history: the routes, tables and files it names no longer exist.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the OPI aggregation engine (session + all-time snapshots), wire it into game finalization and correction/reopen, and replace the two placeholder algorithms Phases 3-4 deliberately left as marked seams: Open Play's midpoint-split team pairing (`balanceTeams`) and queue selection's missing repeat-avoidance tiebreak.

**Architecture:** A new `player_performance_snapshots` table, recomputed wholesale from `player_game_stats` (never incrementally patched) using the same delete-then-insert-from-aggregate SQL pattern `matchmaking_history` already established — this is what lets game correction/reopen "never apply corrected statistics on top of the old statistics" (spec §7.3) for free, since there are no old statistics left once the delete runs in the same batch. Two new pure functions (`opi`, `balanceTeams`) live beside their existing counterparts (`gamePerformance`, `selectNextPlayers`) per the codebase's single-source-of-truth convention. Two new read-only API routes surface the aggregated data — no UI in this plan (that ships in the next plan, alongside the rest of Phase 6).

**Tech Stack:** D1 (SQLite), Astro API routes, the existing `SessionCoordinatorDO` command-batch pattern, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-24-devlab-pickleball-design.md`

## Global Constraints

- The OPI formula is implemented exactly once, in `src/lib/pickleball/opi.ts` — every consumer (snapshot recompute SQL, any future report) reads its output, never reimplements the math (spec §38/§8).
- `player_performance_snapshots` is fully rebuildable from `player_game_stats` (itself rebuildable from `score_events`) — this plan's recompute function is that rebuild path, not a one-time migration script.
- Never apply corrected statistics on top of old statistics (spec §7.3) — every snapshot write in this plan is delete-then-insert-from-current-aggregate, never an increment/decrement.
- `balanceTeams` and the repeat-avoidance tiebreak are pure functions with no D1/DO access, matching `gamePerformance`/`selectNextPlayers`'s existing testability convention. The impure caller (`SessionCoordinatorDO.assignCourt`) is responsible for fetching whatever data a pure function needs and passing it in as plain arguments.
- **Ruling (disclosed deviation from the spec's literal column description):** spec §4.8 describes `player_performance_snapshots.scope_id` as "session_id or NULL for all-time." This plan uses the literal string `'ALL_TIME'` as the all-time sentinel instead of `NULL` — SQLite's `UNIQUE` index treats every `NULL` as distinct from every other `NULL`, so a `NULL` `scope_id` could never actually enforce "at most one all-time row per player," defeating the point of the unique index. A session id is a UUID and can never collide with the literal string `'ALL_TIME'`, so the sentinel is unambiguous and the index works as intended.
- **Ruling (scope, already disclosed to the user before this plan was written):** this plan does NOT build `pair_stats` or any `FIXED_PAIRS` session-type support (persistent pair-team creation, court assignment for that session type). No code anywhere creates a `kind='FIXED_PAIR'` team, and `assignCourt` hard-refuses any non-`OPEN_PLAY` session (`SessionCoordinatorDO.ts:313-315`) — building real Fixed Pairs support is a full session-type feature on par with Open Play itself, not a stats-layer addition, and is out of scope for this pass.
- `--local` only for all local dev/testing in this plan. No placeholder routes.

---

### Task 1: `opi()` aggregation and confidence tiers

**Files:**
- Modify: `src/lib/pickleball/opi.ts`
- Modify: `src/lib/pickleball/opi.test.ts`

**Interfaces:**
- Consumes: nothing new (extends the existing `gamePerformance` file).
- Produces: `opi(gamePerformances: number[]): number` — mean of the array, full precision, no rounding. `confidenceTier(eligibleGamesCount: number): 'PROVISIONAL' | 'DEVELOPING' | 'ESTABLISHED'` — `0-2` → `PROVISIONAL`, `3-9` → `DEVELOPING`, `10+` → `ESTABLISHED` (spec §8's default thresholds). Both are consumed by Task 3's snapshot repository and (in the next plan) the leaderboard/profile UI.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/pickleball/opi.test.ts` (keep the existing `gamePerformance` describe block and `round6` helper untouched):

```ts
import { describe, it, expect } from 'vitest'
import { gamePerformance, opi, confidenceTier } from './opi'

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6
}

describe('opi', () => {
  it('is the mean of the given game performances, matching the canonical three-game example', () => {
    const values = [gamePerformance(11, 7), gamePerformance(9, 11), gamePerformance(11, 5)]
    expect(round6(opi(values))).toBe(round6(58.287037037037045))
    expect(opi(values).toFixed(2)).toBe('58.29')
  })

  it('a single game is its own OPI', () => {
    expect(round6(opi([gamePerformance(11, 5)]))).toBe(round6(68.75))
  })
})

describe('confidenceTier', () => {
  it('0-2 eligible games -> PROVISIONAL', () => {
    expect(confidenceTier(0)).toBe('PROVISIONAL')
    expect(confidenceTier(2)).toBe('PROVISIONAL')
  })

  it('3-9 eligible games -> DEVELOPING', () => {
    expect(confidenceTier(3)).toBe('DEVELOPING')
    expect(confidenceTier(9)).toBe('DEVELOPING')
  })

  it('10+ eligible games -> ESTABLISHED', () => {
    expect(confidenceTier(10)).toBe('ESTABLISHED')
    expect(confidenceTier(50)).toBe('ESTABLISHED')
  })
})
```

(The file's top already has `describe('gamePerformance', ...)` from Phase 4 — leave it as-is; these two new `describe` blocks are appended after it. Remove the duplicate `import`/`round6` lines this snippet shows if the file already has them at the top — keep exactly one copy of each.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/pickleball/opi.test.ts`
Expected: FAIL — `opi` and `confidenceTier` are not exported.

- [ ] **Step 3: Implement**

Replace the full content of `src/lib/pickleball/opi.ts`:

```ts
// PHASE 5 SEAM (now filled): gamePerformance is the per-game formula Phase 4
// uses to populate player_game_stats.game_performance. opi() is the
// mean-aggregation function and confidenceTier() the display-tier function --
// both live in this SAME file per spec §38's single-source-of-truth
// requirement; do not reimplement either elsewhere.
export function gamePerformance(pointsFor: number, pointsAgainst: number): number {
  return (pointsFor / (pointsFor + pointsAgainst)) * 100
}

export function opi(gamePerformances: number[]): number {
  return gamePerformances.reduce((sum, value) => sum + value, 0) / gamePerformances.length
}

export type ConfidenceTier = 'PROVISIONAL' | 'DEVELOPING' | 'ESTABLISHED'

export function confidenceTier(eligibleGamesCount: number): ConfidenceTier {
  if (eligibleGamesCount >= 10) return 'ESTABLISHED'
  if (eligibleGamesCount >= 3) return 'DEVELOPING'
  return 'PROVISIONAL'
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/pickleball/opi.test.ts`
Expected: PASS (all `gamePerformance`, `opi`, `confidenceTier` tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/pickleball/opi.ts src/lib/pickleball/opi.test.ts
git commit -m "feat: add OPI aggregation and confidence-tier functions"
```

---

### Task 2: `player_performance_snapshots` migration

**Files:**
- Create: `migrations/pickleball/0009_performance_snapshots.sql`

**Interfaces:**
- Produces: table `player_performance_snapshots(id, player_id, scope_type, scope_id, opi_version, eligible_games_count, performance_sum, opi, updated_at)`, unique on `(player_id, scope_type, scope_id)`. Consumed by Task 3's repository.

- [ ] **Step 1: Write the migration**

```sql
-- Phase 5: aggregated OPI snapshots, fully rebuildable from
-- player_game_stats (see src/worker/repositories/pickleball/
-- playerPerformanceSnapshots.js's recompute function). Two rows per player
-- who has at least one eligible finished game: one ALL_TIME row (scope_id =
-- the literal 'ALL_TIME', not NULL -- see this plan's Ruling on why NULL
-- can't enforce uniqueness here) and one SESSION row per session they've
-- played an eligible game in (scope_id = that session's id).

CREATE TABLE IF NOT EXISTS player_performance_snapshots (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('SESSION', 'ALL_TIME')),
  scope_id TEXT NOT NULL,
  opi_version TEXT NOT NULL DEFAULT 'OPI_V1_SCORE_SHARE',
  eligible_games_count INTEGER NOT NULL,
  performance_sum REAL NOT NULL,
  opi REAL NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_player_performance_snapshots_player_scope
  ON player_performance_snapshots(player_id, scope_type, scope_id);

CREATE INDEX IF NOT EXISTS idx_player_performance_snapshots_scope_opi
  ON player_performance_snapshots(scope_type, scope_id, opi DESC);
```

- [ ] **Step 2: Apply locally and verify**

Run: `npx wrangler d1 migrations apply devlab-pickleball --local`
Expected: `0009_performance_snapshots.sql` applies cleanly, listed with a ✅ alongside `0001`-`0008`.

- [ ] **Step 3: Commit**

```bash
git add migrations/pickleball/0009_performance_snapshots.sql
git commit -m "feat: add the player_performance_snapshots table"
```

---

### Task 3: `playerPerformanceSnapshots.js` repository — recompute + reads

**Files:**
- Create: `src/worker/repositories/pickleball/playerPerformanceSnapshots.js`
- Test: `src/worker/repositories/pickleball/playerPerformanceSnapshots.test.js`

**Interfaces:**
- Consumes: `player_performance_snapshots` table (Task 2), `player_game_stats`/`games` tables (existing).
- Produces: `buildRecomputePlayerSnapshotsStatements(db, playerIds, sessionId)` → unexecuted `D1PreparedStatement[]`, for the caller to fold into its own `db.batch()` (Task 4 is that caller). `getPlayerSnapshot(db, playerId, scopeType, scopeId)` → snapshot object or `null`. `listLeaderboard(db, organizationId, scopeType, scopeId, minGames)` → array of snapshot objects joined with `display_name`, ordered by `opi DESC, display_name ASC`.

This task's test runs against a real local D1 binding (matching this repo's existing convention for repository-layer tests — check `src/worker/repositories/pickleball/` for an existing `.test.js` file if one exists to mirror its exact test-runner setup; if none exists at this layer, write the test using `vitest`'s standard D1-via-`wrangler dev`-adjacent pattern this repo already uses elsewhere for worker-layer code, OR treat this as covered by Task 4's integration test instead and skip a standalone unit test file here — use your judgment on which the codebase's existing convention supports, and report which you chose in your task report).

- [ ] **Step 1: Implement the repository**

```js
import { nowIso } from '../../utils/responses.js'

const ALL_TIME_SCOPE_ID = 'ALL_TIME'

function toSnapshot(row) {
  return {
    id: row.id,
    playerId: row.player_id,
    displayName: row.display_name ?? null,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    opiVersion: row.opi_version,
    eligibleGamesCount: row.eligible_games_count,
    performanceSum: row.performance_sum,
    opi: row.opi,
    updatedAt: row.updated_at,
  }
}

// PHASE 5 SEAM (now filled): mirrors matchmakingHistory.js's
// recomputeMatchmakingHistoryStatements pattern exactly, including its
// ordering requirement -- the caller MUST place these statements AFTER
// whatever player_game_stats-changing statements are earlier in the SAME
// db.batch() call, so D1 evaluates each aggregate at batch-execution time
// against the just-applied state, not the pre-batch state. Delete-then-
// insert-from-aggregate (never an incremental +/-) is what makes this safe
// against BOTH directions of invalidation -- reopenGame's delete of
// player_game_stats rows, and finishGame's re-finish insert of new ones --
// without ever "applying corrected statistics on top of the old statistics"
// (spec §7.3): there are no old statistics left to layer onto once the
// delete has run earlier in the same batch. `HAVING COUNT(*) > 0` means a
// player left with zero eligible games after an invalidation simply gets no
// row at all, rather than a bogus zero-division snapshot.
export function buildRecomputePlayerSnapshotsStatements(db, playerIds, sessionId) {
  if (!playerIds.length) return []
  const timestamp = nowIso()
  const statements = []

  for (const playerId of playerIds) {
    statements.push(
      db.prepare(`DELETE FROM player_performance_snapshots WHERE player_id = ? AND scope_type = 'ALL_TIME'`).bind(playerId),
    )
    statements.push(
      db
        .prepare(
          `INSERT INTO player_performance_snapshots
             (id, player_id, scope_type, scope_id, opi_version, eligible_games_count, performance_sum, opi, updated_at)
           SELECT lower(hex(randomblob(16))), ?, 'ALL_TIME', ?, 'OPI_V1_SCORE_SHARE', COUNT(*), SUM(game_performance), SUM(game_performance) / COUNT(*), ?
           FROM player_game_stats
           WHERE player_id = ? AND eligible_for_opi = 1
           HAVING COUNT(*) > 0`,
        )
        .bind(playerId, ALL_TIME_SCOPE_ID, timestamp, playerId),
    )

    statements.push(
      db
        .prepare(`DELETE FROM player_performance_snapshots WHERE player_id = ? AND scope_type = 'SESSION' AND scope_id = ?`)
        .bind(playerId, sessionId),
    )
    statements.push(
      db
        .prepare(
          `INSERT INTO player_performance_snapshots
             (id, player_id, scope_type, scope_id, opi_version, eligible_games_count, performance_sum, opi, updated_at)
           SELECT lower(hex(randomblob(16))), ?, 'SESSION', ?, 'OPI_V1_SCORE_SHARE', COUNT(*), SUM(pgs.game_performance), SUM(pgs.game_performance) / COUNT(*), ?
           FROM player_game_stats pgs
           JOIN games g ON g.id = pgs.game_id
           WHERE pgs.player_id = ? AND pgs.eligible_for_opi = 1 AND g.session_id = ?
           HAVING COUNT(*) > 0`,
        )
        .bind(playerId, sessionId, timestamp, playerId, sessionId),
    )
  }

  return statements
}

export async function getPlayerSnapshot(db, playerId, scopeType, scopeId) {
  const resolvedScopeId = scopeType === 'ALL_TIME' ? ALL_TIME_SCOPE_ID : scopeId
  const row = await db
    .prepare(`SELECT * FROM player_performance_snapshots WHERE player_id = ? AND scope_type = ? AND scope_id = ?`)
    .bind(playerId, scopeType, resolvedScopeId)
    .first()
  return row ? toSnapshot(row) : null
}

export async function listLeaderboard(db, organizationId, scopeType, scopeId, minGames) {
  const resolvedScopeId = scopeType === 'ALL_TIME' ? ALL_TIME_SCOPE_ID : scopeId
  const result = await db
    .prepare(
      `SELECT s.*, p.display_name
       FROM player_performance_snapshots s
       JOIN players p ON p.id = s.player_id
       WHERE p.organization_id = ? AND s.scope_type = ? AND s.scope_id = ? AND s.eligible_games_count >= ?
       ORDER BY s.opi DESC, p.display_name ASC`,
    )
    .bind(organizationId, scopeType, resolvedScopeId, minGames)
    .all()
  return (result.results || []).map(toSnapshot)
}
```

- [ ] **Step 2: Write and run a real integration test against local D1**

Check whether any file under `src/worker/repositories/pickleball/` already has a `.test.js` sibling running against a real D1 binding (e.g. via a `getMiniflareBindings()`-style helper or similar). If one exists, mirror its exact setup in `playerPerformanceSnapshots.test.js`, seeding a player, a session, a few `games`/`player_game_stats` rows directly via SQL, then asserting `buildRecomputePlayerSnapshotsStatements` + `db.batch(...)` produces the correct aggregate, and that `getPlayerSnapshot`/`listLeaderboard` read it back correctly (including that a player with zero eligible games has no snapshot row via `HAVING COUNT(*) > 0`). If no such repository-layer D1 test convention exists in this codebase, do not invent one from scratch — instead skip this step, note in your report that this function is covered by Task 4's integration test against the real DO instead, and proceed.

- [ ] **Step 3: Commit**

```bash
git add src/worker/repositories/pickleball/playerPerformanceSnapshots.js
git commit -m "feat: add the player performance snapshots repository"
```

(Include the test file in this commit too, if Step 2 produced one.)

---

### Task 4: Wire snapshot recompute into `finishGame` and `reopenGame`

**Files:**
- Modify: `src/worker/pickleball/SessionCoordinatorDO.ts`
- Test: `tests/e2e/pickleball/pickleball-games.spec.js`

**Interfaces:**
- Consumes: `buildRecomputePlayerSnapshotsStatements(db, playerIds, sessionId)` (Task 3), `getPlayerSnapshot` (Task 3, for the e2e assertion).
- Produces: every `finishGame` call (both the normal path and the `correctionPending` re-finish path) and every `reopenGame` call now keeps `player_performance_snapshots` in sync with `player_game_stats` inside the SAME `db.batch()` as the write/delete that changed it. No new public interface — this closes the "PHASE 5 SEAM" comment already left in `playerGameStats.js`.

- [ ] **Step 1: Read the exact current `finishGame` and `reopenGame` bodies**

Read `src/worker/pickleball/SessionCoordinatorDO.ts` in full before editing — this task's diff must compose correctly with the exact statement arrays and `participants`/`statStatements` variables already there (around `finishGame`'s lines 878-1010+ and `reopenGame`'s lines further down). Do not guess at surrounding code; the snippets below show the NEW lines to add and exactly where, but you must locate the real insertion points in the file as it exists today.

- [ ] **Step 2: Add the import**

Near the top of `SessionCoordinatorDO.ts`, alongside the existing `playerGameStats.js` import:

```ts
import { buildRecomputePlayerSnapshotsStatements } from '../repositories/pickleball/playerPerformanceSnapshots.js'
```

- [ ] **Step 3: Wire it into `finishGame`'s batch (both the normal path and the correctionPending re-finish path)**

`finishGame` already computes `participants` (each `{session_player_id, team_id, player_id}`) and `statStatements` (one `buildCreatePlayerGameStatStatement` per participant) BEFORE branching on `game.correctionPending` — both paths below that branch point share `statStatements`. Add ONE line deriving the affected player ids, right after `statStatements` is built:

```ts
const affectedPlayerIds = participants.map((p) => p.player_id)
```

Then, in EACH of the two branches (`if (game.correctionPending) { ... }` and its `else` counterpart) where that branch assembles its own final `db.batch([...])` array, append `...buildRecomputePlayerSnapshotsStatements(db, affectedPlayerIds, sessionId)` as the LAST entries in that array (after `statStatements` and after the correctionPending branch's own `gamesPlayedStatements`/`matchmakingRecomputeStatements`, since the snapshot recompute must read `player_game_stats` rows that `statStatements` just inserted in the SAME batch, and D1 only guarantees that ordering-dependent read-your-own-writes-within-a-batch semantic when the read is a LATER statement than the write). Concretely, wherever you find the batch array being built in each branch (e.g. `const statements = [...finishedEvent, projectionStatement, ...statStatements, ...gamesPlayedStatements, ...matchmakingRecomputeStatements]` or the normal path's equivalent), add `...buildRecomputePlayerSnapshotsStatements(db, affectedPlayerIds, sessionId)` as the final spread entry in both.

- [ ] **Step 4: Wire it into `reopenGame`**

`reopenGame` calls `buildDeletePlayerGameStatsForGameStatement(gameId)` as part of its own batch (this is the "PHASE 5 SEAM" call site `playerGameStats.js`'s comment points at). Before that call's batch executes, fetch the affected player ids the same way `finishGame` does:

```ts
const participantsResult = await db
  .prepare(
    `SELECT sp.player_id
     FROM game_participants gp JOIN session_players sp ON sp.id = gp.session_player_id
     WHERE gp.game_id = ?`,
  )
  .bind(gameId)
  .all<{ player_id: string }>()
const affectedPlayerIds = (participantsResult.results || []).map((p) => p.player_id)
```

Then append `...buildRecomputePlayerSnapshotsStatements(db, affectedPlayerIds, sessionId)` as the final entries of `reopenGame`'s own `db.batch([...])` array — AFTER the `buildDeletePlayerGameStatsForGameStatement` statement in that same array, so the recompute's `HAVING COUNT(*) > 0` correctly sees the post-delete world and produces no snapshot row for a player whose only eligible game was just invalidated.

- [ ] **Step 5: Write a real e2e test proving the full correction cycle**

Append to `tests/e2e/pickleball/pickleball-games.spec.js` (read the file first to match its existing setup conventions — venue/court/session/players/queue/assign/start-game via `request.post`, exactly like the other tests in that file):

```js
test('finishing a game creates a snapshot, reopening it removes the snapshot contribution, and re-finishing restores it', async ({ request }) => {
  // ... reuse this file's existing setup pattern: venue, court, session (status LIVE),
  // 4 players registered/checked-in/queued, court assigned, game started with servingTeam 'A'.
  // (Copy the exact setup block from an existing test in this same file rather than
  // inventing a new one -- match its request/data shapes exactly.)

  const gameId = /* from the start-game response, per this file's existing pattern */ null
  const sessionId = /* from setup */ null
  const teamAPlayerIds = /* the two player ids on team A, from the teams-lookup response used during setup */ []

  for (let i = 0; i < 11; i += 1) {
    await request.post(`/api/pickleball/sessions/${sessionId}/games/${gameId}/rally`, { data: { winningTeam: 'A' } })
  }
  const finishResponse = await request.post(`/api/pickleball/sessions/${sessionId}/games/${gameId}/finish`, { data: {} })
  expect(finishResponse.ok()).toBe(true)

  const beforeReopen = await request.get(`/api/pickleball/players/${teamAPlayerIds[0]}/stats`)
  expect((await beforeReopen.json()).allTime.eligibleGamesCount).toBe(1)

  await request.post(`/api/pickleball/sessions/${sessionId}/games/${gameId}/reopen`, { data: {} })
  const afterReopen = await request.get(`/api/pickleball/players/${teamAPlayerIds[0]}/stats`)
  const afterReopenBody = await afterReopen.json()
  expect(afterReopenBody.allTime).toBeNull()

  await request.post(`/api/pickleball/sessions/${sessionId}/games/${gameId}/correct`, {
    data: { scoreA: 11, scoreB: 3, servingTeam: 'A', serverNumber: 2 },
  })
  const refinishResponse = await request.post(`/api/pickleball/sessions/${sessionId}/games/${gameId}/finish`, { data: {} })
  expect(refinishResponse.ok()).toBe(true)

  const afterRefinish = await request.get(`/api/pickleball/players/${teamAPlayerIds[0]}/stats`)
  const afterRefinishBody = await afterRefinish.json()
  expect(afterRefinishBody.allTime.eligibleGamesCount).toBe(1)
  expect(afterRefinishBody.allTime.opi).toBeCloseTo((11 / 14) * 100, 5)
})
```

This test calls `GET /api/pickleball/players/:id/stats`, which is built in Task 7 of this same plan — if Task 7 hasn't been dispatched yet when this task runs, write the test exactly as shown (it documents the exact contract Task 7 must satisfy) but mark it `test.skip(...)` with a one-line comment `// enabled once Task 7's GET /api/pickleball/players/:id/stats route exists`, and note this clearly in your report. Whichever task lands second between this one and Task 7 should un-skip it as part of that task's own test-passing step.

- [ ] **Step 6: Run the unit + targeted e2e tests**

Run: `npx vitest run`
Expected: 165+ passing (no regressions).

Run: `npx playwright test tests/e2e/pickleball/pickleball-games.spec.js --project=worker -g "finishing a game creates a snapshot"`
Expected: PASS (or a clearly-reported SKIP if Task 7 hasn't landed yet, per Step 5's note).

- [ ] **Step 7: Commit**

```bash
git add src/worker/pickleball/SessionCoordinatorDO.ts tests/e2e/pickleball/pickleball-games.spec.js
git commit -m "feat: recompute player performance snapshots on finish, reopen, and re-finish"
```

---

### Task 5: `balanceTeams` — replace the placeholder Open Play pairing

**Files:**
- Modify: `src/lib/pickleball/queueEngine.ts`
- Modify: `src/lib/pickleball/queueEngine.test.ts`
- Modify: `src/worker/pickleball/SessionCoordinatorDO.ts`
- Test: `tests/e2e/pickleball/pickleball-games.spec.js`

**Interfaces:**
- Consumes: nothing new for the pure function itself.
- Produces: `balanceTeams(candidates: {sessionPlayerId: string; opi: number}[]): {teamA: {sessionPlayerId: string; opi: number}[]; teamB: {...}[]}` — minimizes the OPI-sum difference between the two sides. `assignCourt` now calls this instead of the midpoint split, after fetching each selected candidate's current all-time OPI (defaulting to a neutral `50` when no snapshot exists yet, e.g. a brand-new player).

- [ ] **Step 1: Write the failing unit tests**

Append to `src/lib/pickleball/queueEngine.test.ts` (keep the existing `selectNextPlayers` tests untouched):

```ts
import { balanceTeams } from './queueEngine'

describe('balanceTeams', () => {
  it('singles: splits the two candidates one per side', () => {
    const result = balanceTeams([
      { sessionPlayerId: 'p1', opi: 80 },
      { sessionPlayerId: 'p2', opi: 40 },
    ])
    expect(result.teamA.map((p) => p.sessionPlayerId)).toEqual(['p1'])
    expect(result.teamB.map((p) => p.sessionPlayerId)).toEqual(['p2'])
  })

  it('doubles: picks the partition that minimizes the OPI-sum difference', () => {
    // Candidates at 90, 80, 20, 10. The midpoint-split placeholder would pair
    // (90,80) vs (20,10) -- sums 170 vs 30, a huge imbalance. The balanced
    // partition pairs (90,10) vs (80,20) -- sums 100 vs 100, a perfect match.
    const result = balanceTeams([
      { sessionPlayerId: 'a', opi: 90 },
      { sessionPlayerId: 'b', opi: 80 },
      { sessionPlayerId: 'c', opi: 20 },
      { sessionPlayerId: 'd', opi: 10 },
    ])
    const teamAIds = result.teamA.map((p) => p.sessionPlayerId).sort()
    const teamBIds = result.teamB.map((p) => p.sessionPlayerId).sort()
    const sumA = result.teamA.reduce((sum, p) => sum + p.opi, 0)
    const sumB = result.teamB.reduce((sum, p) => sum + p.opi, 0)
    expect(Math.abs(sumA - sumB)).toBe(0)
    expect([teamAIds, teamBIds].flat().sort()).toEqual(['a', 'b', 'c', 'd'])
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/pickleball/queueEngine.test.ts`
Expected: FAIL — `balanceTeams` is not exported.

- [ ] **Step 3: Implement `balanceTeams` in `queueEngine.ts`**

Append to `src/lib/pickleball/queueEngine.ts` (do not modify `selectNextPlayers` in this task — that's Task 6):

```ts
export interface OpiCandidate {
  sessionPlayerId: string
  opi: number
}

// PHASE 5 SEAM (now filled): replaces assignCourt's placeholder midpoint
// split (SessionCoordinatorDO.ts, marked "PHASE 5 SEAM -- placeholder
// pairing, NOT a finished feature"). `candidates.length` is always exactly 2
// (singles) or 4 (doubles) -- requiredPlayerCount() never returns any other
// value -- so brute-forcing every into-two-sides partition is cheap and
// exact; no combinatorial explosion risk. This is intentionally separate
// from selectNextPlayers (spec §5 point 4): fairness selection decides WHO
// plays, this decides how the selected group splits into two competitive
// sides.
export function balanceTeams(candidates: OpiCandidate[]): { teamA: OpiCandidate[]; teamB: OpiCandidate[] } {
  if (candidates.length === 2) {
    return { teamA: [candidates[0]], teamB: [candidates[1]] }
  }

  const [a, b, c, d] = candidates
  const partitions: [OpiCandidate[], OpiCandidate[]][] = [
    [[a, b], [c, d]],
    [[a, c], [b, d]],
    [[a, d], [b, c]],
  ]

  let best = partitions[0]
  let bestDiff = Infinity
  for (const [teamA, teamB] of partitions) {
    const sumA = teamA.reduce((sum, p) => sum + p.opi, 0)
    const sumB = teamB.reduce((sum, p) => sum + p.opi, 0)
    const diff = Math.abs(sumA - sumB)
    if (diff < bestDiff) {
      bestDiff = diff
      best = [teamA, teamB]
    }
  }

  return { teamA: best[0], teamB: best[1] }
}
```

- [ ] **Step 4: Run to verify tests pass**

Run: `npx vitest run src/lib/pickleball/queueEngine.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire it into `assignCourt`, replacing the placeholder split**

In `SessionCoordinatorDO.ts`, add the import alongside the other `queueEngine.ts` imports:

```ts
import { balanceTeams } from '../../lib/pickleball/queueEngine'
```

And add the import for reading OPI, alongside the `playerPerformanceSnapshots.js` import from Task 4:

```ts
import { getPlayerSnapshot } from '../repositories/pickleball/playerPerformanceSnapshots.js'
```

Locate the exact block described by the "PHASE 5 SEAM — placeholder pairing" comment in `assignCourt` (read the file to confirm current line numbers before editing — do not assume the line numbers below are still exact after Task 4's edits). Replace:

```ts
    const half = Math.floor(selected.length / 2)
    const teamAPlayers = selected.slice(0, half)
    const teamBPlayers = selected.slice(half)
```

with:

```ts
    const candidatesWithOpi = await Promise.all(
      selected.map(async (player) => {
        const snapshot = await getPlayerSnapshot(db, player.playerId, 'ALL_TIME', null)
        return { sessionPlayerId: player.sessionPlayerId, opi: snapshot ? snapshot.opi : 50 }
      }),
    )
    const { teamA: teamASide, teamB: teamBSide } = balanceTeams(candidatesWithOpi)
    const teamAIds = new Set(teamASide.map((p) => p.sessionPlayerId))
    const teamAPlayers = selected.filter((player) => teamAIds.has(player.sessionPlayerId))
    const teamBPlayers = selected.filter((player) => !teamAIds.has(player.sessionPlayerId))
```

(This preserves the rest of the function completely unchanged — `teamAPlayers`/`teamBPlayers` still feed the exact same `buildAddTeamMemberStatement` loop that already exists below this block. `50` is a neutral middle-of-scale default for a player with no `ALL_TIME` snapshot yet, i.e. someone who has never finished an eligible game — every real value the formula can ever produce falls in `[0, 100]`, so `50` doesn't bias a brand-new player toward either side.)

- [ ] **Step 6: Write a real e2e test proving balanced pairing**

Append to `tests/e2e/pickleball/pickleball-games.spec.js`, mirroring this file's existing setup convention, but seed 4 players with DIFFERENT prior OPI values before assigning the court — the simplest deterministic way to do that against this file's existing helpers is to run one prior finished game for two of the four players (giving them a real `ALL_TIME` snapshot) before starting the actual game-under-test, then assert the resulting teams via `GET /api/pickleball/sessions/:id/courts/:courtId/teams` are split by OPI rather than by queue order. Read the file's existing tests first and match its exact setup helper calls (venue/court/session/status transitions/player creation/check-in/queue) — do not invent a different request shape. Write this test yourself, following the same structure as the snapshot-cycle test in Task 4, asserting on the actual team membership response rather than guessing at internal state.

- [ ] **Step 7: Run tests**

Run: `npx vitest run`
Run: `npx playwright test tests/e2e/pickleball/pickleball-games.spec.js --project=worker`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/lib/pickleball/queueEngine.ts src/lib/pickleball/queueEngine.test.ts src/worker/pickleball/SessionCoordinatorDO.ts tests/e2e/pickleball/pickleball-games.spec.js
git commit -m "feat: replace placeholder court pairing with OPI-balanced team assignment"
```

---

### Task 6: Repeat-avoidance tiebreak in `selectNextPlayers`

**Files:**
- Modify: `src/lib/pickleball/queueEngine.ts`
- Modify: `src/lib/pickleball/queueEngine.test.ts`
- Modify: `src/worker/pickleball/SessionCoordinatorDO.ts`
- Test: `tests/e2e/pickleball/pickleball-games.spec.js` (or `pickleball-queue.spec.js` — check which file already covers `assignCourt`'s queue-selection behavior and add there)

**Interfaces:**
- Consumes: `matchmaking_history` (existing table).
- Produces: `selectNextPlayers(candidates, count, nowIso, lastPairedWith?)` — a new optional 4th parameter, `lastPairedWith: Record<sessionPlayerId, string | null>`, mapping each candidate's `sessionPlayerId` to the `sessionPlayerId` of the one other CURRENTLY-ELIGIBLE candidate they were most recently partnered or opposed with (or `undefined`/`null` if none, or if fewer than 5 candidates are eligible — the spec's degradation threshold). Backward compatible: omitting the 4th argument keeps today's exact behavior (no callers outside `assignCourt` need to change).

- [ ] **Step 1: Write the failing unit test**

Append to `src/lib/pickleball/queueEngine.test.ts`:

```ts
describe('selectNextPlayers repeat-avoidance tiebreak', () => {
  const now = '2026-01-01T12:00:00.000Z'

  function candidate(id: string, gamesPlayed: number, queuedAt: string) {
    return { sessionPlayerId: id, playerId: id, displayName: id, gamesPlayed, queuedAt }
  }

  it('with 5+ eligible and a tie on games played, prefers the candidate NOT recently paired with an already-selected teammate', () => {
    // 5 candidates, all with 0 games played (fully tied on rule 1), all
    // queued at the same instant (fully tied on rule 2) except p5 who
    // queued slightly later -- so the naive sort alone would pick
    // p1..p4 for a 4-slot doubles selection. p1 and p2 were JUST paired
    // (matchmaking_history), so with the tiebreak active, p2 should be
    // swapped out for p5 (the next-best equally-tied candidate) instead.
    const candidates = [
      candidate('p1', 0, now),
      candidate('p2', 0, now),
      candidate('p3', 0, now),
      candidate('p4', 0, now),
      candidate('p5', 0, '2026-01-01T12:00:01.000Z'),
    ]
    const lastPairedWith = { p1: 'p2', p2: 'p1' }

    const result = selectNextPlayers(candidates, 4, now, lastPairedWith)
    const ids = result.selected.map((p) => p.sessionPlayerId)
    expect(ids).toContain('p1')
    expect(ids).not.toContain('p2')
    expect(ids).toContain('p5')
  })

  it('never overrides rule 1 (fewest games played) even to avoid a repeat', () => {
    const candidates = [
      candidate('p1', 0, now),
      candidate('p2', 0, now),
      candidate('p3', 0, now),
      candidate('p4', 1, now), // strictly more games played than p1-p3
      candidate('p5', 0, '2026-01-01T12:00:01.000Z'),
    ]
    const lastPairedWith = { p1: 'p2', p2: 'p1' }

    // Only 4 candidates have 0 games played (p1, p2, p3, p5) -- p4 must
    // never be selected over them despite avoiding a repeat, since that
    // would override rule 1.
    const result = selectNextPlayers(candidates, 4, now, lastPairedWith)
    const ids = result.selected.map((p) => p.sessionPlayerId)
    expect(ids).not.toContain('p4')
  })

  it('is skipped entirely below 5 eligible candidates (spec §56 degradation)', () => {
    const candidates = [candidate('p1', 0, now), candidate('p2', 0, now), candidate('p3', 0, now), candidate('p4', 0, now)]
    const lastPairedWith = { p1: 'p2', p2: 'p1' }
    const result = selectNextPlayers(candidates, 4, now, lastPairedWith)
    // With exactly 4 eligible and 4 needed, everyone is selected regardless
    // -- there's no room for the tiebreak to have any effect either way,
    // which is the simplest possible proof it didn't try to do anything.
    expect(result.selected.map((p) => p.sessionPlayerId).sort()).toEqual(['p1', 'p2', 'p3', 'p4'])
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/pickleball/queueEngine.test.ts`
Expected: FAIL on the first two new tests (the tiebreak doesn't exist yet; the third may already incidentally pass).

- [ ] **Step 3: Implement the tiebreak**

Replace the full content of `src/lib/pickleball/queueEngine.ts`'s `selectNextPlayers` function (keep `QueueCandidate`, `SelectionReason`, `QueueSelectionResult`, `pluralize`, and the file's other exports untouched — only this one function's body changes, plus its signature gains one new optional parameter):

```ts
export function selectNextPlayers(
  candidates: QueueCandidate[],
  count: number,
  nowIso: string,
  lastPairedWith?: Record<string, string | null | undefined>,
): QueueSelectionResult {
  const sorted = [...candidates].sort((a, b) => {
    if (a.gamesPlayed !== b.gamesPlayed) return a.gamesPlayed - b.gamesPlayed
    return Date.parse(a.queuedAt) - Date.parse(b.queuedAt)
  })

  let selected = sorted.slice(0, Math.max(0, count))

  // Repeat-avoidance tiebreak (spec §5 rule 3): only among candidates tied
  // on rule 1 (identical gamesPlayed) at the selection boundary, and only
  // once at least 5 candidates are eligible (spec §56's degradation
  // threshold -- below that there usually isn't a real alternative to swap
  // in anyway). Never touches rule 1 itself: a replacement candidate is only
  // ever drawn from the pool sharing the EXACT gamesPlayed value of the
  // selected candidate being replaced.
  if (lastPairedWith && candidates.length >= 5 && selected.length === count) {
    const selectedIds = new Set(selected.map((p) => p.sessionPlayerId))
    const repeatIndex = selected.findIndex((candidate) => {
      const pairedWith = lastPairedWith[candidate.sessionPlayerId]
      return pairedWith && selectedIds.has(pairedWith)
    })

    if (repeatIndex !== -1) {
      const repeatCandidate = selected[repeatIndex]
      const replacement = sorted.find(
        (candidate) =>
          !selectedIds.has(candidate.sessionPlayerId) &&
          candidate.gamesPlayed === repeatCandidate.gamesPlayed &&
          !(lastPairedWith[candidate.sessionPlayerId] && selectedIds.has(lastPairedWith[candidate.sessionPlayerId]!)),
      )
      if (replacement) {
        selected = selected.map((candidate, index) => (index === repeatIndex ? replacement : candidate))
      }
    }
  }

  const now = Date.parse(nowIso)

  const reasons: SelectionReason[] = selected.map((candidate) => {
    const fewerGamesThan = candidates.filter((other) => other.gamesPlayed > candidate.gamesPlayed).length
    const waitMinutes = Math.max(0, Math.round((now - Date.parse(candidate.queuedAt)) / 60000))

    const lines = [
      `Games played: ${candidate.gamesPlayed}`,
      `Queue wait: ${waitMinutes} ${pluralize(waitMinutes, 'minute', 'minutes')}`,
    ]

    if (fewerGamesThan > 0) {
      lines.push(`Fewer games than ${fewerGamesThan} other eligible ${pluralize(fewerGamesThan, 'player', 'players')}`)
    }

    return { sessionPlayerId: candidate.sessionPlayerId, reasons: lines }
  })

  return { selected, reasons }
}
```

Also update the function's own doc comment (the block currently reading `// Sorts by fewest games played first... Rule 3 -- repeat-avoidance... remains out of scope here` and the `// TODO(Phase 5 or 7)` comment below it) to remove the now-stale TODO and reflect that the tiebreak is implemented, in your own words, matching this file's existing comment voice.

- [ ] **Step 4: Run to verify tests pass**

Run: `npx vitest run src/lib/pickleball/queueEngine.test.ts`
Expected: PASS (all `selectNextPlayers` tests, old and new).

- [ ] **Step 5: Wire the caller in `assignCourt`**

In `SessionCoordinatorDO.ts`'s `assignCourt`, before the existing `selectNextPlayers(candidates, needed, nowIso)` call, fetch each candidate's most recent partner/opponent among the CURRENT candidate pool (only meaningful once `candidates.length >= 5`, matching the tiebreak's own internal guard — but it's harmless to always compute it, since the pure function no-ops below that threshold):

```ts
    const candidateSessionPlayerIds = candidates.map((c) => c.sessionPlayerId)
    const lastPairedWith: Record<string, string | null> = {}
    if (candidateSessionPlayerIds.length >= 5) {
      const placeholders = candidateSessionPlayerIds.map(() => '?').join(',')
      const historyResult = await db
        .prepare(
          `SELECT sp1.id AS session_player_id, sp2.id AS other_session_player_id, mh.last_game_at
           FROM matchmaking_history mh
           JOIN session_players sp1 ON sp1.player_id = mh.player_id AND sp1.session_id = ?
           JOIN session_players sp2 ON sp2.player_id = mh.other_player_id AND sp2.session_id = ?
           WHERE mh.session_id = ? AND sp1.id IN (${placeholders}) AND sp2.id IN (${placeholders})
           ORDER BY mh.last_game_at DESC`,
        )
        .bind(sessionId, sessionId, sessionId, ...candidateSessionPlayerIds, ...candidateSessionPlayerIds)
        .all<{ session_player_id: string; other_session_player_id: string; last_game_at: string }>()
      for (const row of historyResult.results || []) {
        if (!(row.session_player_id in lastPairedWith)) lastPairedWith[row.session_player_id] = row.other_session_player_id
      }
    }
```

Then change the existing selection call from:

```ts
    const { selected, reasons } = selectNextPlayers(candidates, needed, nowIso)
```

to:

```ts
    const { selected, reasons } = selectNextPlayers(candidates, needed, nowIso, lastPairedWith)
```

(`ORDER BY mh.last_game_at DESC` plus "only set if not already set" means each candidate ends up mapped to their MOST RECENT pairing among the current pool, matching `lastPairedWith`'s documented contract — `matchmaking_history` has no direct `session_id`-scoped session_player_id, so the join through `session_players` on `(player_id, session_id)` is what resolves a player's identity within THIS session specifically.)

- [ ] **Step 6: Write a real e2e test**

Find the existing test file that already exercises `assignCourt`'s queue-selection behavior with multiple eligible players (check both `pickleball-games.spec.js` and `pickleball-queue.spec.js` — use whichever already has a multi-player Open Play court-assignment setup to extend). Add a test that: creates 5+ eligible players, has two of them finish a game together (creating a `matchmaking_history` PARTNER row), then requeues everyone with the same `gamesPlayed`/`queuedAt` ordering that would otherwise select that exact pair together again, assigns a court, and asserts (via `GET .../courts/:courtId/teams`) that the two recently-paired players are NOT selected together again. Match the file's existing setup/assertion style exactly rather than inventing new conventions.

- [ ] **Step 7: Run tests**

Run: `npx vitest run`
Run: `npx playwright test tests/e2e/pickleball/pickleball-games.spec.js tests/e2e/pickleball/pickleball-queue.spec.js --project=worker`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/lib/pickleball/queueEngine.ts src/lib/pickleball/queueEngine.test.ts src/worker/pickleball/SessionCoordinatorDO.ts tests/e2e/pickleball/
git commit -m "feat: wire the repeat-avoidance tiebreak into queue selection"
```

---

### Task 7: Leaderboard and player-stats API routes

**Files:**
- Create: `src/pages/api/pickleball/sessions/[id]/leaderboard.ts`
- Create: `src/pages/api/pickleball/players/[id]/stats.ts`

**Interfaces:**
- Consumes: `getPlayerSnapshot`, `listLeaderboard` (Task 3).
- Produces: `GET /api/pickleball/sessions/:id/leaderboard?minGames=N` → `{leaderboard: [{playerId, displayName, opi, eligibleGamesCount, confidenceTier}, ...]}`, session-scoped, defaulting `minGames` to the session's own `leaderboard_min_games` column (already exists per spec §4.4) when the query param is omitted, `0` reveals everyone (the spec's "show provisional players" toggle). `GET /api/pickleball/players/:id/stats` → `{allTime: {...} | null, sessions: [{sessionId, sessionName, opi, eligibleGamesCount, confidenceTier}, ...]}` — this is the exact route Task 4's e2e test already calls.

- [ ] **Step 1: Create the leaderboard route**

```ts
import type { APIRoute } from 'astro'
import { requirePickleballSession } from '../../../../../worker/pickleball/authContext.js'
import { getSession } from '../../../../../worker/repositories/pickleball/sessions.js'
import { listLeaderboard } from '../../../../../worker/repositories/pickleball/playerPerformanceSnapshots.js'
import { confidenceTier } from '../../../../../lib/pickleball/opi'
import { jsonResponse } from '../../../../../worker/utils/responses.js'
import { getEnv } from '../../../../../lib/env'

export const GET: APIRoute = async ({ request, params, url }) => {
  const env = getEnv()
  try {
    const session = await requirePickleballSession(request, env)
    const sessionId = params.id as string
    const pickleballSession = await getSession(env.PICKLEBALL_DB, sessionId, session.activeOrgId)
    if (!pickleballSession) return jsonResponse({ error: 'Not found.' }, 404)

    const minGamesParam = url.searchParams.get('minGames')
    const minGames = minGamesParam !== null ? Number(minGamesParam) : pickleballSession.leaderboardMinGames

    const rows = await listLeaderboard(env.PICKLEBALL_DB, session.activeOrgId, 'SESSION', sessionId, minGames)
    const leaderboard = rows.map((row) => ({
      playerId: row.playerId,
      displayName: row.displayName,
      opi: row.opi,
      eligibleGamesCount: row.eligibleGamesCount,
      confidenceTier: confidenceTier(row.eligibleGamesCount),
    }))

    return jsonResponse({ leaderboard }, 200)
  } catch (error: any) {
    return jsonResponse({ error: error.message }, error.status || 500)
  }
}
```

Before writing this, confirm `getSession`'s returned object actually exposes `leaderboardMinGames` (camelCase) by reading `src/worker/repositories/pickleball/sessions.js`'s row-mapping function — if the existing mapper doesn't yet expose that column, add it there (it's a real column per spec §4.4 and the `0001_foundation.sql` migration; check whether the mapper already selects/maps it before assuming it needs adding).

- [ ] **Step 2: Create the player-stats route**

```ts
import type { APIRoute } from 'astro'
import { requirePickleballSession } from '../../../../worker/pickleball/authContext.js'
import { getPlayer } from '../../../../worker/repositories/pickleball/players.js'
import { getPlayerSnapshot } from '../../../../worker/repositories/pickleball/playerPerformanceSnapshots.js'
import { confidenceTier } from '../../../../lib/pickleball/opi'
import { jsonResponse } from '../../../../worker/utils/responses.js'
import { getEnv } from '../../../../lib/env'

function toDto(snapshot: { opi: number; eligibleGamesCount: number } | null, extra: Record<string, unknown> = {}) {
  if (!snapshot) return null
  return { ...extra, opi: snapshot.opi, eligibleGamesCount: snapshot.eligibleGamesCount, confidenceTier: confidenceTier(snapshot.eligibleGamesCount) }
}

export const GET: APIRoute = async ({ request, params }) => {
  const env = getEnv()
  try {
    const session = await requirePickleballSession(request, env)
    const playerId = params.id as string
    const player = await getPlayer(env.PICKLEBALL_DB, playerId, session.activeOrgId)
    if (!player) return jsonResponse({ error: 'Not found.' }, 404)

    const allTimeSnapshot = await getPlayerSnapshot(env.PICKLEBALL_DB, playerId, 'ALL_TIME', null)

    const sessionRows = await env.PICKLEBALL_DB
      .prepare(
        `SELECT s.opi, s.eligible_games_count, ps.id AS session_id, ps.name AS session_name
         FROM player_performance_snapshots s
         JOIN pickleball_sessions ps ON ps.id = s.scope_id
         WHERE s.player_id = ? AND s.scope_type = 'SESSION'
         ORDER BY ps.created_at DESC`,
      )
      .bind(playerId)
      .all<{ opi: number; eligible_games_count: number; session_id: string; session_name: string }>()

    const sessions = (sessionRows.results || []).map((row) => ({
      sessionId: row.session_id,
      sessionName: row.session_name,
      opi: row.opi,
      eligibleGamesCount: row.eligible_games_count,
      confidenceTier: confidenceTier(row.eligible_games_count),
    }))

    return jsonResponse({ allTime: toDto(allTimeSnapshot), sessions }, 200)
  } catch (error: any) {
    return jsonResponse({ error: error.message }, error.status || 500)
  }
}
```

Before writing this, confirm the exact export name and signature of the existing player-lookup function in `src/worker/repositories/pickleball/players.js` (it may not be called `getPlayer` — read the file and use whatever it's actually named, org-scoped, matching every other route's tenancy pattern in this codebase).

- [ ] **Step 3: Un-skip Task 4's e2e test, if it was skipped**

If Task 4 landed before this task and skipped its snapshot-cycle e2e test pending this route, remove the `.skip` and its explanatory comment from that test now.

- [ ] **Step 4: Run tests**

Run: `npx vitest run`
Run: `npx playwright test tests/e2e/pickleball/pickleball-games.spec.js --project=worker`
Expected: all pass, including Task 4's now-un-skipped snapshot-cycle test.

- [ ] **Step 5: Commit**

```bash
git add src/pages/api/pickleball/sessions/\[id\]/leaderboard.ts src/pages/api/pickleball/players/\[id\]/stats.ts tests/e2e/pickleball/pickleball-games.spec.js
git commit -m "feat: add leaderboard and player-stats read API routes"
```

---

## Out of scope

- **`pair_stats` and any `FIXED_PAIRS` session-type support** — disclosed and ruled out at the top of this plan; no team-creation or court-assignment code path exists for `FIXED_PAIRS` sessions today, and building it is a full future feature, not a stats-layer addition.
- **Leaderboard and player-profile UI** — this plan builds the read API only. The UI ships in the next plan in this branch, alongside the rest of Phase 6.
- **A "show provisional players" UI toggle** — the leaderboard route already supports it server-side (`minGames=0`); wiring an actual toggle control is a UI-plan concern.

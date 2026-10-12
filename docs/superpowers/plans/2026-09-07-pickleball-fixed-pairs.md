# Devlab Pickleball Fixed Pairs Implementation Plan

> **Superseded (2026-10-12).** This describes the logged-in operator app, retired in 2.0.0 by Phase 5 of `docs/superpowers/specs/2026-10-11-pickleball-free-open-play-design.md`. Kept as history: the routes, tables and files it names no longer exist.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `FIXED_PAIRS` a real session type — partners stay together, the queue's unit of work becomes the pair, and a fixed-pairs session can actually be run from check-in to finished game.

**Architecture:** A new `session_pairs` table holds the pair for the life of a session, distinct from the per-game `teams` row. A queued pair inserts **two** `queue_entries` rows sharing one `session_pair_id`, which preserves the existing `session_player_id NOT NULL` column and the existing one-open-entry-per-player rule without touching either. Selection logic is a pure `selectNextPairs()` sibling to `selectNextPlayers()`. `SessionCoordinatorDO.assignCourt` gains a branch on session type.

**Tech Stack:** Cloudflare Workers + D1 + Durable Objects, Astro API routes, React SPA, Vitest (pure functions), Playwright `worker` project.

**Spec:** `docs/superpowers/specs/2026-09-06-pickleball-pages-pairs-tournaments-design.md` — **Part B (§2.1–§2.8)**. Part A is shipped. Part C (tournaments) is a later plan and depends on this one.

## Global Constraints

- **`session_pairs` is NOT `teams`.** A `team` is per-game and per-court — `releaseCourt` clears its `session_court_id` as soon as the court is released (see migration 0005's header). A pair persists across games for the whole session. Never conflate them.
- **No partial-pair play.** If either member fails an eligibility gate, the whole pair is ineligible. This is the parent spec's §15 case 28 and is not negotiable.
- **A `FIXED_PAIRS` session queues pairs and nothing else.** An unpaired checked-in player is visible and marked as needing a partner, and is never assigned.
- **Never edit an applied migration.** New files only, `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` guard style, matching `migrations/pickleball/`.
- **Every mutation goes through the DO**, is serialized there, and broadcasts. Never mutate session state from an API route directly.
- **OPI is unaffected.** Fixed-pair games are ordinary open-play games and stay eligible under existing rules.
- **Public copy may only describe shipped behaviour.** `tests/e2e/pickleball/pickleball-public-pages.spec.js` currently blocks the string `fixed pair` on both public pages. Task 10 — and only Task 10, after the feature works end to end — relaxes that.
- Run Playwright as `npx playwright test --project=worker --workers=1 <file>`. **Always `--workers=1`**: under parallel load `wrangler dev --local` crashes on this machine with an empty-message `ProxyController` error and everything after fails `ECONNREFUSED ::1:8787`. Pre-existing, unrelated to any change here.
- `_bootstrap-org-tmp.sql` is untracked and predates this work. Leave it alone; never `git add -A`.

---

## File Structure

**Create:**

| Path | Responsibility |
|---|---|
| `src/lib/pickleball/pairSelection.ts` | Pure `selectNextPairs()` + pair eligibility predicate |
| `src/lib/pickleball/pairSelection.test.ts` | Its unit tests |
| `migrations/pickleball/0012_session_pairs.sql` | `session_pairs`, `queue_entries.session_pair_id` |
| `src/worker/repositories/pickleball/sessionPairs.js` | Pair CRUD + eligible-pair query |
| `src/pages/api/pickleball/sessions/[id]/pairs/index.ts` | `GET` list, `POST` form a pair |
| `src/pages/api/pickleball/sessions/[id]/pairs/[pairId].ts` | `DELETE` dissolve |
| `tests/e2e/pickleball/pickleball-fixed-pairs.spec.js` | E2E for the whole flow |

**Modify:**

| Path | Change |
|---|---|
| `src/worker/pickleball/SessionCoordinatorDO.ts` | `formPair`/`dissolvePair`; `assignCourt` branches on session type; pair-aware availability and leave |
| `src/lib/schemas/pickleball/sessions.ts` | `FIXED_PAIRS` requires a `DOUBLES` ruleset |
| `src/worker/repositories/pickleball/queueEntries.js` | Pair-aware join/leave and eligibility |
| `src/pickleball-app/pages/SessionsListPage.jsx` | Session-type selector |
| `src/pickleball-app/pages/CheckInPage.jsx` | Pair forming/dissolving |
| `src/pickleball-app/pages/QueuePage.jsx` | Render pairs as one row |
| `docs/pickleball/schema.md`, `docs/pickleball/architecture.md` | Document the pair model |
| `src/pages/pickleball/how-it-works.astro` + public-pages spec | Document fixed pairs once it works |

### On code in this plan

Complete code is given for the pure functions, the migration, and the schema change — the parts where an exact signature or column matters to later tasks. Repository queries and UI are specified precisely (columns, filters, ordering, labels, states) rather than transcribed line by line: they follow patterns already established in the files they sit beside, and the tasks name those files. Every task still ends in a test that pins the behaviour.

---

## Task 1: `selectNextPairs` — the pure selection function

**Files:**
- Create: `src/lib/pickleball/pairSelection.ts`, `src/lib/pickleball/pairSelection.test.ts`

**Interfaces:**
- Consumes: nothing — pure, no DB, no imports from the worker.
- Produces: `PairCandidate`, `PairSelectionResult`, `selectNextPairs(candidates, count, nowIso, lastOpponentPairId?)`. Task 5 calls this from the DO.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/pickleball/pairSelection.test.ts`. Cover, each as its own `it`:

1. Fewest `gamesPlayed` first.
2. Equal games → longest wait (`queuedAt`) first.
3. Returns exactly `count` pairs, or fewer than `count` available → empty selection with a reason explaining the shortfall.
4. Repeat-avoidance: with **≥3 eligible pairs**, if the top two just played each other (`lastOpponentPairId`), the second is swapped for the next pair on the **same** `gamesPlayed`; never for one on a higher count.
5. Below 3 eligible pairs, repeat-avoidance is skipped entirely — the top two are returned even if they just played.
6. Repeat-avoidance never overrides rule 1: a pair on more games is never selected over one on fewer.
7. `reasons` are returned per selected pair and mention the real deciding field.
8. Input array is not mutated.
9. Deterministic: same input, same output across repeated calls.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/pickleball/pairSelection.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/pickleball/pairSelection.ts`:

```ts
// The fixed-pairs sibling to queueEngine.ts's selectNextPlayers. Same three
// fairness rules, same `reasons[]` explainability contract, but the unit of
// work is a pair rather than a player — so rule 3 avoids an immediate repeat
// of the last OPPOSING PAIR rather than of a partner (partners are fixed by
// definition here, which is the whole point of the session type).
//
// Pure: no DB, no DO, no imports from src/worker. Everything it needs is in
// the candidate rows the caller passes.

export interface PairCandidate {
  sessionPairId: string
  memberSessionPlayerIds: [string, string]
  displayName: string
  gamesPlayed: number
  queuedAt: string
}

export interface PairSelectionReason {
  sessionPairId: string
  reasons: string[]
}

export interface PairSelectionResult {
  selected: PairCandidate[]
  reasons: PairSelectionReason[]
  shortfall: string | null
}

// Below this many eligible pairs there is no meaningful alternative to swap
// in, so repeat-avoidance is skipped rather than allowed to block an
// otherwise-valid match. Mirrors queueEngine.ts's 5-player threshold: one
// more than a full court's worth of entrants.
const REPEAT_AVOIDANCE_MIN_PAIRS = 3

function byFairness(a: PairCandidate, b: PairCandidate): number {
  if (a.gamesPlayed !== b.gamesPlayed) return a.gamesPlayed - b.gamesPlayed
  return Date.parse(a.queuedAt) - Date.parse(b.queuedAt)
}

function waitedMinutes(queuedAt: string, nowIso: string): number {
  return Math.max(0, Math.round((Date.parse(nowIso) - Date.parse(queuedAt)) / 60000))
}

export function selectNextPairs(
  candidates: PairCandidate[],
  count: number,
  nowIso: string,
  lastOpponentPairId?: Record<string, string | null | undefined>,
): PairSelectionResult {
  const sorted = [...candidates].sort(byFairness)

  if (sorted.length < count) {
    return {
      selected: [],
      reasons: [],
      shortfall: `Not enough eligible pairs (need ${count}, have ${sorted.length}).`,
    }
  }

  const selected = sorted.slice(0, count)

  // Rule 3, and only as a tiebreak. A swap is allowed exclusively between
  // pairs tied on the EXACT same gamesPlayed, so it can never override rule
  // 1; and only once enough pairs are eligible for a real alternative to
  // exist.
  if (lastOpponentPairId && sorted.length >= REPEAT_AVOIDANCE_MIN_PAIRS && count >= 2) {
    const selectedIds = new Set(selected.map((pair) => pair.sessionPairId))
    for (let index = selected.length - 1; index >= 1; index -= 1) {
      const lastOpponent = lastOpponentPairId[selected[index].sessionPairId]
      if (!lastOpponent || !selectedIds.has(lastOpponent)) continue

      const replacement = sorted.find(
        (candidate) =>
          !selectedIds.has(candidate.sessionPairId) &&
          candidate.gamesPlayed === selected[index].gamesPlayed &&
          lastOpponentPairId[candidate.sessionPairId] !== selected[0].sessionPairId,
      )
      if (!replacement) continue

      selectedIds.delete(selected[index].sessionPairId)
      selectedIds.add(replacement.sessionPairId)
      selected[index] = replacement
      break
    }
  }

  const fewestGames = selected.length ? Math.min(...selected.map((pair) => pair.gamesPlayed)) : 0
  const reasons: PairSelectionReason[] = selected.map((pair) => {
    const lines = [
      `Games played: ${pair.gamesPlayed}`,
      `Waiting ${waitedMinutes(pair.queuedAt, nowIso)} min`,
    ]
    if (pair.gamesPlayed === fewestGames) lines.unshift('Fewest games played of the eligible pairs')
    return { sessionPairId: pair.sessionPairId, reasons: lines }
  })

  return { selected, reasons, shortfall: null }
}
```

> **Shipped implementation differs from the snippet above — the file is the
> source of truth.** Review found the `REPEAT_AVOIDANCE_MIN_PAIRS` gate was
> dead code (after the shortfall early-return, `sorted.length >= count >= 2`
> always holds, so the only sub-threshold state is `sorted.length === count`,
> where the swap's own "not already selected" clause blocks it anyway), and
> that the single-`break` swap plus a `selected[0]`-only guard was wrong for
> `count > 2`. The constant was deleted and the swap generalised to resolve
> every conflicting slot against the full remaining selection, matching
> `queueEngine.ts`. Read `src/lib/pickleball/pairSelection.ts`, not this block.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/pickleball/pairSelection.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pickleball/pairSelection.ts src/lib/pickleball/pairSelection.test.ts
git commit -m "feat: add the pure pair-selection function for fixed-pairs sessions"
```

---

## Task 2: Schema and repository

**Files:**
- Create: `migrations/pickleball/0012_session_pairs.sql`, `src/worker/repositories/pickleball/sessionPairs.js`

**Interfaces:**
- Produces: `createPair`, `dissolvePair`, `getPair`, `listSessionPairs`, `listEligiblePairs`, `buildIncrementPairGamesPlayedStatement`. Tasks 3–8 consume these.

- [ ] **Step 1: Write the migration**

Create `migrations/pickleball/0012_session_pairs.sql`:

```sql
-- Fixed pairs (spec Part B). A pair persists for the whole session, which is
-- what makes it distinct from `teams`: a team is per-game and per-court, and
-- SessionCoordinatorDO.releaseCourt clears its session_court_id the moment
-- the court is released (see 0005's header). Conflating the two would
-- resurrect exactly the stale-binding bug that migration documents.

CREATE TABLE IF NOT EXISTS session_pairs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  session_player_a_id TEXT NOT NULL,
  session_player_b_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISSOLVED')),
  games_played INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES pickleball_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (session_player_a_id) REFERENCES session_players(id) ON DELETE CASCADE,
  FOREIGN KEY (session_player_b_id) REFERENCES session_players(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_session_pairs_session_status ON session_pairs(session_id, status);

-- A session_player belongs to at most one ACTIVE pair. Two partial indexes
-- rather than one, because the member can sit in either column and SQLite
-- cannot express "either column is unique" in a single index.
CREATE UNIQUE INDEX IF NOT EXISTS idx_session_pairs_member_a_active
  ON session_pairs(session_player_a_id) WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX IF NOT EXISTS idx_session_pairs_member_b_active
  ON session_pairs(session_player_b_id) WHERE status = 'ACTIVE';

-- A queued pair inserts TWO queue_entries rows, one per member, sharing this
-- id and one queued_at. Deliberate: it preserves session_player_id NOT NULL
-- and the existing "at most one open entry per session_player" rule (0006)
-- without modifying either. The queue engine groups rows by this column.
ALTER TABLE queue_entries ADD COLUMN session_pair_id TEXT REFERENCES session_pairs(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_queue_entries_session_pair ON queue_entries(session_pair_id);
```

- [ ] **Step 2: Apply it locally and confirm**

```bash
npx wrangler d1 migrations apply devlab-pickleball --local
```
Expected: `0012_session_pairs.sql` applied, no error.

- [ ] **Step 3: Write the repository**

Create `src/worker/repositories/pickleball/sessionPairs.js`, following the style of `sessionPlayers.js` (a `toX` mapper, `db.prepare().bind()`, statement builders for anything a caller batches):

- `createPair(db, { sessionId, sessionPlayerAId, sessionPlayerBId })` → the pair, or `null` if either member is already in an `ACTIVE` pair (catch the unique-index violation and return null rather than throwing).
- `dissolvePair(db, sessionId, pairId)` → sets `status = 'DISSOLVED'`, bumps `updated_at`; returns false if not found or already dissolved.
- `getPair(db, sessionId, pairId)`, `getActivePairForSessionPlayer(db, sessionId, sessionPlayerId)`.
- `listSessionPairs(db, sessionId)` → active pairs with both members' `display_name`, ordered by creation.
- `listEligiblePairs(db, sessionId)` → returns rows shaped exactly as Task 1's `PairCandidate`: `sessionPairId`, `memberSessionPlayerIds` (both), `displayName` (`"A / B"`), `gamesPlayed` (from `session_pairs`), `queuedAt` (the shared `queue_entries.queued_at`). Both members must be `REGISTERED` + `CHECKED_IN` + `AVAILABLE`, the pair `ACTIVE`, and its queue entries `QUEUED`. Order by `games_played ASC, queued_at ASC`.
- `buildIncrementPairGamesPlayedStatement(db, sessionId, pairId)` — a statement, for batching in `finishGame`.

- [ ] **Step 4: Prove the schema works**

Add to a scratch check (not committed): insert two pairs sharing a member and confirm the second insert violates the unique index. Record the observed error in your report.

- [ ] **Step 5: Commit**

```bash
git add migrations/pickleball/0012_session_pairs.sql src/worker/repositories/pickleball/sessionPairs.js
git commit -m "feat: add the session_pairs table and repository"
```

---

## Task 3: Form and dissolve pairs

**Files:**
- Modify: `src/worker/pickleball/SessionCoordinatorDO.ts`
- Create: `src/pages/api/pickleball/sessions/[id]/pairs/index.ts`, `src/pages/api/pickleball/sessions/[id]/pairs/[pairId].ts`, `tests/e2e/pickleball/pickleball-fixed-pairs.spec.js`

**Interfaces:**
- Consumes: Task 2's repository.
- Produces: `POST /api/pickleball/sessions/:id/pairs` `{ sessionPlayerAId, sessionPlayerBId }`; `DELETE /api/pickleball/sessions/:id/pairs/:pairId`; `GET /api/pickleball/sessions/:id/pairs`. Tasks 9 and 10 consume these.

- [ ] **Step 1: Write the failing E2E**

Create `tests/e2e/pickleball/pickleball-fixed-pairs.spec.js`, reusing the helper style in `pickleball-queue.spec.js`. Assert:
- Forming a pair from two checked-in players returns 201 and the pair lists both members.
- Forming a pair where one member is already paired returns a domain error, not a 500.
- Forming a pair with a player who is not checked in is refused.
- Dissolving returns 200, and the members can then be paired with someone else.
- A `SCOREKEEPER` cannot form or dissolve a pair.

- [ ] **Step 2: Run to verify failure** — routes do not exist, expect 404s.

- [ ] **Step 3: Implement**

Add `formPair` and `dissolvePair` to `SessionCoordinatorDO`, following the shape of `checkIn`/`leaveQueue` exactly: `ownsSession` guard, domain validation, repository write, `await this.broadcast(sessionId)`, `{ ok: true, ... }` or `failure(...)`. `formPair` must reject unless the session is `FIXED_PAIRS`, and unless both members are `CHECKED_IN`. `dissolvePair` must also close any open `queue_entries` rows carrying that `session_pair_id`.

Add the API routes following `sessions/[id]/players/check-in.ts` exactly: Zod-parse, `requirePickleballSession`, permission check (`MANAGE_QUEUE` — a scorekeeper must not pair), forward to the DO stub, `jsonResponse`.

- [ ] **Step 4: Run to verify pass.**

- [ ] **Step 5: Commit**

```bash
git add src/worker/pickleball/SessionCoordinatorDO.ts "src/pages/api/pickleball/sessions/[id]/pairs" tests/e2e/pickleball/pickleball-fixed-pairs.spec.js
git commit -m "feat: let a facilitator form and dissolve fixed pairs"
```

---

## Task 4: Queue a pair, not a player

**Files:**
- Modify: `src/worker/repositories/pickleball/queueEntries.js`, `src/worker/pickleball/SessionCoordinatorDO.ts`, `tests/e2e/pickleball/pickleball-fixed-pairs.spec.js`

- [ ] **Step 1: Write the failing E2E** — in a `FIXED_PAIRS` session: joining the queue as a pair creates two `queue_entries` rows sharing one `session_pair_id` and one `queued_at`; joining as an unpaired player is refused with a domain error naming the reason; leaving closes both rows together.

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement** — `joinQueueAsPair(db, { sessionId, sessionPairId })` inserting both rows in one `db.batch()`; `leaveQueueAsPair`. In the DO, `joinQueue` branches: an `OPEN_PLAY` session keeps today's path; a `FIXED_PAIRS` session resolves the player's active pair and queues the pair, refusing if they have none.

- [ ] **Step 4: Run to verify pass.**

- [ ] **Step 5: Commit** — `feat: queue fixed pairs as a single unit`

---

## Task 5: Assign a court to two pairs

**Files:**
- Modify: `src/worker/pickleball/SessionCoordinatorDO.ts`, `tests/e2e/pickleball/pickleball-fixed-pairs.spec.js`

- [ ] **Step 1: Write the failing E2E** — assigning in a `FIXED_PAIRS` session seats exactly two pairs; the two `teams` rows are created with `kind = 'FIXED_PAIR'` and each holds one pair's two members; with fewer than two eligible pairs the call fails with a clear message; **two concurrent assignments to two different courts never seat the same pair twice** (mirror the existing concurrency test in `pickleball-queue.spec.js`).

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement** — replace `assignCourt`'s current `sessionType !== 'OPEN_PLAY'` refusal with a branch. The `FIXED_PAIRS` path: `listEligiblePairs` → `selectNextPairs(candidates, 2, nowIso, lastOpponentPairId)` → create two teams with `kind: 'FIXED_PAIR'` → members from each pair → mark the court `ASSIGNED`. **`balanceTeams` is not called** — partners are fixed, so there is nothing to balance within a side; the two selected pairs become Team A and Team B in selection order. Build `lastOpponentPairId` from `matchmaking_history` the way the open-play path builds `lastPairedWith`.

- [ ] **Step 4: Run to verify pass.**

- [ ] **Step 5: Commit** — `feat: assign a court to two fixed pairs`

---

## Task 6: Session type — creation, validation, selector

**Files:**
- Modify: `src/lib/schemas/pickleball/sessions.ts`, `src/pickleball-app/pages/SessionsListPage.jsx`, `tests/e2e/pickleball/pickleball-fixed-pairs.spec.js`

- [ ] **Step 1: Write the failing tests** — creating a `FIXED_PAIRS` session with a `SINGLES` ruleset returns a 400 validation error naming the reason; with a `DOUBLES` ruleset it succeeds; the create form offers both session types.

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**

A fixed pair cannot play a singles game, so reject it at creation rather than letting it fail confusingly at assignment. The ruleset's format is not in the request body, so this is a route-level check after the ruleset is loaded, not a pure Zod refinement — put it in `sessions/index.ts`'s POST beside the existing ruleset lookup and return the same shaped domain error as other 400s there.

Add a session-type `<select>` to `SessionsListPage.jsx`'s create form (`EMPTY_FORM` already carries `sessionType: 'OPEN_PLAY'`), labelled "Open Play" / "Fixed Pairs" using the existing label formatter in `SessionControlPage.jsx:36`.

- [ ] **Step 4: Run to verify pass.**

- [ ] **Step 5: Commit** — `feat: let an operator create a fixed-pairs session`

---

## Task 7: Edge cases

**Files:**
- Modify: `src/worker/pickleball/SessionCoordinatorDO.ts`, `tests/e2e/pickleball/pickleball-fixed-pairs.spec.js`

Each row is spec §2.6 and each needs its own E2E assertion.

| Case | Required behaviour |
|---|---|
| One member goes `TEMPORARILY_UNAVAILABLE` | The pair's queue entries close. Both rows are retained. The pair rejoins at the back with a fresh `queued_at` when both are available again. |
| One member leaves the session | The pair is dissolved; the remaining member becomes unpaired. |
| `replaceAssignedPlayer` in a `FIXED_PAIRS` session | Refused with a domain error telling the operator to dissolve and re-form the pair. Do not half-support it. |
| Fewer than two eligible pairs | No assignment offered; the message says so plainly. |
| A player is paired twice | Rejected by the unique index **and** re-checked in the DO's serialized handler. |

- [ ] **Step 1: Write the failing E2E for all five.**
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** in the DO's `setAvailability`, `leaveSession` and `replaceAssignedPlayer`.
- [ ] **Step 4: Run to verify pass.**
- [ ] **Step 5: Commit** — `fix: handle availability, departure and replacement for fixed pairs`

---

## Task 8: Pair statistics

**Files:**
- Modify: `src/worker/pickleball/SessionCoordinatorDO.ts`, `src/worker/repositories/pickleball/sessionPairs.js`, `tests/e2e/pickleball/pickleball-fixed-pairs.spec.js`

- [ ] **Step 1: Write the failing E2E** — finishing a fixed-pairs game increments `games_played` on **both** pairs, exactly once; reopening and re-finishing does not double-count.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** — add `buildIncrementPairGamesPlayedStatement` to `finishGame`'s existing `db.batch()`, alongside the per-player `buildIncrementGamesPlayedStatement`. Follow the same recompute-not-increment discipline the reopen path already uses for player stats so a re-finish cannot double-count.
- [ ] **Step 4: Run to verify pass.**
- [ ] **Step 5: Commit** — `feat: track games played per fixed pair`

---

## Task 9: Operator UI

**Files:**
- Modify: `src/pickleball-app/pages/CheckInPage.jsx`, `src/pickleball-app/pages/QueuePage.jsx`, `tests/e2e/pickleball/pickleball-fixed-pairs.spec.js`

- [ ] **Step 1: Write the failing E2E** — in a `FIXED_PAIRS` session, the check-in page lets an operator select two checked-in players and pair them; a paired player shows their partner; an unpaired one is marked as needing a partner; the queue page renders a pair as one row showing both names.

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement.** Both pages already fetch session detail, so branch on `sessionType`. In an `OPEN_PLAY` session neither page changes at all — verify that explicitly. Follow the existing component idiom (`PlayerStatusChip`, `QueuePlayerRow`); extract a `PairRow` only if `QueuePage.jsx` would otherwise grow past its current responsibility.

- [ ] **Step 4: Run to verify pass**, and re-run `pickleball-operator-ui.spec.js` to prove open-play sessions are untouched.

- [ ] **Step 5: Commit** — `feat: pair players from the check-in page and show pairs in the queue`

---

## Task 10: Documentation, and only now the public copy

**Files:**
- Modify: `docs/pickleball/schema.md`, `docs/pickleball/architecture.md`, `src/pages/pickleball/how-it-works.astro`, `tests/e2e/pickleball/pickleball-public-pages.spec.js`

This task runs **last** because it is the one that tells the public the feature exists. It must not run before Tasks 1–9 are green.

- [ ] **Step 1: Update the docs** — `schema.md` gains `session_pairs` and the `queue_entries.session_pair_id` column with the two-rows-per-pair rationale. `architecture.md`'s "Deliberately not built" list drops fixed pairs, and the phase table records it.

- [ ] **Step 2: Relax the guard, deliberately**

In `pickleball-public-pages.spec.js`, the `documents no unbuilt feature` test blocks both `fixed pair` and `tournament`. Remove **only** `fixed pair`, and update the comment to say why it was removed and that `tournament` stays. Do not delete the test.

- [ ] **Step 3: Document fixed pairs on the guide page**

Add a short section to `/pickleball/how-it-works` describing how a fixed-pairs session differs: pairs are formed at check-in, the queue moves whole pairs, both partners must be available or the pair sits out, and replacing one member means dissolving the pair. **Every sentence must match what Tasks 1–9 actually built** — check the code, not this plan, and reword anything that has drifted.

- [ ] **Step 4: Run both E2E specs to verify pass.**

- [ ] **Step 5: Commit** — `docs: document fixed pairs now that the feature works end to end`

---

## Task 11: Full verification

- [ ] **Step 1:** `npx eslint src/lib/pickleball src/worker/pickleball src/worker/repositories/pickleball src/pickleball-app tests/e2e/pickleball` and `npx tsc --noEmit`. Both clean.
- [ ] **Step 2:** `npx vitest run` — all pass, including Task 1's new tests.
- [ ] **Step 3:** Serially, `--workers=1`: `pickleball-fixed-pairs.spec.js`, `pickleball-queue.spec.js`, `pickleball-games.spec.js`, `pickleball-operator-ui.spec.js`, `pickleball-public-pages.spec.js`. **The queue, games and operator-ui specs are the regression surface — this feature branches code that open-play sessions run through, and those specs are what prove open play still works.**
- [ ] **Step 4:** Manually run one fixed-pairs session end to end against `wrangler dev`: create → check in four players → form two pairs → queue both → assign → start → score → finish. Report what you saw.
- [ ] **Step 5:** Commit anything the verification fixed; otherwise report no commit.

---

## Self-Review

**Spec coverage.** §2.2 entrant model → Task 2. §2.3 formation → Tasks 3, 9. §2.4 eligibility and selection → Tasks 1, 4. §2.5 balancing and assignment → Task 5. §2.6 edge cases → Task 7. §2.7 statistics → Task 8. §2.8 testing → every task, plus Task 11. Session-type validation from §2.4's amendment → Task 6. No gaps.

**Placeholder scan.** No TBD, no "handle edge cases", no "similar to Task N". Repository queries and UI are specified by column, filter, ordering and label rather than transcribed; the rationale is stated under File Structure.

**Type consistency.** `PairCandidate` in Task 1 is the exact shape Task 2's `listEligiblePairs` returns and Task 5 passes to `selectNextPairs`. `session_pairs.games_played` is written by Task 2's statement builder and read by Task 1's `gamesPlayed`. The `session_pair_id` column added in Task 2 is the column Task 4 groups by and Task 7 closes.

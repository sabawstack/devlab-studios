# Devlab Pickleball Tournaments — Phase C1 Implementation Plan

> **Superseded (2026-10-12).** This describes the logged-in operator app, retired in 2.0.0 by Phase 5 of `docs/superpowers/specs/2026-10-11-pickleball-free-open-play-design.md`. Kept as history: the routes, tables and files it names no longer exist.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run a round-robin doubles tournament end to end — enter pairs, seed them, lock a fixture list, play every fixture, and read standings that are not OPI.

**Architecture:** A tournament is a `FIXED_PAIRS` session carrying a `tournament_format`, **not** a third session type (see Global Constraints for why). Every pair mechanism Part B built is reused unchanged; the only thing that swaps is what decides the next match — a generated fixture list instead of the fairness queue. Fixture generation and next-fixture selection are pure functions, unit-tested with no database.

**Tech Stack:** Cloudflare Workers + D1 + Durable Objects, Astro API routes, React SPA, Vitest (pure functions), Playwright `worker` project.

**Spec:** `docs/superpowers/specs/2026-09-06-pickleball-pages-pairs-tournaments-design.md` — **Part C (§3.1–§3.10)**, phase **C1 only** per §4. `SINGLE_ELIMINATION`, `POOL_TO_BRACKET` and `DOUBLE_ELIMINATION` are later phases: build the fixture model so they fit, but do not build them.

## Global Constraints

- **A tournament is a `FIXED_PAIRS` session with a non-null `tournament_format`.** `session_type` is NOT extended. Widening its CHECK is impossible on D1 — the standard table rebuild silently deletes every dependent row through `ON DELETE CASCADE`, and `PRAGMA foreign_keys=OFF` does not help because SQLite treats it as a no-op inside a transaction and D1 wraps migration batches in one. This was measured, not assumed; see spec §3.1 and `docs/pickleball/architecture.md`. **No `CHECK` in this schema may be widened, ever.** New enum values become new nullable columns.
- **Never edit an applied migration.** New files only. `0012` and `0013` are taken by Part B; tournaments start at `0014`.
- **Part B's pair machinery is reused, not reimplemented.** Entrants are `session_pairs` rows. Teams are created with `kind: 'FIXED_PAIR'` and `session_pair_id` stamped, exactly as `assignCourtToPairs` does. Pair eligibility still requires both members `REGISTERED` + `CHECKED_IN` + `AVAILABLE`.
- **OPI is spent, never earned.** Tournament games seed from OPI but must not feed it: `player_game_stats.eligible_for_opi` is `0` for any game in a tournament session. The discriminator is `tournament_format IS NOT NULL`, not the session type.
- **A pair that is on a court cannot be dissolved** (Part B's `hasOpenAssignmentForPair`). Tournament code must not route around that.
- **Every mutation goes through the Durable Object**, is serialized there, and broadcasts.
- **Open play and ordinary fixed-pairs sessions must be completely unaffected.** Regression suites: `pickleball-queue`, `pickleball-games`, `pickleball-fixed-pairs`, `pickleball-operator-ui`.
- **Public copy may only describe shipped behaviour.** `tests/e2e/pickleball/pickleball-public-pages.spec.js` blocks the string `tournament` on both public pages. **Nothing in this phase relaxes that** — C5 does, after the bracket is on the public view. Do not touch that test.
- Run Playwright as `npx playwright test --project=worker --workers=1 <file>`. **Always `--workers=1`.**
- **If a build fails with `EPERM ... dist\client`:** orphaned processes hold it. Kill the parent `node` process running wrangler (killing only the `workerd` children makes them respawn), then delete `dist/client`.
- `_bootstrap-org-tmp.sql` is untracked and predates this work. **Stage only the files each task names — never `git add -A`.**

## On tests — the discipline this project runs on

Six tests that could not fail have been found here, several written by the plan author. For **every** test: apply the one-line mutation that should break it, **observe the real failure**, revert, and report the **actual observed output**. Predicted output is not acceptable.

Two specific traps that have already caught people on this codebase:

- **Asserting a value equals its default proves nothing.** `expect(x.count).toBe(0)` passes whether or not anything wrote to that row. A test needs a failure mode that writes a *wrong* value, not an absent one.
- **Asserting only `toBeTruthy()` on an error proves nothing** about which layer rejected. Assert the actual message.

---

## File Structure

**Create:**

| Path | Responsibility |
|---|---|
| `migrations/pickleball/0014_tournaments.sql` | `tournament_format` column, `tournament_entrants`, `tournament_fixtures` |
| `src/lib/pickleball/tournament/generateFixtures.ts` | Pure fixture generation (round robin in C1) |
| `src/lib/pickleball/tournament/generateFixtures.test.ts` | Its unit tests |
| `src/lib/pickleball/tournament/nextPlayableFixture.ts` | Pure next-fixture selection |
| `src/lib/pickleball/tournament/nextPlayableFixture.test.ts` | Its unit tests |
| `src/lib/pickleball/tournament/seeding.ts` | Pure seed ordering from pair OPI |
| `src/lib/pickleball/tournament/seeding.test.ts` | Its unit tests |
| `src/worker/repositories/pickleball/tournaments.js` | Entrant + fixture persistence |
| `src/pages/api/pickleball/sessions/[id]/tournament/entrants.ts` | `GET` list, `POST` enter a pair |
| `src/pages/api/pickleball/sessions/[id]/tournament/lock.ts` | `POST` lock the bracket |
| `src/pages/api/pickleball/sessions/[id]/tournament/fixtures.ts` | `GET` fixtures + standings |
| `src/pickleball-app/pages/TournamentPage.jsx` | Entrants, seeding, fixture list |
| `tests/e2e/pickleball/pickleball-tournaments.spec.js` | E2E for the whole flow |

**Modify:**

| Path | Change |
|---|---|
| `src/worker/pickleball/SessionCoordinatorDO.ts` | `enterPair`, `lockBracket`; `assignCourt` tournament branch; `finishGame` OPI flag + fixture completion |
| `src/lib/schemas/pickleball/sessions.ts` | Accept `tournamentFormat` at creation |
| `src/pages/api/pickleball/sessions/index.ts` | Validate format against session type and ruleset |
| `src/worker/repositories/pickleball/sessionStandings.js` | Parameterise the `eligible_for_opi` filter (§3.7's named trap) |
| `src/pickleball-app/pages/SessionsListPage.jsx` | Tournament format selector |
| `src/pickleball-app/components/SessionLayout.jsx` | Tournament nav entry |
| `docs/pickleball/schema.md`, `architecture.md` | Document the model |

### On code in this plan

Complete code is given for the migration and for the pure functions' signatures, because later tasks bind to them exactly. Repositories, routes and UI are specified by columns, filters, ordering and states rather than transcribed, following patterns already in the files they sit beside. Every task ends in a test that pins behaviour.

---

## Task 1: Migration and the tournament shape

**Files:** Create `migrations/pickleball/0014_tournaments.sql`

**Interfaces produced:** `pickleball_sessions.tournament_format`; tables `tournament_entrants`, `tournament_fixtures`. Every later task depends on these column names.

- [ ] **Step 1: Write the migration**

```sql
-- A tournament is a FIXED_PAIRS session carrying a format, NOT a third
-- session_type. session_type's CHECK cannot be widened: SQLite has no
-- ALTER ... CHECK, and the standard table rebuild is unsafe on D1 -- dropping
-- the old parent silently deletes every dependent row through ON DELETE
-- CASCADE, and PRAGMA foreign_keys=OFF does not help because SQLite treats it
-- as a no-op inside a transaction and D1 wraps migration batches in one.
-- Measured, not assumed. See docs/pickleball/architecture.md.
--
-- ADD COLUMN with a column-level CHECK does work on D1 (verified: NULL
-- accepted, bad value rejected). NULL means an ordinary fixed-pairs session.
ALTER TABLE pickleball_sessions ADD COLUMN tournament_format TEXT
  CHECK (tournament_format IN ('ROUND_ROBIN', 'SINGLE_ELIMINATION', 'POOL_TO_BRACKET', 'DOUBLE_ELIMINATION'));

-- Locked once the bracket is generated. Seeds are frozen from then on;
-- regenerating mid-tournament is explicitly out of scope (spec §3.2).
ALTER TABLE pickleball_sessions ADD COLUMN bracket_locked_at TEXT;

-- An entrant is a session_pairs row in a tournament. Kept separate from
-- session_pairs so a pair can exist without being entered, and so seed and
-- withdrawal are tournament concerns rather than pair concerns.
CREATE TABLE IF NOT EXISTS tournament_entrants (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  session_pair_id TEXT NOT NULL,
  seed INTEGER,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'WITHDRAWN')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES pickleball_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (session_pair_id) REFERENCES session_pairs(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tournament_entrants_pair ON tournament_entrants(session_pair_id);
CREATE INDEX IF NOT EXISTS idx_tournament_entrants_session ON tournament_entrants(session_id, status);

-- The whole fixture list is generated up front as slots; advancement fills
-- them. source_a/source_b carry a tagged string (WINNER_OF:<id>,
-- LOSER_OF:<id>, POOL_RANK:<pool>:<n>) so a fixture knows where its entrants
-- come from before they exist. Round robin never uses them -- both entrants
-- are known at generation -- but the column exists now so the elimination
-- formats in C2-C4 need no migration.
CREATE TABLE IF NOT EXISTS tournament_fixtures (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  bracket TEXT NOT NULL DEFAULT 'MAIN' CHECK (bracket IN ('POOL', 'MAIN', 'LOSERS')),
  pool_label TEXT,
  round_number INTEGER NOT NULL,
  position INTEGER NOT NULL,
  entrant_a_id TEXT,
  entrant_b_id TEXT,
  source_a TEXT,
  source_b TEXT,
  game_id TEXT,
  winner_entrant_id TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'READY', 'IN_PROGRESS', 'FINISHED', 'BYE')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES pickleball_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (entrant_a_id) REFERENCES tournament_entrants(id) ON DELETE SET NULL,
  FOREIGN KEY (entrant_b_id) REFERENCES tournament_entrants(id) ON DELETE SET NULL,
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tournament_fixtures_slot
  ON tournament_fixtures(session_id, bracket, round_number, position);
CREATE INDEX IF NOT EXISTS idx_tournament_fixtures_status ON tournament_fixtures(session_id, status);
CREATE INDEX IF NOT EXISTS idx_tournament_fixtures_game ON tournament_fixtures(game_id);
```

- [ ] **Step 2: Apply and verify empirically — do not assume**

```bash
npx wrangler d1 migrations apply devlab-pickleball --local
```

Then prove four things with `wrangler d1 execute --local`, pasting real output:
1. An existing session row still reads back with `tournament_format` NULL.
2. Setting `tournament_format = 'ROUND_ROBIN'` on a `FIXED_PAIRS` session succeeds.
3. Setting it to a bogus value is rejected by the CHECK.
4. `SELECT count(*)` on `session_players`, `queue_entries`, `teams` and `games` is **unchanged** from before the migration — this migration must touch no existing row, and that is the property the whole model rests on.

- [ ] **Step 3: Commit**

```bash
git add migrations/pickleball/0014_tournaments.sql
git commit -m "feat: add the tournament format column, entrants and fixtures"
```

---

## Task 2: `generateFixtures` — round robin, pure

**Files:** Create `src/lib/pickleball/tournament/generateFixtures.ts` and its test.

**Interfaces produced:**

```ts
export type TournamentFormat = 'ROUND_ROBIN' | 'SINGLE_ELIMINATION' | 'POOL_TO_BRACKET' | 'DOUBLE_ELIMINATION'

export interface SeededEntrant { entrantId: string; seed: number }

export interface GeneratedFixture {
  bracket: 'POOL' | 'MAIN' | 'LOSERS'
  poolLabel: string | null
  roundNumber: number
  position: number
  entrantAId: string | null
  entrantBId: string | null
  sourceA: string | null
  sourceB: string | null
  status: 'PENDING' | 'READY' | 'BYE'
}

export function generateFixtures(format: TournamentFormat, entrants: SeededEntrant[]): GeneratedFixture[]
```

C1 implements `ROUND_ROBIN` only. The other three formats must `throw` with a message naming the format as not yet supported — **not** return an empty list, which would present as a tournament with no fixtures.

- [ ] **Step 1: Write the failing tests**

Each as its own `it`, with real assertions:

1. **n=4** produces exactly 6 fixtures — `n(n−1)/2`.
2. **Every pair of entrants meets exactly once.** Assert over the full set, not a sample.
3. **No fixture has an entrant playing itself.**
4. **No entrant appears twice in the same round** — the property that makes rounds playable in parallel across courts.
5. **Round count** is `n−1` for even n, `n` for odd n (odd means one entrant sits out each round).
6. **n=5 (odd)** — every entrant sits out exactly once, and the count is still `n(n−1)/2`.
7. **n=2** produces exactly 1 fixture.
8. **n=1 and n=0** produce no fixtures rather than throwing — the caller reports the shortfall.
9. All fixtures are `bracket: 'MAIN'`, `poolLabel: null`, `sourceA/sourceB: null`, `status: 'READY'` — round robin knows both entrants up front.
10. **Deterministic:** same input, same output, and `position` is unique within a round.
11. Each unsupported format throws, naming itself.
12. Input array is not mutated.

- [ ] **Step 2: Run to verify failure.** `npx vitest run src/lib/pickleball/tournament/generateFixtures.test.ts` — module not found.

- [ ] **Step 3: Implement.** Use the standard circle method (fix one entrant, rotate the rest) so property 4 holds by construction rather than by chance. Add a bye entrant internally for odd n and drop fixtures involving it.

- [ ] **Step 4: Run to verify pass**, then `npx vitest run` for the whole suite.

- [ ] **Step 5: Commit** — `feat: generate round-robin tournament fixtures`

---

## Task 3: `nextPlayableFixture` and `seeding` — pure

**Files:** Create `nextPlayableFixture.ts`, `seeding.ts`, and both tests.

**Interfaces produced:**

```ts
export interface FixtureRow {
  id: string; roundNumber: number; position: number
  entrantAId: string | null; entrantBId: string | null
  status: 'PENDING' | 'READY' | 'IN_PROGRESS' | 'FINISHED' | 'BYE'
}
export function nextPlayableFixture(fixtures: FixtureRow[], entrantsInPlay: string[]): FixtureRow | null

export interface SeedCandidate { entrantId: string; displayName: string; opi: number | null }
export function seedEntrants(candidates: SeedCandidate[]): Array<{ entrantId: string; seed: number }>
```

- [ ] **Step 1: Write the failing tests**

`nextPlayableFixture`:
1. Returns the lowest `roundNumber`, then lowest `position`, among `READY` fixtures — deterministic, so two operators see the same proposal.
2. Skips a fixture either of whose entrants is in `entrantsInPlay`.
3. Skips `PENDING`, `IN_PROGRESS`, `FINISHED` and `BYE`.
4. Returns `null` when nothing is playable, and **specifically** when every `READY` fixture is blocked by an entrant already on a court — that is a real state, not an error.
5. Does not mutate its input.

`seedEntrants`:
6. Orders by OPI descending; seed 1 is the highest.
7. A `null` OPI (a pair with no history) sorts **last**, never as zero — matching how `rankStandings` already treats unplayed players.
8. Ties break by `displayName` for stable render order, never by anything that would make the order depend on input sequence.
9. Seeds are `1..n` with no gaps or duplicates.
10. Empty input returns empty.

- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to verify pass.**
- [ ] **Step 5: Commit** — `feat: add tournament seeding and next-fixture selection`

---

## Task 4: Repository

**Files:** Create `src/worker/repositories/pickleball/tournaments.js`

Follow `sessionPairs.js`'s idiom: a `toX` row mapper, `db.prepare().bind()`, and `buildXStatement` builders for anything a caller batches.

- `enterPair(db, { sessionId, sessionPairId })` → the entrant, or `null` if that pair is already entered (catch the unique-index violation, return null — a domain error, not a 500, exactly as `createPair` does).
- `listEntrants(db, sessionId)` → active entrants with both members' display names and the pair's `session_pair_id`, ordered by `seed` then created.
- `buildSetSeedStatement(db, sessionId, entrantId, seed)`.
- `insertFixturesStatements(db, sessionId, fixtures)` → one statement per generated fixture, for a single batch.
- `listFixtures(db, sessionId)` → fixtures with both entrants' display names, ordered by bracket, round, position.
- `getFixtureByGameId(db, sessionId, gameId)` — how `finishGame` finds the fixture a finished game belongs to.
- `buildSetFixtureGameStatement`, `buildFinishFixtureStatement(db, sessionId, fixtureId, winnerEntrantId)`.
- `listTournamentStandings(db, sessionId)` → per entrant: wins, losses, points for, points against. **See Task 8 for the trap this must avoid.**

- [ ] **Step 1: Write it.**
- [ ] **Step 2: Prove the unique index** — enter the same pair twice against the real applied schema and confirm `enterPair` returns null rather than throwing. Paste the real error.
- [ ] **Step 3: Commit** — `feat: add the tournament repository`

---

## Task 5: Create a tournament, enter pairs, lock the bracket

**Files:** Modify `sessions.ts` schema, `sessions/index.ts`, `SessionCoordinatorDO.ts`; create the three API routes and the E2E spec.

- [ ] **Step 1: Write the failing E2E.** Assert:
  - Creating a session with `tournamentFormat: 'ROUND_ROBIN'` and `sessionType: 'FIXED_PAIRS'` succeeds.
  - `tournamentFormat` with `sessionType: 'OPEN_PLAY'` is rejected with a domain error naming the reason.
  - A tournament with a `SINGLES` ruleset is rejected (entrants are pairs).
  - Entering a pair returns 201; entering the same pair twice returns a domain error, not a 500.
  - Locking with fewer than 2 entrants is refused.
  - Locking generates `n(n−1)/2` fixtures, assigns seeds `1..n`, and sets `bracket_locked_at`.
  - Locking twice is refused — seeds are frozen (spec §3.2).
  - Entering a pair after locking is refused.
  - A `SCOREKEEPER` can do none of it.

- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement.** `enterPair` and `lockBracket` as DO commands, following the `formPair` shape exactly: `ownsSession` → validate → repository write → `broadcast` → `{ ok }` / `failure`. `lockBracket` computes seeds via `seedEntrants` (reading each pair's members' `ALL_TIME` OPI through `getPlayerSnapshot`, mean of the two, `null` if either is missing), generates fixtures via `generateFixtures`, and writes seeds + fixtures + `bracket_locked_at` in **one `db.batch()`** — a half-locked bracket is exactly the kind of state Part B kept having to fix.

  Routes follow `pairs/index.ts`, including `forbiddenResponse(request)` for the 403 (there is a documented deterministic `wrangler dev` crash otherwise).

- [ ] **Step 4: Run to verify pass.**
- [ ] **Step 5: Commit** — `feat: create a tournament, enter pairs and lock the bracket`

---

## Task 6: Assign a court from the fixture list

**Files:** Modify `SessionCoordinatorDO.ts`; extend the E2E spec.

- [ ] **Step 1: Write the failing E2E.** In a locked round-robin tournament:
  - Assigning a free court seats the fixture with the lowest round then position, and creates two `FIXED_PAIR` teams with `session_pair_id` stamped — the same team shape Part B produces.
  - The fixture moves to `IN_PROGRESS` and records its `game_id`.
  - Assigning a second court seats the next fixture whose entrants are not already playing.
  - With every remaining fixture blocked by an entrant already on court, assignment fails with a clear message — not a crash, and not seating someone twice.
  - **Two concurrent assignments to two different courts never seat the same entrant twice.** Mirror the existing concurrency tests.
  - Assigning before the bracket is locked is refused.

- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement.** `assignCourt` gains a third branch. Order matters: check `tournament_format IS NOT NULL` **before** the fixed-pairs branch, since a tournament is also a `FIXED_PAIRS` session. Read fixtures and entrants-in-play inside the serialized handler; never cache across calls. Reuse `assignCourtToPairs`'s team-creation shape rather than writing a second one.
- [ ] **Step 4: Run to verify pass**, plus `pickleball-fixed-pairs` to prove ordinary fixed-pairs sessions still take the pair branch.
- [ ] **Step 5: Commit** — `feat: assign a court from the tournament fixture list`

---

## Task 7: Finish a fixture, and keep OPI out of it

**Files:** Modify `SessionCoordinatorDO.ts`; extend the E2E spec.

- [ ] **Step 1: Write the failing E2E.**
  - Finishing a tournament game marks its fixture `FINISHED` with the correct `winner_entrant_id`.
  - **Every `player_game_stats` row for that game has `eligible_for_opi = 0`**, and the players' `ALL_TIME` OPI is unchanged — assert the OPI value before and after, not merely that a row exists.
  - An ordinary fixed-pairs game in a non-tournament session still writes `eligible_for_opi = 1`. This is the control; without it the test cannot distinguish "the flag works" from "the flag is always 0".
  - Reopening and re-finishing a tournament game does not double-count anything and leaves the fixture `FINISHED` with the same winner.

- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement.** `finishGame` currently hardcodes `eligibleForOpi: true` (`SessionCoordinatorDO.ts:1251`). Make it conditional on `session.tournamentFormat !== null`. Add fixture completion to the same `db.batch()`. Round robin has no advancement, so `advanceBracket` is not needed in C1 — but leave the seam obvious for C2.
- [ ] **Step 4: Run to verify pass.**
- [ ] **Step 5: Commit** — `feat: finish a tournament fixture without feeding OPI`

---

## Task 8: Tournament standings — and the trap the spec names

**Files:** Modify `sessionStandings.js`; extend the repository and the E2E spec.

**Read spec §3.7 before starting.** `listSessionStandings` filters its win/loss aggregate on `pgs.eligible_for_opi = 1`. Tournament games are written with that flag `0`. Reusing it unchanged reports **every entrant as 0–0** — a silent wrong answer, not an error. This task exists because of that.

- [ ] **Step 1: Write the failing E2E.** Play a full 3-entrant round robin to completion, then assert standings show the real records — a specific entrant with a specific W–L and point differential, **not** that "some numbers are non-zero". Include one entrant that lost every fixture, so a zeroed aggregate is distinguishable from a real one.
- [ ] **Step 2: Run to verify failure** — and **report what it actually shows**, since the point is that the naive version returns silent zeroes rather than an error.
- [ ] **Step 3: Implement.** Parameterise the filter or add a tournament variant; say which you chose and why. Tournament standings order by wins, then point differential, then head-to-head.
- [ ] **Step 4: Run to verify pass**, plus `pickleball-games` to prove open-play standings are unchanged.
- [ ] **Step 5: Commit** — `fix: count tournament results in standings despite the OPI flag`

---

## Task 9: Operator UI

**Files:** Create `TournamentPage.jsx`; modify `SessionsListPage.jsx`, `SessionLayout.jsx`; extend the E2E spec.

- [ ] **Step 1: Write the failing E2E.** The create form offers a tournament format; a tournament session shows a Tournament nav entry that a non-tournament session does not; the page lists entrants in seed order, allows entering a pair before lock, disables entry after lock, and renders the fixture list grouped by round with each fixture's status.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement.** Branch on `tournamentFormat`, not on session type. In a non-tournament session **nothing may change** — prove it by re-running `pickleball-operator-ui` and `pickleball-fixed-pairs`. Note the repo's ESLint forbids setState synchronously inside an effect body; `LeaderboardPage.jsx` shows the render-phase reset pattern.
- [ ] **Step 4: Run to verify pass.**
- [ ] **Step 5: Commit** — `feat: enter, seed and follow a tournament from the operator UI`

---

## Task 10: Documentation and full verification

- [ ] **Step 1: Docs.** `schema.md` gains `tournament_format`, `bracket_locked_at`, `tournament_entrants`, `tournament_fixtures`, including *why* `source_a`/`source_b` exist before any format uses them. `architecture.md` gains a tournament entry and its phase-table row. **Do not touch the public pages** — C5 owns that, and the guard blocking the word `tournament` stays.

- [ ] **Step 2: Verification.** `npx eslint src/lib/pickleball src/worker src/pickleball-app tests/e2e/pickleball` and `npx tsc --noEmit`, both clean (one pre-existing eslint error lives in `AcceptOrgInvitePage.jsx` — confirm it is absent from this branch's diff rather than treating it as yours). `npx vitest run`. Then serially, `--workers=1`: `pickleball-tournaments`, `pickleball-fixed-pairs`, `pickleball-queue`, `pickleball-games`, `pickleball-operator-ui`, `pickleball-public-pages`. **Report the exact count each prints.**

- [ ] **Step 3: Run one tournament end to end by hand** against `wrangler dev`: create → check in 6 players → form 3 pairs → enter all 3 → lock → play all 3 fixtures to completion → read standings. Confirm the OPI of a participating player is unchanged. Report what you saw.

- [ ] **Step 4: Commit** anything verification uncovered; if nothing, say so and make no commit.

---

## Self-Review

**Spec coverage (C1 scope).** §3.1 shape → Task 1. §3.2 entrants and seeding → Tasks 3, 4, 5. §3.3 `ROUND_ROBIN` → Task 2. §3.4 fixture model → Tasks 1, 2. §3.5 court assignment → Tasks 3, 6. §3.6 scoring and the OPI flag → Task 7. §3.7 standings and its named trap → Task 8. §3.10 testing → every task, plus Task 10. §3.8 public/TV bracket and the other three formats are C2–C5 and deliberately absent.

**Placeholder scan.** No TBD, no "handle errors", no "similar to Task N". Repository and UI are specified by column, filter, ordering and state; the rationale is under File Structure.

**Type consistency.** `SeededEntrant` (Task 2) is what `seedEntrants` (Task 3) returns and what Task 5 passes to `generateFixtures`. `GeneratedFixture`'s fields are the columns Task 1 creates and Task 4 inserts. `FixtureRow` (Task 3) is the shape Task 4's `listFixtures` returns and Task 6 passes to `nextPlayableFixture`.

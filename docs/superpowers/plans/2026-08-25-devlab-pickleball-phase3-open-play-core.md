# Devlab Pickleball — Phase 3 (Open Play Core) Implementation Plan

> **Superseded (2026-10-12).** This describes the logged-in operator app, retired in 2.0.0 by Phase 5 of `docs/superpowers/specs/2026-10-11-pickleball-free-open-play-design.md`. Kept as history: the routes, tables and files it names no longer exist.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fair, explainable queueing for Open Play sessions, concurrency-safe court assignment (no player ever assigned to two courts), player replacement, and a facilitator-triggered court release — the first phase to introduce Durable Objects.

**Architecture:** A pure queue-ordering function (fewest games played, then longest wait, with a plain-English `reasons` array per selection) feeds a `SessionCoordinatorDO` — one Durable Object instance per session — that serializes every mutating queue/court command so two simultaneous "assign a court" requests can never double-book a player. D1 remains the durable source of truth; the DO is a coordination point, not a data store of its own. Adding the DO requires replacing the site's Astro-generated Worker entrypoint with a custom one that also exports the DO class — this touches the whole site's request path, not just Pickleball, so it gets extra scrutiny (Task 1) and a full-site regression check before anything else in this phase is built on top of it.

**Tech Stack:** Astro API routes, Cloudflare D1 (raw SQL), Cloudflare Durable Objects (`cloudflare:workers`'s RPC-capable `DurableObject` base class), Zod, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-24-devlab-pickleball-design.md` (§2 architecture decision 4, §4.5-§4.6, §5, §6, §11, §13, §16, §55-§57)

**Scope boundary:** This phase covers `OPEN_PLAY` sessions only. `FIXED_PAIRS` queue/assignment behavior is out of scope — routes explicitly reject it with a clear "not yet supported" error rather than silently mishandling it. Match balancing by OPI (spec §55) doesn't exist yet (OPI is Phase 5) — Task 6's court assignment pairs selected players in a simple, documented placeholder order (first half vs second half of the selection), with a named seam for Phase 5 to replace. Automatic court release on game finish doesn't exist yet (no game engine until Phase 4) — Task 8 exposes release as an explicit facilitator action; Phase 4 will call the same underlying method automatically.

## Global Constraints (carried forward, including lessons from Phase 1 and Phase 2's final reviews)

- **Every client-supplied foreign key in a request body must be resolved through its own org-scoped `get*(db, id, activeOrgId)` (or session-scoped equivalent) before use.** This is the generalized version of the bug Phase 2's final review found and fixed on `playerId` — write it down this time so it isn't rediscovered a third time. Concretely in this phase: a `sessionPlayerId`/`playerId` used in a queue or assignment command must be confirmed to belong to the target session before any mutation.
- `queue_entries`, `teams`, `team_members` have no `organization_id` column — tenancy is scoped transitively via `session_id`. Every route calls `getSession(db, sessionId, activeOrgId)` first, 404 if null.
- Every API response goes through `jsonResponse` from `src/worker/utils/responses.js` — no bare `new Response(...)`.
- Zod validates every write endpoint's body; failures return `{ error: 'Validation failed.', issues: result.error.issues }` with HTTP 400.
- `MANAGE_QUEUE` and `ASSIGN_COURT` (already defined in `src/lib/pickleball/permissions.ts`, Phase 1) gate the relevant mutating routes — both are held by ADMIN and SESSION_FACILITATOR, neither by SCOREKEEPER.
- All primary keys `TEXT` UUIDs, timestamps ISO-8601 UTC `TEXT`, enums as `CHECK` constraints, index names `idx_<table>_<cols>`. Migrations additive-only.
- No unbounded array input on any Zod schema without a `.max(...)` matching this repo's D1 bound-parameter convention (`src/worker/repositories/mediaAssets.js`'s `MAX_BOUND_PARAMS_PER_QUERY`), per Phase 2's final review.
- Pure logic (queue ordering, eligibility-adjacent helpers) never calls `Date.now()`/`new Date()` internally — callers pass an explicit `nowIso` string, so the function stays deterministic and testable.
- D1 access during verification: **`--local` only, never `--remote`**, unless the user explicitly authorizes otherwise (Phase 2 had an incident here — don't repeat it).
- Any task that starts `wrangler dev` (manually, outside `npx playwright test`) must fully terminate it and all child `workerd`/`esbuild` processes before finishing — verify via `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'wrangler|workerd' }` and kill survivors by PID if a parent kill doesn't take children with it.

---

## File Structure

```
docs/architecture/decisions/0006-pickleball-durable-objects.md   new — ADR for the entrypoint change
src/worker.ts                                                     new — custom Worker entrypoint (wraps Astro + exports the DO)
wrangler.jsonc                                                    modify — main, durable_objects, migrations (root + env.preview)

migrations/pickleball/0004_queue_and_teams.sql                    new — queue_entries, teams, team_members

src/lib/pickleball/queueEngine.ts                                  new — pure selection/ordering + explainability
src/lib/pickleball/queueEngine.test.ts                              new

src/worker/repositories/pickleball/queueEntries.js                   new
src/worker/repositories/pickleball/teams.js                            new
src/worker/repositories/pickleball/sessionCourts.js                     new — session_courts CRUD (table existed since Phase 1, no repo yet)
src/lib/schemas/pickleball/queue.ts                                       new

src/worker/pickleball/SessionCoordinatorDO.ts                              new — the Durable Object class

src/pages/api/pickleball/sessions/[id]/queue/index.ts                      new — GET (list+explain), POST (join)
src/pages/api/pickleball/sessions/[id]/queue/leave.ts                       new — POST
src/pages/api/pickleball/sessions/[id]/courts/index.ts                      new — GET (list session courts)
src/pages/api/pickleball/sessions/[id]/courts/enable.ts                      new — POST
src/pages/api/pickleball/sessions/[id]/courts/disable.ts                      new — POST
src/pages/api/pickleball/sessions/[id]/courts/assign.ts                        new — POST (invokes the DO)
src/pages/api/pickleball/sessions/[id]/courts/replace.ts                        new — POST (invokes the DO)
src/pages/api/pickleball/sessions/[id]/courts/release.ts                         new — POST (invokes the DO)

tests/e2e/pickleball/pickleball-queue.spec.js                                new
```

All `sessions/[id]/queue/*.ts` and `sessions/[id]/courts/*.ts` files sit 6 levels below `src/` (`pages/api/pickleball/sessions/[id]/{queue,courts}/`), needing exactly `../../../../../../` (6 `../`) to reach `src/lib/` or `src/worker/` — same depth Phase 2 already established and verified. Confirm with `tsc --noEmit`, don't hand-count and trust it blindly.

---

### Task 1: Custom Worker entrypoint (enables Durable Objects) + ADR + full-site regression check

**Files:**
- Create: `src/worker.ts`
- Create: `docs/architecture/decisions/0006-pickleball-durable-objects.md`
- Modify: `wrangler.jsonc`

**Interfaces:**
- Produces: the `SessionCoordinatorDO` export point (the class itself is written in Task 6; this task just wires the entrypoint and can use a placeholder empty class temporarily if sequencing requires it — but since this is a single-plan execution, Task 6 will already exist as a file by the time you commit this task if you follow task order; if executing out of order, create a minimal stub class here and let Task 6 replace it).
- Consumes: `@astrojs/cloudflare/handler`'s `handle` export (confirmed current API via Astro's own docs — see Step 1).

**This is the highest-scrutiny task in this phase — it changes the whole site's Worker entrypoint, not just Pickleball's.** Read this whole task before starting.

- [ ] **Step 1: Write the custom entrypoint**

```typescript
// src/worker.ts
import { handle } from '@astrojs/cloudflare/handler'
import { SessionCoordinatorDO } from './worker/pickleball/SessionCoordinatorDO'

export { SessionCoordinatorDO }

export default {
  async fetch(request, env, ctx) {
    return handle(request, env, ctx)
  },
} satisfies ExportedHandler<Env>
```

If `src/worker/pickleball/SessionCoordinatorDO.ts` doesn't exist yet (i.e. you're executing this task before Task 6), create a temporary minimal stub so this file compiles:
```typescript
// TEMPORARY stub — replaced by Task 6's real implementation.
import { DurableObject } from 'cloudflare:workers'
export class SessionCoordinatorDO extends DurableObject<Env> {}
```
Do not skip creating the real Task 6 file later just because the stub compiles — the stub must be gone by the end of this plan.

- [ ] **Step 2: Update `wrangler.jsonc`**

Change the root `"main"` field from `"@astrojs/cloudflare/entrypoints/server"` to `"./src/worker.ts"`. Add, at the root level (alongside `d1_databases`, `r2_buckets`):
```jsonc
"durable_objects": {
  "bindings": [
    { "name": "SESSION_COORDINATOR", "class_name": "SessionCoordinatorDO" }
  ]
},
"migrations": [
  { "tag": "v1", "new_sqlite_classes": ["SessionCoordinatorDO"] }
]
```
Do the same for `env.preview` — it needs its own `durable_objects` binding block (Durable Object bindings, unlike D1, don't need a separate physical resource per environment the way databases do; the same `class_name` is fine, Cloudflare manages preview/production DO storage separately based on the Worker name). Do NOT change `env.preview`'s `"main"` — there is no per-environment `main` override in this file today, and there shouldn't be one after this change either; both environments share `src/worker.ts`.

- [ ] **Step 3: Update `src/env.d.ts`**

Add to the `Env` interface: `SESSION_COORDINATOR: DurableObjectNamespace` (the `@cloudflare/workers-types` package, already a devDependency, provides this ambient type — no import needed if `tsconfig.json`'s `types` array already includes `@cloudflare/workers-types`; check `tsconfig.json` first).

- [ ] **Step 4: Build and run the FULL existing test suite — not just Pickleball**

```bash
npx astro build
npm run typecheck
npx playwright test --project=static
npx playwright test --project=worker
```
Every single one of these must pass exactly as it did before this task — the public site, the Admin CMS, and all existing Pickleball specs. This is the regression gate for touching the site's entrypoint. If anything fails, do not proceed to Task 2 until you understand why and either fix it or determine it's pre-existing flakiness unrelated to this change (compare against a `git stash` of just this task's diff, matching the verification discipline established in Phase 1 and Phase 2's final reviews).

Also manually smoke-test via `wrangler dev --local`: confirm the public homepage (`GET /`) still renders, confirm `GET /api/health` still returns 200, confirm `POST /api/pickleball/auth/test-login` still works (proves the Pickleball API surface survived the entrypoint swap intact). Terminate the dev server and confirm no stray processes remain afterward.

- [ ] **Step 5: Write the ADR**

```markdown
# ADR 0006: Durable Objects for Pickleball session coordination

## Status
Accepted

## Context
Devlab Pickleball's Open Play queue needs concurrency-safe court assignment:
two facilitators (or two courts finishing at once) must never be able to
assign the same player to two courts. The design spec (§16) requires this
to be solved by construction, not by client-side button-disabling.

Cloudflare Durable Objects provide exactly this: one instance per session,
processing one request at a time, so two simultaneous "assign a court"
calls are naturally serialized — the second call's reads already reflect
the first call's writes.

## Decision
Add one Durable Object class, `SessionCoordinatorDO`, keyed by session id
(`idFromName(sessionId)`). D1 remains the durable source of truth; the DO
holds no state of its own beyond what it re-derives from D1 per call — it
is a coordination point, not a cache.

## Consequence: the Worker entrypoint changes for the whole site
`@astrojs/cloudflare`'s adapter generates the default Worker entrypoint
(`main: "@astrojs/cloudflare/entrypoints/server"`), and that generated
entrypoint cannot export additional classes like a Durable Object. The only
documented way to add one (confirmed against Astro's own current docs) is
to replace `main` with a custom `src/worker.ts` that imports `handle` from
`@astrojs/cloudflare/handler`, delegates all fetch handling to it unchanged,
and additionally exports the Durable Object class alongside it.

This is a change to the whole site's request entrypoint, not something
isolated to Pickleball. It was verified safe via a full regression run of
the existing `static` and `worker` Playwright projects (covering the public
site and the Admin CMS) before any Pickleball-specific code was built on
top of it — see the commit implementing this ADR for that verification.

## Alternatives considered
- **D1 optimistic locking (version columns) instead of a DO**: avoids
  touching the entrypoint, but requires hand-rolled retry logic for every
  court-assignment path and provides no path to genuine realtime broadcast
  later (Phase 6 needs a WebSocket hub regardless). Rejected in favor of
  solving both problems with one primitive, per user confirmation before
  this phase began.
```

- [ ] **Step 6: Commit**

```bash
git add src/worker.ts src/env.d.ts wrangler.jsonc docs/architecture/decisions/0006-pickleball-durable-objects.md
git commit -m "feat: add custom Worker entrypoint to enable Pickleball Durable Objects"
```

---

### Task 2: Migration — `queue_entries`, `teams`, `team_members`

**Files:**
- Create: `migrations/pickleball/0004_queue_and_teams.sql`

**Interfaces:**
- Produces: tables `queue_entries`, `teams`, `team_members` — consumed by Tasks 3-8.

- [ ] **Step 1: Write the migration**

```sql
-- Pickleball Phase 3: queueing and team formation for Open Play. No
-- organization_id on any of these tables — tenancy is scoped transitively
-- through session_id -> pickleball_sessions.organization_id, checked at
-- the API layer (see plan's Global Constraints).

CREATE TABLE IF NOT EXISTS queue_entries (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  session_player_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'ASSIGNED', 'PLAYING')),
  queued_at TEXT NOT NULL,
  assigned_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES pickleball_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (session_player_id) REFERENCES session_players(id) ON DELETE CASCADE
);

-- A session_player may have at most one OPEN queue entry (QUEUED, ASSIGNED,
-- or PLAYING are all "open") — enforced at the application layer inside
-- the DO's serialized command handlers, not a DB constraint, since "open"
-- spans three status values and SQLite CHECK constraints can't reference
-- other rows. This index supports the lookup that enforcement relies on.
CREATE INDEX IF NOT EXISTS idx_queue_entries_session_player ON queue_entries(session_player_id, status);
CREATE INDEX IF NOT EXISTS idx_queue_entries_session_status ON queue_entries(session_id, status);

CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'AD_HOC' CHECK (kind IN ('AD_HOC', 'FIXED_PAIR')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES pickleball_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_teams_session ON teams(session_id);

CREATE TABLE IF NOT EXISTS team_members (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  session_player_id TEXT NOT NULL,
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
  FOREIGN KEY (session_player_id) REFERENCES session_players(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_team_members_team ON team_members(team_id);
CREATE INDEX IF NOT EXISTS idx_team_members_session_player ON team_members(session_player_id);
```

- [ ] **Step 2: Apply locally and verify**

```bash
npx wrangler d1 migrations apply devlab-pickleball --local
npx wrangler d1 execute devlab-pickleball --local --command "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('queue_entries','teams','team_members')"
```
Expected: 3 rows.

- [ ] **Step 3: Commit**

```bash
git add migrations/pickleball/0004_queue_and_teams.sql
git commit -m "feat: add Pickleball queue and team formation migration"
```

---

### Task 3: Queue engine (pure selection + explainability)

**Files:**
- Create: `src/lib/pickleball/queueEngine.ts`
- Test: `src/lib/pickleball/queueEngine.test.ts`

**Interfaces:**
- Produces: `interface QueueCandidate { sessionPlayerId: string; playerId: string; displayName: string; gamesPlayed: number; queuedAt: string }`, `interface SelectionReason { sessionPlayerId: string; reasons: string[] }`, `interface QueueSelectionResult { selected: QueueCandidate[]; reasons: SelectionReason[] }`, `selectNextPlayers(candidates: QueueCandidate[], count: number, nowIso: string): QueueSelectionResult` — consumed by Task 6 (the DO) and the queue-list API route (Task 7, for showing "who's next and why" even before assignment).

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest'
import { selectNextPlayers } from './queueEngine'

const NOW = '2026-08-25T18:30:00.000Z'

function candidate(overrides: Partial<{ sessionPlayerId: string; playerId: string; displayName: string; gamesPlayed: number; queuedAt: string }>) {
  return {
    sessionPlayerId: overrides.sessionPlayerId ?? 'sp-default',
    playerId: overrides.playerId ?? 'p-default',
    displayName: overrides.displayName ?? 'Default Player',
    gamesPlayed: overrides.gamesPlayed ?? 0,
    queuedAt: overrides.queuedAt ?? NOW,
  }
}

describe('selectNextPlayers', () => {
  it('prefers fewer games played over longer wait', () => {
    const candidates = [
      candidate({ sessionPlayerId: 'a', gamesPlayed: 3, queuedAt: '2026-08-25T18:00:00.000Z' }),
      candidate({ sessionPlayerId: 'b', gamesPlayed: 1, queuedAt: '2026-08-25T18:20:00.000Z' }),
    ]
    const result = selectNextPlayers(candidates, 1, NOW)
    expect(result.selected.map((c) => c.sessionPlayerId)).toEqual(['b'])
  })

  it('breaks ties on games played by longest wait first', () => {
    const candidates = [
      candidate({ sessionPlayerId: 'a', gamesPlayed: 2, queuedAt: '2026-08-25T18:10:00.000Z' }),
      candidate({ sessionPlayerId: 'b', gamesPlayed: 2, queuedAt: '2026-08-25T18:00:00.000Z' }),
    ]
    const result = selectNextPlayers(candidates, 1, NOW)
    expect(result.selected.map((c) => c.sessionPlayerId)).toEqual(['b'])
  })

  it('selects exactly `count` players in order, never more', () => {
    const candidates = [1, 2, 3, 4, 5].map((n) => candidate({ sessionPlayerId: `p${n}`, gamesPlayed: n, queuedAt: NOW }))
    const result = selectNextPlayers(candidates, 4, NOW)
    expect(result.selected).toHaveLength(4)
    expect(result.selected.map((c) => c.sessionPlayerId)).toEqual(['p1', 'p2', 'p3', 'p4'])
  })

  it('degrades gracefully when fewer candidates than requested count exist', () => {
    const candidates = [candidate({ sessionPlayerId: 'only' })]
    const result = selectNextPlayers(candidates, 4, NOW)
    expect(result.selected).toHaveLength(1)
  })

  it('returns an empty selection for zero candidates', () => {
    const result = selectNextPlayers([], 4, NOW)
    expect(result.selected).toEqual([])
    expect(result.reasons).toEqual([])
  })

  it('builds human-readable reasons naming games played and queue wait', () => {
    const candidates = [
      candidate({ sessionPlayerId: 'a', gamesPlayed: 1, queuedAt: '2026-08-25T18:15:00.000Z' }),
      candidate({ sessionPlayerId: 'b', gamesPlayed: 3, queuedAt: '2026-08-25T18:00:00.000Z' }),
    ]
    const result = selectNextPlayers(candidates, 1, NOW)
    const reason = result.reasons.find((r) => r.sessionPlayerId === 'a')
    expect(reason.reasons).toContain('Games played: 1')
    expect(reason.reasons).toContain('Queue wait: 15 minutes')
    expect(reason.reasons).toContain('Fewer games than 1 other eligible player')
  })

  it('never mentions a nonexistent numeric algorithm score in any reason', () => {
    const candidates = [candidate({ sessionPlayerId: 'a', gamesPlayed: 0, queuedAt: NOW })]
    const result = selectNextPlayers(candidates, 1, NOW)
    for (const reason of result.reasons) {
      for (const line of reason.reasons) {
        expect(line).not.toMatch(/score\s*[:=]\s*[\d.]+/i)
      }
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/pickleball/queueEngine.test.ts`
Expected: FAIL — `queueEngine.ts` does not exist yet.

- [ ] **Step 3: Implement**

```typescript
export interface QueueCandidate {
  sessionPlayerId: string
  playerId: string
  displayName: string
  gamesPlayed: number
  queuedAt: string
}

export interface SelectionReason {
  sessionPlayerId: string
  reasons: string[]
}

export interface QueueSelectionResult {
  selected: QueueCandidate[]
  reasons: SelectionReason[]
}

function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural
}

export function selectNextPlayers(candidates: QueueCandidate[], count: number, nowIso: string): QueueSelectionResult {
  const sorted = [...candidates].sort((a, b) => {
    if (a.gamesPlayed !== b.gamesPlayed) return a.gamesPlayed - b.gamesPlayed
    return Date.parse(a.queuedAt) - Date.parse(b.queuedAt)
  })

  const selected = sorted.slice(0, Math.max(0, count))
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

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/pickleball/queueEngine.test.ts`
Expected: PASS (all 7 cases)

- [ ] **Step 5: Commit**

```bash
git add src/lib/pickleball/queueEngine.ts src/lib/pickleball/queueEngine.test.ts
git commit -m "feat: add Pickleball queue selection engine with explainability"
```

---

### Task 4: Repositories — `queue_entries`, `teams`, `session_courts`

**Files:**
- Create: `src/worker/repositories/pickleball/queueEntries.js`
- Create: `src/worker/repositories/pickleball/teams.js`
- Create: `src/worker/repositories/pickleball/sessionCourts.js`
- Modify: `src/worker/repositories/pickleball/sessionPlayers.js` (Phase 2 file — add one new export, `getSessionPlayerById`, see Step 4)

**Interfaces:**
- Consumes: `selectNextPlayers` is NOT called from here — that happens in the DO (Task 6), which reads eligible candidates via this task's `listEligibleQueueCandidates`.
- Produces:
  - `queueEntries.js`: `joinQueue(db, { sessionId, sessionPlayerId }): Promise<QueueEntry|null>` (null if the session_player already has an open entry — checked via the guarded INSERT below), `leaveQueue(db, sessionId, sessionPlayerId): Promise<boolean>` (true if a QUEUED entry was closed), `listQueueForSession(db, sessionId): Promise<QueueEntryWithPlayer[]>`, `listEligibleQueueCandidates(db, sessionId): Promise<QueueCandidate[]>` (join `queue_entries`+`session_players`+`players`, filtered to `queue_entries.status = 'QUEUED'` AND `session_players.registration_status = 'REGISTERED'` AND `attendance_status = 'CHECKED_IN'` AND `availability_status = 'AVAILABLE'` — the full eligibility gate from spec §5, in one query), `markAssigned(db, sessionId, sessionPlayerIds): Promise<void>` (batch), `closeQueueEntry(db, sessionId, sessionPlayerId): Promise<void>`, `hasOpenQueueEntry(db, sessionId, sessionPlayerId): Promise<boolean>`.
  - `teams.js`: `createTeam(db, { sessionId, kind }): Promise<Team>`, `addTeamMember(db, { teamId, sessionPlayerId }): Promise<void>`, `getTeamWithMembers(db, teamId): Promise<TeamWithMembers|null>`, `getActiveTeamForSessionPlayer(db, sessionId, sessionPlayerId): Promise<TeamWithMembers|null>` (used by replace: find which team an assigned player is currently on).
  - `sessionCourts.js`: `listSessionCourts(db, sessionId): Promise<SessionCourtWithCourtName[]>`, `getSessionCourt(db, sessionId, sessionCourtId): Promise<SessionCourt|null>`, `setCourtEnabled(db, sessionId, sessionCourtId, enabled): Promise<SessionCourt|null>`, `setCourtStatus(db, sessionId, sessionCourtId, status): Promise<SessionCourt|null>`.

No Vitest step (DB-touching, verified via Playwright in Task 9, matching this repo's established convention). No API routes call these directly except through Task 7's routes and Task 6's DO — implement exactly the functions listed, no more.

- [ ] **Step 1: `queueEntries.js`**

```javascript
import { nowIso } from '../../utils/responses.js'

function toQueueEntry(row) {
  if (!row) return null
  return {
    id: row.id,
    sessionId: row.session_id,
    sessionPlayerId: row.session_player_id,
    status: row.status,
    queuedAt: row.queued_at,
    assignedAt: row.assigned_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function hasOpenQueueEntry(db, sessionId, sessionPlayerId) {
  const row = await db
    .prepare(`SELECT id FROM queue_entries WHERE session_id = ? AND session_player_id = ? AND status IN ('QUEUED', 'ASSIGNED', 'PLAYING')`)
    .bind(sessionId, sessionPlayerId)
    .first()
  return Boolean(row)
}

export async function joinQueue(db, { sessionId, sessionPlayerId }) {
  const alreadyOpen = await hasOpenQueueEntry(db, sessionId, sessionPlayerId)
  if (alreadyOpen) return null

  const id = crypto.randomUUID()
  const timestamp = nowIso()

  await db
    .prepare(
      `INSERT INTO queue_entries (id, session_id, session_player_id, status, queued_at, created_at, updated_at)
       VALUES (?, ?, ?, 'QUEUED', ?, ?, ?)`,
    )
    .bind(id, sessionId, sessionPlayerId, timestamp, timestamp, timestamp)
    .run()

  const row = await db.prepare(`SELECT * FROM queue_entries WHERE id = ?`).bind(id).first()
  return toQueueEntry(row)
}

export async function leaveQueue(db, sessionId, sessionPlayerId) {
  const result = await db
    .prepare(`UPDATE queue_entries SET status = 'PLAYING', updated_at = ? WHERE 1 = 0`)
    .bind(nowIso())
    .run()
  // The above is intentionally a no-op placeholder shape; the real removal is a delete,
  // since a QUEUED entry that's left has no further use (unlike ASSIGNED/PLAYING, which
  // are transitioned, not deleted, so history stays visible via teams/team_members).
  const deleted = await db
    .prepare(`DELETE FROM queue_entries WHERE session_id = ? AND session_player_id = ? AND status = 'QUEUED'`)
    .bind(sessionId, sessionPlayerId)
    .run()
  return Boolean(deleted.meta.changes)
}

export async function listQueueForSession(db, sessionId) {
  const result = await db
    .prepare(
      `SELECT qe.id, qe.session_id, qe.session_player_id, qe.status, qe.queued_at, qe.assigned_at,
              sp.player_id, p.display_name, sp.games_played
       FROM queue_entries qe
       JOIN session_players sp ON sp.id = qe.session_player_id
       JOIN players p ON p.id = sp.player_id
       WHERE qe.session_id = ?
       ORDER BY qe.status ASC, qe.queued_at ASC`,
    )
    .bind(sessionId)
    .all()

  return (result.results || []).map((row) => ({
    id: row.id,
    sessionId: row.session_id,
    sessionPlayerId: row.session_player_id,
    playerId: row.player_id,
    displayName: row.display_name,
    gamesPlayed: row.games_played,
    status: row.status,
    queuedAt: row.queued_at,
    assignedAt: row.assigned_at,
  }))
}

export async function listEligibleQueueCandidates(db, sessionId) {
  const result = await db
    .prepare(
      `SELECT qe.session_player_id, sp.player_id, p.display_name, sp.games_played, qe.queued_at
       FROM queue_entries qe
       JOIN session_players sp ON sp.id = qe.session_player_id
       JOIN players p ON p.id = sp.player_id
       WHERE qe.session_id = ?
         AND qe.status = 'QUEUED'
         AND sp.registration_status = 'REGISTERED'
         AND sp.attendance_status = 'CHECKED_IN'
         AND sp.availability_status = 'AVAILABLE'
       ORDER BY sp.games_played ASC, qe.queued_at ASC`,
    )
    .bind(sessionId)
    .all()

  return (result.results || []).map((row) => ({
    sessionPlayerId: row.session_player_id,
    playerId: row.player_id,
    displayName: row.display_name,
    gamesPlayed: row.games_played,
    queuedAt: row.queued_at,
  }))
}

export async function markAssigned(db, sessionId, sessionPlayerIds) {
  if (!sessionPlayerIds.length) return
  const timestamp = nowIso()
  const placeholders = sessionPlayerIds.map(() => '?').join(', ')
  await db
    .prepare(
      `UPDATE queue_entries SET status = 'ASSIGNED', assigned_at = ?, updated_at = ?
       WHERE session_id = ? AND session_player_id IN (${placeholders}) AND status = 'QUEUED'`,
    )
    .bind(timestamp, timestamp, sessionId, ...sessionPlayerIds)
    .run()
}

export async function closeQueueEntry(db, sessionId, sessionPlayerId) {
  await db
    .prepare(`DELETE FROM queue_entries WHERE session_id = ? AND session_player_id = ?`)
    .bind(sessionId, sessionPlayerId)
    .run()
}
```

Remove the dead no-op placeholder statement in `leaveQueue` before committing — it was left in this brief as a reminder that a plain `DELETE` (not a status transition) is correct here; the actual function body is just the `DELETE` and its return. Do not ship the no-op `UPDATE ... WHERE 1 = 0` line.

- [ ] **Step 2: `teams.js`**

```javascript
export async function createTeam(db, { sessionId, kind }) {
  const id = crypto.randomUUID()
  await db
    .prepare(`INSERT INTO teams (id, session_id, kind, created_at) VALUES (?, ?, ?, ?)`)
    .bind(id, sessionId, kind, new Date().toISOString())
    .run()
  return { id, sessionId, kind }
}

export async function addTeamMember(db, { teamId, sessionPlayerId }) {
  const id = crypto.randomUUID()
  await db
    .prepare(`INSERT INTO team_members (id, team_id, session_player_id) VALUES (?, ?, ?)`)
    .bind(id, teamId, sessionPlayerId)
    .run()
}

export async function getTeamWithMembers(db, teamId) {
  const team = await db.prepare(`SELECT id, session_id, kind, created_at FROM teams WHERE id = ?`).bind(teamId).first()
  if (!team) return null

  const members = await db
    .prepare(
      `SELECT tm.session_player_id, sp.player_id, p.display_name
       FROM team_members tm
       JOIN session_players sp ON sp.id = tm.session_player_id
       JOIN players p ON p.id = sp.player_id
       WHERE tm.team_id = ?`,
    )
    .bind(teamId)
    .all()

  return {
    id: team.id,
    sessionId: team.session_id,
    kind: team.kind,
    createdAt: team.created_at,
    members: (members.results || []).map((row) => ({
      sessionPlayerId: row.session_player_id,
      playerId: row.player_id,
      displayName: row.display_name,
    })),
  }
}

export async function getActiveTeamForSessionPlayer(db, sessionId, sessionPlayerId) {
  const row = await db
    .prepare(
      `SELECT t.id FROM teams t
       JOIN team_members tm ON tm.team_id = t.id
       WHERE t.session_id = ? AND tm.session_player_id = ?
       ORDER BY t.created_at DESC LIMIT 1`,
    )
    .bind(sessionId, sessionPlayerId)
    .first()
  if (!row) return null
  return getTeamWithMembers(db, row.id)
}
```

- [ ] **Step 3: `sessionCourts.js`**

```javascript
import { nowIso } from '../../utils/responses.js'

function toSessionCourt(row) {
  if (!row) return null
  return {
    id: row.id,
    sessionId: row.session_id,
    courtId: row.court_id,
    courtName: row.court_name,
    enabled: Boolean(row.enabled),
    status: row.status,
    currentGameId: row.current_game_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const SESSION_COURT_COLUMNS = `sc.id, sc.session_id, sc.court_id, c.name AS court_name, sc.enabled, sc.status, sc.current_game_id, sc.created_at, sc.updated_at`

export async function listSessionCourts(db, sessionId) {
  const result = await db
    .prepare(
      `SELECT ${SESSION_COURT_COLUMNS} FROM session_courts sc
       JOIN courts c ON c.id = sc.court_id
       WHERE sc.session_id = ?
       ORDER BY c.sort_order ASC`,
    )
    .bind(sessionId)
    .all()
  return (result.results || []).map(toSessionCourt)
}

export async function getSessionCourt(db, sessionId, sessionCourtId) {
  const row = await db
    .prepare(`SELECT ${SESSION_COURT_COLUMNS} FROM session_courts sc JOIN courts c ON c.id = sc.court_id WHERE sc.session_id = ? AND sc.id = ?`)
    .bind(sessionId, sessionCourtId)
    .first()
  return toSessionCourt(row)
}

export async function setCourtEnabled(db, sessionId, sessionCourtId, enabled) {
  const result = await db
    .prepare(`UPDATE session_courts SET enabled = ?, updated_at = ? WHERE session_id = ? AND id = ?`)
    .bind(enabled ? 1 : 0, nowIso(), sessionId, sessionCourtId)
    .run()
  if (!result.meta.changes) return null
  return getSessionCourt(db, sessionId, sessionCourtId)
}

export async function setCourtStatus(db, sessionId, sessionCourtId, status) {
  const result = await db
    .prepare(`UPDATE session_courts SET status = ?, updated_at = ? WHERE session_id = ? AND id = ?`)
    .bind(status, nowIso(), sessionId, sessionCourtId)
    .run()
  if (!result.meta.changes) return null
  return getSessionCourt(db, sessionId, sessionCourtId)
}
```

- [ ] **Step 4: Add `getSessionPlayerById` to `sessionPlayers.js`**

Phase 2's `sessionPlayers.js` only exposes lookups keyed by `playerId` (e.g. `getSessionPlayer(db, sessionId, playerId)`) — nothing looks up a row by its own `id` (the `session_players.id` value that `queue_entries.session_player_id` and this phase's routes actually receive as `sessionPlayerId`). Add this export, following the file's existing `toSessionPlayer` row-mapping convention:

```javascript
export async function getSessionPlayerById(db, sessionId, sessionPlayerId) {
  const row = await db
    .prepare(
      `SELECT ${SESSION_PLAYER_COLUMNS}
       FROM session_players sp
       JOIN players p ON p.id = sp.player_id
       WHERE sp.session_id = ? AND sp.id = ?`,
    )
    .bind(sessionId, sessionPlayerId)
    .first()
  return toSessionPlayer(row)
}
```

This is the function Task 7's queue-join and court-assignment routes use to confirm a client-supplied `sessionPlayerId` actually belongs to the target session before doing anything else with it — the generalized version of Phase 2's `playerId` ownership fix, applied here before it becomes a bug instead of after.

- [ ] **Step 5: Commit**

```bash
git add src/worker/repositories/pickleball/queueEntries.js src/worker/repositories/pickleball/teams.js src/worker/repositories/pickleball/sessionCourts.js src/worker/repositories/pickleball/sessionPlayers.js
git commit -m "feat: add Pickleball queue, team, and session-court repositories"
```

---

### Task 5: Zod schemas

**Files:**
- Create: `src/lib/schemas/pickleball/queue.ts`

**Interfaces:**
- Produces: `joinQueueSchema` ({ sessionPlayerId: uuid }), `leaveQueueSchema` ({ sessionPlayerId: uuid }), `assignCourtSchema` ({ sessionCourtId: uuid }), `replaceAssignedPlayerSchema` ({ sessionCourtId: uuid, outgoingSessionPlayerId: uuid, incomingSessionPlayerId: uuid, outgoingDisposition: enum('UNAVAILABLE','REQUEUE') }), `releaseCourtSchema` ({ sessionCourtId: uuid }) — consumed by Task 7.

- [ ] **Step 1: Implement**

```typescript
import { z } from 'zod'

export const joinQueueSchema = z.object({
  sessionPlayerId: z.string().uuid(),
})

export const leaveQueueSchema = z.object({
  sessionPlayerId: z.string().uuid(),
})

export const assignCourtSchema = z.object({
  sessionCourtId: z.string().uuid(),
})

export const replaceAssignedPlayerSchema = z.object({
  sessionCourtId: z.string().uuid(),
  outgoingSessionPlayerId: z.string().uuid(),
  incomingSessionPlayerId: z.string().uuid(),
  outgoingDisposition: z.enum(['UNAVAILABLE', 'REQUEUE']),
})

export const releaseCourtSchema = z.object({
  sessionCourtId: z.string().uuid(),
})

export type AssignCourtInput = z.infer<typeof assignCourtSchema>
export type ReplaceAssignedPlayerInput = z.infer<typeof replaceAssignedPlayerSchema>
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/schemas/pickleball/queue.ts
git commit -m "feat: add Pickleball queue and court-assignment Zod schemas"
```

---

### Task 6: `SessionCoordinatorDO`

**Files:**
- Create: `src/worker/pickleball/SessionCoordinatorDO.ts`
- Modify: `src/worker/repositories/pickleball/sessions.js` (add one new export, `getSessionById` — see Step 1)
- Modify: `src/worker.ts` (replace the temporary stub import, if Task 1 needed one, with this real file — by this point in a normal top-to-bottom execution the stub was already the final content; if you find a stub in `src/worker.ts`, this task doesn't need to touch it since the import path is already correct, only the stub file's *content* changes here — actually there is only one file, `src/worker/pickleball/SessionCoordinatorDO.ts`; if Task 1 created a temporary stub AT THAT EXACT PATH, this task overwrites it with the real implementation. If Task 1's stub was inline in `src/worker.ts` instead, this task creates the real file at `src/worker/pickleball/SessionCoordinatorDO.ts` and updates `src/worker.ts`'s import to point at it.)

**Interfaces:**
- Consumes: `getSession` (Phase 1), `listEligibleQueueCandidates`/`markAssigned`/`closeQueueEntry`/`joinQueue` (Task 4), `getSessionCourt`/`setCourtStatus` (Task 4), `createTeam`/`addTeamMember`/`getActiveTeamForSessionPlayer` (Task 4), `selectNextPlayers` (Task 3), `getScoringRuleset` (Phase 1's sessions repository — check the exact export name from `src/worker/repositories/pickleball/sessions.js`, added during Phase 1's final-review fix wave, to determine `format` = SINGLES/DOUBLES for how many players a court needs).
- Produces: class `SessionCoordinatorDO extends DurableObject<Env>` with methods `assignCourt(sessionId: string, sessionCourtId: string): Promise<AssignCourtResult>`, `replaceAssignedPlayer(sessionId: string, sessionCourtId: string, outgoingSessionPlayerId: string, incomingSessionPlayerId: string, outgoingDisposition: 'UNAVAILABLE' | 'REQUEUE'): Promise<ReplaceResult>`, `releaseCourt(sessionId: string, sessionCourtId: string): Promise<ReleaseResult>` — consumed by Task 7's API routes via the DO stub (`env.SESSION_COORDINATOR.get(env.SESSION_COORDINATOR.idFromName(sessionId))`).

This class is called via Cloudflare's RPC mechanism (methods invoked directly on the stub) rather than a manual `fetch()`-based router — this is the modern pattern the `cloudflare:workers` `DurableObject` base class supports, and it's what Astro's own docs example uses.

**Concurrency note for whoever reviews this task:** the atomicity guarantee comes from the Durable Object runtime processing one request at a time per instance — there is no explicit lock/mutex in this code, and there shouldn't be one. Do not add manual locking; it would be redundant with (and could conflict with) the platform guarantee.

- [ ] **Step 1: Add `getSessionById` to `sessions.js`, then implement the DO**

The DO only ever receives a `sessionId` (the caller — Task 7's routes — already verified organization ownership before invoking the DO), so it needs an org-agnostic internal lookup. Add this export to `src/worker/repositories/pickleball/sessions.js`, right after `getSession`:

```javascript
// Trusted-internal lookup with no organization filter — safe only because
// every caller (SessionCoordinatorDO) receives a sessionId that was already
// org-verified one layer up, by the API route that invoked it. Never expose
// this through a route directly.
export async function getSessionById(db, id) {
  const row = await db.prepare(`SELECT ${SESSION_COLUMNS} FROM pickleball_sessions WHERE id = ?`).bind(id).first()
  return toSession(row)
}
```

```typescript
import { DurableObject } from 'cloudflare:workers'
import { getSessionById, getScoringRuleset } from '../repositories/pickleball/sessions.js'
import { getSessionCourt, setCourtStatus } from '../repositories/pickleball/sessionCourts.js'
import {
  listEligibleQueueCandidates,
  markAssigned,
  closeQueueEntry,
  joinQueue,
} from '../repositories/pickleball/queueEntries.js'
import { createTeam, addTeamMember, getActiveTeamForSessionPlayer } from '../repositories/pickleball/teams.js'
import { selectNextPlayers } from '../../lib/pickleball/queueEngine'

function requiredPlayerCount(format: string): number {
  return format === 'SINGLES' ? 2 : 4
}

export class SessionCoordinatorDO extends DurableObject<Env> {
  async assignCourt(sessionId: string, sessionCourtId: string) {
    const db = this.env.PICKLEBALL_DB

    const session = await getSessionById(db, sessionId)
    if (!session) return { ok: false as const, error: 'Session not found.' }
    if (session.sessionType !== 'OPEN_PLAY') {
      return { ok: false as const, error: 'Court assignment is only supported for Open Play sessions in this phase.' }
    }

    const court = await getSessionCourt(db, sessionId, sessionCourtId)
    if (!court) return { ok: false as const, error: 'Court not found.' }
    if (court.status !== 'AVAILABLE') return { ok: false as const, error: 'Court is not available.' }

    const ruleset = await getScoringRuleset(db, session.scoringRulesetId, session.organizationId)
    const needed = requiredPlayerCount(ruleset ? ruleset.format : 'DOUBLES')

    const candidates = await listEligibleQueueCandidates(db, sessionId)
    if (candidates.length < needed) {
      return { ok: false as const, error: `Not enough eligible players (need ${needed}, have ${candidates.length}).` }
    }

    const nowIso = new Date().toISOString()
    const { selected, reasons } = selectNextPlayers(candidates, needed, nowIso)

    // Placeholder pairing: first half vs second half of the fairness-selected
    // group, in selection order. This is intentionally NOT OPI-balanced —
    // OPI doesn't exist until Phase 5. Phase 5 should replace only this
    // pairing step (not the selection above it) with a real balanceTeams()
    // call, per spec §55's queue-fairness-vs-match-balancing separation.
    const half = Math.floor(selected.length / 2)
    const teamAPlayers = selected.slice(0, half)
    const teamBPlayers = selected.slice(half)

    const teamA = await createTeam(db, { sessionId, kind: 'AD_HOC' })
    for (const player of teamAPlayers) await addTeamMember(db, { teamId: teamA.id, sessionPlayerId: player.sessionPlayerId })

    const teamB = await createTeam(db, { sessionId, kind: 'AD_HOC' })
    for (const player of teamBPlayers) await addTeamMember(db, { teamId: teamB.id, sessionPlayerId: player.sessionPlayerId })

    await markAssigned(db, sessionId, selected.map((p) => p.sessionPlayerId))
    await setCourtStatus(db, sessionId, sessionCourtId, 'ASSIGNED')

    return {
      ok: true as const,
      court: await getSessionCourt(db, sessionId, sessionCourtId),
      teamA: { id: teamA.id, players: teamAPlayers },
      teamB: { id: teamB.id, players: teamBPlayers },
      reasons,
    }
  }

  async replaceAssignedPlayer(
    sessionId: string,
    sessionCourtId: string,
    outgoingSessionPlayerId: string,
    incomingSessionPlayerId: string,
    outgoingDisposition: 'UNAVAILABLE' | 'REQUEUE',
  ) {
    const db = this.env.PICKLEBALL_DB

    const court = await getSessionCourt(db, sessionId, sessionCourtId)
    if (!court) return { ok: false as const, error: 'Court not found.' }
    if (court.status !== 'ASSIGNED') return { ok: false as const, error: 'Court has no pending assignment to replace a player on.' }

    const team = await getActiveTeamForSessionPlayer(db, sessionId, outgoingSessionPlayerId)
    if (!team) return { ok: false as const, error: 'Outgoing player is not currently assigned on this session.' }

    const candidates = await listEligibleQueueCandidates(db, sessionId)
    const incoming = candidates.find((c) => c.sessionPlayerId === incomingSessionPlayerId)
    if (!incoming) return { ok: false as const, error: 'Incoming player is not eligible (must be checked in, available, and queued).' }

    await db
      .prepare(`UPDATE team_members SET session_player_id = ? WHERE team_id = ? AND session_player_id = ?`)
      .bind(incomingSessionPlayerId, team.id, outgoingSessionPlayerId)
      .run()

    await markAssigned(db, sessionId, [incomingSessionPlayerId])
    await closeQueueEntry(db, sessionId, outgoingSessionPlayerId)

    if (outgoingDisposition === 'UNAVAILABLE') {
      await db
        .prepare(`UPDATE session_players SET availability_status = 'TEMPORARILY_UNAVAILABLE', updated_at = ? WHERE id = ?`)
        .bind(new Date().toISOString(), outgoingSessionPlayerId)
        .run()
    } else {
      await joinQueue(db, { sessionId, sessionPlayerId: outgoingSessionPlayerId })
    }

    return { ok: true as const, teamId: team.id, incomingSessionPlayerId, outgoingSessionPlayerId }
  }

  async releaseCourt(sessionId: string, sessionCourtId: string) {
    const db = this.env.PICKLEBALL_DB

    const court = await getSessionCourt(db, sessionId, sessionCourtId)
    if (!court) return { ok: false as const, error: 'Court not found.' }
    if (court.status !== 'ASSIGNED') return { ok: false as const, error: 'Court is not currently assigned.' }

    const session = await getSessionById(db, sessionId)

    const membersResult = await db
      .prepare(
        `SELECT tm.session_player_id FROM team_members tm
         JOIN teams t ON t.id = tm.team_id
         WHERE t.session_id = ? AND tm.session_player_id IN (
           SELECT session_player_id FROM queue_entries WHERE session_id = ? AND status = 'ASSIGNED'
         )`,
      )
      .bind(sessionId, sessionId)
      .all()

    const sessionPlayerIds = (membersResult.results || []).map((row: { session_player_id: string }) => row.session_player_id)

    for (const sessionPlayerId of sessionPlayerIds) {
      await closeQueueEntry(db, sessionId, sessionPlayerId)
      if (session && session.postGameRotationPolicy === 'AUTO_REQUEUE_ALL') {
        await joinQueue(db, { sessionId, sessionPlayerId })
      }
    }

    await setCourtStatus(db, sessionId, sessionCourtId, 'AVAILABLE')

    return { ok: true as const, releasedSessionPlayerIds: sessionPlayerIds, requeued: session?.postGameRotationPolicy === 'AUTO_REQUEUE_ALL' }
  }
}
```

`getScoringRuleset(db, id, organizationId)` already exists in `sessions.js` from Phase 1's final-review fix wave with exactly this signature (confirmed by reading the file while authoring this plan) — no further check needed for that one.

- [ ] **Step 2: Update `src/worker.ts`**

Replace the temporary stub content of `src/worker/pickleball/SessionCoordinatorDO.ts` (if that's where Task 1 put it) with the real implementation above — i.e., this task's Step 1 IS that replacement. Confirm `src/worker.ts`'s import line still reads `import { SessionCoordinatorDO } from './worker/pickleball/SessionCoordinatorDO'` and needs no further edits.

- [ ] **Step 3: Verify**

Run `npx tsc --noEmit -p tsconfig.json` — clean. A full runtime verification of this class happens in Task 7 (once routes can invoke it) and Task 9 (e2e, including the concurrency test) — this task's own verification is limited to type-checking and a careful read, since a Durable Object's RPC methods aren't meaningfully testable in isolation without a route calling them through `wrangler dev`.

- [ ] **Step 4: Commit**

```bash
git add src/worker/pickleball/SessionCoordinatorDO.ts src/worker.ts
git commit -m "feat: add Pickleball SessionCoordinatorDO for atomic court assignment"
```

---

### Task 7: API routes — queue, courts, assignment, replacement, release

**Files:**
- Create: `src/pages/api/pickleball/sessions/[id]/queue/index.ts`
- Create: `src/pages/api/pickleball/sessions/[id]/queue/leave.ts`
- Create: `src/pages/api/pickleball/sessions/[id]/courts/index.ts`
- Create: `src/pages/api/pickleball/sessions/[id]/courts/enable.ts`
- Create: `src/pages/api/pickleball/sessions/[id]/courts/disable.ts`
- Create: `src/pages/api/pickleball/sessions/[id]/courts/assign.ts`
- Create: `src/pages/api/pickleball/sessions/[id]/courts/replace.ts`
- Create: `src/pages/api/pickleball/sessions/[id]/courts/release.ts`

**Interfaces:**
- Consumes: `requirePickleballSession`/`can`/`getSession`/`jsonResponse` (Phase 1), `getSessionPlayer` (Phase 2, for the "does this sessionPlayerId belong to this session" ownership check — apply the generalized Global Constraint here: `sessionPlayerId` in every queue/court body must be confirmed to belong to the target session before use, via `getSessionPlayer(db, sessionId, ???)` — check that function's actual signature from Phase 2's `sessionPlayers.js`; it may take a `playerId` rather than a `sessionPlayerId` directly, in which case you need a different lookup — read the file before writing these routes, don't assume), Task 3-6's engine/repositories/DO.
- Produces: the queue and court management surface this phase delivers.

- [ ] **Step 1: `queue/index.ts` (GET list+explain, POST join)**

```typescript
import type { APIRoute } from 'astro'
import { requirePickleballSession } from '../../../../../../worker/pickleball/authContext.js'
import { can } from '../../../../../../lib/pickleball/permissions'
import { getSession } from '../../../../../../worker/repositories/pickleball/sessions.js'
import { listQueueForSession, listEligibleQueueCandidates, joinQueue } from '../../../../../../worker/repositories/pickleball/queueEntries.js'
import { getSessionPlayerById } from '../../../../../../worker/repositories/pickleball/sessionPlayers.js'
import { selectNextPlayers } from '../../../../../../lib/pickleball/queueEngine'
import { joinQueueSchema } from '../../../../../../lib/schemas/pickleball/queue'
import { jsonResponse } from '../../../../../../worker/utils/responses.js'
import { getEnv } from '../../../../../../lib/env'

export const GET: APIRoute = async ({ request, params }) => {
  const env = getEnv()
  try {
    const session = await requirePickleballSession(request, env)
    const pickleballSession = await getSession(env.PICKLEBALL_DB, params.id, session.activeOrgId)
    if (!pickleballSession) return jsonResponse({ error: 'Not found.' }, 404)

    const queue = await listQueueForSession(env.PICKLEBALL_DB, params.id)
    const eligible = await listEligibleQueueCandidates(env.PICKLEBALL_DB, params.id)
    const { reasons } = selectNextPlayers(eligible, eligible.length, new Date().toISOString())
    const reasonsBySessionPlayerId = Object.fromEntries(reasons.map((r) => [r.sessionPlayerId, r.reasons]))

    return jsonResponse({
      queue: queue.map((entry) => ({ ...entry, reasons: reasonsBySessionPlayerId[entry.sessionPlayerId] || [] })),
    }, 200)
  } catch (error: any) {
    return jsonResponse({ error: error.message }, error.status || 500)
  }
}

export const POST: APIRoute = async ({ request, params }) => {
  const env = getEnv()
  try {
    const session = await requirePickleballSession(request, env)
    const pickleballSession = await getSession(env.PICKLEBALL_DB, params.id, session.activeOrgId)
    if (!pickleballSession) return jsonResponse({ error: 'Not found.' }, 404)

    if (!can(session.role, 'MANAGE_QUEUE')) {
      return jsonResponse({ error: 'Forbidden.' }, 403)
    }

    const result = joinQueueSchema.safeParse(await request.json().catch(() => null))
    if (!result.success) {
      return jsonResponse({ error: 'Validation failed.', issues: result.error.issues }, 400)
    }

    // Ownership check: confirm sessionPlayerId belongs to THIS session
    // before use (Global Constraint — generalized from Phase 2's playerId
    // IDOR fix, applied here before it becomes a bug instead of after).
    const sessionPlayer = await getSessionPlayerById(env.PICKLEBALL_DB, params.id, result.data.sessionPlayerId)
    if (!sessionPlayer) {
      return jsonResponse({ error: 'Session player not found in this session.' }, 400)
    }

    const entry = await joinQueue(env.PICKLEBALL_DB, { sessionId: params.id, sessionPlayerId: result.data.sessionPlayerId })
    if (!entry) {
      return jsonResponse({ error: 'Player already has an open queue entry for this session.' }, 409)
    }

    return jsonResponse({ queueEntry: entry }, 201)
  } catch (error: any) {
    return jsonResponse({ error: error.message }, error.status || 500)
  }
}
```

The `getSessionPlayerById` check above is the single most important line in this task given this plan's Global Constraints — it's what Phase 2's final review had to add after the fact for `playerId`; here it ships from the start.

- [ ] **Step 2: `queue/leave.ts`**

```typescript
import type { APIRoute } from 'astro'
import { requirePickleballSession } from '../../../../../../worker/pickleball/authContext.js'
import { can } from '../../../../../../lib/pickleball/permissions'
import { getSession } from '../../../../../../worker/repositories/pickleball/sessions.js'
import { leaveQueue } from '../../../../../../worker/repositories/pickleball/queueEntries.js'
import { leaveQueueSchema } from '../../../../../../lib/schemas/pickleball/queue'
import { jsonResponse } from '../../../../../../worker/utils/responses.js'
import { getEnv } from '../../../../../../lib/env'

export const POST: APIRoute = async ({ request, params }) => {
  const env = getEnv()
  try {
    const session = await requirePickleballSession(request, env)
    const pickleballSession = await getSession(env.PICKLEBALL_DB, params.id, session.activeOrgId)
    if (!pickleballSession) return jsonResponse({ error: 'Not found.' }, 404)

    if (!can(session.role, 'MANAGE_QUEUE')) {
      return jsonResponse({ error: 'Forbidden.' }, 403)
    }

    const result = leaveQueueSchema.safeParse(await request.json().catch(() => null))
    if (!result.success) {
      return jsonResponse({ error: 'Validation failed.', issues: result.error.issues }, 400)
    }

    const left = await leaveQueue(env.PICKLEBALL_DB, params.id, result.data.sessionPlayerId)
    if (!left) {
      return jsonResponse({ error: 'Player has no open QUEUED entry to leave.' }, 409)
    }

    return jsonResponse({ ok: true }, 200)
  } catch (error: any) {
    return jsonResponse({ error: error.message }, error.status || 500)
  }
}
```

- [ ] **Step 3: `courts/index.ts`, `courts/enable.ts`, `courts/disable.ts`**

```typescript
// courts/index.ts
import type { APIRoute } from 'astro'
import { requirePickleballSession } from '../../../../../../worker/pickleball/authContext.js'
import { getSession } from '../../../../../../worker/repositories/pickleball/sessions.js'
import { listSessionCourts } from '../../../../../../worker/repositories/pickleball/sessionCourts.js'
import { jsonResponse } from '../../../../../../worker/utils/responses.js'
import { getEnv } from '../../../../../../lib/env'

export const GET: APIRoute = async ({ request, params }) => {
  const env = getEnv()
  try {
    const session = await requirePickleballSession(request, env)
    const pickleballSession = await getSession(env.PICKLEBALL_DB, params.id, session.activeOrgId)
    if (!pickleballSession) return jsonResponse({ error: 'Not found.' }, 404)

    const courts = await listSessionCourts(env.PICKLEBALL_DB, params.id)
    return jsonResponse({ courts }, 200)
  } catch (error: any) {
    return jsonResponse({ error: error.message }, error.status || 500)
  }
}
```

```typescript
// courts/enable.ts and courts/disable.ts — identical shape, opposite boolean
import type { APIRoute } from 'astro'
import { requirePickleballSession } from '../../../../../../worker/pickleball/authContext.js'
import { can } from '../../../../../../lib/pickleball/permissions'
import { getSession } from '../../../../../../worker/repositories/pickleball/sessions.js'
import { setCourtEnabled } from '../../../../../../worker/repositories/pickleball/sessionCourts.js'
import { assignCourtSchema } from '../../../../../../lib/schemas/pickleball/queue'
import { jsonResponse } from '../../../../../../worker/utils/responses.js'
import { getEnv } from '../../../../../../lib/env'

export const POST: APIRoute = async ({ request, params }) => {
  const env = getEnv()
  try {
    const session = await requirePickleballSession(request, env)
    const pickleballSession = await getSession(env.PICKLEBALL_DB, params.id, session.activeOrgId)
    if (!pickleballSession) return jsonResponse({ error: 'Not found.' }, 404)

    if (!can(session.role, 'MANAGE_QUEUE')) {
      return jsonResponse({ error: 'Forbidden.' }, 403)
    }

    const result = assignCourtSchema.safeParse(await request.json().catch(() => null))
    if (!result.success) {
      return jsonResponse({ error: 'Validation failed.', issues: result.error.issues }, 400)
    }

    const court = await setCourtEnabled(env.PICKLEBALL_DB, params.id, result.data.sessionCourtId, true /* false in disable.ts */)
    if (!court) return jsonResponse({ error: 'Court not found in this session.' }, 404)

    return jsonResponse({ court }, 200)
  } catch (error: any) {
    return jsonResponse({ error: error.message }, error.status || 500)
  }
}
```
(`disable.ts` is identical except the third argument to `setCourtEnabled` is `false`, and the schema/import for the body shape stays `assignCourtSchema` — it's reused here purely because it happens to have the right single-field shape `{ sessionCourtId }`; consider whether reusing that name is confusing enough to warrant a dedicated `sessionCourtIdSchema` alias in Task 5 — your judgment, not required.)

- [ ] **Step 4: `courts/assign.ts`, `courts/replace.ts`, `courts/release.ts`**

```typescript
// courts/assign.ts
import type { APIRoute } from 'astro'
import { requirePickleballSession } from '../../../../../../worker/pickleball/authContext.js'
import { can } from '../../../../../../lib/pickleball/permissions'
import { getSession } from '../../../../../../worker/repositories/pickleball/sessions.js'
import { assignCourtSchema } from '../../../../../../lib/schemas/pickleball/queue'
import { jsonResponse } from '../../../../../../worker/utils/responses.js'
import { getEnv } from '../../../../../../lib/env'

export const POST: APIRoute = async ({ request, params }) => {
  const env = getEnv()
  try {
    const session = await requirePickleballSession(request, env)
    const pickleballSession = await getSession(env.PICKLEBALL_DB, params.id, session.activeOrgId)
    if (!pickleballSession) return jsonResponse({ error: 'Not found.' }, 404)

    if (!can(session.role, 'ASSIGN_COURT')) {
      return jsonResponse({ error: 'Forbidden.' }, 403)
    }

    const result = assignCourtSchema.safeParse(await request.json().catch(() => null))
    if (!result.success) {
      return jsonResponse({ error: 'Validation failed.', issues: result.error.issues }, 400)
    }

    const stub = env.SESSION_COORDINATOR.get(env.SESSION_COORDINATOR.idFromName(params.id))
    const outcome = await stub.assignCourt(params.id, result.data.sessionCourtId)

    if (!outcome.ok) {
      return jsonResponse({ error: outcome.error }, 409)
    }

    return jsonResponse(outcome, 200)
  } catch (error: any) {
    return jsonResponse({ error: error.message }, error.status || 500)
  }
}
```

```typescript
// courts/replace.ts
import type { APIRoute } from 'astro'
import { requirePickleballSession } from '../../../../../../worker/pickleball/authContext.js'
import { can } from '../../../../../../lib/pickleball/permissions'
import { getSession } from '../../../../../../worker/repositories/pickleball/sessions.js'
import { replaceAssignedPlayerSchema } from '../../../../../../lib/schemas/pickleball/queue'
import { jsonResponse } from '../../../../../../worker/utils/responses.js'
import { getEnv } from '../../../../../../lib/env'

export const POST: APIRoute = async ({ request, params }) => {
  const env = getEnv()
  try {
    const session = await requirePickleballSession(request, env)
    const pickleballSession = await getSession(env.PICKLEBALL_DB, params.id, session.activeOrgId)
    if (!pickleballSession) return jsonResponse({ error: 'Not found.' }, 404)

    if (!can(session.role, 'ASSIGN_COURT')) {
      return jsonResponse({ error: 'Forbidden.' }, 403)
    }

    const result = replaceAssignedPlayerSchema.safeParse(await request.json().catch(() => null))
    if (!result.success) {
      return jsonResponse({ error: 'Validation failed.', issues: result.error.issues }, 400)
    }

    const stub = env.SESSION_COORDINATOR.get(env.SESSION_COORDINATOR.idFromName(params.id))
    const outcome = await stub.replaceAssignedPlayer(
      params.id,
      result.data.sessionCourtId,
      result.data.outgoingSessionPlayerId,
      result.data.incomingSessionPlayerId,
      result.data.outgoingDisposition,
    )

    if (!outcome.ok) {
      return jsonResponse({ error: outcome.error }, 409)
    }

    return jsonResponse(outcome, 200)
  } catch (error: any) {
    return jsonResponse({ error: error.message }, error.status || 500)
  }
}
```

```typescript
// courts/release.ts
import type { APIRoute } from 'astro'
import { requirePickleballSession } from '../../../../../../worker/pickleball/authContext.js'
import { can } from '../../../../../../lib/pickleball/permissions'
import { getSession } from '../../../../../../worker/repositories/pickleball/sessions.js'
import { releaseCourtSchema } from '../../../../../../lib/schemas/pickleball/queue'
import { jsonResponse } from '../../../../../../worker/utils/responses.js'
import { getEnv } from '../../../../../../lib/env'

export const POST: APIRoute = async ({ request, params }) => {
  const env = getEnv()
  try {
    const session = await requirePickleballSession(request, env)
    const pickleballSession = await getSession(env.PICKLEBALL_DB, params.id, session.activeOrgId)
    if (!pickleballSession) return jsonResponse({ error: 'Not found.' }, 404)

    if (!can(session.role, 'ASSIGN_COURT')) {
      return jsonResponse({ error: 'Forbidden.' }, 403)
    }

    const result = releaseCourtSchema.safeParse(await request.json().catch(() => null))
    if (!result.success) {
      return jsonResponse({ error: 'Validation failed.', issues: result.error.issues }, 400)
    }

    const stub = env.SESSION_COORDINATOR.get(env.SESSION_COORDINATOR.idFromName(params.id))
    const outcome = await stub.releaseCourt(params.id, result.data.sessionCourtId)

    if (!outcome.ok) {
      return jsonResponse({ error: outcome.error }, 409)
    }

    return jsonResponse(outcome, 200)
  } catch (error: any) {
    return jsonResponse({ error: error.message }, error.status || 500)
  }
}
```

- [ ] **Step 5: Verify**

Run `npx tsc --noEmit -p tsconfig.json` — clean. Then real HTTP verification via `wrangler dev --local` (this worktree/environment should already have a working `.dev.vars` and operator fixture from prior phases — check first, don't recreate blindly): join queue, list queue with reasons, enable/disable a court, assign a court (need 4 checked-in+available+queued players first — register and check in via Phase 2's routes), confirm two courts can be assigned to disjoint player sets, confirm assigning a 3rd time with too few remaining eligible players returns a clean 409. Clean up test data afterward (local only), verify no stray processes remain.

- [ ] **Step 6: Commit**

```bash
git add src/pages/api/pickleball/sessions/[id]/queue src/pages/api/pickleball/sessions/[id]/courts
git commit -m "feat: add Pickleball queue and court-assignment API"
```

---

### Task 8: Cross-org and cross-session ownership audit (self-check task)

**Files:** none created — this is a verification-only task, deliberately inserted as its own step given this plan's Global Constraint about client-supplied foreign keys.

**Interfaces:** none.

- [ ] **Step 1: Audit every route from Task 7 for the ownership-check Global Constraint**

For each of the 8 route files in Task 7, confirm: every `sessionPlayerId` (or `outgoingSessionPlayerId`/`incomingSessionPlayerId`) taken from the request body is checked against the target session before being passed to a repository function or the DO. List each file and either confirm the check is present with a file:line reference, or add it if it's missing (it should already be present from Task 7's Step 1 instruction, but Task 7 explicitly left one check as a "resolve this comment" placeholder — confirm it was actually resolved with real code, not left as a comment, before this task is done).

Also confirm: `sessionCourtId` values are always looked up via `getSessionCourt(db, sessionId, sessionCourtId)` (session-scoped) rather than a bare `courts` table lookup that could reach a court belonging to a different session or organization.

- [ ] **Step 2: Fix anything found, or report that everything already passed**

If everything already checks out, this task's "diff" is empty — say so plainly in the commit message body and skip the commit (nothing to commit). If something was missing, fix it and commit:

```bash
git add -A
git commit -m "fix: close missed session-scoping gaps in Pickleball queue/court routes"
```

---

### Task 9: Playwright e2e coverage, including the concurrency test

**Files:**
- Create: `tests/e2e/pickleball/pickleball-queue.spec.js`

**Interfaces:**
- Consumes: every route from Tasks 7-8.

- [ ] **Step 1: Write the spec**

```javascript
import { test, expect } from '@playwright/test'

async function createSessionWithCheckedInPlayers(request, playerCount) {
  await request.post('/api/pickleball/auth/test-login', { data: { email: 'operator@example.com' } })

  const venueResponse = await request.post('/api/pickleball/venues', { data: { name: `Queue Test Venue ${Date.now()}` } })
  const venueId = (await venueResponse.json()).venue.id

  const courtIds = []
  for (let i = 0; i < 2; i += 1) {
    const courtResponse = await request.post('/api/pickleball/courts', { data: { venueId, name: `Court ${i + 1}` } })
    courtIds.push((await courtResponse.json()).court.id)
  }

  const sessionResponse = await request.post('/api/pickleball/sessions', {
    data: {
      venueId,
      name: `Queue Test Session ${Date.now()}`,
      sessionType: 'OPEN_PLAY',
      scoringRulesetId: 'usap-2026-sideout-11-doubles',
      scheduledStart: '2026-08-30T18:00:00.000Z',
      scheduledEnd: '2026-08-30T22:00:00.000Z',
    },
  })
  const sessionId = (await sessionResponse.json()).session.id

  const courtsListResponse = await request.get(`/api/pickleball/sessions/${sessionId}/courts`)
  const sessionCourts = (await courtsListResponse.json()).courts

  const sessionPlayerIds = []
  for (let i = 0; i < playerCount; i += 1) {
    const playerResponse = await request.post('/api/pickleball/players', { data: { displayName: `Queue Player ${Date.now()}-${i}` } })
    const playerId = (await playerResponse.json()).player.id

    const registerResponse = await request.post(`/api/pickleball/sessions/${sessionId}/players`, { data: { playerId } })
    const sessionPlayerId = (await registerResponse.json()).sessionPlayer.id

    await request.post(`/api/pickleball/sessions/${sessionId}/players/check-in`, { data: { playerId } })
    await request.post(`/api/pickleball/sessions/${sessionId}/queue`, { data: { sessionPlayerId } })

    sessionPlayerIds.push(sessionPlayerId)
  }

  return { sessionId, sessionCourts, sessionPlayerIds }
}

test.describe('Pickleball queue and court assignment', () => {
  test('lists the queue with explainable reasons for each player', async ({ request }) => {
    const { sessionId } = await createSessionWithCheckedInPlayers(request, 2)
    const response = await request.get(`/api/pickleball/sessions/${sessionId}/queue`)
    const body = await response.json()
    expect(body.queue).toHaveLength(2)
    for (const entry of body.queue) {
      expect(entry.reasons.some((r) => r.startsWith('Games played:'))).toBe(true)
      expect(entry.reasons.some((r) => r.startsWith('Queue wait:'))).toBe(true)
    }
  })

  test('assigns a court to the fairness-selected players and marks them ASSIGNED', async ({ request }) => {
    const { sessionId, sessionCourts, sessionPlayerIds } = await createSessionWithCheckedInPlayers(request, 4)

    const assignResponse = await request.post(`/api/pickleball/sessions/${sessionId}/courts/assign`, {
      data: { sessionCourtId: sessionCourts[0].id },
    })
    expect(assignResponse.status()).toBe(200)
    const body = await assignResponse.json()
    expect(body.court.status).toBe('ASSIGNED')
    expect(body.teamA.players.length + body.teamB.players.length).toBe(4)

    const queueResponse = await request.get(`/api/pickleball/sessions/${sessionId}/queue`)
    const queue = (await queueResponse.json()).queue
    const assignedIds = queue.filter((e) => e.status === 'ASSIGNED').map((e) => e.sessionPlayerId)
    expect(assignedIds.sort()).toEqual([...sessionPlayerIds].sort())
  })

  test('rejects assignment when fewer than the required players are eligible', async ({ request }) => {
    const { sessionId, sessionCourts } = await createSessionWithCheckedInPlayers(request, 2)
    const assignResponse = await request.post(`/api/pickleball/sessions/${sessionId}/courts/assign`, {
      data: { sessionCourtId: sessionCourts[0].id },
    })
    expect(assignResponse.status()).toBe(409)
  })

  test('CONCURRENCY: two simultaneous assignments to two different courts never select the same player twice', async ({ request }) => {
    const { sessionId, sessionCourts, sessionPlayerIds } = await createSessionWithCheckedInPlayers(request, 8)
    expect(sessionCourts.length).toBeGreaterThanOrEqual(2)

    const [firstResponse, secondResponse] = await Promise.all([
      request.post(`/api/pickleball/sessions/${sessionId}/courts/assign`, { data: { sessionCourtId: sessionCourts[0].id } }),
      request.post(`/api/pickleball/sessions/${sessionId}/courts/assign`, { data: { sessionCourtId: sessionCourts[1].id } }),
    ])

    expect(firstResponse.status()).toBe(200)
    expect(secondResponse.status()).toBe(200)

    const firstBody = await firstResponse.json()
    const secondBody = await secondResponse.json()

    const firstPlayers = [...firstBody.teamA.players, ...firstBody.teamB.players].map((p) => p.sessionPlayerId)
    const secondPlayers = [...secondBody.teamA.players, ...secondBody.teamB.players].map((p) => p.sessionPlayerId)

    const overlap = firstPlayers.filter((id) => secondPlayers.includes(id))
    expect(overlap).toEqual([])
    expect(new Set([...firstPlayers, ...secondPlayers]).size).toBe(8)
  })

  test('replaces an assigned player and requeues them when disposition is REQUEUE', async ({ request }) => {
    const { sessionId, sessionCourts, sessionPlayerIds } = await createSessionWithCheckedInPlayers(request, 5)

    const assignResponse = await request.post(`/api/pickleball/sessions/${sessionId}/courts/assign`, {
      data: { sessionCourtId: sessionCourts[0].id },
    })
    const assignBody = await assignResponse.json()
    const outgoing = assignBody.teamA.players[0].sessionPlayerId
    const incoming = sessionPlayerIds.find((id) => ![...assignBody.teamA.players, ...assignBody.teamB.players].map((p) => p.sessionPlayerId).includes(id))

    const replaceResponse = await request.post(`/api/pickleball/sessions/${sessionId}/courts/replace`, {
      data: { sessionCourtId: sessionCourts[0].id, outgoingSessionPlayerId: outgoing, incomingSessionPlayerId: incoming, outgoingDisposition: 'REQUEUE' },
    })
    expect(replaceResponse.status()).toBe(200)

    const queueResponse = await request.get(`/api/pickleball/sessions/${sessionId}/queue`)
    const queue = (await queueResponse.json()).queue
    const outgoingEntry = queue.find((e) => e.sessionPlayerId === outgoing)
    expect(outgoingEntry.status).toBe('QUEUED')
  })

  test('releasing a court with AUTO_REQUEUE_ALL requeues all four players', async ({ request }) => {
    const { sessionId, sessionCourts, sessionPlayerIds } = await createSessionWithCheckedInPlayers(request, 4)

    await request.post(`/api/pickleball/sessions/${sessionId}/courts/assign`, { data: { sessionCourtId: sessionCourts[0].id } })
    const releaseResponse = await request.post(`/api/pickleball/sessions/${sessionId}/courts/release`, {
      data: { sessionCourtId: sessionCourts[0].id },
    })
    expect(releaseResponse.status()).toBe(200)
    const body = await releaseResponse.json()
    expect(body.requeued).toBe(true)
    expect(body.releasedSessionPlayerIds.sort()).toEqual([...sessionPlayerIds].sort())

    const courtsResponse = await request.get(`/api/pickleball/sessions/${sessionId}/courts`)
    const court = (await courtsResponse.json()).courts.find((c) => c.id === sessionCourts[0].id)
    expect(court.status).toBe('AVAILABLE')

    const queueResponse = await request.get(`/api/pickleball/sessions/${sessionId}/queue`)
    const queue = (await queueResponse.json()).queue
    expect(queue.filter((e) => e.status === 'QUEUED')).toHaveLength(4)
  })

  test('a SCOREKEEPER cannot assign a court', async ({ request }) => {
    const { sessionId, sessionCourts } = await createSessionWithCheckedInPlayers(request, 4)

    const sessionInfoResponse = await request.get('/api/pickleball/auth/session')
    const { activeOrgId } = await sessionInfoResponse.json()
    await request.post(`/api/pickleball/organizations/${activeOrgId}/memberships`, {
      data: { invitedEmail: 'scorekeeper-queue@example.com', role: 'SCOREKEEPER' },
    })
    await request.post('/api/pickleball/auth/test-login', { data: { email: 'scorekeeper-queue@example.com' } })

    const response = await request.post(`/api/pickleball/sessions/${sessionId}/courts/assign`, {
      data: { sessionCourtId: sessionCourts[0].id },
    })
    expect(response.status()).toBe(403)
  })
})
```

- [ ] **Step 2: Run the suite**

Run: `npx playwright test --project=worker tests/e2e/pickleball/pickleball-queue.spec.js`
Expected: all tests pass, INCLUDING the concurrency test — this is the one that actually exercises the DO's serialization guarantee for real, not just in theory. If it's flaky, that's a real signal something is wrong with the DO's atomicity, not a test to retry until it passes. **Before finishing, verify no stray `wrangler`/`workerd`/`esbuild` process remains.**

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/pickleball/pickleball-queue.spec.js
git commit -m "test: add Pickleball queue and court-assignment e2e coverage, including the concurrency test"
```

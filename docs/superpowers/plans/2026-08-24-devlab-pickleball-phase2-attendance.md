# Devlab Pickleball — Phase 2 (Attendance) Implementation Plan

> **Superseded (2026-10-12).** This describes the logged-in operator app, retired in 2.0.0 by Phase 5 of `docs/superpowers/specs/2026-10-11-pickleball-free-open-play-design.md`. Kept as history: the routes, tables and files it names no longer exist.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add session registration, check-in (individual + bulk), availability transitions, and leaving/canceling — the four independent attendance dimensions the design spec requires — as a state machine enforced server-side, with the dashboard counts the facilitator UI will need.

**Architecture:** A new `session_players` table (one row per player registered into a session) with three independent status columns (`registration_status`, `attendance_status`, `availability_status` — never collapsed into one enum). A pure, dependency-free state-machine module gates every transition; API routes call it for a clean error before the repository's own `WHERE`-clause guard enforces the same rule at the data layer. Every route re-validates the target session belongs to the caller's organization before touching any child row — the same ownership-check pattern Phase 1's final review established after catching a cross-tenant gap.

**Tech Stack:** Same as Phase 1 — Astro API routes, Cloudflare D1 raw SQL repositories, Zod, Vitest (pure logic), Playwright (`worker` project).

**Spec:** `docs/superpowers/specs/2026-08-24-devlab-pickleball-design.md` (§4.5, §9, §11, §41, §57 edge cases 10/11/15)

## Global Constraints

- `session_players` has NO `organization_id` column (matches spec §4.5) — every route MUST first call `getSession(db, sessionId, session.activeOrgId)` and return 404 if it's null, before reading or writing any `session_players` row. This is how tenancy scoping happens for every child-of-session table in this phase (the pattern Phase 1's final review required after finding a cross-tenant gap on `scoringRulesetId`).
- Every API response goes through `jsonResponse(body, status, headers)` from `src/worker/utils/responses.js` — never a bare `new Response(JSON.stringify(...), {status})`. Phase 1's final review found every Phase 1 route had skipped this helper; do not repeat that.
- Registration, attendance, and availability remain three independent columns, never collapsed into one status field (explicit design requirement, §9 of the brief this spec implements).
- Zod validates every write endpoint's body; failures return `{ error: 'Validation failed.', issues: result.error.issues }` with HTTP 400.
- `CHECK_IN_PLAYERS` (already defined in `src/lib/pickleball/permissions.ts`, Phase 1) gates every mutating route in this phase — ADMIN and SESSION_FACILITATOR hold it, SCOREKEEPER does not.
- All primary keys `TEXT` UUIDs, timestamps ISO-8601 UTC `TEXT`, enums as `CHECK` constraints, index names `idx_<table>_<cols>` — same convention as `migrations/pickleball/0001_foundation.sql`.
- Migrations are additive-only.

---

## File Structure

```
migrations/pickleball/0003_session_players.sql          new

src/lib/pickleball/attendance.ts                          new — pure state machine + counts
src/lib/pickleball/attendance.test.ts                      new

src/worker/repositories/pickleball/sessionPlayers.js        new
src/lib/schemas/pickleball/sessionPlayers.ts                 new

src/pages/api/pickleball/sessions/[id]/players/index.ts               new — GET (list+counts), POST (register)
src/pages/api/pickleball/sessions/[id]/players/check-in.ts             new — POST (single check-in)
src/pages/api/pickleball/sessions/[id]/players/check-in-bulk.ts         new — POST (bulk check-in)
src/pages/api/pickleball/sessions/[id]/players/availability.ts          new — POST (set availability)
src/pages/api/pickleball/sessions/[id]/players/leave.ts                  new — POST (mark left session)
src/pages/api/pickleball/sessions/[id]/players/cancel.ts                 new — POST (cancel registration)

tests/e2e/pickleball/pickleball-attendance.spec.js         new
```

All six route files live in the same directory (`sessions/[id]/players/`), all at the same depth — 6 levels below `src/` (`pages/api/pickleball/sessions/[id]/players/`), so every one needs exactly `../../../../../../` (6 `../`) to reach `src/lib/` or `src/worker/`. Verify this with `tsc --noEmit`, don't just count by eye.

---

### Task 1: Migration — `session_players`

**Files:**
- Create: `migrations/pickleball/0003_session_players.sql`

**Interfaces:**
- Produces: table `session_players` — consumed by every task below.

- [ ] **Step 1: Write the migration**

```sql
-- Pickleball Phase 2: attendance. Registration, attendance, and
-- availability are three independent columns on purpose — see
-- docs/superpowers/specs/2026-08-24-devlab-pickleball-design.md §4.5.
-- No organization_id column here: tenancy is scoped transitively through
-- session_id -> pickleball_sessions.organization_id, checked at the API
-- layer (same pattern Phase 1's final review required elsewhere).

CREATE TABLE IF NOT EXISTS session_players (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  registration_status TEXT NOT NULL DEFAULT 'REGISTERED' CHECK (registration_status IN ('REGISTERED', 'CANCELLED')),
  attendance_status TEXT NOT NULL DEFAULT 'NOT_CHECKED_IN' CHECK (attendance_status IN ('NOT_CHECKED_IN', 'CHECKED_IN', 'LEFT_SESSION')),
  availability_status TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK (availability_status IN ('AVAILABLE', 'TEMPORARILY_UNAVAILABLE', 'RESTING')),
  checked_in_at TEXT,
  games_played INTEGER NOT NULL DEFAULT 0,
  registered_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES pickleball_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_session_players_session_player ON session_players(session_id, player_id);
CREATE INDEX IF NOT EXISTS idx_session_players_session_attendance ON session_players(session_id, attendance_status);
```

- [ ] **Step 2: Apply locally and verify**

Run:
```bash
npx wrangler d1 migrations apply devlab-pickleball --local
npx wrangler d1 execute devlab-pickleball --local --command "SELECT name FROM sqlite_master WHERE type='table' AND name='session_players'"
```
Expected: one row returned.

- [ ] **Step 3: Commit**

```bash
git add migrations/pickleball/0003_session_players.sql
git commit -m "feat: add Pickleball session_players attendance migration"
```

---

### Task 2: Attendance state machine (pure functions + counts)

**Files:**
- Create: `src/lib/pickleball/attendance.ts`
- Test: `src/lib/pickleball/attendance.test.ts`

**Interfaces:**
- Produces: `type RegistrationStatus`, `type AttendanceStatus`, `type AvailabilityStatus`, `interface SessionPlayerState { registrationStatus, attendanceStatus, availabilityStatus }`, `canCheckIn(state): boolean`, `canSetAvailability(state): boolean`, `canLeaveSession(state): boolean`, `canCancelRegistration(state): boolean`, `interface AttendanceCounts { registered, checkedIn, notArrived, leftSession, available, temporarilyUnavailable, resting }`, `summarizeAttendance(players: SessionPlayerState[]): AttendanceCounts` — consumed by Task 3 (repository WHERE-clause parity) and Task 5 (API route pre-checks and the counts response).

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest'
import { canCheckIn, canSetAvailability, canLeaveSession, canCancelRegistration, summarizeAttendance } from './attendance'

const base = { registrationStatus: 'REGISTERED' as const, attendanceStatus: 'NOT_CHECKED_IN' as const, availabilityStatus: 'AVAILABLE' as const }

describe('canCheckIn', () => {
  it('allows a registered, not-checked-in player', () => {
    expect(canCheckIn(base)).toBe(true)
  })

  it('rejects a cancelled registration', () => {
    expect(canCheckIn({ ...base, registrationStatus: 'CANCELLED' })).toBe(false)
  })

  it('rejects a player already checked in', () => {
    expect(canCheckIn({ ...base, attendanceStatus: 'CHECKED_IN' })).toBe(false)
  })
})

describe('canSetAvailability', () => {
  it('allows a checked-in player', () => {
    expect(canSetAvailability({ ...base, attendanceStatus: 'CHECKED_IN' })).toBe(true)
  })

  it('rejects a player not checked in', () => {
    expect(canSetAvailability(base)).toBe(false)
  })

  it('rejects a player who left the session', () => {
    expect(canSetAvailability({ ...base, attendanceStatus: 'LEFT_SESSION' })).toBe(false)
  })
})

describe('canLeaveSession', () => {
  it('allows a checked-in player', () => {
    expect(canLeaveSession({ ...base, attendanceStatus: 'CHECKED_IN' })).toBe(true)
  })

  it('rejects a player who never checked in', () => {
    expect(canLeaveSession(base)).toBe(false)
  })
})

describe('canCancelRegistration', () => {
  it('allows a registered, not-checked-in player', () => {
    expect(canCancelRegistration(base)).toBe(true)
  })

  it('rejects a player already checked in (must leave, not cancel)', () => {
    expect(canCancelRegistration({ ...base, attendanceStatus: 'CHECKED_IN' })).toBe(false)
  })
})

describe('summarizeAttendance', () => {
  it('matches the spec example counts', () => {
    const players = [
      { registrationStatus: 'REGISTERED' as const, attendanceStatus: 'CHECKED_IN' as const, availabilityStatus: 'AVAILABLE' as const },
      { registrationStatus: 'REGISTERED' as const, attendanceStatus: 'CHECKED_IN' as const, availabilityStatus: 'TEMPORARILY_UNAVAILABLE' as const },
      { registrationStatus: 'REGISTERED' as const, attendanceStatus: 'NOT_CHECKED_IN' as const, availabilityStatus: 'AVAILABLE' as const },
      { registrationStatus: 'REGISTERED' as const, attendanceStatus: 'LEFT_SESSION' as const, availabilityStatus: 'AVAILABLE' as const },
      { registrationStatus: 'CANCELLED' as const, attendanceStatus: 'NOT_CHECKED_IN' as const, availabilityStatus: 'AVAILABLE' as const },
    ]

    expect(summarizeAttendance(players)).toEqual({
      registered: 4,
      checkedIn: 2,
      notArrived: 1,
      leftSession: 1,
      available: 1,
      temporarilyUnavailable: 1,
      resting: 0,
    })
  })

  it('returns all zeros for an empty session', () => {
    expect(summarizeAttendance([])).toEqual({
      registered: 0,
      checkedIn: 0,
      notArrived: 0,
      leftSession: 0,
      available: 0,
      temporarilyUnavailable: 0,
      resting: 0,
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/pickleball/attendance.test.ts`
Expected: FAIL — `attendance.ts` does not exist yet.

- [ ] **Step 3: Implement**

```typescript
export type RegistrationStatus = 'REGISTERED' | 'CANCELLED'
export type AttendanceStatus = 'NOT_CHECKED_IN' | 'CHECKED_IN' | 'LEFT_SESSION'
export type AvailabilityStatus = 'AVAILABLE' | 'TEMPORARILY_UNAVAILABLE' | 'RESTING'

export interface SessionPlayerState {
  registrationStatus: RegistrationStatus
  attendanceStatus: AttendanceStatus
  availabilityStatus: AvailabilityStatus
}

export function canCheckIn(state: SessionPlayerState): boolean {
  return state.registrationStatus === 'REGISTERED' && state.attendanceStatus === 'NOT_CHECKED_IN'
}

export function canSetAvailability(state: SessionPlayerState): boolean {
  return state.attendanceStatus === 'CHECKED_IN'
}

export function canLeaveSession(state: SessionPlayerState): boolean {
  return state.attendanceStatus === 'CHECKED_IN'
}

export function canCancelRegistration(state: SessionPlayerState): boolean {
  return state.registrationStatus === 'REGISTERED' && state.attendanceStatus === 'NOT_CHECKED_IN'
}

export interface AttendanceCounts {
  registered: number
  checkedIn: number
  notArrived: number
  leftSession: number
  available: number
  temporarilyUnavailable: number
  resting: number
}

export function summarizeAttendance(players: SessionPlayerState[]): AttendanceCounts {
  return players.reduce<AttendanceCounts>(
    (counts, player) => ({
      registered: counts.registered + (player.registrationStatus === 'REGISTERED' ? 1 : 0),
      checkedIn: counts.checkedIn + (player.attendanceStatus === 'CHECKED_IN' ? 1 : 0),
      notArrived: counts.notArrived + (player.registrationStatus === 'REGISTERED' && player.attendanceStatus === 'NOT_CHECKED_IN' ? 1 : 0),
      leftSession: counts.leftSession + (player.attendanceStatus === 'LEFT_SESSION' ? 1 : 0),
      available: counts.available + (player.attendanceStatus === 'CHECKED_IN' && player.availabilityStatus === 'AVAILABLE' ? 1 : 0),
      temporarilyUnavailable: counts.temporarilyUnavailable + (player.attendanceStatus === 'CHECKED_IN' && player.availabilityStatus === 'TEMPORARILY_UNAVAILABLE' ? 1 : 0),
      resting: counts.resting + (player.attendanceStatus === 'CHECKED_IN' && player.availabilityStatus === 'RESTING' ? 1 : 0),
    }),
    { registered: 0, checkedIn: 0, notArrived: 0, leftSession: 0, available: 0, temporarilyUnavailable: 0, resting: 0 },
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/pickleball/attendance.test.ts`
Expected: PASS (all cases)

- [ ] **Step 5: Commit**

```bash
git add src/lib/pickleball/attendance.ts src/lib/pickleball/attendance.test.ts
git commit -m "feat: add Pickleball attendance state machine and counts"
```

---

### Task 3: `session_players` repository

**Files:**
- Create: `src/worker/repositories/pickleball/sessionPlayers.js`

**Interfaces:**
- Consumes: `canCheckIn`, `canSetAvailability`, `canLeaveSession`, `canCancelRegistration` (Task 2, mirrored in `WHERE` clauses below, not imported — this is a `.js` file, the `.ts` module stays the route layer's pre-check)
- Produces: `registerPlayer(db, {sessionId, playerId}): Promise<SessionPlayerRow>`, `listSessionPlayers(db, sessionId): Promise<SessionPlayerRow[]>`, `getSessionPlayer(db, sessionId, playerId): Promise<SessionPlayerRow|null>`, `checkInPlayer(db, sessionId, playerId): Promise<SessionPlayerRow|null>`, `bulkCheckIn(db, sessionId, playerIds): Promise<string[]>` (returns the playerIds actually updated), `setAvailability(db, sessionId, playerId, status): Promise<SessionPlayerRow|null>`, `leaveSession(db, sessionId, playerId): Promise<SessionPlayerRow|null>`, `cancelRegistration(db, sessionId, playerId): Promise<SessionPlayerRow|null>` — consumed by Tasks 5-7. A `null` return means the state-machine `WHERE` guard rejected the transition (repository's job is to say "did it happen," not to explain why — the route layer already checked with Task 2's functions before calling in, so a null here is either a race or the same rule; either way the route returns 409).

No Vitest step (DB-touching, verified via Playwright in Task 8, matching the established convention for this repo's D1-touching functions).

- [ ] **Step 1: Implement**

```javascript
import { nowIso } from '../../utils/responses.js'

function toSessionPlayer(row) {
  if (!row) return null
  return {
    id: row.id,
    sessionId: row.session_id,
    playerId: row.player_id,
    displayName: row.display_name,
    registrationStatus: row.registration_status,
    attendanceStatus: row.attendance_status,
    availabilityStatus: row.availability_status,
    checkedInAt: row.checked_in_at,
    gamesPlayed: row.games_played,
    registeredAt: row.registered_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const SESSION_PLAYER_COLUMNS = `sp.id, sp.session_id, sp.player_id, p.display_name, sp.registration_status, sp.attendance_status,
  sp.availability_status, sp.checked_in_at, sp.games_played, sp.registered_at, sp.created_at, sp.updated_at`

export async function listSessionPlayers(db, sessionId) {
  const result = await db
    .prepare(
      `SELECT ${SESSION_PLAYER_COLUMNS}
       FROM session_players sp
       JOIN players p ON p.id = sp.player_id
       WHERE sp.session_id = ?
       ORDER BY p.display_name ASC`,
    )
    .bind(sessionId)
    .all()
  return (result.results || []).map(toSessionPlayer)
}

export async function getSessionPlayer(db, sessionId, playerId) {
  const row = await db
    .prepare(
      `SELECT ${SESSION_PLAYER_COLUMNS}
       FROM session_players sp
       JOIN players p ON p.id = sp.player_id
       WHERE sp.session_id = ? AND sp.player_id = ?`,
    )
    .bind(sessionId, playerId)
    .first()
  return toSessionPlayer(row)
}

export async function registerPlayer(db, { sessionId, playerId }) {
  const id = crypto.randomUUID()
  const timestamp = nowIso()

  await db
    .prepare(
      `INSERT INTO session_players (id, session_id, player_id, registration_status, attendance_status, availability_status, games_played, registered_at, created_at, updated_at)
       VALUES (?, ?, ?, 'REGISTERED', 'NOT_CHECKED_IN', 'AVAILABLE', 0, ?, ?, ?)
       ON CONFLICT(session_id, player_id) DO UPDATE SET
         registration_status = 'REGISTERED',
         updated_at = excluded.updated_at`,
    )
    .bind(id, sessionId, playerId, timestamp, timestamp, timestamp)
    .run()

  return getSessionPlayer(db, sessionId, playerId)
}

export async function checkInPlayer(db, sessionId, playerId) {
  const timestamp = nowIso()
  const result = await db
    .prepare(
      `UPDATE session_players SET attendance_status = 'CHECKED_IN', checked_in_at = ?, updated_at = ?
       WHERE session_id = ? AND player_id = ? AND registration_status = 'REGISTERED' AND attendance_status = 'NOT_CHECKED_IN'`,
    )
    .bind(timestamp, timestamp, sessionId, playerId)
    .run()

  if (!result.meta.changes) return null
  return getSessionPlayer(db, sessionId, playerId)
}

export async function bulkCheckIn(db, sessionId, playerIds) {
  if (!playerIds.length) return []

  const timestamp = nowIso()
  const placeholders = playerIds.map(() => '?').join(', ')

  const eligible = await db
    .prepare(
      `SELECT player_id FROM session_players
       WHERE session_id = ? AND player_id IN (${placeholders}) AND registration_status = 'REGISTERED' AND attendance_status = 'NOT_CHECKED_IN'`,
    )
    .bind(sessionId, ...playerIds)
    .all()

  const eligibleIds = (eligible.results || []).map((row) => row.player_id)
  if (!eligibleIds.length) return []

  const eligiblePlaceholders = eligibleIds.map(() => '?').join(', ')
  await db
    .prepare(
      `UPDATE session_players SET attendance_status = 'CHECKED_IN', checked_in_at = ?, updated_at = ?
       WHERE session_id = ? AND player_id IN (${eligiblePlaceholders})`,
    )
    .bind(timestamp, timestamp, sessionId, ...eligibleIds)
    .run()

  return eligibleIds
}

export async function setAvailability(db, sessionId, playerId, status) {
  const result = await db
    .prepare(
      `UPDATE session_players SET availability_status = ?, updated_at = ?
       WHERE session_id = ? AND player_id = ? AND attendance_status = 'CHECKED_IN'`,
    )
    .bind(status, nowIso(), sessionId, playerId)
    .run()

  if (!result.meta.changes) return null
  return getSessionPlayer(db, sessionId, playerId)
}

export async function leaveSession(db, sessionId, playerId) {
  const result = await db
    .prepare(
      `UPDATE session_players SET attendance_status = 'LEFT_SESSION', updated_at = ?
       WHERE session_id = ? AND player_id = ? AND attendance_status = 'CHECKED_IN'`,
    )
    .bind(nowIso(), sessionId, playerId)
    .run()

  if (!result.meta.changes) return null
  return getSessionPlayer(db, sessionId, playerId)
}

export async function cancelRegistration(db, sessionId, playerId) {
  const result = await db
    .prepare(
      `UPDATE session_players SET registration_status = 'CANCELLED', updated_at = ?
       WHERE session_id = ? AND player_id = ? AND registration_status = 'REGISTERED' AND attendance_status = 'NOT_CHECKED_IN'`,
    )
    .bind(nowIso(), sessionId, playerId)
    .run()

  if (!result.meta.changes) return null
  return getSessionPlayer(db, sessionId, playerId)
}
```

- [ ] **Step 2: Commit**

```bash
git add src/worker/repositories/pickleball/sessionPlayers.js
git commit -m "feat: add Pickleball session_players repository"
```

---

### Task 4: Zod schemas

**Files:**
- Create: `src/lib/schemas/pickleball/sessionPlayers.ts`

**Interfaces:**
- Produces: `registerPlayerSchema` ({ playerId: uuid }), `checkInSchema` ({ playerId: uuid }), `bulkCheckInSchema` ({ playerIds: uuid[], min 1 }), `setAvailabilitySchema` ({ playerId: uuid, status: enum }), `playerIdBodySchema` ({ playerId: uuid }) reused by leave/cancel — consumed by Tasks 5-7.

- [ ] **Step 1: Implement**

```typescript
import { z } from 'zod'

export const registerPlayerSchema = z.object({
  playerId: z.string().uuid(),
})

export const checkInSchema = z.object({
  playerId: z.string().uuid(),
})

export const bulkCheckInSchema = z.object({
  playerIds: z.array(z.string().uuid()).min(1),
})

export const setAvailabilitySchema = z.object({
  playerId: z.string().uuid(),
  status: z.enum(['AVAILABLE', 'TEMPORARILY_UNAVAILABLE', 'RESTING']),
})

export const playerIdBodySchema = z.object({
  playerId: z.string().uuid(),
})

export type RegisterPlayerInput = z.infer<typeof registerPlayerSchema>
export type BulkCheckInInput = z.infer<typeof bulkCheckInSchema>
export type SetAvailabilityInput = z.infer<typeof setAvailabilitySchema>
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/schemas/pickleball/sessionPlayers.ts
git commit -m "feat: add Pickleball session-player Zod schemas"
```

---

### Task 5: API routes — register + list (with counts)

**Files:**
- Create: `src/pages/api/pickleball/sessions/[id]/players/index.ts`

**Interfaces:**
- Consumes: `requirePickleballSession` (Phase 1), `can` (Phase 1), `getSession` (Phase 1, for the org-ownership check), `jsonResponse` (repo convention), `registerPlayer`/`listSessionPlayers` (Task 3), `registerPlayerSchema` (Task 4), `summarizeAttendance` (Task 2)
- Produces: `GET`/`POST` handlers — the response shape `{ players: SessionPlayerRow[], counts: AttendanceCounts }` from GET is what the facilitator dashboard (a later phase) will read; keep it stable.

- [ ] **Step 1: Implement**

```typescript
import type { APIRoute } from 'astro'
import { requirePickleballSession } from '../../../../../../worker/pickleball/authContext.js'
import { can } from '../../../../../../lib/pickleball/permissions'
import { getSession } from '../../../../../../worker/repositories/pickleball/sessions.js'
import { listSessionPlayers, registerPlayer } from '../../../../../../worker/repositories/pickleball/sessionPlayers.js'
import { registerPlayerSchema } from '../../../../../../lib/schemas/pickleball/sessionPlayers'
import { summarizeAttendance } from '../../../../../../lib/pickleball/attendance'
import { jsonResponse } from '../../../../../../worker/utils/responses.js'
import { getEnv } from '../../../../../../lib/env'

export const GET: APIRoute = async ({ request, params }) => {
  const env = getEnv()
  try {
    const session = await requirePickleballSession(request, env)
    const pickleballSession = await getSession(env.PICKLEBALL_DB, params.id, session.activeOrgId)
    if (!pickleballSession) return jsonResponse({ error: 'Not found.' }, 404)

    const players = await listSessionPlayers(env.PICKLEBALL_DB, params.id)
    const counts = summarizeAttendance(players)
    return jsonResponse({ players, counts }, 200)
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

    if (!can(session.role, 'CHECK_IN_PLAYERS')) {
      return jsonResponse({ error: 'Forbidden.' }, 403)
    }

    const result = registerPlayerSchema.safeParse(await request.json().catch(() => null))
    if (!result.success) {
      return jsonResponse({ error: 'Validation failed.', issues: result.error.issues }, 400)
    }

    const sessionPlayer = await registerPlayer(env.PICKLEBALL_DB, { sessionId: params.id, playerId: result.data.playerId })
    return jsonResponse({ sessionPlayer }, 201)
  } catch (error: any) {
    return jsonResponse({ error: error.message }, error.status || 500)
  }
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit -p tsconfig.json` — must be clean (this confirms the 6-level `../` import depth is correct).

- [ ] **Step 3: Commit**

```bash
git add src/pages/api/pickleball/sessions/[id]/players/index.ts
git commit -m "feat: add Pickleball session-player registration and list API"
```

---

### Task 6: API routes — check-in (single + bulk)

**Files:**
- Create: `src/pages/api/pickleball/sessions/[id]/players/check-in.ts`
- Create: `src/pages/api/pickleball/sessions/[id]/players/check-in-bulk.ts`

**Interfaces:**
- Consumes: `checkInPlayer`, `bulkCheckIn` (Task 3), `checkInSchema`, `bulkCheckInSchema` (Task 4)

- [ ] **Step 1: `check-in.ts`**

```typescript
import type { APIRoute } from 'astro'
import { requirePickleballSession } from '../../../../../../worker/pickleball/authContext.js'
import { can } from '../../../../../../lib/pickleball/permissions'
import { getSession } from '../../../../../../worker/repositories/pickleball/sessions.js'
import { checkInPlayer } from '../../../../../../worker/repositories/pickleball/sessionPlayers.js'
import { checkInSchema } from '../../../../../../lib/schemas/pickleball/sessionPlayers'
import { jsonResponse } from '../../../../../../worker/utils/responses.js'
import { getEnv } from '../../../../../../lib/env'

export const POST: APIRoute = async ({ request, params }) => {
  const env = getEnv()
  try {
    const session = await requirePickleballSession(request, env)
    const pickleballSession = await getSession(env.PICKLEBALL_DB, params.id, session.activeOrgId)
    if (!pickleballSession) return jsonResponse({ error: 'Not found.' }, 404)

    if (!can(session.role, 'CHECK_IN_PLAYERS')) {
      return jsonResponse({ error: 'Forbidden.' }, 403)
    }

    const result = checkInSchema.safeParse(await request.json().catch(() => null))
    if (!result.success) {
      return jsonResponse({ error: 'Validation failed.', issues: result.error.issues }, 400)
    }

    const sessionPlayer = await checkInPlayer(env.PICKLEBALL_DB, params.id, result.data.playerId)
    if (!sessionPlayer) {
      return jsonResponse({ error: 'Player is not eligible to check in (already checked in, or registration was cancelled).' }, 409)
    }

    return jsonResponse({ sessionPlayer }, 200)
  } catch (error: any) {
    return jsonResponse({ error: error.message }, error.status || 500)
  }
}
```

- [ ] **Step 2: `check-in-bulk.ts`**

```typescript
import type { APIRoute } from 'astro'
import { requirePickleballSession } from '../../../../../../worker/pickleball/authContext.js'
import { can } from '../../../../../../lib/pickleball/permissions'
import { getSession } from '../../../../../../worker/repositories/pickleball/sessions.js'
import { bulkCheckIn } from '../../../../../../worker/repositories/pickleball/sessionPlayers.js'
import { bulkCheckInSchema } from '../../../../../../lib/schemas/pickleball/sessionPlayers'
import { jsonResponse } from '../../../../../../worker/utils/responses.js'
import { getEnv } from '../../../../../../lib/env'

export const POST: APIRoute = async ({ request, params }) => {
  const env = getEnv()
  try {
    const session = await requirePickleballSession(request, env)
    const pickleballSession = await getSession(env.PICKLEBALL_DB, params.id, session.activeOrgId)
    if (!pickleballSession) return jsonResponse({ error: 'Not found.' }, 404)

    if (!can(session.role, 'CHECK_IN_PLAYERS')) {
      return jsonResponse({ error: 'Forbidden.' }, 403)
    }

    const result = bulkCheckInSchema.safeParse(await request.json().catch(() => null))
    if (!result.success) {
      return jsonResponse({ error: 'Validation failed.', issues: result.error.issues }, 400)
    }

    // Silently skips ineligible ids (already checked in, cancelled) rather
    // than erroring — "check all" must be safe to click more than once.
    const checkedInPlayerIds = await bulkCheckIn(env.PICKLEBALL_DB, params.id, result.data.playerIds)
    return jsonResponse({ checkedInPlayerIds }, 200)
  } catch (error: any) {
    return jsonResponse({ error: error.message }, error.status || 500)
  }
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit -p tsconfig.json` — clean.

- [ ] **Step 4: Commit**

```bash
git add src/pages/api/pickleball/sessions/[id]/players/check-in.ts src/pages/api/pickleball/sessions/[id]/players/check-in-bulk.ts
git commit -m "feat: add Pickleball single and bulk check-in API"
```

---

### Task 7: API routes — availability, leave, cancel

**Files:**
- Create: `src/pages/api/pickleball/sessions/[id]/players/availability.ts`
- Create: `src/pages/api/pickleball/sessions/[id]/players/leave.ts`
- Create: `src/pages/api/pickleball/sessions/[id]/players/cancel.ts`

**Interfaces:**
- Consumes: `setAvailability`, `leaveSession`, `cancelRegistration` (Task 3), `setAvailabilitySchema`, `playerIdBodySchema` (Task 4)

- [ ] **Step 1: `availability.ts`**

```typescript
import type { APIRoute } from 'astro'
import { requirePickleballSession } from '../../../../../../worker/pickleball/authContext.js'
import { can } from '../../../../../../lib/pickleball/permissions'
import { getSession } from '../../../../../../worker/repositories/pickleball/sessions.js'
import { setAvailability } from '../../../../../../worker/repositories/pickleball/sessionPlayers.js'
import { setAvailabilitySchema } from '../../../../../../lib/schemas/pickleball/sessionPlayers'
import { jsonResponse } from '../../../../../../worker/utils/responses.js'
import { getEnv } from '../../../../../../lib/env'

export const POST: APIRoute = async ({ request, params }) => {
  const env = getEnv()
  try {
    const session = await requirePickleballSession(request, env)
    const pickleballSession = await getSession(env.PICKLEBALL_DB, params.id, session.activeOrgId)
    if (!pickleballSession) return jsonResponse({ error: 'Not found.' }, 404)

    if (!can(session.role, 'CHECK_IN_PLAYERS')) {
      return jsonResponse({ error: 'Forbidden.' }, 403)
    }

    const result = setAvailabilitySchema.safeParse(await request.json().catch(() => null))
    if (!result.success) {
      return jsonResponse({ error: 'Validation failed.', issues: result.error.issues }, 400)
    }

    const sessionPlayer = await setAvailability(env.PICKLEBALL_DB, params.id, result.data.playerId, result.data.status)
    if (!sessionPlayer) {
      return jsonResponse({ error: 'Player must be checked in to change availability.' }, 409)
    }

    return jsonResponse({ sessionPlayer }, 200)
  } catch (error: any) {
    return jsonResponse({ error: error.message }, error.status || 500)
  }
}
```

- [ ] **Step 2: `leave.ts`**

```typescript
import type { APIRoute } from 'astro'
import { requirePickleballSession } from '../../../../../../worker/pickleball/authContext.js'
import { can } from '../../../../../../lib/pickleball/permissions'
import { getSession } from '../../../../../../worker/repositories/pickleball/sessions.js'
import { leaveSession } from '../../../../../../worker/repositories/pickleball/sessionPlayers.js'
import { playerIdBodySchema } from '../../../../../../lib/schemas/pickleball/sessionPlayers'
import { jsonResponse } from '../../../../../../worker/utils/responses.js'
import { getEnv } from '../../../../../../lib/env'

export const POST: APIRoute = async ({ request, params }) => {
  const env = getEnv()
  try {
    const session = await requirePickleballSession(request, env)
    const pickleballSession = await getSession(env.PICKLEBALL_DB, params.id, session.activeOrgId)
    if (!pickleballSession) return jsonResponse({ error: 'Not found.' }, 404)

    if (!can(session.role, 'CHECK_IN_PLAYERS')) {
      return jsonResponse({ error: 'Forbidden.' }, 403)
    }

    const result = playerIdBodySchema.safeParse(await request.json().catch(() => null))
    if (!result.success) {
      return jsonResponse({ error: 'Validation failed.', issues: result.error.issues }, 400)
    }

    const sessionPlayer = await leaveSession(env.PICKLEBALL_DB, params.id, result.data.playerId)
    if (!sessionPlayer) {
      return jsonResponse({ error: 'Player must be checked in to leave the session.' }, 409)
    }

    return jsonResponse({ sessionPlayer }, 200)
  } catch (error: any) {
    return jsonResponse({ error: error.message }, error.status || 500)
  }
}
```

- [ ] **Step 3: `cancel.ts`**

```typescript
import type { APIRoute } from 'astro'
import { requirePickleballSession } from '../../../../../../worker/pickleball/authContext.js'
import { can } from '../../../../../../lib/pickleball/permissions'
import { getSession } from '../../../../../../worker/repositories/pickleball/sessions.js'
import { cancelRegistration } from '../../../../../../worker/repositories/pickleball/sessionPlayers.js'
import { playerIdBodySchema } from '../../../../../../lib/schemas/pickleball/sessionPlayers'
import { jsonResponse } from '../../../../../../worker/utils/responses.js'
import { getEnv } from '../../../../../../lib/env'

export const POST: APIRoute = async ({ request, params }) => {
  const env = getEnv()
  try {
    const session = await requirePickleballSession(request, env)
    const pickleballSession = await getSession(env.PICKLEBALL_DB, params.id, session.activeOrgId)
    if (!pickleballSession) return jsonResponse({ error: 'Not found.' }, 404)

    if (!can(session.role, 'CHECK_IN_PLAYERS')) {
      return jsonResponse({ error: 'Forbidden.' }, 403)
    }

    const result = playerIdBodySchema.safeParse(await request.json().catch(() => null))
    if (!result.success) {
      return jsonResponse({ error: 'Validation failed.', issues: result.error.issues }, 400)
    }

    const sessionPlayer = await cancelRegistration(env.PICKLEBALL_DB, params.id, result.data.playerId)
    if (!sessionPlayer) {
      return jsonResponse({ error: 'Only a not-checked-in registration can be cancelled.' }, 409)
    }

    return jsonResponse({ sessionPlayer }, 200)
  } catch (error: any) {
    return jsonResponse({ error: error.message }, error.status || 500)
  }
}
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit -p tsconfig.json` — clean.

- [ ] **Step 5: Commit**

```bash
git add src/pages/api/pickleball/sessions/[id]/players/availability.ts src/pages/api/pickleball/sessions/[id]/players/leave.ts src/pages/api/pickleball/sessions/[id]/players/cancel.ts
git commit -m "feat: add Pickleball availability, leave, and cancel-registration API"
```

---

### Task 8: Playwright e2e coverage

**Files:**
- Create: `tests/e2e/pickleball/pickleball-attendance.spec.js`
- Modify: `playwright.config.js` if the new spec file isn't already covered by the existing `tests/e2e/pickleball/**/*.spec.js` pattern (check first — Phase 1 already added that broader pattern; this file should already be included, but confirm).

**Interfaces:**
- Consumes: every route from Tasks 5-7. Reuses the `operator@example.com` ADMIN fixture and the cross-org fixture organization from Phase 1 (`scripts/pickleball/apply-e2e-fixtures.mjs`) if a second session/player fixture is needed — check what already exists before adding new fixture rows; prefer creating fresh venues/sessions/players via the already-built CRUD API inside a `beforeAll`/test body over adding more raw-SQL fixtures.

- [ ] **Step 1: Write the spec**

```javascript
import { test, expect } from '@playwright/test'

test.describe('Pickleball attendance', () => {
  let venueId
  let sessionId
  let playerId

  test.beforeEach(async ({ request }) => {
    await request.post('/api/pickleball/auth/test-login', { data: { email: 'operator@example.com' } })

    const venueResponse = await request.post('/api/pickleball/venues', {
      data: { name: 'Attendance Test Venue' },
    })
    venueId = (await venueResponse.json()).venue.id

    const sessionResponse = await request.post('/api/pickleball/sessions', {
      data: {
        venueId,
        name: 'Attendance Test Session',
        sessionType: 'OPEN_PLAY',
        scoringRulesetId: 'usap-2026-sideout-11-doubles',
        scheduledStart: '2026-08-30T18:00:00.000Z',
        scheduledEnd: '2026-08-30T22:00:00.000Z',
      },
    })
    sessionId = (await sessionResponse.json()).session.id

    const playerResponse = await request.post('/api/pickleball/players', {
      data: { displayName: `Attendance Player ${Date.now()}` },
    })
    playerId = (await playerResponse.json()).player.id
  })

  test('registered-but-not-arrived player cannot check in twice, and blocks nothing else', async ({ request }) => {
    const registerResponse = await request.post(`/api/pickleball/sessions/${sessionId}/players`, { data: { playerId } })
    expect(registerResponse.status()).toBe(201)

    const listBefore = await request.get(`/api/pickleball/sessions/${sessionId}/players`)
    const bodyBefore = await listBefore.json()
    expect(bodyBefore.counts.registered).toBe(1)
    expect(bodyBefore.counts.notArrived).toBe(1)
    expect(bodyBefore.counts.checkedIn).toBe(0)

    const checkInResponse = await request.post(`/api/pickleball/sessions/${sessionId}/players/check-in`, { data: { playerId } })
    expect(checkInResponse.status()).toBe(200)
    const checkedInBody = await checkInResponse.json()
    expect(checkedInBody.sessionPlayer.attendanceStatus).toBe('CHECKED_IN')

    const secondCheckIn = await request.post(`/api/pickleball/sessions/${sessionId}/players/check-in`, { data: { playerId } })
    expect(secondCheckIn.status()).toBe(409)

    const listAfter = await request.get(`/api/pickleball/sessions/${sessionId}/players`)
    const bodyAfter = await listAfter.json()
    expect(bodyAfter.counts.checkedIn).toBe(1)
    expect(bodyAfter.counts.notArrived).toBe(0)
  })

  test('late arrival: check-in timestamp is set at check-in time, not registration time', async ({ request }) => {
    await request.post(`/api/pickleball/sessions/${sessionId}/players`, { data: { playerId } })
    const before = Date.now()
    const checkInResponse = await request.post(`/api/pickleball/sessions/${sessionId}/players/check-in`, { data: { playerId } })
    const body = await checkInResponse.json()
    const checkedInAtMs = new Date(body.sessionPlayer.checkedInAt).getTime()
    expect(checkedInAtMs).toBeGreaterThanOrEqual(before)
  })

  test('bulk check-in is idempotent and skips ineligible players', async ({ request }) => {
    const secondPlayerResponse = await request.post('/api/pickleball/players', { data: { displayName: `Bulk Player ${Date.now()}` } })
    const secondPlayerId = (await secondPlayerResponse.json()).player.id

    await request.post(`/api/pickleball/sessions/${sessionId}/players`, { data: { playerId } })
    await request.post(`/api/pickleball/sessions/${sessionId}/players`, { data: { playerId: secondPlayerId } })

    const firstBulk = await request.post(`/api/pickleball/sessions/${sessionId}/players/check-in-bulk`, {
      data: { playerIds: [playerId, secondPlayerId] },
    })
    const firstBody = await firstBulk.json()
    expect(firstBody.checkedInPlayerIds.sort()).toEqual([playerId, secondPlayerId].sort())

    const secondBulk = await request.post(`/api/pickleball/sessions/${sessionId}/players/check-in-bulk`, {
      data: { playerIds: [playerId, secondPlayerId] },
    })
    const secondBody = await secondBulk.json()
    expect(secondBody.checkedInPlayerIds).toEqual([])
  })

  test('availability requires check-in first, then transitions correctly', async ({ request }) => {
    await request.post(`/api/pickleball/sessions/${sessionId}/players`, { data: { playerId } })

    const beforeCheckIn = await request.post(`/api/pickleball/sessions/${sessionId}/players/availability`, {
      data: { playerId, status: 'RESTING' },
    })
    expect(beforeCheckIn.status()).toBe(409)

    await request.post(`/api/pickleball/sessions/${sessionId}/players/check-in`, { data: { playerId } })

    const afterCheckIn = await request.post(`/api/pickleball/sessions/${sessionId}/players/availability`, {
      data: { playerId, status: 'RESTING' },
    })
    expect(afterCheckIn.status()).toBe(200)
    const body = await afterCheckIn.json()
    expect(body.sessionPlayer.availabilityStatus).toBe('RESTING')
  })

  test('a player who leaves is excluded from checked-in counts and cannot re-check-in without facilitator override', async ({ request }) => {
    await request.post(`/api/pickleball/sessions/${sessionId}/players`, { data: { playerId } })
    await request.post(`/api/pickleball/sessions/${sessionId}/players/check-in`, { data: { playerId } })

    const leaveResponse = await request.post(`/api/pickleball/sessions/${sessionId}/players/leave`, { data: { playerId } })
    expect(leaveResponse.status()).toBe(200)

    const list = await request.get(`/api/pickleball/sessions/${sessionId}/players`)
    const body = await list.json()
    expect(body.counts.leftSession).toBe(1)
    expect(body.counts.checkedIn).toBe(0)

    const reCheckIn = await request.post(`/api/pickleball/sessions/${sessionId}/players/check-in`, { data: { playerId } })
    expect(reCheckIn.status()).toBe(409)
  })

  test('cancelling a registration before check-in works; cancelling after check-in is rejected', async ({ request }) => {
    await request.post(`/api/pickleball/sessions/${sessionId}/players`, { data: { playerId } })

    const cancelResponse = await request.post(`/api/pickleball/sessions/${sessionId}/players/cancel`, { data: { playerId } })
    expect(cancelResponse.status()).toBe(200)

    const secondPlayerResponse = await request.post('/api/pickleball/players', { data: { displayName: `Cancel Player ${Date.now()}` } })
    const secondPlayerId = (await secondPlayerResponse.json()).player.id
    await request.post(`/api/pickleball/sessions/${sessionId}/players`, { data: { playerId: secondPlayerId } })
    await request.post(`/api/pickleball/sessions/${sessionId}/players/check-in`, { data: { playerId: secondPlayerId } })

    const cancelAfterCheckIn = await request.post(`/api/pickleball/sessions/${sessionId}/players/cancel`, { data: { playerId: secondPlayerId } })
    expect(cancelAfterCheckIn.status()).toBe(409)
  })

  test('a SCOREKEEPER cannot check in players', async ({ request }) => {
    const sessionResponse = await request.get('/api/pickleball/auth/session')
    const { activeOrgId } = await sessionResponse.json()

    await request.post(`/api/pickleball/organizations/${activeOrgId}/memberships`, {
      data: { invitedEmail: 'scorekeeper-attendance@example.com', role: 'SCOREKEEPER' },
    })
    await request.post('/api/pickleball/auth/test-login', { data: { email: 'scorekeeper-attendance@example.com' } })

    const response = await request.post(`/api/pickleball/sessions/${sessionId}/players/check-in`, { data: { playerId } })
    expect(response.status()).toBe(403)
  })
})
```

- [ ] **Step 2: Run the suite**

Run: `npx playwright test --project=worker tests/e2e/pickleball/pickleball-attendance.spec.js`
Expected: all tests pass. **Before finishing, verify no stray `wrangler`/`workerd`/`esbuild` process remains** (`Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'wrangler|workerd' }` or `tasklist`) — a prior phase's leftover processes once blocked later work; do not repeat that.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/pickleball/pickleball-attendance.spec.js
git commit -m "test: add Pickleball attendance e2e coverage"
```

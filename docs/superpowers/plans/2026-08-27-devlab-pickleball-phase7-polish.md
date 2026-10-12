# Devlab Pickleball Phase 7 (Polish) Implementation Plan

> **Superseded (2026-10-12).** This describes the logged-in operator app, retired in 2.0.0 by Phase 5 of `docs/superpowers/specs/2026-10-11-pickleball-free-open-play-design.md`. Kept as history: the routes, tables and files it names no longer exist.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close out the Devlab Pickleball sub-project's final phase: an accountability-focused audit log (schema, write points, ADMIN-only UI), an operators/roles management UI, a consolidated facilitator dashboard, and the remaining documentation deliverables.

**Architecture:** A new `audit_events` D1 table plus a single `recordAuditEvent`/`listAuditEvents` repository pair, wired into a deliberately narrow set of accountability-critical mutation points (not every command — see Global Constraints). A new ADMIN-only membership-revoke endpoint completes the operator-lifecycle API that already exists (invite/list). Two new SPA pages (`/operators`, `/audit`) consume these, gated behind a new permission-aware nav filter. The dashboard is rewritten to pull real data from already-shipped endpoints. Four markdown docs are authored/transcribed from the spec and the real, already-built system.

**Tech Stack:** Astro API routes, D1 (via `env.PICKLEBALL_DB`), the existing `src/worker/repositories/pickleball/` repository layer, React Router SPA (`src/pickleball-app/`), Zod (no new schemas needed — the one new write endpoint has no request body), Playwright e2e (`worker` project), Vitest.

**Spec:** `docs/superpowers/specs/2026-08-24-devlab-pickleball-design.md` — this plan implements §14 Phase 7 ("audit log UI, facilitator dashboard consolidation, documentation"), drawing on §3.4 (permission matrix), §4.9 (audit_events schema), §11 (routes), and §16 (documentation deliverables).

## Global Constraints

- This is the LAST plan in the Phases 5-7 sub-project. After it lands, the branch is finished per `superpowers:finishing-a-development-branch` — task scope must genuinely close out Phase 7, not leave an implicit Phase 8.
- Working tree: `C:\Users\agust\Programming\devlab-studios\.claude\worktrees\pickleball-phase5-7` (branch `worktree-pickleball-phase5-7`). Do not create a new worktree. Base commit for this plan: `7c48ec0` (Plan E's completion commit), Vitest 177/177 passing at that point.
- House style, established across every prior phase and followed here without exception: `pickleballApi` client for SPA fetches, `message: {type, text}` error-rendering convention, `useOutletContext()` for data AppShell already has, `jsonResponse`/`nowIso` worker utils, Zod schemas only where a request body needs validation, `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` migration guards, never edit an applied migration.
- Every new/modified SPA page that reads a value from `useOutletContext()` or a route param that can change without an unmount MUST apply the render-phase `fetchKey`/`currentKey` reset pattern established in `LeaderboardPage.jsx` and `PlayerProfilePage.jsx` (Plan E) from the start — this bug class recurred three times in the previous plan and is not acceptable as a "later" fix here.
- **Ruling — `/settings` (Configure System Defaults) is OUT OF SCOPE for this plan.** The spec defines a `CONFIGURE_SYSTEM_DEFAULTS` permission (§3.4) and reserves a `/settings` (ADMIN) route slot (§11), but nowhere in the spec's data model or requirements does it name a single concrete configurable default — no `organization_settings` table, no field list, no described behavior. Building a settings page would mean inventing requirements the spec never stated, which violates this plan's "no placeholders" discipline as much as leaving a step vague would. Deferred until the spec is extended to define actual settings.
- **Ruling — audit log write coverage is intentionally narrow, not exhaustive.** `audit_events` is wired into exactly 3 action families this plan adds: operator invited, operator role changed, operator revoked (all via the membership endpoints), plus game corrected and game reopened (the two actions §57's edge-case table #20-21 singles out for "full stat invalidate-and-recompute" and which the permission matrix restricts to ADMIN/FACILITATOR only). Every other mutating command (check-in, queue join/leave, court assignment, session/venue/player CRUD) is deliberately NOT wired into `audit_events` in this pass: those domains already have their own durable, queryable trail (`session_players`/`queue_entries` rows retained per §57 edge cases #12/#15, and the append-only `score_events` log for in-game scoring — see the code comment at `SessionCoordinatorDO.ts:809`). Exhaustively wiring audit writes into every command handler in the system is a materially larger, differently-scoped undertaking than fits a "Polish" phase; a future increment can widen coverage using the exact `recordAuditEvent(db, {...})` primitive this plan establishes, at any call site, with no schema change needed.
- **Already satisfied, not touched by this plan:** `docs/architecture/decisions/0006-pickleball-durable-objects.md` (the ADR §16 requires) and `docs/pickleball/runbook.md` (one of §16's five docs) both already exist and are complete — built during the realtime-infrastructure phase, earlier in this sub-project. Do not recreate or duplicate them.
- **Already satisfied, not touched by this plan:** the spec's top-level `/courts` route (§11) was never built as a separate page — court management already lives at `/pickleball/app/venues` (`VenuesPage.jsx`, built in an earlier phase), which manages courts nested under their venue. This is a minor, harmless route-naming deviation from an earlier phase, not a Phase 7 gap; do not rebuild or rename it.
- Test baseline to preserve: `npx vitest run` must stay green throughout (177 passing at plan start; grows as tasks add tests). Playwright: run new/modified spec files individually via `npx playwright test tests/e2e/pickleball/<file>.spec.js --project=worker` — a full-suite single invocation can crash a local `wrangler dev` on this machine (a known, pre-existing environment issue unrelated to this plan's code).
- **Task order matters here**: Task 2 (the audit-events read API) is deliberately sequenced right after Task 1 (schema/repo), ahead of the tasks that WRITE audit events (Tasks 3-4), so that every write-side task's e2e test can assert against a real, already-existing read endpoint instead of a forward dependency on a not-yet-built route.

---

### Task 1: `audit_events` schema and repository

**Files:**
- Create: `migrations/pickleball/0010_audit_events.sql`
- Create: `src/worker/repositories/pickleball/auditEvents.js`

**Interfaces:**
- Produces: `recordAuditEvent(db, { organizationId, sessionId, actorUserId, action, entityType, entityId, previousState, newState, metadata }): Promise<string>` (returns the new row's id) and `listAuditEvents(db, organizationId, { limit, offset }): Promise<AuditEvent[]>` where `AuditEvent = { id, organizationId, sessionId, actorUserId, actorEmail, actorName, action, entityType, entityId, previousState, newState, metadata, createdAt }` (camelCase, `previousState`/`newState`/`metadata` already `JSON.parse`d back into objects, `actorEmail`/`actorName` from a join against `users`). Task 2's route and Tasks 3-4's write points consume these two functions.

- [ ] **Step 1: Write the migration**

```sql
-- Phase 7: append-only accountability trail for admin-visible operator
-- actions. Deliberately NOT wired into every mutating command in the
-- system (see this plan's Global Constraints for the disclosed scope
-- ruling) -- covers operator/role changes and game corrections/reopens,
-- the two areas the spec's own permission matrix (section3.4) and
-- edge-case table (section57 #20-21) single out as accountability-
-- sensitive. Other domains already have their own append-only trail
-- (score_events for in-game scoring).

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  session_id TEXT,
  actor_user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  previous_state_json TEXT,
  new_state_json TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_audit_events_org_created
  ON audit_events(organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_events_entity
  ON audit_events(entity_type, entity_id);
```

- [ ] **Step 2: Apply the migration locally**

Run: `npx wrangler d1 migrations apply devlab-pickleball --local`
Expected: `0010_audit_events.sql` applied with no errors.

- [ ] **Step 3: Write the repository**

```js
// src/worker/repositories/pickleball/auditEvents.js
import { nowIso } from '../../utils/responses.js'

function toAuditEvent(row) {
  if (!row) return null
  return {
    id: row.id,
    organizationId: row.organization_id,
    sessionId: row.session_id,
    actorUserId: row.actor_user_id,
    actorEmail: row.actor_email || null,
    actorName: row.actor_name || null,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    previousState: row.previous_state_json ? JSON.parse(row.previous_state_json) : null,
    newState: row.new_state_json ? JSON.parse(row.new_state_json) : null,
    metadata: row.metadata_json ? JSON.parse(row.metadata_json) : null,
    createdAt: row.created_at,
  }
}

export async function recordAuditEvent(db, { organizationId, sessionId, actorUserId, action, entityType, entityId, previousState, newState, metadata }) {
  const id = crypto.randomUUID()
  await db
    .prepare(
      `INSERT INTO audit_events (id, organization_id, session_id, actor_user_id, action, entity_type, entity_id, previous_state_json, new_state_json, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      organizationId,
      sessionId || null,
      actorUserId,
      action,
      entityType,
      entityId,
      previousState ? JSON.stringify(previousState) : null,
      newState ? JSON.stringify(newState) : null,
      metadata ? JSON.stringify(metadata) : null,
      nowIso(),
    )
    .run()
  return id
}

export async function listAuditEvents(db, organizationId, { limit = 50, offset = 0 } = {}) {
  const result = await db
    .prepare(
      `SELECT ae.id, ae.organization_id, ae.session_id, ae.actor_user_id, u.email AS actor_email, u.name AS actor_name,
              ae.action, ae.entity_type, ae.entity_id, ae.previous_state_json, ae.new_state_json, ae.metadata_json, ae.created_at
       FROM audit_events ae
       LEFT JOIN users u ON u.id = ae.actor_user_id
       WHERE ae.organization_id = ?
       ORDER BY ae.created_at DESC
       LIMIT ? OFFSET ?`,
    )
    .bind(organizationId, limit, offset)
    .all()
  return (result.results || []).map(toAuditEvent)
}
```

No unit test for this file — it does real D1 I/O with no pure logic to isolate, matching this codebase's established convention for repository functions (e.g. `memberships.js`'s `createMembership`, `checkInPlayer`); it is exercised by the e2e tests Tasks 2-4 add.

- [ ] **Step 4: Run the full suite to confirm nothing broke**

Run: `npx vitest run`
Expected: still 177/177 (this task adds no vitest tests, only a new file nothing imports yet).

- [ ] **Step 5: Commit**

```bash
git add migrations/pickleball/0010_audit_events.sql src/worker/repositories/pickleball/auditEvents.js
git commit -m "feat: add the audit_events schema and repository"
```

---

### Task 2: Audit log read API

**Files:**
- Create: `src/pages/api/pickleball/organizations/[id]/audit-events.ts`
- Test: `tests/e2e/pickleball/pickleball-crud.spec.js`

**Interfaces:**
- Consumes: `listAuditEvents` from Task 1.
- Produces: `GET /api/pickleball/organizations/:id/audit-events?page=N` → `{ events: AuditEvent[], page: number, pageSize: number }` — Tasks 3-4's e2e tests, Task 6's Audit page, all consume this.

- [ ] **Step 1: Write the route**

```ts
// src/pages/api/pickleball/organizations/[id]/audit-events.ts
import type { APIRoute } from 'astro'
import { requirePickleballSession } from '../../../../../worker/pickleball/authContext.js'
import { can } from '../../../../../lib/pickleball/permissions'
import { listAuditEvents } from '../../../../../worker/repositories/pickleball/auditEvents.js'
import { jsonResponse } from '../../../../../worker/utils/responses.js'
import { getEnv } from '../../../../../lib/env'

const PAGE_SIZE = 50

export const GET: APIRoute = async ({ request, params, url }) => {
  const env = getEnv()
  try {
    const session = await requirePickleballSession(request, env)
    const organizationId = params.id as string
    if (session.activeOrgId !== organizationId || !can(session.role, 'VIEW_AUDIT_LOG')) {
      return jsonResponse({ error: 'Forbidden.' }, 403)
    }

    const pageParam = Number(url.searchParams.get('page'))
    const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 0
    const events = await listAuditEvents(env.PICKLEBALL_DB, organizationId, { limit: PAGE_SIZE, offset: page * PAGE_SIZE })
    return jsonResponse({ events, page, pageSize: PAGE_SIZE }, 200)
  } catch (error: any) {
    return jsonResponse({ error: error.message }, error.status || 500)
  }
}
```

Empty table case: right after Task 1's migration, `listAuditEvents` simply returns `[]` — the route already handles this correctly (no special-casing needed), which this task's own test below exercises implicitly (a freshly-invited-and-403'd SCOREKEEPER never writes an event, so this stays a pure permission-gate test with no dependency on any event actually existing yet).

- [ ] **Step 2: Add an e2e test for the permission gate**

Add to `tests/e2e/pickleball/pickleball-crud.spec.js`'s `Pickleball CRUD (authenticated)` describe block (it already has a `beforeEach` that logs in as `operator@example.com`, confirmed ADMIN in the seeded org):

```js
  test('a SCOREKEEPER cannot read the audit log (no VIEW_AUDIT_LOG permission)', async ({ request }) => {
    const sessionResponse = await request.get('/api/pickleball/auth/session')
    const { activeOrgId } = await sessionResponse.json()

    const inviteResponse = await request.post(`/api/pickleball/organizations/${activeOrgId}/memberships`, {
      data: { invitedEmail: 'scorekeeper-3@example.com', role: 'SCOREKEEPER' },
    })
    expect(inviteResponse.ok()).toBe(true)

    await request.post('/api/pickleball/auth/test-login', { data: { email: 'scorekeeper-3@example.com' } })

    const response = await request.get(`/api/pickleball/organizations/${activeOrgId}/audit-events`)
    expect(response.status()).toBe(403)
  })

  test('an ADMIN reads an empty audit log for a fresh organization', async ({ request }) => {
    const sessionResponse = await request.get('/api/pickleball/auth/session')
    const { activeOrgId } = await sessionResponse.json()

    const response = await request.get(`/api/pickleball/organizations/${activeOrgId}/audit-events`)
    expect(response.ok()).toBe(true)
    const body = await response.json()
    expect(Array.isArray(body.events)).toBe(true)
    expect(body.page).toBe(0)
    expect(body.pageSize).toBe(50)
  })
```

- [ ] **Step 3: Run the tests**

Run: `npx playwright test tests/e2e/pickleball/pickleball-crud.spec.js --project=worker`
Expected: all PASS, including the 2 new ones.

Run: `npx vitest run`
Expected: still green.

- [ ] **Step 4: Commit**

```bash
git add src/pages/api/pickleball/organizations/\[id\]/audit-events.ts tests/e2e/pickleball/pickleball-crud.spec.js
git commit -m "feat: add the audit log read API"
```

---

### Task 3: Wire audit events into game correction and reopen

**Files:**
- Modify: `src/pages/api/pickleball/sessions/[id]/games/[gameId]/correct.ts`
- Modify: `src/pages/api/pickleball/sessions/[id]/games/[gameId]/reopen.ts`
- Modify: `tests/e2e/pickleball/pickleball-realtime.spec.js`

**Interfaces:**
- Consumes: `recordAuditEvent` from Task 1, `GET .../audit-events` from Task 2 (to assert the write happened, in this task's own e2e test).

- [ ] **Step 1: Wire `correct.ts`**

Current file (read it first to confirm it matches — it was last touched in Plan D):

```ts
import type { APIRoute } from 'astro'
import { requirePickleballSession } from '../../../../../../../worker/pickleball/authContext.js'
import { can } from '../../../../../../../lib/pickleball/permissions'
import { getSession } from '../../../../../../../worker/repositories/pickleball/sessions.js'
import { getGame } from '../../../../../../../worker/repositories/pickleball/games.js'
import { correctGameSchema } from '../../../../../../../lib/schemas/pickleball/games'
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

    if (!can(session.role, 'CORRECT_GAME')) return jsonResponse({ error: 'Forbidden.' }, 403)

    const result = correctGameSchema.safeParse(body)
    if (!result.success) return jsonResponse({ error: 'Validation failed.', issues: result.error.issues }, 400)

    const gameId = params.gameId as string
    const game = await getGame(env.PICKLEBALL_DB, sessionId, gameId)
    if (!game) return jsonResponse({ error: 'Game not found in this session.' }, 404)

    const stub = env.SESSION_COORDINATOR.get(env.SESSION_COORDINATOR.idFromName(sessionId))
    const outcome = await stub.correctGame(sessionId, gameId, session.userId, {
      scoreA: result.data.scoreA,
      scoreB: result.data.scoreB,
      servingTeam: result.data.servingTeam,
      serverNumber: result.data.serverNumber,
    })

    if (!outcome.ok) return jsonResponse({ error: outcome.error }, 409)
    return jsonResponse(outcome, 200)
  } catch (error: any) {
    return jsonResponse({ error: error.message }, error.status || 500)
  }
}
```

Add the import (same relative depth as the existing `sessions.js`/`games.js` imports in this file):

```ts
import { recordAuditEvent } from '../../../../../../../worker/repositories/pickleball/auditEvents.js'
```

Replace the final two lines of the `try` block:

```ts
    if (!outcome.ok) return jsonResponse({ error: outcome.error }, 409)

    await recordAuditEvent(env.PICKLEBALL_DB, {
      organizationId: session.activeOrgId,
      sessionId,
      actorUserId: session.userId,
      action: 'GAME_CORRECTED',
      entityType: 'game',
      entityId: gameId,
      previousState: game,
      newState: outcome.game,
      metadata: {},
    })

    return jsonResponse(outcome, 200)
```

- [ ] **Step 2: Wire `reopen.ts`** — identical shape

Current file:

```ts
import type { APIRoute } from 'astro'
import { requirePickleballSession } from '../../../../../../../worker/pickleball/authContext.js'
import { can } from '../../../../../../../lib/pickleball/permissions'
import { getSession } from '../../../../../../../worker/repositories/pickleball/sessions.js'
import { getGame } from '../../../../../../../worker/repositories/pickleball/games.js'
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

    if (!can(session.role, 'REOPEN_GAME')) return jsonResponse({ error: 'Forbidden.' }, 403)

    const gameId = params.gameId as string
    const game = await getGame(env.PICKLEBALL_DB, sessionId, gameId)
    if (!game) return jsonResponse({ error: 'Game not found in this session.' }, 404)

    const stub = env.SESSION_COORDINATOR.get(env.SESSION_COORDINATOR.idFromName(sessionId))
    const outcome = await stub.reopenGame(sessionId, gameId, session.userId)

    if (!outcome.ok) return jsonResponse({ error: outcome.error }, 409)
    return jsonResponse(outcome, 200)
  } catch (error: any) {
    return jsonResponse({ error: error.message }, error.status || 500)
  }
}
```

Add the same import, then replace the final two lines of the `try` block:

```ts
    if (!outcome.ok) return jsonResponse({ error: outcome.error }, 409)

    await recordAuditEvent(env.PICKLEBALL_DB, {
      organizationId: session.activeOrgId,
      sessionId,
      actorUserId: session.userId,
      action: 'GAME_REOPENED',
      entityType: 'game',
      entityId: gameId,
      previousState: game,
      newState: outcome.game,
      metadata: {},
    })

    return jsonResponse(outcome, 200)
```

- [ ] **Step 3: Add an e2e test proving the audit trail is written**

Read `tests/e2e/pickleball/pickleball-realtime.spec.js` first to find its existing "reconnecting after a mutation..." test (around line 200) — it already builds a full live session with a finished game via a `createLiveSessionForRealtimeTests`-style setup and calls `correct`. Add a new test in the same file, after the existing tests, using the same setup pattern (read the existing test immediately above your insertion point to copy its exact venue/session/game bootstrapping — don't guess field names):

```js
test('correcting a game writes a retrievable audit event', async ({ request, context }) => {
  const baseURL = test.info().project.use.baseURL
  await loginAsOperator(request, context, baseURL)

  const sessionId = await createLiveSessionForRealtimeTests(request, context, baseURL)
  const courtsResponse = await request.get(`/api/pickleball/sessions/${sessionId}/courts`)
  const sessionCourtId = (await courtsResponse.json()).courts[0].id
  const teams = (await (await request.get(`/api/pickleball/sessions/${sessionId}/courts/${sessionCourtId}/teams`)).json()).teams
  const startResponse = await request.post(`/api/pickleball/sessions/${sessionId}/games/start`, {
    data: {
      sessionCourtId, servingTeam: 'A',
      teamAStartingServerSessionPlayerId: teams[0].members[0].sessionPlayerId,
      teamBStartingServerSessionPlayerId: teams[1].members[0].sessionPlayerId,
    },
  })
  const gameId = (await startResponse.json()).game.id

  const correctResponse = await request.post(`/api/pickleball/sessions/${sessionId}/games/${gameId}/correct`, {
    data: { scoreA: 3, scoreB: 1, servingTeam: 'A', serverNumber: 1 },
  })
  expect(correctResponse.ok()).toBe(true)

  const sessionInfo = await (await request.get('/api/pickleball/auth/session')).json()
  const auditResponse = await request.get(`/api/pickleball/organizations/${sessionInfo.activeOrgId}/audit-events`)
  expect(auditResponse.ok()).toBe(true)
  const { events } = await auditResponse.json()
  const correctionEvent = events.find((event) => event.action === 'GAME_CORRECTED' && event.entityId === gameId)
  expect(correctionEvent).toBeTruthy()
  expect(correctionEvent.newState.scoreA).toBe(3)
})
```

- [ ] **Step 4: Run the new test**

Run: `npx playwright test tests/e2e/pickleball/pickleball-realtime.spec.js --project=worker -g "writes a retrievable audit event"`
Expected: PASS (Task 2's read route already exists at this point in the plan).

- [ ] **Step 5: Commit**

```bash
git add src/pages/api/pickleball/sessions/[id]/games/[gameId]/correct.ts src/pages/api/pickleball/sessions/[id]/games/[gameId]/reopen.ts tests/e2e/pickleball/pickleball-realtime.spec.js
git commit -m "feat: record audit events for game corrections and reopens"
```

---

### Task 4: Membership revoke endpoint, plus audit-wiring for invite/role-change/revoke

**Files:**
- Modify: `src/worker/repositories/pickleball/memberships.js`
- Modify: `src/pages/api/pickleball/organizations/[id]/memberships.ts`
- Create: `src/pages/api/pickleball/organizations/[id]/memberships/[membershipId].ts`
- Modify: `tests/e2e/pickleball/pickleball-crud.spec.js`

**Interfaces:**
- Consumes: `recordAuditEvent` from Task 1.
- Produces: `DELETE /api/pickleball/organizations/:id/memberships/:membershipId` (`{ok: true}` on success) — Task 5's Operators UI calls this.

- [ ] **Step 1: Add repository functions**

Read the current `src/worker/repositories/pickleball/memberships.js` first (shown in this plan for reference, may have shifted). Add these three functions (don't remove or restructure anything already there):

```js
export async function getMembershipByEmail(db, organizationId, invitedEmail) {
  const row = await db
    .prepare(`SELECT ${MEMBERSHIP_COLUMNS} FROM organization_memberships WHERE organization_id = ? AND invited_email = ?`)
    .bind(organizationId, String(invitedEmail).trim().toLowerCase())
    .first()
  return toMembership(row)
}

export async function getMembershipById(db, organizationId, membershipId) {
  const row = await db
    .prepare(`SELECT ${MEMBERSHIP_COLUMNS} FROM organization_memberships WHERE id = ? AND organization_id = ?`)
    .bind(membershipId, organizationId)
    .first()
  return toMembership(row)
}

export async function revokeMembership(db, organizationId, membershipId) {
  const result = await db
    .prepare(`UPDATE organization_memberships SET status = 'REVOKED', updated_at = ? WHERE id = ? AND organization_id = ? AND status = 'ACTIVE'`)
    .bind(nowIso(), membershipId, organizationId)
    .run()
  return result.meta.changes > 0
}
```

- [ ] **Step 2: Wire audit into the existing invite/role-change POST**

Read the current `src/pages/api/pickleball/organizations/[id]/memberships.ts` (shown for reference):

```ts
import type { APIRoute } from 'astro'
import { requirePickleballSession } from '../../../../../worker/pickleball/authContext.js'
import { can } from '../../../../../lib/pickleball/permissions'
import { createMembership, listMembershipsForOrganization } from '../../../../../worker/repositories/pickleball/memberships.js'
import { inviteMembershipSchema } from '../../../../../lib/schemas/pickleball/organizations'
import { getEnv } from '../../../../../lib/env'
import { jsonResponse } from '../../../../../worker/utils/responses.js'

export const GET: APIRoute = async ({ request, params }) => {
  /* unchanged */
}

export const POST: APIRoute = async ({ request, params }) => {
  const env = getEnv()
  try {
    const session = await requirePickleballSession(request, env)
    if (session.activeOrgId !== params.id || !can(session.role, 'MANAGE_OPERATORS')) {
      return jsonResponse({ error: 'Forbidden.' }, 403)
    }

    const body = await request.json().catch(() => null)
    const result = inviteMembershipSchema.safeParse(body)
    if (!result.success) {
      return jsonResponse({ error: 'Validation failed.', issues: result.error.issues }, 400)
    }

    const membership = await createMembership(env.PICKLEBALL_DB, { organizationId: params.id, ...result.data })
    return jsonResponse({ membership }, 201)
  } catch (error: any) {
    return jsonResponse({ error: error.message }, error.status || 500)
  }
}
```

Change the `POST` import line and body (the `GET` handler and everything else is untouched):

```ts
import { createMembership, getMembershipByEmail, listMembershipsForOrganization } from '../../../../../worker/repositories/pickleball/memberships.js'
import { recordAuditEvent } from '../../../../../worker/repositories/pickleball/auditEvents.js'
```

```ts
export const POST: APIRoute = async ({ request, params }) => {
  const env = getEnv()
  try {
    const session = await requirePickleballSession(request, env)
    if (session.activeOrgId !== params.id || !can(session.role, 'MANAGE_OPERATORS')) {
      return jsonResponse({ error: 'Forbidden.' }, 403)
    }

    const body = await request.json().catch(() => null)
    const result = inviteMembershipSchema.safeParse(body)
    if (!result.success) {
      return jsonResponse({ error: 'Validation failed.', issues: result.error.issues }, 400)
    }

    const organizationId = params.id as string
    const existing = await getMembershipByEmail(env.PICKLEBALL_DB, organizationId, result.data.invitedEmail)
    const membership = await createMembership(env.PICKLEBALL_DB, { organizationId, ...result.data })

    await recordAuditEvent(env.PICKLEBALL_DB, {
      organizationId,
      sessionId: null,
      actorUserId: session.userId,
      action: existing ? 'OPERATOR_ROLE_CHANGED' : 'OPERATOR_INVITED',
      entityType: 'organization_membership',
      entityId: membership.id,
      previousState: existing,
      newState: membership,
      metadata: {},
    })

    return jsonResponse({ membership }, 201)
  } catch (error: any) {
    return jsonResponse({ error: error.message }, error.status || 500)
  }
}
```

- [ ] **Step 3: Create the revoke route**

```ts
// src/pages/api/pickleball/organizations/[id]/memberships/[membershipId].ts
import type { APIRoute } from 'astro'
import { requirePickleballSession } from '../../../../../../worker/pickleball/authContext.js'
import { can } from '../../../../../../lib/pickleball/permissions'
import { getMembershipById, revokeMembership } from '../../../../../../worker/repositories/pickleball/memberships.js'
import { recordAuditEvent } from '../../../../../../worker/repositories/pickleball/auditEvents.js'
import { jsonResponse } from '../../../../../../worker/utils/responses.js'
import { getEnv } from '../../../../../../lib/env'

export const DELETE: APIRoute = async ({ request, params }) => {
  const env = getEnv()
  try {
    const session = await requirePickleballSession(request, env)
    const organizationId = params.id as string
    if (session.activeOrgId !== organizationId || !can(session.role, 'MANAGE_OPERATORS')) {
      return jsonResponse({ error: 'Forbidden.' }, 403)
    }

    const membershipId = params.membershipId as string
    const membership = await getMembershipById(env.PICKLEBALL_DB, organizationId, membershipId)
    if (!membership) return jsonResponse({ error: 'Not found.' }, 404)

    // Guards against an admin accidentally locking themselves out of the org
    // they're managing. membership.userId is only set once the invited
    // person has signed in at least once (see linkMembershipUser), so a
    // not-yet-accepted invite's userId is null and can never equal
    // session.userId here.
    if (membership.userId === session.userId) {
      return jsonResponse({ error: 'You cannot revoke your own membership.' }, 400)
    }

    const revoked = await revokeMembership(env.PICKLEBALL_DB, organizationId, membershipId)
    if (!revoked) return jsonResponse({ error: 'Not found.' }, 404)

    await recordAuditEvent(env.PICKLEBALL_DB, {
      organizationId,
      sessionId: null,
      actorUserId: session.userId,
      action: 'OPERATOR_REVOKED',
      entityType: 'organization_membership',
      entityId: membershipId,
      previousState: membership,
      newState: { ...membership, status: 'REVOKED' },
      metadata: {},
    })

    return jsonResponse({ ok: true }, 200)
  } catch (error: any) {
    return jsonResponse({ error: error.message }, error.status || 500)
  }
}
```

- [ ] **Step 4: Add e2e tests**

Add to the `Pickleball CRUD (authenticated)` describe block in `tests/e2e/pickleball/pickleball-crud.spec.js`:

```js
  test('revokes an operator membership and rejects the revoked email', async ({ request }) => {
    const sessionResponse = await request.get('/api/pickleball/auth/session')
    const { activeOrgId } = await sessionResponse.json()

    const inviteResponse = await request.post(`/api/pickleball/organizations/${activeOrgId}/memberships`, {
      data: { invitedEmail: 'revoke-target@example.com', role: 'SCOREKEEPER' },
    })
    expect(inviteResponse.ok()).toBe(true)
    const { membership } = await inviteResponse.json()

    const revokeResponse = await request.delete(`/api/pickleball/organizations/${activeOrgId}/memberships/${membership.id}`)
    expect(revokeResponse.ok()).toBe(true)

    const loginResponse = await request.post('/api/pickleball/auth/test-login', { data: { email: 'revoke-target@example.com' } })
    expect(loginResponse.status()).toBe(401)
  })

  test('a SCOREKEEPER cannot revoke an operator membership (no MANAGE_OPERATORS permission)', async ({ request }) => {
    const sessionResponse = await request.get('/api/pickleball/auth/session')
    const { activeOrgId } = await sessionResponse.json()

    const inviteResponse = await request.post(`/api/pickleball/organizations/${activeOrgId}/memberships`, {
      data: { invitedEmail: 'scorekeeper-2@example.com', role: 'SCOREKEEPER' },
    })
    const { membership } = await inviteResponse.json()

    await request.post('/api/pickleball/auth/test-login', { data: { email: 'scorekeeper-2@example.com' } })

    const revokeResponse = await request.delete(`/api/pickleball/organizations/${activeOrgId}/memberships/${membership.id}`)
    expect(revokeResponse.status()).toBe(403)
  })
```

The first test's `expect(loginResponse.status()).toBe(401)` relies on `test-login`/the real Google-callback path already rejecting a login for an email with no `ACTIVE` membership — confirm this by reading `src/pages/api/pickleball/auth/test-login.ts`'s existing "no memberships" branch (already documents this exact behavior) rather than assuming the status code.

- [ ] **Step 5: Run the tests**

Run: `npx playwright test tests/e2e/pickleball/pickleball-crud.spec.js --project=worker`
Expected: all tests in this file PASS, including the 2 new ones.

Run: `npx vitest run`
Expected: still green (this task adds no vitest tests).

- [ ] **Step 6: Commit**

```bash
git add src/worker/repositories/pickleball/memberships.js src/pages/api/pickleball/organizations/\[id\]/memberships.ts "src/pages/api/pickleball/organizations/[id]/memberships/[membershipId].ts" tests/e2e/pickleball/pickleball-crud.spec.js
git commit -m "feat: add membership revoke, wire audit events into operator lifecycle"
```

---

### Task 5: Operators UI page

**Files:**
- Modify: `src/pickleball-app/components/AppShell.jsx`
- Create: `src/pickleball-app/pages/OperatorsPage.jsx`
- Modify: `src/pickleball-app/PickleballApp.jsx`
- Test: `tests/e2e/pickleball/pickleball-operator-ui.spec.js`

**Interfaces:**
- Consumes: `POST/GET /api/pickleball/organizations/:id/memberships` (already shipped) and `DELETE .../memberships/:membershipId` (Task 4).
- Produces: `activeOrgId` now available via `useOutletContext()` alongside the existing `authRole` — Task 6's Audit page also relies on this.

- [ ] **Step 1: Add permission-aware nav and forward `activeOrgId`**

Read `src/pickleball-app/components/AppShell.jsx` first (shown here for reference — this is its first nav-gating change, so confirm it hasn't shifted). Replace the whole file:

```jsx
import { NavLink, Outlet } from 'react-router-dom'
import { can } from '../../lib/pickleball/permissions'

const NAV_ITEMS = [
  { to: '/pickleball/app', label: 'Dashboard', end: true },
  { to: '/pickleball/app/players', label: 'Players' },
  { to: '/pickleball/app/venues', label: 'Venues' },
  { to: '/pickleball/app/sessions', label: 'Sessions' },
  { to: '/pickleball/app/operators', label: 'Operators', permission: 'MANAGE_OPERATORS' },
  { to: '/pickleball/app/audit', label: 'Audit Log', permission: 'VIEW_AUDIT_LOG' },
]

export default function AppShell({ session, organizations, onSwitchOrg, onLogout }) {
  const visibleNavItems = NAV_ITEMS.filter((item) => !item.permission || can(session.role, item.permission))

  return (
    <div className="flex min-h-screen bg-slate-50">
      <aside className="w-56 shrink-0 border-r border-slate-200 bg-white p-4">
        <p className="mb-4 text-sm font-semibold text-slate-900">Devlab Pickleball</p>
        <nav className="space-y-1">
          {visibleNavItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `block rounded px-3 py-2 text-sm ${isActive ? 'bg-brand/10 font-semibold text-brand' : 'text-slate-600 hover:bg-slate-100'}`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        {organizations.length > 1 && (
          <select
            className="mt-6 w-full rounded border border-slate-300 px-2 py-1 text-sm"
            value={session.activeOrgId}
            onChange={(event) => onSwitchOrg(event.target.value)}
          >
            {organizations.map((org) => (
              <option key={org.organizationId} value={org.organizationId}>
                {org.organizationId}
              </option>
            ))}
          </select>
        )}
        <button type="button" onClick={onLogout} className="mt-6 w-full rounded border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">
          Sign out
        </button>
      </aside>
      <main className="flex-1 p-6">
        <Outlet context={{ authRole: session.role, activeOrgId: session.activeOrgId }} />
      </main>
    </div>
  )
}
```

Only two things changed: the `can` import + `permission`-filtered nav, and the Outlet context now also carries `activeOrgId`. Everything else (org switcher, sign-out, layout) is byte-identical.

- [ ] **Step 2: Write `OperatorsPage.jsx`**

```jsx
import { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { pickleballApi } from '../lib/pickleballApi'

const ROLES = ['ADMIN', 'SESSION_FACILITATOR', 'SCOREKEEPER']
const EMPTY_FORM = { invitedEmail: '', role: 'SESSION_FACILITATOR' }

export default function OperatorsPage() {
  const { activeOrgId } = useOutletContext()
  const [memberships, setMemberships] = useState([])
  const [status, setStatus] = useState('loading')
  const [form, setForm] = useState(EMPTY_FORM)
  const [message, setMessage] = useState(null)
  const [fetchKey, setFetchKey] = useState(null)

  if (fetchKey !== activeOrgId) {
    setFetchKey(activeOrgId)
    setMemberships([])
    setStatus('loading')
    setMessage(null)
  }

  useEffect(() => {
    let ignore = false
    pickleballApi
      .get(`/api/pickleball/organizations/${activeOrgId}/memberships`)
      .then((data) => {
        if (!ignore) {
          setMemberships(data.memberships)
          setStatus('ready')
        }
      })
      .catch(() => !ignore && setStatus('error'))
    return () => {
      ignore = true
    }
  }, [activeOrgId])

  async function handleInvite() {
    setMessage(null)
    try {
      const { membership } = await pickleballApi.post(`/api/pickleball/organizations/${activeOrgId}/memberships`, form)
      setMemberships((current) => [...current.filter((m) => m.id !== membership.id), membership])
      setForm(EMPTY_FORM)
      setMessage({ type: 'success', text: 'Invitation saved.' })
    } catch (error) {
      setMessage({ type: 'error', text: error.message })
    }
  }

  async function handleRevoke(membership) {
    setMessage(null)
    try {
      await pickleballApi.delete(`/api/pickleball/organizations/${activeOrgId}/memberships/${membership.id}`)
      setMemberships((current) => current.map((m) => (m.id === membership.id ? { ...m, status: 'REVOKED' } : m)))
      setMessage({ type: 'success', text: 'Operator access revoked.' })
    } catch (error) {
      setMessage({ type: 'error', text: error.message })
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900">Operators</h1>

      {status === 'loading' ? <p className="text-sm text-slate-500">Loading…</p> : null}
      {status === 'error' ? <p className="text-sm text-rose-600">Could not load operators.</p> : null}
      {message ? <p className={message.type === 'success' ? 'text-sm text-emerald-700' : 'text-sm text-rose-600'}>{message.text}</p> : null}

      <div className="space-y-2" data-testid="operators-list">
        {memberships.map((membership) => (
          <div key={membership.id} className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm">
            <div>
              <span className="font-semibold text-slate-900">{membership.invitedEmail}</span>
              <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">{membership.role}</span>
              {membership.status === 'REVOKED' ? (
                <span className="ml-2 rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-600">Revoked</span>
              ) : null}
            </div>
            {membership.status === 'ACTIVE' ? (
              <button
                type="button"
                onClick={() => handleRevoke(membership)}
                className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-medium text-rose-600 hover:border-rose-300"
              >
                Revoke
              </button>
            ) : null}
          </div>
        ))}
        {!memberships.length && status === 'ready' ? <p className="text-sm text-slate-500">No operators yet.</p> : null}
      </div>

      <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Invite an operator</h2>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Email</span>
          <input
            type="email"
            value={form.invitedEmail}
            onChange={(event) => setForm({ ...form, invitedEmail: event.target.value })}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Role</span>
          <select
            value={form.role}
            onChange={(event) => setForm({ ...form, role: event.target.value })}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            {ROLES.map((role) => (
              <option key={role} value={role}>{role}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={handleInvite}
          disabled={!form.invitedEmail.trim()}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:brightness-95 disabled:opacity-50"
        >
          Invite
        </button>
        <p className="text-xs text-slate-400">Inviting an email that already has access updates their role instead of creating a duplicate.</p>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Register the route**

In `src/pickleball-app/PickleballApp.jsx`, add the import and one route entry (top-level, a sibling of `players`/`venues`/`sessions` — not nested under `sessions/:sessionId`):

```jsx
import OperatorsPage from './pages/OperatorsPage'
```

```jsx
        { path: 'operators', element: <OperatorsPage /> },
```

- [ ] **Step 4: Add an e2e test**

Add a new test to `tests/e2e/pickleball/pickleball-operator-ui.spec.js` (read the file's existing tests first — reuse `loginAsOperator(request, page.context(), baseURL)` and `page.goto`):

```js
test('invites and revokes an operator from the Operators page', async ({ page, request, context }) => {
  const baseURL = test.info().project.use.baseURL
  await loginAsOperator(request, page.context(), baseURL)

  const email = `operator-ui-${Date.now()}@example.com`
  await page.goto('/pickleball/app/operators')
  await page.getByLabel('Email').fill(email)
  await page.locator('button', { hasText: 'Invite' }).click()
  await expect(page.getByTestId('operators-list').getByText(email)).toBeVisible()

  const row = page.getByTestId('operators-list').locator('div', { has: page.getByText(email) }).first()
  await row.getByRole('button', { name: 'Revoke' }).click()
  await expect(row.getByText('Revoked')).toBeVisible()
})
```

- [ ] **Step 5: Run the tests**

Run: `npx playwright test tests/e2e/pickleball/pickleball-operator-ui.spec.js --project=worker -g "Operators page"`
Expected: PASS.

Run: `npx vitest run`
Expected: still green.

Run: `npx eslint src/pickleball-app/components/AppShell.jsx src/pickleball-app/pages/OperatorsPage.jsx src/pickleball-app/PickleballApp.jsx`
Expected: clean, no `react-hooks/set-state-in-effect`.

- [ ] **Step 6: Commit**

```bash
git add src/pickleball-app/components/AppShell.jsx src/pickleball-app/pages/OperatorsPage.jsx src/pickleball-app/PickleballApp.jsx tests/e2e/pickleball/pickleball-operator-ui.spec.js
git commit -m "feat: add the Operators management page"
```

---

### Task 6: Audit Log UI page

**Files:**
- Create: `src/pickleball-app/pages/AuditPage.jsx`
- Modify: `src/pickleball-app/PickleballApp.jsx`
- Test: `tests/e2e/pickleball/pickleball-operator-ui.spec.js`

**Interfaces:**
- Consumes: `GET /api/pickleball/organizations/:id/audit-events` (Task 2), `activeOrgId` from `useOutletContext()` (Task 5).

- [ ] **Step 1: Write `AuditPage.jsx`**

```jsx
import { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { pickleballApi } from '../lib/pickleballApi'

export default function AuditPage() {
  const { activeOrgId } = useOutletContext()
  const [events, setEvents] = useState(null)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(50)
  const [message, setMessage] = useState(null)
  const [fetchKey, setFetchKey] = useState(null)

  const currentKey = `${activeOrgId}:${page}`
  if (fetchKey !== currentKey) {
    setFetchKey(currentKey)
    setEvents(null)
    setMessage(null)
  }

  useEffect(() => {
    let ignore = false
    pickleballApi
      .get(`/api/pickleball/organizations/${activeOrgId}/audit-events?page=${page}`)
      .then((data) => {
        if (!ignore) {
          setEvents(data.events)
          setPageSize(data.pageSize)
        }
      })
      .catch((error) => {
        if (!ignore) setMessage({ type: 'error', text: error.message })
      })
    return () => {
      ignore = true
    }
  }, [activeOrgId, page])

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900">Audit Log</h1>

      {message ? <p className="text-sm text-rose-600">{message.text}</p> : null}
      {events === null && !message ? <p className="text-sm text-slate-500">Loading…</p> : null}

      {events ? (
        <div className="space-y-2" data-testid="audit-events-list">
          {events.map((event) => (
            <div key={event.id} className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-900">{event.action}</span>
                <span className="text-xs text-slate-400">{new Date(event.createdAt).toLocaleString()}</span>
              </div>
              <p className="mt-1 text-slate-500">
                {event.actorName || event.actorEmail || 'Unknown actor'} · {event.entityType} {event.entityId}
              </p>
            </div>
          ))}
          {!events.length ? <p className="text-sm text-slate-500">No audit events yet.</p> : null}
        </div>
      ) : null}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setPage((current) => Math.max(0, current - 1))}
          disabled={page === 0}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:border-slate-300 disabled:opacity-50"
        >
          Previous
        </button>
        <span className="text-sm text-slate-500">Page {page + 1}</span>
        <button
          type="button"
          onClick={() => setPage((current) => current + 1)}
          disabled={!events || events.length < pageSize}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:border-slate-300 disabled:opacity-50"
        >
          Next
        </button>
      </div>
    </div>
  )
}
```

This applies the `fetchKey`/`currentKey` render-phase-reset pattern from the start (per Global Constraints), keyed on both `activeOrgId` and `page` — matching `LeaderboardPage.jsx`'s two-key precedent exactly.

- [ ] **Step 2: Register the route**

In `src/pickleball-app/PickleballApp.jsx`:

```jsx
import AuditPage from './pages/AuditPage'
```

```jsx
        { path: 'audit', element: <AuditPage /> },
```

- [ ] **Step 3: Add an e2e test**

Add to `tests/e2e/pickleball/pickleball-operator-ui.spec.js`:

```js
test('the Audit Log page shows an event after a game correction', async ({ page, request, context }) => {
  const baseURL = test.info().project.use.baseURL
  await loginAsOperator(request, page.context(), baseURL)

  const sessionId = await createLiveSessionForRealtimeTests(request, page.context(), baseURL)
  const courtsResponse = await request.get(`/api/pickleball/sessions/${sessionId}/courts`)
  const sessionCourtId = (await courtsResponse.json()).courts[0].id
  const teams = (await (await request.get(`/api/pickleball/sessions/${sessionId}/courts/${sessionCourtId}/teams`)).json()).teams
  const startResponse = await request.post(`/api/pickleball/sessions/${sessionId}/games/start`, {
    data: {
      sessionCourtId, servingTeam: 'A',
      teamAStartingServerSessionPlayerId: teams[0].members[0].sessionPlayerId,
      teamBStartingServerSessionPlayerId: teams[1].members[0].sessionPlayerId,
    },
  })
  const gameId = (await startResponse.json()).game.id
  await request.post(`/api/pickleball/sessions/${sessionId}/games/${gameId}/correct`, {
    data: { scoreA: 2, scoreB: 0, servingTeam: 'A', serverNumber: 1 },
  })

  await page.goto('/pickleball/app/audit')
  await expect(page.getByTestId('audit-events-list').getByText('GAME_CORRECTED')).toBeVisible({ timeout: 10000 })
})
```

Read `pickleball-realtime.spec.js`'s existing `createLiveSessionForRealtimeTests` helper signature first to confirm it accepts a Playwright `context` (not just `request`) as its second argument, matching how Task 3's test uses it — adjust the call if the real signature differs.

- [ ] **Step 4: Run the tests**

Run: `npx playwright test tests/e2e/pickleball/pickleball-operator-ui.spec.js --project=worker -g "Audit Log page"`
Expected: PASS.

Run: `npx vitest run` and `npx eslint src/pickleball-app/pages/AuditPage.jsx src/pickleball-app/PickleballApp.jsx`
Expected: green / clean.

- [ ] **Step 5: Commit**

```bash
git add src/pickleball-app/pages/AuditPage.jsx src/pickleball-app/PickleballApp.jsx tests/e2e/pickleball/pickleball-operator-ui.spec.js
git commit -m "feat: add the Audit Log page"
```

---

### Task 7: Dashboard consolidation

**Files:**
- Modify: `src/pickleball-app/pages/DashboardPage.jsx`
- Test: `tests/e2e/pickleball/pickleball-operator-ui.spec.js`

**Interfaces:**
- Consumes: `GET /api/pickleball/sessions` and `GET /api/pickleball/players` (both already shipped, no backend changes), `authRole` from `useOutletContext()`.

- [ ] **Step 1: Replace the stub**

Current file is a 1-line placeholder ("Session and queue management arrive in later phases."). Full replacement:

```jsx
import { useEffect, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { pickleballApi } from '../lib/pickleballApi'

export default function DashboardPage() {
  const { authRole } = useOutletContext()
  const [sessions, setSessions] = useState(null)
  const [players, setPlayers] = useState(null)
  const [message, setMessage] = useState(null)

  useEffect(() => {
    let ignore = false
    Promise.all([pickleballApi.get('/api/pickleball/sessions'), pickleballApi.get('/api/pickleball/players')])
      .then(([sessionsData, playersData]) => {
        if (!ignore) {
          setSessions(sessionsData.sessions)
          setPlayers(playersData.players)
        }
      })
      .catch((error) => {
        if (!ignore) setMessage({ type: 'error', text: error.message })
      })
    return () => {
      ignore = true
    }
  }, [])

  if (message) return <p className="text-sm text-rose-600">{message.text}</p>
  if (!sessions || !players) return <p className="text-sm text-slate-500">Loading…</p>

  const liveSessions = sessions.filter((session) => session.status === 'LIVE' || session.status === 'PAUSED')
  const upcomingSessions = sessions.filter((session) => session.status === 'DRAFT' || session.status === 'OPEN_FOR_CHECKIN')

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900">Dashboard</h1>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <p className="text-xs font-medium uppercase text-slate-500">Live sessions</p>
          <p className="mt-1 text-3xl font-bold text-slate-900">{liveSessions.length}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <p className="text-xs font-medium uppercase text-slate-500">Upcoming sessions</p>
          <p className="mt-1 text-3xl font-bold text-slate-900">{upcomingSessions.length}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <p className="text-xs font-medium uppercase text-slate-500">Players</p>
          <p className="mt-1 text-3xl font-bold text-slate-900">{players.length}</p>
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold uppercase text-slate-500">Live now</h2>
        <div className="space-y-2" data-testid="dashboard-live-sessions">
          {liveSessions.map((session) => (
            <Link
              key={session.id}
              to={`/pickleball/app/sessions/${session.id}`}
              className="block rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm hover:border-slate-300"
            >
              <span className="font-semibold text-slate-900">{session.name}</span>
              <span className="ml-2 text-slate-500">{session.status}</span>
            </Link>
          ))}
          {!liveSessions.length ? <p className="text-sm text-slate-500">No sessions are live right now.</p> : null}
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold uppercase text-slate-500">Upcoming</h2>
        <div className="space-y-2" data-testid="dashboard-upcoming-sessions">
          {upcomingSessions.map((session) => (
            <Link
              key={session.id}
              to={`/pickleball/app/sessions/${session.id}`}
              className="block rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm hover:border-slate-300"
            >
              <span className="font-semibold text-slate-900">{session.name}</span>
              <span className="ml-2 text-slate-500">{session.status}</span>
            </Link>
          ))}
          {!upcomingSessions.length ? <p className="text-sm text-slate-500">No upcoming sessions.</p> : null}
        </div>
      </div>

      {authRole === 'ADMIN' ? (
        <div className="flex gap-3">
          <Link to="/pickleball/app/operators" className="text-sm font-medium text-brand underline">Manage operators</Link>
          <Link to="/pickleball/app/audit" className="text-sm font-medium text-brand underline">View audit log</Link>
        </div>
      ) : null}
    </div>
  )
}
```

No `fetchKey` reset needed here: this page has no props/outlet-context values that vary per-navigation (it's the index route, `authRole` only changes on an org switch, which already remounts the whole router via `PickleballApp`'s `key`-less `RouterProvider` re-render from a fresh `session` state — read `PickleballApp.jsx`'s `handleSwitchOrg` to confirm this before skipping the pattern; if org-switching does NOT force a remount, add the same reset pattern used elsewhere).

- [ ] **Step 2: Add an e2e test**

Add to `tests/e2e/pickleball/pickleball-operator-ui.spec.js`:

```js
test('the Dashboard shows a live session and admin-only links', async ({ page, request, context }) => {
  const baseURL = test.info().project.use.baseURL
  await loginAsOperator(request, page.context(), baseURL)

  const sessionId = await createLiveSessionForRealtimeTests(request, page.context(), baseURL)
  const sessionResponse = await request.get(`/api/pickleball/sessions/${sessionId}`)
  const { session } = await sessionResponse.json()

  await page.goto('/pickleball/app')
  await expect(page.getByTestId('dashboard-live-sessions').getByText(session.name)).toBeVisible()
  await expect(page.getByRole('link', { name: 'Manage operators' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'View audit log' })).toBeVisible()
})
```

- [ ] **Step 3: Run the tests**

Run: `npx playwright test tests/e2e/pickleball/pickleball-operator-ui.spec.js --project=worker -g "Dashboard"`
Expected: PASS.

Run: `npx vitest run` and `npx eslint src/pickleball-app/pages/DashboardPage.jsx`
Expected: green / clean.

- [ ] **Step 4: Commit**

```bash
git add src/pickleball-app/pages/DashboardPage.jsx tests/e2e/pickleball/pickleball-operator-ui.spec.js
git commit -m "feat: consolidate the facilitator dashboard"
```

---

### Task 8: Documentation deliverables

**Files:**
- Create: `docs/pickleball/architecture.md`
- Create: `docs/pickleball/schema.md`
- Create: `docs/pickleball/opi-methodology.md`
- Create: `docs/pickleball/realtime.md`

**Interfaces:** none — pure documentation, no code dependency in either direction. This task can run any time after Task 1 lands (so `schema.md` can describe `audit_events`), but has no test dependency on any other task.

- [ ] **Step 1: Write `docs/pickleball/architecture.md`**

A condensed version of the design spec's foundational sections. Full content:

```markdown
# Devlab Pickleball — Architecture

Devlab Pickleball is an operational platform for running recreational pickleball
sessions: check-in, queueing, court assignment, live scoring, statistics, a
custom performance index (OPI), and anonymous realtime public viewing. It is
not CMS content — it lives beside the existing public website and Admin CMS as
a third, independent subsystem sharing one Astro/Worker deployment but nothing
else load-bearing: separate D1 database, separate auth mechanism, separate
session cookie, separate migrations, separate repositories, separate UI shell.

**Non-goal, stated everywhere this matters:** OPI is a Devlab-original metric,
not an official USA Pickleball rating, DUPR, UTR-P, or Elo system. The scoring
engine aligns with standard side-out scoring concepts but the software is not
USA-Pickleball-certified.

## Foundational pieces

1. **UI shell** — a React Router SPA island (`src/pickleball-app/`), mounted
   at `src/pages/pickleball/app/[...path].astro` (`client:only="react"`),
   mirroring the existing `admin-app/` pattern, for the authenticated operator
   experience. The public marketing/methodology pages are plain Astro. The
   public live view and TV/kiosk display are Astro pages with one React
   island each for the realtime-subscribing widget.
2. **Data isolation** — a dedicated D1 database, bound as `PICKLEBALL_DB`
   (prod: `devlab-pickleball`, preview: `devlab-pickleball-preview`). Own
   migrations folder `migrations/pickleball/`, own repositories
   `src/worker/repositories/pickleball/`, own Zod schemas
   `src/lib/schemas/pickleball/`.
3. **Auth** — Google OAuth 2.0 + PKCE via `arctic`. A stateless
   HMAC-SHA256-signed session cookie (`devlab_pb_session`), independent of
   the Admin CMS's password-based session. Memberships are invite-only: an
   ADMIN creates a membership row for an email before that person ever
   signs in.
4. **Realtime & concurrency** — one Durable Object per pickleball session
   (`SessionCoordinatorDO`), serializing every mutating command and
   broadcasting WebSocket diffs to operators and public viewers. D1 is the
   durable source of truth; the DO is a rehydratable coordinator, never the
   only copy of anything. See `docs/architecture/decisions/0006-pickleball-durable-objects.md`
   for why this pattern was introduced, and `realtime.md` for the wire
   protocol.

## Multi-tenancy & RBAC

- **Organization** — a club/venue operator's tenant. All operational data is
  scoped by `organization_id`.
- **User** — an authenticated operator, identified by Google `sub`.
- **OrganizationMembership** — join of User × Organization with a `role`
  (`ADMIN` | `SESSION_FACILITATOR` | `SCOREKEEPER`) and `status` (`ACTIVE` |
  `REVOKED`). A user can hold different roles in different organizations.
- **Player** — a session participant, not an authenticated entity; belongs
  to one organization, optionally links to a `user_id`.

Every mutating and non-public-read endpoint validates the session cookie,
resolves `(userId, activeOrgId)` → membership → role, and re-checks the
resource's actual owning org against the request (never trusting a
client-supplied `organization_id` blindly — an IDOR guard). The SPA hides
controls the role can't use, but every command handler re-checks permissions
independently server-side; see `src/lib/pickleball/permissions.ts` for the
full role→permission matrix.

## Phase history

| Phase | Scope | Status |
|---|---|---|
| 1 | Foundation — migrations, OAuth, orgs/users/memberships/RBAC, CRUD, empty SPA shell | Complete |
| 2 | Attendance — registration/check-in/availability | Complete |
| 3 | Open Play core — queue engine, `SessionCoordinatorDO` scaffolding, court assignment | Complete |
| 4 | Game engine — rulesets, side-out scoring, event log, undo, finalization, reopen/correction | Complete |
| 5 | Performance — `player_game_stats`, OPI v1, snapshots, leaderboards, player profile | Complete |
| 6 | Realtime & public — WebSocket broadcast, public live view, TV/kiosk display, QR sharing, methodology page | Complete |
| 7 | Polish — audit log, operator management UI, dashboard consolidation, documentation | Complete (this plan) |

**Deliberately not built** (disclosed, not overlooked): `pair_stats` /
`FIXED_PAIRS` session-type support (a full future feature, not a stats-layer
addition — see Phase 5's plan); the public sanitized leaderboard extension to
`toPublicSessionView` (spec §9 — deferred, requires a backend change out of
scope for the UI-only plan that shipped the rest of Phase 6); a `/settings`
page for "system defaults" (the spec reserves the route and a permission but
never defines a single concrete setting — see this plan's Global Constraints).
```

- [ ] **Step 2: Write `docs/pickleball/schema.md`**

Read every file under `migrations/pickleball/*.sql`, in numeric order, before writing this file — do not paraphrase or guess a column name, type, or constraint; transcribe exactly what the SQL says. Structure:

```markdown
# Devlab Pickleball — Schema

All tables live in the `PICKLEBALL_DB` D1 database, entirely isolated from
the CMS's database. Migrations are numbered and applied in order from
`migrations/pickleball/`; never edit an applied migration, only add a new
numbered file.

## Migration files

[One row per file, in order: filename, one-sentence description of what it
adds, drawn from that file's own header comment where one exists.]

## Tables

[One `###`-level subsection per table, across all migration files, in the
order the tables were first created. For each table: its columns (name,
type, constraints — `NOT NULL`, `CHECK`, `DEFAULT`, `PRIMARY KEY`,
`FOREIGN KEY` — exactly as declared), and its indexes (name and columns).
Group tables under the same domain headings the design spec uses (§3
identity/RBAC, §4 core session/game domain, §4.8 statistics, §4.9 audit)
so a reader can find "the OPI tables" or "the audit table" without reading
every migration file's chronological order.]
```

Fill in both `[...]` blocks with the real, complete content from reading the actual migration files — the placeholder brackets above exist only in this plan to describe the required structure, they must not appear in the final doc.

- [ ] **Step 3: Write `docs/pickleball/opi-methodology.md`**

This is the source doc for the public `/pickleball/methodology` page's copy (§16) — keep it consistent with `src/pages/pickleball/methodology.astro`'s actual rendered text (read that file first) but written for an internal/technical audience rather than a public one, so it can go into more formula/implementation detail. Full content:

```markdown
# Devlab Pickleball — OPI Methodology

OPI (Open Play Performance Index) is a Devlab-original performance metric.
It is **not** an official USA Pickleball rating, DUPR, UTR-P, or Elo system,
and the software computing it is not USA-Pickleball-certified — this
disclaimer appears on the public `/pickleball/methodology` page verbatim and
must never be contradicted elsewhere in the UI or in this document.

## Formula

For a single finished, eligible game, a player's **game performance** is:

```
game_performance = (points_for / (points_for + points_against)) * 100
```

A player's **OPI** for a given scope (a single session, or all-time) is the
mean of their `game_performance` across every eligible finished game in that
scope:

```
opi = performance_sum / eligible_games_count
```

Canonical worked examples (from `src/lib/pickleball/opi.test.ts`, the single
source of truth this document must never drift from — re-read that file if
these numbers ever look wrong):

- 11-7 → 61.111...
- 9-11 → 45
- 11-5 → 68.75
- Mean of those three games → 58.287..., displayed rounded to 58.29

## Eligibility

A game contributes to OPI only if `player_game_stats.eligible_for_opi` is
true for that player/game row. A game abandoned (`status = 'ABANDONED'`) is
excluded (§57 edge case #18). A correction or reopen fully invalidates and
recomputes every affected player's stats and snapshots from scratch — see
§7/§57 edge cases #20-21 and `SessionCoordinatorDO.ts`'s `reopenGame`/
`correctGame` methods, which delete and rebuild `player_game_stats`,
`matchmaking_history`, and `player_performance_snapshots` rows inside the
same D1 batch as the correction itself, never incrementing/decrementing.

## Confidence tiers

| Tier | Eligible games |
|---|---|
| Provisional | 0-2 |
| Developing | 3-9 |
| Established | 10+ |

Exact thresholds: `src/lib/pickleball/opi.ts`'s `confidenceTier()` function
(`>= 10` → `ESTABLISHED`, `>= 3` → `DEVELOPING`, else `PROVISIONAL`) — this
document's table must match that function exactly, not the other way around.

## Storage: `player_performance_snapshots`

Snapshots are maintained incrementally on game finalization/correction for
read performance, but are always fully rebuildable from `player_game_stats`
(itself rebuildable from the append-only `score_events` log via
`rebuildGameProjection`). Two scope types: `SESSION` (one row per session a
player has an eligible game in, `scope_id` = that session's id) and
`ALL_TIME` (`scope_id` = the literal string `'ALL_TIME'`, not `NULL` —
SQLite's `UNIQUE` index treats every `NULL` as distinct from every other
`NULL`, so a `NULL` `scope_id` could never actually enforce "at most one
all-time row per player"). `opi_version` defaults to `'OPI_V1_SCORE_SHARE'`,
reserved for a hypothetical future formula change.

## Team pairing (`balanceTeams`)

Separate from the OPI formula itself: once the queue engine has selected
which players will play (by fairness, not OPI — see the queue engine's own
rules), `balanceTeams` decides how to split them into two competitive sides
by brute-forcing every into-two-sides partition (exactly 3 for 4 players,
trivial for 2) and picking the one minimizing the OPI-sum difference between
sides.
```

- [ ] **Step 4: Write `docs/pickleball/realtime.md`**

Read `src/worker/pickleball/SessionCoordinatorDO.ts`'s broadcast-related code and `src/pickleball-app/lib/useSessionRealtime.js` / `usePublicSessionView.js` before writing, to confirm the wire format and reconnect behavior described below still matches the real code — these two hooks are the reference implementation. Full content, adjusted only if you find it's drifted from the real code:

```markdown
# Devlab Pickleball — Realtime

One Durable Object instance per session (`SessionCoordinatorDO`, keyed by
`idFromName(sessionId)`) serializes every mutating command for that session
and broadcasts a full state snapshot to every connected WebSocket client
after each successful mutation. See
`docs/architecture/decisions/0006-pickleball-durable-objects.md` for why a
DO was chosen over, e.g., D1 optimistic locking.

## Channels

- **Operator channel** — `/pickleball/rt/:sessionId?role=operator`, requires
  the signed session cookie, role-checked. Carries the full internal state:
  registration/attendance detail, queue internals, audit-adjacent fields
  (never raw emails beyond what the role already sees via REST).
- **Public channel** — `/pickleball/rt/:sessionId?code=<publicCode>`, no
  auth required. Carries a strictly sanitized DTO built by a dedicated
  `toPublicSessionView(state)` allowlist mapper (never the internal shape
  with fields stripped — so a newly added internal field can never leak by
  omission): court states, team display names, scores, serving side,
  session name/status, and a sanitized leaderboard (display name, OPI,
  rank, confidence tier only).

## Wire format

Every message is `{ type: 'STATE', payload: <full snapshot> }` — a
full-snapshot-not-diff protocol by design (Decision 3 of the realtime
design), so a client never needs merge/patch logic: on any message, replace
the whole local view with `payload`.

## Reconnect behavior

`useSessionRealtime` (`src/pickleball-app/lib/useSessionRealtime.js`) opens
the socket, tracks `status` (`'connecting' | 'open' | 'closed'`), and on
close reconnects with capped exponential backoff
(`nextBackoffDelayMs`: 1s, 2s, 4s, capped at 8s), keeping the last known
snapshot visible rather than blanking the UI. A reconnect always gets a
fresh full snapshot from the DO — there is no resync protocol to get wrong,
because D1 already holds the true state regardless of client connectivity
(§57 edge case #24).

The public live view and TV/kiosk display additionally fall back to polling
`GET /api/pickleball/public/:code/state` every 5 seconds whenever the socket
isn't `'open'` (`usePublicSessionView`,
`src/pickleball-app/lib/usePublicSessionView.js`) — graceful degradation so
a public viewer's screen keeps advancing during a socket outage instead of
freezing (spec §9).

## Concurrency guarantee

Because the DO processes one request at a time, two simultaneous
court-assignment calls for the same session are naturally serialized: the
second call's reads already reflect the first call's writes. This is what
makes `assignCourt` safe against a player being assigned to two courts at
once without any client-side button-disabling — see the concurrency e2e
test in `tests/e2e/pickleball/pickleball-queue.spec.js`.
```

- [ ] **Step 5: Verify no build regression**

Run: `npm run build`
Expected: succeeds (markdown files don't affect the build, but this confirms nothing else was accidentally left broken from earlier tasks).

- [ ] **Step 6: Commit**

```bash
git add docs/pickleball/architecture.md docs/pickleball/schema.md docs/pickleball/opi-methodology.md docs/pickleball/realtime.md
git commit -m "docs: add architecture, schema, OPI methodology, and realtime docs"
```

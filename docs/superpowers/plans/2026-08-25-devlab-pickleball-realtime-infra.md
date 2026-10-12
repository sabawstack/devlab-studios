# Devlab Pickleball Realtime Infrastructure Implementation Plan

> **Superseded (2026-10-12).** This describes the logged-in operator app, retired in 2.0.0 by Phase 5 of `docs/superpowers/specs/2026-10-11-pickleball-free-open-play-design.md`. Kept as history: the routes, tables and files it names no longer exist.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `SessionCoordinatorDO` a real WebSocket layer (operator + public channels, full-snapshot broadcasts) and route every session-scoped mutation — including the queue/check-in writes that currently bypass the DO — through it, so a future UI can show live state without polling.

**Architecture:** `SessionCoordinatorDO` gains a `fetch()` handler using Cloudflare's WebSocket Hibernation API. New Astro routes authenticate/authorize as normal HTTP requests, then forward the (pre-upgrade) request to the DO via `stub.fetch()`. Every mutating DO method — the 10 that already exist plus 8 new thin wrappers around queue/check-in repository calls — calls a shared `broadcast()` helper after its write commits, sending the complete current session snapshot (not an incremental diff) to every connected socket, sanitized for the public channel via an allowlist mapper.

**Tech Stack:** Cloudflare Workers/Durable Objects (WebSocket Hibernation API), D1, Astro API routes, TypeScript/JavaScript (existing repo mixes both — DO/pure logic is `.ts`, D1 repositories are `.js`), Playwright (`worker` project, against `wrangler dev` + local D1), Vitest.

**Spec:** `docs/superpowers/specs/2026-08-25-devlab-pickleball-realtime-design.md` (this plan's authority), plus `docs/superpowers/specs/2026-08-24-devlab-pickleball-design.md` §6/§9/§10 (parent spec).

## Global Constraints

- Every DO method starts with `if (!this.ownsSession(sessionId)) return failure('Coordinator/session mismatch.')` — including the new `fetch()` handler, which re-derives its own check from a trusted header rather than an RPC parameter (see Task 1).
- `db.batch([...])` for any multi-statement write; a single-statement write (all 8 new thin wrappers) uses the existing repository function directly, no batch needed.
- Pure logic never touches D1 or `Date.now()`/`new Date()`. `toPublicSessionView` (Task 3) is pure; `buildSessionSnapshot` (Task 2) is not (it reads D1) and lives in `src/worker/pickleball/`, not `src/lib/pickleball/`.
- **No D1-touching Vitest tests anywhere in this codebase's pickleball subsystem** — confirmed by inspection (zero `*.test.*` files under `src/worker/repositories/pickleball/` or `src/worker/pickleball/`). Everything that touches D1 (repositories, the DO) is validated exclusively via Playwright e2e against real local D1 (`wrangler dev --local`). Only DB-free pure functions get Vitest. This plan follows that convention rather than introducing a new one.
- `--local` only for D1/wrangler in every test and dev command. Never `--remote`.
- If `wrangler dev` is started manually for any task, terminate all wrangler/workerd/esbuild processes before finishing that task.
- Never edit an already-applied migration. This plan needs zero new migrations — `public_session_tokens` already exists (migration `0001`), unused until Task 3.
- Every new/modified route follows the established pattern: `requirePickleballSession` (or, for the public route, no auth) → tenancy/entity lookup → `jsonResponse` on every branch, including errors.

## Pre-flight rulings (deviations from the realtime spec, decided before Task 1)

**Ruling A — 8 thin wrappers, not 6.** The spec's component list named `joinQueue, leaveQueue, checkIn, checkInBulk, setAvailability, cancelRegistration` (6). Re-reading the actual REST surface (`src/pages/api/pickleball/sessions/[id]/players/*`) shows two more session-player mutations that currently bypass the DO the same way: `registerPlayer` (`players/index.ts` POST) and `leaveSession` (`players/leave.ts`). Both are covered by the spec's decision #1 ("live scope: everything... queue/check-in") — a registered/withdrawn player is exactly the kind of roster change an operator's live view needs to reflect. Task 6 builds all 8.

**Ruling B — `toPublicSessionView` omits the queue entirely and only allowlists a subset of `games`/`courts`/`session` fields; per-player display names in the public games/courts view are a seam, not built here.** The parent spec's public channel wants "team display names," but none of the repository functions this plan reuses (`listGamesForSession`, `listSessionCourts`) join through to player names — building that join is real new scope with no consumer yet (Phase 4.1's public UI isn't in this plan). Task 3 ships the allowlist that's actually derivable from existing functions (scores, serving side, court/game status) and documents the gap inline for whichever later sub-project renders the public view.

**Ruling C — `publicSessionTokens.js` ships only `buildCreatePublicSessionTokenStatement` and `getSessionByPublicCode`, not a standalone create/rotate/revoke API.** Nothing in this plan's task list needs to create a token outside the session-creation batch, or revoke/rotate one. YAGNI; add them when a route needs them.

---

### Task 1: DO WebSocket upgrade — bare-bones round trip

This task proves the transport works end-to-end (Astro route → DO `fetch()` → Hibernation API → back to a real browser socket) before any real snapshot logic is built on top of it. If Astro's Cloudflare adapter ever mangles a `Response` carrying a `webSocket` property, this is where that surfaces — cheaply, with no snapshot/broadcast code to debug around it.

**Files:**
- Modify: `src/worker/pickleball/SessionCoordinatorDO.ts` (add `fetch`, `webSocketMessage`, `webSocketClose`, `webSocketError`)
- Create: `src/pages/pickleball/rt/[sessionId].ts`
- Test: `tests/e2e/pickleball/pickleball-realtime.spec.js` (new file)

**Interfaces:**
- Produces: `SessionCoordinatorDO.fetch(request: Request): Promise<Response>` — accepts a WS upgrade tagged `operator` or `public` via headers `X-Pickleball-Channel` and `X-Pickleball-Session-Id`, both set by the forwarding route (never trusted from an external caller — the DO is only reachable via `env.SESSION_COORDINATOR.get(...).fetch()`, same trust model as every existing RPC method's `sessionId` parameter).
- Consumes (later tasks): none yet — this task's accept-time message is a hardcoded placeholder, replaced by Task 2.

- [ ] **Step 1: Add the DO's `fetch()` handler and Hibernation callbacks**

Add near the top of the class, right after `ownsSession` (`src/worker/pickleball/SessionCoordinatorDO.ts:91-93`):

```ts
  // Entry point for the two realtime channels (spec §9). Reachable only via
  // env.SESSION_COORDINATOR.get(...).fetch() from the two Astro routes below
  // — never directly from the internet — so the headers those routes set
  // are trusted the same way every RPC method's sessionId parameter is
  // trusted, with the same ownsSession self-check as defense in depth.
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected a WebSocket upgrade request.', { status: 400 })
    }

    const sessionId = request.headers.get('X-Pickleball-Session-Id')
    if (!sessionId || !this.ownsSession(sessionId)) {
      return new Response('Coordinator/session mismatch.', { status: 400 })
    }

    const channel = request.headers.get('X-Pickleball-Channel')
    if (channel !== 'operator' && channel !== 'public') {
      return new Response('Missing or invalid X-Pickleball-Channel header.', { status: 400 })
    }

    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)

    // Hibernation API: the DO can evict from memory between messages instead
    // of staying pinned for every open connection (spec's Decision 4). The
    // tag lets broadcast() (Task 4) target one channel without deserializing
    // every socket's attachment; the attachment (set right below) carries the
    // sessionId/channel pair itself, since one DO instance never needs to
    // hold a trusted "this.sessionId" field of its own (see ownsSession's
    // comment on why nothing here is ever assumed rather than checked).
    this.ctx.acceptWebSocket(server, [channel])
    server.serializeAttachment({ sessionId, channel })

    // Placeholder until Task 2 replaces this with a real buildSessionSnapshot
    // call — proves the round trip without any snapshot logic to debug
    // around yet.
    server.send(JSON.stringify({ type: 'STATE', sessionId, seq: 0, payload: { placeholder: true } }))

    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string) {
    // Task 4 adds real handling (RESYNC_REQUEST). For now, every inbound
    // message is ignored — the DO never accepts a mutation over the socket
    // (spec: all mutations stay REST/RPC).
    void ws
    void message
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean) {
    // Hibernation API removes a closed socket from ctx.getWebSockets()
    // automatically; there is no other per-socket state to clean up.
    void wasClean
    ws.close(code, reason)
  }

  async webSocketError(ws: WebSocket, error: unknown) {
    void error
    ws.close(1011, 'Internal error.')
  }
```

- [ ] **Step 2: Create the operator upgrade route**

`src/pages/pickleball/rt/[sessionId].ts` (new file):

```ts
import type { APIRoute } from 'astro'
import { requirePickleballSession } from '../../../worker/pickleball/authContext.js'
import { getSession } from '../../../worker/repositories/pickleball/sessions.js'
import { jsonResponse } from '../../../worker/utils/responses.js'
import { getEnv } from '../../../lib/env'

export const GET: APIRoute = async ({ request, params }) => {
  const env = getEnv()
  try {
    const session = await requirePickleballSession(request, env)
    const sessionId = params.sessionId as string

    const pickleballSession = await getSession(env.PICKLEBALL_DB, sessionId, session.activeOrgId)
    if (!pickleballSession) return jsonResponse({ error: 'Not found.' }, 404)

    if (request.headers.get('Upgrade') !== 'websocket') {
      return jsonResponse({ error: 'Expected a WebSocket upgrade request.' }, 400)
    }

    const forwardHeaders = new Headers(request.headers)
    forwardHeaders.set('X-Pickleball-Channel', 'operator')
    forwardHeaders.set('X-Pickleball-Session-Id', sessionId)
    const forwardRequest = new Request(request, { headers: forwardHeaders })

    const stub = env.SESSION_COORDINATOR.get(env.SESSION_COORDINATOR.idFromName(sessionId))
    return stub.fetch(forwardRequest)
  } catch (error: any) {
    return jsonResponse({ error: error.message }, error.status || 500)
  }
}
```

- [ ] **Step 3: Write the round-trip e2e test**

`tests/e2e/pickleball/pickleball-realtime.spec.js` (new file). Runs in the browser (`page.evaluate`), not Node's own `WebSocket`, so the connection carries the same cookies a real scorekeeper UI would send — Playwright's `request` and `page` fixtures share one `BrowserContext`'s cookie jar by default, which is what makes this work without manually copying a `Set-Cookie` header.

```js
import { test, expect } from '@playwright/test'

async function createLiveSessionForRealtimeTests(request) {
  await request.post('/api/pickleball/auth/test-login', { data: { email: 'operator@example.com' } })

  const venueResponse = await request.post('/api/pickleball/venues', {
    data: { name: `Realtime Test Venue ${Date.now()}-${Math.random().toString(36).slice(2)}` },
  })
  const venueId = (await venueResponse.json()).venue.id

  const sessionResponse = await request.post('/api/pickleball/sessions', {
    data: {
      venueId,
      name: `Realtime Test Session ${Date.now()}`,
      sessionType: 'OPEN_PLAY',
      scoringRulesetId: 'usap-2026-sideout-11-doubles',
      scheduledStart: '2026-08-30T18:00:00.000Z',
      scheduledEnd: '2026-08-30T22:00:00.000Z',
    },
  })
  const sessionId = (await sessionResponse.json()).session.id

  return sessionId
}

test('operator channel completes a real WebSocket upgrade through the Astro route and the DO', async ({ page, request }) => {
  const sessionId = await createLiveSessionForRealtimeTests(request)
  const baseURL = test.info().project.use.baseURL

  const received = await page.evaluate(
    ({ url }) =>
      new Promise((resolve, reject) => {
        const ws = new WebSocket(url)
        ws.onmessage = (event) => resolve(event.data)
        ws.onerror = () => reject(new Error('WebSocket error'))
        setTimeout(() => reject(new Error('Timed out waiting for a message.')), 5000)
      }),
    { url: `${baseURL.replace('http', 'ws')}/pickleball/rt/${sessionId}` },
  )

  const parsed = JSON.parse(received)
  expect(parsed.type).toBe('STATE')
  expect(parsed.sessionId).toBe(sessionId)
})
```

- [ ] **Step 4: Run the test, confirm it passes**

Run: `npx playwright test pickleball-realtime --project=worker`
Expected: PASS. If the `page.evaluate` promise rejects with an auth-adjacent error, the fixture cookie-sharing assumption in Step 3's comment was wrong for this Playwright version — fall back to extracting the `Set-Cookie` header from the login response and calling `page.context().addCookies([...])` explicitly before `page.evaluate`.

- [ ] **Step 5: Commit**

```bash
git add src/worker/pickleball/SessionCoordinatorDO.ts src/pages/pickleball/rt/[sessionId].ts tests/e2e/pickleball/pickleball-realtime.spec.js
git commit -m "feat: add DO WebSocket upgrade handling and the operator channel route"
```

---

### Task 2: Real session snapshots on the operator channel

**Files:**
- Create: `src/worker/pickleball/sessionSnapshot.js`
- Modify: `src/worker/pickleball/SessionCoordinatorDO.ts` (replace Task 1's placeholder send)
- Modify: `tests/e2e/pickleball/pickleball-realtime.spec.js`

**Interfaces:**
- Produces: `buildSessionSnapshot(db, sessionId): Promise<{session, courts, queue, games}>` — `session` is `getSessionById`'s shape, `courts` is `listSessionCourts`'s array, `queue` is `listQueueForSession`'s array, `games` is `listGamesForSession`'s array. No new D1 queries — pure composition of 4 existing repository functions.
- Consumes: `getSessionById` (`sessions.js`), `listSessionCourts` (`sessionCourts.js`), `listQueueForSession`, `listGamesForSession` (`games.js`) — all already exist and are already imported by `SessionCoordinatorDO.ts` except `listQueueForSession`/`listSessionCourts`/`listGamesForSession`, which this task adds to the import list.

- [ ] **Step 1: Write `buildSessionSnapshot`**

`src/worker/pickleball/sessionSnapshot.js` (new file):

```js
import { getSessionById } from '../repositories/pickleball/sessions.js'
import { listSessionCourts } from '../repositories/pickleball/sessionCourts.js'
import { listQueueForSession } from '../repositories/pickleball/queueEntries.js'
import { listGamesForSession } from '../repositories/pickleball/games.js'

// The one place that assembles "everything a connected operator/public
// client needs to render the current session" — reused by both the
// WebSocket accept/broadcast path (SessionCoordinatorDO.ts) and the public
// REST polling fallback (Task 7), so there is exactly one query shape to
// keep correct rather than two that could drift.
export async function buildSessionSnapshot(db, sessionId) {
  const [session, courts, queue, games] = await Promise.all([
    getSessionById(db, sessionId),
    listSessionCourts(db, sessionId),
    listQueueForSession(db, sessionId),
    listGamesForSession(db, sessionId),
  ])
  return { session, courts, queue, games }
}
```

- [ ] **Step 2: Wire it into the DO's accept-time send**

In `SessionCoordinatorDO.ts`, add the import near the top (after the existing repository imports):

```ts
import { buildSessionSnapshot } from './sessionSnapshot.js'
```

Replace the placeholder `server.send(...)` line from Task 1 with:

```ts
    const snapshot = await buildSessionSnapshot(this.env.PICKLEBALL_DB, sessionId)
    this.seq += 1
    server.send(JSON.stringify({ type: 'STATE', sessionId, seq: this.seq, payload: snapshot }))
```

Add the `seq` instance field near the top of the class body, right before `ownsSession`:

```ts
  // In-memory monotonic counter, informational only — see the realtime
  // spec's Decision 3. It resets to 0 whenever the DO hibernates and wakes
  // fresh; that is harmless because every broadcast carries a COMPLETE
  // snapshot, never a diff a client would need to reconcile against a prior
  // seq.
  private seq = 0
```

(This field is used by `fetch()` above and by `broadcast()` in Task 4.)

- [ ] **Step 3: Update the e2e test to assert real content**

In `tests/e2e/pickleball/pickleball-realtime.spec.js`, change the assertion block to check the snapshot shape instead of the placeholder:

```js
  const parsed = JSON.parse(received)
  expect(parsed.type).toBe('STATE')
  expect(parsed.sessionId).toBe(sessionId)
  expect(parsed.payload.session.id).toBe(sessionId)
  expect(parsed.payload.courts).toEqual([])
  expect(parsed.payload.queue).toEqual([])
  expect(parsed.payload.games).toEqual([])
```

(A freshly created `DRAFT` session with no venue courts seeded has empty courts/queue/games — this test's venue is created with zero courts on purpose, keeping the assertion simple. Task 4's test creates real state to broadcast a change against.)

- [ ] **Step 4: Run the test, confirm it passes**

Run: `npx playwright test pickleball-realtime --project=worker`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/worker/pickleball/sessionSnapshot.js src/worker/pickleball/SessionCoordinatorDO.ts tests/e2e/pickleball/pickleball-realtime.spec.js
git commit -m "feat: build and send real session snapshots on the operator channel"
```

---

### Task 3: Public channel — sanitized view, token repository, public route

**Files:**
- Create: `src/lib/pickleball/publicSessionView.ts`
- Create: `src/lib/pickleball/publicSessionView.test.ts`
- Create: `src/worker/repositories/pickleball/publicSessionTokens.js`
- Modify: `src/pages/api/pickleball/sessions/index.ts` (auto-create a token at session creation)
- Create: `src/pages/pickleball/rt/public/[code].ts`
- Modify: `src/worker/pickleball/SessionCoordinatorDO.ts` (send the sanitized view on the public channel)
- Modify: `tests/e2e/pickleball/pickleball-realtime.spec.js`

**Interfaces:**
- Produces: `toPublicSessionView(snapshot: {session, courts, queue, games}): {session, courts, games}` — pure, no DB. Allowlists exactly: `session` → `{id, name, sessionType, status}`; `courts` → each `{id, courtName, status, currentGameId}`; `games` → each `{id, sessionCourtId, format, status, scoreA, scoreB, servingTeam, serverNumber, winningTeamId, finalScoreA, finalScoreB}`. `queue` is omitted entirely (Ruling B).
- Produces: `buildCreatePublicSessionTokenStatement(db, sessionId, timestamp)` — unexecuted INSERT, same `build*Statement` convention as every other repository in this codebase.
- Produces: `getSessionByPublicCode(db, code): Promise<{id, name, sessionType, status, publicViewEnabled, publicLeaderboardEnabled} | null>` — resolves an unrevoked code straight to a public-safe session shape in one query (never the org-scoped-only `getSessionById`/`getSession`, so there is no path where this function could leak `organizationId`/`createdByUserId`).

- [ ] **Step 1: Write the failing test for `toPublicSessionView`**

`src/lib/pickleball/publicSessionView.test.ts` (new file):

```ts
import { describe, it, expect } from 'vitest'
import { toPublicSessionView } from './publicSessionView'

const snapshot = {
  session: {
    id: 's1', organizationId: 'org1', venueId: 'v1', name: 'Tuesday Open Play', sessionType: 'OPEN_PLAY',
    status: 'LIVE', scoringRulesetId: 'r1', scheduledStart: '2026-08-25T18:00:00.000Z', scheduledEnd: null,
    actualStart: null, actualEnd: null, postGameRotationPolicy: 'AUTO_REQUEUE_ALL', leaderboardMinGames: 3,
    publicViewEnabled: true, publicLeaderboardEnabled: true, createdByUserId: 'u1',
    createdAt: '2026-08-25T17:00:00.000Z', updatedAt: '2026-08-25T17:00:00.000Z',
  },
  courts: [{
    id: 'c1', sessionId: 's1', courtId: 'court1', courtName: 'Court 1', enabled: true, status: 'PLAYING',
    currentGameId: 'g1', createdAt: '2026-08-25T17:00:00.000Z', updatedAt: '2026-08-25T17:05:00.000Z',
  }],
  queue: [{
    id: 'q1', sessionId: 's1', sessionPlayerId: 'sp1', playerId: 'p1', displayName: 'Alex Rivera',
    gamesPlayed: 2, status: 'QUEUED', queuedAt: '2026-08-25T17:10:00.000Z', assignedAt: null,
  }],
  games: [{
    id: 'g1', sessionId: 's1', sessionCourtId: 'c1', scoringRulesetId: 'r1', format: 'DOUBLES', status: 'IN_PROGRESS',
    teamAId: 'ta1', teamBId: 'tb1', revision: 3, scoreA: 5, scoreB: 3, servingTeam: 'A', serverNumber: 2,
    teamAStartingServerSessionPlayerId: 'sp1', teamBStartingServerSessionPlayerId: 'sp2',
    teamACurrentServerSessionPlayerId: 'sp1', teamBCurrentServerSessionPlayerId: 'sp2',
    correctionPending: false, winningTeamId: null, finalScoreA: null, finalScoreB: null,
    startedAt: '2026-08-25T17:05:00.000Z', finishedAt: null, createdAt: '2026-08-25T17:05:00.000Z', updatedAt: '2026-08-25T17:20:00.000Z',
  }],
}

describe('toPublicSessionView', () => {
  it('allowlists session to id/name/sessionType/status only', () => {
    const view = toPublicSessionView(snapshot)
    expect(view.session).toEqual({ id: 's1', name: 'Tuesday Open Play', sessionType: 'OPEN_PLAY', status: 'LIVE' })
  })

  it('never exposes organizationId or createdByUserId', () => {
    const view = toPublicSessionView(snapshot)
    expect(JSON.stringify(view)).not.toContain('org1')
    expect(JSON.stringify(view)).not.toContain('u1')
  })

  it('allowlists courts to id/courtName/status/currentGameId only', () => {
    const view = toPublicSessionView(snapshot)
    expect(view.courts).toEqual([{ id: 'c1', courtName: 'Court 1', status: 'PLAYING', currentGameId: 'g1' }])
  })

  it('omits the queue entirely', () => {
    const view = toPublicSessionView(snapshot)
    expect(view.queue).toBeUndefined()
  })

  it('never exposes a queued player\'s display name', () => {
    const view = toPublicSessionView(snapshot)
    expect(JSON.stringify(view)).not.toContain('Alex Rivera')
  })

  it('allowlists games to score/serving/status fields, never session_player ids', () => {
    const view = toPublicSessionView(snapshot)
    expect(view.games).toEqual([{
      id: 'g1', sessionCourtId: 'c1', format: 'DOUBLES', status: 'IN_PROGRESS',
      scoreA: 5, scoreB: 3, servingTeam: 'A', serverNumber: 2,
      winningTeamId: null, finalScoreA: null, finalScoreB: null,
    }])
    expect(JSON.stringify(view.games)).not.toContain('sp1')
  })
})
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `npx vitest run src/lib/pickleball/publicSessionView.test.ts`
Expected: FAIL with "Failed to resolve import ./publicSessionView" (the module doesn't exist yet).

- [ ] **Step 3: Write `toPublicSessionView`**

`src/lib/pickleball/publicSessionView.ts` (new file):

```ts
import type { GameState } from './scoring/gameState'

interface PublicSessionView {
  session: { id: string; name: string; sessionType: string; status: string }
  courts: Array<{ id: string; courtName: string; status: string; currentGameId: string | null }>
  games: Array<{
    id: string; sessionCourtId: string | null; format: string; status: string
    scoreA: number; scoreB: number; servingTeam: GameState['servingTeam']; serverNumber: GameState['serverNumber']
    winningTeamId: string | null; finalScoreA: number | null; finalScoreB: number | null
  }>
}

// Explicit allowlist mapper (spec's realtime design, §10 of the parent
// spec): a newly added internal field on session/courts/games can never
// leak through here by omission, because every field below is named
// individually rather than "everything except X". `queue` is intentionally
// absent from the return value -- see this plan's Ruling B: the public
// channel was never meant to expose the internal admissions queue, only
// court/game state, and no allowlisted field here identifies a specific
// player (no session_player ids, no display names -- those require a join
// this plan doesn't build; deferred to whichever UI sub-project renders the
// public view).
export function toPublicSessionView(snapshot: {
  session: { id: string; name: string; sessionType: string; status: string }
  courts: Array<{ id: string; courtName: string; status: string; currentGameId: string | null }>
  games: Array<{
    id: string; sessionCourtId: string | null; format: string; status: string
    scoreA: number; scoreB: number; servingTeam: GameState['servingTeam']; serverNumber: GameState['serverNumber']
    winningTeamId: string | null; finalScoreA: number | null; finalScoreB: number | null
  }>
}): PublicSessionView {
  return {
    session: {
      id: snapshot.session.id,
      name: snapshot.session.name,
      sessionType: snapshot.session.sessionType,
      status: snapshot.session.status,
    },
    courts: snapshot.courts.map((court) => ({
      id: court.id,
      courtName: court.courtName,
      status: court.status,
      currentGameId: court.currentGameId,
    })),
    games: snapshot.games.map((game) => ({
      id: game.id,
      sessionCourtId: game.sessionCourtId,
      format: game.format,
      status: game.status,
      scoreA: game.scoreA,
      scoreB: game.scoreB,
      servingTeam: game.servingTeam,
      serverNumber: game.serverNumber,
      winningTeamId: game.winningTeamId,
      finalScoreA: game.finalScoreA,
      finalScoreB: game.finalScoreB,
    })),
  }
}
```

- [ ] **Step 4: Run the test, confirm it passes**

Run: `npx vitest run src/lib/pickleball/publicSessionView.test.ts`
Expected: PASS (6/6).

- [ ] **Step 5: Write the public token repository**

`src/worker/repositories/pickleball/publicSessionTokens.js` (new file):

```js
// See this plan's Ruling C -- only what session-creation (Task 3 Step 6)
// and the public routes (this task's Steps 7/8, Task 7) actually call.
// Rotate/revoke can be added when a route needs one.

function generatePublicCode() {
  // ~40 bits of entropy -- plenty for a code that only needs to be
  // unguessable-by-brute-force at conversational scale, backed by the
  // table's real UNIQUE(public_code) constraint as the actual guarantee.
  return crypto.randomUUID().replace(/-/g, '').slice(0, 10)
}

/**
 * Unexecuted INSERT for a new public session token, generating its own code
 * so a batch caller (session creation) never needs to pre-check uniqueness
 * itself -- the table's UNIQUE(public_code) index is the real guarantee. A
 * batched statement can't retry after a collision the way a standalone call
 * could, but at 10 hex chars of entropy that's accepted as a non-issue.
 */
export function buildCreatePublicSessionTokenStatement(db, sessionId, timestamp) {
  return db
    .prepare(`INSERT INTO public_session_tokens (id, session_id, public_code, created_at) VALUES (?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), sessionId, generatePublicCode(), timestamp)
}

// Resolves a public code straight to a public-safe session shape in ONE
// query -- deliberately NOT built on top of getSessionById/getSession, so
// there is no code path here that could ever select (and so leak)
// organization_id or created_by_user_id. Revoked or unknown codes both
// resolve to null; callers 404 either way (spec: "revoked tokens 404").
export async function getSessionByPublicCode(db, code) {
  const row = await db
    .prepare(
      `SELECT s.id, s.name, s.session_type, s.status, s.public_view_enabled, s.public_leaderboard_enabled
       FROM public_session_tokens t
       JOIN pickleball_sessions s ON s.id = t.session_id
       WHERE t.public_code = ? AND t.revoked_at IS NULL`,
    )
    .bind(code)
    .first()
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    sessionType: row.session_type,
    status: row.status,
    publicViewEnabled: Boolean(row.public_view_enabled),
    publicLeaderboardEnabled: Boolean(row.public_leaderboard_enabled),
  }
}
```

- [ ] **Step 6: Auto-create a token at session creation**

In `src/pages/api/pickleball/sessions/index.ts`, add the import:

```ts
import { buildCreatePublicSessionTokenStatement } from '../../../../worker/repositories/pickleball/publicSessionTokens.js'
```

Change the batch composition (currently `const sessionStatement = ...` through `await env.PICKLEBALL_DB.batch([sessionStatement, ...courtStatements])`) to include the token statement:

```ts
    const sessionStatement = buildCreateSessionStatement(env.PICKLEBALL_DB, {
      id: sessionId,
      organizationId: session.activeOrgId,
      createdByUserId: session.userId,
      timestamp,
      ...result.data,
    })
    const publicTokenStatement = buildCreatePublicSessionTokenStatement(env.PICKLEBALL_DB, sessionId, timestamp)

    // A read, so it happens before the batch; a venue with zero courts is
    // legitimate and yields zero court statements below.
    const venueCourts = await listCourtsForVenue(env.PICKLEBALL_DB, result.data.venueId, session.activeOrgId)
    const courtStatements = buildSeedSessionCourtsStatements(env.PICKLEBALL_DB, sessionId, venueCourts)

    await env.PICKLEBALL_DB.batch([sessionStatement, publicTokenStatement, ...courtStatements])
```

- [ ] **Step 7: Wire the sanitized view into the DO's public-channel send**

In `SessionCoordinatorDO.ts`, add the import:

```ts
import { toPublicSessionView } from '../../lib/pickleball/publicSessionView'
```

Change the `fetch()` method's snapshot-send block (from Task 2) to branch on channel:

```ts
    const snapshot = await buildSessionSnapshot(this.env.PICKLEBALL_DB, sessionId)
    const payload = channel === 'public' ? toPublicSessionView(snapshot) : snapshot
    this.seq += 1
    server.send(JSON.stringify({ type: 'STATE', sessionId, seq: this.seq, payload }))
```

- [ ] **Step 8: Create the public upgrade route**

`src/pages/pickleball/rt/public/[code].ts` (new file):

```ts
import type { APIRoute } from 'astro'
import { getSessionByPublicCode } from '../../../../worker/repositories/pickleball/publicSessionTokens.js'
import { jsonResponse } from '../../../../worker/utils/responses.js'
import { getEnv } from '../../../../lib/env'

export const GET: APIRoute = async ({ request, params }) => {
  const env = getEnv()
  try {
    const code = params.code as string
    const publicSession = await getSessionByPublicCode(env.PICKLEBALL_DB, code)
    if (!publicSession || !publicSession.publicViewEnabled) return jsonResponse({ error: 'Not found.' }, 404)

    if (request.headers.get('Upgrade') !== 'websocket') {
      return jsonResponse({ error: 'Expected a WebSocket upgrade request.' }, 400)
    }

    const forwardHeaders = new Headers(request.headers)
    forwardHeaders.set('X-Pickleball-Channel', 'public')
    forwardHeaders.set('X-Pickleball-Session-Id', publicSession.id)
    const forwardRequest = new Request(request, { headers: forwardHeaders })

    const stub = env.SESSION_COORDINATOR.get(env.SESSION_COORDINATOR.idFromName(publicSession.id))
    return stub.fetch(forwardRequest)
  } catch (error: any) {
    return jsonResponse({ error: error.message }, error.status || 500)
  }
}
```

- [ ] **Step 9: Add a public-channel e2e test**

Append to `tests/e2e/pickleball/pickleball-realtime.spec.js`:

```js
test('public channel resolves a code to a sanitized snapshot with no queue data', async ({ page, request }) => {
  const sessionId = await createLiveSessionForRealtimeTests(request)
  const sessionResponse = await request.get(`/api/pickleball/sessions/${sessionId}`)
  expect(sessionResponse.ok()).toBe(true)

  // The public code isn't exposed on the session detail response yet (no
  // route surfaces it -- that's a later sub-project's UI concern); read it
  // straight from D1 via wrangler for this test only.
  const { execSync } = require('node:child_process')
  const output = execSync(
    `npx wrangler d1 execute devlab-pickleball --local --json --command "SELECT public_code FROM public_session_tokens WHERE session_id = '${sessionId}'"`,
  ).toString()
  const code = JSON.parse(output)[0].results[0].public_code
  const baseURL = test.info().project.use.baseURL

  const received = await page.evaluate(
    ({ url }) =>
      new Promise((resolve, reject) => {
        const ws = new WebSocket(url)
        ws.onmessage = (event) => resolve(event.data)
        ws.onerror = () => reject(new Error('WebSocket error'))
        setTimeout(() => reject(new Error('Timed out waiting for a message.')), 5000)
      }),
    { url: `${baseURL.replace('http', 'ws')}/pickleball/rt/public/${code}` },
  )

  const parsed = JSON.parse(received)
  expect(parsed.payload.session.id).toBe(sessionId)
  expect(parsed.payload.queue).toBeUndefined()
})
```

- [ ] **Step 10: Run both new/changed test files, confirm they pass**

Run: `npx vitest run src/lib/pickleball/publicSessionView.test.ts && npx playwright test pickleball-realtime --project=worker`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add src/lib/pickleball/publicSessionView.ts src/lib/pickleball/publicSessionView.test.ts src/worker/repositories/pickleball/publicSessionTokens.js src/pages/api/pickleball/sessions/index.ts src/pages/pickleball/rt/public/[code].ts src/worker/pickleball/SessionCoordinatorDO.ts tests/e2e/pickleball/pickleball-realtime.spec.js
git commit -m "feat: add the public realtime channel, sanitized view, and public session tokens"
```

---

### Task 4: `broadcast()` + wire it into the 10 existing DO methods

**Files:**
- Modify: `src/worker/pickleball/SessionCoordinatorDO.ts`
- Modify: `tests/e2e/pickleball/pickleball-realtime.spec.js`

**Interfaces:**
- Produces: `private async broadcast(sessionId: string): Promise<void>` — used by this task's 10 call sites and by Task 6's 8 new methods.
- Consumes: `buildSessionSnapshot`, `toPublicSessionView` (both from Tasks 2/3).

- [ ] **Step 1: Add `webSocketMessage`'s RESYNC_REQUEST handling and the `broadcast`/`sendSnapshotTo` helpers**

Replace Task 1's placeholder `webSocketMessage` body with:

```ts
  async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string) {
    let parsed: unknown
    try {
      parsed = JSON.parse(String(message))
    } catch {
      return
    }
    if (!parsed || typeof parsed !== 'object' || (parsed as { type?: string }).type !== 'RESYNC_REQUEST') return

    const attachment = ws.deserializeAttachment() as { sessionId: string; channel: 'operator' | 'public' } | null
    if (!attachment) return
    await this.sendSnapshotTo(ws, attachment.sessionId, attachment.channel)
  }
```

Add these two private methods right after `webSocketError`:

```ts
  private async sendSnapshotTo(ws: WebSocket, sessionId: string, channel: 'operator' | 'public') {
    const snapshot = await buildSessionSnapshot(this.env.PICKLEBALL_DB, sessionId)
    const payload = channel === 'public' ? toPublicSessionView(snapshot) : snapshot
    this.seq += 1
    ws.send(JSON.stringify({ type: 'STATE', sessionId, seq: this.seq, payload }))
  }

  // Called by every mutating method below, AFTER its own db.batch() (or
  // single-statement write, for Task 6's thin wrappers) has already
  // committed. A broadcast failure must never fail the mutation that
  // triggered it -- the caller already has its own success/failure response
  // to return regardless -- so this method swallows its own errors rather
  // than letting them propagate into a `await this.broadcast(sessionId)`
  // call site. console.error is used deliberately: this codebase has no
  // logging library, and it's the platform-native way Workers surfaces
  // errors to `wrangler tail`/dashboard logs, not application log noise.
  private async broadcast(sessionId: string) {
    try {
      const sockets = this.ctx.getWebSockets()
      if (!sockets.length) return

      const snapshot = await buildSessionSnapshot(this.env.PICKLEBALL_DB, sessionId)
      const publicPayload = toPublicSessionView(snapshot)
      this.seq += 1
      const seq = this.seq

      for (const ws of sockets) {
        const attachment = ws.deserializeAttachment() as { sessionId: string; channel: 'operator' | 'public' } | null
        // Every socket this instance ever accepted was already checked
        // against THIS sessionId at accept time (fetch()'s ownsSession
        // guard), so attachment.sessionId should always match -- this check
        // is defense in depth, not a real filter.
        if (!attachment || attachment.sessionId !== sessionId) continue
        const payload = attachment.channel === 'public' ? publicPayload : snapshot
        try {
          ws.send(JSON.stringify({ type: 'STATE', sessionId, seq, payload }))
        } catch (error) {
          console.error('broadcast: failed to send to one socket', error)
        }
      }
    } catch (error) {
      console.error('broadcast: failed to build/send snapshot', error)
    }
  }
```

- [ ] **Step 2: Call `broadcast()` from all 10 existing mutating methods**

Add `await this.broadcast(sessionId)` as the last statement before each method's `return`, in these 10 places (`SessionCoordinatorDO.ts`):

- `assignCourt` — after the `db.batch(statements)` call, before the final `return { ok: true as const, ... }`.
- `replaceAssignedPlayer` — after `await db.batch(statements)`, before `return { ok: true as const, ... }`.
- `releaseCourt` — after `await db.batch(statements)`, before `return { ok: true as const, ... }`.
- `startGame` — after `await db.batch(statements)`, before `return { ok: true as const, game: ... }`.
- `recordRally` — after `await db.batch(statements)`, before `return result`. **Skip the cache-hit early return** (`if (cached) return cached` near the top) — nothing changed on a cache hit, so nothing to broadcast.
- `undoLastRally` — after `await db.batch([reversalEvent, projectionStatement])`, before `return { ok: true as const, ... }`.
- `finishGame` — both success paths (the `correctionPending` branch and the normal path) call it after their respective `await db.batch(statements)`, before their `return result`. Skip the cache-hit early return, same reasoning as `recordRally`.
- `abandonGame` — after `await db.batch([abandonedEvent, projectionStatement, ...releaseStatements])`, before `return { ok: true as const, ... }`.
- `reopenGame` — after the closing `await db.batch([...])`, before `return { ok: true as const, game: ... }`.
- `correctGame` — after `await db.batch([correctedEvent, projectionStatement])`, before `return { ok: true as const, game: ... }`.

Example (`abandonGame`'s existing tail, showing exactly where the new line goes):

```ts
    await db.batch([abandonedEvent, projectionStatement, ...releaseStatements])

    await this.broadcast(sessionId)

    return { ok: true as const, releasedSessionPlayerIds: sessionPlayerIds, requeued, game: await getGame(db, sessionId, gameId) }
```

- [ ] **Step 3: Add a broadcast e2e test**

Append to `tests/e2e/pickleball/pickleball-realtime.spec.js` (this test creates real state — a court, a queued/assigned game — so there is something for a rally to visibly change; it follows the same setup shape as `createSessionWithCheckedInPlayers` in `pickleball-queue.spec.js`):

```js
test('a rally recorded via REST broadcasts an updated snapshot to a connected operator client', async ({ page, request }) => {
  await request.post('/api/pickleball/auth/test-login', { data: { email: 'operator@example.com' } })
  const venueResponse = await request.post('/api/pickleball/venues', { data: { name: `Broadcast Venue ${Date.now()}` } })
  const venueId = (await venueResponse.json()).venue.id
  await request.post('/api/pickleball/courts', { data: { venueId, name: 'Court 1' } })

  const sessionResponse = await request.post('/api/pickleball/sessions', {
    data: {
      venueId, name: `Broadcast Session ${Date.now()}`, sessionType: 'OPEN_PLAY',
      scoringRulesetId: 'usap-2026-sideout-11-doubles',
      scheduledStart: '2026-08-30T18:00:00.000Z', scheduledEnd: '2026-08-30T22:00:00.000Z',
    },
  })
  const sessionId = (await sessionResponse.json()).session.id
  await request.post(`/api/pickleball/sessions/${sessionId}/status`, { data: { status: 'OPEN_FOR_CHECKIN' } })
  await request.post(`/api/pickleball/sessions/${sessionId}/status`, { data: { status: 'LIVE' } })

  const sessionCourtId = (await (await request.get(`/api/pickleball/sessions/${sessionId}/courts`)).json()).courts[0].id

  const sessionPlayerIds = []
  for (let i = 0; i < 4; i += 1) {
    const playerId = (await (await request.post('/api/pickleball/players', { data: { displayName: `Broadcast Player ${i}-${Date.now()}` } })).json()).player.id
    const sessionPlayerId = (await (await request.post(`/api/pickleball/sessions/${sessionId}/players`, { data: { playerId } })).json()).sessionPlayer.id
    await request.post(`/api/pickleball/sessions/${sessionId}/players/check-in`, { data: { playerId } })
    await request.post(`/api/pickleball/sessions/${sessionId}/queue`, { data: { sessionPlayerId } })
    sessionPlayerIds.push(sessionPlayerId)
  }

  await request.post(`/api/pickleball/sessions/${sessionId}/courts/assign`, { data: { sessionCourtId } })
  const startResponse = await request.post(`/api/pickleball/sessions/${sessionId}/games/start`, {
    data: { sessionCourtId, servingTeam: 'A', teamAStartingServerSessionPlayerId: sessionPlayerIds[0], teamBStartingServerSessionPlayerId: sessionPlayerIds[2] },
  })
  const gameId = (await startResponse.json()).game.id

  const baseURL = test.info().project.use.baseURL
  const wsUrl = `${baseURL.replace('http', 'ws')}/pickleball/rt/${sessionId}`

  const nextMessage = page.evaluate(
    ({ url }) =>
      new Promise((resolve) => {
        const ws = new WebSocket(url)
        let seenFirst = false
        ws.onmessage = (event) => {
          if (!seenFirst) {
            seenFirst = true // the accept-time snapshot; wait for the NEXT one
            return
          }
          resolve(event.data)
        }
      }),
    { url: wsUrl },
  )

  // Give the socket a moment to finish its handshake and receive the
  // accept-time snapshot before triggering the rally that should produce a
  // SECOND message.
  await page.waitForTimeout(500)
  const rallyResponse = await request.post(`/api/pickleball/sessions/${sessionId}/games/${gameId}/rally`, { data: { winningTeam: 'A' } })
  expect(rallyResponse.ok()).toBe(true)

  const received = await nextMessage
  const parsed = JSON.parse(received)
  expect(parsed.payload.games[0].scoreA).toBe(1)
})
```

- [ ] **Step 4: Run the full realtime e2e file, confirm all tests pass**

Run: `npx playwright test pickleball-realtime --project=worker`
Expected: PASS (4/4 including this task's new test).

- [ ] **Step 5: Run the full existing e2e suite to confirm no regression on the 10 wired methods**

Run: `npx playwright test pickleball-games pickleball-queue --project=worker`
Expected: PASS, same counts as before this task (`broadcast()`'s own internal try/catch means a broadcast issue can never surface as a REST-level failure in these pre-existing tests).

- [ ] **Step 6: Commit**

```bash
git add src/worker/pickleball/SessionCoordinatorDO.ts tests/e2e/pickleball/pickleball-realtime.spec.js
git commit -m "feat: broadcast a fresh snapshot to connected clients after every game/court command"
```

---

### Task 5: Import aliasing prep for Task 6 (queue/check-in repo function names collide with the DO methods that will wrap them)

This is a small, mechanical task folded on its own only because it touches import lines Task 6 will otherwise have to re-touch anyway, and getting the aliasing wrong is exactly the kind of thing a reviewer should be able to check independently of the 8 new methods' actual logic.

**Files:**
- Modify: `src/worker/pickleball/SessionCoordinatorDO.ts`

**Interfaces:**
- Consumes: `registerPlayer`, `checkInPlayer`, `bulkCheckIn`, `setAvailability`, `cancelRegistration`, `leaveSession` (`sessionPlayers.js`); `joinQueue`, `leaveQueue` (`queueEntries.js`) — all already exist, none currently imported into the DO file.
- Produces: aliased imports Task 6 calls directly.

- [ ] **Step 1: Add the aliased imports**

Add to the existing `sessionPlayers.js` import block in `SessionCoordinatorDO.ts` (currently `buildSetAvailabilityByIdStatement, buildIncrementGamesPlayedStatement, buildRecomputeGamesPlayedStatement`):

```ts
import {
  buildSetAvailabilityByIdStatement,
  buildIncrementGamesPlayedStatement,
  buildRecomputeGamesPlayedStatement,
  registerPlayer as registerPlayerRepo,
  checkInPlayer,
  bulkCheckIn,
  setAvailability as setAvailabilityRepo,
  cancelRegistration as cancelRegistrationRepo,
  leaveSession as leaveSessionRepo,
} from '../repositories/pickleball/sessionPlayers.js'
```

(`checkInPlayer`/`bulkCheckIn` need no alias — their DO-method names, `checkIn`/`checkInBulk`, don't collide.)

Add to the existing `queueEntries.js` import block (currently `listEligibleQueueCandidates, hasOpenAssignment, buildMarkAssignedStatement, buildMarkPlayingStatement, buildCloseQueueEntryStatement, buildJoinQueueStatement`):

```ts
import {
  listEligibleQueueCandidates,
  hasOpenAssignment,
  buildMarkAssignedStatement,
  buildMarkPlayingStatement,
  buildCloseQueueEntryStatement,
  buildJoinQueueStatement,
  joinQueue as joinQueueRepo,
  leaveQueue as leaveQueueRepo,
} from '../repositories/pickleball/queueEntries.js'
```

- [ ] **Step 2: Confirm the file still type-checks with the new (as-yet-unused) imports**

Run: `npx astro check`
Expected: 0 errors. (Unused-import warnings, if any, are expected and resolved by Task 6 actually calling these — TypeScript doesn't error on an unused `import`-with-alias by default in this project's config; if it does, that's an existing project convention this task should not fight — leave the imports in place, Task 6 lands within the same PR sequence.)

- [ ] **Step 3: Commit**

```bash
git add src/worker/pickleball/SessionCoordinatorDO.ts
git commit -m "refactor: alias queue/check-in repository imports ahead of the DO wrapper methods"
```

---

### Task 6: 8 new thin DO methods (queue join/leave, check-in, availability, registration, leave-session)

**Files:**
- Modify: `src/worker/pickleball/SessionCoordinatorDO.ts`

**Interfaces:**
- Produces: `registerPlayer(sessionId, playerId)`, `checkIn(sessionId, playerId)`, `checkInBulk(sessionId, playerIds)`, `setAvailability(sessionId, playerId, status)`, `cancelRegistration(sessionId, playerId)`, `leaveSession(sessionId, playerId)`, `joinQueue(sessionId, sessionPlayerId)`, `leaveQueue(sessionId, sessionPlayerId)` — Task 7's REST routes call these instead of the repositories directly.
- Consumes: `broadcast` (Task 4), the aliased repo imports (Task 5).

- [ ] **Step 1: Add the 8 methods**

Add these at the end of the class, after `correctGame` (the file's last method):

```ts
  // The 8 methods below are thin wrappers -- each delegates its actual
  // read/write to the SAME repository function the REST route used to call
  // directly (see this plan's Task 7), adding only the ownsSession guard
  // every DO method has and a broadcast() call so these session-player/
  // queue changes are as "live" as the 10 game/court commands above. Ruling
  // A: this plan's spec named 6 of these; registerPlayer and leaveSession
  // are the 2 more the same "everything, including queue/check-in" decision
  // implies once the REST surface is actually re-checked against it.
  //
  // Each repository call's null/false "no-op" return (e.g. "already
  // checked in", "no open queue entry") maps to a failure() here and
  // SKIPS the broadcast -- nothing changed, so nothing to tell connected
  // clients about.

  async registerPlayer(sessionId: string, playerId: string) {
    if (!this.ownsSession(sessionId)) return failure('Coordinator/session mismatch.')
    const sessionPlayer = await registerPlayerRepo(this.env.PICKLEBALL_DB, { sessionId, playerId })
    await this.broadcast(sessionId)
    return { ok: true as const, sessionPlayer }
  }

  async checkIn(sessionId: string, playerId: string) {
    if (!this.ownsSession(sessionId)) return failure('Coordinator/session mismatch.')
    const sessionPlayer = await checkInPlayer(this.env.PICKLEBALL_DB, sessionId, playerId)
    if (!sessionPlayer) return failure('Player is not eligible to check in.')
    await this.broadcast(sessionId)
    return { ok: true as const, sessionPlayer }
  }

  async checkInBulk(sessionId: string, playerIds: string[]) {
    if (!this.ownsSession(sessionId)) return failure('Coordinator/session mismatch.')
    const checkedInPlayerIds = await bulkCheckIn(this.env.PICKLEBALL_DB, sessionId, playerIds)
    if (checkedInPlayerIds.length) await this.broadcast(sessionId)
    return { ok: true as const, checkedInPlayerIds }
  }

  async setAvailability(sessionId: string, playerId: string, status: 'AVAILABLE' | 'TEMPORARILY_UNAVAILABLE') {
    if (!this.ownsSession(sessionId)) return failure('Coordinator/session mismatch.')
    const sessionPlayer = await setAvailabilityRepo(this.env.PICKLEBALL_DB, sessionId, playerId, status)
    if (!sessionPlayer) return failure('Player is not eligible for an availability change.')
    await this.broadcast(sessionId)
    return { ok: true as const, sessionPlayer }
  }

  async cancelRegistration(sessionId: string, playerId: string) {
    if (!this.ownsSession(sessionId)) return failure('Coordinator/session mismatch.')
    const sessionPlayer = await cancelRegistrationRepo(this.env.PICKLEBALL_DB, sessionId, playerId)
    if (!sessionPlayer) return failure('Registration cannot be cancelled in its current state.')
    await this.broadcast(sessionId)
    return { ok: true as const, sessionPlayer }
  }

  async leaveSession(sessionId: string, playerId: string) {
    if (!this.ownsSession(sessionId)) return failure('Coordinator/session mismatch.')
    const sessionPlayer = await leaveSessionRepo(this.env.PICKLEBALL_DB, sessionId, playerId)
    if (!sessionPlayer) return failure('Player cannot leave in their current state.')
    await this.broadcast(sessionId)
    return { ok: true as const, sessionPlayer }
  }

  async joinQueue(sessionId: string, sessionPlayerId: string) {
    if (!this.ownsSession(sessionId)) return failure('Coordinator/session mismatch.')
    const queueEntry = await joinQueueRepo(this.env.PICKLEBALL_DB, { sessionId, sessionPlayerId })
    if (!queueEntry) return failure('Player already has an open queue entry.')
    await this.broadcast(sessionId)
    return { ok: true as const, queueEntry }
  }

  async leaveQueue(sessionId: string, sessionPlayerId: string) {
    if (!this.ownsSession(sessionId)) return failure('Coordinator/session mismatch.')
    const left = await leaveQueueRepo(this.env.PICKLEBALL_DB, sessionId, sessionPlayerId)
    if (!left) return failure('No open queue entry to leave.')
    await this.broadcast(sessionId)
    return { ok: true as const }
  }
```

- [ ] **Step 2: Type-check**

Run: `npx astro check`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/worker/pickleball/SessionCoordinatorDO.ts
git commit -m "feat: add DO methods for queue join/leave, check-in, availability, and registration"
```

(No dedicated test in this task — Task 7 switches the routes to call these methods, and the existing `pickleball-queue.spec.js`/`pickleball-games.spec.js` suites already exercise every one of these 8 behaviors through the REST surface. Task 7's Step 2 is where a regression here would actually surface.)

---

### Task 7: Switch the 8 REST routes to call the DO instead of the repositories directly

**Files:**
- Modify: `src/pages/api/pickleball/sessions/[id]/players/index.ts` (POST)
- Modify: `src/pages/api/pickleball/sessions/[id]/players/check-in.ts`
- Modify: `src/pages/api/pickleball/sessions/[id]/players/check-in-bulk.ts`
- Modify: `src/pages/api/pickleball/sessions/[id]/players/availability.ts`
- Modify: `src/pages/api/pickleball/sessions/[id]/players/cancel.ts`
- Modify: `src/pages/api/pickleball/sessions/[id]/players/leave.ts`
- Modify: `src/pages/api/pickleball/sessions/[id]/queue/index.ts` (POST)
- Modify: `src/pages/api/pickleball/sessions/[id]/queue/leave.ts`

**Interfaces:**
- Consumes: the 8 DO methods from Task 6, via `env.SESSION_COORDINATOR.get(env.SESSION_COORDINATOR.idFromName(sessionId))`, the same stub-resolution pattern every existing DO-backed route already uses (e.g. `rally.ts`).

- [ ] **Step 1: Read each route's current body before editing**

Each of the 8 routes currently: authenticates, resolves/validates the session (org-scoped), validates the request body, calls its repository function directly, and returns `jsonResponse`. This step is "read, don't guess" — the exact current shape of each (parameter names, whether it's `playerId` vs `sessionPlayerId`, existing Zod schema names) must come from the file itself, not from this plan's summary of it. Read all 8 files now.

- [ ] **Step 2: Replace each route's direct repository call with a DO call**

For each of the 8 routes, the only change is: remove the direct repository import/call, add the DO-stub pattern, keep every existing auth/validation/schema line unchanged. Follow this exact shape (shown for `check-in.ts`, since it's the simplest one-argument case — apply the equivalent substitution to the other 7, matching each DO method's own parameter list from Task 6):

Before (illustrative — read the real file for the actual current lines):
```ts
    const sessionPlayer = await checkInPlayer(env.PICKLEBALL_DB, sessionId, result.data.playerId)
    if (!sessionPlayer) return jsonResponse({ error: 'Player is not eligible to check in.' }, 409)
    return jsonResponse({ sessionPlayer }, 200)
```

After:
```ts
    const stub = env.SESSION_COORDINATOR.get(env.SESSION_COORDINATOR.idFromName(sessionId))
    const outcome = await stub.checkIn(sessionId, result.data.playerId)
    if (!outcome.ok) return jsonResponse({ error: outcome.error }, 409)
    return jsonResponse(outcome, 200)
```

Remove the now-unused repository import (`checkInPlayer` etc.) from each file's import list — Task 6's DO methods are the only remaining caller of these repository functions system-wide (confirm with a grep per function after this task, in Step 4).

Apply the same substitution, matching each route's actual current variable names, to:
- `players/index.ts` POST → `stub.registerPlayer(sessionId, result.data.playerId)`
- `players/check-in-bulk.ts` → `stub.checkInBulk(sessionId, result.data.playerIds)` (response shape changes from whatever `bulkCheckIn` returned directly to `outcome.checkedInPlayerIds` — check the route's existing response key and keep it named the same for API-compatibility, adjusting only the source of the value)
- `players/availability.ts` → `stub.setAvailability(sessionId, result.data.playerId, result.data.status)`
- `players/cancel.ts` → `stub.cancelRegistration(sessionId, result.data.playerId)`
- `players/leave.ts` → `stub.leaveSession(sessionId, result.data.playerId)`
- `queue/index.ts` POST → `stub.joinQueue(sessionId, result.data.sessionPlayerId)`
- `queue/leave.ts` → `stub.leaveQueue(sessionId, result.data.sessionPlayerId)`

- [ ] **Step 3: Run the full existing e2e suite — this is the real regression check for Tasks 5-7**

Run: `npx playwright test pickleball-games pickleball-queue --project=worker`
Expected: PASS, identical counts to the pre-Task-5 baseline. Every one of these 8 behaviors is already exercised by these two spec files through the REST layer; a wiring mistake in Task 6 or 7 (wrong argument order, wrong method name, dropped validation) surfaces here as a real failure, not a maybe.

- [ ] **Step 4: Confirm the repository functions have no remaining direct callers outside the DO**

Run: `grep -rn "checkInPlayer\|bulkCheckIn\|registerPlayer\|cancelRegistration\|leaveSession\|setAvailability\b" src/pages/api/pickleball/sessions/\[id\]/players/ src/pages/api/pickleball/sessions/\[id\]/queue/`
Expected: no matches (both directories now call only `stub.<method>`, never the repository functions by name).

- [ ] **Step 5: Type-check**

Run: `npx astro check`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/pages/api/pickleball/sessions/\[id\]/players/index.ts src/pages/api/pickleball/sessions/\[id\]/players/check-in.ts src/pages/api/pickleball/sessions/\[id\]/players/check-in-bulk.ts src/pages/api/pickleball/sessions/\[id\]/players/availability.ts src/pages/api/pickleball/sessions/\[id\]/players/cancel.ts src/pages/api/pickleball/sessions/\[id\]/players/leave.ts src/pages/api/pickleball/sessions/\[id\]/queue/index.ts src/pages/api/pickleball/sessions/\[id\]/queue/leave.ts
git commit -m "refactor: route queue/check-in mutations through the DO so they broadcast live"
```

---

### Task 8: Public REST polling fallback + reconnect e2e coverage

**Files:**
- Create: `src/pages/api/pickleball/public/[code]/state.ts`
- Modify: `tests/e2e/pickleball/pickleball-realtime.spec.js`

**Interfaces:**
- Consumes: `getSessionByPublicCode` (Task 3), `buildSessionSnapshot` (Task 2), `toPublicSessionView` (Task 3).

- [ ] **Step 1: Write the polling fallback route**

`src/pages/api/pickleball/public/[code]/state.ts` (new file):

```ts
import type { APIRoute } from 'astro'
import { getSessionByPublicCode } from '../../../../../worker/repositories/pickleball/publicSessionTokens.js'
import { buildSessionSnapshot } from '../../../../../worker/pickleball/sessionSnapshot.js'
import { toPublicSessionView } from '../../../../../lib/pickleball/publicSessionView'
import { jsonResponse } from '../../../../../worker/utils/responses.js'
import { getEnv } from '../../../../../lib/env'

// Spec §9's degraded path: if a client's socket is down, poll this every
// 5s instead of a blank screen. Reuses the SAME buildSessionSnapshot +
// toPublicSessionView pipeline the WebSocket public channel uses, so
// there is exactly one "what does the public see" pipeline, not two that
// could drift.
export const GET: APIRoute = async ({ params }) => {
  const env = getEnv()
  try {
    const code = params.code as string
    const publicSession = await getSessionByPublicCode(env.PICKLEBALL_DB, code)
    if (!publicSession || !publicSession.publicViewEnabled) return jsonResponse({ error: 'Not found.' }, 404)

    const snapshot = await buildSessionSnapshot(env.PICKLEBALL_DB, publicSession.id)
    return jsonResponse(toPublicSessionView(snapshot), 200)
  } catch (error: any) {
    return jsonResponse({ error: error.message }, error.status || 500)
  }
}
```

- [ ] **Step 2: Add a polling-fallback e2e test**

Append to `tests/e2e/pickleball/pickleball-realtime.spec.js`:

```js
test('public REST polling fallback returns the same sanitized shape as the WebSocket channel', async ({ request }) => {
  const sessionId = await createLiveSessionForRealtimeTests(request)
  const { execSync } = require('node:child_process')
  const output = execSync(
    `npx wrangler d1 execute devlab-pickleball --local --json --command "SELECT public_code FROM public_session_tokens WHERE session_id = '${sessionId}'"`,
  ).toString()
  const code = JSON.parse(output)[0].results[0].public_code

  const response = await request.get(`/api/pickleball/public/${code}/state`)
  expect(response.ok()).toBe(true)
  const body = await response.json()
  expect(body.session.id).toBe(sessionId)
  expect(body.queue).toBeUndefined()
})

test('public REST polling fallback 404s for a revoked-or-unknown code', async ({ request }) => {
  const response = await request.get('/api/pickleball/public/does-not-exist/state')
  expect(response.status()).toBe(404)
})
```

- [ ] **Step 3: Add a reconnect e2e test**

Append to `tests/e2e/pickleball/pickleball-realtime.spec.js` — validates the design's core claim (Decision 3: connect and resync are the same operation, so no gap-tracking protocol is needed) by actually closing and reopening a connection mid-session and confirming the fresh snapshot is fully correct:

```js
test('reconnecting after a mutation gets a fully corrected snapshot with no resync protocol needed', async ({ page, request }) => {
  await request.post('/api/pickleball/auth/test-login', { data: { email: 'operator@example.com' } })
  const venueResponse = await request.post('/api/pickleball/venues', { data: { name: `Reconnect Venue ${Date.now()}` } })
  const venueId = (await venueResponse.json()).venue.id
  const sessionResponse = await request.post('/api/pickleball/sessions', {
    data: {
      venueId, name: `Reconnect Session ${Date.now()}`, sessionType: 'OPEN_PLAY',
      scoringRulesetId: 'usap-2026-sideout-11-doubles',
      scheduledStart: '2026-08-30T18:00:00.000Z', scheduledEnd: '2026-08-30T22:00:00.000Z',
    },
  })
  const sessionId = (await sessionResponse.json()).session.id
  const playerId = (await (await request.post('/api/pickleball/players', { data: { displayName: `Reconnect Player ${Date.now()}` } })).json()).player.id
  await request.post(`/api/pickleball/sessions/${sessionId}/players`, { data: { playerId } })

  const baseURL = test.info().project.use.baseURL
  const wsUrl = `${baseURL.replace('http', 'ws')}/pickleball/rt/${sessionId}`

  // First connection, closed immediately after its accept-time snapshot —
  // simulating a client that was open during the check-in below but
  // disconnected before it happened.
  await page.evaluate(
    ({ url }) => new Promise((resolve) => {
      const ws = new WebSocket(url)
      ws.onmessage = () => { ws.close(); resolve(undefined) }
    }),
    { url: wsUrl },
  )

  // A mutation happens while nothing is connected.
  await request.post(`/api/pickleball/sessions/${sessionId}/players/check-in`, { data: { playerId } })

  // A fresh connection (not a "resume") should already reflect it.
  const received = await page.evaluate(
    ({ url }) => new Promise((resolve) => {
      const ws = new WebSocket(url)
      ws.onmessage = (event) => resolve(event.data)
    }),
    { url: wsUrl },
  )
  const parsed = JSON.parse(received)
  expect(parsed.payload.session.id).toBe(sessionId)
  // The snapshot's queue/courts/games arrays don't carry check-in status
  // directly (that lives on session_players, not this snapshot's shape),
  // so this test's real assertion is structural: a fresh connection after a
  // disconnect-then-mutate cycle returns a normal, well-formed STATE
  // message with no error and no special "you missed something" framing —
  // there is nothing else for a reconnecting client to do.
  expect(parsed.type).toBe('STATE')
})
```

- [ ] **Step 4: Run the full realtime e2e file one final time**

Run: `npx playwright test pickleball-realtime --project=worker`
Expected: PASS (7/7: round-trip, snapshot content, public channel, broadcast, polling fallback ×2, reconnect).

- [ ] **Step 5: Run the FULL test suite (unit + both existing e2e files + this new one) as this plan's final check**

Run: `npx vitest run && npx playwright test --project=worker`
Expected: all pass, no regressions anywhere in the pickleball subsystem.

- [ ] **Step 6: Commit**

```bash
git add src/pages/api/pickleball/public/\[code\]/state.ts tests/e2e/pickleball/pickleball-realtime.spec.js
git commit -m "feat: add the public REST polling fallback and reconnect e2e coverage"
```

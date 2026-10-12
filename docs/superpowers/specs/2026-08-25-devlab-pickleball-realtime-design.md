# Devlab Pickleball — Realtime Infrastructure Design

> **Superseded (2026-10-12).** This describes the logged-in operator app, retired in 2.0.0 by Phase 5 of `docs/superpowers/specs/2026-10-11-pickleball-free-open-play-design.md`. Kept as history: the routes, tables and files it names no longer exist.

**Sub-project 1 of 3 for Phase 4.1** (the other two — the operator SPA, and the scorekeeper/correction UI — are separate specs that build on this one). Parent spec: `docs/superpowers/specs/2026-08-24-devlab-pickleball-design.md` (§6, §9, §10, §11).

## Context

Phases 1–4 shipped the full pickleball backend (check-in, queue, court assignment, event-sourced game engine) entirely API-only, merged to `main`. No frontend exists beyond a stub login/dashboard SPA shell (`src/pickleball-app/`, mirroring `src/admin-app/`'s house style). No realtime layer exists at all: `SessionCoordinatorDO` has 10 RPC-only methods and no `fetch()` handler; `public_session_tokens` (migration `0001`) has a table but zero application code touching it.

The parent spec's realtime design (§9) assumes every session-scoped mutation flows through the DO's command handler, which broadcasts a diff after each one. Reality: only court/game commands (`assignCourt` through `correctGame`) go through the DO — check-in, queue join/leave, and availability changes write straight to D1 repositories today, bypassing the DO entirely.

## Decisions

1. **Live scope: everything.** Queue join/leave, check-in (single + bulk), availability, and cancel-registration each get a new thin DO method wrapping their existing (unchanged) repository call in the same validate→write→broadcast shape the 10 existing command methods already use. The REST routes for these switch from calling the repository directly to calling the DO stub. No repository logic changes — only the call path.
2. **Both channels now.** The authenticated operator channel and the anonymous public channel are both built in this sub-project, even though the public-facing pages that would consume the public channel (`/pickleball/live/[code]`, the TV display) aren't in this phase's UI scope. The infrastructure is complete once; testable directly via a raw WebSocket client in Playwright per the parent spec's own testing strategy (§12).
3. **Hibernation API + full-snapshot broadcasts**, not the parent spec's literal seq-gap-detection/`RESYNC_REQUEST` protocol. Every broadcast carries the *complete* current session snapshot, not an incremental diff. This sidesteps gap detection and resync entirely: a client that misses N messages is simply corrected by the next one, since every message is self-sufficient. `seq` is kept as an informational monotonic counter (useful for client-side debug/ordering sanity, satisfies the parent spec's envelope shape) but is not load-bearing for correctness. Rationale: session snapshots are small (session + courts + queue + games list — no OPI/leaderboard data exists yet, Phase 5), so the bandwidth savings of true diffing aren't worth the bug surface of a diff computation that could silently drift from true state.
4. **Hibernation, not a plain WebSocket.** Cloudflare's WebSocket Hibernation API (`ctx.acceptWebSocket`) lets the DO evict from memory between messages instead of staying pinned for every open connection — relevant because sessions may have several operators plus a TV display connected for hours with sparse mutations. Not billed for idle time between messages, only active processing (see Cost section).

## Architecture

`SessionCoordinatorDO` gains an actual `fetch()` handler (currently has none). New Astro routes perform auth/validation as normal HTTP requests, then forward the (still-HTTP, pre-upgrade) request to the DO via `stub.fetch(request)` with a trusted identity header attached. The DO's `fetch()` completes the WebSocket handshake and calls `ctx.acceptWebSocket(serverSocket, [tag])`, tagging the socket `operator` or `public` so broadcasts can target the right audience.

Every state-mutating DO method (10 existing + 6 new thin wrappers) calls a shared `broadcast(sessionId)` helper after its `db.batch()` commits: build one fresh snapshot via `buildSessionSnapshot(db, sessionId)`, send the full snapshot to every `operator`-tagged socket, and the `toPublicSessionView`-mapped sanitized version to every `public`-tagged socket.

## Components

- **`SessionCoordinatorDO.fetch(request)`** — reads `X-Pickleball-Channel: operator|public` (+ `X-Pickleball-User-Id` for operator) set by the Astro route after it has already authenticated the caller; trusted only because the DO is unreachable except via the Worker's own `stub.fetch()` call, same trust model the existing RPC methods rely on for their `sessionId` parameter. Matching the `ownsSession()` defense-in-depth check every existing DO method already runs, `fetch()` also re-derives its own identity from `idFromName` and rejects if the URL's `sessionId` doesn't match. Completes the upgrade; sends an immediate snapshot on accept.
- **`webSocketMessage` / `webSocketClose` / `webSocketError` handlers** — clients only ever send `RESYNC_REQUEST` (re-send snapshot) or a ping; the DO never accepts a mutation over the socket. Garbage input is ignored, never crashes the handler.
- **New Astro routes:**
  - `GET /pickleball/rt/[sessionId]` — operator channel. Runs `requirePickleballSession` (existing helper), the same session/role checks REST routes already use, then forwards to the DO. Auth/role failure → normal `4xx` JSON response, never reaches the DO.
  - `GET /pickleball/rt/public/[code]` — public channel. Resolves `public_session_tokens.public_code → session_id` (new repository, see below); revoked/unknown → `404`.
  - `GET /api/pickleball/public/[code]/state` — the parent spec's REST polling fallback for when a client's socket is down; reuses `buildSessionSnapshot` + `toPublicSessionView`.
- **New repository `publicSessionTokens.js`** — `createPublicSessionToken`, `getSessionIdByPublicCode`, `revokePublicSessionToken`. The table (migration `0001`) already exists; no migration needed. A token is auto-created in the same `db.batch()` as session creation (one extra statement).
- **New thin DO methods:** `joinQueue`, `leaveQueue`, `checkIn`, `checkInBulk`, `setAvailability`, `cancelRegistration` — each wraps its existing repository call unchanged, adds the validate→write→broadcast shape.
- **`buildSessionSnapshot(db, sessionId)`** — new aggregator (session detail + courts + queue + games list), shared by the WS broadcast path and the public REST fallback. No OPI/leaderboard field yet (Phase 5 seam, matching the `// PHASE 5 SEAM` convention established in Phase 4).
- **`toPublicSessionView(snapshot)`** — allowlist mapper (court states, team display names, scores, serving side, session name/status; no registration/attendance/audit detail). Asserted in tests by enumerating the internal snapshot's keys against the allowlist, so a newly added internal field can't leak by omission.

## Data flow

- **Connect (operator):** client opens `wss://.../pickleball/rt/[sessionId]` → Astro route authenticates + role-checks → forwards to `stub.fetch()` with identity header → DO accepts, tags `operator`, sends full snapshot immediately.
- **Connect (public):** client opens with `?code=...` → Astro route resolves code → session_id (404 if revoked/unknown) → forwards to `stub.fetch()` → DO accepts, tags `public`, sends sanitized snapshot immediately.
- **Mutation:** any of the 16 DO methods completes its batch → `broadcast(sessionId)` → fresh snapshot → sent to every tagged socket. `seq` increments once per broadcast (in-memory counter, resets on DO restart are harmless).
- **Reconnect:** client's `onclose` retries with backoff; a fresh connect follows the same connect flow — connect and resync are the same operation, so no special-cased resume path exists.
- **Hibernation/eviction:** the runtime hands hibernated sockets back to the DO automatically on wake; the channel tag is preserved as WebSocket attachment data, so no per-socket state needs manual reconstruction.

## Error handling

- Auth/role failure at the Astro route → normal `4xx`, DO never reached.
- Revoked/unknown public code → `404`.
- Non-upgrade request reaching the DO's `fetch()` (shouldn't happen given routing, handled defensively) → `400`.
- A broadcast's snapshot build throws (e.g. transient D1 error) → caught and logged; the *mutation's own* response to its original caller is unaffected — a broadcast failure never fails the underlying command. Connected clients simply miss one live update and self-correct on the next (per the full-snapshot design).

## Testing

- **Vitest:** `buildSessionSnapshot` shape correctness against fixture D1 rows; `toPublicSessionView` allowlist-mapping completeness; the 6 new thin DO-method wrappers (validate→write→broadcast-called-once, same style as existing command tests).
- **Playwright (`worker` project):** a real WebSocket client connects to the operator channel; a second client performs a rally via REST; assert the WS client receives an updated snapshot with the new score, no page reload. Same pattern against the public channel and its REST route. A reconnect test: close mid-session, reopen, assert the fresh snapshot reflects everything that happened while disconnected (validates that the no-resync-protocol design is sufficient).

## Cost note (Cloudflare Workers Paid, not covered by any free tier)

Durable Objects require Workers Paid ($5/mo base) — true since Phase 1, not introduced by this work. Modeled against current published pricing:

| Resource | Included in $5/mo | Overage |
|---|---|---|
| Workers requests | 10M/month | $0.30/million |
| Workers CPU time | 30M CPU-ms/month | $0.02/million ms |
| DO requests (each WS message send counts) | 1M/month | $0.15/million |
| DO duration — not billed while hibernated/idle | 400,000 GB-s/month | $12.50/million GB-s |
| D1 rows read | 25 billion/month | $0.001/million |
| D1 rows written | 50 million/month | $1.00/million |
| D1 storage | 5 GB | $0.75/GB-month |

DO requests (broadcast fan-out) is the one dimension that scales with this feature; a worked estimate (20 orgs, 8-hour sessions, 4 courts, ~6 connected clients, ~300 broadcast events/day/org) lands around ~1.08M/month — near the included quota, with overage costing roughly $0.75/month at 5x that volume. Everything else has enormous headroom at this application's scale. A future "pass infrastructure cost to the paying org" billing feature is a plausible later idea, explicitly out of scope here.

## Out of scope (deferred to later sub-projects/phases)

- The operator SPA and scorekeeper/correction UI (separate specs).
- `/pickleball/live/[code]` and the TV display page (consume the public channel this sub-project builds, but aren't built here).
- OPI/leaderboard data in the snapshot (Phase 5).
- Any client-side reconnect UI/UX polish (handled by whichever UI sub-project consumes this).

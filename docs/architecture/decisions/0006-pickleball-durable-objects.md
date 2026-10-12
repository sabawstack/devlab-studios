# ADR 0006: Durable Objects for Pickleball session coordination

## Status
Accepted (amended 2026-10, see "Amendment" at the end)

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

## Amendment (2026-10, Pickleball 2.0)
`SessionCoordinatorDO` was deleted with the logged-in app it served (wrangler
tag `v4`, `deleted_classes`). The free sessions that replaced it use the same
pattern with one change: `OpenSessionDO` (one per session,
`idFromName(publicCode)`) keeps the session in memory after one load from D1 and
writes only the changed rows per command, instead of re-deriving from D1 on every
call. D1 is still the source of truth. The custom entrypoint stays, for
`OpenSessionDO`, `RateLimiterDO` and `scheduled()`.

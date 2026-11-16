# Devlab Pickleball — Realtime

One `OpenSessionDO` per free session (`src/worker/pickleball/open/OpenSessionDO.ts`,
binding `OPEN_SESSION`, `idFromName(publicCode)`) serializes every command and
holds that session's WebSockets. D1 is the source of truth: the object loads the
session once, keeps it in memory, writes only changed rows per command in one
`db.batch()`, updates memory after the batch succeeds, and broadcasts from
memory. See ADR 0006 and `architecture.md`.

## The socket

`GET /pickleball/rt/open/{code}` with `Upgrade: websocket` (300 connects per
minute per IP, bucket `open-ws`). The route forwards the upgrade to the session's
object with `X-Open-Code`; the object answers 404 if the session does not exist
or has expired. Sockets hibernate between messages.

Every socket starts as a **viewer** and immediately receives
`{ type: 'VIEWER', payload }`. To become the host or a captain, the client sends
`{ type: 'AUTH', hostKey }` or `{ type: 'AUTH', captainKey }` (the secret from
the URL fragment, at most 128 characters). Answers:

| Message | Meaning |
|---|---|
| `{ type: 'HOST', payload }` | The key is the host's (the session's own or an extra host link); host snapshots follow |
| `{ type: 'CAPTAIN', payload }` | A live captain link; captain snapshots follow |
| `{ type: 'AUTH_FAILED' }` | The key was refused; the client forgets it |
| `{ type: 'AUTH_ERROR' }` | The server failed while checking; the client keeps the key, closes and reconnects |
| `{ type: 'CAPTAIN_REVOKED' }` | The host turned this captain link off; the socket is now a viewer |

`{ type: 'RESYNC' }` asks for the current snapshot again. After every successful
command each socket gets the snapshot for its role, each built at most once per
broadcast. Snapshots are allowlists (`src/lib/pickleball/open/snapshot.ts`): the
viewer one carries names, courts, matches, results and standings, never skill,
DUPR IDs, secrets, claims or host data. Two derived, read-only queue fields
(`src/lib/pickleball/open/outlook.ts`, PB-QUEUE-06): `nextUp` (the four the
server will call when the next game ends, only when the state already fixes
them, else null; ids and names only, no court or teams) and each court's
`idle` (a coarse reason an enabled court is empty, never the host's text).

A deleted or purged session closes its sockets with code **4404**; the client
then shows the "session ended" page and stops reconnecting.

## Reconnect and polling

`src/pickleball-open/lib/useOpenSession.js` loads the snapshot over HTTP first
(`GET /api/pickleball/open/s/{code}/state`, or `…/host` / `…/captain` with the
key header), then opens the socket. If the socket closes for any other reason,
it polls the same route every 5 seconds and reconnects after 1, 2, 4, then every
8 seconds, keeping the last snapshot on screen. A socket counts as live only once
it has delivered the snapshot the page signed in for.

## Freshness and the heartbeat (Phase 15, PB-REALTIME-01/02)

"LIVE" on the board and TV means the server was heard from within
`staleMs` (25 s): any frame, a heartbeat reply, or a successful poll. The socket's
own state is not trusted, because a phone that slept can hold a socket that says
"open" and is dead. All timings live in `src/pickleball-open/lib/realtimeConfig.js`.

- **Heartbeat.** An open socket sends the plain text `ping` every 10 s. The
  Durable Object registers `ping`/`pong` with `ctx.setWebSocketAutoResponse`
  (`src/worker/pickleball/open/heartbeat.ts`), so the Workers runtime answers
  without waking a hibernating object or billing its duration. Source:
  Cloudflare, Durable Object State API, "setWebSocketAutoResponse"
  (developers.cloudflare.com/durable-objects/api/state/, updated 2026-09-30):
  "the auto-response will be returned without waking WebSockets in
  hibernation"; request and response are each limited to 2,048 characters.
  Auto-responded pings never reach `webSocketMessage`, so they do not spend the
  per-socket message budget.
- **Reply deadline.** A ping, a `RESYNC`, or a freshly opened socket with no
  frame within `replyTimeoutMs` (5 s) is treated as dead: dropped without
  waiting for a close handshake, then the poll-and-reconnect path takes over.
- **Waking.** On `visibilitychange` (visible) and `online` the client polls at
  once and, if the socket is open, sends the existing `RESYNC` under the same
  deadline.
- **Stale wording.** While not fresh, the status card reads "Last known (time):
  …" and no call says "walk on now"; the header says "Offline · showing data
  from …". Only snapshots the server sent are ever shown: polling and
  reconnecting never create a call.

Measured on the local stack (`tests/e2e/pickleball/open-realtime.spec.js`,
wrangler dev, Chromium, 2026-11-16), not guarantees: heartbeat round trip 5–26
ms; a quiet session stayed LIVE for 30 s with no state change; with the socket
silently dead and polls failing, the board showed "Last known" after about 30 s
(25 s stale window plus the 5 s screen clock tick); once the network returned,
LIVE again after about 2.3 s. Not measured: real mobile radios, carrier NAT
timeouts, or a phone waking from deep sleep on the production edge.

## Concurrency

Commands go through `POST /api/pickleball/open/s/{code}/commands` to the same
object, which runs them one at a time against memory. A result for a match that
is already finished gets 409 with who saved it; a retried command with the same
`idempotencyKey` returns the first response (`open_idempotency`).

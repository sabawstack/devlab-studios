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
DUPR IDs, secrets, claims or host data.

A deleted or purged session closes its sockets with code **4404**; the client
then shows the "session ended" page and stops reconnecting.

## Reconnect and polling

`src/pickleball-open/lib/useOpenSession.js` loads the snapshot over HTTP first
(`GET /api/pickleball/open/s/{code}/state`, or `…/host` / `…/captain` with the
key header), then opens the socket. If the socket closes for any other reason,
it polls the same route every 5 seconds and reconnects after 1, 2, 4, then every
8 seconds, keeping the last snapshot on screen. A socket counts as live only once
it has delivered the snapshot the page signed in for.

## Concurrency

Commands go through `POST /api/pickleball/open/s/{code}/commands` to the same
object, which runs them one at a time against memory. A result for a match that
is already finished gets 409 with who saved it; a retried command with the same
`idempotencyKey` returns the first response (`open_idempotency`).

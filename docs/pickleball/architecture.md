# Devlab Pickleball — Architecture

Devlab Pickleball is a free public web tool for running doubles open play and
casual tournaments with no account: a host creates a session, players follow a
live QR board on their own phones, and everything about a session is deleted 7
days after its last activity. The only accounts are optional Google sign-ins
for hosts who want a DUPR export. It shares the Astro/Worker deployment with the
public site and the Admin CMS, and nothing else load-bearing: its own D1
database (`PICKLEBALL_DB`), migrations (`migrations/pickleball/`), repositories,
schemas and UI.

## Free sessions

Spec: `docs/superpowers/specs/2026-10-11-pickleball-free-open-play-design.md`.

**Purpose.** A free, no-login way to run doubles open play. A host creates a
session at `/pickleball/new`, players scan a QR code to watch a live board at
`/pickleball/s/{code}`, and the host records one final score per game. The
session is deleted 7 days after its last activity. The logged-in operator app
that came before it was retired in Phase 5 (below).

**Tables** (migration `0016_open_sessions.sql`): `open_sessions`,
`open_courts`, `open_players`, `open_matches` and `open_idempotency`. None has a
user or organization column, and every child table cascades from
`open_sessions`, so purging a session is one `DELETE`. Enum CHECKs are written
wider than Phase 1 uses (`kind` already allows `TOURNAMENT`) because a CHECK
cannot be widened on D1 (see "Schema constraint" below).

**`OpenSessionDO` pattern** (`src/worker/pickleball/open/OpenSessionDO.ts`,
binding `OPEN_SESSION`, wrangler migration tag `v3`, one object per session via
`idFromName(publicCode)`). D1 stays the source of truth. The DO loads the
session from D1 once, then serves from memory. Commands run through a serial
queue: each is validated against the in-memory state by the pure reducer
(`src/lib/pickleball/open/reducer.ts`), only the changed rows are written in one
`db.batch()` (`persistDiff`), memory is updated **after** the batch succeeds,
and the new snapshot is broadcast from memory. There is no per-command reload.
Sockets hibernate; after eviction the DO reloads from D1 on the next request.
A deleted or purged session closes its sockets with code `4404`. Retried
commands are deduplicated through `open_idempotency`.

**Host key model.** The host holds a 16-byte random secret, shown once, carried
in the URL fragment and kept in the host's `localStorage`. Only its SHA-256 is
stored in `open_sessions.host_key_hash`. It is sent as the `X-Host-Key` header
over HTTP and in the `AUTH` message on the WebSocket. A lost key cannot be
recovered. Viewers need only the public code.

**Routes.**

| Route | Purpose |
|---|---|
| `POST /api/pickleball/open/sessions` | Create a session (Turnstile; 10 per IP per day; fails closed if `RATE_LIMITER` is absent) |
| `GET /api/pickleball/open/s/:code/state` | Viewer snapshot (1200/min/IP, sized for a club on one Wi-Fi; polled every 5 s when the socket drops) |
| `GET /api/pickleball/open/s/:code/host` | Host snapshot |
| `POST /api/pickleball/open/s/:code/check-in` | Anonymous self check-in (30 per 10 min per IP, 60 per 5 min per session) |
| `GET /api/pickleball/open/s/:code/captain` | Captain snapshot (`X-Captain-Key`) |
| `POST /api/pickleball/open/s/:code/captains`, `DELETE .../captains/:id` | Host makes and turns off captain links (the host snapshot lists them) |
| `POST /api/pickleball/open/s/:code/commands` | Host commands (120/min/session) |
| `GET /api/pickleball/open/s/:code/results.csv` | Results CSV |
| `DELETE /api/pickleball/open/s/:code/session` | Host deletes the session |
| `WS /pickleball/rt/open/:code` | Live snapshots (300 connects/min/IP, sized for a club on one Wi-Fi) |

Pages: `/pickleball` (landing), `/pickleball/how-it-works`,
`/pickleball/rotation`, `/pickleball/new`, `/pickleball/s/[code]`,
`/pickleball/s/[code]/check-in`, `/pickleball/s/[code]/tv`. Route
failures go through `openErrorResponse` (`routeHelpers.ts`), which logs the
detail and returns a generic 500.

**Retention and purge.** Every command moves `last_activity_at` and
`expires_at` forward; a session expires 7 days after its last change, and reads
already ignore rows past `expires_at`. `src/worker/pickleball/open/purge.ts`
runs from the daily cron in `src/worker.ts` and deletes expired sessions in
batches. Each `DELETE` is guarded by `expires_at`, so a session revived between
the `SELECT` and the `DELETE` survives. It then evicts each deleted session's DO
and logs `pickleball_open.purge`.

**Domain logic** (`src/lib/pickleball/open/`) is pure and framework-free: score
validation (sudden death and win by 2), roster parsing, standings (win rate,
then share of points won, head-to-head, name),
paddle-stack rotation with a two-round sit-out guard, the reducer, snapshots,
diffs and the results CSV.

### Phase 2 additions

- **Modes.** Four stacking modes (`PADDLE_STACK`, `WINNERS_LOSERS`,
  `BY_STANDING`, `BALANCED`) behind one `ModeInput`/`pickFour` interface, with
  the sit-out guard in `queueOrder`. The `DUE_WINDOW` rule applies to
  winners/losers and by-standing.
- **Rules.** Keep-together / keep-apart pairs live in `settings_json` and are
  read through `normalizeSettings`.
- **Scores.** Every result needs both scores (no winner-only). Standings order
  by win rate, then the per-game share of points won, then head-to-head, then name.
- **Captains.** `OpenSessionDO` resolves an actor per call: the host, or a
  captain whose key hash is in `open_captains` (`captain` role on commands and
  WebSocket). Captains are checked from memory on every call, so revoking a link
  takes effect at once and the DO demotes that captain's sockets to viewers.
- **Check-in.** Anonymous `POST .../check-in`. The route checks a schema and
  refuses bodies over 4096 bytes (413); a per-IP limit (bucket `open-checkin-ip`,
  30 per 10 min, 503 if `RATE_LIMITER` is missing) and a per-session limit in
  the DO (60 per 5 min) return 429. The DO uses the shared `addOrReturnPlayer`
  (`reducer.ts`): a new name is added, an active name is returned as
  already checked in, a player on BREAK returns, and a name the host removed
  (LEFT) is refused with 409.
- **WebSocket auth.** `AUTH_FAILED` means the key was refused: the client
  forgets it. `AUTH_ERROR` means a server error: the client keeps the key and
  reconnects, falling back to polling `/state`.
- **Per-IP limits.** Live connects 300 per minute, `/state` reads 1200 per
  minute, and the host and captain routes (`hostIpLimited`) 600 per minute,
  because a club's host, captains and players share one Wi-Fi address.
- **TV.** `/pickleball/s/{code}/tv` renders the viewer snapshot. A LIVE or
  Offline indicator comes from the time of the last snapshot (stale after 15 s),
  and an ended session closes check-in on the screen.
- **Migration.** `0017_open_captains.sql` adds `open_captains` and
  `open_matches.recorded_by`.

### Phase 3 additions (tournaments)

- **Kind.** A tournament is an `open_sessions` row with `kind = 'TOURNAMENT'`,
  fixed at creation. It shares courts, players, matches, captains, idempotency,
  the Durable Object and the purge with open play.
- **Tables** (`0018_open_tournaments.sql`): `open_tournaments` (format,
  pairing, seeding, phase, start), `open_tournament_entrants` (pairs, seed,
  pool) and `open_tournament_fixtures` (the reused generator's slots plus a
  winner). All cascade from `open_sessions`; `open_matches.fixture_id` links a
  game to its fixture. Rows have no order column: `tournament/order.ts` is the
  one order, and the loader reads it back in SQL.
- **Engine** (`src/lib/pickleball/open/tournament/`). Pairing and seeding
  (`pairing.ts`, randomness injected as `CommandContext.random`), the draft
  (`draw.ts`), its rules (`drawRules.ts`) and edits (`drawEdits.ts`),
  advancement and corrections (`progress.ts`), pair standings (`standings.ts`),
  the court loop (`courts.ts`) and the commands (`commands.ts`). It wraps the old
  app's pure `generateFixtures`, `advanceBracket`, `nextPlayableFixture`,
  `rankTournamentStandings` and `resolvePoolQualifiers` unchanged;
  `reuse.test.ts` pins that they import nothing Phase 5 deleted.
- **Phases.** SETUP -> DRAFT (unrestricted edits, each re-validated) -> RUNNING
  (substitute off-court players; swap opponents only between unstarted games of
  the same round of the same pool or bracket) -> FINISHED (every game played;
  champion known).
- **Courts.** A court takes the next READY fixture whose pairs are not already
  on court. A PROPOSED game is not "on court"; stale proposals are withdrawn
  after edits. Fixture labels read "Round 1 · Game 2" and
  "Pool A · Round 1 · Game 2".
- **Roles.** Captains can play, save, undo and edit tournament games but cannot
  change the draw (draft edits, substitutions, swaps, start).
- **Snapshots.** `toTournamentView` (allowlist: names, ids, scores, court labels)
  is in the viewer snapshot and so in the host and captain ones; courts carry
  `fixtureLabel`. `myStatus` says done only when the player's pair is out or the
  tournament is finished.
- **TV.** Standings, recent results and next games (not the bracket, which is on
  phones); a draft/setup note before the start; the champions when finished
  ("Session ended" if the host ended it).
- **Results CSV.** Tournament games with their stage, then overall pair
  standings and per-pool pair standings.
- **Rate limit.** The host and captain routes share a per-IP limit of 600 per
  minute (`hostIpLimited`).

### Phase 4 additions (host sign-in and the DUPR export)

- **Accounts only for the export.** Nobody signs in to run or view a session.
  A host who wants a DUPR export signs in with Google; that creates a `hosts`
  row (verified email, name, DUPR Club ID, news opt-in, off by default), which
  never expires and is removed only by "Delete my account".
- **Tables** (`0019_hosts.sql`): `hosts`; `host_logins` (SHA-256 of each
  browser's login token, 30 days, cascades from `hosts`);
  `open_sessions.host_id` (the claim, `ON DELETE SET NULL`); `open_host_keys`
  (extra host links, cascade from `open_sessions`); `open_dupr_exports` (one
  row per email sent, no personal data, cascade from `open_sessions`).
- **Login.** The `devlab_pb_host` cookie holds a random opaque token (only its
  hash is stored), not the host id (`hostSession.ts`): HttpOnly, Secure,
  SameSite=Lax, 30 days, `Path=/api/pickleball/open`. Every write that trusts
  the cookie must come from this site (`sameOrigin.ts`).
- **Google.** `hostAuth.ts` reuses `oauth.js` (PKCE) and the one registered
  `/api/pickleball/auth/google/callback`, which only calls `finishHostSignIn`
  (its only caller since Phase 5). Only a verified Google email is accepted. Outcomes return to the
  starting page as `?signin=...`.
- **Claim and access.** `OpenSessionDO` keeps `HostAccess` (claim and extra key
  hashes) beside the cached session and is its only writer: `claim` (write-once;
  needs the host key and the login cookie), `reopen` (mints an extra host key
  for the claiming account, at most 10 per session, delivered to the page in the
  URL fragment `#host=`; the original key keeps working), `forgetHost` (after an
  account is deleted). None of it is in any snapshot; the console reads it from
  `GET .../s/{code}/dupr`.
- **Export.** `src/lib/pickleball/open/dupr/` builds the CSV (pinned to
  `tests/fixtures/dupr-import-template.csv`) and the email. A game is eligible
  when it is finished, has a valid score (no tie, a team reached 6) and four
  different valid DUPR IDs; the rest are listed as skipped with reasons. An
  invalid time zone falls back to UTC. The email goes to the verified Google
  email through Resend (`duprExport.ts`). Limit: 5 per session per rolling 24
  hours, reserved inside the Durable Object's serial chain (so concurrent taps
  cannot overshoot) and refunded on any failed or thrown send.
- **Account deletion.** "Delete my account" unlinks the host's sessions, revokes
  their extra host keys, logs out every device (logins cascade), and tells warm
  Durable Objects to forget the host (best effort, at most 50 sessions).
- **Purge.** The daily cron removes expired logins in a run independent of the
  session purge, so one failing never skips the other. Host rows are never
  purged.
- **Test login.** `POST .../host/test-login` exists only when
  `PICKLEBALL_TEST_AUTH_ENABLED === 'true'` (local `.dev.vars`, never a deployed
  environment); with it on nothing is emailed and the response carries the
  message.
- **Phase 5.** `phase5Safety.test.ts` pins that none of this imports what
  Phase 5 deleted.

### Phase 5 (the logged-in app retired)

- **Removed.** The operator SPA (`/pickleball/app`), invites
  (`/pickleball/accept-invite/*`), the live and TV views (`/pickleball/live/*`),
  the OPI methodology page, every `/api/pickleball/` route outside `open/`
  except the Google callback, the operator session cookie and its middleware
  gate, per-rally scoring, OPI, `SessionCoordinatorDO` (wrangler tag `v4`,
  `deleted_classes`) and the 27 tables of migrations 0001–0015
  (`0020_drop_legacy_pickleball.sql`, children first; applied to preview, then
  to production with the 2.0.0 release, see `runbook.md`).
- **Kept from it.** `oauth.js` (PKCE, now host sign-in only), `webCrypto.js`,
  `RateLimiterDO`, and the five pure tournament modules in
  `src/lib/pickleball/tournament/` that `reuse.test.ts` pins.
- **The Google callback** (`/api/pickleball/auth/google/callback`, the
  registered redirect URI) only calls `finishHostSignIn`.
- **Old links** are rows in the CMS `redirects` table, which the middleware
  reads only on a 404: `/pickleball/app` and `/pickleball/app/*` →
  `/pickleball/new`, `/pickleball/methodology` → `/pickleball/rotation`,
  `/pickleball/live/*` → `/pickleball`. A `from_path` ending in `/*` matches
  everything below it (`findRedirect`, exact row first, then the longest
  wildcard). The rows are written by hand per environment (`runbook.md`).
- **Guards.** `src/worker/pickleball/retirement.test.ts` keeps the old routes,
  pages, modules, Durable Object and secret from coming back;
  `dropLegacy.test.ts` checks 0020 against the real foreign keys.

## Shared foundations

- **Data isolation.** A dedicated D1 database bound as `PICKLEBALL_DB`
  (production `devlab-pickleball`, preview `devlab-pickleball-preview`), its own
  migrations folder `migrations/pickleball/`, repositories in
  `src/worker/repositories/pickleball/open/` and Zod schemas in
  `src/lib/schemas/pickleball/open/`. Both databases live in the owner's
  personal Cloudflare account.
- **Durable Objects.** `OpenSessionDO` (one per session) and the shared
  `RateLimiterDO`, exported from the custom entrypoint `src/worker.ts` (ADR 0006).
- **Public pages** (`/pickleball`, `/pickleball/how-it-works`,
  `/pickleball/rotation`) are plain Astro on the shared dark public shell. Their
  artwork is hand-authored SVG in `src/components/pickleball/art/`, imported with
  no `client:*` directive, so the pages ship no JavaScript for illustration; the
  landing page's only hydrated island is the request-access `ContactForm`. Every
  factual claim in their copy must map to shipped code, pinned by
  `tests/e2e/pickleball/pickleball-public-pages.spec.js`.

### Schema constraint: CHECK clauses cannot be widened

No `CHECK` in this schema can be extended once applied. SQLite has no
`ALTER ... CHECK`, and the standard table-rebuild is unsafe on D1 — measured,
not assumed: rebuilding a parent table silently deletes every dependent row
through `ON DELETE CASCADE` when the old table is dropped, and
`PRAGMA foreign_keys=OFF` does not help, because SQLite treats that pragma as
a no-op inside a transaction and D1 wraps migration batches in one. The
operation reports success while destroying data.

`open_sessions` is referenced by every other free-session table, each with
`ON DELETE CASCADE`, so rebuilding it would empty them all. Model a new enum
value as a **new nullable column** with its own CHECK (`ALTER TABLE ... ADD
COLUMN` with a column-level CHECK does work, and is verified), or write the
original CHECK wide enough up front, as 0016 did for `kind`. Dropping a whole
table is safe: 0020 drops the retired app's 27 tables, children first.

## Phase history

| Phase | Scope | Status |
|---|---|---|
| Operator app (2026-08 to 2026-09) | Logged-in club platform: organizations and invites, Google sign-in, attendance, queue, per-rally scoring, OPI, live and TV views, fixed pairs, tournaments C1–C5 | Retired in Phase 5 |
| Free sessions 1 | Anonymous create, roster, courts, paddle stack, final-score entry, live QR board, results CSV, 7-day purge, public pages rewritten (`0016`) | Built |
| Free sessions 2 | Four stacking modes, keep together/apart, fairness panel, QR check-in, court captains, TV board (`0017`) | Built |
| Free sessions 3 | Doubles tournaments (`0018`) | Built |
| Free sessions 4 | Google host sign-in, claim, DUPR export email, My sessions, account deletion (`0019`) | Built |
| Free sessions 5 | The operator app and its data retired (`0020`, wrangler `v4`) | Built; preview/production apply pending |

Which release shipped each phase is in `CHANGELOG.md`.

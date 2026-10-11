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

## Free open play (2026-10)

Spec: `docs/superpowers/specs/2026-10-11-pickleball-free-open-play-design.md`.

**Purpose.** A free, no-login way to run doubles open play. A host creates a
session at `/pickleball/new`, players scan a QR code to watch a live board at
`/pickleball/s/{code}`, and the host records one final score per game. The
session is deleted 7 days after its last activity. The logged-in operator app
described in the rest of this document is **legacy until Phase 5** of that spec
and is untouched by this feature; the two share only the `PICKLEBALL_DB`
database and the Worker.

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
| `POST/GET /api/pickleball/open/s/:code/captains`, `DELETE .../captains/:id` | Host makes, lists and turns off captain links |
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
  by win rate, then OPI per-game points share, then head-to-head, then name.
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
- **Per-IP limits.** Live connects 300 per minute and `/state` reads 1200 per
  minute, because a club shares one Wi-Fi address.
- **TV.** `/pickleball/s/{code}/tv` renders the viewer snapshot. A LIVE or
  Offline indicator comes from the time of the last snapshot (stale after 15 s),
  and an ended session closes check-in on the screen.
- **Migration.** `0017_open_captains.sql` adds `open_captains` and
  `open_matches.recorded_by`.

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
3. **Auth** — Google OAuth 2.0 + PKCE, hand-rolled against `fetch` and the
   Web Crypto API (no `arctic` dependency — matches `adminAuth.js`'s own
   hand-rolled-crypto convention; see the Phase 1 foundation plan for the
   rationale). A stateless
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
5. **Standings vs. OPI snapshots** — two deliberately different read models
   over the same facts. `player_performance_snapshots` is the OPI store: a
   row exists only once a player has finished an eligible game, which is the
   right shape for an all-time leaderboard and the wrong one for a live
   session board (it renders empty for the whole first game of every
   session). The operator Standings page therefore reads
   `listSessionStandings()`
   (`src/worker/repositories/pickleball/sessionStandings.js`), which starts
   from the attending roster and left-joins the snapshot, per-game W/L and
   point totals, and an on-court flag; ranking is applied by the pure
   `rankStandings()` (`src/lib/pickleball/standings.ts`). OPI itself is
   unchanged: eligibility is still FINISHED games only, so an unplayed
   player carries a null OPI and no rank rather than a misleading zero, and
   an in-progress score never contributes. `leaderboard_min_games` still
   decides who is *ranked* — it no longer decides who is *visible*.
6. **Public pages** — `/pickleball` (landing) and `/pickleball/how-it-works`
   (a nine-step operator walkthrough) are plain Astro on the shared dark
   public shell, alongside `/pickleball/methodology`. Their artwork is
   hand-authored SVG under `src/components/pickleball/art/`, imported into
   `.astro` with **no** `client:*` directive, so the pages ship zero
   JavaScript for illustration; the only hydrated island is the
   request-access `ContactForm`, mounted `client:visible`. Two conventions
   these pages must keep: they render inside `Layout.astro`'s own `<main>`
   and must not open a second one, and **every factual claim in their copy
   has to map to committed code.** Ten claims that did not were caught in
   review before ship — the guard against a recurrence is
   `tests/e2e/pickleball/pickleball-public-pages.spec.js`, which pins the
   corrected phrasings verbatim, blocks copy about features that exist only
   as API routes, and asserts the artwork never gains a hydration directive.
7. **Fixed pairs** — a `FIXED_PAIRS` session changes the queue's unit of work
   from *player* to *pair*. `session_pairs` (migration `0012`) is deliberately
   a separate table from `teams`, not a variant of it: a team is per-game and
   per-court and is released the moment its court is released, while a pair
   persists across every game for the whole session. A queued pair inserts
   two `queue_entries` rows sharing one `session_pair_id`, so the existing
   "at most one open entry per session player" rule needs no change; the
   queue engine groups the pair back into one entrant wherever it matters
   (`listEligiblePairs`, `selectNextPairs`, and the queue page's single
   `PairRow`). Eligibility and court assignment both require **both**
   members to hold `AVAILABLE`, `CHECKED_IN` status — a pair with one member
   out sits out entirely, never plays short-handed. `balanceTeams` is not
   called for a fixed-pairs game: partners are fixed by definition, so
   `SessionCoordinatorDO.assignCourt` seats the two selected pairs directly as
   Team A and Team B. Swapping one member of an already-seated pair is
   refused outright (`replaceAssignedPlayer`), and so is dissolving that
   pair while it holds a court — there is no half-a-pair state this codebase
   understands, and dissolving a seated pair used to delete the queue rows
   recording its occupancy while leaving the court ASSIGNED, after which the
   same player could be re-paired onto a second court. The operator releases
   the court first, then dissolves and re-forms. `hasOpenAssignmentForPair`
   is the single predicate every pair-mutating command consults. `teams.session_pair_id` (migration `0013`) exists
   because a member's *current* pairing cannot answer "which pair actually
   played this game" once anyone re-pairs mid-session; see `schema.md`'s
   entry on that column for the failure mode this closes.
8. **Tournaments (Phase C1)** — a round-robin bracket layered on top of
   fixed pairs, not a new session concept: see "Schema constraint" below for
   why a tournament is a `FIXED_PAIRS` session carrying
   `pickleball_sessions.tournament_format` rather than a third
   `session_type`. An operator enters `session_pairs` as
   `tournament_entrants` (migration `0014`), then locks the bracket in one
   `db.batch()` that assigns seeds, generates the full `ROUND_ROBIN` fixture
   list (the pure `generateFixtures()`,
   `src/lib/pickleball/tournament/generateFixtures.ts`) and sets
   `bracket_locked_at` — a half-locked bracket (seeds without fixtures, or
   fixtures without the lock) is exactly the inconsistent-state class Part B
   kept having to fix, so this repeats that lesson rather than relearning it.
   Court assignment for a tournament fixture reuses the ordinary court-and-
   game machinery: the pure `nextPlayableFixture()`
   (`src/lib/pickleball/tournament/nextPlayableFixture.ts`) picks the next
   `READY` fixture whose entrants aren't already on another court, and
   `SessionCoordinatorDO` seats its two entrants as Team A/B directly, the
   same way it seats a fixed pair without calling `balanceTeams`. Finishing a
   tournament fixture's game goes through the normal `FINISH_GAME` command,
   with one deliberate difference: it writes that game's
   `player_game_stats` rows with `eligible_for_opi = 0`, so a tournament game
   is scored like any other game but never moves a player's `ALL_TIME` OPI —
   spec §3.2's requirement that a tournament stay a self-contained,
   OPI-neutral event. Standings are a second read model for the same reason
   `sessionStandings.js` exists for Open Play: `listTournamentStandings()`
   (`src/worker/repositories/pickleball/tournaments.js`) aggregates wins,
   losses and points directly from `tournament_fixtures`/`games` —
   deliberately not filtering on `eligible_for_opi`, since every tournament
   game has that flag cleared and such a filter would report every entrant
   0-0 — and the pure `rankTournamentStandings()`
   (`src/lib/pickleball/tournament/rankTournamentStandings.ts`) applies spec
   §3.7's ordering (wins, losses, point differential, then head-to-head) on
   top. `source_a`/`source_b` on `tournament_fixtures` are unused by
   `ROUND_ROBIN` — both entrants are known when fixtures are generated — but
   exist now, ahead of any consumer, so that the elimination and pool formats
   in C2–C4 (which fill a fixture from a previous fixture's winner/loser or a
   pool rank) need no further migration against a table other fixtures
   already reference. Operator-only today: the public/TV bracket view is C5,
   and `pickleball-public-pages.spec.js` still blocks the word "tournament"
   on both public pages until that phase ships it.

### Schema constraint: CHECK clauses cannot be widened

No `CHECK` in this schema can be extended once applied. SQLite has no
`ALTER ... CHECK`, and the standard table-rebuild is unsafe on D1 — measured,
not assumed: rebuilding a parent table silently deletes every dependent row
through `ON DELETE CASCADE` when the old table is dropped, and
`PRAGMA foreign_keys=OFF` does not help, because SQLite treats that pragma as
a no-op inside a transaction and D1 wraps migration batches in one. The
operation reports success while destroying data.

`pickleball_sessions` alone is referenced by nine foreign keys across five
migrations. So: model a new enum value as a **new nullable column** with its
own CHECK (`ALTER TABLE ... ADD COLUMN` with a column-level CHECK does work,
and is verified), or make the original CHECK wide enough up front. This is why
a tournament is a `FIXED_PAIRS` session carrying a `tournament_format` rather
than a third `session_type`.

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
| 7 | Polish — audit log, operator management UI, dashboard consolidation, documentation | Complete |
| A | Public pages — landing & guide rewrite, illustration system, request-access form, sign-in exit, services CTA | Complete |
| B | Fixed pairs in Open Play — `session_pairs`, pair-aware queue/eligibility/assignment, pair statistics, guide gains a pairs section | Complete |
| C1 | Tournaments, round robin — `tournament_format`/`bracket_locked_at`, `tournament_entrants`/`tournament_fixtures`, seeding, fixture generation and court assignment, OPI-neutral finishing, standings, operator UI | Complete |
| C2 | Tournaments, single elimination — pure bracket generation and advancement (`94ac8d0`), persistence, play and correction (`81d6a70`), stranded-bracket fixes (`8568498`, `8a361e7`) | Complete |
| C3 | Tournaments, pools to bracket — seeded qualification from pools into a bracket (`6d0a026`) | Complete |
| C4 | Tournaments, double elimination — losers bracket (`73e7608`, `bbe4abc`) | Complete |
| C5 | Public and TV bracket view, tournament documentation (`0c2ae5d`) | Complete |
| Open play | Free, no-login open play — `open_*` tables, `OpenSessionDO`, live QR board, 7-day purge (migration `0016`); the operator app above is legacy until Phase 5 of that spec | Phase 2 built (preview), release pending |

**Deliberately not built** (disclosed, not overlooked): the public sanitized
leaderboard extension to `toPublicSessionView` (spec §9 — deferred, requires
a backend change out of scope for the UI-only plan that shipped the rest of
Phase 6); a `/settings` page for "system defaults" (the spec reserves the
route and a permission but never defines a single concrete setting).

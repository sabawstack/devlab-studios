# Devlab Pickleball — Free, no-login open play & tournaments

**Date:** 2026-10-11
**Status:** Draft for review
**Supersedes:** the organization/operator model of
`2026-08-24-devlab-pickleball-design.md`, `2026-09-01-devlab-pickleball-platform-pilot-design.md`
and the operator-only parts of `2026-09-06-pickleball-pages-pairs-tournaments-design.md`.

## 1. Why

The current product is a private club platform: Google sign-in, invite-only
organizations, roles, per-rally scorekeeping and an all-time rating (OPI).
Nobody uses it in production, and a sign-in wall is the wrong shape for
traction. Competitors' most common complaints are paywalls on courts or
players, forced app installs/accounts, unfair rotations, and single-device
tools with no live board for players (research, 2026-10-11).

The new product is a **free public web tool anyone can use to run open play
or a casual tournament, with no account**. It is also the traction asset: every
session's QR board is seen by every player at the court.

### Decisions already made (owner, 2026-10-11)

| Topic | Decision |
|---|---|
| Login | None to run a session or view it. Google sign-in **only** when the session host wants a DUPR export. |
| Who exports | Only the session host. Players ask the host in person. The export is **emailed** to the host's verified Google address. |
| Score entry | Once per game (final score or winner), never per rally. One person can run many courts. |
| Court allocation | Players are never bound to a court number; whichever court frees next gets the next proposed match. |
| Winners vs winners | The two winning teams are **shuffled**: previous partners become opponents (A1+B1 vs A2+B2). Same for losers. |
| Ratings | All-time OPI is dropped. Open play shows session standings only. |
| Retention | 7 days from **last activity**, then everything for that session is deleted. |
| Existing app | No production users. It is retired, not migrated. |
| Reclub | No public API and its terms forbid scraping. Ship roster paste/CSV/QR check-in; approach Reclub for a partnership after launch. |

### Success criteria

- A host goes from the landing page to a running 4-court session in under 2 minutes on a phone, without creating an account.
- Recording a finished game takes ≤ 3 taps (Game over → winner/score → confirm).
- A player scanning the QR sees, without installing anything, who is on every court, who is up next, and standings, updated within 2 s of a result.
- In any mode, no available player sits out more than 2 consecutive rounds, and with ≥ 8 players no partner pairing repeats while an unused pairing is possible.
- Nothing about a session remains in storage 7 days after its last change.

## 2. Scope

**In:** anonymous sessions; roster paste/CSV/QR self check-in; doubles open play with four stacking modes; final-score entry with undo/edit; manual edit of every proposal; live QR board and TV mode; doubles tournaments (round robin, pools → bracket, single and double elimination) with random/balanced/manual pairing and editable draws; results CSV; DUPR CSV emailed to a Google-verified host; 7-day expiry; abuse controls; retirement of the logged-in app.

**Out (YAGNI for now):** singles open play and singles tournaments; per-rally scoring; player accounts; any persistent rating; payments; scraping or API calls to Reclub or DUPR; push notifications; native apps. Offline-tolerant PWA is a stretch goal in Phase 4, not a requirement.

## 3. Architecture

### 3.1 Approach: build alongside, reuse the pure logic, then retire

Retrofitting anonymous use into the current schema means fighting
`created_by_user_id NOT NULL`, `actor_user_id NOT NULL`, `organization_id NOT NULL`
on every table, persistent per-org players, and CHECK constraints that cannot
be widened on D1 (`docs/pickleball/architecture.md`, "Schema constraint").
The new subsystem is built beside the old one under new routes, reusing the
pure, framework-free modules in `src/lib/pickleball/` (queue fairness, team
balancing, fixture generation, bracket advancement, tournament ranking, QR
component), and the old one is deleted in Phase 5.

### 3.2 Storage: the session's Durable Object is the source of truth

One new Durable Object class, `OpenSessionDO` (SQLite-backed; wrangler
migration tag `v3`), **one instance per session, addressed by
`idFromName(publicCode)`**. Its embedded SQLite holds the whole session:
settings, players, courts, matches, tournament entrants/fixtures, captain
tokens.

This deliberately departs from ADR 0006 ("D1 is the source of truth, the DO a
rehydratable coordinator"). That rule protected long-lived club data. Here
every session is ephemeral and single-writer by construction, so keeping it in
the DO:
- removes the D1 round-trips that made every current `broadcast` cost O(games) reads;
- makes the 7-day purge one call (`ctx.storage.deleteAll()`) from the DO's own alarm, with no cascade ordering;
- keeps one consistency domain: no DO-vs-D1 drift.

A new ADR (`0009-ephemeral-open-sessions-in-durable-objects.md`) records this.

**D1 keeps only a thin index** in `PICKLEBALL_DB`, used for rate limiting,
the cron backstop and aggregate traction metrics:

```sql
CREATE TABLE hosts (                           -- only Google-verified DUPR exporters
  id                TEXT PRIMARY KEY,
  google_sub        TEXT NOT NULL UNIQUE,
  email             TEXT NOT NULL,
  display_name      TEXT NOT NULL,
  dupr_club_id      TEXT,                      -- 10 digits, validated
  marketing_opt_in  INTEGER NOT NULL DEFAULT 0 CHECK (marketing_opt_in IN (0,1)),
  created_at        TEXT NOT NULL,
  last_seen_at      TEXT NOT NULL
);

CREATE TABLE open_sessions (
  public_code       TEXT PRIMARY KEY,          -- 10 chars, base32, ~50 bits
  kind              TEXT NOT NULL CHECK (kind IN ('OPEN_PLAY','TOURNAMENT')),
  created_at        TEXT NOT NULL,
  last_activity_at  TEXT NOT NULL,
  expires_at        TEXT NOT NULL,             -- last_activity_at + 7 days
  host_id           TEXT REFERENCES hosts(id) ON DELETE SET NULL,
  court_count       INTEGER NOT NULL DEFAULT 0,
  player_count      INTEGER NOT NULL DEFAULT 0,
  match_count       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX open_sessions_expires_at ON open_sessions(expires_at);
```

No player names live in D1. `hosts` is account data the host chose to create
and is **not** subject to the 7-day session expiry; it is deletable on request
(a "Delete my account" action on the export screen).

### 3.3 Access model: capability links, no accounts

| Capability | How it's held | Can |
|---|---|---|
| **Host** | 128-bit random secret in the URL fragment `#host=…`, stored in the host's `localStorage`, sent as `X-Host-Key`. The DO stores only its SHA-256. | Everything. |
| **Court captain** (Phase 2) | Per-captain secret, fragment `#cap=…`. | Record and undo results; nothing else. Revocable by the host. |
| **Viewer** | The public code in the path, `/pickleball/s/{code}`. | Read the board. |

Secrets go in the fragment, never the query string, so they never reach
server logs or `Referer`. A lost host link can't be recovered (stated on the
create screen, with "Copy host link" and "Add to home screen" prompts). If the
host has signed in with Google for DUPR, that account can also reopen the
session as host.

### 3.4 Request flow

```
Browser ── POST /api/pickleball/open/sessions (Turnstile) ──► Worker
            Worker: rate-limit by IP → generate code + host secret
            → OpenSessionDO(code).init() → INSERT open_sessions → 201 {code, hostKey}

Browser ── POST /api/pickleball/open/s/{code}/commands {type, …, idempotencyKey}
            Worker: rate-limit → forward to OpenSessionDO(code)
            DO: authorize (host/captain key) → validate → apply in one
                storage transaction → bump version → reset expiry alarm
                → broadcast snapshot → 200 {version}

Browser ── WS /pickleball/rt/open/{code} ──► OpenSessionDO (hibernating sockets)
            tags: 'host' | 'captain' | 'viewer'; full snapshot on connect and on
            every change; client polls GET …/state every 5 s if the socket drops.
```

All commands go through one endpoint and one DO `dispatch()` with a
Zod-validated discriminated union, so there's a single place enforcing
authorization, idempotency, caps and expiry. `version` is persisted in
storage (fixing the current in-memory `seq` reset after hibernation).

The D1 index is updated from the DO at most once every 60 s per session
(`last_activity_at`, counts), not on every command.

### 3.5 Module layout

```
src/lib/pickleball/open/            pure, no I/O, unit-tested
  types.ts                          Player, Court, Match, SessionState, Mode
  roster.ts                         parsePastedRoster(text) → names (dedupe, strip numbering/emoji)
  standings.ts                      session standings (§5.3)
  fairness.ts                       sit-out guard, repeat counts, fairness metrics
  modes/paddleStack.ts              ┐
  modes/winnersLosers.ts            │ each: propose(state, courtId) → Proposal | null
  modes/byStanding.ts               │
  modes/balanced.ts                 ┘
  propose.ts                        picks the mode, applies the sit-out guard
  scoreValidation.ts                target/win-by-2/cap rules
  tournament/pairing.ts             random | balanced | manual pair formation
  tournament/drawEdits.ts           validate/apply player/pair/opponent swaps
  (reuses ../tournament/generateFixtures, advanceBracket,
   resolvePoolQualifiers, rankTournamentStandings, nextPlayableFixture)
src/lib/schemas/pickleball/open/    Zod command + response schemas
src/worker/pickleball/open/
  OpenSessionDO.ts                  storage schema, dispatch, alarm, sockets (target < 600 LOC;
                                    command handlers split into ./commands/*.ts)
  snapshot.ts                       host/viewer snapshot builders (viewer = allowlist)
  hostAuth.ts                       Google sign-in for hosts (reuses ../oauth.js)
  duprExport.ts                     CSV builder + Resend email
src/pages/pickleball/new.astro      create form
src/pages/pickleball/s/[code].astro board (viewer) / console (host), one React island
src/pages/pickleball/s/[code]/tv.astro
src/pages/api/pickleball/open/**    thin route files
src/pickleball-open/                React components for the board, console, dialogs
```

## 4. Session lifecycle

1. **Create** (`/pickleball/new`): host display name (unverified, shown as "Hosted by"), format (Open play / Tournament), number of courts (1–16) with optional labels, game settings (target 11/15/21, win by 2 on/off, or "winner only"), stacking mode. Turnstile required.
2. **Roster**: paste a list (one per line or comma-separated; numbering, bullets and emoji stripped; duplicates removed case-insensitively; e.g. copied from a Reclub attendee list or WhatsApp), CSV upload (`name[,skill][,dupr_id]`), manual add, or **QR self check-in**: players scan a check-in QR and type their own name (and optionally skill 1–5 and DUPR ID). The host can turn self check-in off.
3. **Run**: the host console shows every court. A free court shows the proposed match with **Start**, **Edit** and **Skip**. A playing court shows **Game over**.
4. **Players come and go**: add a late player at any time; mark a player *on break* (skipped by every mode) or *left*. A late player enters with `games_played` equal to the current minimum among active players, so they neither jump the queue nor wait forever.
5. **End**: "End session" freezes the board in its final state (still viewable and exportable until expiry). Any command resets the 7-day clock; ending does not delete early. "Delete now" is available to the host.
6. **Expire**: see §8.

## 5. Open play

### 5.1 Recording a game

**Game over** opens one dialog: tap the winning team; optionally enter the
score using a pad with the target preset (e.g. 11–__). Validation
(`scoreValidation.ts`): the winner reaches the target, win by 2 if enabled,
loser < winner, both ≤ 99; "winner only" sessions skip scores. The match
becomes `FINISHED`, its four players return to the waiting pool tagged with
the result, and the court immediately shows its next proposal.

- **Undo** the last result for 2 minutes (one tap, toast).
- **Edit** any finished result until the session expires. Editing changes standings but never re-plays history: matches already proposed or started aren't rewritten.
- **Abandon** a match in progress (no result; players return untagged).

### 5.2 Proposing the next match

When a court frees (or a new session starts), `propose(state, courtId)` runs
the session's mode over **available** players (not playing, not on break,
not left). Two rules apply to every mode before the mode's own logic:

1. **Sit-out guard**: any available player who has sat out ≥ 2 consecutive proposals is forced into this match (oldest first). This is what keeps sit-outs even with awkward counts like 14 players on 3 courts.
2. **Repeat avoidance**: among otherwise equal options, prefer the one with the fewest repeated partners, then repeated opponents (history kept per session).

| Mode | Picks the 4 players | Forms the teams |
|---|---|---|
| **Paddle stack** (default) | Fewest games played, then longest wait (current `selectNextPlayers` logic) | The split of the 4 with the fewest repeated partners |
| **Winners vs winners / losers vs losers** | Waiting players carry a tag from their last game: `W`, `L` or `N` (new/rested). Take the 4 oldest-waiting `W`; else 4 `L`; else 4 from `L ∪ N`; else fill by paddle-stack order. The sit-out guard still applies. | **Shuffled**: with winning teams (A1,A2) and (B1,B2), play A1+B1 vs A2+B2, so previous partners become opponents. If the 4 aren't two intact previous teams, use the paddle-stack split. |
| **By standing** (Mexicano style) | Rank available players by session standing (§5.3); take the window of 4 adjacent ranks that contains the longest-waiting player | 1st + 4th vs 2nd + 3rd of the window |
| **Balanced** | Paddle-stack order | Minimise the difference in summed skill (self-reported 1–5, or DUPR rating if given, else session win rate, else neutral) via the existing `balanceTeams` brute force; repeated partners break ties |

The host can switch mode mid-session; it applies to the next proposal.

### 5.3 Session standings

Per player: games played, wins, losses, points for and against, point
differential. Rank by **win rate**, then point differential, then points for,
then name. Players with 0 games are listed unranked at the bottom. Winner-only
games count toward W/L with no points. No persistent rating exists anywhere.

### 5.4 Editing proposals

Before **Start**, the host (or a captain on their court) can tap any of the four
slots and replace that player with any available player, swap two players
between teams, or **Skip** (re-propose, excluding this exact four). Optional
per-session constraints: *keep together* (always partners) and *keep apart*
(never on the same court). Each mode honours them as hard constraints, and
leaves a court unproposed (with a message) rather than break one.

### 5.5 Fairness panel (differentiator)

The host console and the TV board show live numbers from `fairness.ts`:
sit-out spread (max − min games played among present players), the longest
current wait, and repeated-partner count. Each player's row shows games,
sit-outs and current wait.

## 6. Tournaments (doubles)

1. **Pairs**: from the checked-in roster, the host picks **Random** (crypto-random shuffle), **Balanced** (snake pairing by skill: strongest with weakest), or **Manual**. An odd player is flagged for the host to resolve.
2. **Format**: round robin, pools → bracket (pools labelled A–H, top 2 advance), single elimination, double elimination. These are the existing `generateFixtures` formats, unchanged.
3. **Seeding**: **Random**, **By skill** (mean pair skill), or **Manual** (drag order). The existing generator takes entrants in seed order, so random seeding is a shuffle before generation; `seeding.ts`'s OPI ordering is not used.
4. **Generate** produces the full draw as a **draft**. Edits on the draft are unrestricted: swap a player between pairs, swap two pairs' positions, move a pair between pools, change a fixture's opponent. Every edit is re-validated by `drawEdits.ts` (no pair twice in a round, every pair keeps its fixture count in round robin and pools, bracket shape unchanged) and rejected with a reason if invalid.
5. **Start** locks the draw shape. After that, the only edits allowed are:
   - **Substitute a player** in a pair that is not on court (results stay with the pair);
   - **Swap opponents** between fixtures that haven't started, in the same round and the same pool/bracket.

   Later bracket slots stay `TBD` and fill via the existing `advanceBracket`.
6. **Courts**: same court loop as open play. The next `READY` fixture whose pairs aren't on court (`nextPlayableFixture`) is proposed to whichever court frees.
7. **Standings**: existing `rankTournamentStandings` (wins, losses, point differential, head-to-head) per pool and overall. The board shows pools and brackets.

## 7. Live board (QR)

`/pickleball/s/{code}`, for viewers, mobile-first:

- **Courts**: each court's four names, and whether it's *playing* or *up next*. This fixes today's gap where an assigned court showed no names.
- **Up next**: the next proposals in order, and "You're up next on Court 3" when a viewer taps their own name, which is remembered in `localStorage`.
- **Standings tab**, and a **Bracket tab** for tournaments.
- A banner: "Results deleted on {date}". The share button shows the QR (existing `PublicLinkQRCode`).

`/pickleball/s/{code}/tv` is a large-type, auto-rotating version for a venue screen.

The viewer snapshot is an allowlist (`snapshot.ts`): names, courts, matches,
results, standings. Never skill, DUPR IDs or any secret. The host sees a
privacy note on creation: the board is public to anyone with the link, so
first names or nicknames are fine.

## 8. Retention

- Every command sets the DO alarm to `now + 7 days` (`setAlarm` overwrites), and the D1 index's `expires_at` follows on its next throttled update.
- When the alarm fires: close all sockets, `ctx.storage.deleteAll()`, `DELETE FROM open_sessions WHERE public_code = ?`.
- **Backstop**: the existing daily cron gains a step that, for `open_sessions` rows with `expires_at < now − 1 day`, pokes the DO (which purges itself) and then deletes the row.
- An expired or unknown code renders a friendly "This session has ended and its results were deleted" page with a "Start your own" CTA (traction).
- **Export before it's gone**: "Download results (CSV)" for the host from Phase 1 (matches and standings).

## 9. DUPR export (host only, Google sign-in)

1. On the host console, **Email me the DUPR export** prompts Google sign-in. This reuses `src/worker/pickleball/oauth.js` (PKCE), with a new `devlab_pb_host` cookie that carries only `hostId`. On first sign-in a `hosts` row is created, with an optional marketing opt-in checkbox, unticked by default.
2. **Claim**: the session's DO records `hostId`. A session can be claimed once, only by someone holding the host key. After that the export is restricted to that account; a viewer or captain never sees the button.
3. The host enters their **DUPR Club ID** once (saved on `hosts`). Players' DUPR IDs come from check-in or the host's edits.
4. `duprExport.ts` builds a CSV in **DUPR's official match-import template**, which must be fetched from DUPR's club Matches tab and pinned in a test fixture before this phase is built; the column layout is not assumed. It includes only scored, finished doubles matches where all four players have a DUPR ID. The email lists how many matches were skipped and why.
5. Sent through the existing Resend integration to the host's **verified Google email**, with the CSV attached. The host uploads it in DUPR ("Import Matches via CSV"). Exports are limited to 5 per session per day.

We do not call DUPR or Reclub APIs, and do not scrape. Direct DUPR submission
needs DUPR partner status and is a business track. A Reclub partnership
(roster import) is pursued by email after launch.

## 10. Abuse and limits

- **Create**: Turnstile (server-verified via existing `src/worker/turnstile.js`) plus 10 sessions per IP per day. Creation **fails closed** if the limiter binding is missing, unlike today's fail-open helper; reads may fail open.
- **Commands**: 120 per minute per session; WebSocket connects 30 per minute per IP; public `state` 60 per minute per IP (existing).
- **Caps per session**: 16 courts, 128 players, 2,000 matches; names ≤ 40 characters, trimmed, control characters stripped. React escaping covers rendering.
- **Idempotency**: every command carries a client `idempotencyKey`, deduplicated in the DO for 10 minutes, so double taps on court-side Wi-Fi are safe.

## 11. Retiring the logged-in app (Phase 5)

- Delete: the SPA `src/pickleball-app/`, `/pickleball/app/*`, `/pickleball/accept-invite/*`, `/pickleball/live/*`, every route under `/api/pickleball/` except `open/**` and host auth, `authContext.js`, `session.js`, `permissions.ts`, `quota.ts`, invites, platform pages, audit, per-rally scoring (`src/lib/pickleball/scoring/*`), OPI (`opi.ts`, snapshots), `SessionCoordinatorDO` (wrangler migration `deleted_classes`).
- **Kept**: `oauth.js` (host sign-in), `RateLimiterDO`, the reused pure modules, `PublicLinkQRCode`.
- **D1**: one migration drops every old pickleball table, children before parents (`DROP TABLE` is safe; it's table rebuilds that aren't).
- **Redirects**: `/pickleball/app`, `/pickleball/methodology` and `/pickleball/live/*` get rows in the D1 `redirects` table, not hardcoded page redirects (per `AGENTS.md`).
- **Landing and guide copy** rewritten for "Free · no sign-up · QR live board"; `pickleball-public-pages.spec.js` is updated to pin the new claims, and every claim must still map to shipped code.
- **Docs**: `docs/pickleball/architecture.md`, `schema.md`, `realtime.md` and `runbook.md` rewritten. Their current C2–C5 staleness is fixed as a side effect.
- **Versioning**: Phases 1–4 are MINOR releases (additive routes). Phase 5 removes public routes and APIs, so it is a **MAJOR** release (2.0.0) per `CHANGELOG.md` policy.

## 12. Testing

- **Unit (vitest)**: every module under `src/lib/pickleball/open/`. Property-style tests for `propose()`: over randomized sessions of 5–40 players on 1–8 courts with random results, assert the sit-out guard (no one sits out more than 2 consecutive proposals), no player on two courts, constraints honoured, and repeat avoidance against a brute-force baseline on small cases. Plus `roster.ts` parsing fixtures, `scoreValidation.ts`, `drawEdits.ts` validity rules, and the DUPR CSV against the pinned template.
- **DO integration**: command dispatch, idempotency, authorization (viewer and captain refused host commands), alarm purge leaves empty storage and no index row.
- **E2E (Playwright, `static` project)**: create → paste roster → run 2 courts across several games in each mode → viewer page updates in a second browser context → edit result → tournament generate/edit/start/finish → expired-code page. Host Google sign-in is tested through a test-only login route gated by an env flag, as today.
- `npm run typecheck && npm run build` and the full e2e suite before each push, per `AGENTS.md`.

## 13. Phases

| # | Ships | Release |
|---|---|---|
| 1 | Anonymous create (Turnstile, limits), roster paste/manual/CSV, courts, **paddle stack**, final-score entry with undo/edit, proposal editing, live QR board, results CSV, 7-day expiry + cron backstop, new landing CTA "Start a free session" (old app still reachable) | minor |
| 2 | Winners/losers (shuffled), by-standing, balanced modes; keep together/apart; fairness panel; QR self check-in; court captain links; TV mode | minor |
| 3 | Tournaments: pairing, seeding, draft edits, start lock, substitutions/opponent swaps, bracket board | minor |
| 4 | Google host sign-in, claim, DUPR Club ID, DUPR CSV email; account deletion; optional offline PWA | minor |
| 5 | Retire the logged-in app (§11) | **major** |

Each phase: feature branch → `development` → verify on the preview URL → `main`,
with a `[Unreleased]` CHANGELOG entry in the same commit as each change.

**After launch (business):** email Reclub (help@reclub.co) for a partnership or
data access so hosts can import a meet's attendees directly; apply to DUPR's
partner program (clubs@mydupr.com) for direct match submission.

## 14. Risks

| Risk | Mitigation |
|---|---|
| A lost host link orphans a session | Prominent copy/save prompts; `localStorage` restore on the same device; a signed-in host can reopen their claimed sessions. |
| Anonymous creation spam | Turnstile, per-IP limits, fail-closed creation, caps, 7-day expiry. |
| The public board exposes names | Privacy note at creation; first names suggested; allowlisted viewer snapshot; "Delete now". |
| The DUPR template changes | The CSV builder is pinned to a fixture test; the email tells the host to report upload errors. |
| DO data lost before the 7 days | Durable Object storage is durable; the results CSV is offered throughout; acceptable for a free ephemeral tool. |
| Mode logic feels unfair in real play | Property tests for the guarantees in §1; the fairness panel makes behaviour visible; every proposal is editable. |

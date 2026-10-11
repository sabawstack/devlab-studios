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
- Sit-outs: with up to 12 available players per enabled court (4 playing, 8 waiting), no available player sits out more than 2 consecutive rounds. A "round" is one started game per enabled court. With more players than that, the wait is unavoidable and spreads evenly: fewest games first. In paddle stack, every proposal includes the available player who has played least.
- Partners: when splitting the chosen four into teams, a split that repeats an earlier partnership is never picked if another split of the same four avoids it.
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

### 3.2 Storage: D1 is the source of truth, the DO coordinates

This is the same pattern as ADR 0006, so no new ADR is needed. Every session's data is written to new
tables in `PICKLEBALL_DB` (D1). One new Durable Object class, `OpenSessionDO`
(wrangler migration tag `v3`), **one per session, addressed by
`idFromName(publicCode)`**, serializes commands and holds the WebSocket
connections. Why D1 over DO-only storage (owner decision, 2026-10-11):
- **Recovery**: D1 Time Travel gives 30-day point-in-time restore. A closed tab or a crashed DO never loses a session.
- **Traction metrics and support**: sessions, players, matches and modes can be queried across all sessions, and a host's "my session vanished" can be looked up.
- **Retention**: one scheduled `DELETE` cascades everything (§8).

**Fixing today's cost problem**: the DO loads the session from D1 once,
then keeps it in memory. Each command validates against the in-memory state,
writes only its changed rows to D1 in one `db.batch()` (D1 batches are
transactional), updates memory only after the batch succeeds, and broadcasts
from memory. No full reload per command, unlike the current
`SessionCoordinatorDO.broadcast`. After eviction or hibernation the DO reloads
from D1 on the next request or socket message.

New tables all carry the `open_` prefix, have no user or organization columns,
and hang off `open_sessions` with `ON DELETE CASCADE`. Enum CHECKs are written
wide up front, since they cannot be widened later (architecture.md, "Schema
constraint"):

```sql
CREATE TABLE hosts (                            -- only Google-verified DUPR exporters
  id TEXT PRIMARY KEY, google_sub TEXT NOT NULL UNIQUE, email TEXT NOT NULL,
  display_name TEXT NOT NULL, dupr_club_id TEXT,
  marketing_opt_in INTEGER NOT NULL DEFAULT 0 CHECK (marketing_opt_in IN (0,1)),
  created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL
);
CREATE TABLE open_sessions (
  id TEXT PRIMARY KEY, public_code TEXT NOT NULL UNIQUE,   -- 10 chars base32
  host_key_hash TEXT NOT NULL,                             -- SHA-256 of the host secret
  host_id TEXT REFERENCES hosts(id) ON DELETE SET NULL,    -- set when claimed for DUPR
  kind TEXT NOT NULL CHECK (kind IN ('OPEN_PLAY','TOURNAMENT')),
  name TEXT NOT NULL, host_display_name TEXT NOT NULL, location TEXT,
  settings_json TEXT NOT NULL,      -- mode, target, scoring style, constraints
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','ENDED')),
  version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, last_activity_at TEXT NOT NULL, expires_at TEXT NOT NULL
);
CREATE INDEX open_sessions_expires_at ON open_sessions(expires_at);
-- open_players(id, session_id, name, skill, dupr_id, status, joined_at, games_played, last_result_tag, ...)
-- open_courts(id, session_id, label, position, enabled)
-- open_matches(id, session_id, court_id, round_seq, status, team_a/b player ids, score_a, score_b,
--              winner, proposed_at, started_at, finished_at, fixture_id)
-- open_captains(id, session_id, key_hash, label, revoked_at)
-- open_tournament_entrants / open_tournament_fixtures   (Phase 3; same shape as today's tournament tables)
-- open_idempotency(session_id, key, response_json, created_at)
```

The exact column lists are fixed in each phase's plan; the rules above are not
negotiable. `hosts` is account data the host chose to create and is **not**
subject to the 7-day session expiry. It is deletable on request ("Delete my
account" on the export screen).

### 3.3 Access model: capability links, no accounts

| Capability | How it's held | Can |
|---|---|---|
| **Host** | 128-bit random secret in the URL fragment `#host=…`, stored in the host's `localStorage`, sent as `X-Host-Key`. Only its SHA-256 is stored (`open_sessions.host_key_hash`). | Everything. |
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
            → INSERT open_sessions (+ courts, players) → 201 {code, hostKey}

Browser ── POST /api/pickleball/open/s/{code}/commands {type, …, idempotencyKey}
            Worker: rate-limit → forward to OpenSessionDO(code)
            DO: (load from D1 if cold) → authorize (host/captain key) → validate
                → write changed rows + version + last_activity_at/expires_at
                  in one db.batch() → apply to memory → broadcast → 200 {version}

Browser ── WS /pickleball/rt/open/{code} ──► OpenSessionDO (hibernating sockets)
            tags: 'host' | 'captain' | 'viewer'; full snapshot on connect and on
            every change; client polls GET …/state every 5 s if the socket drops.
```

All commands go through one endpoint and one DO `dispatch()` with a
Zod-validated discriminated union, so there's a single place enforcing
authorization, idempotency, caps and expiry. `version` is persisted in
`open_sessions.version` (fixing the current in-memory `seq` reset after hibernation).

**Concurrent and flaky writes**: a result command carries the match id. If that match is already finished, the second writer gets 409 with who saved it ("Already saved by Court captain 2"). While the socket is down, the host console shows "Reconnecting…" and keeps unsent commands in memory, retrying them with the same `idempotencyKey`, so a retry is never applied twice. Viewers fall back to polling `state` every 5 s.

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
  scoreValidation.ts                target, sudden death / win by 2, cap rules
  tournament/pairing.ts             random | balanced | manual pair formation
  tournament/drawEdits.ts           validate/apply player/pair/opponent swaps
  (reuses ../tournament/generateFixtures, advanceBracket,
   resolvePoolQualifiers, rankTournamentStandings, nextPlayableFixture)
src/lib/schemas/pickleball/open/    Zod command + response schemas
src/worker/pickleball/open/
  OpenSessionDO.ts                  load/cache, dispatch, sockets (target < 600 LOC;
                                    command handlers split into ./commands/*.ts)
src/worker/repositories/pickleball/open/   D1 reads/writes per table (repository pattern)
migrations/pickleball/0016_open_sessions.sql
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

1. **Create** (`/pickleball/new`): host display name (unverified, shown as "Hosted by"), format (Open play / Tournament), number of courts (1–16) with optional labels, game settings (target 11/15/21; scoring style side-out or rally, which only labels the DUPR export), optional venue/location text, stacking mode. Turnstile required.
2. **Roster**: paste a list (one per line or comma-separated; numbering, bullets and emoji stripped; duplicates removed case-insensitively; e.g. copied from a Reclub attendee list or WhatsApp), CSV upload (`name[,skill][,dupr_id]`), manual add, or **QR self check-in**: players scan a check-in QR and type their own name (and optionally skill 1–5 and DUPR ID). The host can turn self check-in off.
3. **Run**: the host console shows every court. A free court shows the proposed match with **Start**, **Edit** and **Skip**. A playing court shows **Game over**.
4. **Players come and go**: add a late player at any time; mark a player *on break* (skipped by every mode) or *left*. A late player enters with `games_played` equal to the current minimum among active players, so they neither jump the queue nor wait forever.
5. **End**: "End session" freezes the board in its final state (still viewable and exportable until expiry). Any command resets the 7-day clock; ending does not delete early. "Delete now" is available to the host.
6. **Expire**: see §8.

## 5. Open play

### 5.1 Recording a game

**Game over** opens one dialog: tap the winning team; optionally enter the
score using a pad with the target preset (e.g. 11–__). Validation
(`scoreValidation.ts`) accepts **either** way a game can end, because the
app only ever hears the final score and cannot know which rule a court played
(owner decision, 2026-10-11): **sudden death**, where the winner has exactly the
target and the loser anything below it (11–7, 11–10); or **win by 2**, where the
loser reached at least target − 1 and the winner is exactly 2 ahead (12–10,
13–11). Anything else is refused (12–9, 13–10, 12–11, 11–11), and both scores
must be ≤ 99. There is no win-by-2 setting. On the pad, a losing score of
target − 1 defaults to sudden death (11–10) with a one-tap "12–10 win by 2"
switch, because most open play is sudden death; a losing score at or above the
target fills the win-by-2 score. Every result carries a score; there is no
winner-only option (owner decision 2026-10-12), so every game counts in the
points share. The match
becomes `FINISHED`, its four players return to the waiting pool tagged with
the result, and the court immediately shows its next proposal.

- **Undo** the last result for 2 minutes (one tap, toast).
- **Edit** any finished result until the session expires. Editing changes standings but never re-plays history: matches already proposed or started aren't rewritten.
- **Abandon** a match in progress (no result; players return untagged).

### 5.2 Proposing the next match

When a court frees (or a new session starts), `propose(state, courtId)` runs
the session's mode over **available** players (not playing, not on break,
not left). Two rules apply to every mode before the mode's own logic:

1. **Sit-out guard**: any available player who has sat out ≥ 2 consecutive rounds is forced into this match (oldest first). A round is one started game per enabled court. This keeps sit-outs even with awkward counts like 14 players on 3 courts, and caps them at 2 in a row whenever there are no more than 12 available players per court (§1).
2. **Repeat avoidance**: among otherwise equal options, prefer the one with the fewest repeated partners, then repeated opponents (history kept per session).

| Mode | Picks the 4 players | Forms the teams |
|---|---|---|
| **Paddle stack** (default) | Fewest games played, then longest wait (current `selectNextPlayers` logic) | The split of the 4 with the fewest repeated partners |
| **Winners vs winners / losers vs losers** | Waiting players carry a tag from their last game: `W`, `L` or `N` (new/rested). Take the 4 oldest-waiting `W`; else 4 `L`; else 4 from `L ∪ N`; else fill by paddle-stack order. The sit-out guard still applies. | **Shuffled**: with winning teams (A1,A2) and (B1,B2), play A1+B1 vs A2+B2, so previous partners become opponents. If the 4 aren't two intact previous teams, use the paddle-stack split. |
| **By standing** (Mexicano style) | Rank available players by session standing (§5.3); take the window of 4 adjacent ranks that contains the longest-waiting player | 1st + 4th vs 2nd + 3rd of the window |
| **Balanced** | Paddle-stack order | Minimise the difference in summed skill (self-reported 1–5, or DUPR rating if given, else session win rate, else neutral) via the existing `balanceTeams` brute force; repeated partners break ties |

The host can switch mode mid-session; it applies to the next proposal.

### 5.3 Session standings

Per player: games played, wins, losses, points for and against, and the share
of points won. Ranking order (owner decisions, 2026-10-11, revised 2026-10-12):

1. Win rate (wins ÷ games played).
2. **Points won %**: the average, over scored games, of each game's points scored ÷ points played — the same formula as the documented OPI (`docs/pickleball/opi-methodology.md`), session-only. A share rather than a margin, because +4 means far less in a game to 21 than in a game to 11; averaged per game so a long deuce game counts no more than an 11–2.
3. Head-to-head among exactly the tied players: wins in today's games where they were on opposite sides. Applied only if every tied player has met.
4. Name.

Results saved before 2026-10-12 without a score count toward W/L and win
rate but not toward the points share. Players with 0 games are listed unranked
at the bottom. The board shows W–L, Win % and Pts won %, with a one-line
"how ranking works" note. No persistent rating exists anywhere.

Example: Ana 3–1 with scores 11–2, 11–3, 11–5, 9–11 (per-game 85, 79, 69, 45 → **69%**)
ranks above Leo 3–1 with 11–9, 11–9, 12–10, 9–11 (55, 55, 55, 45 → **52%**).

### 5.4 Editing proposals

Before **Start**, the host (or a captain on their court) can tap any of the four
slots and replace that player with any available player, swap two players
between teams, or **Skip** (re-propose, excluding this exact four). A player swapped out of a proposal keeps their place at the front of the queue, so an edit never costs anyone a turn. If fewer than 4 players are available when a court frees, the court shows "Waiting for players" and is proposed again automatically after the next result. Optional
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

- Every command sets `last_activity_at = now` and `expires_at = now + 7 days` in the same batch.
- **Purge**: the existing daily cron gains a step: `DELETE FROM open_sessions WHERE expires_at < now` (in chunks of 500). `ON DELETE CASCADE` removes the session's players, courts, matches, captains, tournament rows and idempotency keys. It then notifies the DO of each purged code, so open sockets close and the in-memory copy is dropped. A purge count is logged.
- D1 Time Travel can still restore purged data for up to 30 days as a backup. The privacy wording on the site says "deleted from the live service after 7 days of inactivity" and must not claim instant erasure from backups.
- An expired or unknown code renders a friendly "This session has ended and its results were deleted" page with a "Start your own" CTA (traction).
- **Export before it's gone**: "Download results (CSV)" for the host from Phase 1 (matches and standings).

## 9. DUPR export (host only, Google sign-in)

1. On the host console, **Email me the DUPR export** prompts Google sign-in. This reuses `src/worker/pickleball/oauth.js` (PKCE), with a new `devlab_pb_host` cookie that carries only `hostId`. On first sign-in a `hosts` row is created, with an optional marketing opt-in checkbox, unticked by default.
2. **Claim**: the session's DO records `hostId`. A session can be claimed once, only by someone holding the host key. After that the export is restricted to that account; a viewer or captain never sees the button.
3. The host enters their **DUPR Club ID** once (saved on `hosts`). Players' DUPR IDs come from check-in or the host's edits.
4. `duprExport.ts` builds a CSV in DUPR's club match-import template. The layout below was taken from public sources without a DUPR login: a public copy of DUPR's template in the open-source repo `johnpathe/dupr-match-entry`, which matches PickleQ's "27-column" description, plus DUPR's and vendors' help pages. It is pinned as a test fixture (`tests/fixtures/dupr-import-template.csv`):

   ```
   matchType,event,date,playerA1,playerA1DuprId,playerA1ExternalId,playerA2,playerA2DuprId,
   playerA2ExternalId,playerB1,playerB1DuprId,playerB1ExternalId,playerB2,playerB2DuprId,
   playerB2ExternalId,teamAGame1,teamBGame1,teamAGame2,teamBGame2,teamAGame3,teamBGame3,
   teamAGame4,teamBGame4,teamAGame5,teamBGame5,location,scoreType
   ```

   - **Field values**: `matchType` = `D`; `event` = session name; `date` = `YYYY-MM-DD` in the session's local date; `scoreType` = `SIDEOUT`, or `RALLY` if the host chose rally scoring at creation; `location` = an optional venue text field on the session.
   - **Games**: one row per game, with only game 1 filled. Games 2–5 stay blank. `*ExternalId` is our session player id.
   - **No instruction rows**: DUPR's downloadable template carries instruction rows that must be deleted before upload; ours never includes them.
   - **Eligibility**: DUPR rejects ties and games where neither team reaches 6 points. A game is exported only if it is a finished doubles match with a score that passes those rules and all four players have a DUPR ID. DUPR IDs are validated as 6 alphanumeric characters, uppercased.
   - **Skipped games**: the email lists each skipped game and the reason.
   - **Upload**: the host's DUPR account must be a Club Director or Organizer of their club. The email says so, with the click path (Matches → Add Matches → Import Matches via CSV).
   - **Risk**: if DUPR changes the template, the fixture and builder are updated together. Uploads that fail are reported by hosts through the email's reply-to.
5. **My sessions**: a signed-in host sees their claimed sessions from any device and can reopen them as host (this is the recovery path for a lost host link).
6. Sent through the existing Resend integration to the host's **verified Google email**, with the CSV attached. The host uploads it in DUPR ("Import Matches via CSV"). Exports are limited to 5 per session per day.

We do not call DUPR or Reclub APIs, and do not scrape. Direct DUPR submission
needs DUPR partner status and is a business track. A Reclub partnership
(roster import) is pursued by email after launch.

## 10. Abuse and limits

- **Create**: Turnstile (server-verified via existing `src/worker/turnstile.js`) plus 10 sessions per IP per day. Creation **fails closed** if the limiter binding is missing, unlike today's fail-open helper; reads may fail open.
- **Commands**: 120 per minute per session; WebSocket connects 30 per minute per IP; public `state` 60 per minute per IP (existing).
- **Caps per session**: 16 courts, 128 players, 2,000 matches; names ≤ 40 characters, trimmed, control characters stripped. React escaping covers rendering.
- **Idempotency**: every command carries a client `idempotencyKey`, deduplicated in the DO for 10 minutes, so double taps on court-side Wi-Fi are safe.

## 11. Public pages, guides and visual design

Every public page is reframed around "free, no sign-up, run every court from one phone":

- **Pages**:
  - `/pickleball`: the landing page, with a "Start a free session" primary CTA, a live demo board and a feature tour.
  - `/pickleball/how-it-works`: rewritten as the host guide (start, add players, run courts, record results, stacking modes, tournaments, QR board, exports, privacy and retention).
  - A new `/pickleball/rotation`: "How fair rotation works". It replaces `/pickleball/methodology`, and like it, its worked examples are computed at build time by importing the real engine (`propose()`), so the page cannot drift from the code.
  - FAQ: free? login? how long is data kept? DUPR? Reclub?
  - The create page, board, TV view, expired-code page and a new 1200×630 share image (`scripts/og/`).
- **Copy rule kept**: every claim must map to shipped code, pinned by `pickleball-public-pages.spec.js`. Phase 1 rewrites all of the pages but claims only Phase 1 features; each later phase adds its own guide sections and claims in the same change that ships the feature.
- **Visual system**: extend the hand-authored SVG set in `src/components/pickleball/art/` with:
  - an animated hero court scene (ball arc, paddles, players rotating in);
  - one animated diagram per stacking mode (paddle stack moving through courts, the winners/losers shuffle showing partners becoming opponents, standing windows, balanced splits);
  - QR to phone, the score dialog, the bracket, and empty and expired states.
- **Animation rules**:
  - Pure CSS keyframes or SMIL inside inline SVG, with no animation library and no JavaScript on the marketing pages (the existing zero-hydration rule holds).
  - Animate only `transform` and `opacity`.
  - Everything stops under `prefers-reduced-motion: reduce`.
  - The hero SVG stays under 30 KB, and Lighthouse performance on `/pickleball` stays at or above 90 on mobile.
- **In-app motion**: a court card flips to its next match when a result is saved; "Up next" pulses; a short CSS celebration plays for a tournament winner. All respect reduced motion.
- **Palette: DevLab base plus one pickleball neon** (owner decision, 2026-10-11). Use the existing `tailwind.config.js` tokens, plus one new token:

  | Role | Token | Value |
  |---|---|---|
  | Page ground (dark) | `ink`, `navy-950` | `#0b1426`, `#0b1b34` |
  | Surfaces | `navy-900` / `navy-800` | `#11214d` / `#152b66` |
  | Primary action | `brand` (white text) | `#4500ff` |
  | Secondary text | `mist` | `#b5c4e1` |
  | Court art | `navy-500` / `navy-300` | `#3055d6` / `#7594fb` |
  | **Pickleball accent** (new `pickle-neon`) | ink text on it | `#c6ff2e` |
  | Team A / Team B | `pickle-neon` / `#8d9bff` | different lightness, always labelled |

  - **Neon use**: the neon marks "live / up next / winner": the ball, the active court, the live dot, highlights. It is used as a fill with ink text, or as text on dark surfaces only, never as text on white. Violet stays the colour of the main actions, so the product reads as DevLab.
  - **Light mode**: the `brand.shell` (`#f5f5fc`) ground. Neon appears only as fills with ink text.
  - **Type**: Plus Jakarta Sans, the site font, at heavier weights for display. The mockup's placeholder fonts are not used.
  - **Contrast**: every pair is checked to WCAG AA.
- **Every screen adapts to any width, from a phone to a TV** (owner decision, 2026-10-11). Layout uses CSS grid with `auto-fill`/`minmax`, container queries and `clamp()` type, not fixed phone frames:
  - **Phone (< 640 px)**: single column, as in the mockups, with the bottom tab bar.
  - **Tablet (640–1023 px)**: courts in a 2–3 column grid; the waiting list and fairness panel sit beside or under them.
  - **Laptop / desktop (≥ 1024 px)**: the host console is a three-area layout: a courts grid (`repeat(auto-fill, minmax(280px, 1fr))`, so 4–16 courts fit without scrolling where possible), a waiting/fairness sidebar, and a standings panel. The tab bar becomes a top or side nav. Dialogs (Game over, Edit match) open as centred panels instead of bottom sheets.
  - **Viewer board**: courts grid plus standings side by side on wide screens.
  - **TV mode (`/tv`)**: fills the screen at any size and court count, with type scaling via `clamp()` and the courts grid reflowing for 1–16 courts. It must stay readable from about 5 m on a 1080p screen.
  - **Tournament editor**: pools side by side on wide screens, stacked on phones. Dragging also works by tap-to-select, so touch and mouse both work.
  - **E2E checks**: every key screen at 390, 768, 1280 and 1920 px wide, with no horizontal page scroll.
- **Process**: the owner reviewed the phone mockups on 2026-10-11 and approved the direction. The palette and wide-screen layouts above refine them during the build.

## 12. Retiring the logged-in app and cleaning up its data (Phase 5)

No one uses the old app, so this phase can be pulled forward to any point after Phase 1 ships.

**Database cleanup** (both `devlab-pickleball-preview` and `devlab-pickleball`):
1. Read row counts of every old table on production and confirm they hold only test/demo data. Take a `wrangler d1 export` backup to a local file outside the repo.
2. Migration `00NN_drop_legacy_pickleball.sql` drops, children before parents: the one-active-pair trigger, `audit_events`, `player_performance_snapshots`, `player_game_stats`, `matchmaking_history`, `idempotency_keys`, `score_events`, `game_participants`, `tournament_fixtures`, `tournament_entrants`, `games`, `team_members`, `teams`, `queue_entries`, `session_pairs`, `session_players`, `session_operator_grants`, `public_session_tokens`, `session_courts`, `pickleball_sessions`, `scoring_rulesets`, `courts`, `venues`, `players`, `organization_invites`, `organization_memberships`, `organizations`, `users`. `DROP TABLE` is safe on D1; only table rebuilds are dangerous. The `open_*` tables and `hosts` are untouched.
3. Wrangler migration `deleted_classes: ["SessionCoordinatorDO"]` removes the old Durable Object and its stored data, in both environments.
4. Read back the table list after applying to confirm only the new tables remain.
5. Delete the leftover files: `_bootstrap-org-tmp.sql` (repo root), `scripts/pickleball/create-organization.mjs`, `scripts/pickleball/seed/*` and the old e2e fixtures in `scripts/pickleball/apply-e2e-fixtures.mjs`. The old `docs/superpowers` plans and specs are kept as history and marked superseded.
6. Env/vars: keep `GOOGLE_OAUTH_CLIENT_ID`, the OAuth secret and `PICKLEBALL_OAUTH_REDIRECT_BASE_URL` (host sign-in). Remove any pickleball invite/org-only vars.

**Code removal**:
- Delete: the SPA `src/pickleball-app/`, `/pickleball/app/*`, `/pickleball/accept-invite/*`, `/pickleball/live/*`, every route under `/api/pickleball/` except `open/**` and host auth, `authContext.js`, `session.js`, `permissions.ts`, `quota.ts`, invites, platform pages, audit, per-rally scoring (`src/lib/pickleball/scoring/*`), OPI (`opi.ts`, snapshots), `SessionCoordinatorDO`, and the old repositories and e2e specs.
- **Kept**: `oauth.js` (host sign-in), `RateLimiterDO`, the reused pure modules, `PublicLinkQRCode`.
- **Redirects**: `/pickleball/app` -> `/pickleball/new`, `/pickleball/methodology` -> `/pickleball/rotation` and `/pickleball/live/*` -> `/pickleball` get rows in the D1 `redirects` table, not hardcoded page redirects (per `AGENTS.md`).
- Remove the remaining copy that mentions sign-in, operators or OPI (the pages were already rewritten in Phase 1, §11).
- **Docs**: `docs/pickleball/architecture.md`, `schema.md`, `realtime.md` and `runbook.md` rewritten. Their current C2–C5 staleness is fixed as a side effect.
- **Versioning**: Phases 1–4 are MINOR releases (additive routes). Phase 5 removes public routes, APIs and the D1 schema, so it is a **MAJOR** release (2.0.0) per `CHANGELOG.md` policy.

## 13. Testing

- **Unit (vitest)**: every module under `src/lib/pickleball/open/`. Property-style tests for `propose()`: over randomized sessions of 5–40 players on 1–8 courts with random results, assert the sit-out guard (no one sits out more than 2 consecutive rounds while players ≤ 12 per court), no player on two courts, constraints honoured, and repeat avoidance against a brute-force baseline on small cases. Plus `roster.ts` parsing fixtures, `scoreValidation.ts`, `drawEdits.ts` validity rules, and the DUPR CSV against the pinned template.
- **DO + D1 integration**: command dispatch, idempotency, authorization (viewer and captain refused host commands), cold reload from D1 matches the in-memory state, a failed batch leaves memory unchanged, and the cron purge removes every `open_*` row for an expired session.
- **E2E (Playwright, `static` project)**: create → paste roster → run 2 courts across several games in each mode → viewer page updates in a second browser context → edit result → tournament generate/edit/start/finish → expired-code page. Host Google sign-in is tested through a test-only login route gated by an env flag, as today.
- `npm run typecheck && npm run build` and the full e2e suite before each push, per `AGENTS.md`.

## 14. Phases

| # | Ships | Release |
|---|---|---|
| 1 | Anonymous create (Turnstile, limits), roster paste/manual/CSV, courts, **paddle stack**, final-score entry with undo/edit, proposal editing, live QR board, results CSV, 7-day expiry via the daily cron purge, **all public pages and guides rewritten with the new visual and animation set (§11)** (old app still reachable) | minor |
| 2 | Winners/losers (shuffled), by-standing, balanced modes; keep together/apart; fairness panel; QR self check-in; court captain links; TV mode | minor |
| 3 | Tournaments: pairing, seeding, draft edits, start lock, substitutions/opponent swaps, bracket board | minor |
| 4 | Google host sign-in, claim, DUPR Club ID, DUPR CSV email; account deletion; optional offline PWA | minor |
| 5 | Retire the logged-in app (§12) | **major** |

Each phase: feature branch → `development` → verify on the preview URL → `main`,
with a `[Unreleased]` CHANGELOG entry in the same commit as each change.

**After launch (business):** email Reclub (help@reclub.co) for a partnership or
data access so hosts can import a meet's attendees directly; apply to DUPR's
partner program (clubs@mydupr.com) for direct match submission.

## 15. Risks

| Risk | Mitigation |
|---|---|
| A lost host link orphans a session | Prominent copy/save prompts; `localStorage` restore on the same device; a signed-in host can reopen their claimed sessions. |
| Anonymous creation spam | Turnstile, per-IP limits, fail-closed creation, caps, 7-day expiry. |
| The public board exposes names | Privacy note at creation; first names suggested; allowlisted viewer snapshot; "Delete now". |
| The DUPR template changes | The CSV builder is pinned to a fixture test; the email tells the host to report upload errors. |
| Host closes the tab or loses the phone | Data is in D1, never only in the browser. Same device: "Resume your session". Other device: host link or Google sign-in. |
| Mode logic feels unfair in real play | Property tests for the guarantees in §1; the fairness panel makes behaviour visible; every proposal is editable. |

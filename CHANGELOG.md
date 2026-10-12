# Changelog

All notable changes to this project are recorded here, following the spirit
of [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). This file's
`## [Unreleased]` section is updated as part of the same change that makes
the change — never batched up and reconstructed later — so it stays a real,
contemporaneous trace, not a retrospective guess.

## Versioning policy

This project follows [Semantic Versioning](https://semver.org/)
(MAJOR.MINOR.PATCH). The product surface here is the public site's
pages/routes plus the CMS API contract (`/api/*` request/response shapes and
the D1 schema) rather than a published package, so the three levels are
decided against that surface specifically:

- **MAJOR** — a breaking change to the public contract: removing/renaming an
  `/api/*` endpoint or a field the frontend or admin UI depends on, a
  non-backward-compatible D1 schema change, removing a public route, or any
  change explicitly called out as breaking.
- **MINOR** — new backward-compatible capability: a new page/route, a new CMS
  content type or optional API field, a new admin feature. Nothing existing
  breaks.
- **PATCH** — bug fixes, performance/reliability improvements,
  dependency/security patches, refactors, and documentation — no change to
  what a visitor, admin user, or API caller can rely on.

### Process, every time something ships

1. Add an entry to `## [Unreleased]` in the same commit as the change itself.
2. When a set of `[Unreleased]` entries is ready to ship as a release:
   decide the bump level using the rules above (the highest level triggered
   by anything in the batch — one breaking change makes the whole release
   major, even alongside ten patch-level fixes), bump `package.json`'s
   `version` to match, retitle `[Unreleased]` to `## [X.Y.Z] - YYYY-MM-DD`,
   and start a fresh empty `[Unreleased]` above it — all in one commit.
3. Push to `main`. CI (`.github/workflows/ci.yml`) detects that
   `package.json`'s version changed from the previous commit, then
   automatically creates the immutable `vX.Y.Z` tag, pushes it, and publishes
   a matching GitHub Release with body text extracted from that version's
   `CHANGELOG.md` section. Ordinary commits that don't bump the version are
   left untouched — nothing is tagged unless a human explicitly decided a
   release was ready. A manual `git tag vX.Y.Z` (pushed by hand) is only a
   fallback if CI can't run.
4. Tags are immutable — once pushed, a version tag is never moved or
   force-updated. If something ships wrong, the fix is a new patch release,
   not a rewritten tag.
5. "What's current" is answered by GitHub's native mechanism (the
   highest-semver published Release is automatically marked **Latest
   release**) — no floating `latest` tag is maintained.

## [Unreleased]

### Fixed
- The navbar and footer logo fallback (used when the R2 logo cannot load) is an 88 px WebP of the bundled logo instead of the 839x1135 source PNG: 35.6 KB less per page in that case, which is what put `/profile` at 285.8 KB against its 280 KB image budget in e2e, where *.r2.dev does not resolve.
- CMS Site Settings and the replace-all collection screens (e.g. Testimonials) stay locked until their stored content has loaded. Before, an edit made while loading was overwritten when the fetch landed, and Save in that window wrote the static fallback (or an empty list) over what was in D1.
- CMS Site Settings stays locked when its load fails (except the no-database 503, where saving the fallback seeds D1) and says to press Refresh, instead of offering the static fallback for saving over settings it could not read. Replace-all collection screens remount when switching collection, offer Retry after a failed load, and lock their item controls while saving.
- The CMS SEO editor follows the same rule: locked until its records load (or the no-database 503), and locked with a Refresh prompt after a failed load. "+ New page" clicked during the load used to be replaced by the loaded records, and Save could write the static fallback over D1.
- The request-body drain added for local dev is now narrow and off in production: only the inquiry, contact and lead-magnet 413 reads off the refused body, and only when `DRAIN_UNREAD_BODIES` is set (`.dev.vars`, the Playwright wrangler command). A deployed worker never waits on a large or slow body before refusing it. The earlier blanket drain in the middleware made the pickleball e2e suite drop 2-9 requests a run (0 without it) and is gone.
- E2E isolation: admin, digest and Lead CRM suites reuse the one admin-auth session instead of signing in per worker; the two site-settings tests run serially; per-IP limited submissions use a random client address because the limiter's counters persist across runs; the mailbox upload/delete gate check sends a same-origin `Origin` so it tests the session gate (401); the Profile preview check waits for its island to hydrate and runs at 1x pixel density; the gallery upload check waits for the upload rather than a label that may only show for a few milliseconds.
- E2E: the static preview server runs on its own snapshot of the local state (`scripts/e2e/snapshot-static-state.mjs`) instead of sharing `.wrangler/state` D1 files with `wrangler dev`, which intermittently failed with D1 "internal error" and hung a page. New check that a cross-origin form POST gets checkOrigin's 403; the inquiry limiter probe uses a fresh address and requires at least 5 accepted before the 429; the Profile hover check is skipped on mobile-safari (desktop layout check); a missing admin-auth session file gets a clear error.
- Pickleball tournaments (phase 3 review): opponents can be swapped only between pairs the draw placed (first-round and pool games); a pair that reached a later round by a result stays put ("That pair got there by a result. Change the result instead."), the bracket no longer offers those slots as tappable, and undo refuses rather than clear a slot that holds a different pair. A game only starts from ready and only an on-court game is abandoned; editing needs a saved result. Draw order breaks ties by id in memory and in D1 with plain (not locale) text compare. A tournament session missing its tournament row loads as a fresh setup. Creating a session needs a format exactly when it is a tournament (400 otherwise), and random pairing or seeding without a random source is refused with a reason. CSV cells opening with a tab or carriage return are neutralised too. A free court at the 2,000-game cap says so. The host console's More menu sits above the error banner, and the guide and FAQ copy match what swaps allow.
- Mailbox e2e suite no longer fails a different handful of tests each run. Every Playwright worker signed in separately, and a replaced worker signed in again, which used up the admin login limit (20 per address per 15 minutes; the local limiter keeps its count between `wrangler dev` restarts). A new `admin-auth` setup project now signs in once per run and the mailbox specs reuse that session. The tests also no longer depend on run order or shared data: the Retry test creates its own failed reply (the local worker gets a test-only `MAILBOX_OUTBOX_TOKEN`), folder-banner and empty-Inbox checks no longer depend on load timing, rail links match their count badge, and the Compose notice check matches the current wording.
- Open play: while sign-in on the live connection keeps failing (`AUTH_ERROR`), the host and captain consoles keep refreshing by polling and reconnects back off 1, 2, 4, then every 8 seconds. A socket now counts as live only once it delivers the snapshot the page signed in for.
- Open play captain links: labels are unique (ignoring case) among live links and never "Host"; a taken name gets the lowest free number ("Court 1 captain 2"), and a number freed by turning a link off is reused. "Make a link" makes one link however fast it is tapped.
- Open play: a captain's snapshot no longer carries who saved each result (`recordedBy`), which only the host sees. Broadcasts build the public board and court list once per pass for the host and every captain.
- Open play host console: picking the same player as First in a keep-together/apart rule clears Second, and an unknown mode no longer breaks the Mode button. Migration `0017` indexes `open_captains.court_id`.
- Open play copy: the pages and create screen now say a keep-together or keep-apart rule can hold back the "sat out 2 rounds in a row goes on next" guarantee.
- Open play: a server error while a host or court captain signs in on the live connection no longer costs them their key. The server now answers `AUTH_ERROR` (not `AUTH_FAILED`), and the page keeps the key and reconnects. Only a refusal (HTTP 403 or `AUTH_FAILED`) forgets a key.
- Open play: a captain link that was turned off falls back to a live captain key this phone already saved for the session. A host opening a captain link no longer stores the captain key.
- Open play court captains sheet: "Turn off" sends one request however fast it is tapped, and "Send link" says "Copied" or "Couldn't copy — copy the link below". The consoles say "Connecting…" on first load instead of "Reconnecting…".
- The open play host console's More menu stays on screen on phones; it was anchored to the button and ran off the left edge when the header wrapped.
- **Attaching a file, sending, and then writing a second reply no longer shows files that will not be sent.** `attachmentIds` was cleared on send but `AttachmentPicker` kept its own list, so the previous reply's files stayed listed under the box while attached to nothing. The picker is now remounted after a send. Found by the new end-to-end test, not by review.
- **The e2e environment applies migrations.** Nothing did, so the local D1 sat at `0015` while production was on `0016` and `mailbox_outbound_attachments` did not exist locally — the attachment upload failed there with a generic 500 that said nothing about the cause. A suite one migration behind is worse than no suite: it reports failures unrelated to the code under test, and would pass a feature that is broken in production for the mirror-image reason.
- Tournament copy matches the product: the TV shows standings, results and next games (the bracket is on phones), pairs are random, balanced or in list order, courts are offered the next game for the host to start, and opponent swaps stay within a pool or bracket. A substitute refusal clears once the retry succeeds. The landing page's odd last feature card spans the row.
- Open play player rows say "1 game" rather than "1 games", and the mode picker's sit-out promise carries the same keep-together/apart caveat as the guides.
- TV board courts refit their type when the web font finishes loading, so a card sized against the fallback font no longer spills once the real font arrives.
- The TV board of an ended session no longer offers a check-in QR or an up-next list (check-in is closed); the QR points at the final standings. The longest-wait tile on the TV shows a first name so a long name wraps cleanly.
- The rotation guide now says that winners play winners only draws from the eight players waiting longest, so a game can still mix winners and losers, and that by standing takes four neighbouring ranks.
- Open play: replaying a host command now answers with the session as it is now and stores only the status and version, so an idempotency record can never approach D1's row size at the session caps.
- Open play: the host console now loads and stays current over 5-second polling when the live connection cannot open, not only over the WebSocket; snapshots older than the one on screen are ignored.
- Open play: the host key from a link is saved the moment the page opens, the address keeps its query string when the key is removed from it, and a wrong key in a link falls back to the key this phone already saved instead of forgetting it.
- Open play host console: "End session" asks for confirmation first; players waiting their turn are labelled "Waiting" rather than "Playing"; an empty court on an ended session says "Session ended"; a lost connection reads "Couldn't reach the server" instead of the browser's raw error. The create screen says how many players to remove above the 128 cap and will not start until they are.
- Every open play result now needs a score: the "Winner only" session option and the "Save winner only" button are gone, so every game counts in the points share. Results saved earlier without a score still show and count toward wins and losses.
- Open play's points share is the documented OPI formula — each game's points won ÷ points played, averaged so every game counts equally — rather than pooling all points, which let a long deuce game outweigh an 11–2.
- Open play standings break ties on win % by the **share of points won** (points scored ÷ points played, over games with a score) instead of the average point difference per game, then head-to-head, then name. A margin of +4 means far less in a game to 21 than to 11; a percentage stays comparable across game lengths and game counts. Both standings tables show it as "Pts won %", and the results CSV now has "Points won %", "Points for" and "Points against" columns instead of "+/- per game" and "Points per game".
- The open play host console's standings now show the score tiebreak column like the player board. It was hidden there, so players tied on win % looked ranked for no reason when the point difference per game was deciding the order. Court and player counts also read "1 court" instead of "1 courts".
- The open play QR code is a fixed square again. Inside a row beside text it could shrink, which squashed it sideways and could stop phones scanning it; it also has a slightly wider white margin now.
- The site logo falls back to the copy bundled with the site when the R2 copy cannot load. The fallback only listened for a failure that happened after the page script ran, so on networks whose DNS does not resolve `*.r2.dev` the image had already failed and the header showed a broken logo; the footer hid its logo instead of falling back.
- Open play: a rejected Turnstile check on session creation now logs its reason (`pickleball_open.turnstile_rejected`), so a "Verification failed" on a deployed environment can be traced to a hostname, action or token problem.
- Pickleball host sign-in: deleting the account also revokes the extra host links opened from My sessions for its sessions (sockets on them drop back to the player board); the original host link keeps working, and the delete confirmation says so.
- Pickleball DUPR export: the guide, landing page, sheet and API all state the same rule (every game with a valid score, no tie and a team reached 6, and four different DUPR IDs); the sheet lists players who share a DUPR ID with an edit field each; "Next export available tomorrow at HH:MM" when it falls on a later day; an unknown time zone on the export dates games in UTC instead of refusing it.
- Pickleball host sign-in: a Google `?error=` is only "cancelled" when the state matches this browser's sign-in (compared in constant time); a new sign-in deletes the login the browser had; the per-IP sign-in limit counts only the start; the start's fallback redirect is `no-store`.
- Pickleball host routes: PATCH me and the DUPR export cap the body by what was read and name the field that was wrong; account deletion refreshes at most 50 coordinators, after the response; the expired-login purge has its own cron task and log.
- Pickleball: a captain browser back from Google sees the sign-in notice, and `?signin=` leaves the address bar whenever the host console will not open; My sessions offers Retry when it cannot load and wraps long session names.

### Security
- **Open play: anyone holding the public QR code could lock the host out.** Host commands were limited to 120 per minute per session, counted before the host key was checked, so a stranger sending junk could use up the host's allowance. The session limit now counts only commands with a valid host key, and every host route also has its own per-address limit (600 per minute) checked first.

### Added
- Free sessions DUPR sheet: a browser that cannot keep the host link is told so instead of being sent to Google (and the board says "Signed in. Open your host link to continue." if it comes back anyway); with no exports left today it says when the next one is available (`nextExportAt` on `GET /api/pickleball/open/s/{code}/dupr`); a failed load can be retried.
- Free sessions: `/pickleball/my-sessions` lists a signed-in host's linked sessions and reopens one as host on any device. The host guide, landing page and FAQ describe the DUPR export and lost-link recovery; the copy guard now allows "DUPR" and "sign in" and bans claims of automatic DUPR submission or DUPR ratings.
- Free sessions host console: More → Email me the DUPR export walks the host through Google sign-in (the news box beside it unticked), linking the session, the DUPR Club ID, adding missing DUPR IDs and sending, then shows exports left today; the account panel has news opt-in, sign out and Delete my account. Coming back from Google reopens the sheet. The board and captain screens never show any of it.
- Free sessions: "Delete my account" (`DELETE /api/pickleball/open/host/me`) removes the host and every login and unlinks, but keeps, their sessions, which their coordinators forget at once; the daily cron also removes expired host logins.
- Free sessions: `POST /api/pickleball/open/s/{code}/dupr-export` emails the DUPR CSV to the linked host's verified Google address through Resend, as an attachment with a reply-to for upload problems; 5 per session in any 24 hours (a 429 with `Retry-After` after that), a send that fails or errors is not counted, and an unknown time zone is a 400. The Resend provider gains an optional sender name and attachments.
- Free sessions: whoever holds a session's host key can link it to their Google account, once (`POST /api/pickleball/open/s/{code}/claim`); the host's DUPR panel reads its status (`GET …/s/{code}/dupr`: claim, what would be exported, every left-out game and why, exports left today); a signed-in host lists their linked sessions (`GET /api/pickleball/open/host/sessions`) and reopens one from any device with a fresh host link that leaves the original working (`POST …/host/sessions/{code}/reopen`).
- Free sessions: Google sign-in for hosts (`GET /api/pickleball/open/host/sign-in`), reusing `oauth.js` (PKCE) and the already-registered `/api/pickleball/auth/google/callback`, which now hands host sign-ins to the new flow. Only verified Google emails are stored, the news opt-in ticked beside the button is applied when the account is created, and every outcome returns to the page the host started from with `?signin=…`.
- Free sessions: host login plumbing. The `devlab_pb_host` cookie holds an opaque token (only its hash is stored; HttpOnly, Secure, SameSite=Lax, scoped to `/api/pickleball/open`), every write that trusts it must come from this site, `GET`/`PATCH /api/pickleball/open/host/me` read and update the profile (DUPR Club ID, news opt-in), `POST …/host/sign-out` ends the login, and `POST …/host/test-login` stands in for Google when `PICKLEBALL_TEST_AUTH_ENABLED=true`.
- Open play and tournaments: the host can set or clear a player's DUPR ID (`SET_PLAYER_DUPR_ID`: 6 letters or digits, unique in the session, also after the session ends). Captains cannot.
- Free sessions: the DUPR club match-import CSV, pinned column for column to `tests/fixtures/dupr-import-template.csv` (doubles, game 1 only, the host's local date, no instruction rows). Games with no score, a tie, no team at 6 points, or a missing or shared DUPR ID are left out with a reason, and the export email lists them with the upload steps.
- Free sessions, Phase 4: migration `0019` adds `hosts` (Google-verified DUPR exporters; marketing opt-in off by default; never expires), `host_logins` (hashed login tokens), `open_sessions.host_id` (the claim, unlinked when an account is deleted), `open_host_keys` (extra host links) and `open_dupr_exports` (the 5-a-day log). Session rows still all cascade from `open_sessions`.
- The host guide and landing page describe tournaments (formats, pairing and seeding, the editable draft, substitutes, the live bracket), with a bracket illustration. The public-pages copy guard no longer bans "tournament" or "bracket".
- Free sessions can be tournaments: migration `0018_open_tournaments.sql` adds `open_tournaments`, `open_tournament_entrants` and `open_tournament_fixtures` (all cascade from `open_sessions`, so the 7-day purge covers them), and matches record the fixture they play.
- Tournament pairs can be drawn at random (an unbiased crypto shuffle), balanced by skill (strongest with weakest) or taken in list order, and seeded at random, by mean pair skill or in the host's order.
- Tournament draws are generated by the existing fixture generator (round robin, pools then a bracket, single and double elimination) as an editable draft; a draw too large for a session, or with too few pairs for its format, is refused with the reason.
- Tournament draft edits: swap players between pairs, swap two pairs, move a pair between pools, change who plays whom. Every edit is re-checked (no pair twice in a round, every pair meets each pool or round-robin opponent once, bracket shape unchanged) and refused with the reason; after Start only substitutions and opponent swaps between unstarted games in the same round are allowed.
- Open play: a TV board (`/pickleball/s/{code}/tv`) for a venue screen: every court (1–16) on one screen in large type with no scrolling, who is up next, the fairness numbers and the check-in QR, with standings and recent results taking turns. Opened from Share. Each court shows one player per line in type fitted to its card, and nothing on the screen is truncated, even 40-character names. It says when it is offline or the session has ended.
- Open play: court captains on the host console (More → Court captains): make a link per court, send it, turn it off; the captain's phone shows just that court with Start, Game over, undo and edit, and drops to the public board the moment the link is turned off.
- Open play API: court-captain links. The host creates a link per court (`POST …/captains`, secret shown once, only its hash stored) and can turn it off (`DELETE …/captains/{id}`), effective on the very next request or live update. A captain can start, edit or skip that court's proposal and save, undo or fix its results, nothing else; a second save names who saved first.
- Open play: QR self check-in. Players scan a check-in code and type their own name (optional skill 1–5 and DUPR ID, seen only by the host) and join level with whoever has played least; the same name twice is one player, and a name the host removed stays off the list. The host can turn it off from Share or at creation. Limited to 30 per 10 minutes per address and 60 per 5 minutes per session.
- Pickleball pages: the rotation page explains all four ways to pick the next game, each with a diagram and a two-round example computed by the real engine; the guide and landing page describe the modes, keep-together/keep-apart rules and the fairness panel.
- Open play host: choose how players are matched when creating a session (paddle stack, winners play winners, by standing, balanced teams, each explained in one line) and switch any time from the console; set keep-together/keep-apart rules; a fairness panel shows the games spread, longest wait and repeat partners; each player shows games, sit-outs and current wait, and skill can be set for balanced teams. The board shows the current mode.
- Open play board data: the public board and host console carry live fairness numbers (games spread, longest wait, repeat partners); the host sees why a court is waiting when the rules leave no fitting four. Nothing private is added to the public board.
- Open play API: the host can switch stacking mode mid-session (applies to the next game only), add and remove keep-together/keep-apart rules, turn self check-in on or off, and set a player's skill; sessions can be created in any of the four modes.
- Open play engine: "winners play winners" stacking: winners meet winners and losers meet losers, with the two pairs shuffled so last game's partners face each other; the sit-out guard and keep-together/apart still apply.
- Open play engine: "by standing" stacking: players close in today's standings play each other, 1st and 4th against 2nd and 3rd, without ever letting anyone sit out more than 2 rounds in a row.
- Open play engine: keep-together and keep-apart rules are hard constraints for every way of picking players; a court that no four can fill without breaking one waits with a reason instead of breaking it.
- Open play: migration `0017` adds court-captain links (`open_captains`, key hash only) and records who saved each result; settings gain self check-in and keep-together/keep-apart rules, and sessions stored before this load with defaults.
- Five new animated pickleball illustrations (rally, paddle stack, score tap, QR board, quiet court), CSS-only, stopped for reduced motion.
- /pickleball/new: start a free session in two steps (details, then paste or upload players), then save the host link and show the player QR.
- /pickleball/s/<code>: the live player board (courts, "you're up next", waiting order, standings, results), the host console for whoever holds the host link, and a friendly page once a session has been deleted.
- Pickleball neon (#c6ff2e) as a design token on the DevLab palette, an app shell for the open-play screens, and the client data layer (live connection with polling fallback, retrying command queue).
- Public API for free open play under /api/pickleball/open/: create (Turnstile, 10 per IP per day), board state, host commands with idempotency, results CSV, delete, and a live WebSocket.
- OpenSessionDO: one coordinator per open session that serializes commands, writes only changed rows, and pushes live updates to every connected screen.
- Public board snapshot built from an allowlist (no skill or DUPR data), a host snapshot, and a results CSV that defuses formula-like names.
- The open play command set: add players, breaks, courts on/off, edit or skip a proposed game, start, save, undo (2 minutes), edit and abandon a result, and end the session.
- D1 repository for open sessions: transactional create, diff-only writes, idempotency records, expiry-aware load and purge.
- Paste-a-list and CSV roster parsing that cleans numbering, emoji and duplicates from lists copied out of chat apps.
- Score rules for once-per-game results: games to 11, 15 or 21, accepting both sudden-death (11–10) and win-by-2 (12–10) endings. Also unambiguous 10-character session codes.
- Session standings ranked by win rate, then point difference per game, then points per game, then head-to-head.
- Paddle-stack rotation for open play: fewest games first, longest wait next, forced in after two rounds out, partners split to avoid repeats.
- D1 migration 0016 adds the open_* tables for free, no-login open play sessions. Every table cascades from open_sessions so a single delete removes a session.
- The daily cron deletes open sessions 7 days after their last change and closes any screens still watching them.
- Host console for open play: a responsive courts grid, one-tap "Game over" with a score pad that fills the winning score, 2-minute undo, edit or skip a proposed game, late arrivals, breaks, result edits, CSV download, end and delete.
- **End-to-end coverage for the screens that only exist once there is mail.** Everything the mailbox suite tested before could run against an empty mailbox — authorization, navigation, highlighting, empty states — which left four shipped features with no end-to-end coverage at all. New tests exercise retrying a failed reply and its refusal to offer a second retry, remote images held back until asked for and the sanitizer keeping the sender's layout while dropping their script, a DMARC report rendered from a real zipped fixture reporting a forged source, and attaching a file to a reply through the real upload endpoint. `scripts/mailbox/apply-e2e-fixtures.mjs` loads the same synthetic mail preview uses, so the fixtures cannot drift from it.
- Open play engine: "balanced teams" stacking splits each four so summed skill is as even as possible (entered skill, else today's win rate, else neutral), with repeated partners breaking ties. All four modes share one set of names and one-line explanations.
- Tournament results fill later rounds through the existing bracket advancement (pools feed the bracket once complete; double elimination drops a first loss to the losers bracket). Undoing or changing a result that a started game depends on is refused, naming that game. Pair standings per pool and overall: wins, losses, point difference, head-to-head.
- Tournament commands (generate, edit the draft, start, substitute, swap opponents) go through the same command endpoint, Durable Object and idempotency as open play. Whichever court frees next gets the next playable game of the draw; a pair with a player on a break waits and the court says so. Open-play-only commands are refused in a tournament.
- The live board, captain and host snapshots carry an allowlisted tournament view: pairs, the draw with what each empty slot waits for, pool and overall pair standings, the champion, and the game on each court. Results CSV for a tournament lists every game with its stage and the pair standings.
- Creating a session offers Open play or Tournament. A tournament console sets up the draw (format, pairs, seeding), then edits the draft by tap-to-select (players, seeds, pools, opponents) with the server's reason shown for any refused edit, and starts it. Once drawn, the setup folds to a one-line summary and the host lands on the draft; Start switches a phone to the Courts tab. A refused edit stays in view in a sticky banner. Games in numbered rounds read "Round 1 · Game 2" ("Pool A · Round 1 · Game 2"); elimination rounds keep "Semi-final 2".
- Running a tournament: substitute a player in a pair that is off court, swap opponents between unstarted games of the same round by tap-to-select, and a short celebration for the champions (none under reduced motion). A substitute the server refuses keeps its reason in the sheet, pairs on court cannot be picked, and players on a break are offered first.
- The public board and TV for a tournament: the game each court is playing, what is coming up, the draw (pools side by side, then the bracket), pair standings, a player's own next game (or that they wait for the pools or other results; "done" only once their pair is out or the tournament is over), and the champions, which replace the idle courts. The TV hides the open-play fairness panel in a tournament, says when the draw is still coming or may change, and shows the champions once with "Session ended" under them after the session ends.

### Changed
- Docs: architecture and runbook cover Phase 3 tournaments (kind, migration 0018, the engine around the reused fixture modules, phases, snapshots).
- Docs: architecture and runbook cover Phase 2 open play (stacking modes, pair rules, captain links, self check-in, TV board, migration 0017).
- Open play rate limits are sized for a whole club on one Wi-Fi address: live connections 300 per minute per IP (was 30) and public board reads 1,200 per minute per IP (was 60), so the 5-second polling fallback no longer locks a club out. Host and captain routes allow 600 per minute per IP (was 120), so a host and several court captains polling from one club Wi-Fi are not refused.
- The Playwright worker server now applies the pickleball D1 migrations locally (`wrangler d1 migrations apply devlab-pickleball --local`) before starting, so the open-play e2e tests run against the current schema.
- Pickleball runbook: a SQL force-delete leaves the session's Durable Object serving its cached copy until it hibernates or is evicted, expired rows can sit in D1 for up to about a day until the purge (already hidden), and what a 429 on host commands means.
- Open play retention wording now says what the code does: a session is deleted from the live service 7 days after the last change to it (any change resets the clock), not 7 days after the last game. The privacy policy gains a short open-play section: no accounts, names shown on a public board, deletion after 7 days with backups kept up to 30, and delete any time.
- The pickleball pages are rewritten around free, no-sign-up open play: a new landing page with animated art and FAQ, a step-by-step host guide, and a new "How fair rotation works" page whose example is computed by the app's own rotation engine. The old operator sign-in link is gone from the landing page.

## [1.13.0] - 2026-09-23

### Added
- **Preview has mail to look at, so the mail client can be reviewed before it reaches production.** Preview already mirrored production for every other screen — 19 projects, 15 articles, 8 pages — but `mailbox_messages` was empty, which is why every mailbox change over the last few days had to be checked in production. `npm run cms:seed:mailbox-preview` generates synthetic mail covering the states a one-message inbox never produces: a plain enquiry, a branded HTML message with inline and remote images plus an attachment, a two-message thread with a sent reply, a queued reply, a failed reply with its error and Retry button, a hard bounce, and a DMARC report. Every address is in an RFC 2606 reserved domain so no fixture can reach a real person.
- **The mailbox tables are now on the mirror's forbidden list.** `mirror-production-to-preview.mjs` already refused to copy leads because they are "real people's names, emails, and the messages they sent". Correspondence is the same category and was never excluded only because it did not exist when that list was written. The script's existing leak check now enforces it.
- **DMARC aggregate reports are read, not just stored.** The folder collected compressed XML that nobody was going to unzip, which meant it accumulated evidence nothing acted on — the first report had to be pulled out of R2 and decompressed by hand to learn anything from it. Reports now render in place: who reported, the window covered, the policy the receiver actually applied (which is not always the one we think we published), and a row per source IP with its message count and DKIM/SPF alignment. Anything failing is stated first and in full, because that is the only case that asks for action; the usual "our own server, all passed" is kept quiet.
- Parsed in the browser rather than at ingest. Storing a parsed summary is the better shape once anyone wants trends across weeks, but it needs a migration and would leave every report already in the folder unreadable until something reprocessed it. `DecompressionStream` exists in browsers exactly as in Workers, so the same parser runs unchanged and every stored report became readable at once. No XML library and no `DOMParser`: DMARC's schema is small and fixed by RFC 7489, and a general parser is a large dependency and a large attack surface for input a stranger sends us.

## [1.12.1] - 2026-09-23

### Fixed
- **The admin CMS shows the DevLab icon in the browser tab instead of the browser's generic globe.** `/admin` builds its own document rather than using `Layout.astro`, and was the only page on the site with no `rel="icon"` at all — every public page and all four pickleball standalone pages already had one. The same two links are now in its head, pointing at the same file.
- **`/favicon.ico` exists.** It answered 404, and browsers request that path on their own whenever the icon link is missing or not yet parsed — as do bookmark managers, feed readers and link unfurlers that never run the page. `scripts/generate-app-icons.mjs` now emits a genuine multi-size ICO (16/32/48) alongside the PNGs. Genuine rather than a renamed PNG because `public/_headers` sets `X-Content-Type-Options: nosniff` on every route: the file would be served as `image/vnd.microsoft.icon` from its extension and the browser would be forbidden from correcting that by inspecting the bytes.

## [1.12.0] - 2026-09-22

### Added
- **A message on the way out can carry attachments.** Compose and reply now take files, up to 10 MB in total across at most 10 of them — 10 MB because that is Postfix's default `message_size_limit`, so nothing is accepted in the UI that the MTA will then refuse. Files upload as they are chosen rather than on Send, so a slow upload is a progress bar instead of a hang, and an upload lives unclaimed (`outbound_id IS NULL`) until the message that will carry it exists. Claiming is one UPDATE guarded by that null, so a double-submit cannot attach the same bytes to two messages. Requires migration `0016_mailbox_outbound_attachments.sql`.
- **The outbox JSON now describes the attachments and withholds the fallback when there are any.** `renderOutbound` emits `multipart/mixed` with base64 parts, and n8n needs no change at all — the contract was already `raw` plus `envelope`, so `raw` simply becomes multipart. The `fallback` object is `null` once a message has attachments, because that shape cannot express a file and a transmitter using it would send the covering note while silently dropping the document it refers to. A file missing from R2 fails the whole send rather than quietly omitting a part.

## [1.11.1] - 2026-09-22

### Fixed
- **An outgoing reply is dated when it is sent, not when it was written.** `renderOutbound` took the `Date:` header from the row's `created_at`, which is usually within minutes of transmission and so went unnoticed. A reply that waits in the queue — or fails and is later retried — went out claiming a time hours in the past. The first real send did exactly that: written 13:05 on the 21st, transmitted 05:16 on the 22nd, delivered stamped 16 hours stale. Receivers read a Date far behind the `Received:` chain as a replayed or forged message, and it is one of several reasons that message landed in spam despite SPF, DKIM and DMARC all passing under strict alignment.

## [1.11.0] - 2026-09-22

### Added
- **A failed reply can be retried, by a person.** The outbox has always refused to retry on its own — a submission that reported failure may still have reached a mail server, so re-queueing risks a second copy landing on a stranger — but that left a failed reply with nowhere to go. The Failed folder now offers `Retry this reply`, behind a confirmation, which is the only path back to `queued`. A `collected` row is still refused with a 409, because that is the genuinely ambiguous state. The previous error is kept on the row and shown while the reply waits again, so retrying does not erase the record of what went wrong.
- **Inbound mail renders with the sender's own formatting.** The sanitizer previously dropped every `style` attribute and every image, so a company-branded email arrived as an unstyled column — which for prospecting correspondence loses real information about what the sender emphasised. Inline `style` is now allowed through a property allowlist (`src/mailbox/inbound/sanitizeStyle.js`), as are the legacy `align`/`valign`/`bgcolor`/`width`/`height` attributes that templated mail lays itself out with. `position`, `z-index`, `transform`, `display:none`, `visibility:hidden`, `opacity:0` and `font-size:0` stay refused: they let the rendered message differ from the message actually sent. A value containing `url()`, a CSS escape, a comment or any function other than `rgb`/`rgba`/`hsl`/`hsla` fails the whole attribute rather than being decoded.
- **Inline images render; remote images do not, until asked.** The sanitizer never emits a `src` at all — a `cid:` reference becomes `data-cid` and a remote URL becomes `data-remote-src`, both inert. Inline images resolve against the message's own attachments in R2 and are fetched by the parent as `data:` URLs, because the admin session cookie is `SameSite=Strict` and a request issued from inside a `sandbox=""` iframe carries no session. So a sender's logo renders with no third-party request and no read receipt. Remote images stay held back behind a per-message, never-remembered "Load remote images" button, which relaxes only `img-src` and leaves `default-src 'none'` in place so CSS `url()`, `@import`, fonts and frames stay dead either way.

- **The mailbox is a three-pane mail client**: folder rail, message list and reading pane, with a header carrying the address, search and Compose. Responsive rather than shrunk — on a phone the rail becomes a drawer and the list and reading pane take turns. Compose starts a new conversation; Cc, Bcc and outbound attachments are deliberately absent because `mailbox_outbound` has no columns for them and a field that is accepted then dropped is worse than one that is not offered.
- **Outreach now emits a complete RFC 5322 message and an explicit envelope**, the same mechanism mailbox replies use, so outreach bounces can be matched by the VERP return path and by our own `Message-ID` rather than only by the recipient address a stranger asserts. `integrations/n8n/devlab-lead-outreach.json` submits it through the private Postfix path instead of an SMTP/Gmail node.

### Fixed
- **A failed outreach draft is retained with its error, and never silently re-queued.** `recordTransmissionFailure` writes the error onto the draft while leaving its status `exported`, so `collectOutbox` will not offer it again — a transmission that reported failure may still have reached an MTA, and re-offering it would mail a stranger twice. Retrying stays a human decision.
- **A transmission failure is no longer reported as a hard bounce.** The outreach workflow routed *any* error from its send node to `/bounced` with `kind: hard`, which suppresses the address permanently and moves the lead to `NO_CONTACT`. But those errors are almost all ours — `nodemailer` not importable, Postfix down, the CMS unreachable — and none says anything about the recipient. A missing npm module would have quietly destroyed prospects, and the more broken the infrastructure the more of them. New `POST /api/lead-engine/outbox/{draftId}/failed` records the failure under its own `OUTBOUND_SEND_FAILED` event and suppresses nothing; `/bounced` stays for real SMTP rejections and asynchronous DSNs.
- **Only one mailbox folder is highlighted at a time.** Machine mail was reached as `/mailbox/inbox?mailbox=bounce`, and react-router's `NavLink` derives active state from the pathname alone — so Inbox matched and Bounces matched the same pathname, and both rendered selected. Bounces and DMARC now have first-class routes, and every rail entry takes its highlight from one resolver instead of deciding for itself. Old query URLs still resolve to the same section.
- **Diagnostics stays inside the mail client** rather than replacing it, so the folder rail never unmounts and returning to the Inbox is one click.
- **Mailbox folder navigation no longer reloads the page.** The rail used plain anchors, and the admin is a single `client:only` React island — so every folder click was a full document navigation that re-downloaded and re-hydrated the island, re-ran the session check and rebuilt the router. It now uses react-router links, so the CMS shell, the mail client and the rail stay mounted while URLs, history and back/forward keep working.
- **The global sidebar no longer duplicates the mailbox folders.** It has one Mailbox entry; the folders belong to the mail client, where they behave consistently.

### Added (continued)
- **The mailbox reads as a mail client: Inbox, Drafts, Outbox, Sent, Failed and Archive.** Replies to leads are answered here alongside everything else, so the folders are the ones people already know. **Outbox and Sent are deliberately separate** — the thing that transmits mail is a separate system that may not have run, so a reply sits in Outbox until it confirms and only then moves to Sent; collapsing them would say a prospect had been answered when nothing had left. A draft can be edited and sent or discarded; once queued it can be neither, because editing then would change what the CMS shows without changing what went on the wire.
- **Migration `0015_mailbox_drafts.sql`** widens `mailbox_outbound.status` to admit `draft`. Drafts are invisible to the sender by construction rather than by a filter: `collectQueued` selects `WHERE status = 'queued'`.
- **A production mailbox for `hello@devlabconnect.com`, inside the Admin CMS.** Mail arrives through Cloudflare Email Routing into an `email()` handler in the existing Worker and is stored in D1 and a private R2 bucket; an operator reads and answers it at `/admin/mailbox`. Inbox, thread view, read/unread, archive, attachments, search, reply and a diagnostics screen. Replies go out as `hello@devlabconnect.com` through the existing n8n → private Postfix path — there is still no SMTP client in this codebase, and the Email Worker cannot originate arbitrary mail.
- **Inbound mail is never silently discarded.** A message too large to parse, one whose MIME is malformed, or one that arrives while R2 is unavailable each produce a stored row saying so, with the original preserved where possible and listed on the diagnostics screen.
- **Bounce and DSN ingestion, wired into the existing CRM.** A delivery report resolves to a draft by one of three routes — a VERP tag, our own `Message-ID` echoed in the report's returned headers, or the failed recipient address — and is handed to the lead engine's existing `recordBounce`. Null-sender (`MAIL FROM:<>`) reports are handled, which is what every real bounce arrives as.
- **Migration `0014_mailbox.sql`** adds `mailbox_threads`, `mailbox_messages`, `mailbox_attachments` and `mailbox_outbound`. Additive only; nothing existing changes shape.
- **Mailbox outbox endpoints** (`/api/mailbox/outbox`, `.../sent`, `.../failed`) for the external sender, behind a bearer token that fails closed when unconfigured, plus `integrations/n8n/devlab-mailbox-outbound.json`.
- **Outreach outbox endpoints and an n8n sending workflow** (`/api/lead-engine/outbox`, `.../sent`, `.../bounced`). Automated sending now exists in the operator's stack; it still does not exist in this application.

### Changed
- **Approved outreach drafts are exported as `.eml` files** instead of being written into a Zoho mailbox. The mailbox integration was removed: a Worker has no stable egress IP, so its scheduled calls arrived from a different country each run and the provider read that as a compromised account.
- **Outreach sends over our own MTA rather than an ESP free tier.** Fifteen providers were checked and every one prohibits cold outreach in its acceptable-use policy — on the consent model, not on volume.
- **Only a bounce identifier we issued may suppress an address.** A delivery report cannot be authenticated, so a report matched solely by the recipient address it names is now recorded without suppressing. This closes an unauthenticated remote path by which any sender could permanently suppress an arbitrary prospect; it also means outreach bounces no longer auto-suppress until the outreach path emits our `Message-ID` and VERP address.
- **`outreach.sending.maxPerCollection` is configurable**, so raising the daily limit is no longer silently capped at ten per collection call.

### Fixed
- **JSON-LD blocks larger than 20,000 characters are read** during lead research rather than truncated.

### Security
- **Inbound email HTML is sanitized by an allowlist at ingest and rendered in a sandboxed iframe** with no `allow-scripts` and no `allow-same-origin`. Every remote reference is stripped, so nothing in a rendered message causes a request — which also means a tracking pixel cannot report that a message was opened.
- **Attachment storage keys are generated, never derived from a filename**, and downloads re-derive their content type through an allowlist rather than trusting the stored object.

## [1.10.2] - 2026-09-18

### Fixed
- **Simplified Lead CRM source controls.** Sources now expose one task-oriented availability control instead of separate Enabled, Automation, and unused Crawl checkboxes. Manual import is clearly distinguished from automated API discovery, while website research remains governed by the Crawler switch in CRM Settings.

## [1.10.1] - 2026-09-18

### Fixed
- **CRM switches are fully operable from the UI.** Fresh environments now start with every D1 operational switch off while deployment ceilings permit all controls, so admins can enable capabilities without a configuration commit; Worker vars remain an independent emergency stop.

## [1.10.0] - 2026-09-18

### Added
- **UI-managed Lead CRM operational switches.** Administrators can turn permitted engine capabilities on or off immediately from CRM Settings. Changes are validated and audited, deployment Worker vars remain hard safety ceilings, and a settings-store failure turns every capability off.

### Fixed
- **Facebook footer icon.** Facebook social links now render a recognizable Facebook glyph instead of falling back to the email envelope.
- **Admin navigation state and density.** Exact route matching prevents the Lead CRM Dashboard and the selected child screen from appearing active together. Sidebar sections can now be expanded or collapsed, the current section opens automatically, and desktop users can persist an icon-only compact mode so the growing CMS navigation no longer dominates the workspace.

## [1.9.0] - 2026-09-18

### Fixed
- **Content-safeguard failures now block Zoho export.** AI drafts that contain a forbidden claim, unsupported observation, or unapproved link remain visible verbatim for human review, but the UI shows every violation and both the UI and service refuse Zoho draft creation until a person edits and saves the text.
- **Corrected AI retries have clean audit status.** When Workers AI returns an invalid first answer and a schema-valid retry, the successful run now keeps its two-attempt count and accumulated usage without retaining the rejected attempt's error text beside an `ok` status.
- **Lead-engine intake and preview controls.** Manual imports now fail closed unless their registered source is enabled and policy-approved, always retain source provenance, and report queued research accurately. The dashboard treats approved manual import as a valid intake path instead of falsely blocking on optional automated discovery; disabled discovery controls explain why they cannot run; advertised dry runs can inspect draft campaigns without enqueueing research; and research signal source links no longer visually run into extracted values.
- **Cloudflare compatibility date refreshed.** The Worker now targets `2026-08-06`, the newest date supported by the repository's pinned local Workers runtime, while retaining `nodejs_compat` and avoiding stale-runtime drift before the lead engine release.

### Added
- **Preview draft-only Zoho handoff enabled.** The isolated preview Worker now allows a reviewed, safeguard-clean outreach draft to be created in Zoho on an operator's explicit click. Mailbox synchronization remains disabled, production remains fully inert, and the Zoho client still exposes no send capability.
- **Preview AI review enabled.** The isolated preview Worker now permits Workers AI opportunity review after deterministic rules qualify a manually imported, researched lead. Automated discovery, browser rendering, tracking, Zoho mailbox sync, schedules, and all production lead-engine capabilities remain disabled.
- **Preview manual research enabled.** The preview Worker now permits website research only when an operator explicitly drains a queued job. This supports a controlled end-to-end test of a manually imported domain while automated discovery, browser rendering, tracking, Zoho mailbox sync, campaign schedules, and every production lead-engine capability remain disabled.
- **Manual lead import controls.** Campaign cards now expose the existing policy-gated manual-import endpoint through a domain/URL list or CSV form, report created, duplicate, and rejected rows, and clearly distinguish manual import from automated discovery. Imports create lead records while crawling, AI, Zoho drafting, synchronization, and sending remain independently controlled.
- **Preview lead-engine shell enabled.** The preview Worker enables the Lead Intelligence Engine shell so its seeded dashboard, settings, sources, campaigns, manual-import workflow, and explicitly triggered research can be exercised against isolated preview data. Automated discovery, browser rendering, tracking, Zoho mailbox sync, and campaign schedules remain disabled.
- **Lead-engine deployment readiness reporting.** The CRM dashboard now checks required bindings, Zoho credentials, business identity, approved discovery sources, and optional provider configuration before an operator starts a run. Missing required configuration is blocking and an optional feature is warned about only when its flag is enabled. Keyless discovery support remains policy-gated; public Nominatim is explicitly excluded because its usage policy forbids systematic POI discovery.
- **Business-first repositioning.** The public site now presents DevLab Studios as a software and automation studio rather than a portfolio. The homepage follows a business conversion order — outcome hero, the operational problems addressed, four solution categories, verified project proof, delivery approach, reliability principles, insight and lead magnet, founder credibility, FAQ, final inquiry CTA — and no longer asks visitors to classify themselves. Navigation is Home · Solutions · Work · Insights · About · Profile with one header CTA ("Discuss Your System"); the Profile item stays labelled "Profile", never "Hire Me".
- **Structured inquiry pipeline.** `POST /api/inquiries` is a single public endpoint for every inquiry type (business system, software project, workflow audit, employment, contract collaboration, partnership, general). `/api/lead-magnet` and the legacy `/api/contact` normalize into the same shape and run the same service (`src/worker/inquiryService.js`), so the persist-before-deliver guarantee is implemented once rather than per form. See [ADR 0007](docs/architecture/decisions/0007-business-inquiry-pipeline.md).
- **Attribution, consent, activity, and explainable qualification.** Every inquiry now stores where it came from (entry/source page, referrer, first- and latest-touch, UTMs, form/offer/solution/case-study/insight ids, and a random first-party anonymous id), what the visitor consented to *by version*, an append-only operational timeline, and a deterministic qualification result together with the reasons that produced it. Qualification is a pure, tested function — AI decides nothing about routing.
- **Migration `0009_business_inquiry_platform.sql`.** Additive only: `leads` gains typed inquiry, business-qualification, employment, qualification, ownership and idempotency columns; `delivery_attempts` gains failure classification and retry scheduling; `lead_attribution`, `lead_consents` and `lead_activities` are new. Every pre-existing lead survives untouched and backfills to sensible defaults — validated against a real SQLite database with rows written in the pre-migration shape. **Apply to both D1 databases.**
- **Operational inbox at `/admin/leads` ("Inquiries").** Filter by inquiry type, pipeline status, qualification, delivery state and free-text search; change status; assign an owner; add internal notes; read qualification reasons, attribution, consent and activity; retry an eligible failed delivery; soft archive; and export CSV. Every route sits behind the existing blanket `/api/admin/*` gate.
- **Two-step business inquiry form and a separate employment form.** CTA context preselects the inquiry type via `?type=`, so a visitor arriving from a solution page never classifies themselves twice. Recruiters and hiring managers reach a short employment form from the Founder Profile and never see budget, timeline, or desired-outcome questions.
- **Lead magnet.** `/offers/[slug]` landing pages with minimal email capture, backed by a server-owned offer registry (`src/config/offers.js`) — a form posts only an `offerId`, so a submission can never choose what URL gets emailed. The resource itself stays publicly readable in Insights; nothing is gated.
- **Optional outbound delivery provider.** `LEAD_WEBHOOK_URL` (plus optional `LEAD_WEBHOOK_SECRET`) posts each persisted inquiry to a CRM, sheet, n8n/Make workflow, or task system. Completely inert unless configured — the repository takes on no third-party CRM dependency.
- **Analytics event model** (`src/lib/analytics.ts`) covering CTA clicks, solution/case-study/insight views, form starts and step completion, validation errors, submissions, persistence, failures, résumé downloads and outbound contact clicks. A conversion (`inquiry_persisted`) is reported **only** after the server confirms the database write, never on the click. No name, email, phone, company or message can be sent — the event shape has no field for them.
- **New page blocks** `problemList` and `leadMagnet`, plus routing context on `cta` (`inquiryType`, `formId`, `offerId`, `solutionId`), all editable through the existing schema-driven admin.
- **Admin password change from `/admin`.** A Security panel takes current + new + confirm and writes the new credential to D1. A Worker cannot rewrite its own secrets at runtime, so self-service rotation necessarily moves the credential into storage the Worker can write; `ADMIN_PASSWORD_HASH` stays as a permanent bootstrap, so an empty table, a failed write, an unmigrated database or an unreachable D1 all fall back to it and cannot lock anyone out. Changing the password sets `password_changed_at`, and `requireAdmin` rejects any session token issued before it — so if the password is rotated *because* it leaked, the session an attacker already holds dies at that moment instead of surviving its remaining 8 hours. The browser performing the change is re-issued a fresh cookie so succeeding does not sign you out. Rate limited on its own bucket and audit-logged (never the password or the hash). Migration `0010_admin_credentials.sql`, ships empty.
- **`npm run cms:mirror-preview`**, a one-way production→preview content copy so preview can be used to visually verify against real content. Copies 19 content tables; never copies leads, delivery history, attribution, consent, activity, audit log, sessions, media metadata or `d1_migrations`. The generated dump is re-checked against an independent denylist and credential patterns before anything is applied.
- **Generated `sitemap.xml`** (`src/pages/sitemap.xml.ts`) listing canonical routes plus published articles and offers.
- A show/hide toggle on the admin sign-in password field. It toggles the existing input's `type` rather than swapping in a second field, so the browser's saved credential, autofill, and the form's `required` validation all keep working; the control carries `aria-pressed` and a label naming the action rather than the state.
- **AI & Automation Daily** at `/insights/daily` — a generated daily log of AI automation and AI advancement stories, up to 10 a day, each a title, a link to the publisher, and a one-sentence summary written from that publisher's own headline and excerpt. One permanent page with dated sections and `#YYYY-MM-DD` anchors, deliberately not one indexable page per day. Editions older than seven days are removed automatically. A preview of the latest edition appears on `/insights`. See [ADR 0008](docs/architecture/decisions/0008-insights-daily-digest.md).
- **A daily cron in this Worker.** `src/worker.ts` now exports `scheduled()` alongside `fetch` — possible because ADR 0006 already replaced the adapter's generated entrypoint. Production runs at 06:00 UTC, preview at 06:30 UTC; both are declared in `wrangler.jsonc`, since nothing at the top level is inherited by an environment. Summaries are written by Workers AI (`@cf/meta/llama-3.1-8b-instruct`) through a new `AI` binding.
- **Migration `0011_insights_digest.sql`** — new `digests` and `digest_items` tables, deliberately separate from `articles` so the retention sweep's dated `DELETE` can never reach real editorial content. **Apply to both D1 databases.**
- Two defects in the digest pipeline, both found by running it against the live feeds before shipping and both now covered by regression tests: a 256KB response cap truncated Cloudflare's ~350KB feed, and since a truncated XML document parses as nothing, that feed reported success while contributing zero items (Hugging Face's, at ~254KB, was one commit from the same fate); and the deduplication window included the day being generated, so a second run on the same day replaced a full edition with whatever was left over. Oversized bodies are now skipped and logged rather than truncated, and a run excludes its own date from the window.
- **Daily Digests admin at `/admin/digests`** — unpublish a day, delete a day, or run the job on demand. "Generate now" is rate limited to 4 per hour per IP, because each run makes four outbound fetches and up to ten AI calls against a daily allocation.
- **DevLab Lead Intelligence Engine — a Lead CRM inside the existing Admin CMS.** Discovers potential businesses, researches their public websites, extracts deterministic signals, scores them without AI, sends only sufficiently qualified prospects to Workers AI, finds publicly published business contacts with their provenance, prepares a personalized outreach draft, and — on a human's instruction — saves that draft into Zoho. **The application has no send capability at all.** `src/lead-engine/zoho/client.js` contains no send function, `createDraft` hard-codes `mode: 'draft'` as a literal rather than a parameter, and `assertNoSendMode` refuses any payload that would transmit; a test asserts the module exports nothing send-shaped. A lead becomes CONTACTED only when the Sent-folder sync observes that Stephen actually sent the message himself. There is deliberately no auto-send feature flag, because a flag would imply a switch exists.
- **Migration `0012_lead_intelligence_engine.sql`** — 22 new `lead_*` tables in the existing CMS database rather than a new one, because contact-form attribution has to join the site's own `leads` table (people who asked to be contacted) against `lead_leads` (businesses the engine found), and D1 cannot join across databases. Nothing touches an existing table. Idempotency is enforced in the schema, not in application code: a company appears at most once per campaign, a provider message imports at most once, an outstanding job dedupes on a partial unique index, and one active suppression entry exists per value. Verified against real SQLite — 78 statements, constraints exercised. **Apply to both D1 databases.**
- **Lead CRM admin section** at `/admin/lead-crm` — Dashboard, Campaigns, Leads, Review Queue, Replies, Conversations, Activity, Sources, Suppression and CRM Settings. Mounted inside the existing admin shell: same router, same blanket `/api/admin/*` auth gate, same API client, same design idioms. Kept separate from "Inquiries" in the navigation because that holds people who contacted us and this holds businesses we found, and conflating them in the nav is the first step to conflating them in someone's head.
- **A safe research crawler.** Four pages per site, chosen by link priority rather than breadth-first. Honours `robots.txt` and fails closed on a 5xx or an unreachable file. SSRF guards cover private ranges, cloud metadata, IPv4-mapped IPv6 and — the case people forget — every redirect hop, which is the one an attacker controls at request time. A transparent user agent points at a new public `/crawler` page explaining what it does, what it does not, and how to block it. It does not authenticate, bypass CAPTCHAs or bot protection, rotate addresses, or retry past a block.
- **Deterministic qualification.** Four scoring categories with centrally configured weights and a reason row per point, so "why was this lead qualified" is answerable six months later. Workers AI never invents the score; it is gated behind the rules and only sees a compact structured payload — full page HTML never leaves the Worker. Four version-controlled prompts, zod validation of every model answer, and a content guard that rejects invented prices, metrics, past clients, internal-process claims and links.
- **Compliance as operational safeguards, provenance and auditability — explicitly not a legal-decision engine.** US and PH profiles, a conservative human-review fallback for unconfigured markets, and contact provenance as an admission requirement: there is no code path that constructs an address from a name pattern, and no `inferred` value for one to be stored under. MX presence is recorded but never described as mailbox verification. Opt-out detection is deterministic, runs before any AI, and cannot be reversed by a model.
- **Execution without new Cloudflare bindings.** Work is dispatched through a `lead_jobs` ledger in D1 and drained on the existing cron, so the engine runs correctly with no Queues or Workflows configured. Real Workflow classes and a real queue consumer call the same handlers when those bindings are added; both blocks ship commented out in `wrangler.jsonc` with their activation steps, because a binding naming a queue or Workflow that does not exist fails `wrangler deploy` for the whole Worker — public site included.
- **Everything ships off.** Nine feature flags, all `"false"` in both environments, with a test asserting it. Discovery Campaign 001 (US Property Management — Dry Run) is seeded as a draft with its schedule disarmed; its sources are registered but disabled and policy-unreviewed; `business.identity` is seeded empty so the US profile holds every lead until a human fills in the postal address. Deploying this branch changes nothing observable.
- **First-party tracking only.** `/r/:token` with cryptographically random opaque tokens and an allow-list re-checked at redirect time, so an open redirect needs a database write *and* a code change. No tracking pixel exists anywhere — an email open is not recorded.
- **497 new unit tests** (1078 repo-wide), plus 12 end-to-end checks, none touching a live external API. Two of them found real defects during development: the schema advertised a `contact_discovery` job type no handler served, which would have dead-lettered as "no handler" and silently lost work; and a shared module-level regex was skipping matches after the first page because `matchAll` copies `lastIndex`.
- **`docs/lead-engine/`** — architecture, data model, pipeline, discovery, crawler, scoring, Workers AI, contacts, compliance, Zoho integration, conversations, Workflows, Queues, operations, environment, testing, deployment, the dry-run procedure and disaster recovery.

- **Content migration `scripts/cms/updates/2026-09-17-business-first-content.sql`** — targeted and idempotent, and it snapshots the previous Home composition into `content_versions` before replacing it, so the prior state is recoverable from the database itself.

### Changed
- **The Solutions page is now at `/solutions`.** Every visible surface already said "Solutions" while the route said `/services`, and the CMS SEO record carried a canonical pointing at `/solutions` — a URL that returned 404. `/services` now returns a permanent 301, declared in `src/middleware.ts` rather than the CMS redirects table so it cannot be deleted from an admin screen or depend on the destination 404ing first. Internal content-type keys (`faqs.page_slug`, the Service Catalog content type) deliberately did not move. See [ADR 0009](docs/architecture/decisions/0009-solutions-route-rename.md).
- **Insights is restructured around three named topics** — Guides, AI Updates, Operational Notes — with fifteen articles, one featured, and filter chips driven by the taxonomy instead of by whatever strings happened to be stored. The "Latest From the Feed" framing is gone; the grid is the full library. Each card carries a short summary and links to the full article.
- **Reading time is derived from the article body** rather than typed by hand. The stored values had drifted into fiction: a 300-word post carrying "5 min read".
- **The daily digest runs at 22:00 UTC** (06:00 in Manila, where this is operated) instead of 06:00 UTC, which was 2pm local. Preview runs at 22:30 UTC.
- The Founder Profile is strengthened, not reduced: it keeps name, role, summary, education, certifications, experience, tools, selected projects, résumé, GitHub and LinkedIn, and gains a capability summary, an availability section, and its own three CTAs (View Selected Work / Download Résumé / Contact Stephen). Employment messaging now lives here rather than in business-service sections or the homepage hero.
- Solutions presentation consolidates the service catalogue into four business categories (`src/data/solutionsContent.js`) **without deleting anything** — the CMS `service_groups` records still own the detailed capabilities and their project relationships, and a group no category claims still renders under "Also delivered".
- The Solutions label was introduced while the route stayed `/services`; the route was renamed to `/solutions` later in this same unreleased batch (see above), so the two entries describe one journey rather than a reversal.
- Work write-ups are framed as business proof — the problem, the system designed for it, and what it verifiably does in operation — and the page states its evidence standard openly instead of showing invented metrics. No client names, revenue figures, or percentage improvements are claimed anywhere.
- SEO metadata now separates business intent (business pages) from individual capability intent (Founder Profile), so the two stop competing for the same query. Structured data adds Service, Article, BreadcrumbList and FAQPage (only where the questions are actually rendered); deliberately no LocalBusiness, since the studio is remote.
- `leads.status` keeps its original meaning (delivery state) and human workflow state moved to a new `pipeline_status` column. They answer genuinely different questions, and widening the existing CHECK constraint would have meant rebuilding a table holding real submitted leads.
- Delivery is now multi-target (internal notification, visitor confirmation, optional webhook) behind a provider boundary, with bounded timeouts, bounded in-invocation retry, and failures classified `transient` / `permanent` / `configuration` — which is what makes the admin's Retry button meaningful rather than a coin flip.

### Fixed
- **The digest was paying for AI summaries and discarding them.** The configured model answers in the OpenAI chat-completions shape (`choices[0].message.content`) and the reader only understood `{ response }`, so every summary came back empty and the run recorded `model: null`. The admin then reported "AI unavailable at run time", which was false and sent the diagnosis in the wrong direction. `readText` now handles both shapes, the model id is one that actually appears in the account's `wrangler ai models list`, a failed call is distinguished from one that answered unreadably, and each run logs its neuron spend so the budget question has an answer instead of an estimate.
- **The CMS SEO editor corrupted a different page's record while you typed.** Selection was looked up by `pageSlug` — itself an editable field — so one keystroke made the lookup miss, `Math.max(0, -1)` silently selected row 0, and every further keystroke edited *that* row's slug. It presented as the editor "refreshing" onto About mid-typing. Selection is now by position, which cannot drift out from under the thing it identifies.
- **SEO edits for two pages were being accepted and discarded.** The Solutions record was keyed `solutions` while the page asked for `services`, and the Insights record was misspelled `insigths`. `loadPageSeo` falls back to the static file silently, so nothing failed and nothing warned. Both slugs are repaired, the fallback now logs `seo_lookup no_record`, and `src/lib/content/seo.test.ts` asserts every route in `src/config/publicRoutes.ts` has a record — it found four routes (`/process`, `/privacy`, `/terms`, `/insights/daily`) that had none and no way to create one.
- **The Pickleball e2e suite killed its own dev worker.** It failed ~130 of 246 locally — identically on an unmodified tree — because three spec files each shelled out to `wrangler d1 execute --local` for assertions on tables with no read API. That second process opens the SQLite file miniflare holds read-write, producing `SQLITE_BUSY` in the reader and `D1_ERROR: internal error` inside the worker, which then died and took every remaining test with it. Two of the three already had a cross-process lock and a retry, which cannot help: the contention is between the reader and miniflare's writes, not between readers. All three now share one read-only `node:sqlite` connection (`tests/e2e/pickleball/d1Read.js`). With that plus a wrangler upgrade (4.116.0 → 4.134.0, which fixed a separate crash in its own `ProxyController`), the suite is 246/246.
- The fifteen Insights articles are 803–1,050 words each, up from 513–694. Reading times, being derived, moved with them.
- The SEO editor can now add a page record. Previously it could only edit rows that already existed, which is how those four routes ended up unreachable from the admin.
- **The verification widget could never render on a multi-step form.** `useTurnstile` rendered once on mount, found no container (the widget lives beside the submit button on step 2), and never tried again — leaving a form that could never produce a token and therefore could never be submitted. The hook now takes an `enabled` flag in its dependency list.
- **Responses that never read their request body crashed `wrangler dev --local`.** The admin gate's 401, the retry route, and the PATCH route's not-found path all answered without consuming the body, which corrupts the next request replayed over the same keep-alive connection and takes the dev server down with "Network connection lost". Added `drainRequestBody()` and applied it on those paths.
- **The Work page silently kept its old copy.** `2026-09-17-business-first-content.sql` targeted Work's sections by their bootstrap ids, but `replacePage()` reinserts every section with a fresh `crypto.randomUUID()` on each admin save — those ids had already been regenerated in production, so all three `UPDATE`s matched zero rows, reported success, and left Work unchanged while every other page moved. Both scripts now match on `(page slug, section_type)`, which is stable by construction. Home was unaffected because it is rebuilt by `page_id`.
- **Rate limiting was enforcing nothing on the preview Worker.** `RATE_LIMITER` was added to the top-level config (DO migration tag `v2`) but never mirrored into `env.preview`, and nothing at the top level is inherited by an environment — so with the binding absent, `checkRateLimit()`'s deliberate fail-open behaviour meant admin login, contact, inquiry submission and lead-delivery retry were all unlimited there. `env.preview` now carries the binding, the matching migration tag, the `images` binding, and the `RESEND_FROM_EMAIL`/`LEAD_NOTIFICATION_EMAIL` vars that were also silently falling back to hardcoded defaults.
- The legacy `/api/contact` subject line is preserved verbatim again (the Pickleball beta-tester form depends on it) rather than being replaced by the type-derived subject.
- `public/sitemap.xml` was stale: it listed `/resources/*` URLs that are permanent redirects into `/insights/*` and omitted `/work`, `/process` and `/pickleball` entirely. Replaced by the generated route; `robots.txt` updated to match.

### Security
- Request bodies on public submission endpoints are capped at 32 KB and refused with a 413 before parsing, so an unbounded POST never reaches validation or D1.
- Idempotency keys are computed server-side from (inquiry type, email, message, 10-minute bucket) under a UNIQUE index. A client-supplied key would let a caller collide with someone else's inquiry or bypass dedupe by rotating it.
- CSV export is formula-injection safe: any cell beginning `= + - @` or a control character is neutralized, and the free-text message is deliberately excluded from the export entirely — it stays in the access-controlled admin detail panel.
- Attribution is stored through an explicit allow-list with per-field length caps; an unexpected key in a request body is dropped rather than widening what gets persisted.
- Delivery logging and activity metadata carry no personal data — the lead id, target, status code and failure category, and for a note only that one was written and how long it was, never its text.
- Retry is rate limited per admin identity, so an authenticated operator or a stolen session cannot turn the button into an outbound email amplifier.
- `leadUpdateSchema` contains only `pipelineStatus`, `assignedOwner` and `internalNotes`, so the admin API has no field through which a visitor's submitted values could be rewritten.
- The mobile navigation panel can now be dismissed with Escape, returning focus to the control that opened it.
- A regression test pins the admin credential format end to end: `scripts/cms/hash-admin-password.mjs` builds hashes with node's `pbkdf2Sync` and its own base64url encoder, while `verifyPassword` checks them with WebCrypto and a separate decoder, and nothing previously held those two implementations together. A mismatch there is invisible until an admin is locked out of production.

### Security
- Admin authentication now fails **closed** on misconfiguration. `getAdminAuthMode()` previously fell back to `cloudflare-access` whenever `ADMIN_SESSION_SECRET` or the admin credentials were absent, and that mode authenticated on the `cf-access-authenticated-user-email` request header alone — with `ADMIN_EMAIL` also unset, its check reduced to "any email is allowed". A single missing secret was therefore one config edit away from granting full CMS access to anyone able to set a request header. An unconfigured environment now resolves to `unconfigured` and returns 503.
- The `cloudflare-access` auth mode is disabled rather than trusting an unverified header. It never validated the signed `Cf-Access-Jwt-Assertion` that Access sends alongside the email header, so the header on its own was treated as proof of identity. `ADMIN_AUTH_MODE` is `password` in both deployed environments, so nothing relied on it; reinstating it requires verifying that JWT against the team's Access JWKS (documented in `docs/operations.md`).
- Logging out now invalidates the session instead of only clearing the cookie. Sessions are stateless HMAC tokens, so a captured copy stayed valid for the remainder of its 8-hour lifetime no matter how many times the admin pressed "Log out". Tokens now carry a `jti` that logout records in the new `admin_session_revocations` table, checked on every admin request. Revocation is per-token, so signing out on one device leaves other sessions alone.
- Only `pbkdf2_sha256` password hashes are accepted. The single-round salted `sha256`/`sha256hex` formats — July 2026 workarounds for a Workers PBKDF2 iteration cap, superseded once 100,000 iterations was confirmed to work — were still accepted on login despite being crackable at GPU speed. They are still *recognised* solely to report a precise 503 configuration error, so a credential left on an old format is diagnosable rather than an unexplained login failure.
- Unexpected admin 500s no longer echo raw D1/runtime error text to the client; they are logged server-side and answered generically. Deliberate 4xx failures keep their specific messages, so the "which field failed validation" detail added in 1.8.0 is preserved.
- Media writes (upload, replace, delete) are rate limited per admin identity — 60 per 5 minutes through the existing Durable Object limiter. These routes are session-gated, so this bounds what one compromised session or a runaway client retry loop can spend on R2 and D1, rather than guarding against anonymous traffic.

### Added
- Migration `0008_admin_session_revocations.sql`, backing admin logout revocation. **Apply it to both D1 databases** (`devlab-studios-cms` and `devlab-studios-cms-preview`). The revocation check degrades gracefully if the table is absent — a deploy that lands ahead of its migration keeps working with the previous cookie-only logout behaviour rather than locking anyone out.
- The media library pages through the bucket with a "Load more" control. It only ever fetched the first page (250 objects) and never read the `cursor` the API already returned, so beyond that images were invisible with no indication anything was missing — and because R2 lists in key order and keys start with a random UUID, a newly uploaded image was not even guaranteed to be on the first page.
- Players and venues can be deleted from the pickleball dashboard, which previously had no way to remove either. Both are guarded, because every table referencing them does so `ON DELETE CASCADE` — an unguarded delete would not fail, it would succeed and silently take finished games, session attendance, pairing history and other players' matchmaking record with it. A venue is deletable only before its first session (its courts go with it, being its own configuration); a player only while they have never been added to a session. The precondition is a `NOT EXISTS` clause inside the `DELETE` itself rather than a preceding `SELECT`, so nothing can slip through between the check and the write. A refusal returns 409 with the counts behind it and says which reason applies.
- `Deactivate`/`Reactivate` on the Players page, exposing the `active` flag the API already supported. This is the supported way to retire a regular player: they leave the roster list while their games and OPI stay intact, which is what the delete refusal now points at.
- `/pickleball/methodology` now shows how OPI is computed rather than only describing it. One worked example — four games, `11–7 / 11–9 / 15–7 / 9–11` — is carried from the per-game score share through the average to a ranked board, with three new illustrations (`EligibilityArt`, `ConfidenceArt`, `RankOrderArt`) and a per-point split bar whose tick spacing and segment widths are driven by the score itself. The page also documents what was previously undocumented: that tournament games never feed OPI, that reopening a game discards its old figures rather than layering on them, that ties are broken by name and never by games played, that unranked players still appear on the board, and that point differential is shown but never ranked on.
- Every figure on that page is computed at build time by importing `gamePerformance`, `opi` and `confidenceTier` from `src/lib/pickleball/opi.ts` — the same functions the scoring engine uses — instead of being written out as prose. A change to the formula now changes the page, rather than leaving a confident explanation of the old one.

### Fixed
- The media library's summary tiles now count exactly what the grid shows. The server summarised every R2 object on the page while the client filtered to images before rendering, so the counts could exceed what was visible beneath them. Non-image objects are filtered server-side and the tiles are derived from the rendered set.
- Project screenshots opened from the profile/work galleries are no longer cropped. The full-screen viewer had been reusing the same `fit: 'cover'` 960×540 thumbnail derivative as the card, so anything that wasn't exactly 16:9 lost its edges — and a 960px-wide crop blown up to fill the viewer was also the main reason those images looked pixelated. The viewer now gets its own uncropped `fit: 'contain'` derivative at the uploader's own resolution cap.
- Images lose much less quality on upload and replacement in the admin CMS. The browser-side downscale ran through a 2D canvas at its default `imageSmoothingQuality` of `'low'` — a box filter whose aliasing is exactly the reported pixelation on dense UI screenshots. It now resamples via `createImageBitmap`'s high-quality path (canvas with `imageSmoothingQuality = 'high'` as fallback), encodes WebP at 0.92 instead of 0.84, and keeps sources up to 2560px instead of 1920px so Cloudflare Images — a far better resampler than a canvas — does the final resize.
- Replacing a media asset that is already a WebP within the size caps no longer re-encodes it. Decoding and re-encoding lossy WebP is pure generation loss, so an image degraded slightly every time it was replaced. Mislabelled files (a PNG renamed `.webp`) are still re-encoded, detected by signature rather than by the browser's extension-derived MIME type.

### Changed
- A failed media *replace* can no longer destroy both copies of an image. Once the old R2 object was deleted the operation was effectively committed, but the trailing bookkeeping writes stayed inside the `try`; a transient D1 failure there triggered a rollback that re-pointed every reference at an old URL already deleted from R2 and then deleted the replacement too — leaving the content pointing at a 404 with neither image left. Post-commit bookkeeping is now best-effort, so the rollback path can only run while the old object still exists.
- A media upload or delete that succeeds is no longer reported as failed when only its audit-log write fails. On upload the natural retry after such a false failure stored a second copy of the same image under a fresh key.
- Media API errors now surface their actual cause in the admin UI. The media page's fetch wrapper called `response.json()` unconditionally, so any non-JSON error response (an unhandled 500 renders Astro's HTML error page) surfaced as `Unexpected token '<'` instead of the real message.

### Removed
- Deleted 13 unused files that no longer had a reference anywhere in the tracked source: the pre-Astro Vite template leftovers `src/App.css` and `public/vite.svg` (distinct from the live `src/assets/tool-logos/vite.svg`); `public/404.html`, which the SSR build never served because `src/pages/404.astro` is the real 404 and the static copy was only reachable at the literal `/404.html` path; the never-imported `src/components/ui/ListItemWithIcon.jsx`; `src/hooks/useServicesContent.js`, superseded by `src/lib/content/services.ts`; `LandingSampleVibeCode.jsx`, the one legacy-app sample never wired into `App.jsx`'s router; and the unreferenced assets `src/assets/project-{1,2,3}.svg`, `src/assets/projects/project-placeholder-vibe.png` and `screenshots/`. No public route, API shape or D1 schema is affected.

### Changed
- ESLint now ignores `.kilo/**`. Lint was reporting six `no-undef` errors that came entirely from the gitignored agent worktree at `.kilo/worktrees/`: the config's node-globals override matches `playwright.config.js` and `tests/e2e/**/*.js` relative to the repository root, so the worktree's copies of those same files fell through to browser globals and failed on `process`. The errors were pre-existing and unrelated to any source change, but they were burying real lint output.

## [1.8.0] - 2026-09-10

### Changed
- A pickleball session no longer publishes anything by default. The public live/TV view shows real player names on a link that needs no sign-in, so publishing is now something an operator turns on per session from the session control page rather than something that happens to their players automatically. Existing sessions are untouched and keep working; only newly created ones start private. The leaderboard remains separately switchable once sharing is on, and turning sharing off again immediately stops the link resolving — so an operator asked to stop showing someone's name can actually do it.

### Added
- Added `POST /api/pickleball/sessions/:id/visibility` and a sharing control on the session page, gated on `MANAGE_SESSIONS` — publishing personal data is a session-management decision, not a scorekeeping one. Both flags are written together so "leaderboard on, public view off" (a state nobody can observe) cannot be stored.
- Added a privacy notice to the public live view stating what is shown, that anyone with the link can see it, and that the session organiser can switch it off.
- Invited operators are now actually emailed. Inviting someone created their membership and told the inviter "Invitation saved", but sent nothing and gave the invited person no way to learn they had access — the invite worked and was simultaneously invisible, which is indistinguishable from being broken. The email carries their role, the sign-in link for the environment it was sent from, and the one instruction that matters: sign in with Google using the address the invite arrived at, since that is what binds the membership to an account. It is a table-and-inline-styles layout with a plain-text alternative, because Outlook renders through Word and Gmail drops `<style>` blocks. The same endpoint also changes an existing member's role, so the copy says "your role has changed" in that case rather than claiming a long-standing member has just been added. Delivery outcome is now reported back rather than assumed: the operators page confirms the address it reached, or warns that access was granted but the mail did not go out and gives the link to pass on by hand. Nothing is sent from an environment with test logins enabled, so the end-to-end suite cannot mail its throwaway addresses and bounce them off the domain the real invites are sent from.

### Fixed
- Made validation errors say what is actually wrong. The API has always returned field-level detail for a 400, and the API client already attached it as `error.issues`, but all 18 operator pages displayed only the generic top-level message — so a form with one bad field reported a bare "Validation failed." with no indication of which field or why, which is indistinguishable from a broken app. Errors now read like "Win by: Number must be greater than or equal to 1". The scoring-ruleset form also gains a hint that a win-by of 1 is sudden death, since "win by 0" is the natural thing to reach for and is not a value that can exist.
- Replaced every rate limiter with a Durable-Object backed one, because the previous ones were not enforcing anything in production. They used module-scope `Map`s, and Cloudflare gives each Worker isolate its own memory, so the counters almost never saw the same client twice. Measured against the live site rather than inferred: 12 sequential wrong-password attempts on `/api/admin/login` from one address all returned 401 against a limit of 8, and 70 requests to the public session endpoint produced no 429 at all. The admin login now also carries a second, per-address limit, since the per-account one is trivially sidestepped by spraying one guess each across many addresses. Enforcement is proved end to end against a running worker, which is what the old unit tests could not do — they drove the `Map` in-process and passed throughout.
- Gave the pickleball pages their own social share image. All three pointed at the site-wide DevLab Studios "Full-Stack Development & AI Automation" card, so sharing the pickleball link on Facebook or LinkedIn showed a software-consultancy advert with a pickleball caption underneath — and on a social post the image is read before any text. The new 1200x630 card reuses the same hand-authored court artwork and brand gradient as the landing page. The source HTML is kept in `scripts/og/` so it can be re-rendered rather than re-drawn.
- Led the pickleball landing hero with "Be a beta tester" instead of "Operator sign in". While the product is in beta almost everyone arriving is a prospective operator rather than an existing one, so requesting access is the primary action, seeing the guide is secondary, and signing in is a quiet link for the few who already have an account. The new button anchors to the request-access form already on the page.
- Added the site favicon to the four standalone pickleball shells — the operator app, accept-invite, and the live and TV views. Those pages declare their own `<html>` rather than going through `Layout.astro`, so they had been serving a blank tab icon while the marketing pages showed the logo.
- Paginated the organisation roster. `GET /api/pickleball/players` returned every player with no LIMIT and the Players page rendered all of them — fine for a club of twenty, and the first thing to break for a club of two thousand, which is exactly the size a successful launch produces. It now returns a bounded page (50 by default, 200 ceiling) with `total`/`hasMore`, and accepts `search`, matched on the same normalised name the duplicate rules already use. The Players page gains search and paging; the dashboard counts from `total` rather than the rows it happened to receive; and the check-in page's register-a-player picker is now search-backed rather than holding the whole roster, which is what let it keep working past one page. `players` remains the top-level field, so nothing that consumed it breaks.
- Fixed migration `0015` being impossible to apply to a new database, which meant every fresh environment needed a documented manual step and would have blocked any later migration behind it. Root cause, established by bisection against throwaway D1 databases rather than by reading: wrangler concatenates a migration with its own bookkeeping insert and posts that string to D1 unsplit, and D1's server-side splitter breaks a statement at a semicolon followed by a newline. SQLite requires a semicolon inside a trigger body, so a conventionally formatted trigger was cut in half and the API answered `incomplete input`, having applied nothing. Keeping the body's terminator on the same line as `END;` fixes it. A brand-new database now applies all fifteen migrations, trigger included, with one `wrangler d1 migrations apply` and no manual step. Three earlier explanations were disproved along the way and are recorded in the migration file so the next person does not re-derive them.
- Made every permission-gated pickleball API route drain its request body before answering 403. Twenty of them returned the refusal before reading the body, which is the pattern already documented in this repo as crashing a local worker's loopback for every subsequent request in the run; the other thirteen happened to read first, so the whole set now uses one draining helper and a future reordering cannot reintroduce it.
- Fixed the long-standing "known flaky" end-to-end tests. `playwright.config.js` set a 180s test budget but left each `expect` on Playwright's 5s default — a different, much tighter clock. Every operator page is a `client:only` React island, so navigating to one means download, hydrate, then fetch before anything renders, which on a cold worker routinely passes 5s. The first assertion after a `page.goto` therefore failed about one run in three while the page was perfectly healthy. Raising the assertion timeout to 15s (still far under the test budget) fixes the whole class rather than three tests individually.
- Added rate limiting to the unauthenticated public session endpoint. A share code is ~40 bits and unguessable in one shot, but it was the only gate on a view carrying real player names and the endpoint would answer as fast as it was asked, leaving code enumeration trivially scriptable. Capped per IP, far above what the 5s degraded-path poll needs.

## [1.7.0] - 2026-09-08

### Added
- Added Devlab Pickleball's public pages: a product landing page (`/pickleball`), an operator guide (`/pickleball/how-it-works`) and a methodology page, each with share metadata, original inline court artwork that renders without JavaScript, and a request-access path so a prospective operator who is not yet in the system has somewhere to go instead of a dead-end sign-in.
- Added fixed-pairs sessions. A pair is formed from the check-in page and persists for the whole session: it queues and is assigned as a single unit, both partners must be available for it to be offered a court, and it carries its own games-played count so pair fairness is tracked separately from individual fairness.
- Added tournaments in all four specified formats — round robin, single elimination, pool play into a bracket, and double elimination. The entire draw is generated when the bracket is locked and seeded from all-time ratings; later rounds exist as empty slots that fill as results come in. Courts are proposed from the fixture list rather than the fairness queue, and tournament games deliberately do not feed player ratings while still counting toward session wins and losses.
- Added entrant withdrawal. Remaining opponents are awarded walkovers (a win with no points) so a draw still completes after an injury or departure, the withdrawn pair keeps the results it already earned so the pairs that beat it still add up, and withdrawing releases the pair so it can then be dissolved.
- Added the bracket to the public and TV views, showing pools, winners and losers brackets by pair name, with slots nobody has reached yet marked `TBD` rather than left blank.
- Added per-session standings that rank every attending player from check-in, so a leaderboard exists from the first minute of a session rather than only once enough games have been played.
- Added four D1 migrations (`0012`–`0015`) introducing `session_pairs`, `tournament_entrants` and `tournament_fixtures`, three new nullable columns on existing tables, and a trigger enforcing one active pair per player. All are additive: no table is rebuilt, renamed or dropped, and code predating them continues to run against the migrated schema.

### Changed
- Modelled a tournament as a fixed-pairs session carrying a format rather than as a third session type. Everything already built for pairs — formation, availability, assignment, statistics — applies unchanged, and only the parts that genuinely differ (seeding, fixtures, advancement) are new.
- Replaced the Zoho Flow webhook as the contact-form lead-delivery target with the Resend API. A webhook trigger only confirms Zoho *received* the ping, not that its flow actually ran and sent an email — with the flow's subscription lapsed, leads were silently persisting to D1 while reporting "delivered" and no email ever arrived. Resend's response only reports success once the message is actually accepted for delivery, so lead status now reflects reality. Sends from and to `hello@devlabstudios.com` by default (both configurable), and preview intentionally has no working key so preview/e2e runs never send a real email.

### Fixed
- Fixed the mobile navigation panel rendering with no background at all instead of a near-opaque dark surface, letting page content bleed through behind its links. The cause: Tailwind's opacity modifier (`/NN`) only resolves values on its opacity scale (multiples of 5); `bg-[#080d21]/98` used an unsupported value and silently compiled to nothing. Corrected this and two other same-shape instances (light gradient card treatments using `/92` and `/88`) to valid scale values.
- Fixed the admin Leads list silently showing only the single most recent lead. The admin UI always requests `/api/admin/leads` with no `limit` param; `Number(null)` evaluates to `0` in JavaScript, and a `Number.isFinite()` guard let that `0` through as an explicit "limit 1" instead of falling back to the intended default of 100.
- Fixed the platform Organizations page setting state from a floating promise inside its mount effect, which `react-hooks/set-state-in-effect` reports as an error and which failed `npm run lint` — and so CI on `main`, which gates the release tag on it. Pre-existing rather than introduced here, but it blocked this release from being tagged. The load is now awaited inside the effect with an unmount guard, which also stops it setting state on a component the operator has already navigated away from.
- Fixed migration `0012` being impossible to apply to a remote D1 database, which blocked the entire feature from deploying. Every attempt failed with `incomplete input: SQLITE_ERROR`, reproduced on both production and preview, and had gone unnoticed because the migration had only ever been applied to local SQLite files, where wrangler takes a different code path. The trigger it defines is rejected when it travels in the same request as other statements, where something re-splits on the `;` that SQLite's grammar requires inside `BEGIN ... END`; wrangler's own splitter and D1 itself were each ruled out by test. Splitting the trigger into its own migration (`0015`) lets the rest apply normally. `0015` still cannot be applied by `wrangler d1 migrations apply`, because that command appends its own bookkeeping insert to the same request — it is created with a single `d1 execute --command` and the migration recorded manually, which the migration file documents so a new environment cannot silently end up without the constraint.

## [1.6.0] - 2026-08-14

### Added
- Added public-usage guidance to CMS editors, controlled repeatable page-section fields, readable field-level audit diffs, and reference-aware R2 media upload, replacement, and deletion actions.

### Changed
- Reorganized the Admin CMS around the actual public information architecture: Home, About, Services, Work, Insights, and Profile now appear in public order; Process and Contact are supporting content; Projects, Service Catalog, Insight Articles, and Certifications are clearly labeled content libraries.
- Hid the unused Case Studies and Testimonials collections from normal Admin navigation and dashboard surfaces while retaining their storage and API compatibility.
- Removed the dormant Case Study presentation path from the public Work page so legacy records cannot surface there accidentally.
- Wired existing Home, About, Services, Insights, and Contact presentation copy to controlled CMS page blocks without changing their public layouts or enabling arbitrary HTML.
- Renamed Admin-facing Resources/Articles wording to Insights and Site Settings navigation to Navigation & Footer.
- Updated the repository README and operational documentation for the current Astro/Cloudflare platform, Full-Stack Software Engineer & AI Automation Specialist positioning, Work-to-Project CMS model, release 1.5.0 environment status, and the two-branch preview-first workflow.
- Added a canonical branch workflow and cleanup guide after removing merged feature branches and the stale clean worktree.

### Fixed
- Audit Log details now explain the action performed and show safe before/after field previews instead of raw metadata JSON.
- Media uploads now require a size-checked, signature-verified optimized WebP at the Worker boundary; replacement updates known content references before retiring the prior R2 key, and deletion is blocked while references remain.
- Fixed the public Experience timeline rendering its connector line above each node's circle instead of behind it.
- Reworded remaining first-person marketing copy ("We start by mapping…", "After the audit, we define…", "Once the direction is approved, we build…", "Tell us where…", "Our Process", "How we work") to a neutral/third-person voice across the homepage, Process, and Contact pages and their static fallback data, matching the wording pass already applied to Services.
- Corrected a stale seeded value on the Home hero's secondary call-to-action (`secondaryCta` pointed at "View Profile" → `/profile`) that, now that the public renderer reads it, would have silently replaced the live "View Work" → `/work` button; applied via an idempotent update script to preview and production D1.

## [1.5.0] - 2026-08-14

### Added
- Added a dedicated CMS-managed Work page that features existing Project records, keeps Work-specific description, Challenge, System Architecture, and Delivery Value copy independently editable, renders each Project's ordered multi-image gallery, and prevents deletion while a Project remains featured.

### Changed
- Brightened the homepage delivery timeline and aligned the client-credibility language around Full-stack Development + AI Automation.
- Reframed the public experience as a dark-native, full-bleed DevLab system with a full-viewport landing chapter, the canonical brand tagline, restrained logo-derived color energy, open capability architecture, larger proof-first Work presentations, and light surfaces reserved for intentional content artifacts.
- Consolidated public pages into one full-document midnight backdrop with continuous gradients, mesh, and sparse technical markers; transparent section wrappers; and a navbar that integrates at page load before gaining a restrained sticky surface on scroll.
- Refined the Admin CMS into a quieter operational control plane with compact metrics, scan-friendly activity, restrained navigation states, and standardized workspace controls while preserving its routes and workflows.
- Polished the profile tool strip and open dark-surface interactions, compact carousel pagination, process-artifact labels, and desktop hero height so the approved dark-native design remains legible and complete across common first-viewport sizes.

### Fixed
- Guarded the public footer and CMS login against temporary version-history or smoke-test tagline values while retaining a targeted, idempotent D1 correction for existing environments.
- Kept Profile experience actions legible during hover, constrained public detail and image panels beneath the sticky navigation, and extended their dimming backdrop behind the navbar without covering it.
- Extended the CMS visual system with icon-led navigation and sparse, non-interactive vector fields behind workspace content and the login introduction.

## [1.4.4] - 2026-08-13

### Fixed
- Made the CMS Media Library inventory the bound Cloudflare R2 bucket directly instead of relying on an empty D1 tracking table, with storage summaries, object paths, previews, and clear editor-upload guidance.
- Synchronized Production navigation, calls to action, Home and About hero blocks, Profile positioning, canonical resume URL, and Home SEO with the validated Development content through the targeted idempotent update.

## [1.4.3] - 2026-08-13

### Changed
- Quieted and spaced out the public mesh texture, removed decorative dots from admin workspaces and forms, and enriched the CMS login introduction with restrained icon-led capability cards.

## [1.4.2] - 2026-08-13

### Fixed
- Enforced the canonical inline `/resume.pdf` destination on the Profile action so stale CMS content cannot restore the retired external résumé link.

## [1.4.1] - 2026-08-13

### Changed
- Strengthened the lightweight static site-wide wavy dot mesh, carried a quieter mesh texture into shared card surfaces, added branded icons to footer connection links, improved spacing throughout the contact form flow, and prevented form interaction before React hydration and secure verification are ready.

### Security
- Provisioned a dedicated production Managed Turnstile widget and encrypted Worker secret for `devlabstudios.com`, while keeping Cloudflare's official test key restricted to local verification.

## [1.4.0] - 2026-08-13

### Added
- Added a cinematic dark/light public design system with reusable full-stack, data, editorial, and automation vector motifs.
- Added a living-systems homepage hero that maps the customer journey across interface, API, data, AI, automation, and human handoff layers.
- Added backward-compatible CMS hero presentation fields, complete page-block rendering, repeatable CTA/signal controls, and a mobile admin navigation drawer.
- Added the stable `/resume.pdf` route and Profile-only `View Resume` action while preserving the approved ATS resume byte-for-byte.

### Changed
- Repositioned Stephen consistently as a Full-Stack Developer & AI Automation Specialist across primary public copy, SEO, structured data, and CMS fallbacks.
- Aligned the public shell, core route heroes, footer, CMS login/dashboard, and editor surfaces with the new visual system.
- Made site settings merge partial CMS records with safe structural defaults so missing footer fields cannot remove navigation or social links.
- Made partial CMS project collections merge with repository fallbacks so selected public proof cannot silently disappear when D1 is incomplete.
- Restored About to the primary navigation, moved Process out of the primary tab set, strengthened navbar contrast, consolidated shared colors into a navy–indigo–cyan palette, and moved the dot mesh from cards to the global site background.
- Expanded Work with selected automation project screenshots and structured write-ups covering each challenge, system architecture, and delivery value.
- Rebuilt the public color architecture around the canonical electric blue–violet–magenta logo palette, cool pearl canvas, shared surface/card/form primitives, stronger technical mesh, and matching midnight navbar/footer treatments.
- Refined the About page into one authoritative studio-overview hero, with balanced metadata and a consistent card hierarchy instead of a duplicated page introduction.

### Security
- Replaced the deployed Turnstile test-key fallback with environment-specific runtime keys and fail-closed server validation, including hostname/action checks, Siteverify timeout and idempotency, duplicate/expired-token recovery, and safe structured form errors.
- Provisioned a dedicated Managed Turnstile widget for the isolated Preview hostname and connected its public runtime key and encrypted Worker secret.

## [1.3.1] - 2026-08-12

CMS seed and navigation infrastructure fixes, surfaced by a whole-site audit
done right after 1.3.0 shipped. Classified as PATCH: bug fixes and cleanup
only — no new capability, and every redirect/route behaves the same from a
visitor's perspective, just served by the mechanism the CMS was actually
built for instead of a duplicate hardcoded shortcut.

### Fixed
- `scripts/cms/seed/cms-content-seed.sql` targeted the pre-migration-0004
  `resources` table for article content; that table was renamed to
  `articles` in `0004`, so this seed would fail outright if run today. Its
  column list already matched the current `articles` schema exactly — the
  fix was the table name, not the data.
- The seed's `site_footer` JSON stored `legalText` as a plain string; the
  real footer and admin editor both expect `legalLinks` as an array of
  `{label, href}` links to `/privacy` and `/terms`.
- The seed's navigation and footer both pointed "Resources" at `/resources`
  instead of the real `/insights` route, and never had a "Process" nav
  entry at all (the seed predates that page). A `seo_metadata` row also
  used `page_slug: 'resources'`, which the Insights page never looks up
  (it requests `'insights'`) — an orphaned row from the same root cause.
- Production's live database had every one of the above: `profile_about`
  still stored the pre-1.3.0 field names and a plain-string certificates
  list (blanking the About paragraph and every certification's text on
  the live site since 1.3.0 deployed), the nav had no Process entry, and
  Resources still pointed at `/resources`. Fixed directly in production's
  D1 via a targeted, minimal update — no code change was needed for this
  part, since the deployed code already expected the correct shape.
- Removed `src/pages/experiences.astro` and `src/pages/portfolio.astro`,
  two hardcoded redirect pages that duplicated (and always intercepted
  before) the equivalent rows already sitting unused in the D1 `redirects`
  table since migration `0004`. `middleware.ts`'s D1-backed redirect
  lookup was already fully wired up — completes the cleanup that
  migration's own comment deferred to "Phase 3." Verified directly (not
  assumed): the "legacy redirects still work" e2e test previously passed
  entirely through the hardcoded pages for all three legacy routes; after
  removing these two, it was re-run and confirmed the D1 + middleware path
  genuinely serves both redirects correctly on its own.

## [1.3.0] - 2026-08-12

Profile page content refresh and structural rebuild: merged the About/
Certifications content into one document flow with real experience data,
then rebuilt the whole page into a single sidebar + document-flow layout
with a scrollspy and cursor-glow navigation, a restyled Portfolio carousel,
and a wide set of layout/alignment fixes found during verification.
Classified as MINOR: new, backward-compatible presentation and navigation
on the existing `/profile` route — no route, `/api/*` shape, or D1 table
schema changed (the `profile_about` JSON blob's internal shape changed
together with its one reader/writer, the same kind of change 1.2.0 itself
made).

### Added
- Left sidebar navigation (About/Education/Certifications/Experience/
  Tools & Platforms/Portfolio) with scrollspy (highlights the section
  currently in view) and a cursor-following spotlight glow across the
  whole page. Vanilla-JS, matching the existing scroll-reveal pattern —
  no new client-hydrated island.
- Experience entries: a full-detail modal opened via "View details",
  matching the existing modal convention elsewhere on the page.
- Portfolio carousel: dot pagination with an active-pill indicator, and a
  seamless edge fade (no bounding box) replacing the previous hard clip.
- Certifications: issuer logos (Cisco, Google, OWASP) resolved from the
  existing `issuer` field, with a generic fallback icon otherwise.
- Tools & Platforms marquee: 13 additional tools (Claude, Postman, Spring
  Boot, Next.js, TypeScript, JavaScript, Git, Vercel, PHP, Java, Retell AI,
  Twilio, SQL/Databases), widened from 2 to 4 slower rows.
- "DevLab Studios" wordmark now shows in the navbar at every screen width,
  not just `sm` and up.

### Changed
- About and Certificates & Licenses merged into a single `about` field and
  a structured `{ name, issuer, date }` array (previously two separate
  fields and a plain string array) — the admin CMS form and every reader
  updated together.
- Experience section now shows the already-correct 4-entry history
  (previously only 1 entry was live, a data-sync gap, not a content gap).
- Platform Training certifications and the Professional certifications
  list both now render as flat, two-column lists instead of a boxed card
  grid and a single column respectively, for visual consistency with each
  other.
- Portfolio's "Automated Lead Qualification" project: enriched
  description, and its title/tech-stack synced to match what was already
  live in production (a pre-existing divergence between the static
  fallback data and production's D1, found while verifying this release —
  renamed to "Automated Real Estate Lead Qualification & Outbound Calling
  System", added the missing "n8n" tag).
- Per-section headings (About, Education, Certifications, Experience,
  Tools & Platforms, Portfolio) removed at desktop width, where the new
  sidebar nav labels them instead; restored as small inline labels below
  the breakpoint where the nav is hidden.

### Removed
- "Skills" section (always rendered blank — no data source has ever
  populated it).
- "Systems & Workflows" section.

### Fixed
- Several layout bugs surfaced by direct browser verification during this
  release, not just visual inspection: the sidebar's right-hand grid
  column used a bare `1fr` track, which per the CSS Grid spec defaults to
  `minmax(auto, 1fr)` — once Tools & Platforms and Portfolio moved inside
  this grid, their unwrapped content pushed the whole column (and the
  page) wider than the viewport; Portfolio carousel cards varied in both
  height and width because a title's `line-clamp`-ed line count and
  natural (unwrapped) text width still affected flex-item sizing even
  though the clamp only clipped visually; the Experience connector line
  was positioned at a grid column's edge instead of the dot's actual
  rendered center; Experience date text overflowed into the connector
  line at realistic date-range lengths after an earlier column-width
  change; the Portfolio carousel's own prev/next arrows were being faded
  into near-invisibility by its new edge-mask, since they were descendants
  of the masked element; the profile photo's decorative glow read as
  uneven from two separate causes (an asymmetric two-blob gradient, then a
  parent `overflow-y-auto` — added to fix sidebar overflow on short
  viewports — clipping the glow's box-shadow at its own edges); anchor
  jumps from the sidebar nav landed under the fixed navbar (missing
  `scroll-padding-top`).

## [1.2.0] - 2026-08-11

Profile page redesign: an animated tools/platforms marquee with real
vendored brand logos, hero card polish, certification hover effects, a
left-rail experience timeline, and an auto-rotating portfolio carousel
replacing the old expandable rows. Classified as MINOR: purely new,
backward-compatible presentation on one existing page — no route, `/api/*`
shape, or D1 schema changed.

### Added
- "Tools & Platforms" marquee: two-row, alternating-direction,
  auto-scrolling display of real brand logos (via `simple-icons`, vendored
  as local SVG assets — no runtime dependency on the package or a CDN),
  grayscale at rest with brand color and pause on hover. Two logos
  (OpenAI, GoHighLevel) fall back to a generic icon pending real
  brand-kit assets, since neither has a `simple-icons` entry.
- Hero card: entrance animation on load, a pulsing gradient glow behind
  the profile photo, an "available for work" status pill.
- Certification cards: lift + shadow and a diagonal shine sweep on hover;
  issuer and date reveal on hover instead of always showing.
- Experience section rewritten as a left-rail timeline (year badge →
  dot-on-line → card) with a staggered scroll-reveal animation.
- Portfolio section rewritten as an auto-rotating carousel (Embla
  Carousel): seamless infinite loop, pause-on-hover with manual arrow
  controls, a center-focus effect (sharp center card, progressively
  blurred/faded toward the edges), and a dedicated project detail modal
  (`ProjectDetailModal`) replacing the old expandable rows (`PortfolioRow`,
  removed).
- A shared `[data-reveal]` scroll-reveal utility (`src/lib/scrollReveal.ts`),
  used site-wide for entrance animations, with a `<noscript>` fallback so
  content stays visible without JavaScript.

### Changed
- Portfolio carousel only loads a project's cover image once it's within
  a small window of the currently-selected slide (tracked via Embla's own
  position API), instead of every project in a category loading its
  image regardless of visibility — bounds real page weight and avoids
  downloading cover art a visitor will never scroll to.
- `ProjectData` (`src/lib/content/projects.ts`) is now an exported,
  explicitly-typed interface instead of an internal, loosely-typed one.
- `/profile`'s image-weight budget and its underlying Playwright
  measurement (`tests/e2e/image-weight.spec.js`) were corrected: the old
  fixed-timing scroll+settle logic could race past a `client:visible`
  island's hydration and silently undercount real page weight; it now
  waits for the DOM's own image count to stabilize before measuring.

### Fixed
- `ProjectDetailModal` now matches this repo's existing modal conventions
  (Escape-to-close, background scroll lock, `aria-labelledby`) and
  correctly coordinates with the nested image lightbox so a single Escape
  press or scroll-lock release only affects the topmost modal.
- Carousel arrow controls are now visible on keyboard focus and on touch
  devices (previously only revealed on mouse hover, making them
  invisible-but-tappable/focusable).

## [1.1.0] - 2026-08-01

The Astro/CMS rebuild program: rendering migration, schema-driven admin,
leads backend, and deployment hardening. Every entry below was already a
real commit on `feat/astro-cms-rebuild` (see `git log v1.0.0..v1.1.0` for
the full itemized history) — consolidated here into one release because the
`[Unreleased]` section wasn't updated commit-by-commit while the branch was
in progress, contrary to this file's own stated policy above. Classified as
MINOR: the rendering layer and admin were fully rewritten internally, but
every public route and `/api/*` shape a visitor or the frontend depends on
was ported 1:1 or kept working via redirect (see `/resources` → `/insights`
under Changed) — nothing in the public contract broke.

### Added
- Rendering rewritten on Astro + `@astrojs/cloudflare` (replacing the Hono
  SPA worker), querying D1 directly in frontmatter — eliminates the
  double-render (static fallback → client fetch → swap) the previous
  architecture had on every content page.
- Admin rebuilt as a schema-driven headless CMS: Zod-validated content
  types, append-only content versioning with one-click rollback, an audit
  log, generic replace-all/per-item collection CRUD, a block-based page
  composition editor (Home/About/Process), a media library, and real
  D1-backed redirect management (redirects created in `/admin` now actually
  redirect on the public site).
- New public pages: Process, Privacy, Terms, and Work (case studies index +
  detail) — previously scoped but never built.
- Leads backend: submissions persist to D1 before delivery is attempted
  (a downstream Zoho outage can no longer lose a submission), Cloudflare
  Turnstile spam protection on the contact form, 5-minute duplicate-submission
  detection, a `/admin/leads` screen with delivery-attempt history and manual
  retry.
- Real Platform Certifications content (Make/n8n/Zapier) on the Profile page.
- Security headers (CSP, HSTS, X-Frame-Options, Permissions-Policy,
  X-Robots-Tag) now enforced on every server-rendered response via
  middleware — previously only reached genuinely static files.
- An isolated preview environment (`devlab-studios-preview`: its own Worker,
  D1 database, R2 bucket, and secrets), deployed automatically on every push
  to `development` via `.github/workflows/deploy-preview.yml`.
- `.github/dependabot.yml` for monthly npm and GitHub Actions dependency
  updates.
- A Playwright end-to-end suite (`tests/e2e/`) — the project had none before
  this program started.
- Five ADRs (`docs/architecture/decisions/`) and `docs/deployment.md`,
  `docs/security.md`, `docs/testing.md`.
- `scripts/cms/hash-admin-password.mjs` now only emits PBKDF2 hashes (removed
  the weak single-round SHA-256 default), always prompts interactively with
  masked input, and requires a confirmation entry instead of accepting the
  password as a CLI argument.
- CI now automatically tags and publishes a GitHub Release whenever
  `package.json`'s version changes on a push to `main`.
- Redesigned the admin Dashboard to match mature CMS conventions: live stat
  cards (Projects, Services, Articles, Case Studies, Testimonials,
  Certifications, Redirects, Leads) linking straight to each section, a
  real Recent Activity feed (icon per action type, relative timestamps,
  actor email) reading from the existing audit log, and a Quick Links
  panel — replacing the plain text-link grid and always-empty-looking
  activity list.

### Changed
- `/resources` renamed to `/insights`; the old path 301-redirects, so
  nothing that linked to it breaks.
- Footer legal links are now editable content (`legalLinks` array) instead
  of a static string.
- Maintenance mode is now a runtime D1 toggle (`site_settings.maintenance_mode`)
  instead of a build-time flag.
- Content Security Policy updated to allow Cloudflare Turnstile
  (`challenges.cloudflare.com`).
- Repo and Worker renamed to `devlab-studios`.

### Removed
- `@refinedev/core`, `@refinedev/react-router`, `@refinedev/simple-rest` —
  the previous admin's Refine dependency, confirmed unused by any admin
  component after the schema-driven rebuild.
- The legacy `src/worker.js` Hono app — every route ported 1:1 to Astro API
  endpoints (same response shapes, same validation, same rate limiting).
- Deleted stale, superseded remote branches `cloudflare/workers-autoconfig`
  and `copilot/fix-error-in-actions` (both one-off bot-generated branches
  from 2026-03-10, fully absorbed into `main` already).

### Fixed
- **Data loss risk**: every "replace all" collection save (testimonials,
  certifications, services, articles, FAQs, experiences, skills, tools,
  navigation, SEO metadata, page blocks, project gallery images — ~12
  functions) deleted all existing rows and re-inserted the new ones as
  separate, sequential `.run()` calls. D1 does not implicitly wrap
  sequential statements in a transaction, so a failure partway through the
  insert loop (bad row, transient error, hitting a platform limit on a
  large save) left the delete committed and the rest of the new data never
  written — a silent, irrecoverable loss of whatever wasn't re-inserted in
  time. Found during a pre-release code review, verified directly against
  `testimonials.js`. Fixed by building the delete + every insert as
  prepared statements and running them through `db.batch()`, which D1
  executes as one atomic transaction.
- Version History "Restore" (`VersionHistoryPanel`, used by every content
  type) failed completely silently on a network error or expired session —
  no error shown, button just did nothing. Same gap in the Leads "Retry
  Delivery" action. Both now show an error message and re-enable the
  action instead of failing invisibly.
- `PUT /api/admin/content/[type]` (services/resources/profile/site-settings/
  seo) and `/api/admin/projects/*` never validated request bodies with Zod
  before writing to D1, unlike every schema-driven collection — a
  deliberately-deferred gap from the Phase 4 debt cleanup
  (docs/architecture/decisions/0002-schema-driven-cms.md), closed here with
  schemas matching the repositories' existing coercion leniency (nothing
  newly required, just real structural validation instead of none).
- Latent JSON-LD XSS pattern in `Layout.astro`: `JSON.stringify` doesn't
  escape `<`, so a string containing `</script>` could prematurely close
  the tag. Not exploitable today (only static strings feed it), but a
  one-line escape closes the class of bug before any CMS data is ever
  wired through the unused `getPortfolioItemSchema` helper.
- `GET /api/admin/leads?limit=-1` (or similar) returned the entire table —
  SQLite treats a negative `LIMIT` as "no limit". Clamped to 1–500.
- Admin shell's sidebar header and topbar had different heights, so their
  border lines didn't align — both now a fixed `h-16`.
- Insights pages (`/insights` and `/insights/:slug`) rendered `[object Object]`
  wherever a post had no cover image: `{createElement(resolveIcon(...), ...)}`
  produces a raw React element object, and Astro's template interpolation
  just stringifies non-renderable values instead of mounting them. Fixed by
  resolving the icon to a component reference and using it as a normal
  `<Icon />` tag, which Astro does know how to render.
- `PortfolioGallery`'s category tabs had no spacing before the results grid
  below them (missing `mt-6`).
- Admin login page was a bare, unbranded form — added the site's actual
  logo, wordmark, and CMS-editable footer tagline (fetched from
  `/api/site-settings`) in a branded split-screen layout matching the rest
  of the site's visual identity.
- Platform Certifications on the Profile page weren't clickable — extracted
  into a `CertificationsGallery` island reusing the same `ImageModal`
  lightbox `PortfolioGallery` already had, so certificate images now open
  full-size on click like project screenshots do.
- `tailwind.config.js`'s `content` glob (`./src/**/*.{js,jsx,ts,tsx}`) never
  included `.astro` files, so Tailwind silently purged every utility class
  used only inside a `.astro` template — which by this point was most of
  the site's page-level styling (gradients, brand colors, layout classes
  on About/Home/Services/etc). Visually broken since whichever Phase 3
  commit first converted a page to `.astro`, but never caught: Playwright
  asserts on headings/text content, not computed styles, and nobody had
  looked closely at the rendered pages until manually reviewing the first
  preview deploy. Fixed by adding `astro,md,mdx` to the glob.
- `.nvmrc`, `package.json`'s `engines.node`, and both GitHub Actions
  workflows bumped from Node 20 to 22 — the Astro version in use requires
  Node `>=22.12.0` and had for a while, but `ci.yml` only runs on `main`,
  which this branch hadn't reached yet, so nothing had ever actually
  built this code with Node 20 in CI until the new preview deploy workflow
  ran and failed immediately.
- `scripts/cms/hash-admin-password.mjs` capped at 100,000 PBKDF2 iterations
  (was 210,000) — Cloudflare's actual deployed Worker runtime rejects
  higher counts with `NotSupportedError`, which `wrangler dev --local` does
  not catch, so every local/CI test passed despite the real deploy failing.
  Discovered by deploying the new preview environment for the first time.
- Patched 4 of 5 high-severity `react-router`/`react-router-dom` CVEs by
  bumping to 7.18.2 (within the existing `^7.11.0` range, non-breaking). The
  5th (`GHSA-qwww-vcr4-c8h2`, an RSC-mode CSRF bypass) has no fix until
  react-router 8.3.0, which `react-router-dom` hasn't published; it only
  affects apps using React Router's unstable RSC APIs, which this app does
  not use — allowlisted in `audit-ci.json` with justification recorded in
  `docs/CURRENT_STATE.md`.
- Replaced the CI `npm audit` step with `audit-ci` so a single allowlisted
  advisory can't mask a future, real one.

## [1.0.0] - 2026-07-30

Baseline release — the first tagged version for this live production site.
Prior history was not tagged and is summarized here from `git log` rather
than itemized commit-by-commit. The `v1.0.0` tag for this entry was pushed
manually as the documented CI-unavailable fallback, since the automated
tagging described above didn't exist yet at the time this was cut.

### Added
- Portfolio pages: Home, About, Services, Profile, Resources (with dynamic
  `/resources/:slug`), Contact, and five `/landing-sample-*` marketing/demo
  pages.
- Custom CMS: Cloudflare D1 + R2 + Hono backend with an admin UI (`/admin`,
  built on Refine) for managing projects, services, resources, profile
  content, site settings, and SEO metadata, with static-content fallback
  when D1 is unconfigured.
- Contact form proxied server-side to a Zoho webhook, with per-IP rate
  limiting and payload validation.
- SEO: per-route meta tags, sitemap, robots.txt, JSON-LD.
- Security headers (CSP, HSTS, X-Frame-Options, Permissions-Policy) via
  `public/_headers`.
- Mobile startup performance pass (deferred analytics, non-blocking font
  loading, route-based code splitting).
- `docs/` directory with architecture, tech stack, current-state, and
  performance documentation.
- `CONTRIBUTING.md`, `CHANGELOG.md`, `LICENSE`.
- Commit hygiene tooling: husky + lint-staged + commitlint enforcing
  Conventional Commits.
- `.github/PULL_REQUEST_TEMPLATE.md` and issue templates.
- `.nvmrc` and `engines.node` pin matching CI's Node 20.

### Changed
- Rewrote `README.md` to match the current CMS/Cloudflare-Worker
  architecture (previously described a static-only, no-CMS site).
- Relocated `CMS_IMPLEMENTATION_GUIDE.md`, `ERROR_HANDLING_GUIDE.md`, and
  `PRODUCTION_DEPLOYMENT_GUIDE.md` into `docs/guides/`; corrected stale
  GitHub Pages/Cloudflare Pages references in the latter two.
- Relocated the four security audit documents into `docs/security/` and
  annotated each finding with its current resolution status.
- Renamed `.github/workflows/deploy.yml` to `ci.yml` to match its actual
  behavior (lint/build/audit, no deploy step).
- Moved `cms-content-seed.sql` and `project-seed.sql` into
  `scripts/cms/seed/`.
- Fixed `.stylelintr` → `.stylelintrc` (config was not being auto-discovered).

### Removed
- `src/services/api/apiClient.js` — unused fetch wrapper, zero imports.
- `functions/api/contact.js` — legacy Cloudflare Pages Functions handler
  superseded by the Hono route in `src/worker.js`.
- Stray empty `output/playwright/` directory (no Playwright dependency
  exists in the project).

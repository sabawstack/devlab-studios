# Devlab Pickleball — Public Pages, Fixed Pairs & Tournaments — Design Spec

> **Superseded (2026-10-12).** This describes the logged-in operator app, retired in 2.0.0 by Phase 5 of `docs/superpowers/specs/2026-10-11-pickleball-free-open-play-design.md`. Kept as history: the routes, tables and files it names no longer exist.

**Status:** Draft for review
**Date:** 2026-09-06
**Scope:** Three independent bodies of work, specified in one document at the
product owner's request: a public marketing/guide surface, fixed-pair play in
open play, and a tournament scheduling subsystem.

## 0. How to read this document

These three parts share no code. Part A is content and presentation. Part B
changes the queue engine's unit of work. Part C adds a scheduling model beside
the queue engine.

They were deliberately combined into one document. The author's recorded
concern is that bundling marketing copy with a scheduling subsystem tends to
smear the boundary between them, and that nothing in Part A can ship until
questions about Part C are answered. The product owner accepted that trade-off.
The mitigation is structural: **each part below is independently
implementable, in the order given, and each has its own phase entry in §4.** No
part depends on a later part. Part C depends on Part B's pair model.

One dependency crosses the parts and is called out where it lands: Part A's
"only document what exists" rule (§1.7) means the guide page written in Part A
must be revisited when Parts B and C ship, because it will then be able to
document pairs and tournaments truthfully.

---

# Part A — Public pages

## 1.1 The problem

`src/pages/pickleball/index.astro` is a 20-line centred block inside
`max-w-2xl`. On a desktop viewport roughly two-thirds of the page is empty.
There is no explanation of what the product does, no visual of any kind, and
no path for an interested visitor to ask for access.

There is also a dead end in the sign-in flow. A Google account with no active
membership is redirected to `/pickleball/app?error=no_access`, which renders
"Your Google account has no active Pickleball membership. Ask an admin to
invite you." — with no mechanism to ask anyone.

## 1.2 Illustration system

New directory `src/components/pickleball/art/`, one component per illustration.

Each is a single default-exported function taking `{ className }` and
returning one `<svg viewBox>`, marked `aria-hidden="true"`, drawn in
`currentColor` plus at most one accent (`text-brand`). This follows the
documented rule already established by
`src/pickleball-app/components/illustrations/PickleballHeroGraphic.jsx`:
**hand-authored original SVG, no third-party vector asset, nothing traced from
any reference image.** No competitor's artwork is copied, adapted, or
referenced.

Because they are `currentColor`, the same component renders correctly on the
dark public shell and inside a `light-artifact` panel, with no variant needed.

They are rendered **statically** — imported into `.astro` files with no client
directive, exactly as `src/pages/index.astro` already renders
`src/components/ServiceGraphic.jsx`. Zero JavaScript is shipped for artwork.

| Component | Used by | Depicts |
|---|---|---|
| `CourtSceneArt` | landing hero | Two courts, players, a waiting strip |
| `QueueFlowArt` | landing feature | Queue resolving onto a court |
| `ScoreboardArt` | landing feature | Live score, serving indicator |
| `StandingsArt` | landing feature | Ranked list with OPI bars |
| `ShareLiveArt` | landing feature | Phone, TV, QR |
| `Step1CreateArt` … `Step8CompleteArt` | guide | One per walkthrough step |

Thirteen components. Each is expected to be 30–60 lines.

## 1.3 Landing page — `/pickleball`

Rewritten from a centred block to a full-width page at `max-w-6xl`. Sections
in order:

1. **Hero** — copy left, `CourtSceneArt` right. Primary CTA "Operator sign
   in" (`/pickleball/app`), secondary "See how it works"
   (`/pickleball/how-it-works`).
2. **Feature grid** — four cards, each with its art: fair queueing, rally
   scoring, live standings, share live.
3. **Four differentiator blocks**, artwork alternating left/right inside
   `light-artifact` panels:
   - *Every match-up explains itself* — fewest games played, longest wait,
     and the app shows the reason for each pick. This is real:
     `selectNextPlayers` returns a `reasons: string[]` array built from the
     fields it actually used (`src/lib/pickleball/queueEngine.ts`).
     **Amended 2026-09-07:** this bullet originally read "avoids repeat
     partners" flat. That overstates the code twice over — repeat-avoidance
     only applies when at least five players are eligible AND an
     equal-`gamesPlayed` replacement exists, and it operates on group
     *selection*, not partner *assignment* (`balanceTeams` pairs by OPI with
     no repeat awareness at all). The page states the conditional version.
   - *Nothing is ever lost* — undo any rally, reopen and correct a finished
     game, statistics recompute rather than layer on top. **Amended
     2026-09-07:** "full audit trail" was overstated — only `reopenGame` and
     `correctGame` write `audit_events`; undo does not. The page scopes the
     claim to reopen and correct.
   - *Everyone sees the same score* — every applied command broadcasts a full
     snapshot to every connected socket, and a reconnecting client is sent
     current state rather than a diff (`SessionCoordinatorDO`).
   - *Standings from the first minute* — every checked-in player ranked before
     the first game finishes.
4. **Three-step flow teaser**, linking to the guide.
5. **What your players see** — QR link, live view, TV display.
6. **Request early access** — see §1.5.
7. **FAQ** — five questions.
8. **Closing CTA band.**

### Positioning

The page leads with capabilities this system genuinely has. **No competitor is
named, and no comparative claim is made** — no comparison table, no "unlike
other tools" framing. Every claim on the page must map to code that exists in
this repository. This is both an accuracy requirement and a risk decision:
comparative claims about products we have not audited are indefensible on a
public page and date quickly.

## 1.4 Guide page — `/pickleball/how-it-works` (new)

Structure:

- **Hero** plus a "what this handles for you" panel.
- **Find your next step** — a three-column jump-link row.
- **Before you start** — venue, courts, scoring ruleset.
- **The eight steps.** Each carries its own diagram, two to three sentences,
  and a "what you'll see on screen" list:
  1. Create a session
  2. Open it for check-in
  3. Check players in
  4. The queue fills
  5. Assign a court
  6. Start the game
  7. Score the game
  8. Finish the game and read the standings
  9. Complete the session

  **Amended after implementation (2026-09-07).** This list originally had
  eight steps and omitted "Start the game". That was a spec defect, not a
  simplification: `assignCourt` only seats the two teams and flips the court
  to `ASSIGNED`. Play does not begin until a separate
  `POST /api/pickleball/sessions/:id/games/start` carrying `servingTeam` and
  both sides' starting server ids, driven by the start-a-game form on the
  Games page. An operator following the original eight steps literally would
  have reached "Score the game" with no game to score.
- **What your players see** — three cards (QR, live view, TV display).
- **When something goes wrong** — undo a rally, correct a finished game,
  take a court out of service. Two further cases named in the original draft
  — replacing an assigned player, and abandoning a game — were dropped
  during implementation: both exist only as API routes with no call site in
  any committed operator UI, so documenting them would have violated §1.7.
  The three that remain are real commands on `SessionCoordinatorDO` reachable
  from the operator UI.
- **Who can do what** — the three roles, from
  `src/lib/pickleball/permissions.ts`.

Audience is the operator, with a short player-facing section at the end. A
player's entire interaction is scanning a QR code and watching, so a full
parallel player track would be padding.

## 1.5 Request early access, and the sign-in dead end

A **Request early access** section on the landing page (`id="request-access"`)
renders the existing `src/components/islands/ContactForm.jsx` with
pickleball-specific copy, mirroring how `src/pages/services.astro` already
reuses it. Turnstile site key resolution is copied from that page verbatim
(local-request check plus `env.TURNSTILE_SITE_KEY`).

The island is mounted `client:visible` rather than `client:load`, so the form's
JavaScript is not fetched until a visitor scrolls to it and the hero's render
is unaffected.

`LoginPage.jsx`'s `no_access` state gains a link to
`/pickleball#request-access`.

**Security constraint.** `callback.ts` deliberately rate-limits the
no-membership branch because it is an email-enumeration oracle: without the
throttle, an attacker with many Google accounts could distinguish "invited"
from "not invited" by where they land. Adding a link to the existing error page
discloses nothing new — same page, same timing, same status — it only provides
an exit. **The throttle, the redirect target, and the branch logic are not to
be modified.** This is a copy-and-one-anchor change to `LoginPage.jsx` only.

## 1.6 Services page

`src/pages/services.astro` currently offers "Be a beta-tester", which reveals
an inline contact form. A visitor there has no way to look at the product
before requesting access.

A secondary button — **"See how it works"** → `/pickleball` — is placed beside
it, the pair wrapped in `flex flex-wrap gap-3` so they sit side by side on
desktop and stack on mobile. It is a plain `<a>` with no JavaScript, styled as
the quieter of the two so the beta-tester ask remains primary.

## 1.7 Content accuracy rule

**The guide documents only what the software can do today.** At the time Part A
ships, that explicitly excludes fixed pairs and tournaments: `session_type`
accepts `'FIXED_PAIRS'`, but `SessionCoordinatorDO.assignCourt` refuses any
session whose type is not `OPEN_PLAY`, and team creation always writes
`'AD_HOC'`. A guide that documents an inert feature is worse than no guide.

When Parts B and C ship, the guide gains their sections. This is listed as an
explicit task in each of those phases, not left as a follow-up.

## 1.8 Testing (Part A)

New `tests/e2e/pickleball/pickleball-public-pages.spec.js` on the `worker`
project:

- Both pages return 200 and render their `h1`.
- All eight step headings are present on the guide.
- Landing → guide link resolves; the two new CTAs resolve.
- Every decorative SVG carries `aria-hidden`.
- Heading hierarchy has no skipped level.
- `no_access` login state renders the request-access link.

Plus a manual visual pass at desktop and mobile widths.

---

# Part B — Fixed pairs in open play

## 2.1 Current state

Fixed pairs is a labelled empty shelf:

| Layer | State |
|---|---|
| `session_type` enum | Accepts `'FIXED_PAIRS'` (migration 0001, `src/lib/schemas/pickleball/sessions.ts`) |
| `teams.kind` enum | Accepts `'FIXED_PAIR'` (migration 0004) |
| Create-session UI | Hardcodes `sessionType: 'OPEN_PLAY'`; no selector exists |
| Team creation | Always writes `'AD_HOC'` (`SessionCoordinatorDO.ts`) |
| Court assignment | Refuses outright: `if (session.sessionType !== 'OPEN_PLAY') return failure(...)` |

A `FIXED_PAIRS` session created through the API today is inert: players can
check in, and no one can ever be placed on a court.

## 2.2 The entrant model

In a fixed-pairs session the queue's unit of work changes from *player* to
*pair*. The design keeps this change as small as possible.

New table `session_pairs`:

| Column | Notes |
|---|---|
| `id` | PK |
| `session_id` | FK, cascade |
| `session_player_a_id` | FK to `session_players` |
| `session_player_b_id` | FK to `session_players` |
| `status` | `ACTIVE` \| `DISSOLVED` |
| `games_played` | INTEGER, default 0 — the pair's own count |
| `created_at`, `updated_at` | |

A partial unique index enforces that a `session_player` belongs to at most one
`ACTIVE` pair per session.

`queue_entries` gains a nullable `session_pair_id` column. **A queued pair
inserts two `queue_entries` rows — one per member — sharing one
`session_pair_id` and one `queued_at`.** This choice is deliberate: it
preserves the existing `session_player_id NOT NULL` column and the existing
"at most one open entry per session_player" rule (migration 0006) without
modification. The queue engine groups rows by `session_pair_id`.

`session_pairs` is distinct from `teams` on purpose. A `team` is per-game and
per-court — `SessionCoordinatorDO.releaseCourt` clears its `session_court_id`
as soon as the court is released. A pair persists across games for the whole
session. Conflating them would resurrect exactly the stale-binding bug
migration 0005's header documents.

## 2.3 Pair formation

The facilitator binds pairs on the check-in page: select two checked-in
players, confirm, the pair appears in a pairs list. Dissolving a pair closes
any open queue entry for it and returns both members to unpaired.

This is operator-driven, consistent with every other mutation in the app, and
requires no player-facing authenticated surface (none exists).

New DO commands: `formPair`, `dissolvePair`. Both serialized like every other
command, both audited.

## 2.4 Eligibility and selection

**A fixed-pairs session queues pairs and nothing else.** An unpaired
checked-in player is visible in the roster, marked "needs a partner", and is
never assigned. This keeps the entrant size at exactly two throughout the
engine.

Pair eligibility — all must hold for **both** members: `REGISTERED`,
`CHECKED_IN`, `AVAILABLE`, and not already participating in an active game;
plus the pair has an open queue entry and `status = ACTIVE`. If either member
fails any gate, the whole pair is ineligible. This is the parent spec's §15
case 28 decision ("no partial-pair play"), unchanged.

New pure function `selectNextPairs(eligiblePairs, count)` in
`src/lib/pickleball/queueEngine.ts`, a sibling to `selectNextPlayers`, same
shape and same `reasons: string[]` contract:

1. Fewest `session_pairs.games_played` first.
2. Longest wait (`queued_at`) next.
3. Avoid an immediate repeat of the last opposing pair — a tiebreak only,
   never overriding rules 1 or 2, and skipped entirely below three eligible
   pairs (mirroring the existing "skipped below five eligible players"
   degradation).

`count` is 2 pairs. A `FIXED_PAIRS` session requires a ruleset whose `format`
is `DOUBLES`; a singles ruleset is rejected at session creation, since a fixed
pair cannot play a singles game. This is validated in the Zod schema, not left
to fail confusingly at assignment time.

## 2.5 Balancing and assignment

`balanceTeams` is **not** called in a fixed-pairs session — partners are fixed,
so there is nothing to balance within a side. The two selected pairs become
Team A and Team B directly, in selection order.

`SessionCoordinatorDO.assignCourt`'s current type guard is replaced by a branch:
`OPEN_PLAY` takes the existing path, `FIXED_PAIRS` takes the pair path,
`TOURNAMENT` takes Part C's fixture path. Teams are created with
`kind: 'FIXED_PAIR'` and members drawn from the pair, finally using the enum
value migration 0004 reserved.

## 2.6 Edge cases

| Case | Decision |
|---|---|
| One member goes `TEMPORARILY_UNAVAILABLE` | Pair's queue entries close. **Amended 2026-09-07:** this row originally read "both rows retained for audit" and "the pair rejoins at the back with a fresh `queued_at` when both are available again." Neither matches what shipped. `queue_entries` has no closed/retained status — closing a pair's open entries is a hard `DELETE`, so nothing is "retained" in that table; the record that survives and can be queried is the `session_pairs` row itself, plus its `games_played` counter. And nothing auto-requeues: consistent with how every other open-play rejoin works, the operator re-joins the pair manually — an ordinary "Join queue" action — once both members are available again. The pair holds no reserved position while sitting out; it is re-queued at the back with a fresh `queued_at` only when the operator acts. |
| One member leaves the session | Pair is dissolved; the remaining member becomes unpaired and needs a new partner. |
| Operator wants to swap one member of an assigned pair | Not supported. `replaceAssignedPlayer` is refused in a `FIXED_PAIRS` session; the operator dissolves the pair and forms a new one. Documented rather than silently half-working. |
| Fewer than two eligible pairs | No assignment offered; the UI states this plainly, as it already does for fewer than four players. |
| A player is paired twice | Prevented by the partial unique index and re-checked in the DO's serialized handler. |

## 2.7 Statistics

`session_pairs.games_played` increments on finalization. Pair win/loss and
point totals are derivable from the existing `player_game_stats` rows joined
through `session_pairs`, requiring no new stats table. This finally delivers
the parent spec's Phase 5 "pair stats" item, which
`docs/pickleball/architecture.md` currently lists as deliberately not built.

**Amended 2026-09-07:** which pair is credited was not fully specified above,
and the first implementation got it wrong. `games_played` must be credited
to the pair recorded on the team via `teams.session_pair_id` (migration
0013) — the pair as it stood at the moment that team was seated — never by
looking up either member's *current* active pairing. Those two answers
diverge the moment anyone re-pairs mid-session: if a member dissolves and
re-forms with someone else, resolving "current pairing" for a re-finished
historical game would credit the new pair for a game it never played, and
`listEligiblePairs` orders by `games_played`, so the error would have
corrupted the fairness queue, not just a displayed number.

OPI is unaffected: fixed-pair games are ordinary open-play games and remain
eligible under the existing rules.

## 2.8 Testing (Part B)

- Vitest: `selectNextPairs` parameterised across pair counts 0–8, the
  degradation threshold, and the repeat-avoidance tiebreak. Pair eligibility as
  a pure predicate.
- Playwright: form a pair, queue it, assign a court, verify a `FIXED_PAIR` team
  with the right two members; a pair with one unavailable member is not
  assignable; `replaceAssignedPlayer` is refused; two concurrent assignments
  never place one pair on two courts.

---

# Part C — Tournaments

## 3.1 Shape

**Amended 2026-09-08 — a tournament is NOT a third session type.** It is a
`FIXED_PAIRS` session carrying a `tournament_format`. `session_type` stays
`OPEN_PLAY | FIXED_PAIRS`.

The original wording could not be implemented safely. `session_type` carries
`CHECK (session_type IN ('OPEN_PLAY', 'FIXED_PAIRS'))`
(`0001_foundation.sql:111`), SQLite cannot `ALTER` a CHECK, and the standard
table-rebuild was measured against D1 rather than assumed:

| Attempt | Outcome |
|---|---|
| Rebuild (create/copy/drop/rename) | CHECK widened and FK enforcement survived, but **every dependent row was silently deleted** by the `DROP TABLE` cascading |
| Same, wrapped in `PRAGMA foreign_keys=OFF` | **Rows deleted again.** SQLite documents that pragma as a no-op inside a transaction, and D1 wraps migration batches in one, so it can never take effect there |

Nine foreign keys across five migrations reference `pickleball_sessions`,
most `ON DELETE CASCADE`. A rebuild would have destroyed every session's
players, queue entries, teams, games and pairs — and reported success.

The replacement model is a better fit for what a tournament actually is, not
merely a workaround. §3.2 already requires entrants to be pairs, and this
section already said only the "what plays next" decision swaps. A tournament
*is* fixed-pairs play in which a fixture list replaces the fairness queue, so
every pair mechanism Part B built — formation, both-members eligibility,
`FIXED_PAIR` teams, `teams.session_pair_id` — is reused unchanged.

`pickleball_sessions` gains one nullable column,
`tournament_format TEXT CHECK (tournament_format IN ('ROUND_ROBIN',
'SINGLE_ELIMINATION', 'POOL_TO_BRACKET', 'DOUBLE_ELIMINATION'))`. NULL means
an ordinary fixed-pairs session. `ADD COLUMN` with a column-level CHECK was
verified against D1: NULL is accepted, a bad value is rejected. The migration
is purely additive and touches no existing row.

**Generalised constraint, recorded for anything later:** no `CHECK` in this
schema can be widened. Model new enum values as a new nullable column, or
design the CHECK wide enough up front.

This reuses venue, courts, check-in, the scoring engine and rulesets, undo and
correction, the audit log, the realtime channel, the public view, and all of
Part B's pair machinery wholesale. Only the "what plays next" decision swaps:
the fairness queue is replaced by a fixture list.

Session lifecycle is unchanged (`DRAFT → OPEN_FOR_CHECKIN → LIVE → COMPLETED`).
Bracket state is separate and tracked on the tournament rows, not the session
status.

## 3.2 Entrants and seeding

Entrants are **pairs only** — doubles tournaments. Entrants reuse Part B's
`session_pairs`, which is why Part C depends on Part B.

New table `tournament_entrants`: `id`, `session_id`, `session_pair_id`, `seed`
(INTEGER), `status` (`ACTIVE` | `WITHDRAWN`).

Seeding is computed from each pair's members' `ALL_TIME` OPI snapshots (mean of
the two), presented to the operator in seed order, and **reorderable before the
bracket is locked**. Once locked, seeds are frozen — regenerating a bracket
mid-tournament is not supported.

### The OPI asymmetry, stated deliberately

**OPI seeds a tournament, but tournament games do not feed OPI.** This looks
contradictory and is not: OPI is *earned* in open play and *spent* as a seeding
input. Recording it here so a future reader does not "fix" one half of it.

The mechanism is the existing `player_game_stats.eligible_for_opi` flag, set to
`0` at finalization for any game whose session is a `TOURNAMENT`. No new column
on `games` is needed — `games.session_id → pickleball_sessions.tournament_format
IS NOT NULL` is the discriminator (amended 2026-09-08 with §3.1's model).

## 3.3 Formats

All four are specified; §4 phases them so the simpler ones ship first.

| Format | Fixtures | Notes |
|---|---|---|
| `ROUND_ROBIN` | n(n−1)/2 | Every entrant plays every other once. No advancement logic — the simplest format and the first to build. |
| `SINGLE_ELIMINATION` | n−1 | Bracket padded to the next power of two; byes go to the top seeds. |
| `POOL_TO_BRACKET` | pools + bracket | Round-robin pools, top *m* per pool advance into a single-elimination bracket. |
| `DOUBLE_ELIMINATION` | ~2n | Winners and losers brackets. Materially the most complex to generate, render and reason about; last to build. |

## 3.4 Fixture model

One table `tournament_fixtures`:

| Column | Notes |
|---|---|
| `id` | PK |
| `session_id` | FK, cascade |
| `bracket` | `POOL` \| `MAIN` \| `LOSERS` |
| `pool_label` | nullable, e.g. `'A'` |
| `round_number`, `position` | Ordering within the bracket |
| `entrant_a_id`, `entrant_b_id` | Nullable until known |
| `source_a`, `source_b` | How an unknown slot is filled |
| `game_id` | Nullable FK to `games` |
| `winner_entrant_id` | Nullable |
| `status` | `PENDING` \| `READY` \| `IN_PROGRESS` \| `FINISHED` \| `BYE` |

The design idea: **the whole bracket is generated up front as slots, and
advancement fills slots.** `source_a`/`source_b` carry a small tagged string —
`WINNER_OF:<fixture_id>`, `LOSER_OF:<fixture_id>`, `POOL_RANK:<pool>:<n>` — so
a fixture always knows where its entrants come from even before they exist. A
fixture becomes `READY` when both entrant slots are filled.

Two pure functions in new `src/lib/pickleball/tournament/`, framework-agnostic
and unit-testable with no database, following the same discipline as
`queueEngine.ts` and `scoring/`:

- `generateFixtures(format, seededEntrants, options)` → the complete fixture
  list with sources and byes resolved.
- `advanceBracket(fixtures, finishedFixtureId, winnerEntrantId)` → updated
  fixtures, with newly-`READY` ones identified.

## 3.5 Court assignment

**The app proposes, the operator confirms** — mirroring how court assignment
already works, so the interaction is familiar and the operator retains control
over late entrants, injuries and judgement calls.

`nextPlayableFixture(fixtures, entrantsCurrentlyPlaying)` returns the
highest-priority `READY` fixture whose entrants are both present and not
already on a court. Priority is deterministic: lowest `round_number` first,
then lowest `position`, so earlier rounds always clear before later ones and
two operators looking at the same state see the same proposal. The UI surfaces it against the free court; confirming runs
the existing `startGame` path with teams built from the two entrants' pairs.

## 3.6 Scoring and advancement

Scoring reuses the rally engine, rulesets, undo, correction and audit
unchanged. `finishGame` gains two tournament-only steps: mark the game's
`player_game_stats` rows `eligible_for_opi = 0`, and call `advanceBracket`.

Reopen-and-correct must also **un-advance**: if a corrected result changes a
fixture's winner, downstream fixtures that were populated from it are reset.
A downstream fixture that has already been played blocks the correction with a
domain error rather than silently invalidating played games — the operator is
told which fixture stands in the way.

## 3.7 Standings

Tournament standings are not OPI standings. For round robin and pools:
wins, losses, point differential, then head-to-head.

**Implementation note with a real trap.** The session standings query added in
`src/worker/repositories/pickleball/sessionStandings.js` filters its win/loss
aggregate on `pgs.eligible_for_opi = 1`. Because tournament games are written
with that flag set to `0`, reusing it unchanged for a tournament would report
every entrant as 0–0. The filter must be parameterised, or a tournament
variant added. This is called out explicitly because the failure is silent —
zeroes, not an error.

## 3.8 Realtime and public view

The bracket joins the public projection through `toPublicSessionView`'s
**explicit allowlist mapper** — a named `bracket` projection built field by
field, never the internal fixture shape with fields stripped. The TV display
gains a bracket view.

## 3.9 Schema summary

New migrations, following the existing guard style
(`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`) and the
never-edit-an-applied-migration rule:

- `0012_session_pairs.sql` — `session_pairs`, `queue_entries.session_pair_id`.
- `0013_teams_session_pair.sql` — `teams.session_pair_id`.
- `0014_tournaments.sql` — `tournament_entrants`, `tournament_fixtures`, and a
  rebuild of `pickleball_sessions` to widen its `session_type` CHECK.

**Amended 2026-09-08.** Two corrections found when Part C was planned. Part B
shipped a `0013` of its own (`teams.session_pair_id`, needed to credit pair
statistics to the pair that actually played), so tournaments take `0014`.

More importantly, adding `TOURNAMENT` to `session_type` is not an additive
change: `0001_foundation.sql:111` declares
`CHECK (session_type IN ('OPEN_PLAY', 'FIXED_PAIRS'))`, and SQLite cannot
`ALTER` a CHECK constraint. Widening it requires the full table-rebuild
procedure — create the replacement, copy, drop, rename, recreate every index
and foreign key — on a table many others reference. This is the single
riskiest operation in Part C and is sequenced first, with its own
verification, rather than assumed to work.

## 3.10 Testing (Part C)

- Vitest, the bulk of the coverage: `generateFixtures` per format across
  entrant counts including non-power-of-two (byes), and `advanceBracket`
  including the un-advance path. These are pure and deserve exhaustive
  parameterised tests.
- Playwright: seed and lock a bracket; play a round-robin to completion and
  assert standings; a single-elimination final produces one winner; a
  tournament game does not move any player's OPI; correcting a result that
  would invalidate a played downstream fixture is refused.

---

# 4. Sequencing

Each phase is independently shippable and independently valuable.

| Phase | Scope | Depends on |
|---|---|---|
| A | Public pages, request-access form, sign-in exit, services CTA | — |
| B | Fixed pairs in open play; guide gains a pairs section | — |
| C1 | Tournament session type, entrants, seeding, `ROUND_ROBIN` | B |
| C2 | `SINGLE_ELIMINATION` | C1 |
| C3 | `POOL_TO_BRACKET` | C2 |
| C4 | `DOUBLE_ELIMINATION` | C2 |
| C5 | Bracket on the public/TV view; guide gains a tournament section | C2 |

# 5. Explicitly out of scope

- Singles tournaments. Entrants are pairs; the scoring engine already handles
  singles, so this is an entrant-abstraction change, not an engine change.
- Multi-day or multi-session tournaments. One tournament lives in one session.
- Consolation and third-place fixtures.
- Regenerating or reseeding a bracket after it is locked.
- Player-facing pair selection or self-registration. No player-authenticated
  surface exists.
- Any comparative or competitor-referencing content on the public pages.

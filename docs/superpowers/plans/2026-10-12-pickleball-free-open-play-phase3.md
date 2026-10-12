# Free Open Play — Phase 3 (Tournaments) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a free, no-login session be a doubles tournament: pairs made at random, balanced by skill or in list order; round robin, pools A–H into a bracket, single or double elimination; random, by-skill or manual seeding; a freely editable draft draw whose every edit is re-validated; Start locks the shape; substitutions and opponent swaps afterwards; the same court loop, captains, board, TV and results CSV as open play.

**Architecture:** A tournament is an `open_sessions` row with `kind = 'TOURNAMENT'` (that CHECK value has existed since `0016`), so it inherits courts, players, matches, captains, idempotency, the Durable Object and the 7-day purge unchanged. The new pure engine lives in `src/lib/pickleball/open/tournament/` and wraps the old app's pure modules **unchanged** (`generateFixtures`, `advanceBracket`, `nextPlayableFixture`, `rankTournamentStandings`, `resolvePoolQualifiers`). `OpenSessionState` gains `tournament: TournamentState | null` and every `OpenMatch` gains `fixtureId`; the reducer stays the single entry point and hands tournament work to `tournament/commands.ts`. Migration `0018` adds three tables that cascade from `open_sessions`; `persistDiff` writes only changed entrant and fixture rows in the same one `db.batch()`. The viewer snapshot gains an allowlisted `tournament` view that the console, board and TV render.

**Tech Stack:**
- Astro 7 (server output) on Cloudflare Workers
- D1, Durable Objects
- React 19 islands, Tailwind
- Zod 4
- Vitest 4, including `node:sqlite` for repository tests
- Playwright (`worker` project for `tests/e2e/pickleball/**`, `static` for the public-pages spec)

**Spec:** `docs/superpowers/specs/2026-10-11-pickleball-free-open-play-design.md`. Phase 3 is the third row of §14. Read §3.2, §3.3, §3.5, §6, §7, §8, §10, §11 and §13 before starting. The Phase 2 plan (`docs/superpowers/plans/2026-10-12-pickleball-free-open-play-phase2.md`) shows what exists. **The current code is the source of truth where it differs from either.** This plan was written against commit `ac37948` ("phase 2 final review fixes") and replayed, task by task, onto `14b4c9c` (the two small Phase 2 fixes after it touch none of the lines below): every engine, repository and reducer test below was run, the build passed, and the e2e tests in Tasks 7–11 passed against a local `wrangler dev` with migration `0018` applied. Every "Find" block is an exact excerpt of the file as the earlier tasks leave it, unique in that file. If `HEAD` has moved again, reconcile any block that no longer matches with the current code rather than forcing it.

## Global Constraints

- **The engine stays pure.** Nothing under `src/lib/pickleball/open/` does I/O. Randomness comes in through `CommandContext.random` (the Durable Object passes `randomInt`, a rejection-sampled `crypto.getRandomValues`); application code never calls `Math.random`. Every new behaviour gets a vitest test.
- **Reuse, don't fork** (spec §3.5, §6.2): `src/lib/pickleball/tournament/{generateFixtures,advanceBracket,nextPlayableFixture,rankTournamentStandings,resolvePoolQualifiers}.ts` are used exactly as they are. Do not edit them. They import only each other, so Phase 5's deletions (§12) cannot break them; `tournament/reuse.test.ts` pins that. `seeding.ts` (OPI ordering) is **not** used (§6.3).
- **Every result carries both scores** (owner rule, 2026-10-12): tournament games go through the same `RECORD_RESULT`/`validateResult` as open play (sudden death or win by 2). There is no winner-only result.
- **A session's kind is fixed at creation.** Open-play-only commands (`SET_MODE`, `ADD_RULE`, `REMOVE_RULE`, `EDIT_PROPOSAL`, `SKIP_PROPOSAL`) are refused in a tournament with 409.
- **The viewer snapshot is an allowlist** (spec §7). The tournament view carries pair and player names, ids, scores and court labels only: never skill, DUPR IDs or any secret. The captain snapshot builds matches field by field (`captainMatch`) and keeps the new `fixtureId` out (`CaptainMatch` omits it; the captain's court carries `fixtureLabel` instead).
- **Caps and limits are unchanged** (spec §10): 16 courts, 128 players, 2,000 matches per session (a draw needing more games is refused with a reason), commands 120 per minute per session, host and captain routes 600 per minute per IP.
- **CHECK constraints cannot be widened on D1** (`docs/pickleball/architecture.md`, "Schema constraint"). `0018` puts CHECKs only on values the reused generator fixes (format, bracket, fixture status); pairing, seeding and phase are free text normalized on read. Never rebuild a table. Everything cascades from `open_sessions`, so the existing purge removes tournament rows.
- **Copy rule:** a public page claims only shipped code. Task 11 removes `tournament` and `bracket` from the banned list in `tests/e2e/pickleball/pickleball-public-pages.spec.js`. These stay banned: *dupr, sign in, opi, performance index, rally-by-rally, mexicano*. The `UNBUILT_CLAIMS` list stays: never write "bracket reset", "third-place", "consolation", "reseed" or "singles tournament". Never write "vs" in `/pickleball` or `/pickleball/how-it-works` copy (the comparative-language test fails on `\bvs\.?\s`).
- **Palette and motion** (spec §11): DevLab tokens plus `pickle-neon` (`#c6ff2e`) and `pickle-teamb` (`#8d9bff`); neon as a fill with ink text, or as text on dark only. CSS keyframes only, animating `transform` and `opacity`; everything stops under `prefers-reduced-motion`. Art components ship no JavaScript, set `aria-hidden="true"` and sit in a `data-testid="pb-artwork"` container.
- **Responsive:** every new screen works from 390 px to 1920 px with no horizontal page scroll. Pools sit side by side on wide screens and stack on phones; a bracket reads left to right from `md` and stacks on phones. Every draw edit works by tap-to-select (touch and mouse).
- **Lint:** `eslint-plugin-react-hooks` 7 and `react-refresh/only-export-components` are on: never call `setState` synchronously in an effect body, and keep shared constants in `.js` files, not in component files.
- **Per commit:** add one line under `### Added` in `CHANGELOG.md`'s `[Unreleased]` in the same commit (`AGENTS.md`). Commit subjects are lowercase after the type. Phase 3 is a **MINOR** release, but this plan bumps no version.
- **Before any push:** `npm run typecheck && npm run build && npm run test:unit && npm run lint`, then the full Playwright suite (`npx playwright test`).

## Review Focus

1. **A paired player goes on a break mid-tournament.** Their pair's games must wait while other courts keep playing, and a free court must say which game waits for whom, not "waiting for a result". Pinned in Task 6 (`courts.test.ts`: "Semi-final 2 waits for Cy, who is on a break.", and the reducer test "a pair with a player on a break is skipped").
2. **Byes and uneven groups.** Single and double elimination with a pair count that is not a power of two (losers-bracket holes collapse) and pools of unequal size must still play through to exactly one champion with no court stuck. Pinned in Task 6 (`play.test.ts` cases for 3, 5 and 6 pairs and for 5 and 7 pairs in pools).
3. **People arrive or leave around the draw.** A player added after Generate is flagged as having no partner and Start is refused until they are paired or resting; a paired player cannot be marked Left (substitute instead). Pinned in Task 6 (reducer tests "a late arrival after Generate is flagged…" and "a player in a pair cannot just leave…").
4. **The host ends the session mid-tournament.** Proposals are withdrawn, tournament commands are refused with "This session has ended.", and the draw and results stay viewable and exportable. Pinned in Task 6 (reducer test "an ended session refuses tournament commands…").
5. **A double tap on Generate over court-side Wi-Fi.** A retried command with the same idempotency key must not draw again: with random pairing a second draw would silently change every pair. Pinned in Task 7 (e2e "a retried Generate (same idempotency key) never draws again").

---

## Decisions recorded for this phase (not to be reopened)

From the owner and the spec:
- Tournaments are doubles only. Pairs: **Random** (crypto shuffle), **Balanced** (snake by skill: strongest with weakest), **Manual**. Formats: round robin, pools → bracket (A–H, top 2), single elimination, double elimination, exactly as `generateFixtures` builds them. Seeding: **Random** (a shuffle before generation), **By skill** (mean pair skill), **Manual**.
- Generate makes a **draft**; draft edits are unrestricted but each is re-validated and refused with a reason if invalid. **Start** locks the shape; afterwards only *substitute a player in a pair not on court* and *swap opponents between unstarted fixtures in the same round and pool/bracket*.
- Later slots fill via `advanceBracket`; the court loop proposes `nextPlayableFixture` to whichever court frees; standings via `rankTournamentStandings` per pool and overall; results need both scores.

Resolved by this plan where the spec was silent or ambiguous:
1. **Kind, not a separate tournament object.** A tournament is `open_sessions.kind = 'TOURNAMENT'`, chosen on the create form and fixed for the session's life. That CHECK value has existed since `0016` for this purpose, so nothing in the schema widens, and courts, players, captains, idempotency and the purge are shared rather than duplicated.
2. **Three tables, not one JSON blob.** `open_tournaments` (one row: format, pairing, seeding, phase, start), `open_tournament_entrants` (pairs) and `open_tournament_fixtures`, per spec §3.2 ("same shape as today's tournament tables"). Matches link to fixtures through the existing `open_matches.fixture_id`. Rows have no order column: the engine keeps one canonical order (`tournament/order.ts`) that the loader reproduces in SQL.
3. **"Manual" pairing** means the roster in list order (1st with 2nd, 3rd with 4th), so a host can paste pairs in order; any other pairing is one or more player swaps away in the draft.
4. **The odd player** (and any late arrival) is shown as "no partner" in the draft. Start is refused until each is swapped into a pair or put on a break; a player on a break is then the obvious substitute. Balanced pairing leaves the middle-ranked player over; random and manual leave the last.
5. **No skill** counts as 3 (the middle of the self-reported 1–5 scale) for balanced pairing and by-skill seeding. Skill is editable on the tournament Players tab.
6. **What "valid" means** (`drawRules.ts`): every pair is two different players and nobody is in two pairs; nobody leaves while in a pair; no pair twice in a round; in round robin and each pool every pair meets every other pair of its group exactly once (this is how "every pair keeps its fixture count" holds even after a pair moves between pools, which re-generates both pools' round robins); a pool keeps at least 2 pairs; a knockout bracket keeps the same games fed from the same places, with every pair placed exactly once.
7. **"Change a fixture's opponent"** is a swap: the chosen pair and the displaced pair trade slots when the chosen pair already has a slot in that round (round robin, pools) or a placed slot in that bracket; otherwise it is a plain replacement that validation then judges. In a full round robin this almost always fails ("would play each other twice"), which is correct; its real use is a knockout's first round.
8. **Swap opponents after Start** follows the same validity rules, so in a round robin it is refused for the same reason; its use is between unstarted bracket games.
9. **Correcting a result.** Undo, or an edit that changes the winner, takes the result back out of the draw with the reused `unadvanceBracket` (or clears a finished pool's bracket slots) and is refused, naming the game, once a later game that depends on it has started. A score-only edit moves nobody, unless it is a pool game that changes who goes through.
10. **A paired player on a break** keeps their pair's games waiting (other courts carry on); the free court says which game waits for whom. Going on a break is allowed; marking a paired player Left is refused (substitute them first). Substituting a player who is on a break brings them back.
11. **Champion.** Round robin: top of the overall standings once every game is played. Every other format: the winner of the last main-bracket game (the grand final in double elimination; one game decides it, as generated).
12. **Visibility of the draft.** The public board shows the draft with "the host may still change pairs and games before the start", rather than hiding it.
13. **Results CSV for a tournament** lists every game with its stage, then overall pair standings, then each pool's (`Rank,Pool,Pair,Played,Won,Lost,Points for,Points against,Point difference`). Open play's CSV is unchanged.
14. **Fairness panel and stacking mode** are open-play features and are hidden in a tournament (console, board, TV).
15. **The banned list drops `bracket` as well as `tournament`**: the board shows brackets, and the guide must be able to say so.
16. **The board's "Bracket tab" (§7) is called Draw**, because a round robin and the pool stage have no bracket; it shows pools (with their tables) and then the bracket. Standings stays its own tab.
17. **Captain links work unchanged on tournament courts**: a captain starts and saves their court's games (and undoes or edits them, subject to the same "a later game depends on it" refusal) but cannot edit a proposal or touch the draw.

## File map

| File | Responsibility | Task |
|---|---|---|
| `migrations/pickleball/0018_open_tournaments.sql` | tournament, entrant and fixture tables | 1 |
| `src/lib/pickleball/open/tournament/types.ts`, `order.ts` | tournament types, normalizers, canonical row order | 1 |
| `src/lib/pickleball/open/types.ts`, `create.ts`, `diff.ts` | `fixtureId`, `tournament`, `random`; kind at create; tournament diff | 1 |
| `src/worker/repositories/pickleball/open/openSessions.ts` | load/persist tournament rows, `fixture_id` | 1 |
| `src/lib/pickleball/open/tournament/pairing.ts`, `src/lib/pickleball/webCrypto.js` | pair formation, seeding, `shuffle`, `randomInt` | 2 |
| `src/lib/pickleball/open/tournament/{info,labels,draw}.ts` | labels and one-liners, round and slot names, `generateDraw` | 3 |
| `src/lib/pickleball/open/tournament/{drawRules,drawEdits}.ts` | validity rules, draft and running edits | 4 |
| `src/lib/pickleball/open/tournament/{standings,progress}.ts` | pair standings, advancement, undo/edit, champion | 5 |
| `src/lib/pickleball/open/tournament/{commands,courts}.ts`, `reducer.ts`, `propose.ts`, schemas, create route, DO | commands, court loop, wiring | 6 |
| `src/lib/pickleball/open/tournament/{view,resultsCsv}.ts`, `csv.ts`, `snapshot.ts`, `resultsCsv.ts` | allowlisted tournament view, CSV | 7 |
| `src/pickleball-open/tournament/{drawTaps,bracketLayout,tabs}.js`, `{Choice,TournamentSetup,DraftEditor,BracketView,PairStandings,TournamentHost}.jsx`, `CreateSessionApp.jsx`, `HostConsole.jsx`, `PlayersPanel.jsx`, `CourtCard.jsx` | create form, setup, draft editor | 8 |
| `src/pickleball-open/tournament/{SubstituteSheet,ChampionBanner}.jsx`, `TournamentHost.jsx`, `CaptainConsole.jsx`, `pickleball-open.css` | running console, celebration | 9 |
| `src/pickleball-open/tournament/TournamentPanels.jsx`, `ViewerBoard.jsx`, `lib/myStatus.js`, `TvBoard.jsx`, `TvCourt.jsx` | public board and TV | 10 |
| `src/components/pickleball/art/BracketArt.jsx`, `src/pages/pickleball/{how-it-works,index}.astro`, public-pages spec | guide, landing, art, copy guard | 11 |
| `tests/e2e/pickleball/open-tournament.spec.js` | e2e | 7–10 |
| `docs/pickleball/{architecture,runbook}.md` | docs | 12 |

---

### Task 1: Tournament types, migration 0018 and the repository

**Files:**
- Create: `src/lib/pickleball/open/tournament/types.ts`, `src/lib/pickleball/open/tournament/order.ts`
- Create: `migrations/pickleball/0018_open_tournaments.sql`
- Create: `src/lib/pickleball/open/tournament/reuse.test.ts`
- Create: `src/worker/repositories/pickleball/open/openSessions.tournament.test.ts`
- Modify: `src/lib/pickleball/open/types.ts`, `src/lib/pickleball/open/create.ts`, `src/lib/pickleball/open/propose.ts` (one hunk), `src/lib/pickleball/open/modes/paddleStack.ts`, `src/lib/pickleball/open/testing/fixtures.ts`, `src/lib/pickleball/open/rotationExample.ts`, `src/lib/pickleball/open/rules.test.ts`, `src/lib/pickleball/open/snapshot.ts` (the captain match type)
- Replace: `src/lib/pickleball/open/diff.ts`, `src/worker/repositories/pickleball/open/openSessions.ts`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: Phase 2's `OpenSessionState`, `buildInitialState`, `diffState`, `persistDiff`, `loadOpenSession`, `createSqliteD1`; `TournamentFormat` from `src/lib/pickleball/tournament/generateFixtures.ts`.
- Produces:
  - `tournament/types.ts`: `TournamentFormat`, `PairingMethod = 'RANDOM' | 'BALANCED' | 'MANUAL'`, `SeedingMethod = 'RANDOM' | 'BY_SKILL' | 'MANUAL'`, `TournamentPhase = 'SETUP' | 'DRAFT' | 'RUNNING' | 'FINISHED'`, `FixtureBracket`, `FixtureStatus`, `TournamentEntrant { id; playerIds: readonly [string, string]; seed; poolLabel: string | null }`, `TournamentFixture { id; bracket; poolLabel; roundNumber; position; entrantAId; entrantBId; sourceA; sourceB; winnerEntrantId; status }`, `TournamentState { format; pairing; seeding; phase; startedAt; entrants; fixtures }`, `DraftEdit`, `RunningEdit`, `EditResult = { ok: true; tournament } | { ok: false; reason }`, `RandomInt = (maxExclusive: number) => number`, `TOURNAMENT_FORMATS`, `PAIRING_METHODS`, `SEEDING_METHODS`, `emptyTournament(format?)`, `normalizePairing`, `normalizeSeeding`, `normalizePhase`.
  - `tournament/order.ts`: `compareFixtures`, `sortFixtures`, `sortEntrants`, `FIXTURE_ORDER_SQL`.
  - `OpenMatch.fixtureId: string | null`; `OpenSessionState.tournament: TournamentState | null`; `CommandContext.random?: RandomInt`; `Proposal.fixtureId?: string`.
  - `CreateSessionInput.kind?: 'OPEN_PLAY' | 'TOURNAMENT'`, `CreateSessionInput.tournamentFormat?: TournamentFormat` (a tournament starts in `SETUP`).
  - `StateDiff` gains `tournamentChanged`, `upsertEntrants`, `deleteEntrantIds`, `upsertFixtures`, `deleteFixtureIds`.

- [ ] **Step 1: Write the failing tests**

`reuse.test.ts` pins that the reused modules import nothing slated for deletion, and that the new folder imports nothing from the old app. It reads the folder, so later tasks' files are checked as they land.

```ts
// The spec reuses the old app's pure tournament modules unchanged (§3.5, §6),
// and Phase 5 deletes the rest of the old app (§12). This pins that the
// reused modules depend on nothing slated for deletion, so Phase 5 can't
// break tournaments by removing a file they quietly import.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const REUSED = ['generateFixtures', 'advanceBracket', 'nextPlayableFixture', 'rankTournamentStandings', 'resolvePoolQualifiers']
const ALLOWED = new Set(REUSED.map((name) => `./${name}`))

function imports(file: string): string[] {
  const source = readFileSync(join(process.cwd(), 'src/lib/pickleball/tournament', `${file}.ts`), 'utf8')
  return [...source.matchAll(/^\s*import[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1])
}

describe('reused tournament modules', () => {
  for (const file of REUSED) {
    it(`${file}.ts imports only other reused modules`, () => {
      for (const specifier of imports(file)) expect(ALLOWED.has(specifier), `${file} imports ${specifier}`).toBe(true)
    })
  }

  it('nothing under open/tournament imports the old app', () => {
    const banned = /(seeding|opi|permissions|quota|scoring\/|sessionStateMachine|queueEngine|pairSelection|authContext|SessionCoordinatorDO)/
    const dir = join(process.cwd(), 'src/lib/pickleball/open/tournament')
    for (const file of readdirSync(dir).filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))) {
      const source = readFileSync(join(dir, file), 'utf8')
      for (const [, specifier] of source.matchAll(/from ['"]([^'"]+)['"]/g)) {
        expect(banned.test(specifier), `${file} imports ${specifier}`).toBe(false)
      }
    }
  })
})
```

The repository test builds a two-pair draft by hand (the draw generator arrives in Task 3) in the engine's key order.

```ts
import { describe, expect, it } from 'vitest'
import { createSqliteD1 } from './testing/sqliteD1'
import { createOpenSession, loadOpenSession, persistDiff, purgeExpiredOpenSessions } from './openSessions'
import { buildInitialState } from '../../../../lib/pickleball/open/create'
import { diffState } from '../../../../lib/pickleball/open/diff'
import type { TournamentState } from '../../../../lib/pickleball/open/tournament/types'
import { DEFAULT_SETTINGS, type OpenMatch, type OpenSessionState } from '../../../../lib/pickleball/open/types'

const MIGRATIONS = [
  'migrations/pickleball/0016_open_sessions.sql',
  'migrations/pickleball/0017_open_captains.sql',
  'migrations/pickleball/0018_open_tournaments.sql',
]
const NOW = '2026-10-11T10:00:00.000Z'

function cup(code = 'CUPCU23456', kind: OpenSessionState['kind'] = 'TOURNAMENT'): OpenSessionState {
  let n = 0
  return buildInitialState({
    name: 'Cup', hostDisplayName: 'Mo', location: null, courtCount: 2, settings: DEFAULT_SETTINGS, kind, tournamentFormat: 'SINGLE_ELIMINATION',
    players: ['Ana', 'Ben', 'Cy', 'Di'].map((name) => ({ name, skill: null, duprId: null })),
  }, { now: NOW, newId: () => `${code}-${(n += 1)}`, publicCode: code, sessionId: `sess-${code}` })
}

/** A two-pair draft built by hand, in the engine's key order. */
function drafted(state: OpenSessionState, suffix = '1'): OpenSessionState {
  const [a, b, c, d] = state.players.map((p) => p.id)
  const tournament: TournamentState = {
    ...(state.tournament as TournamentState),
    phase: 'DRAFT',
    entrants: [
      { id: `e1-${suffix}`, playerIds: [a, b], seed: 1, poolLabel: null },
      { id: `e2-${suffix}`, playerIds: [c, d], seed: 2, poolLabel: null },
    ],
    fixtures: [{
      id: `f1-${suffix}`, bracket: 'MAIN', poolLabel: null, roundNumber: 1, position: 0, entrantAId: `e1-${suffix}`, entrantBId: `e2-${suffix}`,
      sourceA: null, sourceB: null, winnerEntrantId: null, status: 'READY',
    }],
  }
  return { ...state, tournament, version: state.version + 1 }
}

const count = (raw: ReturnType<typeof createSqliteD1>['raw'], table: string) => (raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n

describe('tournament rows in D1 (0018)', () => {
  it('a tournament session round-trips, and open play still loads with no tournament', async () => {
    const { d1 } = createSqliteD1(MIGRATIONS)
    const state = cup()
    expect(state.tournament).toMatchObject({ format: 'SINGLE_ELIMINATION', phase: 'SETUP' })
    await createOpenSession(d1, state, 'hash')
    expect((await loadOpenSession(d1, 'CUPCU23456', NOW))?.state).toEqual(state)
    await createOpenSession(d1, cup('OPENO23456', 'OPEN_PLAY'), 'hash')
    expect((await loadOpenSession(d1, 'OPENO23456', NOW))?.state.tournament).toBeNull()
  })

  it('a draft persists as a diff, loads with the same key order, and a new draft replaces it completely', async () => {
    const { d1, raw } = createSqliteD1(MIGRATIONS)
    const state = cup()
    await createOpenSession(d1, state, 'hash')
    const first = drafted(state)
    await persistDiff(d1, state, first, null)
    const loaded = await loadOpenSession(d1, 'CUPCU23456', NOW)
    expect(loaded?.state).toEqual(first)
    const diff = diffState(loaded!.state, first)
    expect([diff.tournamentChanged, diff.upsertEntrants, diff.upsertFixtures, diff.deleteFixtureIds]).toEqual([false, [], [], []])

    const second = drafted(first, '2')
    await persistDiff(d1, first, second, null)
    expect((await loadOpenSession(d1, 'CUPCU23456', NOW))?.state).toEqual(second)
    expect([count(raw, 'open_tournament_entrants'), count(raw, 'open_tournament_fixtures')]).toEqual([2, 1])
  })

  it('a match keeps the fixture it plays', async () => {
    const { d1 } = createSqliteD1(MIGRATIONS)
    const state = drafted(cup())
    await createOpenSession(d1, state, 'hash')
    const match: OpenMatch = {
      id: 'm1', courtId: state.courts[0].id, seq: 1, status: 'PROPOSED', teamA: state.tournament!.entrants[0].playerIds,
      teamB: state.tournament!.entrants[1].playerIds, scoreA: null, scoreB: null, winner: null, proposedAt: NOW,
      startedAt: null, finishedAt: null, recordedBy: null, fixtureId: 'f1-1',
    }
    const next = { ...state, matches: [match] }
    await persistDiff(d1, state, next, null)
    expect((await loadOpenSession(d1, 'CUPCU23456', NOW))?.state.matches).toEqual([match])
  })

  it('the purge removes every tournament row with its session', async () => {
    const { d1, raw } = createSqliteD1(MIGRATIONS)
    await createOpenSession(d1, drafted(cup()), 'hash')
    expect(await purgeExpiredOpenSessions(d1, '2026-10-30T00:00:00.000Z')).toEqual(['CUPCU23456'])
    for (const table of ['open_tournaments', 'open_tournament_entrants', 'open_tournament_fixtures']) expect(count(raw, table), table).toBe(0)
  })

  it('rejects an unknown format, bracket or fixture status; reads unknown pairing text as the default', async () => {
    const { d1, raw } = createSqliteD1(MIGRATIONS)
    await createOpenSession(d1, drafted(cup()), 'hash')
    expect(() => raw.exec("UPDATE open_tournaments SET format = 'LADDER'")).toThrow(/CHECK/)
    expect(() => raw.exec("UPDATE open_tournament_fixtures SET bracket = 'CONSOLATION'")).toThrow(/CHECK/)
    expect(() => raw.exec("UPDATE open_tournament_fixtures SET status = 'LIVE'")).toThrow(/CHECK/)
    raw.exec("UPDATE open_tournaments SET pairing = 'SOMETHING_NEW', phase = 'LATER'")
    const loaded = (await loadOpenSession(d1, 'CUPCU23456', NOW))?.state.tournament
    expect([loaded?.pairing, loaded?.phase]).toEqual(['RANDOM', 'SETUP'])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/pickleball/open/tournament/reuse.test.ts src/worker/repositories/pickleball/open/openSessions.tournament.test.ts`
Expected: the reuse test PASSES (it guards code that already exists: the five reused modules import only each other). The repository test FAILS: `0018_open_tournaments.sql` is missing (ENOENT), and `kind`/`tournamentFormat` are not create inputs yet.

- [ ] **Step 3: Write the migration**

```sql
-- migrations/pickleball/0018_open_tournaments.sql
-- Free sessions, Phase 3: doubles tournaments (spec 2026-10-11-pickleball-free-open-play-design.md §3.2, §6).
--
-- A tournament is an open_sessions row with kind = 'TOURNAMENT' (that CHECK
-- was written wide in 0016 for exactly this). It reuses the session's courts,
-- players, matches (open_matches.fixture_id, also from 0016), captains and
-- the 7-day purge: every table below cascades from open_sessions.
--
-- CHECKs: format, bracket and fixture status mirror the reused generator
-- (src/lib/pickleball/tournament/generateFixtures.ts), whose values the spec
-- fixes ("unchanged", §6.2). pairing, seeding and phase are this product's own
-- and may grow, so they carry no CHECK and are normalized on read. A CHECK
-- cannot be widened on D1 later (docs/pickleball/architecture.md, "Schema
-- constraint").
--
-- Rows have no order column: the engine keeps entrants sorted by seed and
-- fixtures in one canonical order (tournament/order.ts), and the loader reads
-- them back in that same order.
--
-- Entrant and fixture ids reference each other only as text: a regenerated
-- draft deletes and re-inserts both in one batch, and the pure engine is what
-- keeps them consistent (drawEdits.ts validates every change).

CREATE TABLE open_tournaments (
  session_id TEXT PRIMARY KEY REFERENCES open_sessions(id) ON DELETE CASCADE,
  format     TEXT NOT NULL CHECK (format IN ('ROUND_ROBIN', 'POOL_TO_BRACKET', 'SINGLE_ELIMINATION', 'DOUBLE_ELIMINATION')),
  pairing    TEXT NOT NULL,
  seeding    TEXT NOT NULL,
  phase      TEXT NOT NULL,
  started_at TEXT
);

CREATE TABLE open_tournament_entrants (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL REFERENCES open_sessions(id) ON DELETE CASCADE,
  player_a_id TEXT NOT NULL,
  player_b_id TEXT NOT NULL,
  seed        INTEGER NOT NULL,
  pool_label  TEXT
);
CREATE INDEX idx_open_tournament_entrants_session ON open_tournament_entrants(session_id, seed);

CREATE TABLE open_tournament_fixtures (
  id                TEXT PRIMARY KEY,
  session_id        TEXT NOT NULL REFERENCES open_sessions(id) ON DELETE CASCADE,
  bracket           TEXT NOT NULL CHECK (bracket IN ('POOL', 'MAIN', 'LOSERS')),
  pool_label        TEXT,
  round_number      INTEGER NOT NULL,
  position          INTEGER NOT NULL,
  entrant_a_id      TEXT,
  entrant_b_id      TEXT,
  source_a          TEXT,
  source_b          TEXT,
  winner_entrant_id TEXT,
  status            TEXT NOT NULL CHECK (status IN ('PENDING', 'READY', 'IN_PROGRESS', 'FINISHED', 'BYE'))
);
CREATE INDEX idx_open_tournament_fixtures_session ON open_tournament_fixtures(session_id);
```

- [ ] **Step 4: Write the tournament types and the canonical order**

```ts
// src/lib/pickleball/open/tournament/types.ts
// Doubles tournaments inside a free session (spec §6). The fixture shape is
// exactly the reused generator's (src/lib/pickleball/tournament/
// generateFixtures.ts), plus an id and a winner, so advanceBracket,
// resolvePoolQualifiers, nextPlayableFixture and rankTournamentStandings run
// on it unchanged.
import type { TournamentFormat } from '../../tournament/generateFixtures'

export type { TournamentFormat }
export type PairingMethod = 'RANDOM' | 'BALANCED' | 'MANUAL'
export type SeedingMethod = 'RANDOM' | 'BY_SKILL' | 'MANUAL'
/** SETUP: no draw yet. DRAFT: generated, freely editable. RUNNING: locked shape. FINISHED: every game played. */
export type TournamentPhase = 'SETUP' | 'DRAFT' | 'RUNNING' | 'FINISHED'
export type FixtureBracket = 'POOL' | 'MAIN' | 'LOSERS'
export type FixtureStatus = 'PENDING' | 'READY' | 'IN_PROGRESS' | 'FINISHED' | 'BYE'

/** A pair. Results belong to the pair, so a substitute keeps them (spec §6.5). */
export interface TournamentEntrant {
  id: string
  playerIds: readonly [string, string]
  seed: number
  poolLabel: string | null
}

export interface TournamentFixture {
  id: string
  bracket: FixtureBracket
  poolLabel: string | null
  roundNumber: number
  position: number
  entrantAId: string | null
  entrantBId: string | null
  /** WINNER_OF:<fixture id>, LOSER_OF:<fixture id> or POOL_RANK:<pool>:<rank>; null when placed at generation. */
  sourceA: string | null
  sourceB: string | null
  winnerEntrantId: string | null
  status: FixtureStatus
}

export interface TournamentState {
  format: TournamentFormat
  pairing: PairingMethod
  seeding: SeedingMethod
  phase: TournamentPhase
  startedAt: string | null
  entrants: readonly TournamentEntrant[]
  fixtures: readonly TournamentFixture[]
}

/** Draft edits (spec §6.4): unrestricted, each re-validated by drawEdits.ts. */
export type DraftEdit =
  | { kind: 'SWAP_PLAYERS'; playerIds: readonly [string, string] }
  | { kind: 'SWAP_PAIRS'; entrantIds: readonly [string, string] }
  | { kind: 'MOVE_PAIR'; entrantId: string; poolLabel: string }
  | { kind: 'SET_OPPONENT'; fixtureId: string; side: 'A' | 'B'; entrantId: string }

/** The only edits once the draw is locked (spec §6.5). */
export type RunningEdit =
  | { kind: 'SUBSTITUTE'; entrantId: string; outPlayerId: string; inPlayerId: string }
  | { kind: 'SWAP_OPPONENTS'; fixtureId: string; side: 'A' | 'B'; otherFixtureId: string; otherSide: 'A' | 'B' }

export type EditResult = { ok: true; tournament: TournamentState } | { ok: false; reason: string }

/** Injected randomness, so the engine stays pure: an integer in [0, maxExclusive). */
export type RandomInt = (maxExclusive: number) => number

export const TOURNAMENT_FORMATS: readonly TournamentFormat[] = ['ROUND_ROBIN', 'POOL_TO_BRACKET', 'SINGLE_ELIMINATION', 'DOUBLE_ELIMINATION']
export const PAIRING_METHODS: readonly PairingMethod[] = ['RANDOM', 'BALANCED', 'MANUAL']
export const SEEDING_METHODS: readonly SeedingMethod[] = ['RANDOM', 'BY_SKILL', 'MANUAL']
const PHASES: readonly TournamentPhase[] = ['SETUP', 'DRAFT', 'RUNNING', 'FINISHED']

export function emptyTournament(format: TournamentFormat = 'ROUND_ROBIN'): TournamentState {
  return { format, pairing: 'RANDOM', seeding: 'RANDOM', phase: 'SETUP', startedAt: null, entrants: [], fixtures: [] }
}

/** Stored values are text (no CHECK on these columns): anything unknown reads as the default. */
export function normalizePairing(value: unknown): PairingMethod {
  return PAIRING_METHODS.includes(value as PairingMethod) ? (value as PairingMethod) : 'RANDOM'
}
export function normalizeSeeding(value: unknown): SeedingMethod {
  return SEEDING_METHODS.includes(value as SeedingMethod) ? (value as SeedingMethod) : 'RANDOM'
}
export function normalizePhase(value: unknown): TournamentPhase {
  return PHASES.includes(value as TournamentPhase) ? (value as TournamentPhase) : 'SETUP'
}
```

```ts
// src/lib/pickleball/open/tournament/order.ts
// One canonical order for entrants and fixtures. The repository reads rows
// back in exactly this order (no order column is stored), so memory and a
// reload from D1 always agree, and nextPlayableFixture's ties are stable.
import type { FixtureBracket, TournamentEntrant, TournamentFixture } from './types'

const BRACKET_RANK: Record<FixtureBracket, number> = { POOL: 0, MAIN: 1, LOSERS: 2 }

/** Same order as the SQL: bracket (POOL, MAIN, LOSERS), pool label (null first), round, position. */
export function compareFixtures(a: TournamentFixture, b: TournamentFixture): number {
  return BRACKET_RANK[a.bracket] - BRACKET_RANK[b.bracket]
    || (a.poolLabel ?? '').localeCompare(b.poolLabel ?? '')
    || a.roundNumber - b.roundNumber
    || a.position - b.position
}

export function sortFixtures(fixtures: readonly TournamentFixture[]): TournamentFixture[] {
  return [...fixtures].sort(compareFixtures)
}

export function sortEntrants(entrants: readonly TournamentEntrant[]): TournamentEntrant[] {
  return [...entrants].sort((a, b) => a.seed - b.seed)
}

export const FIXTURE_ORDER_SQL = `CASE bracket WHEN 'POOL' THEN 0 WHEN 'MAIN' THEN 1 ELSE 2 END, COALESCE(pool_label, ''), round_number, position`
```

- [ ] **Step 5: Thread `fixtureId`, `tournament` and `random` through the open-play types**

In `src/lib/pickleball/open/types.ts`:

1. Find:

```ts
export type StackingMode = 'PADDLE_STACK' | 'WINNERS_LOSERS' | 'BY_STANDING' | 'BALANCED'
```

   Replace with:

```ts
import type { RandomInt, TournamentState } from './tournament/types'

export type StackingMode = 'PADDLE_STACK' | 'WINNERS_LOSERS' | 'BY_STANDING' | 'BALANCED'
```

2. Find:

```ts
  recordedBy: string | null
}
```

   Replace with:

```ts
  recordedBy: string | null
  /** The tournament fixture this game plays (spec §6.6); null in open play. */
  fixtureId: string | null
}
```

3. Find:

```ts
  matches: readonly OpenMatch[]
  version: number
```

   Replace with:

```ts
  matches: readonly OpenMatch[]
  /** Set when kind is TOURNAMENT, null for open play. */
  tournament: TournamentState | null
  version: number
```

4. Find:

```ts
  actor?: string
}
```

   Replace with:

```ts
  actor?: string
  /** Crypto randomness for random pairing and seeding; supplied by the Durable Object. */
  random?: RandomInt
}
```


In `src/lib/pickleball/open/modes/paddleStack.ts` (a tournament proposal carries its fixture):

1. Find:

```ts
  teamB: Team
}
```

   Replace with:

```ts
  teamB: Team
  /** Set only for a tournament game: the fixture this proposal plays. */
  fixtureId?: string
}
```


In `src/lib/pickleball/open/propose.ts`, `addProposal` stores it:

1. Find:

```ts
        scoreA: null, scoreB: null, winner: null, proposedAt: ctx.now, startedAt: null, finishedAt: null, recordedBy: null,
      },
```

   Replace with:

```ts
        scoreA: null, scoreB: null, winner: null, proposedAt: ctx.now, startedAt: null, finishedAt: null, recordedBy: null,
        fixtureId: proposal.fixtureId ?? null,
      },
```


Every other place that builds a whole `OpenMatch` or `OpenSessionState` literal:

1. Find:

```ts
    id, courtId, seq: minute, status: 'FINISHED', teamA, teamB, scoreA, scoreB, winner,
    proposedAt: at(minute), startedAt: at(minute), finishedAt: at(minute + 10), recordedBy: 'Host',
  }
```

   Replace with:

```ts
    id, courtId, seq: minute, status: 'FINISHED', teamA, teamB, scoreA, scoreB, winner,
    proposedAt: at(minute), startedAt: at(minute), finishedAt: at(minute + 10), recordedBy: 'Host', fixtureId: null,
  }
```

2. Find:

```ts
    id: 's1', publicCode: 'ABCDE23456', kind: 'OPEN_PLAY', name: 'Sunday', hostDisplayName: 'Mike', location: null,
    status: 'ACTIVE', settings: DEFAULT_SETTINGS, players: [], courts: [court('c1', 1)], matches: [],
    version: 1, createdAt: T0, lastActivityAt: T0, expiresAt: at(7 * 24 * 60), ...overrides,
```

   Replace with:

```ts
    id: 's1', publicCode: 'ABCDE23456', kind: 'OPEN_PLAY', name: 'Sunday', hostDisplayName: 'Mike', location: null,
    status: 'ACTIVE', settings: DEFAULT_SETTINGS, players: [], courts: [court('c1', 1)], matches: [], tournament: null,
    version: 1, createdAt: T0, lastActivityAt: T0, expiresAt: at(7 * 24 * 60), ...overrides,
```


1. Find:

```ts
    id: 'example', publicCode: 'EXAMPLE234', kind: 'OPEN_PLAY', name: 'Example', hostDisplayName: 'Host', location: null,
    status: 'ACTIVE', settings: { ...DEFAULT_SETTINGS, mode }, version: 1, createdAt: iso(0), lastActivityAt: iso(0), expiresAt: iso(10_000),
    players: NAMES.map((name, i) => ({
```

   Replace with:

```ts
    id: 'example', publicCode: 'EXAMPLE234', kind: 'OPEN_PLAY', name: 'Example', hostDisplayName: 'Host', location: null,
    status: 'ACTIVE', settings: { ...DEFAULT_SETTINGS, mode }, version: 1, createdAt: iso(0), lastActivityAt: iso(0), expiresAt: iso(10_000), tournament: null,
    players: NAMES.map((name, i) => ({
```


1. Find:

```ts
        id: 'm0', courtId: 'c2', seq: 1, status: 'IN_PROGRESS' as const, teamA: ['b', 'c'] as [string, string], teamB: ['d', 'e'] as [string, string],
        scoreA: null, scoreB: null, winner: null, proposedAt: at(0), startedAt: at(0), finishedAt: null, recordedBy: null,
      }],
```

   Replace with:

```ts
        id: 'm0', courtId: 'c2', seq: 1, status: 'IN_PROGRESS' as const, teamA: ['b', 'c'] as [string, string], teamB: ['d', 'e'] as [string, string],
        scoreA: null, scoreB: null, winner: null, proposedAt: at(0), startedAt: at(0), finishedAt: null, recordedBy: null, fixtureId: null,
      }],
```


The captain snapshot builds its matches field by field, so the new field must be left out of its type explicitly (a captain's court shows the fixture label instead, from Task 7). In `src/lib/pickleball/open/snapshot.ts`:

1. Find:

```ts

/** A match as a captain sees it: who saved a result (recordedBy) stays with the host. */
export type CaptainMatch = Omit<OpenMatch, 'recordedBy'>

```

   Replace with:

```ts

/**
 * A match as a captain sees it: who saved a result (recordedBy) stays with the
 * host, and the fixture id stays out too (the court carries its fixture label).
 */
export type CaptainMatch = Omit<OpenMatch, 'recordedBy' | 'fixtureId'>

```


In `src/lib/pickleball/open/create.ts` (kind at create; a tournament starts in setup):

1. Find:

```ts
import { normalizeSettings } from './settings'
import { addMs, LIMITS, type CommandContext, type OpenPlayer, type OpenSessionState, type SessionSettings } from './types'
```

   Replace with:

```ts
import { normalizeSettings } from './settings'
import { emptyTournament, type TournamentFormat } from './tournament/types'
import { addMs, LIMITS, type CommandContext, type OpenPlayer, type OpenSessionState, type SessionSettings } from './types'
```

2. Find:

```ts
  players: readonly RosterEntry[]
}
```

   Replace with:

```ts
  players: readonly RosterEntry[]
  /** Open play unless stated. A session's kind never changes after creation. */
  kind?: OpenSessionState['kind']
  /** The format a tournament starts with; the host can change it until Start. */
  tournamentFormat?: TournamentFormat
}
```

3. Find:

```ts
    publicCode: ctx.publicCode,
    kind: 'OPEN_PLAY',
    name: input.name.trim(),
```

   Replace with:

```ts
    publicCode: ctx.publicCode,
    kind: input.kind ?? 'OPEN_PLAY',
    name: input.name.trim(),
```

4. Find:

```ts
    matches: [],
    version: 1,
```

   Replace with:

```ts
    matches: [],
    tournament: input.kind === 'TOURNAMENT' ? emptyTournament(input.tournamentFormat) : null,
    version: 1,
```


- [ ] **Step 6: Diff the tournament rows**

Replace `src/lib/pickleball/open/diff.ts` with:

```ts
import type { TournamentEntrant, TournamentFixture, TournamentState } from './tournament/types'
import type { OpenCourt, OpenMatch, OpenPlayer, OpenSessionState } from './types'

export interface StateDiff {
  sessionChanged: boolean
  upsertPlayers: OpenPlayer[]
  upsertCourts: OpenCourt[]
  upsertMatches: OpenMatch[]
  deleteMatchIds: string[]
  /** The tournament's own row: format, pairing, seeding, phase, start time. */
  tournamentChanged: boolean
  upsertEntrants: TournamentEntrant[]
  deleteEntrantIds: string[]
  upsertFixtures: TournamentFixture[]
  deleteFixtureIds: string[]
}

function changed<T extends { id: string }>(prev: readonly T[], next: readonly T[]): T[] {
  const before = new Map(prev.map((row) => [row.id, JSON.stringify(row)]))
  return next.filter((row) => before.get(row.id) !== JSON.stringify(row))
}

function removed<T extends { id: string }>(prev: readonly T[], next: readonly T[]): string[] {
  const kept = new Set(next.map((row) => row.id))
  return prev.filter((row) => !kept.has(row.id)).map((row) => row.id)
}

const SESSION_FIELDS = ['name', 'hostDisplayName', 'location', 'status', 'settings', 'version', 'lastActivityAt', 'expiresAt'] as const

function tournamentRow(t: TournamentState | null): string {
  return t ? JSON.stringify([t.format, t.pairing, t.seeding, t.phase, t.startedAt]) : ''
}

export function diffState(prev: OpenSessionState, next: OpenSessionState): StateDiff {
  const before = prev.tournament
  const after = next.tournament
  return {
    sessionChanged: SESSION_FIELDS.some((field) => JSON.stringify(prev[field]) !== JSON.stringify(next[field])),
    upsertPlayers: changed(prev.players, next.players),
    upsertCourts: changed(prev.courts, next.courts),
    upsertMatches: changed(prev.matches, next.matches),
    deleteMatchIds: removed(prev.matches, next.matches),
    tournamentChanged: after !== null && tournamentRow(before) !== tournamentRow(after),
    upsertEntrants: changed(before?.entrants ?? [], after?.entrants ?? []),
    deleteEntrantIds: removed(before?.entrants ?? [], after?.entrants ?? []),
    upsertFixtures: changed(before?.fixtures ?? [], after?.fixtures ?? []),
    deleteFixtureIds: removed(before?.fixtures ?? [], after?.fixtures ?? []),
  }
}
```

- [ ] **Step 7: Load and persist the tournament in the repository**

Replace `src/worker/repositories/pickleball/open/openSessions.ts` with the version below. Changes from Phase 2: `fixture_id` is written and read, a tournament session loads its three tables (open play skips the queries), `createOpenSession` inserts the tournament rows, and `persistDiff` deletes stale fixtures and entrants before upserting changed ones, in the same batch.

```ts
// Every SQL statement for free open play lives here (repository pattern).
// Writes are always one db.batch() -- D1 batches are transactional, so a
// command is either fully stored or not stored at all.
import { diffState } from '../../../../lib/pickleball/open/diff'
import { normalizeSettings } from '../../../../lib/pickleball/open/settings'
import { FIXTURE_ORDER_SQL } from '../../../../lib/pickleball/open/tournament/order'
import {
  normalizePairing, normalizePhase, normalizeSeeding,
  type TournamentEntrant, type TournamentFixture, type TournamentState,
} from '../../../../lib/pickleball/open/tournament/types'
import type { CaptainRecord, OpenCourt, OpenMatch, OpenPlayer, OpenSessionState, Team } from '../../../../lib/pickleball/open/types'

interface SessionRow {
  id: string; public_code: string; host_key_hash: string; kind: OpenSessionState['kind']; name: string
  host_display_name: string; location: string | null; settings_json: string; status: OpenSessionState['status']
  version: number; created_at: string; last_activity_at: string; expires_at: string
}
interface PlayerRow {
  id: string; name: string; skill: number | null; dupr_id: string | null; status: OpenPlayer['status']
  games_offset: number; joined_at: string; waiting_since: string; position: number
}
interface CourtRow { id: string; label: string; position: number; enabled: number }
interface MatchRow {
  id: string; court_id: string; seq: number; status: OpenMatch['status']; team_a_json: string; team_b_json: string
  score_a: number | null; score_b: number | null; winner: OpenMatch['winner']; proposed_at: string
  started_at: string | null; finished_at: string | null; recorded_by: string | null; fixture_id: string | null
}
interface CaptainRow { id: string; court_id: string; key_hash: string; label: string; created_at: string }
interface TournamentRow { format: TournamentState['format']; pairing: string; seeding: string; phase: string; started_at: string | null }
interface EntrantRow { id: string; player_a_id: string; player_b_id: string; seed: number; pool_label: string | null }
interface FixtureRow {
  id: string; bracket: TournamentFixture['bracket']; pool_label: string | null; round_number: number; position: number
  entrant_a_id: string | null; entrant_b_id: string | null; source_a: string | null; source_b: string | null
  winner_entrant_id: string | null; status: TournamentFixture['status']
}

export interface LoadedSession {
  state: OpenSessionState
  hostKeyHash: string
  /** Live (unrevoked) captain links, oldest first. */
  captains: CaptainRecord[]
}

const UPSERT_PLAYER = `INSERT INTO open_players (id, session_id, name, skill, dupr_id, status, games_offset, joined_at, waiting_since, position)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET name = excluded.name, skill = excluded.skill, dupr_id = excluded.dupr_id, status = excluded.status,
    games_offset = excluded.games_offset, waiting_since = excluded.waiting_since, position = excluded.position`
const UPSERT_COURT = `INSERT INTO open_courts (id, session_id, label, position, enabled) VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET label = excluded.label, position = excluded.position, enabled = excluded.enabled`
const UPSERT_MATCH = `INSERT INTO open_matches (id, session_id, court_id, seq, status, team_a_json, team_b_json, score_a, score_b, winner, fixture_id, proposed_at, started_at, finished_at, recorded_by)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET status = excluded.status, team_a_json = excluded.team_a_json, team_b_json = excluded.team_b_json,
    score_a = excluded.score_a, score_b = excluded.score_b, winner = excluded.winner, started_at = excluded.started_at,
    finished_at = excluded.finished_at, recorded_by = excluded.recorded_by, fixture_id = excluded.fixture_id`
const UPSERT_TOURNAMENT = `INSERT INTO open_tournaments (session_id, format, pairing, seeding, phase, started_at) VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(session_id) DO UPDATE SET format = excluded.format, pairing = excluded.pairing, seeding = excluded.seeding,
    phase = excluded.phase, started_at = excluded.started_at`
const UPSERT_ENTRANT = `INSERT INTO open_tournament_entrants (id, session_id, player_a_id, player_b_id, seed, pool_label) VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET player_a_id = excluded.player_a_id, player_b_id = excluded.player_b_id, seed = excluded.seed,
    pool_label = excluded.pool_label`
const UPSERT_FIXTURE = `INSERT INTO open_tournament_fixtures (id, session_id, bracket, pool_label, round_number, position, entrant_a_id, entrant_b_id,
    source_a, source_b, winner_entrant_id, status)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET bracket = excluded.bracket, pool_label = excluded.pool_label, round_number = excluded.round_number,
    position = excluded.position, entrant_a_id = excluded.entrant_a_id, entrant_b_id = excluded.entrant_b_id, source_a = excluded.source_a,
    source_b = excluded.source_b, winner_entrant_id = excluded.winner_entrant_id, status = excluded.status`

function playerStatement(db: D1Database, sessionId: string, p: OpenPlayer): D1PreparedStatement {
  return db.prepare(UPSERT_PLAYER).bind(p.id, sessionId, p.name, p.skill, p.duprId, p.status, p.gamesOffset, p.joinedAt, p.waitingSince, p.position)
}
function courtStatement(db: D1Database, sessionId: string, c: OpenCourt): D1PreparedStatement {
  return db.prepare(UPSERT_COURT).bind(c.id, sessionId, c.label, c.position, c.enabled ? 1 : 0)
}
function matchStatement(db: D1Database, sessionId: string, m: OpenMatch): D1PreparedStatement {
  return db.prepare(UPSERT_MATCH).bind(
    m.id, sessionId, m.courtId, m.seq, m.status, JSON.stringify(m.teamA), JSON.stringify(m.teamB),
    m.scoreA, m.scoreB, m.winner, m.fixtureId, m.proposedAt, m.startedAt, m.finishedAt, m.recordedBy,
  )
}
function tournamentStatement(db: D1Database, sessionId: string, t: TournamentState): D1PreparedStatement {
  return db.prepare(UPSERT_TOURNAMENT).bind(sessionId, t.format, t.pairing, t.seeding, t.phase, t.startedAt)
}
function entrantStatement(db: D1Database, sessionId: string, e: TournamentEntrant): D1PreparedStatement {
  return db.prepare(UPSERT_ENTRANT).bind(e.id, sessionId, e.playerIds[0], e.playerIds[1], e.seed, e.poolLabel)
}
function fixtureStatement(db: D1Database, sessionId: string, f: TournamentFixture): D1PreparedStatement {
  return db.prepare(UPSERT_FIXTURE).bind(
    f.id, sessionId, f.bracket, f.poolLabel, f.roundNumber, f.position, f.entrantAId, f.entrantBId,
    f.sourceA, f.sourceB, f.winnerEntrantId, f.status,
  )
}
function sessionUpdate(db: D1Database, s: OpenSessionState): D1PreparedStatement {
  return db.prepare(`UPDATE open_sessions SET name = ?, host_display_name = ?, location = ?, settings_json = ?, status = ?,
      version = ?, last_activity_at = ?, expires_at = ? WHERE id = ?`)
    .bind(s.name, s.hostDisplayName, s.location, JSON.stringify(s.settings), s.status, s.version, s.lastActivityAt, s.expiresAt, s.id)
}

export async function createOpenSession(db: D1Database, state: OpenSessionState, hostKeyHash: string): Promise<void> {
  const t = state.tournament
  await db.batch([
    db.prepare(`INSERT INTO open_sessions (id, public_code, host_key_hash, kind, name, host_display_name, location, settings_json, status, version, created_at, last_activity_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(state.id, state.publicCode, hostKeyHash, state.kind, state.name, state.hostDisplayName, state.location,
        JSON.stringify(state.settings), state.status, state.version, state.createdAt, state.lastActivityAt, state.expiresAt),
    ...state.courts.map((c) => courtStatement(db, state.id, c)),
    ...state.players.map((p) => playerStatement(db, state.id, p)),
    ...state.matches.map((m) => matchStatement(db, state.id, m)),
    ...(t
      ? [
          tournamentStatement(db, state.id, t),
          ...t.entrants.map((e) => entrantStatement(db, state.id, e)),
          ...t.fixtures.map((f) => fixtureStatement(db, state.id, f)),
        ]
      : []),
  ])
}

// The row objects below deliberately use the same key order as the
// reducer/create code (and tournament/draw.ts for tournament rows). diffState
// compares rows with JSON.stringify, so a different order would make every
// loaded row look changed.
async function loadTournament(db: D1Database, sessionId: string): Promise<TournamentState | null> {
  const meta = await db.prepare('SELECT * FROM open_tournaments WHERE session_id = ?').bind(sessionId).first<TournamentRow>()
  if (!meta) return null
  const [entrants, fixtures] = await Promise.all([
    db.prepare('SELECT * FROM open_tournament_entrants WHERE session_id = ? ORDER BY seed').bind(sessionId).all<EntrantRow>(),
    db.prepare(`SELECT * FROM open_tournament_fixtures WHERE session_id = ? ORDER BY ${FIXTURE_ORDER_SQL}`).bind(sessionId).all<FixtureRow>(),
  ])
  return {
    format: meta.format, pairing: normalizePairing(meta.pairing), seeding: normalizeSeeding(meta.seeding),
    phase: normalizePhase(meta.phase), startedAt: meta.started_at,
    entrants: entrants.results.map((e) => ({ id: e.id, playerIds: [e.player_a_id, e.player_b_id] as const, seed: e.seed, poolLabel: e.pool_label })),
    fixtures: fixtures.results.map((f) => ({
      id: f.id, bracket: f.bracket, poolLabel: f.pool_label, roundNumber: f.round_number, position: f.position,
      entrantAId: f.entrant_a_id, entrantBId: f.entrant_b_id, sourceA: f.source_a, sourceB: f.source_b,
      winnerEntrantId: f.winner_entrant_id, status: f.status,
    })),
  }
}

export async function loadOpenSession(db: D1Database, code: string, nowIso: string): Promise<LoadedSession | null> {
  const session = await db.prepare('SELECT * FROM open_sessions WHERE public_code = ? AND expires_at > ?').bind(code, nowIso).first<SessionRow>()
  if (!session) return null
  const [players, courts, matches, captains, tournament] = await Promise.all([
    db.prepare('SELECT * FROM open_players WHERE session_id = ? ORDER BY position').bind(session.id).all<PlayerRow>(),
    db.prepare('SELECT * FROM open_courts WHERE session_id = ? ORDER BY position').bind(session.id).all<CourtRow>(),
    db.prepare('SELECT * FROM open_matches WHERE session_id = ? ORDER BY seq').bind(session.id).all<MatchRow>(),
    db.prepare('SELECT * FROM open_captains WHERE session_id = ? AND revoked_at IS NULL ORDER BY created_at, id').bind(session.id).all<CaptainRow>(),
    session.kind === 'TOURNAMENT' ? loadTournament(db, session.id) : Promise.resolve(null),
  ])
  return {
    hostKeyHash: session.host_key_hash,
    captains: captains.results.map((c) => ({ id: c.id, label: c.label, courtId: c.court_id, keyHash: c.key_hash, createdAt: c.created_at })),
    state: {
      id: session.id, publicCode: session.public_code, kind: session.kind, name: session.name,
      hostDisplayName: session.host_display_name, location: session.location, status: session.status,
      // Sessions from before a settings field existed load with its default (settings.ts).
      settings: normalizeSettings(JSON.parse(session.settings_json)), version: session.version, createdAt: session.created_at,
      lastActivityAt: session.last_activity_at, expiresAt: session.expires_at,
      players: players.results.map((p) => ({
        id: p.id, name: p.name, skill: p.skill, duprId: p.dupr_id, status: p.status, gamesOffset: p.games_offset,
        joinedAt: p.joined_at, waitingSince: p.waiting_since, position: p.position,
      })),
      courts: courts.results.map((c) => ({ id: c.id, label: c.label, position: c.position, enabled: c.enabled === 1 })),
      matches: matches.results.map((m) => ({
        id: m.id, courtId: m.court_id, seq: m.seq, status: m.status,
        teamA: JSON.parse(m.team_a_json) as Team, teamB: JSON.parse(m.team_b_json) as Team,
        scoreA: m.score_a, scoreB: m.score_b, winner: m.winner, proposedAt: m.proposed_at,
        startedAt: m.started_at, finishedAt: m.finished_at, recordedBy: m.recorded_by, fixtureId: m.fixture_id,
      })),
      // A tournament session always has its row (created with it); open play has none.
      tournament: tournament ?? null,
    },
  }
}

/** Adds a captain link and touches the session, in one batch. */
export async function insertCaptain(db: D1Database, next: OpenSessionState, captain: CaptainRecord): Promise<void> {
  await db.batch([
    db.prepare('INSERT INTO open_captains (id, session_id, court_id, key_hash, label, created_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, NULL)')
      .bind(captain.id, next.id, captain.courtId, captain.keyHash, captain.label, captain.createdAt),
    sessionUpdate(db, next),
  ])
}

/** Revokes a captain link and touches the session, in one batch. False when no live link had that id. */
export async function revokeCaptain(db: D1Database, next: OpenSessionState, captainId: string, now: string): Promise<boolean> {
  const [revoked] = await db.batch([
    db.prepare('UPDATE open_captains SET revoked_at = ? WHERE id = ? AND session_id = ? AND revoked_at IS NULL').bind(now, captainId, next.id),
    sessionUpdate(db, next),
  ])
  return (revoked?.meta.changes ?? 0) > 0
}

export async function persistDiff(
  db: D1Database,
  prev: OpenSessionState,
  next: OpenSessionState,
  idempotency: { key: string; responseJson: string; now: string; cutoff: string } | null,
): Promise<void> {
  const diff = diffState(prev, next)
  const statements: D1PreparedStatement[] = [
    ...(diff.sessionChanged ? [sessionUpdate(db, next)] : []),
    ...diff.deleteMatchIds.map((id) => db.prepare('DELETE FROM open_matches WHERE id = ? AND session_id = ?').bind(id, next.id)),
    ...diff.upsertCourts.map((c) => courtStatement(db, next.id, c)),
    ...diff.upsertPlayers.map((p) => playerStatement(db, next.id, p)),
    ...diff.upsertMatches.map((m) => matchStatement(db, next.id, m)),
    ...(diff.tournamentChanged && next.tournament ? [tournamentStatement(db, next.id, next.tournament)] : []),
    ...diff.deleteFixtureIds.map((id) => db.prepare('DELETE FROM open_tournament_fixtures WHERE id = ? AND session_id = ?').bind(id, next.id)),
    ...diff.deleteEntrantIds.map((id) => db.prepare('DELETE FROM open_tournament_entrants WHERE id = ? AND session_id = ?').bind(id, next.id)),
    ...diff.upsertEntrants.map((e) => entrantStatement(db, next.id, e)),
    ...diff.upsertFixtures.map((f) => fixtureStatement(db, next.id, f)),
    ...(idempotency
      ? [
          db.prepare('DELETE FROM open_idempotency WHERE session_id = ? AND created_at < ?').bind(next.id, idempotency.cutoff),
          db.prepare('INSERT INTO open_idempotency (session_id, key, response_json, created_at) VALUES (?, ?, ?, ?)')
            .bind(next.id, idempotency.key, idempotency.responseJson, idempotency.now),
        ]
      : []),
  ]
  if (statements.length) await db.batch(statements)
}

export async function findIdempotentResponse(db: D1Database, sessionId: string, key: string): Promise<string | null> {
  const row = await db.prepare('SELECT response_json FROM open_idempotency WHERE session_id = ? AND key = ?').bind(sessionId, key).first<{ response_json: string }>()
  return row?.response_json ?? null
}

export async function deleteOpenSession(db: D1Database, sessionId: string): Promise<void> {
  await db.prepare('DELETE FROM open_sessions WHERE id = ?').bind(sessionId).run()
}

// The DELETE repeats the expiry test so a session whose expiry was extended
// between the SELECT and the DELETE (a command landed in that gap) survives.
// Only rows whose DELETE actually removed something are reported as purged.
export async function purgeExpiredOpenSessions(db: D1Database, nowIso: string, limit = 500): Promise<string[]> {
  const expired = await db.prepare('SELECT id, public_code FROM open_sessions WHERE expires_at < ? LIMIT ?').bind(nowIso, limit).all<{ id: string; public_code: string }>()
  if (!expired.results.length) return []
  const deletions = await db.batch(
    expired.results.map((row) => db.prepare('DELETE FROM open_sessions WHERE id = ? AND expires_at < ?').bind(row.id, nowIso)),
  )
  return expired.results.filter((_, index) => (deletions[index]?.meta.changes ?? 0) > 0).map((row) => row.public_code)
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run src/lib/pickleball/open src/worker/repositories/pickleball/open && npm run typecheck`
Expected: PASS, including every Phase 1 and Phase 2 test (a stored open-play session still loads with `tournament: null` and diffs clean).

- [ ] **Step 9: CHANGELOG and commit**

Under `### Added` in `[Unreleased]`:

```markdown
- Free sessions can be tournaments: migration `0018_open_tournaments.sql` adds `open_tournaments`, `open_tournament_entrants` and `open_tournament_fixtures` (all cascade from `open_sessions`, so the 7-day purge covers them), and matches record the fixture they play.
```

```bash
git add migrations/pickleball/0018_open_tournaments.sql src/lib/pickleball/open src/worker/repositories/pickleball/open CHANGELOG.md
git commit -m "feat(pickleball): tournament tables and state for free sessions"
```

---

### Task 2: Pairing, seeding and fair randomness

**Files:**
- Create: `src/lib/pickleball/open/tournament/pairing.ts`, `src/lib/pickleball/open/tournament/pairing.test.ts`
- Modify: `src/lib/pickleball/webCrypto.js`, `src/lib/pickleball/webCrypto.test.js`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: `OpenPlayer` (Task 1 types), `PairingMethod`, `SeedingMethod`, `RandomInt`.
- Produces:
  - `type PairIds = readonly [string, string]`
  - `NEUTRAL_SKILL = 3`
  - `shuffle<T>(items: readonly T[], random: RandomInt): T[]`
  - `formPairs(players: readonly OpenPlayer[], method: PairingMethod, random?: RandomInt): { pairs: PairIds[]; unpaired: string[] }` (throws if a random method has no `random`)
  - `pairSkill(pair: PairIds, players): number`
  - `seedPairs(pairs, method: SeedingMethod, players, random?): PairIds[]` (best seed first)
  - `randomInt(maxExclusive: number): number` in `webCrypto.js` (uniform, rejection sampling; `RangeError` outside 1..2^32)

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest'
import { mulberry32 } from '../testing/simulate'
import { player } from '../testing/fixtures'
import { formPairs, pairSkill, seedPairs, shuffle } from './pairing'

const roster = (skills: Array<number | null>) => skills.map((skill, i) => player(`p${i + 1}`, { name: `P${i + 1}`, position: i + 1, skill }))
const seeded = (seed: number) => {
  const next = mulberry32(seed)
  return (max: number) => Math.floor(next() * max)
}

describe('shuffle', () => {
  it('returns a permutation and leaves the input alone', () => {
    const input = ['a', 'b', 'c', 'd', 'e']
    const out = shuffle(input, seeded(7))
    expect([...out].sort()).toEqual(input)
    expect(input).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('reaches every order of three items (Fisher–Yates, not a biased sort)', () => {
    const seen = new Set<string>()
    for (let seed = 1; seed <= 200; seed += 1) seen.add(shuffle(['a', 'b', 'c'], seeded(seed)).join(''))
    expect(seen.size).toBe(6)
  })
})

describe('formPairs', () => {
  it('random: neighbours after a shuffle, the last one flagged when the count is odd', () => {
    const result = formPairs(roster([3, 3, 3, 3, 3]), 'RANDOM', () => 0)
    expect(result.pairs).toHaveLength(2)
    expect(result.unpaired).toHaveLength(1)
    expect(new Set([...result.pairs.flat(), ...result.unpaired]).size).toBe(5)
  })

  it('random needs a random source', () => {
    expect(() => formPairs(roster([3, 3]), 'RANDOM')).toThrow(/random source/)
  })

  it('balanced: strongest with weakest (snake by skill), no skill counts as 3', () => {
    const result = formPairs(roster([5, 1, 4, 2, null, 3]), 'BALANCED')
    // By skill: p1 5, p3 4, p5 3 (none), p6 3, p4 2, p2 1. Ties by name: P5 before P6.
    expect(result.pairs).toEqual([['p1', 'p2'], ['p3', 'p4'], ['p5', 'p6']])
    expect(result.unpaired).toEqual([])
  })

  it('balanced: with an odd count, the middle player is the one left over', () => {
    expect(formPairs(roster([5, 4, 3, 2, 1]), 'BALANCED')).toEqual({ pairs: [['p1', 'p5'], ['p2', 'p4']], unpaired: ['p3'] })
  })

  it('manual: list order, 1st with 2nd', () => {
    expect(formPairs(roster([1, 2, 3, 4, 5]), 'MANUAL')).toEqual({ pairs: [['p1', 'p2'], ['p3', 'p4']], unpaired: ['p5'] })
  })
})

describe('seedPairs', () => {
  const players = roster([1, 1, 5, 5, 3, 3])
  const pairs = [['p1', 'p2'], ['p3', 'p4'], ['p5', 'p6']] as const

  it('by skill: highest mean pair skill first', () => {
    expect(pairSkill(['p3', 'p5'], players)).toBe(4)
    expect(seedPairs(pairs, 'BY_SKILL', players)).toEqual([['p3', 'p4'], ['p5', 'p6'], ['p1', 'p2']])
  })

  it('manual keeps formation order; random shuffles', () => {
    expect(seedPairs(pairs, 'MANUAL', players)).toEqual(pairs)
    expect(seedPairs(pairs, 'RANDOM', players, () => 0)).toEqual([['p3', 'p4'], ['p5', 'p6'], ['p1', 'p2']])
  })
})
```

In `src/lib/pickleball/webCrypto.test.js`:

1. Find:

```js
import { describe, it, expect } from 'vitest'
import { bytesToBase64Url, base64UrlToBytes, randomBase64Url, sha256Base64Url, hmacSign, hmacVerify } from './webCrypto.js'

```

   Replace with:

```js
import { describe, it, expect } from 'vitest'
import { bytesToBase64Url, base64UrlToBytes, randomBase64Url, randomInt, sha256Base64Url, hmacSign, hmacVerify } from './webCrypto.js'

```

2. Find:

```js
    expect(await hmacVerify('tampered', signature, 'secret-value')).toBe(false)
  })
})
```

   Replace with:

```js
    expect(await hmacVerify('tampered', signature, 'secret-value')).toBe(false)
  })
})

describe('randomInt', () => {
  it('stays in range and reaches every value', () => {
    const seen = new Set()
    for (let i = 0; i < 2000; i += 1) {
      const value = randomInt(6)
      expect(Number.isInteger(value) && value >= 0 && value < 6).toBe(true)
      seen.add(value)
    }
    expect(seen.size).toBe(6)
  })

  it('refuses a range it cannot draw from', () => {
    expect(() => randomInt(0)).toThrow(RangeError)
    expect(() => randomInt(2.5)).toThrow(RangeError)
  })
})
```


- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/pickleball/open/tournament/pairing.test.ts src/lib/pickleball/webCrypto.test.js`
Expected: FAIL. `./pairing` cannot be resolved; `randomInt` is not exported.

- [ ] **Step 3: Implement**

```ts
// src/lib/pickleball/open/tournament/pairing.ts
// Pair formation and seeding (spec §6.1, §6.3). Pure: randomness is passed in
// (the Durable Object supplies crypto.getRandomValues), so tests are exact.
import type { OpenPlayer } from '../types'
import type { PairingMethod, RandomInt, SeedingMethod } from './types'

export type PairIds = readonly [string, string]

export interface PairingResult {
  pairs: PairIds[]
  /** Left over with an odd count: flagged for the host to resolve (spec §6.1). */
  unpaired: string[]
}

/** Skill used when a player gave none: the middle of the self-reported 1–5 scale. */
export const NEUTRAL_SKILL = 3

const skillOf = (player: Pick<OpenPlayer, 'skill'>): number => player.skill ?? NEUTRAL_SKILL

/** Fisher–Yates on a copy. Every order is equally likely when random is uniform. */
export function shuffle<T>(items: readonly T[], random: RandomInt): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = random(i + 1)
    const swap = out[i]
    out[i] = out[j]
    out[j] = swap
  }
  return out
}

function consecutive(ids: readonly string[]): PairingResult {
  const pairs: PairIds[] = []
  for (let i = 0; i + 1 < ids.length; i += 2) pairs.push([ids[i], ids[i + 1]])
  return { pairs, unpaired: ids.length % 2 ? [ids[ids.length - 1]] : [] }
}

function needRandom(random: RandomInt | undefined): RandomInt {
  if (!random) throw new Error('A random source is required for random pairing or seeding.')
  return random
}

/**
 * RANDOM: a shuffle, then neighbours pair up.
 * BALANCED: snake by skill, strongest with weakest; the middle player is left over when the count is odd.
 * MANUAL: the roster in list order, 1st with 2nd, 3rd with 4th (paste your pairs in order), then edit the draft.
 */
export function formPairs(players: readonly OpenPlayer[], method: PairingMethod, random?: RandomInt): PairingResult {
  const ordered = [...players].sort((a, b) => a.position - b.position)
  if (method === 'RANDOM') return consecutive(shuffle(ordered, needRandom(random)).map((p) => p.id))
  if (method === 'MANUAL') return consecutive(ordered.map((p) => p.id))
  const bySkill = [...ordered].sort((a, b) => skillOf(b) - skillOf(a) || a.name.localeCompare(b.name))
  const half = Math.floor(bySkill.length / 2)
  const pairs: PairIds[] = []
  for (let i = 0; i < half; i += 1) pairs.push([bySkill[i].id, bySkill[bySkill.length - 1 - i].id])
  return { pairs, unpaired: bySkill.length % 2 ? [bySkill[half].id] : [] }
}

/** Mean of the two players' skills (spec §6.3 "mean pair skill"). */
export function pairSkill(pair: PairIds, players: readonly OpenPlayer[]): number {
  const skills = pair.map((id) => skillOf(players.find((p) => p.id === id) ?? { skill: null }))
  return (skills[0] + skills[1]) / 2
}

/**
 * Pairs in seed order, best seed first. RANDOM shuffles (the generator takes
 * entrants in seed order, so this is the whole of random seeding); BY_SKILL is
 * mean pair skill, ties kept in formation order; MANUAL keeps formation order
 * for the host to rearrange in the draft.
 */
export function seedPairs(pairs: readonly PairIds[], method: SeedingMethod, players: readonly OpenPlayer[], random?: RandomInt): PairIds[] {
  if (method === 'RANDOM') return shuffle(pairs, needRandom(random))
  if (method === 'MANUAL') return [...pairs]
  return pairs
    .map((pair, index) => ({ pair, index, skill: pairSkill(pair, players) }))
    .sort((a, b) => b.skill - a.skill || a.index - b.index)
    .map((entry) => entry.pair)
}
```

Append to `src/lib/pickleball/webCrypto.js`:

1. Find:

```js
  }
}
```

   Replace with:

```js
  }
}

/**
 * A uniform integer in [0, maxExclusive) from crypto.getRandomValues. Rejection
 * sampling, not a bare modulo, so no value is favoured (random pairing and
 * seeding in tournaments depend on it being fair).
 */
export function randomInt(maxExclusive) {
  if (!Number.isInteger(maxExclusive) || maxExclusive < 1 || maxExclusive > 2 ** 32) {
    throw new RangeError('maxExclusive must be an integer from 1 to 2^32')
  }
  const limit = Math.floor(2 ** 32 / maxExclusive) * maxExclusive
  const buffer = new Uint32Array(1)
  for (;;) {
    crypto.getRandomValues(buffer)
    if (buffer[0] < limit) return buffer[0] % maxExclusive
  }
}
```


- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/pickleball/open/tournament src/lib/pickleball/webCrypto.test.js`
Expected: PASS.

- [ ] **Step 5: CHANGELOG and commit**

```markdown
- Tournament pairs can be drawn at random (an unbiased crypto shuffle), balanced by skill (strongest with weakest) or taken in list order, and seeded at random, by mean pair skill or in the host's order.
```

```bash
git add src/lib/pickleball/open/tournament/pairing.ts src/lib/pickleball/open/tournament/pairing.test.ts src/lib/pickleball/webCrypto.js src/lib/pickleball/webCrypto.test.js CHANGELOG.md
git commit -m "feat(pickleball): tournament pairing and seeding"
```

---

### Task 3: Generating the draw, and naming its rounds

**Files:**
- Create: `src/lib/pickleball/open/tournament/info.ts`, `labels.ts`, `draw.ts`, `draw.test.ts`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: `generateFixtures`, `minimumEntrants`, `GeneratedFixture` (reused); `formPairs`, `seedPairs` (Task 2); `sortEntrants`, `sortFixtures` (Task 1).
- Produces:
  - `info.ts`: `FORMAT_INFO`, `PAIRING_INFO`, `SEEDING_INFO` (`{ label, summary }` per value), `FORMAT_ORDER`, `minimumMessage(format): string`
  - `labels.ts`: `pairName(entrant, players): string` ("Ana & Ben"), `entrantName(t, entrantId, players)`, `roundLabel(format, fixtures, fixture)` ("Semi-final", "Pool A · Round 2", "Losers final", "Grand final"), `fixtureLabel(t, fixture)` (numbered when a round has more than one game: "Semi-final 2"), `sourceLabel(t, source)` ("Winner of Semi-final 1", "Pool B runner-up")
  - `draw.ts`: `DrawOptions { format; pairing; seeding }`, `DrawContext { newId; random? }`, `DrawResult`, `withIds(generated, newId): TournamentFixture[]`, `poolFixtures(label, entrants, newId)`, `drawablePlayers(players)`, `generateDraw(players, options, ctx, maxFixtures): DrawResult`, `unpairedPlayers(t, players): OpenPlayer[]`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { player } from '../testing/fixtures'
import { generateDraw, unpairedPlayers } from './draw'
import { fixtureLabel, sourceLabel } from './labels'
import { compareFixtures } from './order'
import type { TournamentFormat } from './types'

const players = (n: number) => Array.from({ length: n }, (_, i) => player(`p${i + 1}`, { name: `P${i + 1}`, position: i + 1, skill: 5 - (i % 5) }))
const ids = () => {
  let n = 0
  return () => `id${(n += 1)}`
}
const draw = (format: TournamentFormat, n: number, max = 2000) =>
  generateDraw(players(n), { format, pairing: 'MANUAL', seeding: 'MANUAL' }, { newId: ids() }, max)

describe('generateDraw', () => {
  it('makes a draft with pairs in seed order and the generator fixtures, ids for keys', () => {
    const result = draw('SINGLE_ELIMINATION', 10)
    if (!result.ok) throw new Error(result.reason)
    const t = result.tournament
    expect(t.phase).toBe('DRAFT')
    expect(t.entrants.map((e) => [e.seed, e.playerIds])).toEqual([[1, ['p1', 'p2']], [2, ['p3', 'p4']], [3, ['p5', 'p6']], [4, ['p7', 'p8']], [5, ['p9', 'p10']]])
    expect(t.fixtures).toHaveLength(4) // n - 1, byes are not games
    const fixtureIds = new Set(t.fixtures.map((f) => f.id))
    for (const source of t.fixtures.flatMap((f) => [f.sourceA, f.sourceB]).filter(Boolean)) {
      expect(fixtureIds.has(String(source).replace(/^WINNER_OF:/, ''))).toBe(true)
    }
    expect([...t.fixtures].sort(compareFixtures)).toEqual(t.fixtures)
  })

  it('pools: every pair gets its pool label, and the bracket is fed by pool ranks', () => {
    const result = draw('POOL_TO_BRACKET', 16)
    if (!result.ok) throw new Error(result.reason)
    const t = result.tournament
    expect(t.entrants.map((e) => e.poolLabel)).toEqual(['A', 'B', 'B', 'A', 'A', 'B', 'B', 'A'])
    expect(t.fixtures.filter((f) => f.bracket === 'POOL')).toHaveLength(12)
    expect(t.fixtures.filter((f) => f.sourceA?.startsWith('POOL_RANK:')).map((f) => sourceLabel(t, f.sourceA))).toEqual(['Pool A winner', 'Pool B winner'])
  })

  it('refuses too few pairs, naming the minimum', () => {
    expect(draw('POOL_TO_BRACKET', 6)).toEqual({ ok: false, reason: 'Pools, then bracket needs at least 4 pairs (8 players).' })
    expect(draw('DOUBLE_ELIMINATION', 5)).toEqual({ ok: false, reason: 'Double elimination needs at least 3 pairs (6 players).' })
  })

  it('refuses a draw bigger than the session can hold', () => {
    expect(draw('ROUND_ROBIN', 40, 100)).toEqual({ ok: false, reason: 'That draw needs 190 games, more than this session can hold (100). Use pools, or fewer pairs.' })
  })

  it('draws only checked-in players, and flags the odd one out', () => {
    const roster = [...players(9), player('p10', { name: 'Rested', position: 10, status: 'BREAK' })]
    const result = generateDraw(roster, { format: 'ROUND_ROBIN', pairing: 'MANUAL', seeding: 'MANUAL' }, { newId: ids() }, 2000)
    if (!result.ok) throw new Error(result.reason)
    expect(result.tournament.entrants).toHaveLength(4)
    expect(unpairedPlayers(result.tournament, roster).map((p) => p.name)).toEqual(['P9'])
  })
})

describe('labels', () => {
  it('names elimination rounds from the end', () => {
    const result = draw('SINGLE_ELIMINATION', 16) // 8 pairs: quarter-finals, semi-finals, final
    if (!result.ok) throw new Error(result.reason)
    const t = result.tournament
    expect([...new Set(t.fixtures.map((f) => fixtureLabel(t, f).replace(/ \d+$/, '')))]).toEqual(['Quarter-final', 'Semi-final', 'Final'])
    const semi = t.fixtures.find((f) => f.roundNumber === 2 && f.position === 0)!
    expect(fixtureLabel(t, semi)).toBe('Semi-final 1')
    const final = t.fixtures.find((f) => f.roundNumber === 3)!
    expect(sourceLabel(t, final.sourceA)).toBe('Winner of Semi-final 1')
  })

  it('names double elimination and pool rounds', () => {
    const de = draw('DOUBLE_ELIMINATION', 8)
    if (!de.ok) throw new Error(de.reason)
    expect(de.tournament.fixtures.map((f) => fixtureLabel(de.tournament, f))).toEqual([
      'Winners round 1 1', 'Winners round 1 2', 'Winners final', 'Grand final', 'Losers round 1', 'Losers final',
    ])
    const pools = draw('POOL_TO_BRACKET', 8)
    if (!pools.ok) throw new Error(pools.reason)
    expect(fixtureLabel(pools.tournament, pools.tournament.fixtures[0])).toBe('Pool A · Round 1')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/pickleball/open/tournament/draw.test.ts`
Expected: FAIL. `./draw` and `./labels` cannot be resolved.

- [ ] **Step 3: Implement**

```ts
// src/lib/pickleball/open/tournament/info.ts
// Labels and one-line explanations, shared by the console, the create form
// and the public guide so the wording never drifts.
import { minimumEntrants } from '../../tournament/generateFixtures'
import type { PairingMethod, SeedingMethod, TournamentFormat } from './types'

export const FORMAT_INFO: Record<TournamentFormat, { label: string; summary: string }> = {
  ROUND_ROBIN: { label: 'Round robin', summary: 'Every pair plays every other pair once. Most wins takes it.' },
  POOL_TO_BRACKET: { label: 'Pools, then bracket', summary: 'Round robin in pools A, B and so on. The top 2 of each pool go into a knockout bracket.' },
  SINGLE_ELIMINATION: { label: 'Single elimination', summary: 'Lose once and you are out. Top seeds get any byes.' },
  DOUBLE_ELIMINATION: { label: 'Double elimination', summary: 'A first loss drops you to the losers bracket; a second knocks you out. One game decides the grand final.' },
}

export const PAIRING_INFO: Record<PairingMethod, { label: string; summary: string }> = {
  RANDOM: { label: 'Random', summary: 'Partners are drawn at random.' },
  BALANCED: { label: 'Balanced', summary: 'Strongest with weakest by skill, so the pairs come out even.' },
  MANUAL: { label: 'In list order', summary: '1st with 2nd, 3rd with 4th, as on the player list. Swap anyone in the draft.' },
}

export const SEEDING_INFO: Record<SeedingMethod, { label: string; summary: string }> = {
  RANDOM: { label: 'Random', summary: 'The draw order is shuffled.' },
  BY_SKILL: { label: 'By skill', summary: 'Pairs with the highest mean skill are seeded first and kept apart.' },
  MANUAL: { label: 'You choose', summary: 'Pairs keep the order they were made in. Swap any two in the draft.' },
}

export const FORMAT_ORDER: readonly TournamentFormat[] = ['ROUND_ROBIN', 'POOL_TO_BRACKET', 'SINGLE_ELIMINATION', 'DOUBLE_ELIMINATION']

/** "Pools, then bracket needs at least 4 pairs (8 players)." */
export function minimumMessage(format: TournamentFormat): string {
  const pairs = minimumEntrants(format)
  return `${FORMAT_INFO[format].label} needs at least ${pairs} pairs (${pairs * 2} players).`
}
```

```ts
// src/lib/pickleball/open/tournament/labels.ts
// Human names for pairs, rounds and the slots still waiting on a result.
import type { OpenPlayer } from '../types'
import type { TournamentEntrant, TournamentFixture, TournamentFormat, TournamentState } from './types'

export function pairName(entrant: Pick<TournamentEntrant, 'playerIds'>, players: readonly OpenPlayer[]): string {
  return entrant.playerIds.map((id) => players.find((p) => p.id === id)?.name ?? '—').join(' & ')
}

export function entrantName(t: TournamentState, entrantId: string | null, players: readonly OpenPlayer[]): string | null {
  const entrant = entrantId ? t.entrants.find((e) => e.id === entrantId) : undefined
  return entrant ? pairName(entrant, players) : null
}

function maxRound(fixtures: readonly TournamentFixture[], bracket: TournamentFixture['bracket']): number {
  return fixtures.filter((f) => f.bracket === bracket).reduce((max, f) => Math.max(max, f.roundNumber), 0)
}

function eliminationRound(round: number, last: number): string {
  if (round === last) return 'Final'
  if (round === last - 1) return 'Semi-final'
  if (round === last - 2) return 'Quarter-final'
  return `Round ${round}`
}

/** "Pool A · Round 2", "Round 3", "Semi-final", "Winners round 1", "Losers final", "Grand final". */
export function roundLabel(format: TournamentFormat, fixtures: readonly TournamentFixture[], fixture: TournamentFixture): string {
  if (fixture.bracket === 'POOL') return `Pool ${fixture.poolLabel} · Round ${fixture.roundNumber}`
  if (format === 'ROUND_ROBIN') return `Round ${fixture.roundNumber}`
  const lastMain = maxRound(fixtures, 'MAIN')
  if (format !== 'DOUBLE_ELIMINATION') return eliminationRound(fixture.roundNumber, lastMain)
  if (fixture.bracket === 'LOSERS') {
    return fixture.roundNumber === maxRound(fixtures, 'LOSERS') ? 'Losers final' : `Losers round ${fixture.roundNumber}`
  }
  if (fixture.roundNumber === lastMain) return 'Grand final'
  if (fixture.roundNumber === lastMain - 1) return 'Winners final'
  return `Winners round ${fixture.roundNumber}`
}

/** The round label, numbered when that round has more than one game: "Semi-final 2". */
export function fixtureLabel(t: Pick<TournamentState, 'format' | 'fixtures'>, fixture: TournamentFixture): string {
  const label = roundLabel(t.format, t.fixtures, fixture)
  const sameRound = t.fixtures
    .filter((f) => f.bracket === fixture.bracket && f.poolLabel === fixture.poolLabel && f.roundNumber === fixture.roundNumber)
    .sort((a, b) => a.position - b.position)
  return sameRound.length > 1 ? `${label} ${sameRound.findIndex((f) => f.id === fixture.id) + 1}` : label
}

/** What fills an empty slot: "Winner of Semi-final 1", "Loser of Winners round 1 2", "Pool B winner", "Pool A runner-up". */
export function sourceLabel(t: Pick<TournamentState, 'format' | 'fixtures'>, source: string | null): string | null {
  if (!source) return null
  const pool = /^POOL_RANK:([A-H]):(\d+)$/.exec(source)
  if (pool) return `Pool ${pool[1]} ${pool[2] === '1' ? 'winner' : 'runner-up'}`
  const link = /^(WINNER_OF|LOSER_OF):(.+)$/.exec(source)
  const from = link ? t.fixtures.find((f) => f.id === link[2]) : undefined
  if (!link || !from) return null
  return `${link[1] === 'WINNER_OF' ? 'Winner' : 'Loser'} of ${fixtureLabel(t, from)}`
}
```

```ts
// src/lib/pickleball/open/tournament/draw.ts
// Generate (spec §6.4): pairs → seeds → the reused generateFixtures, unchanged.
// The generator's local keys are swapped for real ids here, so every
// WINNER_OF:/LOSER_OF: source names a fixture id from then on.
import { generateFixtures, minimumEntrants, type GeneratedFixture } from '../../tournament/generateFixtures'
import type { OpenPlayer } from '../types'
import { minimumMessage } from './info'
import { sortEntrants, sortFixtures } from './order'
import { formPairs, seedPairs } from './pairing'
import type {
  PairingMethod, RandomInt, SeedingMethod, TournamentEntrant, TournamentFixture, TournamentFormat, TournamentState,
} from './types'

export interface DrawOptions {
  format: TournamentFormat
  pairing: PairingMethod
  seeding: SeedingMethod
}

export interface DrawContext {
  newId: () => string
  random?: RandomInt
}

export type DrawResult = { ok: true; tournament: TournamentState } | { ok: false; reason: string }

/** Generated fixtures with real ids; sources rewritten from generator keys to those ids. */
export function withIds(generated: readonly GeneratedFixture[], newId: () => string): TournamentFixture[] {
  const ids = new Map(generated.map((g) => [g.key, newId()]))
  const rewrite = (source: string | null) => {
    if (!source) return null
    const link = /^(WINNER_OF|LOSER_OF):(.+)$/.exec(source)
    return link ? `${link[1]}:${ids.get(link[2]) ?? link[2]}` : source
  }
  // Key order is the repository loader's (diffState compares JSON).
  return generated.map((g) => ({
    id: ids.get(g.key) as string, bracket: g.bracket, poolLabel: g.poolLabel, roundNumber: g.roundNumber, position: g.position,
    entrantAId: g.entrantAId, entrantBId: g.entrantBId, sourceA: rewrite(g.sourceA), sourceB: rewrite(g.sourceB),
    winnerEntrantId: null, status: g.status,
  }))
}

/** A fresh round robin for one pool, from its pairs in seed order. */
export function poolFixtures(label: string, entrants: readonly TournamentEntrant[], newId: () => string): TournamentFixture[] {
  const seeded = sortEntrants(entrants).map((e) => ({ entrantId: e.id, seed: e.seed }))
  return withIds(generateFixtures('ROUND_ROBIN', seeded), newId).map((f) => ({ ...f, bracket: 'POOL', poolLabel: label }))
}

/** Players who can be drawn: present, not on a break, in list order. */
export function drawablePlayers(players: readonly OpenPlayer[]): OpenPlayer[] {
  return players.filter((p) => p.status === 'ACTIVE').sort((a, b) => a.position - b.position)
}

export function generateDraw(players: readonly OpenPlayer[], options: DrawOptions, ctx: DrawContext, maxFixtures: number): DrawResult {
  const { pairs } = formPairs(drawablePlayers(players), options.pairing, ctx.random)
  if (pairs.length < minimumEntrants(options.format)) return { ok: false, reason: minimumMessage(options.format) }
  const seeded = seedPairs(pairs, options.seeding, players, ctx.random)
  const entrants: TournamentEntrant[] = seeded.map((playerIds, index) => ({ id: ctx.newId(), playerIds, seed: index + 1, poolLabel: null }))
  const fixtures = withIds(generateFixtures(options.format, entrants.map((e) => ({ entrantId: e.id, seed: e.seed }))), ctx.newId)
  if (fixtures.length > maxFixtures) {
    return { ok: false, reason: `That draw needs ${fixtures.length} games, more than this session can hold (${maxFixtures}). Use pools, or fewer pairs.` }
  }
  const poolOf = new Map<string, string>()
  for (const f of fixtures) {
    if (f.bracket !== 'POOL' || !f.poolLabel) continue
    if (f.entrantAId) poolOf.set(f.entrantAId, f.poolLabel)
    if (f.entrantBId) poolOf.set(f.entrantBId, f.poolLabel)
  }
  return {
    ok: true,
    tournament: {
      format: options.format, pairing: options.pairing, seeding: options.seeding, phase: 'DRAFT', startedAt: null,
      entrants: sortEntrants(entrants.map((e) => ({ ...e, poolLabel: poolOf.get(e.id) ?? null }))),
      fixtures: sortFixtures(fixtures),
    },
  }
}

/** ACTIVE players in no pair: the odd one out, a late arrival, or a substitute in waiting. */
export function unpairedPlayers(t: TournamentState, players: readonly OpenPlayer[]): OpenPlayer[] {
  const paired = new Set(t.entrants.flatMap((e) => e.playerIds))
  return drawablePlayers(players).filter((p) => !paired.has(p.id))
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/pickleball/open/tournament`
Expected: PASS.

- [ ] **Step 5: CHANGELOG and commit**

```markdown
- Tournament draws are generated by the existing fixture generator (round robin, pools then a bracket, single and double elimination) as an editable draft; a draw too large for a session, or with too few pairs for its format, is refused with the reason.
```

```bash
git add src/lib/pickleball/open/tournament CHANGELOG.md
git commit -m "feat(pickleball): generate a tournament draw as a draft"
```

---

### Task 4: The draw's rules, and every edit checked against them

**Files:**
- Create: `src/lib/pickleball/open/tournament/drawRules.ts`, `drawEdits.ts`, `drawEdits.test.ts`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: `generateDraw`, `poolFixtures` (Task 3), `pairName`, `roundLabel` (Task 3), `sortEntrants`, `sortFixtures` (Task 1).
- Produces:
  - `drawViolation(before: TournamentState, after: TournamentState, players): string | null`
  - `applyDraftEdit(t, edit: DraftEdit, players, newId): EditResult` — `SWAP_PLAYERS` (two players, or a paired player and a checked-in unpaired one), `SWAP_PAIRS` (seed, pool and every slot), `MOVE_PAIR` (pools only; re-generates both pools' round robins), `SET_OPPONENT` (a swap where the pair already has a slot in that round/bracket, else a replacement). Refused outside `DRAFT`.
  - `applyRunningEdit(t, edit: RunningEdit, players, matches): EditResult` — `SUBSTITUTE` (pair not on court; incoming player not in a pair and not left), `SWAP_OPPONENTS` (same bracket, pool and round; neither game started; both slots filled). Refused outside `RUNNING`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { player } from '../testing/fixtures'
import type { OpenMatch, OpenPlayer } from '../types'
import { generateDraw } from './draw'
import { applyDraftEdit, applyRunningEdit } from './drawEdits'
import type { TournamentFormat, TournamentState } from './types'

const roster = (n: number): OpenPlayer[] => Array.from({ length: n }, (_, i) => player(`p${i + 1}`, { name: `P${i + 1}`, position: i + 1 }))
function ids(prefix = 'id') {
  let n = 0
  return () => `${prefix}${(n += 1)}`
}
function draft(format: TournamentFormat, n: number, players = roster(n)): TournamentState {
  const result = generateDraw(players, { format, pairing: 'MANUAL', seeding: 'MANUAL' }, { newId: ids() }, 2000)
  if (!result.ok) throw new Error(result.reason)
  return result.tournament
}
const seed = (t: TournamentState, n: number) => t.entrants.find((e) => e.seed === n)!
const firstRound = (t: TournamentState) => t.fixtures.filter((f) => f.bracket === 'MAIN' && f.roundNumber === 1)
function expectOk(result: ReturnType<typeof applyDraftEdit>): TournamentState {
  if (!result.ok) throw new Error(result.reason)
  return result.tournament
}

describe('draft edits', () => {
  it('swaps a player between two pairs; the draw itself is untouched', () => {
    const t = draft('ROUND_ROBIN', 8)
    const next = expectOk(applyDraftEdit(t, { kind: 'SWAP_PLAYERS', playerIds: ['p1', 'p3'] }, roster(8), ids('x')))
    expect(next.entrants.map((e) => e.playerIds)).toEqual([['p3', 'p2'], ['p1', 'p4'], ['p5', 'p6'], ['p7', 'p8']])
    expect(next.fixtures).toEqual(t.fixtures)
  })

  it('swaps the odd player into a pair, and refuses swaps that make no sense', () => {
    const players = roster(9)
    const t = draft('ROUND_ROBIN', 9, players)
    expect(expectOk(applyDraftEdit(t, { kind: 'SWAP_PLAYERS', playerIds: ['p9', 'p2'] }, players, ids('x'))).entrants[0].playerIds).toEqual(['p1', 'p9'])
    expect(applyDraftEdit(t, { kind: 'SWAP_PLAYERS', playerIds: ['p1', 'p2'] }, players, ids('x'))).toEqual({ ok: false, reason: 'They are already partners.' })
    const rested = players.map((p) => (p.id === 'p9' ? { ...p, status: 'BREAK' as const } : p))
    expect(applyDraftEdit(t, { kind: 'SWAP_PLAYERS', playerIds: ['p1', 'p9'] }, rested, ids('x'))).toEqual({ ok: false, reason: 'P9 is not checked in. Bring them back first.' })
  })

  it('swaps two pairs: seeds, pools and every slot they hold', () => {
    const t = draft('POOL_TO_BRACKET', 16)
    const [a, b] = [seed(t, 1), seed(t, 2)]
    const next = expectOk(applyDraftEdit(t, { kind: 'SWAP_PAIRS', entrantIds: [a.id, b.id] }, roster(16), ids('x')))
    expect(next.entrants.find((e) => e.id === a.id)).toMatchObject({ seed: 2, poolLabel: b.poolLabel })
    expect(next.fixtures.filter((f) => f.entrantAId === a.id || f.entrantBId === a.id).every((f) => f.poolLabel === b.poolLabel)).toBe(true)
  })

  it('moves a pair to another pool and rebuilds both pools’ games', () => {
    const t = draft('POOL_TO_BRACKET', 16) // 8 pairs: pools A and B of 4
    const mover = t.entrants.find((e) => e.poolLabel === 'A')!
    const next = expectOk(applyDraftEdit(t, { kind: 'MOVE_PAIR', entrantId: mover.id, poolLabel: 'B' }, roster(16), ids('x')))
    expect(next.entrants.filter((e) => e.poolLabel === 'A')).toHaveLength(3)
    expect(next.fixtures.filter((f) => f.poolLabel === 'A')).toHaveLength(3)
    expect(next.fixtures.filter((f) => f.poolLabel === 'B')).toHaveLength(10)
    expect(next.fixtures.filter((f) => f.bracket === 'MAIN')).toEqual(t.fixtures.filter((f) => f.bracket === 'MAIN'))
  })

  it('refuses a move that would leave a pool with one pair, or that has nowhere to go', () => {
    const t = draft('POOL_TO_BRACKET', 8) // 4 pairs: pools of 2
    const mover = t.entrants.find((e) => e.poolLabel === 'A')!
    expect(applyDraftEdit(t, { kind: 'MOVE_PAIR', entrantId: mover.id, poolLabel: 'B' }, roster(8), ids('x')))
      .toEqual({ ok: false, reason: 'Pool A would be left with 1 pair. A pool needs at least 2.' })
    expect(applyDraftEdit(t, { kind: 'MOVE_PAIR', entrantId: mover.id, poolLabel: 'C' }, roster(8), ids('x')))
      .toEqual({ ok: false, reason: 'There is no Pool C in this draw.' })
    const rr = draft('ROUND_ROBIN', 8)
    expect(applyDraftEdit(rr, { kind: 'MOVE_PAIR', entrantId: rr.entrants[0].id, poolLabel: 'B' }, roster(8), ids('x')))
      .toEqual({ ok: false, reason: 'Only a draw with pools has pools to move between.' })
  })

  it('changes a first-round opponent in a bracket: the two pairs trade places', () => {
    const t = draft('SINGLE_ELIMINATION', 16) // 1v8, 4v5, 2v7, 3v6
    const [first, second] = firstRound(t)
    const next = expectOk(applyDraftEdit(t, { kind: 'SET_OPPONENT', fixtureId: first.id, side: 'B', entrantId: second.entrantBId! }, roster(16), ids('x')))
    const [f1, f2] = firstRound(next)
    expect([f1.entrantAId, f1.entrantBId]).toEqual([seed(t, 1).id, seed(t, 5).id])
    expect([f2.entrantAId, f2.entrantBId]).toEqual([seed(t, 4).id, seed(t, 8).id])
  })

  it('refuses an opponent change that breaks a round robin, and says why', () => {
    const t = draft('ROUND_ROBIN', 8)
    const [g1, g2] = t.fixtures.filter((f) => f.roundNumber === 1)
    const result = applyDraftEdit(t, { kind: 'SET_OPPONENT', fixtureId: g1.id, side: 'B', entrantId: g2.entrantBId! }, roster(8), ids('x'))
    expect(result.ok).toBe(false)
    expect(!result.ok && result.reason).toMatch(/would play each other twice\.$/)
  })

  it('refuses a slot that a result fills, and a pair against itself', () => {
    const t = draft('SINGLE_ELIMINATION', 16)
    const final = t.fixtures.find((f) => f.roundNumber === 3)!
    expect(applyDraftEdit(t, { kind: 'SET_OPPONENT', fixtureId: final.id, side: 'A', entrantId: seed(t, 1).id }, roster(16), ids('x')))
      .toEqual({ ok: false, reason: 'That slot is filled by an earlier result, not by the draw.' })
    const [first] = firstRound(t)
    expect(applyDraftEdit(t, { kind: 'SET_OPPONENT', fixtureId: first.id, side: 'B', entrantId: first.entrantAId! }, roster(16), ids('x')))
      .toEqual({ ok: false, reason: 'A pair cannot play itself.' })
  })

  it('is refused once the tournament has started', () => {
    const t = { ...draft('ROUND_ROBIN', 8), phase: 'RUNNING' as const }
    const result = applyDraftEdit(t, { kind: 'SWAP_PLAYERS', playerIds: ['p1', 'p3'] }, roster(8), ids('x'))
    expect(result).toEqual({ ok: false, reason: 'The draw is locked once the tournament starts. You can still substitute a player or swap opponents in a game that has not started.' })
  })
})

describe('running edits', () => {
  const running = (format: TournamentFormat, n: number) => ({ ...draft(format, n), phase: 'RUNNING' as const })
  const onCourt = (fixtureId: string, teamA: readonly [string, string], teamB: readonly [string, string]): OpenMatch => ({
    id: 'm1', courtId: 'c1', seq: 1, status: 'IN_PROGRESS', teamA, teamB, scoreA: null, scoreB: null, winner: null,
    proposedAt: '2026-10-11T10:00:00.000Z', startedAt: '2026-10-11T10:00:00.000Z', finishedAt: null, recordedBy: null, fixtureId,
  })

  it('substitutes a player in a pair that is not on court; the pair keeps its place', () => {
    const players = roster(9)
    const t = running('ROUND_ROBIN', 9)
    const result = applyRunningEdit(t, { kind: 'SUBSTITUTE', entrantId: seed(t, 1).id, outPlayerId: 'p2', inPlayerId: 'p9' }, players, [])
    expect(result.ok && result.tournament.entrants[0]).toEqual({ ...seed(t, 1), playerIds: ['p1', 'p9'] })
  })

  it('refuses a substitute for a pair on court, or one already in a pair', () => {
    const players = roster(9)
    const t = running('ROUND_ROBIN', 9)
    const game = t.fixtures.find((f) => f.entrantAId === seed(t, 1).id)!
    const match = onCourt(game.id, ['p1', 'p2'], ['p7', 'p8'])
    expect(applyRunningEdit(t, { kind: 'SUBSTITUTE', entrantId: seed(t, 1).id, outPlayerId: 'p2', inPlayerId: 'p9' }, players, [match]))
      .toEqual({ ok: false, reason: 'P1 & P2 are on court. Substitute after their game.' })
    expect(applyRunningEdit(t, { kind: 'SUBSTITUTE', entrantId: seed(t, 1).id, outPlayerId: 'p2', inPlayerId: 'p3' }, players, []))
      .toEqual({ ok: false, reason: 'P3 already plays in P3 & P4.' })
  })

  it('swaps opponents between two unstarted games of the same round', () => {
    const t = running('SINGLE_ELIMINATION', 16)
    const [f1, f2] = firstRound(t)
    const result = applyRunningEdit(t, { kind: 'SWAP_OPPONENTS', fixtureId: f1.id, side: 'B', otherFixtureId: f2.id, otherSide: 'B' }, roster(16), [])
    if (!result.ok) throw new Error(result.reason)
    expect(firstRound(result.tournament)[0].entrantBId).toBe(f2.entrantBId)
  })

  it('refuses swaps across rounds, with a started game, or into an empty slot', () => {
    const t = running('SINGLE_ELIMINATION', 16)
    const [f1, f2] = firstRound(t)
    const semi = t.fixtures.find((f) => f.roundNumber === 2)!
    expect(applyRunningEdit(t, { kind: 'SWAP_OPPONENTS', fixtureId: f1.id, side: 'B', otherFixtureId: semi.id, otherSide: 'A' }, roster(16), []))
      .toEqual({ ok: false, reason: 'Opponents can only be swapped between games in the same round of the same pool or bracket.' })
    const match = onCourt(f2.id, ['p7', 'p8'], ['p9', 'p10'])
    expect(applyRunningEdit(t, { kind: 'SWAP_OPPONENTS', fixtureId: f1.id, side: 'B', otherFixtureId: f2.id, otherSide: 'A' }, roster(16), [match]))
      .toEqual({ ok: false, reason: 'One of those games has already started.' })
    const [s1, s2] = t.fixtures.filter((f) => f.roundNumber === 2)
    expect(applyRunningEdit(t, { kind: 'SWAP_OPPONENTS', fixtureId: s1.id, side: 'A', otherFixtureId: s2.id, otherSide: 'A' }, roster(16), []))
      .toEqual({ ok: false, reason: 'That slot is still waiting for an earlier result.' })
  })

  it('refuses a swap that would make a round robin pair meet twice', () => {
    const t = running('ROUND_ROBIN', 8)
    const [g1, g2] = t.fixtures.filter((f) => f.roundNumber === 1)
    const result = applyRunningEdit(t, { kind: 'SWAP_OPPONENTS', fixtureId: g1.id, side: 'B', otherFixtureId: g2.id, otherSide: 'B' }, roster(8), [])
    expect(!result.ok && result.reason).toMatch(/would play each other twice\.$/)
  })

  it('is refused before Start and after the last game', () => {
    const t = draft('ROUND_ROBIN', 8)
    const edit = { kind: 'SUBSTITUTE' as const, entrantId: seed(t, 1).id, outPlayerId: 'p2', inPlayerId: 'p9' }
    expect(applyRunningEdit(t, edit, roster(9), [])).toEqual({ ok: false, reason: 'Start the tournament first. Until then, edit the draft draw instead.' })
    expect(applyRunningEdit({ ...t, phase: 'FINISHED' }, edit, roster(9), [])).toEqual({ ok: false, reason: 'The tournament is over.' })
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/pickleball/open/tournament/drawEdits.test.ts`
Expected: FAIL. `./drawEdits` cannot be resolved.

- [ ] **Step 3: Implement**

```ts
// src/lib/pickleball/open/tournament/drawRules.ts
// The rules every draw must keep (spec §6.4), checked after every edit:
// - every pair is two different players, and nobody is in two pairs;
// - no pair is twice in one round;
// - round robin and each pool: every pair plays every other pair of its group exactly once
//   (so every pair keeps its fixture count), and a pool keeps at least 2 pairs;
// - knockout brackets keep their shape: the same games, fed from the same places,
//   with every pair placed exactly once.
import type { OpenPlayer } from '../types'
import { pairName, roundLabel } from './labels'
import type { TournamentEntrant, TournamentFixture, TournamentState } from './types'

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)

function nameOf(t: TournamentState, players: readonly OpenPlayer[], entrantId: string): string {
  const entrant = t.entrants.find((e) => e.id === entrantId)
  return entrant ? pairName(entrant, players) : 'A pair'
}

function checkPlayers(t: TournamentState, players: readonly OpenPlayer[]): string | null {
  const seen = new Map<string, string>()
  for (const entrant of t.entrants) {
    const [a, b] = entrant.playerIds
    if (a === b) return 'A pair needs two different players.'
    for (const id of entrant.playerIds) {
      const player = players.find((p) => p.id === id)
      if (!player) return 'That player is not in this session.'
      if (player.status === 'LEFT') return `${player.name} has left the session.`
      if (seen.has(id)) return `${player.name} would be in two pairs.`
      seen.set(id, entrant.id)
    }
  }
  return null
}

function slotsOf(f: TournamentFixture): string[] {
  return [f.entrantAId, f.entrantBId].filter((id): id is string => id !== null)
}

function checkRounds(t: TournamentState, players: readonly OpenPlayer[]): string | null {
  const byRound = new Map<string, TournamentFixture[]>()
  for (const f of t.fixtures) {
    const key = `${f.bracket}:${f.poolLabel ?? ''}:${f.roundNumber}`
    byRound.set(key, [...(byRound.get(key) ?? []), f])
  }
  for (const round of byRound.values()) {
    const seen = new Set<string>()
    for (const f of round) {
      if (f.entrantAId !== null && f.entrantAId === f.entrantBId) return `${nameOf(t, players, f.entrantAId)} can't play themselves.`
      for (const id of slotsOf(f)) {
        if (seen.has(id)) return `${nameOf(t, players, id)} would play twice in ${roundLabel(t.format, t.fixtures, f)}.`
        seen.add(id)
      }
    }
  }
  return null
}

/** One round-robin group: these pairs, these fixtures, every pair meets every other exactly once. */
function checkGroup(t: TournamentState, players: readonly OpenPlayer[], members: readonly TournamentEntrant[], fixtures: readonly TournamentFixture[]): string | null {
  const inGroup = new Set(members.map((e) => e.id))
  const met = new Map<string, number>()
  for (const f of fixtures) {
    for (const id of slotsOf(f)) if (!inGroup.has(id)) return `${nameOf(t, players, id)} isn't in ${f.poolLabel ? `Pool ${f.poolLabel}` : 'this round robin'}.`
    if (f.entrantAId && f.entrantBId) met.set(pairKey(f.entrantAId, f.entrantBId), (met.get(pairKey(f.entrantAId, f.entrantBId)) ?? 0) + 1)
  }
  for (let i = 0; i < members.length; i += 1) {
    for (let j = i + 1; j < members.length; j += 1) {
      const times = met.get(pairKey(members[i].id, members[j].id)) ?? 0
      const names = `${pairName(members[i], players)} and ${pairName(members[j], players)}`
      if (times > 1) return `${names} would play each other twice.`
      if (times === 0) return `${names} would never play each other.`
    }
  }
  return null
}

function checkRoundRobins(t: TournamentState, players: readonly OpenPlayer[]): string | null {
  if (t.format === 'ROUND_ROBIN') return checkGroup(t, players, t.entrants, t.fixtures)
  if (t.format !== 'POOL_TO_BRACKET') return null
  const loose = t.entrants.find((e) => !e.poolLabel)
  if (loose) return `${pairName(loose, players)} isn't in a pool.`
  const labels = new Set([
    ...t.fixtures.filter((f) => f.bracket === 'POOL').map((f) => f.poolLabel as string),
    ...t.entrants.map((e) => e.poolLabel as string),
  ])
  for (const label of [...labels].sort()) {
    const members = t.entrants.filter((e) => e.poolLabel === label)
    if (members.length < 2) return `Pool ${label} would be left with ${members.length === 1 ? '1 pair' : 'no pairs'}. A pool needs at least 2.`
    const reason = checkGroup(t, players, members, t.fixtures.filter((f) => f.bracket === 'POOL' && f.poolLabel === label))
    if (reason) return reason
  }
  return null
}

/** The bracket's games and where each side comes from, ignoring who sits in a placed slot. */
function shape(t: TournamentState): string {
  return t.fixtures
    .filter((f) => f.bracket !== 'POOL')
    .map((f) => [f.id, f.bracket, f.roundNumber, f.position, f.sourceA ?? '', f.sourceB ?? ''].join(':'))
    .sort()
    .join('|')
}

function checkPlacement(t: TournamentState, players: readonly OpenPlayer[]): string | null {
  if (t.format !== 'SINGLE_ELIMINATION' && t.format !== 'DOUBLE_ELIMINATION') return null
  // A placed slot is one with no source: filled at generation, never by a result.
  const placed = t.fixtures.flatMap((f) => [
    f.sourceA === null ? f.entrantAId : null,
    f.sourceB === null ? f.entrantBId : null,
  ]).filter((id): id is string => id !== null)
  for (const entrant of t.entrants) {
    const count = placed.filter((id) => id === entrant.id).length
    if (count === 0) return `${pairName(entrant, players)} would have no place in the bracket.`
    if (count > 1) return `${pairName(entrant, players)} would be in the bracket twice.`
  }
  return null
}

/** Why `after` is not a valid draw, or null. `before` is the draw the edit started from. */
export function drawViolation(before: TournamentState, after: TournamentState, players: readonly OpenPlayer[]): string | null {
  if (shape(before) !== shape(after)) return 'That change would alter the shape of the bracket.'
  return checkPlayers(after, players) ?? checkRounds(after, players) ?? checkRoundRobins(after, players) ?? checkPlacement(after, players)
}
```

```ts
// src/lib/pickleball/open/tournament/drawEdits.ts
// Draft edits are unrestricted (spec §6.4); running edits are the two the
// spec allows after Start (§6.5). Every edit is applied to a copy and then
// re-checked by drawViolation, so an edit that breaks the draw is refused
// with the reason and nothing changes.
import type { OpenMatch, OpenPlayer } from '../types'
import { poolFixtures } from './draw'
import { drawViolation } from './drawRules'
import { pairName } from './labels'
import { sortEntrants, sortFixtures } from './order'
import type { DraftEdit, EditResult, RunningEdit, TournamentEntrant, TournamentFixture, TournamentState } from './types'

const refuse = (reason: string): EditResult => ({ ok: false, reason })

function checked(before: TournamentState, after: TournamentState, players: readonly OpenPlayer[]): EditResult {
  const reason = drawViolation(before, after, players)
  return reason ? refuse(reason) : { ok: true, tournament: after }
}

/** READY once both sides are known, PENDING while one waits. Started, finished and bye games keep their status. */
function restatus(f: TournamentFixture): TournamentFixture {
  if (f.status === 'IN_PROGRESS' || f.status === 'FINISHED' || f.status === 'BYE') return f
  return { ...f, status: f.entrantAId && f.entrantBId ? 'READY' : 'PENDING' }
}

function withPlayers(t: TournamentState, entrantId: string, playerIds: readonly [string, string]): TournamentState {
  return { ...t, entrants: t.entrants.map((e) => (e.id === entrantId ? { ...e, playerIds } : e)) }
}

function swapPlayers(t: TournamentState, [p, q]: readonly [string, string], players: readonly OpenPlayer[]): EditResult {
  const owner = (id: string) => t.entrants.find((e) => e.playerIds.includes(id))
  const ep = owner(p)
  const eq = owner(q)
  if (p === q) return refuse('Pick two different players.')
  if (!ep && !eq) return refuse('Neither player is in a pair.')
  if (ep && ep === eq) return refuse('They are already partners.')
  // Swapping with someone in no pair brings them in: they must be here to play.
  const incoming = ep && eq ? null : players.find((x) => x.id === (ep ? q : p))
  if (incoming && incoming.status !== 'ACTIVE') return refuse(`${incoming.name} is not checked in. Bring them back first.`)
  const replace = (e: TournamentEntrant, out: string, into: string) =>
    [e.playerIds[0] === out ? into : e.playerIds[0], e.playerIds[1] === out ? into : e.playerIds[1]] as const
  let next = t
  if (ep) next = withPlayers(next, ep.id, replace(ep, p, q))
  if (eq) next = withPlayers(next, eq.id, replace(eq, q, p))
  return checked(t, next, players)
}

function relabel(id: string | null, a: string, b: string): string | null {
  return id === a ? b : id === b ? a : id
}

function swapPairs(t: TournamentState, [a, b]: readonly [string, string], players: readonly OpenPlayer[]): EditResult {
  const ea = t.entrants.find((e) => e.id === a)
  const eb = t.entrants.find((e) => e.id === b)
  if (!ea || !eb) return refuse('Pair not found.')
  if (a === b) return refuse('Pick two different pairs.')
  // The two pairs trade places: seed, pool and every slot they hold.
  const next: TournamentState = {
    ...t,
    entrants: sortEntrants(t.entrants.map((e) => (e.id === a ? { ...e, seed: eb.seed, poolLabel: eb.poolLabel } : e.id === b ? { ...e, seed: ea.seed, poolLabel: ea.poolLabel } : e))),
    fixtures: t.fixtures.map((f) => ({ ...f, entrantAId: relabel(f.entrantAId, a, b), entrantBId: relabel(f.entrantBId, a, b) })),
  }
  return checked(t, next, players)
}

function movePair(t: TournamentState, entrantId: string, poolLabel: string, players: readonly OpenPlayer[], newId: () => string): EditResult {
  if (t.format !== 'POOL_TO_BRACKET') return refuse('Only a draw with pools has pools to move between.')
  const entrant = t.entrants.find((e) => e.id === entrantId)
  if (!entrant) return refuse('Pair not found.')
  const labels = new Set(t.entrants.map((e) => e.poolLabel))
  if (!labels.has(poolLabel)) return refuse(`There is no Pool ${poolLabel} in this draw.`)
  if (entrant.poolLabel === poolLabel) return refuse(`${pairName(entrant, players)} is already in Pool ${poolLabel}.`)
  const from = entrant.poolLabel as string
  const entrants = t.entrants.map((e) => (e.id === entrantId ? { ...e, poolLabel } : e))
  const rebuilt = [from, poolLabel].flatMap((label) => poolFixtures(label, entrants.filter((e) => e.poolLabel === label), newId))
  const kept = t.fixtures.filter((f) => !(f.bracket === 'POOL' && (f.poolLabel === from || f.poolLabel === poolLabel)))
  return checked(t, { ...t, entrants, fixtures: sortFixtures([...kept, ...rebuilt]) }, players)
}

function sideOf(f: TournamentFixture, side: 'A' | 'B'): string | null {
  return side === 'A' ? f.entrantAId : f.entrantBId
}
function sourceOf(f: TournamentFixture, side: 'A' | 'B'): string | null {
  return side === 'A' ? f.sourceA : f.sourceB
}
function setSide(f: TournamentFixture, side: 'A' | 'B', entrantId: string | null): TournamentFixture {
  return side === 'A' ? { ...f, entrantAId: entrantId } : { ...f, entrantBId: entrantId }
}

/**
 * Put `entrantId` on one side of a fixture. Where that pair already has a
 * slot in the same round of the same group (a round robin round, a pool
 * round) or a placed slot in the same bracket, the displaced pair takes it,
 * so it is a swap. Otherwise it is a plain replacement, which drawViolation
 * then judges (it usually leaves someone playing twice, or never).
 */
function setOpponent(t: TournamentState, edit: Extract<DraftEdit, { kind: 'SET_OPPONENT' }>, players: readonly OpenPlayer[]): EditResult {
  const fixture = t.fixtures.find((f) => f.id === edit.fixtureId)
  if (!fixture) return refuse('Game not found.')
  if (!t.entrants.some((e) => e.id === edit.entrantId)) return refuse('Pair not found.')
  if (sourceOf(fixture, edit.side) !== null) return refuse('That slot is filled by an earlier result, not by the draw.')
  const displaced = sideOf(fixture, edit.side)
  if (displaced === edit.entrantId) return { ok: true, tournament: t }
  if (sideOf(fixture, edit.side === 'A' ? 'B' : 'A') === edit.entrantId) return refuse('A pair cannot play itself.')
  const roundRobin = fixture.bracket === 'POOL' || t.format === 'ROUND_ROBIN'
  const other = t.fixtures.flatMap((f) => (['A', 'B'] as const).map((side) => ({ f, side })))
    .find(({ f, side }) => f.id !== fixture.id && sideOf(f, side) === edit.entrantId && sourceOf(f, side) === null
      && f.bracket === fixture.bracket && f.poolLabel === fixture.poolLabel && (!roundRobin || f.roundNumber === fixture.roundNumber))
  const fixtures = t.fixtures.map((f) => {
    if (f.id === fixture.id) return restatus(setSide(f, edit.side, edit.entrantId))
    if (other && f.id === other.f.id) return restatus(setSide(f, other.side, displaced))
    return f
  })
  return checked(t, { ...t, fixtures }, players)
}

export function applyDraftEdit(t: TournamentState, edit: DraftEdit, players: readonly OpenPlayer[], newId: () => string): EditResult {
  if (t.phase === 'SETUP') return refuse('Generate the draw first.')
  if (t.phase !== 'DRAFT') return refuse('The draw is locked once the tournament starts. You can still substitute a player or swap opponents in a game that has not started.')
  switch (edit.kind) {
    case 'SWAP_PLAYERS':
      return swapPlayers(t, edit.playerIds, players)
    case 'SWAP_PAIRS':
      return swapPairs(t, edit.entrantIds, players)
    case 'MOVE_PAIR':
      return movePair(t, edit.entrantId, edit.poolLabel, players, newId)
    case 'SET_OPPONENT':
      return setOpponent(t, edit, players)
  }
}

function onCourt(t: TournamentState, entrantId: string, matches: readonly OpenMatch[]): boolean {
  const fixtures = new Set(t.fixtures.filter((f) => f.entrantAId === entrantId || f.entrantBId === entrantId).map((f) => f.id))
  return matches.some((m) => m.status === 'IN_PROGRESS' && m.fixtureId !== null && fixtures.has(m.fixtureId))
}

function substitute(t: TournamentState, edit: Extract<RunningEdit, { kind: 'SUBSTITUTE' }>, players: readonly OpenPlayer[], matches: readonly OpenMatch[]): EditResult {
  const entrant = t.entrants.find((e) => e.id === edit.entrantId)
  if (!entrant) return refuse('Pair not found.')
  if (!entrant.playerIds.includes(edit.outPlayerId)) return refuse('That player is not in this pair.')
  const incoming = players.find((p) => p.id === edit.inPlayerId)
  if (!incoming) return refuse('Player not found.')
  if (incoming.status === 'LEFT') return refuse(`${incoming.name} has left the session.`)
  const taken = t.entrants.find((e) => e.playerIds.includes(incoming.id))
  if (taken) return refuse(`${incoming.name} already plays in ${pairName(taken, players)}.`)
  if (onCourt(t, entrant.id, matches)) return refuse(`${pairName(entrant, players)} are on court. Substitute after their game.`)
  const playerIds = [
    entrant.playerIds[0] === edit.outPlayerId ? incoming.id : entrant.playerIds[0],
    entrant.playerIds[1] === edit.outPlayerId ? incoming.id : entrant.playerIds[1],
  ] as const
  return checked(t, withPlayers(t, entrant.id, playerIds), players)
}

function swapOpponents(t: TournamentState, edit: Extract<RunningEdit, { kind: 'SWAP_OPPONENTS' }>, players: readonly OpenPlayer[], matches: readonly OpenMatch[]): EditResult {
  const f = t.fixtures.find((x) => x.id === edit.fixtureId)
  const g = t.fixtures.find((x) => x.id === edit.otherFixtureId)
  if (!f || !g) return refuse('Game not found.')
  if (f.id === g.id) return refuse('Pick two different games.')
  if (f.bracket !== g.bracket || f.poolLabel !== g.poolLabel || f.roundNumber !== g.roundNumber) {
    return refuse('Opponents can only be swapped between games in the same round of the same pool or bracket.')
  }
  const started = (x: TournamentFixture) => x.status === 'IN_PROGRESS' || x.status === 'FINISHED'
    || matches.some((m) => m.fixtureId === x.id && m.status === 'IN_PROGRESS')
  if (started(f) || started(g)) return refuse('One of those games has already started.')
  const a = sideOf(f, edit.side)
  const b = sideOf(g, edit.otherSide)
  if (!a || !b) return refuse('That slot is still waiting for an earlier result.')
  const fixtures = t.fixtures.map((x) => {
    if (x.id === f.id) return restatus(setSide(x, edit.side, b))
    if (x.id === g.id) return restatus(setSide(x, edit.otherSide, a))
    return x
  })
  return checked(t, { ...t, fixtures }, players)
}

export function applyRunningEdit(t: TournamentState, edit: RunningEdit, players: readonly OpenPlayer[], matches: readonly OpenMatch[]): EditResult {
  if (t.phase === 'FINISHED') return refuse('The tournament is over.')
  if (t.phase !== 'RUNNING') return refuse('Start the tournament first. Until then, edit the draft draw instead.')
  return edit.kind === 'SUBSTITUTE' ? substitute(t, edit, players, matches) : swapOpponents(t, edit, players, matches)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/pickleball/open/tournament`
Expected: PASS.

- [ ] **Step 5: CHANGELOG and commit**

```markdown
- Tournament draft edits: swap players between pairs, swap two pairs, move a pair between pools, change who plays whom. Every edit is re-checked (no pair twice in a round, every pair meets each pool or round-robin opponent once, bracket shape unchanged) and refused with the reason; after Start only substitutions and opponent swaps between unstarted games in the same round are allowed.
```

```bash
git add src/lib/pickleball/open/tournament CHANGELOG.md
git commit -m "feat(pickleball): validate every tournament draw edit"
```

---

### Task 5: Results move the draw on: advancement, corrections, standings, champion

**Files:**
- Create: `src/lib/pickleball/open/tournament/standings.ts`, `progress.ts`, `progress.test.ts`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: `resolveAdvancement`, `unadvanceBracket`, `BracketOp` (reused `advanceBracket.ts`); `resolvePoolQualifiers` (reused); `rankTournamentStandings` (reused); `generateDraw`, `fixtureLabel`, `pairName` (Task 3).
- Produces:
  - `standings.ts`: `PairStanding` (= `TournamentStandingsEntry` + `played`, `poolLabel`), `standingsInputs(t, fixtures, matches, players)`, `overallStandings(t, matches, players)`, `poolStandings(t, label, matches, players)`, `poolLabels(t)`
  - `progress.ts`: `applyOps(fixtures, ops)` (a game on court or played keeps its status), `fixtureStarted(t, id)`, `fixtureAbandoned(t, id)`, `fixtureFinished(t, id, winner: Side, matches, players)` (phase becomes `FINISHED` once every game is played), `reopenFixture(t, id): EditResult`, `editFixtureResult(t, id, winner, matchesAfter, players): EditResult`, `champion(t, matches, players): TournamentEntrant | null`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { at, player } from '../testing/fixtures'
import type { OpenMatch, OpenPlayer, Side } from '../types'
import { generateDraw } from './draw'
import { champion, editFixtureResult, fixtureFinished, fixtureStarted, reopenFixture } from './progress'
import { overallStandings, poolStandings } from './standings'
import type { TournamentFormat, TournamentState } from './types'

const roster = (n: number): OpenPlayer[] => Array.from({ length: n }, (_, i) => player(`p${i + 1}`, { name: `P${i + 1}`, position: i + 1 }))

function running(format: TournamentFormat, n: number): { t: TournamentState; players: OpenPlayer[] } {
  let k = 0
  const players = roster(n)
  const result = generateDraw(players, { format, pairing: 'MANUAL', seeding: 'MANUAL' }, { newId: () => `id${(k += 1)}` }, 2000)
  if (!result.ok) throw new Error(result.reason)
  return { t: { ...result.tournament, phase: 'RUNNING', startedAt: at(0) }, players }
}

interface Played { t: TournamentState; matches: OpenMatch[] }

/** Saves a result for one fixture the way the reducer does: a FINISHED match carrying the fixture id, then fixtureFinished. */
function play({ t, matches }: Played, players: OpenPlayer[], fixtureId: string, winner: Side, scoreA: number, scoreB: number): Played {
  const f = t.fixtures.find((x) => x.id === fixtureId)!
  const team = (id: string | null) => t.entrants.find((e) => e.id === id)!.playerIds
  const match: OpenMatch = {
    id: `m-${fixtureId}`, courtId: 'c1', seq: matches.length + 1, status: 'FINISHED', teamA: team(f.entrantAId), teamB: team(f.entrantBId),
    scoreA, scoreB, winner, proposedAt: at(1), startedAt: at(1), finishedAt: at(2), recordedBy: 'Host', fixtureId,
  }
  const all = [...matches.filter((m) => m.id !== match.id), match]
  return { t: fixtureFinished(t, fixtureId, winner, all, players), matches: all }
}

const fixture = (t: TournamentState, bracket: string, round: number, position = 0) =>
  t.fixtures.find((f) => f.bracket === bracket && f.roundNumber === round && f.position === position)!

describe('advancing the draw', () => {
  it('single elimination: winners fill the next round, which is ready once both are known', () => {
    const { t, players } = running('SINGLE_ELIMINATION', 8) // 4 pairs: two semis, a final
    let s: Played = { t, matches: [] }
    const [semi1, semi2] = [fixture(t, 'MAIN', 1, 0), fixture(t, 'MAIN', 1, 1)]
    s = play(s, players, semi1.id, 'A', 11, 4)
    expect(fixture(s.t, 'MAIN', 2)).toMatchObject({ entrantAId: semi1.entrantAId, entrantBId: null, status: 'PENDING' })
    s = play(s, players, semi2.id, 'B', 9, 11)
    expect(fixture(s.t, 'MAIN', 2)).toMatchObject({ entrantAId: semi1.entrantAId, entrantBId: semi2.entrantBId, status: 'READY' })
    s = play(s, players, fixture(s.t, 'MAIN', 2).id, 'B', 7, 11)
    expect(s.t.phase).toBe('FINISHED')
    expect(champion(s.t, s.matches, players)?.id).toBe(semi2.entrantBId)
  })

  it('double elimination: a first loss drops the pair to the losers bracket', () => {
    const { t, players } = running('DOUBLE_ELIMINATION', 8)
    const opener = fixture(t, 'MAIN', 1, 0)
    const s = play({ t, matches: [] }, players, opener.id, 'A', 11, 6)
    const dropped = s.t.fixtures.find((f) => f.bracket === 'LOSERS' && (f.entrantAId === opener.entrantBId || f.entrantBId === opener.entrantBId))
    expect(dropped).toBeDefined()
  })

  it('pools: the bracket fills only when a pool has played every game, top two by wins then points', () => {
    const { t, players } = running('POOL_TO_BRACKET', 8) // pools A and B of 2 pairs: one game each
    const [poolA, poolB] = [t.fixtures.find((f) => f.poolLabel === 'A')!, t.fixtures.find((f) => f.poolLabel === 'B')!]
    let s = play({ t, matches: [] }, players, poolA.id, 'B', 5, 11)
    // Four qualifiers: semi-final 1 is A winner v B runner-up, semi-final 2 is B winner v A runner-up.
    const [semi1, semi2] = [fixture(t, 'MAIN', 1, 0), fixture(t, 'MAIN', 1, 1)]
    // Pool A is done: its winner and runner-up are seated; pool B's slots still wait.
    expect(fixture(s.t, 'MAIN', 1, 0)).toMatchObject({ entrantAId: poolA.entrantBId, entrantBId: null, status: 'PENDING' })
    expect(fixture(s.t, 'MAIN', 1, 1)).toMatchObject({ entrantAId: null, entrantBId: poolA.entrantAId, status: 'PENDING' })
    s = play(s, players, poolB.id, 'A', 11, 2)
    expect(s.t.fixtures.find((f) => f.id === semi1.id)).toMatchObject({ entrantBId: poolB.entrantBId, status: 'READY' })
    expect(s.t.fixtures.find((f) => f.id === semi2.id)).toMatchObject({ entrantAId: poolB.entrantAId, status: 'READY' })
    expect(poolStandings(s.t, 'A', s.matches, players).map((r) => [r.entrantId, r.wins, r.pointDifferential])).toEqual([
      [poolA.entrantBId, 1, 6], [poolA.entrantAId, 0, -6],
    ])
  })
})

describe('taking a result back', () => {
  it('undo clears the slot it filled, and is refused once that next game has started', () => {
    const { t, players } = running('SINGLE_ELIMINATION', 8)
    const semi1 = fixture(t, 'MAIN', 1, 0)
    let s = play({ t, matches: [] }, players, semi1.id, 'A', 11, 4)
    const reopened = reopenFixture(s.t, semi1.id)
    expect(reopened.ok && reopened.tournament.fixtures.find((f) => f.id === semi1.id)).toMatchObject({ status: 'IN_PROGRESS', winnerEntrantId: null })
    expect(reopened.ok && fixture(reopened.tournament, 'MAIN', 2).entrantAId).toBeNull()

    s = play(s, players, fixture(s.t, 'MAIN', 1, 1).id, 'A', 11, 4)
    const startedFinal = fixtureStarted(s.t, fixture(s.t, 'MAIN', 2).id)
    expect(reopenFixture(startedFinal, semi1.id)).toEqual({ ok: false, reason: 'Final has already started with this result. Change that game first.' })
  })

  it('a pool result can be taken back until the pool’s top two start the bracket', () => {
    const { t, players } = running('POOL_TO_BRACKET', 8)
    const poolA = t.fixtures.find((f) => f.poolLabel === 'A')!
    const s = play({ t, matches: [] }, players, poolA.id, 'A', 11, 5)
    const semi1 = fixture(s.t, 'MAIN', 1, 0)
    expect(semi1.entrantAId).toBe(poolA.entrantAId)
    const reopened = reopenFixture(s.t, poolA.id)
    expect(reopened.ok && reopened.tournament.fixtures.find((f) => f.id === semi1.id)?.entrantAId).toBeNull()
    const blocked = reopenFixture(fixtureStarted(s.t, semi1.id), poolA.id)
    expect(blocked).toEqual({ ok: false, reason: "Pool A's top two have already started Semi-final 1. Change that game first." })
  })
})

describe('editing a saved result', () => {
  it('a score change keeps the winner and moves nobody', () => {
    const { t, players } = running('SINGLE_ELIMINATION', 8)
    const semi1 = fixture(t, 'MAIN', 1, 0)
    const s = play({ t, matches: [] }, players, semi1.id, 'A', 11, 4)
    expect(editFixtureResult(s.t, semi1.id, 'A', s.matches, players)).toEqual({ ok: true, tournament: s.t })
  })

  it('a different winner swaps who moved on, unless the next game already started', () => {
    const { t, players } = running('SINGLE_ELIMINATION', 8)
    const semi1 = fixture(t, 'MAIN', 1, 0)
    const s = play({ t, matches: [] }, players, semi1.id, 'A', 11, 4)
    const flipped = editFixtureResult(s.t, semi1.id, 'B', s.matches, players)
    expect(flipped.ok && fixture(flipped.tournament, 'MAIN', 2).entrantAId).toBe(semi1.entrantBId)
  })

  it('a pool score edit that keeps the same top two is allowed even after the bracket starts', () => {
    const { t, players } = running('POOL_TO_BRACKET', 8)
    const poolA = t.fixtures.find((f) => f.poolLabel === 'A')!
    const s = play({ t, matches: [] }, players, poolA.id, 'A', 11, 5)
    const live = fixtureStarted(s.t, fixture(s.t, 'MAIN', 1, 0).id)
    const sameWinner = s.matches.map((m) => (m.fixtureId === poolA.id ? { ...m, scoreB: 9 } : m))
    expect(editFixtureResult(live, poolA.id, 'A', sameWinner, players).ok).toBe(true)
    const otherWinner = s.matches.map((m) => (m.fixtureId === poolA.id ? { ...m, winner: 'B' as const, scoreA: 5, scoreB: 11 } : m))
    expect(editFixtureResult(live, poolA.id, 'B', otherWinner, players).ok).toBe(false)
  })
})

describe('standings and champion', () => {
  it('round robin ranks by wins, then losses, then point difference; the top pair is champion', () => {
    const { t, players } = running('ROUND_ROBIN', 6) // 3 pairs, 3 games
    let s: Played = { t, matches: [] }
    for (const f of t.fixtures) s = play(s, players, f.id, 'A', 11, f.roundNumber + 2)
    const table = overallStandings(s.t, s.matches, players)
    expect(table.map((r) => r.rank)).toEqual([1, 2, 3])
    expect(table[0].wins).toBeGreaterThanOrEqual(table[1].wins)
    expect(table.every((r) => r.played === 2)).toBe(true)
    expect(s.t.phase).toBe('FINISHED')
    expect(champion(s.t, s.matches, players)?.id).toBe(table[0].entrantId)
  })

  it('no champion before the last game', () => {
    const { t, players } = running('ROUND_ROBIN', 6)
    expect(champion(t, [], players)).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/pickleball/open/tournament/progress.test.ts`
Expected: FAIL. `./progress` and `./standings` cannot be resolved.

- [ ] **Step 3: Implement**

```ts
// src/lib/pickleball/open/tournament/standings.ts
// Pair standings per pool and overall (spec §6.7), ranked by the reused
// rankTournamentStandings: wins, losses, point differential, head-to-head.
// Points come from the saved games (every result carries a score).
import {
  rankTournamentStandings, type TournamentStandingsEntry, type TournamentStandingsInput,
} from '../../tournament/rankTournamentStandings'
import type { OpenMatch, OpenPlayer } from '../types'
import { pairName } from './labels'
import type { TournamentFixture, TournamentState } from './types'

export interface PairStanding extends TournamentStandingsEntry {
  played: number
  poolLabel: string | null
}

/** Raw tallies for every pair, over these fixtures only. */
export function standingsInputs(
  t: TournamentState, fixtures: readonly TournamentFixture[], matches: readonly OpenMatch[], players: readonly OpenPlayer[],
): Array<TournamentStandingsInput & { played: number }> {
  const scoreOf = new Map(matches.filter((m) => m.status === 'FINISHED' && m.fixtureId).map((m) => [m.fixtureId as string, m]))
  const rows = new Map(t.entrants.map((e) => [e.id, {
    entrantId: e.id, seed: e.seed, displayName: pairName(e, players), wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0, played: 0,
  }]))
  for (const f of fixtures) {
    if (f.status !== 'FINISHED' || !f.winnerEntrantId || !f.entrantAId || !f.entrantBId) continue
    const match = scoreOf.get(f.id)
    for (const [id, own, other] of [[f.entrantAId, match?.scoreA, match?.scoreB], [f.entrantBId, match?.scoreB, match?.scoreA]] as const) {
      const row = rows.get(id)
      if (!row) continue
      const won = f.winnerEntrantId === id
      rows.set(id, {
        ...row, played: row.played + 1, wins: row.wins + (won ? 1 : 0), losses: row.losses + (won ? 0 : 1),
        pointsFor: row.pointsFor + (own ?? 0), pointsAgainst: row.pointsAgainst + (other ?? 0),
      })
    }
  }
  return [...rows.values()]
}

function ranked(
  t: TournamentState, entrantIds: ReadonlySet<string>, fixtures: readonly TournamentFixture[], matches: readonly OpenMatch[], players: readonly OpenPlayer[],
): PairStanding[] {
  const inputs = standingsInputs(t, fixtures, matches, players).filter((row) => entrantIds.has(row.entrantId))
  const played = new Map(inputs.map((row) => [row.entrantId, row.played]))
  return rankTournamentStandings(inputs, [...fixtures]).map((row) => ({
    ...row, played: played.get(row.entrantId) ?? 0, poolLabel: t.entrants.find((e) => e.id === row.entrantId)?.poolLabel ?? null,
  }))
}

/** Every pair, every game. */
export function overallStandings(t: TournamentState, matches: readonly OpenMatch[], players: readonly OpenPlayer[]): PairStanding[] {
  return ranked(t, new Set(t.entrants.map((e) => e.id)), t.fixtures, matches, players)
}

/** One pool's pairs over that pool's games only (what decides who goes through). */
export function poolStandings(t: TournamentState, label: string, matches: readonly OpenMatch[], players: readonly OpenPlayer[]): PairStanding[] {
  const members = new Set(t.entrants.filter((e) => e.poolLabel === label).map((e) => e.id))
  return ranked(t, members, t.fixtures.filter((f) => f.bracket === 'POOL' && f.poolLabel === label), matches, players)
}

export function poolLabels(t: TournamentState): string[] {
  return [...new Set(t.entrants.map((e) => e.poolLabel).filter((label): label is string => label !== null))].sort()
}
```

```ts
// src/lib/pickleball/open/tournament/progress.ts
// What a game's start, result, undo, edit or abandon does to the draw. Later
// slots fill through the reused advanceBracket (resolveAdvancement /
// unadvanceBracket) and resolvePoolQualifiers, unchanged (spec §6.5).
import { resolveAdvancement, unadvanceBracket, type BracketOp } from '../../tournament/advanceBracket'
import { resolvePoolQualifiers } from '../../tournament/resolvePoolQualifiers'
import type { OpenMatch, OpenPlayer, Side } from '../types'
import { fixtureLabel } from './labels'
import { overallStandings, standingsInputs } from './standings'
import type { EditResult, TournamentEntrant, TournamentFixture, TournamentState } from './types'

const POOL_RANK = /^POOL_RANK:([A-H]):\d+$/

function update(t: TournamentState, fixtureId: string, patch: Partial<TournamentFixture>): TournamentState {
  return { ...t, fixtures: t.fixtures.map((f) => (f.id === fixtureId ? { ...f, ...patch } : f)) }
}

/** Applies advancement ops. A game already on court or played keeps its status (a pool can re-report its qualifiers). */
export function applyOps(fixtures: readonly TournamentFixture[], ops: readonly BracketOp[]): TournamentFixture[] {
  return ops.reduce<TournamentFixture[]>((acc, op) => acc.map((f) => {
    if (f.id !== op.fixtureId) return f
    if (op.kind === 'FINISH') return { ...f, status: 'FINISHED', winnerEntrantId: op.winnerEntrantId }
    if (op.kind === 'VACATE') return op.side === 'A' ? { ...f, entrantAId: null, sourceA: null } : { ...f, entrantBId: null, sourceB: null }
    const status = f.status === 'IN_PROGRESS' || f.status === 'FINISHED' ? f.status : op.status
    return op.side === 'A' ? { ...f, entrantAId: op.entrantId, status } : { ...f, entrantBId: op.entrantId, status }
  }), [...fixtures])
}

function settled(fixtures: readonly TournamentFixture[]): boolean {
  return fixtures.every((f) => f.status === 'FINISHED' || f.status === 'BYE')
}

export function fixtureStarted(t: TournamentState, fixtureId: string): TournamentState {
  return update(t, fixtureId, { status: 'IN_PROGRESS' })
}

export function fixtureAbandoned(t: TournamentState, fixtureId: string): TournamentState {
  return update(t, fixtureId, { status: 'READY' })
}

function poolOps(t: TournamentState, fixtures: TournamentFixture[], matches: readonly OpenMatch[], players: readonly OpenPlayer[]): BracketOp[] {
  const poolGames = fixtures.filter((f) => f.bracket === 'POOL')
  return resolvePoolQualifiers(fixtures, standingsInputs({ ...t, fixtures }, poolGames, matches, players))
}

/** A result is saved: the fixture finishes and its winner (and, in double elimination, its loser) moves on. */
export function fixtureFinished(
  t: TournamentState, fixtureId: string, winner: Side, matches: readonly OpenMatch[], players: readonly OpenPlayer[],
): TournamentState {
  const fixture = t.fixtures.find((f) => f.id === fixtureId)
  if (!fixture || !fixture.entrantAId || !fixture.entrantBId) return t
  const winnerId = winner === 'A' ? fixture.entrantAId : fixture.entrantBId
  const loserId = winner === 'A' ? fixture.entrantBId : fixture.entrantAId
  const done = t.fixtures.map((f) => (f.id === fixtureId ? { ...f, status: 'FINISHED' as const, winnerEntrantId: winnerId } : f))
  const ops = fixture.bracket === 'POOL' ? poolOps(t, done, matches, players) : resolveAdvancement(done, fixtureId, winnerId, loserId)
  const fixtures = applyOps(done, ops)
  return { ...t, fixtures, phase: settled(fixtures) ? 'FINISHED' : 'RUNNING' }
}

/** The bracket games a pool's finishing positions feed. */
function poolConsumers(t: TournamentState, label: string): Array<{ fixture: TournamentFixture; side: 'A' | 'B' }> {
  return t.fixtures.flatMap((f) => (['A', 'B'] as const)
    .filter((side) => POOL_RANK.exec((side === 'A' ? f.sourceA : f.sourceB) ?? '')?.[1] === label)
    .map((side) => ({ fixture: f, side })))
}

const started = (f: TournamentFixture) => f.status === 'IN_PROGRESS' || f.status === 'FINISHED'

/**
 * Takes a saved result back out of the draw (undo, or the first half of an
 * edit that changes who won). Refused, with the reason, when a later game
 * that depends on it has already started.
 */
export function reopenFixture(t: TournamentState, fixtureId: string): EditResult {
  const fixture = t.fixtures.find((f) => f.id === fixtureId)
  if (!fixture || fixture.status !== 'FINISHED') return { ok: false, reason: 'Only a saved result can be taken back.' }
  let fixtures: TournamentFixture[]
  if (fixture.bracket === 'POOL') {
    const label = fixture.poolLabel as string
    const consumers = poolConsumers(t, label)
    const filled = consumers.filter(({ fixture: f, side }) => (side === 'A' ? f.entrantAId : f.entrantBId) !== null)
    const blocking = filled.find(({ fixture: f }) => started(f))
    if (blocking) return { ok: false, reason: `Pool ${label}'s top two have already started ${fixtureLabel(t, blocking.fixture)}. Change that game first.` }
    const clear = new Map(filled.map(({ fixture: f, side }) => [`${f.id}:${side}`, true]))
    fixtures = t.fixtures.map((f) => {
      const a = clear.has(`${f.id}:A`)
      const b = clear.has(`${f.id}:B`)
      if (!a && !b) return f
      return { ...f, entrantAId: a ? null : f.entrantAId, entrantBId: b ? null : f.entrantBId, status: 'PENDING' }
    })
  } else {
    const undone = unadvanceBracket([...t.fixtures], fixtureId)
    if (!undone.ok) {
      const blocking = t.fixtures.find((f) => f.id === undone.blockingFixtureId)
      return { ok: false, reason: `${blocking ? fixtureLabel(t, blocking) : 'The next game'} has already started with this result. Change that game first.` }
    }
    fixtures = t.fixtures.map((f) => {
      const changes = undone.updates.filter((u) => u.fixtureId === f.id)
      return changes.reduce((acc, u) => (u.side === 'A' ? { ...acc, entrantAId: null, status: u.status } : { ...acc, entrantBId: null, status: u.status }), f)
    })
  }
  return {
    ok: true,
    tournament: { ...t, phase: 'RUNNING', fixtures: fixtures.map((f) => (f.id === fixtureId ? { ...f, status: 'IN_PROGRESS', winnerEntrantId: null } : f)) },
  }
}

/** Same pool qualifiers, in the same slots? Then a pool score edit changes nothing downstream. */
function sameQualifiers(t: TournamentState, fixtures: TournamentFixture[], matches: readonly OpenMatch[], players: readonly OpenPlayer[]): boolean {
  return poolOps(t, fixtures, matches, players).every((op) => {
    if (op.kind !== 'FILL') return true
    const f = t.fixtures.find((x) => x.id === op.fixtureId)
    return (op.side === 'A' ? f?.entrantAId : f?.entrantBId) === op.entrantId
  })
}

/**
 * A saved result is changed. Only the score: nothing moves (unless it is a
 * pool game that changes who goes through). A different winner: the old
 * result is taken back out of the draw and the new one put in, if nothing
 * that depends on it has started.
 */
export function editFixtureResult(
  t: TournamentState, fixtureId: string, winner: Side, matchesAfter: readonly OpenMatch[], players: readonly OpenPlayer[],
): EditResult {
  const fixture = t.fixtures.find((f) => f.id === fixtureId)
  if (!fixture || !fixture.entrantAId || !fixture.entrantBId) return { ok: false, reason: 'Game not found in the draw.' }
  const winnerId = winner === 'A' ? fixture.entrantAId : fixture.entrantBId
  if (fixture.bracket !== 'POOL' && winnerId === fixture.winnerEntrantId) return { ok: true, tournament: t }
  const relabelled = t.fixtures.map((f) => (f.id === fixtureId ? { ...f, winnerEntrantId: winnerId } : f))
  if (fixture.bracket === 'POOL' && sameQualifiers(t, relabelled, matchesAfter, players)) return { ok: true, tournament: { ...t, fixtures: relabelled } }
  const reopened = reopenFixture(t, fixtureId)
  if (!reopened.ok) return reopened
  return { ok: true, tournament: fixtureFinished(reopened.tournament, fixtureId, winner, matchesAfter, players) }
}

/** The winning pair once every game is played: top of the table, or the winner of the last game. */
export function champion(t: TournamentState, matches: readonly OpenMatch[], players: readonly OpenPlayer[]): TournamentEntrant | null {
  if (t.phase !== 'FINISHED') return null
  if (t.format === 'ROUND_ROBIN') {
    const top = overallStandings(t, matches, players)[0]
    return t.entrants.find((e) => e.id === top?.entrantId) ?? null
  }
  const consumed = new Set(t.fixtures.flatMap((f) => [f.sourceA, f.sourceB]).filter((s): s is string => Boolean(s?.startsWith('WINNER_OF:'))).map((s) => s.slice('WINNER_OF:'.length)))
  const final = t.fixtures.find((f) => f.bracket === 'MAIN' && !consumed.has(f.id))
  return t.entrants.find((e) => e.id === final?.winnerEntrantId) ?? null
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/pickleball/open/tournament src/lib/pickleball/tournament`
Expected: PASS (the reused modules' own tests are untouched and still pass).

- [ ] **Step 5: CHANGELOG and commit**

```markdown
- Tournament results fill later rounds through the existing bracket advancement (pools feed the bracket once complete; double elimination drops a first loss to the losers bracket). Undoing or changing a result that a started game depends on is refused, naming that game. Pair standings per pool and overall: wins, losses, point difference, head-to-head.
```

```bash
git add src/lib/pickleball/open/tournament CHANGELOG.md
git commit -m "feat(pickleball): advance tournament draws from results"
```

---

### Task 6: Commands, the court loop and the wiring

**Files:**
- Create: `src/lib/pickleball/open/tournament/commands.ts`, `courts.ts`, `courts.test.ts`, `play.test.ts`
- Create: `src/lib/pickleball/open/testing/tournament.ts` (test-only builders)
- Create: `src/lib/pickleball/open/reducer.tournament.test.ts`
- Create: `src/worker/repositories/pickleball/open/openSessions.tournamentFlow.test.ts`
- Modify: `src/lib/pickleball/open/reducer.ts`, `src/lib/pickleball/open/propose.ts`
- Modify: `src/lib/schemas/pickleball/open/commands.ts`, `createSession.ts`, `createSession.test.ts`
- Modify: `src/pages/api/pickleball/open/sessions.ts`, `src/worker/pickleball/open/OpenSessionDO.ts`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: everything from Tasks 1–5; `randomInt` (Task 2); `captainRefusal` (Phase 2, unchanged: tournament commands are host-only, game commands on the captain's own court are allowed).
- Produces:
  - Commands (Zod): `GENERATE_DRAW { format, pairing, seeding }`, `EDIT_DRAW { edit: DraftEdit }`, `START_TOURNAMENT`, `SUBSTITUTE_PLAYER { entrantId, outPlayerId, inPlayerId }`, `SWAP_OPPONENTS { fixtureId, side, otherFixtureId, otherSide }`; `tournamentFormatSchema`.
  - Create body: optional `kind: 'OPEN_PLAY' | 'TOURNAMENT'` and `tournament: { format }`.
  - `tournament/commands.ts`: `TournamentCommand`, `OPEN_PLAY_ONLY`, `applyTournamentCommand(state, command, ctx): CommandResult`, `syncFixture(next, match, change: 'START' | 'FINISH' | 'EDIT' | 'UNDO' | 'ABANDON'): CommandResult`, `undoBlocker(state, match): string | null`, `leavingRefusal(state, playerId): string | null`
  - `tournament/courts.ts`: `FixtureProposal`, `proposeFixture(state)`, `withoutStaleProposals(state)`, `tournamentCourtNote(state): string | null`
  - `finalizeCommand` now withdraws stale tournament proposals before filling courts; `proposeForCourt` delegates to `proposeFixture` for a tournament.
  - Test-only: `testing/tournament.ts` exports `NAMES`, `firstPick`, `tournamentSession(count, courts?, format?)`, `makeCtx()`, `run(state, command, ctx)`, `refusal(state, command, ctx)`, `playOut(state, ctx, fromMinute?)`.

- [ ] **Step 1: Write the failing tests**

The test-only builders first (never imported by application code):

```ts
// src/lib/pickleball/open/testing/tournament.ts
// Test-only tournament builders. Never imported by application code.
import type { OpenCommand } from '../../../schemas/pickleball/open/commands'
import { applyCommand, finalizeCommand } from '../reducer'
import { emptyTournament, type RandomInt, type TournamentFormat } from '../tournament/types'
import type { CommandContext, OpenSessionState } from '../types'
import { at, court, player, sessionState } from './fixtures'

export const NAMES = ['Ana', 'Ben', 'Cy', 'Di', 'Eva', 'Fin', 'Gus', 'Hal', 'Ivy', 'Jo', 'Kai', 'Lu', 'Max', 'Ned', 'Oz', 'Pia', 'Quin', 'Rae', 'Sol', 'Tex']

/** Deterministic stand-in for crypto randomness: always picks the first option. */
export const firstPick: RandomInt = () => 0

/** A tournament session in SETUP with `count` players (skills 5,4,3,2,1 repeating) on `courts` courts. */
export function tournamentSession(count: number, courts = 2, format: TournamentFormat = 'ROUND_ROBIN'): OpenSessionState {
  return sessionState({
    kind: 'TOURNAMENT',
    courts: Array.from({ length: courts }, (_, i) => court(`c${i + 1}`, i + 1)),
    players: Array.from({ length: count }, (_, i) => player(`p${i + 1}`, { name: NAMES[i] ?? `P${i + 1}`, position: i + 1, skill: 5 - (i % 5) })),
    tournament: emptyTournament(format),
  })
}

export function makeCtx(): (minute: number) => CommandContext {
  let n = 0
  return (minute) => ({ now: at(minute), newId: () => `t${(n += 1)}`, random: firstPick })
}

/** Runs one command through the reducer exactly as the Durable Object does; throws on refusal. */
export function run(state: OpenSessionState, command: OpenCommand, ctx: CommandContext): OpenSessionState {
  const result = applyCommand(state, command, ctx)
  if (!result.ok) throw new Error(`${command.type}: ${result.error}`)
  return finalizeCommand(result.state, ctx)
}

/** The refusal text, or null if the command was accepted. */
export function refusal(state: OpenSessionState, command: OpenCommand, ctx: CommandContext): string | null {
  const result = applyCommand(state, command, ctx)
  return result.ok ? null : result.error
}

/** Starts and saves every proposed game, side A winning 11–(5 + seq % 5), until nothing is left to play. */
export function playOut(start: OpenSessionState, ctx: (minute: number) => CommandContext, fromMinute = 10): OpenSessionState {
  let state = start
  let minute = fromMinute
  for (let guard = 0; guard < 500; guard += 1) {
    const next = state.matches.find((m) => m.status === 'PROPOSED' || m.status === 'IN_PROGRESS')
    if (!next) return state
    minute += 1
    if (next.status === 'PROPOSED') state = run(state, { type: 'START_MATCH', matchId: next.id }, ctx(minute))
    minute += 1
    state = run(state, { type: 'RECORD_RESULT', matchId: next.id, winner: 'A', scoreA: 11, scoreB: 5 + (next.seq % 5) }, ctx(minute))
  }
  throw new Error('playOut did not finish')
}
```

Every format played from the draw to one champion through the real reducer, including byes and uneven pools (Review Focus 2):

```ts
import { describe, expect, it } from 'vitest'
import { makeCtx, playOut, refusal, run, tournamentSession } from '../testing/tournament'
import { champion } from './progress'
import type { TournamentFormat } from './types'

const CASES: Array<[TournamentFormat, number, number]> = [
  // format, players, games in the draw
  ['ROUND_ROBIN', 8, 6],
  ['POOL_TO_BRACKET', 16, 15],
  ['SINGLE_ELIMINATION', 10, 4],
  ['DOUBLE_ELIMINATION', 8, 6],
  // Byes and uneven groups: losers-bracket holes collapse, pools of 3 and 4 (or 2 and 3) still feed one bracket.
  ['SINGLE_ELIMINATION', 6, 2],
  ['DOUBLE_ELIMINATION', 10, 8],
  ['DOUBLE_ELIMINATION', 12, 10],
  ['POOL_TO_BRACKET', 10, 7],
  ['POOL_TO_BRACKET', 14, 12],
]

describe('a tournament plays from the draw to a champion', () => {
  for (const [format, players, games] of CASES) {
    it(`${format} with ${players} players: every game proposed to a free court, one champion`, () => {
      const ctx = makeCtx()
      let state = tournamentSession(players, 2, format)
      state = run(state, { type: 'GENERATE_DRAW', format, pairing: 'BALANCED', seeding: 'BY_SKILL' }, ctx(1))
      expect(state.tournament?.phase).toBe('DRAFT')
      expect(state.tournament?.fixtures).toHaveLength(games)
      expect(state.matches).toHaveLength(0) // nothing is proposed from a draft
      const ready = state.tournament!.fixtures.filter((f) => f.status === 'READY').length
      state = run(state, { type: 'START_TOURNAMENT' }, ctx(2))
      // Both courts get a game, unless byes leave only one game playable at the start.
      expect(state.matches.filter((m) => m.status === 'PROPOSED')).toHaveLength(Math.min(2, ready))
      state = playOut(state, ctx)
      const t = state.tournament!
      expect(t.phase).toBe('FINISHED')
      expect(t.fixtures.every((f) => f.status === 'FINISHED')).toBe(true)
      expect(state.matches.filter((m) => m.status === 'FINISHED')).toHaveLength(games)
      expect(champion(t, state.matches, state.players)).not.toBeNull()
    })
  }

  it('refuses to start with a player left over', () => {
    const ctx = makeCtx()
    let state = tournamentSession(9)
    state = run(state, { type: 'GENERATE_DRAW', format: 'ROUND_ROBIN', pairing: 'MANUAL', seeding: 'MANUAL' }, ctx(1))
    expect(refusal(state, { type: 'START_TOURNAMENT' }, ctx(2))).toBe('Ivy has no partner. Swap them into a pair, or put them on a break to keep them as a substitute.')
  })
})
```

The court loop, and what a free court says (Review Focus 1):

```ts
import { describe, expect, it } from 'vitest'
import { makeCtx, run, tournamentSession } from '../testing/tournament'
import { proposeFixture, tournamentCourtNote, withoutStaleProposals } from './courts'

function started(players = 8, courts = 1) {
  const ctx = makeCtx()
  let state = run(tournamentSession(players, courts, 'SINGLE_ELIMINATION'), { type: 'GENERATE_DRAW', format: 'SINGLE_ELIMINATION', pairing: 'MANUAL', seeding: 'MANUAL' }, ctx(1))
  state = run(state, { type: 'START_TOURNAMENT' }, ctx(2))
  return { state, ctx }
}

describe('the tournament court loop', () => {
  it('proposes the earliest ready game whose pairs are free, with the fixture it plays', () => {
    const { state } = started(8, 1)
    const game = state.matches[0]
    const fixture = state.tournament!.fixtures.find((f) => f.id === game.fixtureId)!
    expect(fixture).toMatchObject({ roundNumber: 1, position: 0 })
    // With that game on court, the other semi-final is next.
    expect(proposeFixture(state)?.fixtureId).toBe(state.tournament!.fixtures.find((f) => f.roundNumber === 1 && f.position === 1)!.id)
  })

  it('withdraws a proposal the draw no longer backs', () => {
    const { state } = started(8, 1)
    const game = state.matches[0]
    const swapped = { ...state, tournament: { ...state.tournament!, fixtures: state.tournament!.fixtures.map((f) => (f.id === game.fixtureId ? { ...f, status: 'PENDING' as const } : f)) } }
    expect(withoutStaleProposals(swapped).matches).toHaveLength(0)
    expect(withoutStaleProposals(state)).toBe(state)
  })

  it('a free court says which game waits for a player on a break, and otherwise that it waits for a result', () => {
    const { ctx, state: first } = started(8, 2)
    let state = first
    expect(tournamentCourtNote(state)).toBe('Waiting for a result that decides the next game.')
    // Cy plays in semi-final 2 on court 2. A break withdraws that game, and the free court says why it waits.
    const second = state.matches.find((m) => m.courtId === 'c2')!
    state = run(state, { type: 'SET_PLAYER_STATUS', playerId: second.teamA[0], status: 'BREAK' }, ctx(3))
    expect(state.matches.some((m) => m.courtId === 'c2')).toBe(false)
    expect(tournamentCourtNote(state)).toBe('Semi-final 2 waits for Cy, who is on a break.')
  })
})
```

The reducer's tournament behaviour, including Review Focus 1, 3 and 4:

```ts
import { describe, expect, it } from 'vitest'
import { captainRefusal } from './captains'
import { buildInitialState } from './create'
import { makeCtx, refusal, run, tournamentSession } from './testing/tournament'
import { DEFAULT_SETTINGS, type CaptainRecord, type OpenSessionState } from './types'

function started(players = 8, courts = 2, format: 'ROUND_ROBIN' | 'SINGLE_ELIMINATION' = 'ROUND_ROBIN', bench: string[] = []) {
  const ctx = makeCtx()
  let state = tournamentSession(players, courts, format)
  state = run(state, { type: 'GENERATE_DRAW', format, pairing: 'MANUAL', seeding: 'MANUAL' }, ctx(1))
  // Players left over are put on a break: the host keeps them as substitutes.
  for (const playerId of bench) state = run(state, { type: 'SET_PLAYER_STATUS', playerId, status: 'BREAK' }, ctx(1))
  state = run(state, { type: 'START_TOURNAMENT' }, ctx(2))
  return { state, ctx }
}
const proposed = (state: OpenSessionState) => state.matches.filter((m) => m.status === 'PROPOSED')

describe('a tournament session', () => {
  it('is created in setup, with no games proposed until it starts', () => {
    let n = 0
    const state = buildInitialState({
      name: 'Cup', hostDisplayName: 'Mo', location: null, courtCount: 2, settings: DEFAULT_SETTINGS, kind: 'TOURNAMENT', tournamentFormat: 'SINGLE_ELIMINATION',
      players: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((name) => ({ name, skill: null, duprId: null })),
    }, { now: '2026-10-11T10:00:00.000Z', newId: () => `i${(n += 1)}`, publicCode: 'ABCDE23456', sessionId: 's1' })
    expect(state.kind).toBe('TOURNAMENT')
    expect(state.tournament).toMatchObject({ format: 'SINGLE_ELIMINATION', phase: 'SETUP', entrants: [], fixtures: [] })
    expect(state.matches).toEqual([])
  })

  it('refuses open-play commands and tournament commands in the wrong place', () => {
    const { state, ctx } = started()
    expect(refusal(state, { type: 'SET_MODE', mode: 'BALANCED' }, ctx(3))).toBe('That is for open play. In a tournament the draw decides who plays whom.')
    expect(refusal(state, { type: 'SKIP_PROPOSAL', matchId: proposed(state)[0].id }, ctx(3))).toBe('That is for open play. In a tournament the draw decides who plays whom.')
    expect(refusal(state, { type: 'GENERATE_DRAW', format: 'ROUND_ROBIN', pairing: 'RANDOM', seeding: 'RANDOM' }, ctx(3))).toBe('The draw is locked once the tournament starts.')
    const open = { ...state, kind: 'OPEN_PLAY' as const, tournament: null }
    expect(refusal(open, { type: 'START_TOURNAMENT' }, ctx(3))).toBe('This session is open play, not a tournament.')
  })

  it('a draft can be generated again, replacing the pairs', () => {
    const ctx = makeCtx()
    let state = run(tournamentSession(8), { type: 'GENERATE_DRAW', format: 'ROUND_ROBIN', pairing: 'MANUAL', seeding: 'MANUAL' }, ctx(1))
    const first = state.tournament!.entrants.map((e) => e.id)
    state = run(state, { type: 'GENERATE_DRAW', format: 'SINGLE_ELIMINATION', pairing: 'BALANCED', seeding: 'BY_SKILL' }, ctx(2))
    expect(state.tournament!.format).toBe('SINGLE_ELIMINATION')
    expect(state.tournament!.entrants.some((e) => first.includes(e.id))).toBe(false)
  })

  it('a late arrival after Generate is flagged, and Start waits until they are paired or resting', () => {
    const ctx = makeCtx()
    let state = run(tournamentSession(8), { type: 'GENERATE_DRAW', format: 'ROUND_ROBIN', pairing: 'MANUAL', seeding: 'MANUAL' }, ctx(1))
    state = run(state, { type: 'ADD_PLAYERS', names: ['Zed'] }, ctx(2))
    expect(refusal(state, { type: 'START_TOURNAMENT' }, ctx(3))).toBe('Zed has no partner. Swap them into a pair, or put them on a break to keep them as a substitute.')
    const zed = state.players.find((p) => p.name === 'Zed')!
    state = run(state, { type: 'EDIT_DRAW', edit: { kind: 'SWAP_PLAYERS', playerIds: [zed.id, 'p1'] } }, ctx(3))
    expect(state.tournament!.entrants[0].playerIds).toEqual([zed.id, 'p2'])
    // Ana is now the one left over; resting her lets the tournament start.
    state = run(state, { type: 'SET_PLAYER_STATUS', playerId: 'p1', status: 'BREAK' }, ctx(4))
    expect(run(state, { type: 'START_TOURNAMENT' }, ctx(5)).tournament!.phase).toBe('RUNNING')
  })

  it('an ended session refuses tournament commands but keeps its draw and results', () => {
    const { ctx, state: first } = started()
    let state = first
    state = run(state, { type: 'END_SESSION' }, ctx(3))
    expect(state.matches.filter((m) => m.status === 'PROPOSED')).toEqual([])
    const pair = state.tournament!.entrants[0]
    expect(refusal(state, { type: 'SUBSTITUTE_PLAYER', entrantId: pair.id, outPlayerId: pair.playerIds[0], inPlayerId: 'p9' }, ctx(4))).toBe('This session has ended.')
    expect(state.tournament!.phase).toBe('RUNNING')
  })

  it('a player in a pair cannot just leave; a substitute takes their place and keeps the pair’s results', () => {
    const { ctx, state: first } = started(9, 2, 'ROUND_ROBIN', ['p9']) // Ivy (p9) is left over and waits on a break
    let state = first
    expect(refusal(state, { type: 'SET_PLAYER_STATUS', playerId: 'p1', status: 'LEFT' }, ctx(3))).toBe('Ana is in a pair. Substitute them first.')
    const pair = state.tournament!.entrants[0]
    const onCourt = proposed(state).find((m) => m.teamA.includes('p1') || m.teamB.includes('p1'))!
    state = run(state, { type: 'SUBSTITUTE_PLAYER', entrantId: pair.id, outPlayerId: 'p1', inPlayerId: 'p9' }, ctx(4))
    expect(state.tournament!.entrants[0].playerIds).toEqual(['p9', 'p2'])
    expect(state.players.find((p) => p.id === 'p9')?.status).toBe('ACTIVE')
    // The old proposal is withdrawn and the same game proposed again with the substitute.
    expect(state.matches.some((m) => m.id === onCourt.id)).toBe(false)
    const again = proposed(state).find((m) => m.fixtureId === onCourt.fixtureId)!
    expect([...again.teamA, ...again.teamB]).toContain('p9')
    state = run(state, { type: 'SET_PLAYER_STATUS', playerId: 'p1', status: 'LEFT' }, ctx(5))
    expect(state.players.find((p) => p.id === 'p1')?.status).toBe('LEFT')
  })

  it('swapping opponents withdraws the old proposals and proposes the new games', () => {
    const { ctx, state: first } = started(16, 4, 'SINGLE_ELIMINATION')
    let state = first
    const [f1, f2] = state.tournament!.fixtures.filter((f) => f.bracket === 'MAIN' && f.roundNumber === 1)
    state = run(state, { type: 'SWAP_OPPONENTS', fixtureId: f1.id, side: 'B', otherFixtureId: f2.id, otherSide: 'B' }, ctx(3))
    const game = proposed(state).find((m) => m.fixtureId === f1.id)!
    const newOpponent = state.tournament!.entrants.find((e) => e.id === f2.entrantBId)!
    expect(game.teamB).toEqual(newOpponent.playerIds)
  })

  it('undo is refused once the next round has started; edit changes who moved on', () => {
    const { ctx, state: first } = started(8, 2, 'SINGLE_ELIMINATION')
    let state = first
    const [semi1, semi2] = proposed(state)
    for (const [i, m] of [semi1, semi2].entries()) {
      state = run(state, { type: 'START_MATCH', matchId: m.id }, ctx(3 + i))
      state = run(state, { type: 'RECORD_RESULT', matchId: m.id, winner: 'A', scoreA: 11, scoreB: 6 }, ctx(5 + i))
    }
    const final = proposed(state)[0]
    expect(final.teamA).toEqual(semi1.teamA)
    state = run(state, { type: 'EDIT_RESULT', matchId: semi1.id, winner: 'B', scoreA: 6, scoreB: 11 }, ctx(7))
    expect(proposed(state)[0].teamA).toEqual(semi1.teamB)
    const finalNow = proposed(state)[0]
    state = run(state, { type: 'START_MATCH', matchId: finalNow.id }, ctx(8))
    expect(refusal(state, { type: 'UNDO_RESULT', matchId: semi2.id }, ctx(8))).toBe('Final has already started with this result. Change that game first.')
    expect(refusal(state, { type: 'EDIT_RESULT', matchId: semi2.id, winner: 'B', scoreA: 6, scoreB: 11 }, ctx(8))).toBe('Final has already started with this result. Change that game first.')
  })

  it('an abandoned game goes back to the draw and is proposed again', () => {
    const { ctx, state: first } = started()
    let state = first
    const game = proposed(state)[0]
    state = run(state, { type: 'START_MATCH', matchId: game.id }, ctx(3))
    expect(state.tournament!.fixtures.find((f) => f.id === game.fixtureId)?.status).toBe('IN_PROGRESS')
    state = run(state, { type: 'ABANDON_MATCH', matchId: game.id }, ctx(4))
    expect(state.tournament!.fixtures.find((f) => f.id === game.fixtureId)?.status).toBe('READY')
    expect(proposed(state).some((m) => m.fixtureId === game.fixtureId)).toBe(true)
  })

  it('a pair with a player on a break is skipped, and its game is proposed when they are back', () => {
    const { ctx, state: first } = started(8, 1)
    let state = first
    const game = proposed(state)[0]
    state = run(state, { type: 'SET_PLAYER_STATUS', playerId: game.teamA[0], status: 'BREAK' }, ctx(3))
    expect(proposed(state)[0].fixtureId).not.toBe(game.fixtureId)
    expect([...proposed(state)[0].teamA, ...proposed(state)[0].teamB]).not.toContain(game.teamA[0])
  })

  it('a court captain records results on their own tournament court, and nothing else', () => {
    const { state } = started()
    const captain: CaptainRecord = { id: 'cap', label: 'Court 1 captain', courtId: 'c1', keyHash: 'h', createdAt: state.createdAt }
    const onCourt1 = proposed(state).find((m) => m.courtId === 'c1')!
    const onCourt2 = proposed(state).find((m) => m.courtId === 'c2')!
    expect(captainRefusal({ type: 'RECORD_RESULT', matchId: onCourt1.id, winner: 'A', scoreA: 11, scoreB: 3 }, captain, state)).toBeNull()
    expect(captainRefusal({ type: 'START_MATCH', matchId: onCourt2.id }, captain, state)).toBe('This captain link only runs Court 1.')
    expect(captainRefusal({ type: 'START_TOURNAMENT' }, captain, state)).toBe('Only the host can do that.')
  })
})
```

The whole flow through D1:

```ts
import { describe, expect, it } from 'vitest'
import { createSqliteD1 } from './testing/sqliteD1'
import { createOpenSession, loadOpenSession, persistDiff, purgeExpiredOpenSessions } from './openSessions'
import { buildInitialState } from '../../../../lib/pickleball/open/create'
import { diffState } from '../../../../lib/pickleball/open/diff'
import { applyCommand, finalizeCommand } from '../../../../lib/pickleball/open/reducer'
import type { OpenCommand } from '../../../../lib/schemas/pickleball/open/commands'
import { DEFAULT_SETTINGS, type OpenSessionState } from '../../../../lib/pickleball/open/types'

const MIGRATIONS = [
  'migrations/pickleball/0016_open_sessions.sql',
  'migrations/pickleball/0017_open_captains.sql',
  'migrations/pickleball/0018_open_tournaments.sql',
]
const NOW = '2026-10-11T10:00:00.000Z'
const NAMES = ['Ana', 'Ben', 'Cy', 'Di', 'Eva', 'Fin', 'Gus', 'Hal']

let n = 0
const ctx = (minute: number) => ({ now: new Date(Date.parse(NOW) + minute * 60_000).toISOString(), newId: () => `id-${(n += 1)}`, random: () => 0 })

function cup(code = 'CUPCU23456'): OpenSessionState {
  return buildInitialState({
    name: 'Cup', hostDisplayName: 'Mo', location: null, courtCount: 2, settings: DEFAULT_SETTINGS, kind: 'TOURNAMENT', tournamentFormat: 'POOL_TO_BRACKET',
    players: NAMES.map((name) => ({ name, skill: null, duprId: null })),
  }, { now: NOW, newId: () => `${code}-${(n += 1)}`, publicCode: code, sessionId: `sess-${code}` })
}

function step(state: OpenSessionState, command: OpenCommand, minute: number): OpenSessionState {
  const c = ctx(minute)
  const result = applyCommand(state, command, c)
  if (!result.ok) throw new Error(result.error)
  return finalizeCommand(result.state, c)
}

describe('tournament rows in D1 (0018)', () => {
  it('a tournament session round-trips in setup, and open play still loads with no tournament', async () => {
    const { d1 } = createSqliteD1(MIGRATIONS)
    const state = cup()
    await createOpenSession(d1, state, 'hash')
    expect((await loadOpenSession(d1, 'CUPCU23456', NOW))?.state).toEqual(state)
    const open = { ...cup('OPENO23456'), kind: 'OPEN_PLAY' as const, tournament: null }
    await createOpenSession(d1, open, 'hash')
    expect((await loadOpenSession(d1, 'OPENO23456', NOW))?.state.tournament).toBeNull()
  })

  it('a draft, a regenerated draft and a started tournament each persist as a diff, and reload equals memory', async () => {
    const { d1, raw } = createSqliteD1(MIGRATIONS)
    let state = cup()
    await createOpenSession(d1, state, 'hash')
    for (const [command, minute] of [
      [{ type: 'GENERATE_DRAW', format: 'POOL_TO_BRACKET', pairing: 'MANUAL', seeding: 'MANUAL' }, 1],
      [{ type: 'GENERATE_DRAW', format: 'SINGLE_ELIMINATION', pairing: 'BALANCED', seeding: 'BY_SKILL' }, 2],
      [{ type: 'START_TOURNAMENT' }, 3],
    ] as const) {
      const next = step(state, command, minute)
      await persistDiff(d1, state, next, null)
      const loaded = await loadOpenSession(d1, 'CUPCU23456', NOW)
      expect(loaded?.state).toEqual(next)
      // Loaded rows build with the engine's key order: nothing reads as changed.
      const diff = diffState(loaded!.state, next)
      expect([diff.tournamentChanged, diff.upsertEntrants, diff.upsertFixtures, diff.upsertMatches]).toEqual([false, [], [], []])
      state = next
    }
    // The regenerated draft left nothing behind from the first one.
    expect((raw.prepare('SELECT COUNT(*) AS n FROM open_tournament_fixtures').get() as { n: number }).n).toBe(3)
    expect(state.matches.filter((m) => m.fixtureId !== null)).toHaveLength(2)
  })

  it('a saved result moves the winner on, in D1 too', async () => {
    const { d1 } = createSqliteD1(MIGRATIONS)
    let state = cup()
    await createOpenSession(d1, state, 'hash')
    for (const [command, minute] of [
      [{ type: 'GENERATE_DRAW', format: 'SINGLE_ELIMINATION', pairing: 'MANUAL', seeding: 'MANUAL' }, 1],
      [{ type: 'START_TOURNAMENT' }, 2],
    ] as const) {
      const next = step(state, command, minute)
      await persistDiff(d1, state, next, null)
      state = next
    }
    const game = state.matches.find((m) => m.status === 'PROPOSED')!
    const next = step(state, { type: 'RECORD_RESULT', matchId: game.id, winner: 'A', scoreA: 11, scoreB: 7 }, 5)
    await persistDiff(d1, state, next, null)
    const loaded = await loadOpenSession(d1, 'CUPCU23456', NOW)
    expect(loaded?.state).toEqual(next)
    expect(loaded?.state.tournament?.fixtures.find((f) => f.id === game.fixtureId)?.status).toBe('FINISHED')
  })

  it('the purge removes every tournament row with its session', async () => {
    const { d1, raw } = createSqliteD1(MIGRATIONS)
    const state = cup()
    await createOpenSession(d1, state, 'hash')
    const next = step(state, { type: 'GENERATE_DRAW', format: 'ROUND_ROBIN', pairing: 'MANUAL', seeding: 'MANUAL' }, 1)
    await persistDiff(d1, state, next, null)
    expect(await purgeExpiredOpenSessions(d1, '2026-10-30T00:00:00.000Z')).toEqual(['CUPCU23456'])
    for (const table of ['open_tournaments', 'open_tournament_entrants', 'open_tournament_fixtures']) {
      expect((raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n, table).toBe(0)
    }
  })

  it('rejects an unknown format, bracket or fixture status', async () => {
    const { d1, raw } = createSqliteD1(MIGRATIONS)
    const state = step(cup(), { type: 'GENERATE_DRAW', format: 'ROUND_ROBIN', pairing: 'MANUAL', seeding: 'MANUAL' }, 1)
    await createOpenSession(d1, state, 'hash')
    expect(() => raw.exec("UPDATE open_tournaments SET format = 'LADDER'")).toThrow(/CHECK/)
    expect(() => raw.exec("UPDATE open_tournament_fixtures SET bracket = 'CONSOLATION'")).toThrow(/CHECK/)
    expect(() => raw.exec("UPDATE open_tournament_fixtures SET status = 'LIVE'")).toThrow(/CHECK/)
    // Pairing, seeding and phase are free text, read back through a normalizer.
    raw.exec("UPDATE open_tournaments SET pairing = 'SOMETHING_NEW'")
    expect((await loadOpenSession(d1, 'CUPCU23456', NOW))?.state.tournament?.pairing).toBe('RANDOM')
  })
})
```

Schemas, appended to `src/lib/schemas/pickleball/open/createSession.test.ts`:

1. Find:

```ts
    expect(commandSchema.safeParse({ type: 'SET_SELF_CHECK_IN', enabled: false }).success).toBe(true)
  })
})
```

   Replace with:

```ts
    expect(commandSchema.safeParse({ type: 'SET_SELF_CHECK_IN', enabled: false }).success).toBe(true)
  })
})

describe('tournament schemas (Phase 3)', () => {
  const settings = { mode: 'PADDLE_STACK', target: 11, scoringStyle: 'SIDEOUT' }

  it('a session can be a tournament with a format; a client that sends neither gets open play', () => {
    expect(createSessionSchema.safeParse({ ...base, settings, kind: 'TOURNAMENT', tournament: { format: 'POOL_TO_BRACKET' } }).success).toBe(true)
    expect(createSessionSchema.safeParse({ ...base, settings }).success).toBe(true)
    expect(createSessionSchema.safeParse({ ...base, settings, kind: 'LEAGUE' }).success).toBe(false)
    expect(createSessionSchema.safeParse({ ...base, settings, kind: 'TOURNAMENT', tournament: { format: 'SWISS' } }).success).toBe(false)
  })

  it('parses the tournament commands and rejects bad shapes', () => {
    expect(commandSchema.safeParse({ type: 'GENERATE_DRAW', format: 'DOUBLE_ELIMINATION', pairing: 'BALANCED', seeding: 'BY_SKILL' }).success).toBe(true)
    expect(commandSchema.safeParse({ type: 'GENERATE_DRAW', format: 'ROUND_ROBIN', pairing: 'SNAKE', seeding: 'RANDOM' }).success).toBe(false)
    expect(commandSchema.safeParse({ type: 'EDIT_DRAW', edit: { kind: 'MOVE_PAIR', entrantId: 'e1', poolLabel: 'B' } }).success).toBe(true)
    expect(commandSchema.safeParse({ type: 'EDIT_DRAW', edit: { kind: 'MOVE_PAIR', entrantId: 'e1', poolLabel: 'Z' } }).success).toBe(false)
    expect(commandSchema.safeParse({ type: 'EDIT_DRAW', edit: { kind: 'SET_OPPONENT', fixtureId: 'f1', side: 'C', entrantId: 'e2' } }).success).toBe(false)
    expect(commandSchema.safeParse({ type: 'SWAP_OPPONENTS', fixtureId: 'f1', side: 'A', otherFixtureId: 'f2', otherSide: 'B' }).success).toBe(true)
    expect(commandSchema.safeParse({ type: 'SUBSTITUTE_PLAYER', entrantId: 'e1', outPlayerId: 'p1' }).success).toBe(false)
    expect(commandSchema.safeParse({ type: 'START_TOURNAMENT' }).success).toBe(true)
  })
})
```


- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/pickleball/open src/worker/repositories/pickleball/open src/lib/schemas/pickleball/open`
Expected: FAIL. `GENERATE_DRAW` is not a known command, `./commands` and `./courts` cannot be resolved.

- [ ] **Step 3: Add the commands to the schemas**

In `src/lib/schemas/pickleball/open/commands.ts`:

1. Find:

```ts
export const stackingModeSchema = z.enum(['PADDLE_STACK', 'WINNERS_LOSERS', 'BY_STANDING', 'BALANCED'])
const rule = z.object({ kind: z.enum(['TOGETHER', 'APART']), playerIds: z.tuple([id, id]) })

```

   Replace with:

```ts
export const stackingModeSchema = z.enum(['PADDLE_STACK', 'WINNERS_LOSERS', 'BY_STANDING', 'BALANCED'])
export const tournamentFormatSchema = z.enum(['ROUND_ROBIN', 'POOL_TO_BRACKET', 'SINGLE_ELIMINATION', 'DOUBLE_ELIMINATION'])
const rule = z.object({ kind: z.enum(['TOGETHER', 'APART']), playerIds: z.tuple([id, id]) })

const draftEdit = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('SWAP_PLAYERS'), playerIds: z.tuple([id, id]) }),
  z.object({ kind: z.literal('SWAP_PAIRS'), entrantIds: z.tuple([id, id]) }),
  z.object({ kind: z.literal('MOVE_PAIR'), entrantId: id, poolLabel: z.string().regex(/^[A-H]$/) }),
  z.object({ kind: z.literal('SET_OPPONENT'), fixtureId: id, side, entrantId: id }),
])

```

2. Find:

```ts
  z.object({ type: z.literal('REMOVE_RULE'), rule }),
])
```

   Replace with:

```ts
  z.object({ type: z.literal('REMOVE_RULE'), rule }),
  // Tournaments (spec §6). Generate and edit the draft, start, then the two running edits.
  z.object({
    type: z.literal('GENERATE_DRAW'), format: tournamentFormatSchema,
    pairing: z.enum(['RANDOM', 'BALANCED', 'MANUAL']), seeding: z.enum(['RANDOM', 'BY_SKILL', 'MANUAL']),
  }),
  z.object({ type: z.literal('EDIT_DRAW'), edit: draftEdit }),
  z.object({ type: z.literal('START_TOURNAMENT') }),
  z.object({ type: z.literal('SUBSTITUTE_PLAYER'), entrantId: id, outPlayerId: id, inPlayerId: id }),
  z.object({ type: z.literal('SWAP_OPPONENTS'), fixtureId: id, side, otherFixtureId: id, otherSide: side }),
])
```


In `src/lib/schemas/pickleball/open/createSession.ts`:

1. Find:

```ts
import { z } from 'zod'
import { stackingModeSchema } from './commands'

```

   Replace with:

```ts
import { z } from 'zod'
import { stackingModeSchema, tournamentFormatSchema } from './commands'

```

2. Find:

```ts
  })).max(128),
  turnstileToken: z.string().max(2048).optional(),
```

   Replace with:

```ts
  })).max(128),
  // Optional: an older client sends neither and gets open play.
  kind: z.enum(['OPEN_PLAY', 'TOURNAMENT']).optional(),
  tournament: z.object({ format: tournamentFormatSchema }).optional(),
  turnstileToken: z.string().max(2048).optional(),
```


- [ ] **Step 4: The court loop and the tournament commands**

```ts
// src/lib/pickleball/open/tournament/courts.ts
// The court loop for a tournament (spec §6.6): whichever court frees gets the
// next READY fixture whose pairs aren't on court (the reused
// nextPlayableFixture). A pair with a player on a break is skipped until they
// are back.
import { nextPlayableFixture } from '../../tournament/nextPlayableFixture'
import type { OpenSessionState, Team } from '../types'
import { fixtureLabel } from './labels'

export interface FixtureProposal {
  teamA: Team
  teamB: Team
  fixtureId: string
}

const sameTeam = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id) => b.includes(id))

export function proposeFixture(state: OpenSessionState): FixtureProposal | null {
  const t = state.tournament
  if (!t || t.phase !== 'RUNNING') return null
  const live = state.matches.filter((m) => m.status === 'PROPOSED' || m.status === 'IN_PROGRESS')
  const liveFixtures = new Set(live.map((m) => m.fixtureId).filter(Boolean))
  const livePlayers = new Set(live.flatMap((m) => [...m.teamA, ...m.teamB]))
  const ready = (id: string) => state.players.find((p) => p.id === id)?.status === 'ACTIVE' && !livePlayers.has(id)
  const busy = t.entrants.filter((e) => !e.playerIds.every(ready)).map((e) => e.id)
  const fixture = nextPlayableFixture(t.fixtures.filter((f) => !liveFixtures.has(f.id)), busy)
  if (!fixture) return null
  const a = t.entrants.find((e) => e.id === fixture.entrantAId)
  const b = t.entrants.find((e) => e.id === fixture.entrantBId)
  return a && b ? { teamA: a.playerIds, teamB: b.playerIds, fixtureId: fixture.id } : null
}

/**
 * Withdraws a proposed (not started) tournament game the draw no longer backs:
 * its fixture is no longer READY (a result was taken back), or its pairs or
 * players changed (an opponent swap or a substitute). finalizeCommand then
 * proposes again from the draw as it is now.
 */
export function withoutStaleProposals(state: OpenSessionState): OpenSessionState {
  const t = state.tournament
  if (!t) return state
  const keep = state.matches.filter((m) => {
    if (m.status !== 'PROPOSED' || !m.fixtureId) return true
    const f = t.fixtures.find((x) => x.id === m.fixtureId)
    const a = t.entrants.find((e) => e.id === f?.entrantAId)
    const b = t.entrants.find((e) => e.id === f?.entrantBId)
    return Boolean(f && f.status === 'READY' && a && b && sameTeam(a.playerIds, m.teamA) && sameTeam(b.playerIds, m.teamB))
  })
  return keep.length === state.matches.length ? state : { ...state, matches: keep }
}

/** The first ready game held back because one of its players is on a break, in words. */
function heldByBreak(state: OpenSessionState): string | null {
  const t = state.tournament
  if (!t) return null
  const live = new Set(state.matches.filter((m) => m.status === 'PROPOSED' || m.status === 'IN_PROGRESS').map((m) => m.fixtureId))
  for (const f of t.fixtures) {
    if (f.status !== 'READY' || live.has(f.id)) continue
    for (const entrantId of [f.entrantAId, f.entrantBId]) {
      const pair = t.entrants.find((e) => e.id === entrantId)
      const away = pair?.playerIds.map((id) => state.players.find((p) => p.id === id)).find((p) => p && p.status !== 'ACTIVE')
      if (away) return `${fixtureLabel(t, f)} waits for ${away.name}, who is on a break.`
    }
  }
  return null
}

/** What a free tournament court tells the host while it has nothing to play. */
export function tournamentCourtNote(state: OpenSessionState): string | null {
  const t = state.tournament
  if (!t) return null
  if (t.phase === 'SETUP') return 'Courts fill once you generate the draw and start the tournament.'
  if (t.phase === 'DRAFT') return 'Courts fill once you start the tournament.'
  if (t.phase === 'FINISHED') return 'The tournament is over.'
  return heldByBreak(state) ?? 'Waiting for a result that decides the next game.'
}
```

```ts
// src/lib/pickleball/open/tournament/commands.ts
// The tournament commands and the draw side of every game command. The
// reducer stays the one entry point (spec §3.4); it hands tournament work here.
import type { OpenCommand } from '../../../schemas/pickleball/open/commands'
import type { CommandResult } from '../reducer'
import { LIMITS, type CommandContext, type OpenMatch, type OpenSessionState } from '../types'
import { generateDraw, unpairedPlayers } from './draw'
import { applyDraftEdit, applyRunningEdit } from './drawEdits'
import { drawViolation } from './drawRules'
import { editFixtureResult, fixtureAbandoned, fixtureFinished, fixtureStarted, reopenFixture } from './progress'
import type { EditResult, TournamentState } from './types'

export type TournamentCommand = Extract<OpenCommand, { type: 'GENERATE_DRAW' | 'EDIT_DRAW' | 'START_TOURNAMENT' | 'SUBSTITUTE_PLAYER' | 'SWAP_OPPONENTS' }>

/** Open-play commands that have no meaning in a tournament: the draw decides who plays. */
export const OPEN_PLAY_ONLY: ReadonlySet<OpenCommand['type']> = new Set<OpenCommand['type']>([
  'SET_MODE', 'ADD_RULE', 'REMOVE_RULE', 'EDIT_PROPOSAL', 'SKIP_PROPOSAL',
])

const fail = (status: 400 | 404 | 409, error: string): CommandResult => ({ ok: false, status, error })
const withTournament = (state: OpenSessionState, tournament: TournamentState): OpenSessionState => ({ ...state, tournament })

function fromEdit(state: OpenSessionState, result: EditResult): CommandResult {
  return result.ok ? { ok: true, state: withTournament(state, result.tournament) } : fail(409, result.reason)
}

function startTournament(state: OpenSessionState, t: TournamentState, ctx: CommandContext): CommandResult {
  if (t.phase === 'SETUP') return fail(409, 'Generate the draw first.')
  if (t.phase !== 'DRAFT') return fail(409, 'The tournament has already started.')
  const loose = unpairedPlayers(t, state.players)
  if (loose.length) {
    const names = loose.map((p) => p.name).join(', ')
    return fail(409, `${names} ${loose.length === 1 ? 'has' : 'have'} no partner. Swap them into a pair, or put them on a break to keep them as a substitute.`)
  }
  const reason = drawViolation(t, t, state.players)
  if (reason) return fail(409, reason)
  return { ok: true, state: withTournament(state, { ...t, phase: 'RUNNING', startedAt: ctx.now }) }
}

export function applyTournamentCommand(state: OpenSessionState, command: TournamentCommand, ctx: CommandContext): CommandResult {
  const t = state.tournament
  if (state.kind !== 'TOURNAMENT' || !t) return fail(409, 'This session is open play, not a tournament.')
  if (state.status === 'ENDED') return fail(409, 'This session has ended.')
  switch (command.type) {
    case 'GENERATE_DRAW': {
      if (t.phase !== 'SETUP' && t.phase !== 'DRAFT') return fail(409, 'The draw is locked once the tournament starts.')
      const drawn = generateDraw(state.players, command, ctx, LIMITS.maxMatches - state.matches.length)
      return drawn.ok ? { ok: true, state: withTournament(state, drawn.tournament) } : fail(409, drawn.reason)
    }
    case 'EDIT_DRAW':
      return fromEdit(state, applyDraftEdit(t, command.edit, state.players, ctx.newId))
    case 'START_TOURNAMENT':
      return startTournament(state, t, ctx)
    case 'SUBSTITUTE_PLAYER': {
      const result = applyRunningEdit(t, { kind: 'SUBSTITUTE', ...command }, state.players, state.matches)
      if (!result.ok) return fail(409, result.reason)
      // A substitute on a break comes back: they are about to play.
      const players = state.players.map((p) => (p.id === command.inPlayerId && p.status === 'BREAK' ? { ...p, status: 'ACTIVE' as const, waitingSince: ctx.now } : p))
      return { ok: true, state: { ...withTournament(state, result.tournament), players } }
    }
    case 'SWAP_OPPONENTS':
      return fromEdit(state, applyRunningEdit(t, { kind: 'SWAP_OPPONENTS', ...command }, state.players, state.matches))
  }
}

export type MatchChange = 'START' | 'FINISH' | 'EDIT' | 'UNDO' | 'ABANDON'

/**
 * Keeps the draw in step with a game command the reducer has already applied
 * to `next`. Refuses (409, with the reason) an undo or edit that a later game
 * already depends on.
 */
export function syncFixture(next: OpenSessionState, match: OpenMatch, change: MatchChange): CommandResult {
  const t = next.tournament
  if (!t || !match.fixtureId) return { ok: true, state: next }
  const saved = next.matches.find((m) => m.id === match.id) ?? match
  switch (change) {
    case 'START':
      return { ok: true, state: withTournament(next, fixtureStarted(t, match.fixtureId)) }
    case 'ABANDON':
      return { ok: true, state: withTournament(next, fixtureAbandoned(t, match.fixtureId)) }
    case 'FINISH':
      return { ok: true, state: withTournament(next, fixtureFinished(t, match.fixtureId, saved.winner ?? 'A', next.matches, next.players)) }
    case 'UNDO':
      return fromEdit(next, reopenFixture(t, match.fixtureId))
    case 'EDIT':
      return fromEdit(next, editFixtureResult(t, match.fixtureId, saved.winner ?? 'A', next.matches, next.players))
  }
}

/** Why a tournament result can't be undone (a later game depends on it), checked before anything else. */
export function undoBlocker(state: OpenSessionState, match: OpenMatch): string | null {
  const t = state.tournament
  if (!t || !match.fixtureId) return null
  const reopened = reopenFixture(t, match.fixtureId)
  return reopened.ok ? null : reopened.reason
}

/** A player in a pair can't simply leave: the pair needs a substitute, or a new draft. */
export function leavingRefusal(state: OpenSessionState, playerId: string): string | null {
  const t = state.tournament
  if (!t) return null
  const entrant = t.entrants.find((e) => e.playerIds.includes(playerId))
  if (!entrant || t.phase === 'FINISHED') return null
  const name = state.players.find((p) => p.id === playerId)?.name ?? 'That player'
  return t.phase === 'RUNNING'
    ? `${name} is in a pair. Substitute them first.`
    : `${name} is in a pair. Swap them out of it in the draft, or generate the draw again.`
}
```

- [ ] **Step 5: Wire them into the reducer and the proposer**

In `src/lib/pickleball/open/reducer.ts`:

1. Find:

```ts
import { validateResult } from './scoreValidation'
import { addMs, LIMITS, type CommandContext, type OpenMatch, type OpenPlayer, type OpenSessionState, type PairRule, type Team } from './types'
```

   Replace with:

```ts
import { validateResult } from './scoreValidation'
import { applyTournamentCommand, leavingRefusal, OPEN_PLAY_ONLY, syncFixture, undoBlocker } from './tournament/commands'
import { withoutStaleProposals } from './tournament/courts'
import { addMs, LIMITS, type CommandContext, type OpenMatch, type OpenPlayer, type OpenSessionState, type PairRule, type Team } from './types'
```

2. Find:

```ts
  if (status !== 'ACTIVE' && playing) return fail(409, `${target.name} is playing. Finish or abandon their game first.`)
  const cleared = status === 'ACTIVE' ? state : withoutMatches(state, (m) => m.status === 'PROPOSED' && matchIncludes(m, playerId))
```

   Replace with:

```ts
  if (status !== 'ACTIVE' && playing) return fail(409, `${target.name} is playing. Finish or abandon their game first.`)
  const inPair = status === 'LEFT' ? leavingRefusal(state, playerId) : null
  if (inPair) return fail(409, inPair)
  const cleared = status === 'ACTIVE' ? state : withoutMatches(state, (m) => m.status === 'PROPOSED' && matchIncludes(m, playerId))
```

3. Find:

```ts
  const next = withMatch(state, saved)
  return ok(editing ? next : withPlayers(next, new Set([...match.teamA, ...match.teamB]), { waitingSince: ctx.now }))
}
```

   Replace with:

```ts
  const next = withMatch(state, saved)
  if (editing) return syncFixture(next, saved, 'EDIT')
  return syncFixture(withPlayers(next, new Set([...match.teamA, ...match.teamB]), { waitingSince: ctx.now }), saved, 'FINISH')
}
```

4. Find:

```ts
  }
  if (state.matches.some((m) => m.id !== matchId && m.courtId === match.courtId && m.status === 'IN_PROGRESS')) {
```

   Replace with:

```ts
  }
  const dependent = undoBlocker(state, match)
  if (dependent) return fail(409, dependent)
  if (state.matches.some((m) => m.id !== matchId && m.courtId === match.courtId && m.status === 'IN_PROGRESS')) {
```

5. Find:

```ts
  const cleared = withoutMatches(state, (m) => m.status === 'PROPOSED' && (m.courtId === match.courtId || ids.some((id) => matchIncludes(m, id))))
  return ok(withMatch(cleared, { ...match, status: 'IN_PROGRESS', winner: null, scoreA: null, scoreB: null, finishedAt: null, recordedBy: null }))
}
```

   Replace with:

```ts
  const cleared = withoutMatches(state, (m) => m.status === 'PROPOSED' && (m.courtId === match.courtId || ids.some((id) => matchIncludes(m, id))))
  const reopened = { ...match, status: 'IN_PROGRESS' as const, winner: null, scoreA: null, scoreB: null, finishedAt: null, recordedBy: null }
  return syncFixture(withMatch(cleared, reopened), reopened, 'UNDO')
}
```

6. Find:

```ts
  const ended = state.status === 'ENDED'
  switch (command.type) {
```

   Replace with:

```ts
  const ended = state.status === 'ENDED'
  if (state.kind === 'TOURNAMENT' && OPEN_PLAY_ONLY.has(command.type)) {
    return fail(409, 'That is for open play. In a tournament the draw decides who plays whom.')
  }
  switch (command.type) {
```

7. Find:

```ts
      if (match.status !== 'PROPOSED') return fail(409, 'This game has already started.')
      return ok(withMatch(state, { ...match, status: 'IN_PROGRESS', startedAt: ctx.now }))
    }
```

   Replace with:

```ts
      if (match.status !== 'PROPOSED') return fail(409, 'This game has already started.')
      const started = { ...match, status: 'IN_PROGRESS' as const, startedAt: ctx.now }
      return syncFixture(withMatch(state, started), started, 'START')
    }
```

8. Find:

```ts
      const next = withMatch(state, { ...match, status: 'ABANDONED', finishedAt: ctx.now })
      return ok(withPlayers(next, new Set([...match.teamA, ...match.teamB]), { waitingSince: ctx.now }))
    }
```

   Replace with:

```ts
      const next = withMatch(state, { ...match, status: 'ABANDONED', finishedAt: ctx.now })
      return syncFixture(withPlayers(next, new Set([...match.teamA, ...match.teamB]), { waitingSince: ctx.now }), match, 'ABANDON')
    }
```

9. Find:

```ts
      return removeRule(state, command.rule)
  }
```

   Replace with:

```ts
      return removeRule(state, command.rule)
    case 'GENERATE_DRAW':
    case 'EDIT_DRAW':
    case 'START_TOURNAMENT':
    case 'SUBSTITUTE_PLAYER':
    case 'SWAP_OPPONENTS':
      return applyTournamentCommand(state, command, ctx)
  }
```

10. Find:

```ts

/** Every successful command: touch, then fill free courts. */
export function finalizeCommand(state: OpenSessionState, ctx: CommandContext): OpenSessionState {
  return fillProposals(touch(state, ctx.now), ctx)
}
```

   Replace with:

```ts

/** Every successful command: touch, withdraw tournament proposals the draw no longer backs, then fill free courts. */
export function finalizeCommand(state: OpenSessionState, ctx: CommandContext): OpenSessionState {
  return fillProposals(withoutStaleProposals(touch(state, ctx.now)), ctx)
}
```


In `src/lib/pickleball/open/propose.ts`:

1. Find:

```ts
import { activeRules } from './rules'
import { LIMITS, type CommandContext, type OpenSessionState, type StackingMode } from './types'
```

   Replace with:

```ts
import { activeRules } from './rules'
import { proposeFixture } from './tournament/courts'
import { LIMITS, type CommandContext, type OpenSessionState, type StackingMode } from './types'
```

2. Find:

```ts
  if (state.status !== 'ACTIVE' || state.matches.length >= LIMITS.maxMatches) return null
  const queue = queueOrder(state)
```

   Replace with:

```ts
  if (state.status !== 'ACTIVE' || state.matches.length >= LIMITS.maxMatches) return null
  if (state.kind === 'TOURNAMENT') return proposeFixture(state)
  const queue = queueOrder(state)
```

3. Find:

```ts
export function proposalBlocker(state: OpenSessionState): string | null {
  if (state.status !== 'ACTIVE') return null
  if (state.matches.length >= LIMITS.maxMatches) return `This session has reached ${LIMITS.maxMatches} games.`
```

   Replace with:

```ts
export function proposalBlocker(state: OpenSessionState): string | null {
  if (state.status !== 'ACTIVE' || state.kind === 'TOURNAMENT') return null
  if (state.matches.length >= LIMITS.maxMatches) return `This session has reached ${LIMITS.maxMatches} games.`
```


- [ ] **Step 6: The create route and the Durable Object**

In `src/pages/api/pickleball/open/sessions.ts`:

1. Find:

```ts
    const hostKeyHash = await sha256Base64Url(hostKey)
    const { name, hostDisplayName, location, courtCount, settings, players } = parsed.data
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const state = buildInitialState(
        { name, hostDisplayName, location: location ?? null, courtCount, settings, players: players.map((p) => ({ name: p.name, skill: p.skill ?? null, duprId: p.duprId ?? null })) },
        { now: new Date().toISOString(), newId: () => crypto.randomUUID(), publicCode: generatePublicCode(), sessionId: crypto.randomUUID() },
```

   Replace with:

```ts
    const hostKeyHash = await sha256Base64Url(hostKey)
    const { name, hostDisplayName, location, courtCount, settings, players, kind, tournament } = parsed.data
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const state = buildInitialState(
        {
          name, hostDisplayName, location: location ?? null, courtCount, settings, kind, tournamentFormat: tournament?.format,
          players: players.map((p) => ({ name: p.name, skill: p.skill ?? null, duprId: p.duprId ?? null })),
        },
        { now: new Date().toISOString(), newId: () => crypto.randomUUID(), publicCode: generatePublicCode(), sessionId: crypto.randomUUID() },
```


In `src/worker/pickleball/open/OpenSessionDO.ts` (every command gets crypto randomness; nothing else in the DO changes):

1. Find:

```ts
import { LIMITS, type CaptainRecord, type OpenSessionState } from '../../../lib/pickleball/open/types'
import { randomBase64Url, sha256Base64Url } from '../../../lib/pickleball/webCrypto.js'
import {
```

   Replace with:

```ts
import { LIMITS, type CaptainRecord, type OpenSessionState } from '../../../lib/pickleball/open/types'
import { randomBase64Url, randomInt, sha256Base64Url } from '../../../lib/pickleball/webCrypto.js'
import {
```

2. Find:

```ts
      const now = new Date().toISOString()
      const ctx = { now, newId: () => crypto.randomUUID(), actor: actor.role === 'captain' ? actor.captain.label : 'Host' }
      const result = applyCommand(loaded.state, parsed.data.command, ctx)
```

   Replace with:

```ts
      const now = new Date().toISOString()
      const ctx = { now, newId: () => crypto.randomUUID(), actor: actor.role === 'captain' ? actor.captain.label : 'Host', random: randomInt }
      const result = applyCommand(loaded.state, parsed.data.command, ctx)
```


- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run src/lib/pickleball src/worker src/lib/schemas && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 8: CHANGELOG and commit**

```markdown
- Tournament commands (generate, edit the draft, start, substitute, swap opponents) go through the same command endpoint, Durable Object and idempotency as open play. Whichever court frees next gets the next playable game of the draw; a pair with a player on a break waits and the court says so. Open-play-only commands are refused in a tournament.
```

```bash
git add src/lib/pickleball/open src/lib/schemas/pickleball/open src/pages/api/pickleball/open/sessions.ts src/worker CHANGELOG.md
git commit -m "feat(pickleball): run tournaments through the session engine"
```

---

### Task 7: Tournament snapshots, results CSV, and the API end to end

**Files:**
- Create: `src/lib/pickleball/open/tournament/view.ts`, `src/lib/pickleball/open/tournament/resultsCsv.ts`, `src/lib/pickleball/open/csv.ts`
- Create: `src/lib/pickleball/open/snapshot.tournament.test.ts`
- Create: `tests/e2e/pickleball/open-tournament.spec.js`
- Modify: `src/lib/pickleball/open/snapshot.ts`, `snapshot.test.ts`, `snapshot.phase2.test.ts`, `resultsCsv.ts`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: Tasks 1–6.
- Produces:
  - `view.ts`: `PairView`, `StandingView`, `FixtureView { id, bracket, poolLabel, roundNumber, position, label, round, status, entrantAId, entrantBId, nameA, nameB, waitingA, waitingB, scoreA, scoreB, winner, court: { label, live } | null }`, `TournamentView { format, formatLabel, phase, pairing, seeding, pairs, unpaired, fixtures, pools: [{ label, standings }], standings, champion: { entrantId, name } | null }`, `toTournamentView(state)`
  - `ViewerSnapshot` gains `kind` and `tournament: TournamentView | null`; `ViewerCourt`, `HostCourt` and the captain's court gain `fixtureLabel: string | null`; a free tournament court's `blocked` is `tournamentCourtNote`.
  - `csvText(value)` (moved to `csv.ts`, shared); `tournamentResultsCsv(state)`; `resultsCsv` delegates for tournaments.
  - e2e helpers in `open-tournament.spec.js`: `createTournament(request, { players, courtCount, format })`, `command`, `ok`, `refused`, `hostSnapshot`, `playToChampion(request, code, hostKey)`, `ipFor(code)`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest'
import { resultsCsv } from './resultsCsv'
import { toCaptainSnapshot, toHostSnapshot, toViewerSnapshot } from './snapshot'
import { makeCtx, playOut, run, tournamentSession } from './testing/tournament'
import type { CaptainRecord } from './types'

function cup() {
  const ctx = makeCtx()
  let state = tournamentSession(8, 2, 'SINGLE_ELIMINATION')
  state = { ...state, players: state.players.map((p) => ({ ...p, duprId: 'AB12C3' })) }
  state = run(state, { type: 'GENERATE_DRAW', format: 'SINGLE_ELIMINATION', pairing: 'MANUAL', seeding: 'MANUAL' }, ctx(1))
  return { state, ctx }
}

describe('tournament snapshots', () => {
  it('the viewer sees pairs, the draw and standings by name, and nothing private', () => {
    const { state } = cup()
    const viewer = toViewerSnapshot(state)
    expect(viewer.kind).toBe('TOURNAMENT')
    const t = viewer.tournament!
    expect(t).toMatchObject({ format: 'SINGLE_ELIMINATION', formatLabel: 'Single elimination', phase: 'DRAFT', champion: null })
    expect(t.pairs.map((p) => p.name)).toEqual(['Ana & Ben', 'Cy & Di', 'Eva & Fin', 'Gus & Hal'])
    expect(t.fixtures.map((f) => f.label)).toEqual(['Semi-final 1', 'Semi-final 2', 'Final'])
    expect(t.fixtures[2]).toMatchObject({ nameA: null, waitingA: 'Winner of Semi-final 1', waitingB: 'Winner of Semi-final 2' })
    const json = JSON.stringify(viewer)
    for (const banned of ['AB12C3', 'skill', 'duprId', 'hash']) expect(json).not.toContain(banned)
  })

  it('a free court says where the tournament is; a playing court names its game', () => {
    const { state, ctx } = cup()
    expect(toHostSnapshot(state).courts[0].blocked).toBe('Courts fill once you start the tournament.')
    const started = run(state, { type: 'START_TOURNAMENT' }, ctx(2))
    const host = toHostSnapshot(started)
    expect(host.courts.map((c) => c.fixtureLabel)).toEqual(['Semi-final 1', 'Semi-final 2'])
    expect(toViewerSnapshot(started).courts.map((c) => c.fixtureLabel)).toEqual(['Semi-final 1', 'Semi-final 2'])
    expect(host.viewer.tournament!.fixtures[0].court).toEqual({ label: 'Court 1', live: false })
    const captain: CaptainRecord = { id: 'cap', label: 'Court 2 captain', courtId: 'c2', keyHash: 'h', createdAt: started.createdAt }
    expect(toCaptainSnapshot(started, captain).court.fixtureLabel).toBe('Semi-final 2')
  })

  it('names the champion once the final is saved, and the results CSV lists stages and pair standings', () => {
    const { state, ctx } = cup()
    const done = playOut(run(state, { type: 'START_TOURNAMENT' }, ctx(2)), ctx)
    const t = toViewerSnapshot(done).tournament!
    expect(t.phase).toBe('FINISHED')
    expect(t.champion?.name).toBe('Ana & Ben')
    expect(t.standings[0]).toMatchObject({ name: 'Ana & Ben', wins: 2, losses: 0 })
    const csv = resultsCsv(done).split('\r\n')
    expect(csv[0]).toBe('Game,Stage,Court,Started,Finished,Pair A,Pair B,Score A,Score B,Winner')
    expect(csv[3]).toMatch(/^3,Final,Court \d,/)
    expect(csv).toContain('Rank,Pool,Pair,Played,Won,Lost,Points for,Points against,Point difference')
    expect(csv.find((line) => line.startsWith('1,All,'))).toMatch(/^1,All,Ana & Ben,2,2,0,/)
  })
})
```

The allowlist tests already pin the exact key sets; update them for the new keys.

1. Find:

```ts
    expect(Object.keys(viewer).sort()).toEqual([
      'code', 'courts', 'expiresAt', 'fairness', 'hostDisplayName', 'name', 'onBreak',
      'recentResults', 'roster', 'settings', 'standings', 'status', 'version', 'waiting',
    ])
```

   Replace with:

```ts
    expect(Object.keys(viewer).sort()).toEqual([
      'code', 'courts', 'expiresAt', 'fairness', 'hostDisplayName', 'kind', 'name', 'onBreak',
      'recentResults', 'roster', 'settings', 'standings', 'status', 'tournament', 'version', 'waiting',
    ])
```


1. Find:

```ts
    expect(Object.keys(snap.court.match ?? {}).sort()).toEqual(matchKeys)
    expect(Object.keys(snap.court).sort()).toEqual(['blocked', 'enabled', 'id', 'label', 'match', 'position'])
    expect(snap.finished.length).toBeGreaterThan(0)
```

   Replace with:

```ts
    expect(Object.keys(snap.court.match ?? {}).sort()).toEqual(matchKeys)
    expect(Object.keys(snap.court).sort()).toEqual(['blocked', 'enabled', 'fixtureLabel', 'id', 'label', 'match', 'position'])
    expect(snap.finished.length).toBeGreaterThan(0)
```


The API end to end: every format from generate to champion, the refusals, a substitute, a captain on a tournament court, and a retried Generate (Review Focus 5). Every call carries its test's own address, because parallel tests share one local address and the host routes are limited per address.

```js
// Free tournaments (spec §6): generate → edit → start → play to a champion for
// every format, plus the edits the draw refuses. API tests drive the real
// Worker and Durable Object; the screen tests drive the console and board.
import { test, expect } from '@playwright/test'

const NAMES = ['Ana', 'Ben', 'Cy', 'Di', 'Eva', 'Fin', 'Gus', 'Hal', 'Ivy', 'Jo', 'Kai', 'Lu', 'Max', 'Ned', 'Oz', 'Pia', 'Quin', 'Rae']

// Each create claims its own address: creation is limited to 10 per IP per day (see open-play.spec.js).
const freshIp = () => `10.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 254) + 1}`

async function createTournament(request, { players = 8, courtCount = 2, format = 'ROUND_ROBIN' } = {}) {
  const response = await request.post('/api/pickleball/open/sessions', {
    headers: { 'cf-connecting-ip': freshIp() },
    data: {
      name: 'Saturday Cup', hostDisplayName: 'Coach Mike', courtCount, kind: 'TOURNAMENT', tournament: { format },
      settings: { mode: 'PADDLE_STACK', target: 11, scoringStyle: 'SIDEOUT' },
      players: NAMES.slice(0, players).map((name, i) => ({ name, skill: 5 - (i % 5), duprId: 'AB12C3' })),
    },
  })
  expect(response.status()).toBe(201)
  return response.json()
}

// Host routes allow 120 requests a minute per address, and parallel tests share
// one local address, so every call in this file comes from its test's own address.
const testIp = new Map()
const ipFor = (code) => testIp.get(code) ?? testIp.set(code, freshIp()).get(code)

function command(request, code, hostKey, cmd) {
  return request.post(`/api/pickleball/open/s/${code}/commands`, {
    headers: { 'X-Host-Key': hostKey, 'cf-connecting-ip': ipFor(code) },
    data: { idempotencyKey: crypto.randomUUID(), command: cmd },
  })
}

async function ok(request, code, hostKey, cmd) {
  const response = await command(request, code, hostKey, cmd)
  expect(response.status(), `${cmd.type}: ${await response.text()}`).toBe(200)
  return (await response.json()).host
}

async function refused(request, code, hostKey, cmd) {
  const response = await command(request, code, hostKey, cmd)
  expect(response.status()).toBe(409)
  return (await response.json()).error
}

async function hostSnapshot(request, code, hostKey) {
  const response = await request.get(`/api/pickleball/open/s/${code}/host`, { headers: { 'X-Host-Key': hostKey, 'cf-connecting-ip': ipFor(code) } })
  expect(response.status()).toBe(200)
  return response.json()
}

/** Starts and saves the game on the first busy court (side A wins 11–6) until the tournament is over. */
async function playToChampion(request, code, hostKey) {
  let host = await hostSnapshot(request, code, hostKey)
  for (let guard = 0; guard < 80; guard += 1) {
    if (host.viewer.tournament.phase === 'FINISHED') return host
    const match = host.courts.map((c) => c.match).find(Boolean)
    expect(match, 'a free court always gets the next playable game').toBeTruthy()
    if (match.status === 'PROPOSED') await ok(request, code, hostKey, { type: 'START_MATCH', matchId: match.id })
    host = await ok(request, code, hostKey, { type: 'RECORD_RESULT', matchId: match.id, winner: 'A', scoreA: 11, scoreB: 6 })
  }
  throw new Error('the tournament did not finish')
}

test.describe('tournaments (API)', () => {
  for (const [format, players, pairing, seeding, games] of [
    ['ROUND_ROBIN', 8, 'RANDOM', 'RANDOM', 6],
    ['POOL_TO_BRACKET', 16, 'BALANCED', 'BY_SKILL', 15],
    ['SINGLE_ELIMINATION', 10, 'MANUAL', 'MANUAL', 4],
    ['DOUBLE_ELIMINATION', 8, 'BALANCED', 'RANDOM', 6],
  ]) {
    test(`${format}: generate, edit the draft, start, and play to a champion`, async ({ request }) => {
      const { code, hostKey } = await createTournament(request, { players, format })
      let host = await ok(request, code, hostKey, { type: 'GENERATE_DRAW', format, pairing, seeding })
      const t = host.viewer.tournament
      expect(t.phase).toBe('DRAFT')
      expect(t.fixtures).toHaveLength(games)
      expect(host.courts.every((c) => c.match === null)).toBe(true)

      // An unrestricted draft edit: two players in different pairs trade places.
      const [first, second] = t.pairs
      host = await ok(request, code, hostKey, { type: 'EDIT_DRAW', edit: { kind: 'SWAP_PLAYERS', playerIds: [first.playerIds[0], second.playerIds[0]] } })
      expect(host.viewer.tournament.pairs[0].playerIds).toEqual([second.playerIds[0], first.playerIds[1]])

      host = await ok(request, code, hostKey, { type: 'START_TOURNAMENT' })
      expect(host.courts.map((c) => c.fixtureLabel).every(Boolean)).toBe(true)

      const done = await playToChampion(request, code, hostKey)
      expect(done.viewer.tournament.fixtures.every((f) => f.status === 'FINISHED')).toBe(true)
      const board = await (await request.get(`/api/pickleball/open/s/${code}/state`)).json()
      expect(board.tournament.champion?.name).toMatch(/ & /)
      expect(JSON.stringify(board)).not.toMatch(/AB12C3|skill|duprId/)

      const csv = await (await request.get(`/api/pickleball/open/s/${code}/results.csv`, { headers: { 'X-Host-Key': hostKey, 'cf-connecting-ip': ipFor(code) } })).text()
      expect(csv).toContain('Game,Stage,Court')
      expect(csv).toContain('Rank,Pool,Pair,Played,Won,Lost')
    })
  }

  test('edits that break the draw are refused with the reason', async ({ request }) => {
    const { code, hostKey } = await createTournament(request, { players: 9 })
    let host = await ok(request, code, hostKey, { type: 'GENERATE_DRAW', format: 'ROUND_ROBIN', pairing: 'MANUAL', seeding: 'MANUAL' })
    const t = host.viewer.tournament
    const [g1, g2] = t.fixtures.filter((f) => f.roundNumber === 1)
    expect(await refused(request, code, hostKey, { type: 'EDIT_DRAW', edit: { kind: 'SET_OPPONENT', fixtureId: g1.id, side: 'B', entrantId: g2.entrantBId } }))
      .toMatch(/would play each other twice\.$/)
    expect(await refused(request, code, hostKey, { type: 'EDIT_DRAW', edit: { kind: 'MOVE_PAIR', entrantId: t.pairs[0].id, poolLabel: 'B' } }))
      .toBe('Only a draw with pools has pools to move between.')
    expect(await refused(request, code, hostKey, { type: 'START_TOURNAMENT' })).toBe('Ivy has no partner. Swap them into a pair, or put them on a break to keep them as a substitute.')
    expect(await refused(request, code, hostKey, { type: 'SET_MODE', mode: 'BALANCED' })).toBe('That is for open play. In a tournament the draw decides who plays whom.')

    const ivy = host.players.find((p) => p.name === 'Ivy')
    await ok(request, code, hostKey, { type: 'SET_PLAYER_STATUS', playerId: ivy.id, status: 'BREAK' })
    host = await ok(request, code, hostKey, { type: 'START_TOURNAMENT' })
    expect(await refused(request, code, hostKey, { type: 'EDIT_DRAW', edit: { kind: 'SWAP_PLAYERS', playerIds: [t.pairs[0].playerIds[0], t.pairs[1].playerIds[0]] } }))
      .toMatch(/^The draw is locked once the tournament starts\./)
    expect(await refused(request, code, hostKey, { type: 'GENERATE_DRAW', format: 'ROUND_ROBIN', pairing: 'RANDOM', seeding: 'RANDOM' })).toBe('The draw is locked once the tournament starts.')

    const game = host.courts[0].match
    await ok(request, code, hostKey, { type: 'START_MATCH', matchId: game.id })
    const pairOnCourt = host.viewer.tournament.pairs.find((p) => p.playerIds.includes(game.teamA[0]))
    expect(await refused(request, code, hostKey, { type: 'SUBSTITUTE_PLAYER', entrantId: pairOnCourt.id, outPlayerId: game.teamA[0], inPlayerId: ivy.id }))
      .toMatch(/are on court\. Substitute after their game\.$/)
    const later = host.viewer.tournament.fixtures.find((f) => f.roundNumber === 2)
    expect(await refused(request, code, hostKey, { type: 'SWAP_OPPONENTS', fixtureId: g1.id, side: 'B', otherFixtureId: later.id, otherSide: 'B' }))
      .toMatch(/same round|already started/)
    expect(await refused(request, code, hostKey, { type: 'SET_PLAYER_STATUS', playerId: game.teamA[0], status: 'LEFT' })).toMatch(/is playing|Substitute them first/)
  })

  test('a substitute takes a player’s place in a pair that is not on court', async ({ request }) => {
    const { code, hostKey } = await createTournament(request, { players: 9, courtCount: 1 })
    await ok(request, code, hostKey, { type: 'GENERATE_DRAW', format: 'ROUND_ROBIN', pairing: 'MANUAL', seeding: 'MANUAL' })
    let host = await hostSnapshot(request, code, hostKey)
    const ivy = host.players.find((p) => p.name === 'Ivy')
    await ok(request, code, hostKey, { type: 'SET_PLAYER_STATUS', playerId: ivy.id, status: 'BREAK' })
    host = await ok(request, code, hostKey, { type: 'START_TOURNAMENT' })
    const onCourt = new Set([...host.courts[0].match.teamA, ...host.courts[0].match.teamB])
    const resting = host.viewer.tournament.pairs.find((p) => !p.playerIds.some((id) => onCourt.has(id)))
    host = await ok(request, code, hostKey, { type: 'SUBSTITUTE_PLAYER', entrantId: resting.id, outPlayerId: resting.playerIds[1], inPlayerId: ivy.id })
    const after = host.viewer.tournament.pairs.find((p) => p.id === resting.id)
    expect(after.playerIds).toEqual([resting.playerIds[0], ivy.id])
    expect(host.players.find((p) => p.id === ivy.id).status).toBe('ACTIVE')
  })

  test('a court captain saves results on their tournament court, and nothing else', async ({ request }) => {
    const { code, hostKey } = await createTournament(request, { players: 8 })
    await ok(request, code, hostKey, { type: 'GENERATE_DRAW', format: 'SINGLE_ELIMINATION', pairing: 'MANUAL', seeding: 'MANUAL' })
    const host = await ok(request, code, hostKey, { type: 'START_TOURNAMENT' })
    const made = await request.post(`/api/pickleball/open/s/${code}/captains`, { headers: { 'X-Host-Key': hostKey, 'cf-connecting-ip': ipFor(code) }, data: { courtId: host.courts[0].id } })
    const { captainKey } = await made.json()
    const asCaptain = (cmd) => request.post(`/api/pickleball/open/s/${code}/commands`, {
      headers: { 'X-Captain-Key': captainKey }, data: { idempotencyKey: crypto.randomUUID(), command: cmd },
    })
    const view = await (await request.get(`/api/pickleball/open/s/${code}/captain`, { headers: { 'X-Captain-Key': captainKey } })).json()
    expect(view.court.fixtureLabel).toBe('Semi-final 1')
    const saved = await asCaptain({ type: 'RECORD_RESULT', matchId: host.courts[0].match.id, winner: 'B', scoreA: 9, scoreB: 11 })
    expect(saved.status()).toBe(200)
    // The final still waits for the other semi-final, so this court has nothing to play yet.
    expect((await saved.json()).captain.court.blocked).toBe('Waiting for a result that decides the next game.')
    expect((await asCaptain({ type: 'START_TOURNAMENT' })).status()).toBe(403)
    const board = await (await request.get(`/api/pickleball/open/s/${code}/state`)).json()
    expect(board.tournament.fixtures.find((f) => f.label === 'Final').nameA).not.toBeNull()
  })

  test('a retried Generate (same idempotency key) never draws again', async ({ request }) => {
    const { code, hostKey } = await createTournament(request, { players: 8 })
    const send = () => request.post(`/api/pickleball/open/s/${code}/commands`, {
      headers: { 'X-Host-Key': hostKey, 'cf-connecting-ip': ipFor(code) },
      data: { idempotencyKey: 'generate-once-1234', command: { type: 'GENERATE_DRAW', format: 'ROUND_ROBIN', pairing: 'RANDOM', seeding: 'RANDOM' } },
    })
    const first = await (await send()).json()
    const again = await (await send()).json()
    expect(again.version).toBe(first.version)
    expect(again.host.viewer.tournament.pairs).toEqual(first.host.viewer.tournament.pairs)
  })
})
```

- [ ] **Step 2: Run the unit tests to verify they fail**

Run: `npx vitest run src/lib/pickleball/open`
Expected: FAIL. `viewer.kind`/`viewer.tournament` are undefined; the key-set tests fail on the missing keys.

- [ ] **Step 3: Implement the view and the CSV**

```ts
// src/lib/pickleball/open/tournament/view.ts
// The tournament part of every snapshot (spec §7): an ALLOWLIST built field
// by field, like snapshot.ts. Pair and player names, ids, scores and court
// labels only: never a skill, a DUPR ID or anything secret.
import type { OpenSessionState, Side } from '../types'
import { unpairedPlayers } from './draw'
import { FORMAT_INFO } from './info'
import { fixtureLabel, pairName, roundLabel, sourceLabel } from './labels'
import { champion } from './progress'
import { overallStandings, poolLabels, poolStandings, type PairStanding } from './standings'
import type { FixtureBracket, FixtureStatus, PairingMethod, SeedingMethod, TournamentFormat, TournamentPhase } from './types'

export interface PairView {
  id: string
  name: string
  playerIds: [string, string]
  seed: number
  poolLabel: string | null
}

export interface StandingView {
  entrantId: string
  name: string
  rank: number
  played: number
  wins: number
  losses: number
  pointsFor: number
  pointsAgainst: number
  pointDifferential: number
}

export interface FixtureView {
  id: string
  bracket: FixtureBracket
  poolLabel: string | null
  roundNumber: number
  position: number
  /** "Semi-final 1", "Pool A · Round 2". */
  label: string
  /** The round alone: "Semi-final", "Pool A · Round 2". */
  round: string
  status: FixtureStatus
  entrantAId: string | null
  entrantBId: string | null
  nameA: string | null
  nameB: string | null
  /** What an empty side waits for: "Winner of Semi-final 1", "Pool B runner-up". */
  waitingA: string | null
  waitingB: string | null
  scoreA: number | null
  scoreB: number | null
  winner: Side | null
  /** The court this game is proposed to or playing on. */
  court: { label: string; live: boolean } | null
}

export interface TournamentView {
  format: TournamentFormat
  formatLabel: string
  phase: TournamentPhase
  pairing: PairingMethod
  seeding: SeedingMethod
  pairs: PairView[]
  /** Checked-in players in no pair: flagged in the draft (spec §6.1), substitutes once running. */
  unpaired: Array<{ id: string; name: string }>
  fixtures: FixtureView[]
  pools: Array<{ label: string; standings: StandingView[] }>
  standings: StandingView[]
  champion: { entrantId: string; name: string } | null
}

function standingView(row: PairStanding): StandingView {
  return {
    entrantId: row.entrantId, name: row.displayName, rank: row.rank, played: row.played, wins: row.wins, losses: row.losses,
    pointsFor: row.pointsFor, pointsAgainst: row.pointsAgainst, pointDifferential: row.pointDifferential,
  }
}

export function toTournamentView(state: OpenSessionState): TournamentView | null {
  const t = state.tournament
  if (!t) return null
  const { players, matches } = state
  const name = (entrantId: string | null) => {
    const entrant = entrantId ? t.entrants.find((e) => e.id === entrantId) : undefined
    return entrant ? pairName(entrant, players) : null
  }
  const courtLabel = (courtId: string) => state.courts.find((c) => c.id === courtId)?.label ?? ''
  const winnerEntrant = champion(t, matches, players)
  return {
    format: t.format,
    formatLabel: FORMAT_INFO[t.format].label,
    phase: t.phase,
    pairing: t.pairing,
    seeding: t.seeding,
    pairs: t.entrants.map((e) => ({ id: e.id, name: pairName(e, players), playerIds: [e.playerIds[0], e.playerIds[1]], seed: e.seed, poolLabel: e.poolLabel })),
    unpaired: unpairedPlayers(t, players).map((p) => ({ id: p.id, name: p.name })),
    fixtures: t.fixtures.map((f) => {
      const saved = matches.find((m) => m.fixtureId === f.id && m.status === 'FINISHED')
      const live = matches.find((m) => m.fixtureId === f.id && (m.status === 'PROPOSED' || m.status === 'IN_PROGRESS'))
      return {
        id: f.id, bracket: f.bracket, poolLabel: f.poolLabel, roundNumber: f.roundNumber, position: f.position,
        label: fixtureLabel(t, f), round: roundLabel(t.format, t.fixtures, f), status: f.status,
        entrantAId: f.entrantAId, entrantBId: f.entrantBId, nameA: name(f.entrantAId), nameB: name(f.entrantBId),
        waitingA: f.entrantAId ? null : sourceLabel(t, f.sourceA), waitingB: f.entrantBId ? null : sourceLabel(t, f.sourceB),
        scoreA: saved?.scoreA ?? null, scoreB: saved?.scoreB ?? null,
        winner: f.winnerEntrantId === null ? null : f.winnerEntrantId === f.entrantAId ? 'A' : 'B',
        court: live ? { label: courtLabel(live.courtId), live: live.status === 'IN_PROGRESS' } : null,
      }
    }),
    pools: poolLabels(t).map((label) => ({ label, standings: poolStandings(t, label, matches, players).map(standingView) })),
    standings: overallStandings(t, matches, players).map(standingView),
    champion: winnerEntrant ? { entrantId: winnerEntrant.id, name: pairName(winnerEntrant, players) } : null,
  }
}
```

```ts
// src/lib/pickleball/open/csv.ts
// A cell opening with = + - @ is executed as a formula by Excel and Sheets.
// Player names are user input, so text cells are prefixed with ' to defuse that.
export function csvText(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value
  return /[",\r\n]/.test(safe) || safe !== value ? `"${safe.replace(/"/g, '""')}"` : safe
}
```

```ts
// src/lib/pickleball/open/tournament/resultsCsv.ts
// "Download results (CSV)" for a tournament (spec §8): every game with its
// stage, then the overall standings, then each pool's.
import { csvText } from '../csv'
import type { OpenSessionState } from '../types'
import { fixtureLabel, pairName } from './labels'
import { overallStandings, poolLabels, poolStandings, type PairStanding } from './standings'

function standingRows(rows: readonly PairStanding[], pool: string): string[] {
  return rows.map((row) => [
    String(row.rank), pool, csvText(row.displayName), String(row.played), String(row.wins), String(row.losses),
    String(row.pointsFor), String(row.pointsAgainst), String(row.pointDifferential),
  ].join(','))
}

export function tournamentResultsCsv(state: OpenSessionState): string {
  const t = state.tournament
  if (!t) return ''
  const { players, matches } = state
  const court = (id: string) => state.courts.find((c) => c.id === id)?.label ?? ''
  const pair = (entrantId: string | null) => {
    const entrant = t.entrants.find((e) => e.id === entrantId)
    return entrant ? pairName(entrant, players) : ''
  }
  const games = matches
    .filter((m) => m.status === 'FINISHED' && m.fixtureId)
    .sort((a, b) => a.seq - b.seq)
    .map((m, i) => {
      const f = t.fixtures.find((x) => x.id === m.fixtureId)
      return [
        String(i + 1), csvText(f ? fixtureLabel(t, f) : ''), csvText(court(m.courtId)), m.startedAt ?? '', m.finishedAt ?? '',
        csvText(pair(f?.entrantAId ?? null)), csvText(pair(f?.entrantBId ?? null)),
        m.scoreA === null ? '' : String(m.scoreA), m.scoreB === null ? '' : String(m.scoreB), m.winner ?? '',
      ].join(',')
    })
  const header = 'Rank,Pool,Pair,Played,Won,Lost,Points for,Points against,Point difference'
  return [
    'Game,Stage,Court,Started,Finished,Pair A,Pair B,Score A,Score B,Winner',
    ...games,
    '',
    header,
    ...standingRows(overallStandings(t, matches, players), 'All'),
    ...poolLabels(t).flatMap((label) => ['', header, ...standingRows(poolStandings(t, label, matches, players), label)]),
  ].join('\r\n')
}
```

In `src/lib/pickleball/open/resultsCsv.ts` (the formula guard moves to `csv.ts` so both CSVs share it):

1. Find:

```ts
import { computeStandings } from './standings'
import type { OpenSessionState } from './types'

// A cell opening with = + - @ is executed as a formula by Excel and Sheets.
// Player names are user input, so text cells are prefixed with ' to defuse that.
function text(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value
  return /[",\r\n]/.test(safe) || safe !== value ? `"${safe.replace(/"/g, '""')}"` : safe
}

```

   Replace with:

```ts
import { csvText as text } from './csv'
import { computeStandings } from './standings'
import { tournamentResultsCsv } from './tournament/resultsCsv'
import type { OpenSessionState } from './types'

```

2. Find:

```ts
export function resultsCsv(state: OpenSessionState): string {
  const name = (id: string) => state.players.find((p) => p.id === id)?.name ?? ''
```

   Replace with:

```ts
export function resultsCsv(state: OpenSessionState): string {
  if (state.kind === 'TOURNAMENT') return tournamentResultsCsv(state)
  const name = (id: string) => state.players.find((p) => p.id === id)?.name ?? ''
```


- [ ] **Step 4: Add the view to the snapshots**

In `src/lib/pickleball/open/snapshot.ts`:

1. Find:

```ts
import { computeStandings, type StandingRow } from './standings'
import type { CaptainRecord, OpenMatch, OpenSessionState, Side, StackingMode } from './types'
```

   Replace with:

```ts
import { computeStandings, type StandingRow } from './standings'
import { tournamentCourtNote } from './tournament/courts'
import { fixtureLabel } from './tournament/labels'
import { toTournamentView, type TournamentView } from './tournament/view'
import type { CaptainRecord, OpenMatch, OpenSessionState, Side, StackingMode } from './types'
```

2. Find:

```ts
  startedAt: string | null
}
```

   Replace with:

```ts
  startedAt: string | null
  /** The tournament game on this court ("Semi-final 1"); null in open play. */
  fixtureLabel: string | null
}
```

3. Find:

```ts
  code: string
  name: string
```

   Replace with:

```ts
  code: string
  kind: OpenSessionState['kind']
  name: string
```

4. Find:

```ts
  recentResults: Array<{ matchId: string; courtLabel: string; teamA: string[]; teamB: string[]; scoreA: number | null; scoreB: number | null; winner: Side; finishedAt: string }>
}
```

   Replace with:

```ts
  recentResults: Array<{ matchId: string; courtLabel: string; teamA: string[]; teamB: string[]; scoreA: number | null; scoreB: number | null; winner: Side; finishedAt: string }>
  /** Pairs, the draw, pool and overall standings (spec §6.7, §7); null in open play. */
  tournament: TournamentView | null
}
```

5. Find:

```ts
  match: OpenMatch | null
  /** Why a free court has no proposal (a keep-together/apart rule), else null. */
  blocked: string | null
}
```

   Replace with:

```ts
  match: OpenMatch | null
  /** Why a free court has no proposal (a keep-together/apart rule, or where the tournament is), else null. */
  blocked: string | null
  /** The tournament game on this court ("Semi-final 1"); null in open play. */
  fixtureLabel: string | null
}
```

6. Find:

```ts

function liveMatch(state: OpenSessionState, courtId: string): OpenMatch | null {
```

   Replace with:

```ts

function labelFor(state: OpenSessionState, match: OpenMatch | null): string | null {
  const t = state.tournament
  const fixture = t && match?.fixtureId ? t.fixtures.find((f) => f.id === match.fixtureId) : undefined
  return t && fixture ? fixtureLabel(t, fixture) : null
}

function liveMatch(state: OpenSessionState, courtId: string): OpenMatch | null {
```

7. Find:

```ts
    code: state.publicCode,
    name: state.name,
```

   Replace with:

```ts
    code: state.publicCode,
    kind: state.kind,
    name: state.name,
```

8. Find:

```ts
        startedAt: match?.startedAt ?? null,
      }
```

   Replace with:

```ts
        startedAt: match?.startedAt ?? null,
        fixtureLabel: labelFor(state, match),
      }
```

9. Find:

```ts
      })),
  }
```

   Replace with:

```ts
      })),
    tournament: toTournamentView(state),
  }
```

10. Find:

```ts
export function hostCourts(state: OpenSessionState): HostCourt[] {
  const blocker = proposalBlocker(state)
  return [...state.courts].sort((a, b) => a.position - b.position).map((c) => {
    const match = c.enabled ? liveMatch(state, c.id) : null
    return { id: c.id, label: c.label, position: c.position, enabled: c.enabled, match, blocked: c.enabled && !match ? blocker : null }
  })
```

   Replace with:

```ts
export function hostCourts(state: OpenSessionState): HostCourt[] {
  const blocker = state.kind === 'TOURNAMENT' ? tournamentCourtNote(state) : proposalBlocker(state)
  return [...state.courts].sort((a, b) => a.position - b.position).map((c) => {
    const match = c.enabled ? liveMatch(state, c.id) : null
    return {
      id: c.id, label: c.label, position: c.position, enabled: c.enabled, match,
      blocked: c.enabled && !match ? blocker : null, fixtureLabel: labelFor(state, match),
    }
  })
```

11. Find:

```ts
    court: court
      ? { id: court.id, label: court.label, position: court.position, enabled: court.enabled, match: court.match ? captainMatch(court.match) : null, blocked: court.blocked }
      : { id: captain.courtId, label: '', position: 0, enabled: false, match: null, blocked: null },
    players: captainPlayers(state),
```

   Replace with:

```ts
    court: court
      ? {
          id: court.id, label: court.label, position: court.position, enabled: court.enabled,
          match: court.match ? captainMatch(court.match) : null, blocked: court.blocked, fixtureLabel: court.fixtureLabel,
        }
      : { id: captain.courtId, label: '', position: 0, enabled: false, match: null, blocked: null, fixtureLabel: null },
    players: captainPlayers(state),
```


- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/pickleball src/worker && npm run typecheck`
Expected: PASS.

Run: `npm run build && npx playwright test tests/e2e/pickleball/open-tournament.spec.js tests/e2e/pickleball/open-play.spec.js`
Expected: PASS. The local D1 needs `0018`: the worker web server applies pending migrations (`npx wrangler d1 migrations apply devlab-pickleball --local`) before `wrangler dev` starts.

- [ ] **Step 6: CHANGELOG and commit**

```markdown
- The live board, captain and host snapshots carry an allowlisted tournament view: pairs, the draw with what each empty slot waits for, pool and overall pair standings, the champion, and the game on each court. Results CSV for a tournament lists every game with its stage and the pair standings.
```

```bash
git add src/lib/pickleball/open tests/e2e/pickleball/open-tournament.spec.js CHANGELOG.md
git commit -m "feat(pickleball): tournament board data and results csv"
```

---

### Task 8: Create form, draw setup and the draft editor

**Files:**
- Create: `src/pickleball-open/tournament/drawTaps.js`, `drawTaps.test.js`, `bracketLayout.js`, `bracketLayout.test.js`, `tabs.js`
- Create: `src/pickleball-open/tournament/Choice.jsx`, `TournamentSetup.jsx`, `DraftEditor.jsx`, `BracketView.jsx`, `PairStandings.jsx`, `TournamentHost.jsx`
- Modify: `src/pickleball-open/CreateSessionApp.jsx`, `src/pickleball-open/components/HostConsole.jsx`, `PlayersPanel.jsx`, `CourtCard.jsx`
- Modify: `tests/e2e/pickleball/open-tournament.spec.js` (append)
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: `TournamentView` (Task 7) at `host.viewer.tournament`; `FORMAT_INFO`, `PAIRING_INFO`, `SEEDING_INFO`, `FORMAT_ORDER` (Task 3); `minimumEntrants` (reused); the e2e helpers (Task 7).
- Produces:
  - `drawTaps.js`: `tap(selected, item) → { selected, chosen }`, `isSelected(selected, item)`, `commandFor([first, second], phase)` — items are `{ kind: 'player', id }`, `{ kind: 'pair', id }` or `{ kind: 'slot', fixtureId, side, entrantId }`
  - `bracketLayout.js`: `drawSections(tournament) → [{ key, label?, title, kind: 'pool' | 'rounds' | 'bracket', rounds: [{ round, title, games }] }]`, `nextGames(tournament, limit = 4)`
  - `tabs.js`: `TOURNAMENT_TABS`, `BOARD_TABS` (constants live here, not in component files)
  - `Choice.jsx`: `Choice`, `FormatPicker`, `PairingPicker`, `SeedingPicker`
  - `BracketView.jsx`: default `BracketView({ tournament, onSlot?, selected?, highlight? })`, named `GameCard({ fixture, onSlot?, selected?, highlight? })` (an `<article aria-label={fixture.label}>`)
  - `PairStandings({ rows, highlight?, compact? })`, `TournamentSetup({ tournament, activeCount, send })`, `DraftEditor({ tournament, nameOf, send })`, `TournamentHost({ host, send, tab, nameOf, courtLabel, onStart, onGameOver, onEditResult })`
  - `PlayersPanel` takes `showSkill` instead of `mode`; `CourtCard` hides Edit when `onEdit` is null and shows `court.fixtureLabel`.

- [ ] **Step 1: Write the failing tests**

```js
import { describe, expect, it } from 'vitest'
import { commandFor, isSelected, tap } from './drawTaps'

const ana = { kind: 'player', id: 'ana' }
const ben = { kind: 'player', id: 'ben' }
const pairOne = { kind: 'pair', id: 'e1' }
const slotA = { kind: 'slot', fixtureId: 'f1', side: 'B', entrantId: 'e2' }
const slotB = { kind: 'slot', fixtureId: 'f2', side: 'A', entrantId: 'e3' }

describe('tap to select', () => {
  it('selects, then a second tap of the same kind chooses both', () => {
    const first = tap(null, ana)
    expect(first).toEqual({ selected: ana, chosen: null })
    expect(isSelected(first.selected, ana)).toBe(true)
    expect(tap(first.selected, ben)).toEqual({ selected: null, chosen: [ana, ben] })
  })

  it('tapping the selection again clears it; a different kind starts over', () => {
    expect(tap(ana, { kind: 'player', id: 'ana' })).toEqual({ selected: null, chosen: null })
    expect(tap(ana, pairOne)).toEqual({ selected: pairOne, chosen: null })
    expect(tap(slotA, { ...slotA, entrantId: 'other' })).toEqual({ selected: null, chosen: null })
  })
})

describe('commandFor', () => {
  it('turns two taps into the draft edit or the running swap', () => {
    expect(commandFor([ana, ben], 'DRAFT')).toEqual({ type: 'EDIT_DRAW', edit: { kind: 'SWAP_PLAYERS', playerIds: ['ana', 'ben'] } })
    expect(commandFor([pairOne, { kind: 'pair', id: 'e2' }], 'DRAFT')).toEqual({ type: 'EDIT_DRAW', edit: { kind: 'SWAP_PAIRS', entrantIds: ['e1', 'e2'] } })
    expect(commandFor([slotA, slotB], 'DRAFT')).toEqual({ type: 'EDIT_DRAW', edit: { kind: 'SET_OPPONENT', fixtureId: 'f1', side: 'B', entrantId: 'e3' } })
    expect(commandFor([slotA, slotB], 'RUNNING')).toEqual({ type: 'SWAP_OPPONENTS', fixtureId: 'f1', side: 'B', otherFixtureId: 'f2', otherSide: 'A' })
  })
})
```

```js
import { describe, expect, it } from 'vitest'
import { toViewerSnapshot } from '../../lib/pickleball/open/snapshot'
import { makeCtx, run, tournamentSession } from '../../lib/pickleball/open/testing/tournament'
import { drawSections, nextGames } from './bracketLayout'

function view(format, players, courts = 1) {
  const ctx = makeCtx()
  let state = run(tournamentSession(players, courts, format), { type: 'GENERATE_DRAW', format, pairing: 'MANUAL', seeding: 'MANUAL' }, ctx(1))
  state = run(state, { type: 'START_TOURNAMENT' }, ctx(2))
  return toViewerSnapshot(state).tournament
}

describe('drawSections', () => {
  it('pools first, then the bracket by round', () => {
    const sections = drawSections(view('POOL_TO_BRACKET', 16))
    expect(sections.map((s) => [s.title, s.kind])).toEqual([['Pool A', 'pool'], ['Pool B', 'pool'], ['Bracket', 'bracket']])
    expect(sections[2].rounds.map((r) => [r.title, r.games.length])).toEqual([['Semi-final', 2], ['Final', 1]])
    expect(sections[0].rounds.map((r) => r.title)).toEqual(['Pool A · Round 1', 'Pool A · Round 2', 'Pool A · Round 3'])
    // A round with one game keeps its number: pools of two pairs.
    expect(drawSections(view('POOL_TO_BRACKET', 8))[0].rounds.map((r) => r.title)).toEqual(['Pool A · Round 1'])
  })

  it('double elimination shows both brackets; round robin lists its rounds', () => {
    expect(drawSections(view('DOUBLE_ELIMINATION', 8)).map((s) => s.title)).toEqual(['Winners bracket', 'Losers bracket'])
    const rr = drawSections(view('ROUND_ROBIN', 8))
    expect(rr).toHaveLength(1)
    expect(rr[0]).toMatchObject({ title: 'Games', kind: 'rounds' })
    expect(rr[0].rounds.map((r) => r.title)).toEqual(['Round 1', 'Round 2', 'Round 3'])
  })
})

describe('nextGames', () => {
  it('lists ready games that have no court yet, earliest round first', () => {
    const t = view('ROUND_ROBIN', 8, 1)
    const next = nextGames(t)
    expect(next.every((f) => f.status === 'READY' && f.court === null)).toBe(true)
    expect(next[0].roundNumber).toBe(1)
    expect(nextGames(null)).toEqual([])
  })
})
```

Append to `tests/e2e/pickleball/open-tournament.spec.js`:

```js

/** A tournament created, drawn and (optionally) started over the API, ready for a screen test. */
async function readyTournament(request, { players = 8, courtCount = 2, format = 'SINGLE_ELIMINATION', start = true } = {}) {
  const session = await createTournament(request, { players, courtCount, format })
  await ok(request, session.code, session.hostKey, { type: 'GENERATE_DRAW', format, pairing: 'MANUAL', seeding: 'MANUAL' })
  if (start) await ok(request, session.code, session.hostKey, { type: 'START_TOURNAMENT' })
  return session
}

const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)

test.describe('tournament setup and draft (screens)', () => {
  test('a host sets up a tournament in the browser: format, draw, a swap, then start', async ({ page }) => {
    const ip = freshIp()
    await page.route('**/api/pickleball/open/sessions', (route) =>
      route.request().method() === 'POST' ? route.continue({ headers: { ...route.request().headers(), 'cf-connecting-ip': ip } }) : route.continue())
    await page.goto('/pickleball/new')
    await page.getByRole('radio', { name: /^Tournament/ }).click()
    await page.getByRole('radio', { name: /^Single elimination/ }).click()
    await page.getByLabel('Your name (shown as "Hosted by")').fill('Coach Mike')
    await page.getByRole('button', { name: 'Next: add players' }).click()
    await page.getByLabel(/Paste names/).fill(NAMES.slice(0, 8).join('\n'))
    await expect(page.locator('input[name="cf-turnstile-response"]')).toHaveValue(/.+/, { timeout: 30_000 })
    await page.getByRole('button', { name: /^Start session/ }).click()
    await page.getByRole('link', { name: 'I saved it — go to courts' }).click()

    await expect(page.getByRole('heading', { name: 'Set up the draw' })).toBeVisible()
    await page.getByRole('radio', { name: /^In list order/ }).click()
    await page.getByRole('radio', { name: /^You choose/ }).click()
    await page.getByRole('button', { name: 'Generate the draw' }).click()
    await expect(page.getByRole('heading', { name: 'Draft draw · Single elimination' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Seed 1: Ana & Ben' })).toBeVisible()

    // Tap-to-select: Ana, then Cy, swaps them between pairs 1 and 2.
    await page.getByRole('button', { name: 'Select Ana' }).click()
    await page.getByRole('button', { name: 'Select Cy' }).click()
    await expect(page.getByRole('button', { name: 'Seed 1: Cy & Ben' })).toBeVisible()

    page.once('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: 'Start tournament' }).click()
    await expect(page.getByTestId('court-1')).toContainText('Semi-final 1')
    await expect(page.getByTestId('court-1').getByRole('button', { name: 'Edit' })).toHaveCount(0)
  })

  test('an edit the draw cannot take is refused on screen with the reason', async ({ page, request }) => {
    const { code, hostKey } = await readyTournament(request, { format: 'ROUND_ROBIN', start: false })
    await page.goto(`/pickleball/s/${code}#host=${hostKey}`)
    // Round 1: Ana & Ben v Gus & Hal, Cy & Di v Eva & Fin. Swapping Gus & Hal for Eva & Fin repeats games from later rounds.
    await page.getByRole('article', { name: 'Round 1 1' }).getByRole('button', { name: 'Gus & Hal' }).click()
    await page.getByRole('article', { name: 'Round 1 2' }).getByRole('button', { name: 'Eva & Fin' }).click()
    await expect(page.getByRole('alert')).toContainText('would play each other twice')
    await expect(page.getByRole('article', { name: 'Round 1 1' })).toContainText('Gus & Hal')
  })

  for (const width of [390, 768, 1280, 1920]) {
    test(`the draft editor fits a ${width}px screen without sideways scrolling`, async ({ page, request }) => {
      const { code, hostKey } = await readyTournament(request, { players: 16, courtCount: 4, format: 'POOL_TO_BRACKET', start: false })
      await page.setViewportSize({ width, height: 900 })
      await page.goto(`/pickleball/s/${code}#host=${hostKey}`)
      await expect(page.getByRole('heading', { name: /^Draft draw/ })).toBeVisible()
      expect(await noSideScroll(page)).toBe(true)
    })
  }
})
```

- [ ] **Step 2: Run the unit tests to verify they fail**

Run: `npx vitest run src/pickleball-open/tournament`
Expected: FAIL. `./drawTaps` and `./bracketLayout` cannot be resolved.

- [ ] **Step 3: The pure helpers**

```js
// src/pickleball-open/tournament/drawTaps.js
// Tap-to-select for the draw editor (spec §11: "dragging also works by
// tap-to-select, so touch and mouse both work"). Tap one thing, then another
// of the same kind, and the pair of taps becomes one command.
//
// An item is { kind: 'player', id } | { kind: 'pair', id }
//          | { kind: 'slot', fixtureId, side, entrantId }

function same(a, b) {
  if (a.kind !== b.kind) return false
  return a.kind === 'slot' ? a.fixtureId === b.fixtureId && a.side === b.side : a.id === b.id
}

/** The next selection after a tap, and the two items to act on when a second tap completes a choice. */
export function tap(selected, item) {
  if (!selected || selected.kind !== item.kind) return { selected: item, chosen: null }
  if (same(selected, item)) return { selected: null, chosen: null }
  return { selected: null, chosen: [selected, item] }
}

export function isSelected(selected, item) {
  return Boolean(selected) && same(selected, item)
}

/** The command for two chosen items: a draft edit before Start, an opponent swap after it. */
export function commandFor([first, second], phase) {
  if (first.kind === 'player') return { type: 'EDIT_DRAW', edit: { kind: 'SWAP_PLAYERS', playerIds: [first.id, second.id] } }
  if (first.kind === 'pair') return { type: 'EDIT_DRAW', edit: { kind: 'SWAP_PAIRS', entrantIds: [first.id, second.id] } }
  if (phase === 'DRAFT') return { type: 'EDIT_DRAW', edit: { kind: 'SET_OPPONENT', fixtureId: first.fixtureId, side: first.side, entrantId: second.entrantId } }
  return { type: 'SWAP_OPPONENTS', fixtureId: first.fixtureId, side: first.side, otherFixtureId: second.fixtureId, otherSide: second.side }
}
```

```js
// src/pickleball-open/tournament/bracketLayout.js
// How the draw is laid out on screen: pools first (side by side on wide
// screens), then the bracket by round, then the losers bracket. Pure, so the
// grouping is unit-tested and the components only render it.

function byRound(fixtures) {
  const rounds = new Map()
  for (const f of fixtures) rounds.set(f.roundNumber, [...(rounds.get(f.roundNumber) ?? []), f])
  return [...rounds.entries()]
    .sort(([a], [b]) => a - b)
    .map(([round, games]) => ({ round, title: games[0].round, games: [...games].sort((a, b) => a.position - b.position) }))
}

/** [{ key, label?, title, kind: 'pool' | 'rounds' | 'bracket', rounds: [{ round, title, games }] }]; label is the pool letter. */
export function drawSections(tournament) {
  if (!tournament) return []
  const pools = [...new Set(tournament.fixtures.filter((f) => f.bracket === 'POOL').map((f) => f.poolLabel))].sort()
  const main = tournament.fixtures.filter((f) => f.bracket === 'MAIN')
  const losers = tournament.fixtures.filter((f) => f.bracket === 'LOSERS')
  const isRoundRobin = tournament.format === 'ROUND_ROBIN'
  return [
    ...pools.map((label) => ({ key: `pool-${label}`, label, title: `Pool ${label}`, kind: 'pool', rounds: byRound(tournament.fixtures.filter((f) => f.poolLabel === label)) })),
    ...(main.length
      ? [{ key: 'main', title: isRoundRobin ? 'Games' : tournament.format === 'DOUBLE_ELIMINATION' ? 'Winners bracket' : 'Bracket', kind: isRoundRobin ? 'rounds' : 'bracket', rounds: byRound(main) }]
      : []),
    ...(losers.length ? [{ key: 'losers', title: 'Losers bracket', kind: 'bracket', rounds: byRound(losers) }] : []),
  ]
}

/** Games ready to play with no court yet, earliest round first: the order free courts take them in. */
export function nextGames(tournament, limit = 4) {
  if (!tournament || tournament.phase !== 'RUNNING') return []
  return tournament.fixtures
    .filter((f) => f.status === 'READY' && !f.court)
    .sort((a, b) => a.roundNumber - b.roundNumber || a.position - b.position)
    .slice(0, limit)
}
```

```js
// src/pickleball-open/tournament/tabs.js
// The phone tab bar for a tournament console (open play keeps Courts / Players / Results).
export const TOURNAMENT_TABS = [['draw', 'Draw'], ['courts', 'Courts'], ['players', 'Players'], ['results', 'Results']]

/** The public board's phone tabs for a tournament (open play: Courts / Standings / Results). */
export const BOARD_TABS = [['courts', 'Courts'], ['draw', 'Draw'], ['standings', 'Standings']]
```

- [ ] **Step 4: The components**

```jsx
// src/pickleball-open/tournament/Choice.jsx
import { FORMAT_INFO, FORMAT_ORDER, PAIRING_INFO, SEEDING_INFO } from '../../lib/pickleball/open/tournament/info'

/** A radio group of cards, each with its one-line explanation (same look as the stacking-mode picker). */
export function Choice({ label, order, info, value, onChange, columns = false }) {
  return (
    <div className={`grid gap-2 ${columns ? 'sm:grid-cols-3' : ''}`} role="radiogroup" aria-label={label}>
      {order.map((key) => {
        const checked = key === value
        return (
          <button key={key} type="button" role="radio" aria-checked={checked} onClick={() => onChange(key)}
            className={`min-h-14 rounded-2xl p-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-pickle-neon ${checked ? 'bg-pickle-neon text-ink' : 'border border-navy-700 bg-navy-900 text-white hover:border-pickle-neon'}`}>
            <span className="block font-bold">{info[key].label}</span>
            <span className={`block text-sm ${checked ? 'text-ink' : 'text-mist'}`}>{info[key].summary}</span>
          </button>
        )
      })}
    </div>
  )
}

export function FormatPicker({ value, onChange }) {
  return <Choice label="Format" order={FORMAT_ORDER} info={FORMAT_INFO} value={value} onChange={onChange} />
}

export function PairingPicker({ value, onChange }) {
  return <Choice label="Pairs" order={['RANDOM', 'BALANCED', 'MANUAL']} info={PAIRING_INFO} value={value} onChange={onChange} columns />
}

export function SeedingPicker({ value, onChange }) {
  return <Choice label="Seeding" order={['RANDOM', 'BY_SKILL', 'MANUAL']} info={SEEDING_INFO} value={value} onChange={onChange} columns />
}
```

```jsx
// src/pickleball-open/tournament/PairStandings.jsx
// Pair standings (spec §6.7): wins, then losses, then point difference, then
// head-to-head, as ranked by the reused rankTournamentStandings.
export default function PairStandings({ rows, highlight = null, compact = false }) {
  if (!rows.length) return <p className="text-sm text-mist">No pairs yet.</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[15px]">
        <caption className="sr-only">Pair standings</caption>
        <thead className="text-xs text-mist">
          <tr><th className="py-1.5 pr-2">#</th><th className="py-1.5">Pair</th><th className="py-1.5 text-right">W–L</th><th className="py-1.5 text-right"><abbr title="Points won minus points lost" className="no-underline">+/−</abbr></th></tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.entrantId} className={`border-t border-navy-800 ${row.entrantId === highlight ? 'font-bold text-pickle-neon' : ''}`}>
              <td className="py-1.5 pr-2 font-bold text-pickle-neon">{row.played ? row.rank : '–'}</td>
              <td className="py-1.5 [overflow-wrap:anywhere]">{row.name}</td>
              <td className="py-1.5 text-right tabular-nums">{row.wins}–{row.losses}</td>
              <td className="py-1.5 text-right tabular-nums">{row.pointDifferential > 0 ? `+${row.pointDifferential}` : row.pointDifferential}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!compact && <p className="mt-2 text-xs text-mist">Ranked by wins, then fewest losses, then points won minus points lost, then the game between tied pairs.</p>}
    </div>
  )
}
```

```jsx
// src/pickleball-open/tournament/BracketView.jsx
// The draw: pools side by side on wide screens and stacked on phones, then the
// bracket round by round (spec §6.7, §11). Read-only unless onSlot is given:
// then each placed pair is a button for the tap-to-select editor.
import { drawSections } from './bracketLayout'
import { isSelected } from './drawTaps'
import PairStandings from './PairStandings.jsx'

function Side({ fixture, side, onSlot, selected, highlight }) {
  const entrantId = side === 'A' ? fixture.entrantAId : fixture.entrantBId
  const name = side === 'A' ? fixture.nameA : fixture.nameB
  const waiting = side === 'A' ? fixture.waitingA : fixture.waitingB
  const score = side === 'A' ? fixture.scoreA : fixture.scoreB
  const won = fixture.winner === side
  const item = { kind: 'slot', fixtureId: fixture.id, side, entrantId }
  const text = (
    <>
      <span className={`min-w-0 flex-1 [overflow-wrap:anywhere] ${name ? '' : 'italic text-mist'} ${won ? 'font-bold text-pickle-neon' : ''} ${highlight === entrantId && entrantId ? 'underline decoration-pickle-neon decoration-2 underline-offset-4' : ''}`}>
        {name ?? waiting ?? 'Bye'}
      </span>
      {score !== null && <span className={`shrink-0 tabular-nums ${won ? 'font-bold text-pickle-neon' : 'text-mist'}`}>{score}</span>}
    </>
  )
  if (onSlot && entrantId) {
    const chosen = isSelected(selected, item)
    return (
      <button type="button" aria-pressed={chosen} onClick={() => onSlot(item)}
        className={`flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left ${chosen ? 'bg-pickle-neon font-bold text-ink' : 'hover:bg-navy-800'}`}>
        {text}
      </button>
    )
  }
  return <div className="flex min-h-9 items-center gap-2 px-2">{text}</div>
}

export function GameCard({ fixture, onSlot, selected, highlight }) {
  const state = fixture.court ? `${fixture.court.label} · ${fixture.court.live ? 'playing' : 'up next'}` : null
  return (
    <article className={`rounded-xl p-2 text-[15px] ${fixture.court?.live ? 'border border-pickle-neon bg-ink' : 'bg-navy-900'}`} data-testid="draw-game" aria-label={fixture.label}>
      <p className="flex justify-between gap-2 px-2 text-xs text-mist"><span>{fixture.label}</span>{state && <span className="font-bold text-pickle-neon">{state}</span>}</p>
      <Side fixture={fixture} side="A" onSlot={onSlot} selected={selected} highlight={highlight} />
      <Side fixture={fixture} side="B" onSlot={onSlot} selected={selected} highlight={highlight} />
    </article>
  )
}

function Rounds({ section, onSlot, selected, highlight }) {
  // A bracket reads left to right on wide screens; rounds stack on a phone.
  const layout = section.kind === 'bracket'
    ? 'grid gap-3 md:grid-flow-col md:auto-cols-[minmax(13rem,1fr)] md:overflow-x-auto md:pb-2'
    : 'grid gap-3'
  return (
    <div className={layout}>
      {section.rounds.map((round) => (
        <div key={round.round} className="grid content-start gap-2">
          <h4 className="text-xs font-bold uppercase tracking-[0.1em] text-mist">{round.title}</h4>
          {round.games.map((game) => <GameCard key={game.id} fixture={game} onSlot={onSlot} selected={selected} highlight={highlight} />)}
        </div>
      ))}
    </div>
  )
}

export default function BracketView({ tournament, onSlot = null, selected = null, highlight = null }) {
  const sections = drawSections(tournament)
  const pools = sections.filter((s) => s.kind === 'pool')
  const rest = sections.filter((s) => s.kind !== 'pool')
  const poolTable = (label) => tournament.pools.find((p) => p.label === label)?.standings ?? []
  return (
    <div className="grid gap-5" data-testid="draw">
      {pools.length > 0 && (
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(100%,20rem),1fr))]">
          {pools.map((section) => (
            <section key={section.key} aria-label={section.title} className="grid content-start gap-3 rounded-2xl border border-navy-800 p-3">
              <h3 className="text-lg font-bold text-pickle-neon">{section.title}</h3>
              <PairStandings rows={poolTable(section.label)} highlight={highlight} compact />
              <Rounds section={section} onSlot={onSlot} selected={selected} highlight={highlight} />
            </section>
          ))}
        </div>
      )}
      {rest.map((section) => (
        <section key={section.key} aria-label={section.title} className="grid gap-3">
          <h3 className="text-lg font-bold">{section.title}</h3>
          <Rounds section={section} onSlot={onSlot} selected={selected} highlight={highlight} />
        </section>
      ))}
    </div>
  )
}
```

```jsx
// src/pickleball-open/tournament/TournamentSetup.jsx
// Spec §6.1–6.4: choose format, pairs and seeding, then Generate a draft.
// Generating again (before Start) replaces the draft.
import { useState } from 'react'
import { minimumEntrants } from '../../lib/pickleball/tournament/generateFixtures'
import { FORMAT_INFO } from '../../lib/pickleball/open/tournament/info'
import { Button, Panel } from '../components/ui.jsx'
import { FormatPicker, PairingPicker, SeedingPicker } from './Choice.jsx'

export default function TournamentSetup({ tournament, activeCount, send }) {
  const [format, setFormat] = useState(tournament.format)
  const [pairing, setPairing] = useState(tournament.pairing)
  const [seeding, setSeeding] = useState(tournament.seeding)
  const drafted = tournament.phase === 'DRAFT'
  const pairs = Math.floor(activeCount / 2)
  const short = pairs < minimumEntrants(format)

  function generate() {
    if (drafted && !window.confirm('Generate a new draw? The pairs and every edit you made to this draft are replaced.')) return
    send({ type: 'GENERATE_DRAW', format, pairing, seeding })
  }

  return (
    <Panel className="grid gap-4">
      <div>
        <h2 className="text-lg font-bold">{drafted ? 'Change the draw' : 'Set up the draw'}</h2>
        <p className="text-sm text-mist">
          {activeCount} players checked in: {pairs} pair{pairs === 1 ? '' : 's'}{activeCount % 2 ? ', 1 player left over' : ''}. Players on a break are not drawn.
        </p>
      </div>
      <div className="grid gap-2"><h3 className="text-sm font-bold uppercase tracking-[0.1em] text-mist">Format</h3><FormatPicker value={format} onChange={setFormat} /></div>
      <div className="grid gap-2"><h3 className="text-sm font-bold uppercase tracking-[0.1em] text-mist">Pairs</h3><PairingPicker value={pairing} onChange={setPairing} /></div>
      <div className="grid gap-2"><h3 className="text-sm font-bold uppercase tracking-[0.1em] text-mist">Seeding</h3><SeedingPicker value={seeding} onChange={setSeeding} /></div>
      {short && <p className="text-sm text-amber-200" role="status">{FORMAT_INFO[format].label} needs at least {minimumEntrants(format)} pairs. Add players first.</p>}
      <Button variant={drafted ? 'ghost' : 'primary'} disabled={short} onClick={generate}>{drafted ? 'Generate again' : 'Generate the draw'}</Button>
    </Panel>
  )
}
```

```jsx
// src/pickleball-open/tournament/DraftEditor.jsx
// Spec §6.4: the draft is freely editable by tap-to-select. Every edit goes to
// the server, which re-checks the whole draw (drawEdits.ts) and refuses a
// broken one with the reason (shown by the console's error banner).
import { useState } from 'react'
import { Button, Panel } from '../components/ui.jsx'
import BracketView from './BracketView.jsx'
import { commandFor, isSelected, tap } from './drawTaps'

function Tappable({ item, selected, onTap, label, children, className = '' }) {
  const chosen = isSelected(selected, item)
  return (
    <button type="button" aria-pressed={chosen} aria-label={label} onClick={() => onTap(item)}
      className={`min-h-11 rounded-lg px-2 text-left ${chosen ? 'bg-pickle-neon font-bold text-ink' : 'bg-navy-800 hover:bg-navy-700'} ${className}`}>
      {children}
    </button>
  )
}

export default function DraftEditor({ tournament, nameOf, send }) {
  const [selected, setSelected] = useState(null)
  const pools = tournament.pools.map((p) => p.label)
  const movingPair = selected?.kind === 'pair' && pools.length > 0 ? tournament.pairs.find((p) => p.id === selected.id) : null

  function onTap(item) {
    const next = tap(selected, item)
    setSelected(next.selected)
    if (next.chosen) send(commandFor(next.chosen, tournament.phase))
  }

  function move(poolLabel) {
    setSelected(null)
    send({ type: 'EDIT_DRAW', edit: { kind: 'MOVE_PAIR', entrantId: movingPair.id, poolLabel } })
  }

  function start() {
    if (!window.confirm('Start the tournament? The draw locks: after this you can only substitute a player, or swap opponents between games that have not started.')) return
    send({ type: 'START_TOURNAMENT' })
  }

  const loose = tournament.unpaired
  return (
    <div className="grid gap-4">
      <Panel className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">Draft draw · {tournament.formatLabel}</h2>
            <p className="text-sm text-mist">Tap one, then another, to swap: two players, two pairs’ seeds, or two pairs in the games below.</p>
          </div>
          <Button variant="neon" onClick={start} disabled={loose.length > 0}>Start tournament</Button>
        </div>
        {loose.length > 0 && (
          <div role="status" className="grid gap-2 rounded-xl bg-amber-400/15 px-4 py-3 text-amber-100">
            <p>{loose.map((p) => p.name).join(', ')} {loose.length === 1 ? 'has' : 'have'} no partner. Tap them, then a player in a pair, to swap them in, or put them on a break to keep them as a substitute.</p>
            <div className="flex flex-wrap gap-2">
              {loose.map((p) => (
                <Tappable key={p.id} item={{ kind: 'player', id: p.id }} selected={selected} onTap={onTap} label={`Select ${p.name}`}>{p.name}</Tappable>
              ))}
            </div>
          </div>
        )}
        <ol className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(min(100%,15rem),1fr))]" aria-label="Pairs in seed order">
          {tournament.pairs.map((pair) => (
            <li key={pair.id} className="flex items-center gap-1.5 rounded-xl bg-navy-900 p-1.5">
              <Tappable item={{ kind: 'pair', id: pair.id }} selected={selected} onTap={onTap} label={`Seed ${pair.seed}: ${pair.name}`} className="w-11 shrink-0 text-center font-bold">
                {pair.seed}
              </Tappable>
              {pair.playerIds.map((id) => (
                <Tappable key={id} item={{ kind: 'player', id }} selected={selected} onTap={onTap} label={`Select ${nameOf(id)}`} className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                  {nameOf(id)}
                </Tappable>
              ))}
              {pair.poolLabel && <span className="shrink-0 px-1 text-xs text-mist">Pool {pair.poolLabel}</span>}
            </li>
          ))}
        </ol>
        {movingPair && (
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label={`Move ${movingPair.name}`}>
            <span className="text-sm text-mist">Move {movingPair.name} to</span>
            {pools.filter((label) => label !== movingPair.poolLabel).map((label) => (
              <Button key={label} variant="ghost" onClick={() => move(label)}>Pool {label}</Button>
            ))}
          </div>
        )}
      </Panel>
      <BracketView tournament={tournament} onSlot={onTap} selected={selected} />
    </div>
  )
}
```

The tournament area of the host console. Task 9 adds substitutions, opponent swaps and the champion to it.

```jsx
// src/pickleball-open/tournament/TournamentHost.jsx
// The host console's tournament area (spec §6): setup and draft editor before
// Start; then courts, the live draw and standings. The console around it
// keeps the header, the Game over dialog, undo, results and the menu.
import { Panel } from '../components/ui.jsx'
import CourtCard from '../components/CourtCard.jsx'
import PlayersPanel from '../components/PlayersPanel.jsx'
import ResultsList from '../components/ResultsList.jsx'
import BracketView from './BracketView.jsx'
import DraftEditor from './DraftEditor.jsx'
import PairStandings from './PairStandings.jsx'
import TournamentSetup from './TournamentSetup.jsx'

export default function TournamentHost({ host, send, tab, nameOf, courtLabel, onStart, onGameOver, onEditResult }) {
  const t = host.viewer.tournament
  const ended = host.viewer.status === 'ENDED'
  const running = t.phase === 'RUNNING' || t.phase === 'FINISHED'
  const playing = new Set(host.courts.flatMap((c) => (c.match?.status === 'IN_PROGRESS' ? [...c.match.teamA, ...c.match.teamB] : [])))
  const activeCount = host.players.filter((p) => p.status === 'ACTIVE').length
  // Phones show one tab at a time; from lg every section is on screen (spec §11).
  const section = (key) => `${tab === key ? 'block' : 'hidden'} lg:block`

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(300px,380px)]">
      <div className="grid content-start gap-5">
        {running ? (
          <section className={section('courts')} aria-label="Courts">
            <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]">
              {host.courts.map((court) => (
                <CourtCard key={court.id} court={court} nameOf={nameOf} ended={ended} onStart={onStart} onGameOver={onGameOver} onEdit={null} />
              ))}
            </div>
          </section>
        ) : (
          tab === 'courts' && <p className="text-mist lg:hidden">Courts fill once you start the tournament.</p>
        )}
        <section className={section('draw')} aria-label="Draw">
          {running ? (
            <div className="grid gap-3">
              <h2 className="text-lg font-bold">{t.formatLabel}</h2>
              <BracketView tournament={t} />
            </div>
          ) : (
            <div className="grid gap-5">
              <TournamentSetup tournament={t} activeCount={activeCount} send={send} />
              {t.phase === 'DRAFT' && <DraftEditor tournament={t} nameOf={nameOf} send={send} />}
            </div>
          )}
        </section>
      </div>

      <aside className="grid content-start gap-5">
        <div className={section('players')}>
          <PlayersPanel players={host.players} waiting={[]} playing={playing} showSkill send={send} />
        </div>
        <div className={`${section('results')} grid gap-4`}>
          <Panel><h2 className="mb-2 text-lg font-bold">Standings</h2><PairStandings rows={t.standings} /></Panel>
          <Panel><h2 className="mb-2 text-lg font-bold">Results</h2>
            <ResultsList finished={host.finished} nameOf={nameOf} courtLabel={courtLabel} onEdit={onEditResult} />
          </Panel>
        </div>
      </aside>
    </div>
  )
}
```

- [ ] **Step 5: Wire them into the create form and the console**

In `src/pickleball-open/CreateSessionApp.jsx`:

1. Find:

```jsx
import { ModePicker } from './components/ModePicker.jsx'
import { Button, Panel } from './components/ui.jsx'
```

   Replace with:

```jsx
import { ModePicker } from './components/ModePicker.jsx'
import { FormatPicker } from './tournament/Choice.jsx'
import { Button, Panel } from './components/ui.jsx'
```

2. Find:

```jsx
const TARGETS = [11, 15, 21]
const field = 'w-full rounded-xl border border-navy-700 bg-navy-900 px-3 py-3 text-base text-white placeholder:text-mist/70 focus:border-pickle-neon focus:outline-none'
```

   Replace with:

```jsx
const TARGETS = [11, 15, 21]
const KINDS = [
  ['OPEN_PLAY', 'Open play', 'Players rotate through the courts all session.'],
  ['TOURNAMENT', 'Tournament', 'Fixed pairs play a draw: round robin, pools or a bracket.'],
]
const field = 'w-full rounded-xl border border-navy-700 bg-navy-900 px-3 py-3 text-base text-white placeholder:text-mist/70 focus:border-pickle-neon focus:outline-none'
```

3. Find:

```jsx
  const [step, setStep] = useState('details')
  const [details, setDetails] = useState({ name: 'Open Play', hostDisplayName: '', courtCount: 4, target: 11, mode: 'PADDLE_STACK', selfCheckIn: true })
  const [rosterMode, setRosterMode] = useState('paste')
```

   Replace with:

```jsx
  const [step, setStep] = useState('details')
  const [details, setDetails] = useState({ kind: 'OPEN_PLAY', format: 'ROUND_ROBIN', name: 'Open Play', hostDisplayName: '', courtCount: 4, target: 11, mode: 'PADDLE_STACK', selfCheckIn: true })
  const [rosterMode, setRosterMode] = useState('paste')
```

4. Find:

```jsx
        settings: { mode: details.mode, target: details.target, scoringStyle: 'SIDEOUT', selfCheckIn: details.selfCheckIn },
        players: roster.entries,
```

   Replace with:

```jsx
        settings: { mode: details.mode, target: details.target, scoringStyle: 'SIDEOUT', selfCheckIn: details.selfCheckIn },
        kind: details.kind,
        ...(details.kind === 'TOURNAMENT' ? { tournament: { format: details.format } } : {}),
        players: roster.entries,
```

5. Find:

```jsx
        <form className="mt-6 grid gap-5 md:grid-cols-2" onSubmit={(event) => { event.preventDefault(); setStep('players') }}>
          <label className="grid gap-1.5 text-sm text-mist">Session name
```

   Replace with:

```jsx
        <form className="mt-6 grid gap-5 md:grid-cols-2" onSubmit={(event) => { event.preventDefault(); setStep('players') }}>
          <div className="grid gap-2 sm:grid-cols-2 md:col-span-2" role="radiogroup" aria-label="What are you running?">
            {KINDS.map(([kind, label, summary]) => (
              <button key={kind} type="button" role="radio" aria-checked={details.kind === kind}
                onClick={() => update({ kind, name: details.name === 'Open Play' || details.name === 'Tournament' ? label : details.name })}
                className={`min-h-16 rounded-2xl p-4 text-left ${details.kind === kind ? 'bg-pickle-neon text-ink' : 'border border-navy-700 bg-navy-900 text-white hover:border-pickle-neon'}`}>
                <span className="block text-lg font-bold">{label}</span>
                <span className={`block text-sm ${details.kind === kind ? 'text-ink' : 'text-mist'}`}>{summary}</span>
              </button>
            ))}
          </div>
          <label className="grid gap-1.5 text-sm text-mist">Session name
```

6. Find:

```jsx
          </Panel>
          <Panel className="md:col-span-2">
```

   Replace with:

```jsx
          </Panel>
          {details.kind === 'TOURNAMENT' ? (
            <Panel className="md:col-span-2">
              <p className="mb-3 font-semibold">Format</p>
              <FormatPicker value={details.format} onChange={(format) => update({ format })} />
              <p className="mt-3 text-sm text-mist">Once everyone is in, you choose how pairs are made and seeded, generate the draw, and edit it as much as you like before you start.</p>
            </Panel>
          ) : (
          <Panel className="md:col-span-2">
```

7. Find:

```jsx
          </Panel>
          <label className="flex min-h-11 items-center gap-3 md:col-span-2">
```

   Replace with:

```jsx
          </Panel>
          )}
          <label className="flex min-h-11 items-center gap-3 md:col-span-2">
```


In `src/pickleball-open/components/HostConsole.jsx`:

1. Find:

```jsx
import ShareSheet from './ShareSheet.jsx'
import { Button, Panel } from './ui.jsx'
```

   Replace with:

```jsx
import ShareSheet from './ShareSheet.jsx'
import { TOURNAMENT_TABS } from '../tournament/tabs'
import TournamentHost from '../tournament/TournamentHost.jsx'
import { Button, Panel } from './ui.jsx'
```

2. Find:

```jsx
  const { send, pending, error, clearError } = useCommandQueue(code, credentials, onHost)
  const [tab, setTab] = useState('courts')
  const [dialog, setDialog] = useState(null)
```

   Replace with:

```jsx
  const { send, pending, error, clearError } = useCommandQueue(code, credentials, onHost)
  const tournament = host.viewer.tournament
  // A tournament opens on its draw until it starts; open play opens on the courts.
  const [tab, setTab] = useState(() => (tournament && tournament.phase !== 'RUNNING' ? 'draw' : 'courts'))
  const tabs = tournament ? TOURNAMENT_TABS : TABS
  const [dialog, setDialog] = useState(null)
```

3. Find:

```jsx
        </div>
        <Button variant="ghost" aria-haspopup="dialog" onClick={() => setDialog({ type: 'mode' })}>Mode: {MODE_INFO[host.settings.mode]?.label ?? 'Paddle stack'}</Button>
        <Button variant="neon" onClick={() => setDialog({ type: 'share' })}>Share board</Button>
```

   Replace with:

```jsx
        </div>
        {tournament
          ? <span className="rounded-xl border border-navy-700 px-4 py-2.5 text-sm font-semibold">{tournament.formatLabel}</span>
          : <Button variant="ghost" aria-haspopup="dialog" onClick={() => setDialog({ type: 'mode' })}>Mode: {MODE_INFO[host.settings.mode]?.label ?? 'Paddle stack'}</Button>}
        <Button variant="neon" onClick={() => setDialog({ type: 'share' })}>Share board</Button>
```

4. Find:

```jsx

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(300px,380px)]">
```

   Replace with:

```jsx

      {tournament ? (
        <TournamentHost host={host} send={send} tab={tab} nameOf={nameOf} courtLabel={courtLabel}
          onStart={(match) => send({ type: 'START_MATCH', matchId: match.id })}
          onGameOver={(match) => setDialog({ type: 'gameOver', match })}
          onEditResult={(match) => setDialog({ type: 'editResult', match })} />
      ) : (
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(300px,380px)]">
```

5. Find:

```jsx
          <div className={`${section('players')} grid gap-5`}>
            <PlayersPanel players={host.players} waiting={viewer.waiting} playing={playing} mode={host.settings.mode} send={send} />
            <RulesPanel rules={host.settings.rules} players={host.players} send={send} />
```

   Replace with:

```jsx
          <div className={`${section('players')} grid gap-5`}>
            <PlayersPanel players={host.players} waiting={viewer.waiting} playing={playing} showSkill={host.settings.mode === 'BALANCED'} send={send} />
            <RulesPanel rules={host.settings.rules} players={host.players} send={send} />
```

6. Find:

```jsx
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-3 border-t border-navy-800 bg-ink lg:hidden" aria-label="Sections">
        {TABS.map(([key, label]) => (
          <button key={key} type="button" aria-current={tab === key} onClick={() => setTab(key)}
```

   Replace with:

```jsx
      </div>
      )}

      <nav className={`fixed inset-x-0 bottom-0 z-20 grid ${tabs.length === 4 ? 'grid-cols-4' : 'grid-cols-3'} border-t border-navy-800 bg-ink lg:hidden`} aria-label="Sections">
        {tabs.map(([key, label]) => (
          <button key={key} type="button" aria-current={tab === key} onClick={() => setTab(key)}
```


In `src/pickleball-open/components/PlayersPanel.jsx` (skill is edited for balanced teams and in every tournament):

1. Find:

```jsx

/** Each row shows games, rounds sat out and the current wait (spec §5.5); skill is editable for balanced teams. */
export default function PlayersPanel({ players, waiting, playing, mode, send }) {
  const [names, setNames] = useState('')
```

   Replace with:

```jsx

/** Each row shows games, rounds sat out and the current wait (spec §5.5); skill is editable where it is used (balanced teams, tournament pairs and seeds). */
export default function PlayersPanel({ players, waiting, playing, showSkill = false, send }) {
  const [names, setNames] = useState('')
```

2. Find:

```jsx
                <span className="min-w-0 flex-1 basis-28 break-words">{order.has(p.id) ? `${order.get(p.id)} · ` : ''}{p.name}</span>
                {mode === 'BALANCED' && (
                  <select aria-label={`Skill for ${p.name}`} value={p.skill === null ? '' : String(p.skill)} onChange={(e) => setSkill(p, e.target.value)}
```

   Replace with:

```jsx
                <span className="min-w-0 flex-1 basis-28 break-words">{order.has(p.id) ? `${order.get(p.id)} · ` : ''}{p.name}</span>
                {showSkill && (
                  <select aria-label={`Skill for ${p.name}`} value={p.skill === null ? '' : String(p.skill)} onChange={(e) => setSkill(p, e.target.value)}
```


In `src/pickleball-open/components/CourtCard.jsx` (a tournament game is not edited on court: the draw decides it):

1. Find:

```jsx
      </div>
      <div className="grid gap-1 text-[15px]">
```

   Replace with:

```jsx
      </div>
      {court.fixtureLabel && <p className="-mt-2 text-xs font-bold uppercase tracking-[0.08em] text-pickle-neon">{court.fixtureLabel}</p>}
      <div className="grid gap-1 text-[15px]">
```

2. Find:

```jsx
        <div className="grid grid-cols-2 gap-2">
          <Button variant="neon" onClick={() => onStart(match)}>Start</Button>
          <Button variant="ghost" onClick={() => onEdit(match)}>Edit</Button>
          <Button variant="quiet" className="col-span-2 !min-h-11 text-sm" onClick={() => onGameOver(match)}>Already played? Enter result</Button>
```

   Replace with:

```jsx
        <div className="grid grid-cols-2 gap-2">
          <Button variant="neon" className={onEdit ? '' : 'col-span-2'} onClick={() => onStart(match)}>Start</Button>
          {onEdit && <Button variant="ghost" onClick={() => onEdit(match)}>Edit</Button>}
          <Button variant="quiet" className="col-span-2 !min-h-11 text-sm" onClick={() => onGameOver(match)}>Already played? Enter result</Button>
```


- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/pickleball-open && npm run lint && npm run build`
Expected: PASS.

Run: `npx playwright test tests/e2e/pickleball/open-tournament.spec.js tests/e2e/pickleball/open-play.spec.js`
Expected: PASS (the open-play console is unchanged apart from the `showSkill` prop).

- [ ] **Step 7: CHANGELOG and commit**

```markdown
- Creating a session offers Open play or Tournament. A tournament console sets up the draw (format, pairs, seeding), then edits the draft by tap-to-select (players, seeds, pools, opponents) with the server's reason shown for any refused edit, and starts it.
```

```bash
git add src/pickleball-open tests/e2e/pickleball/open-tournament.spec.js CHANGELOG.md
git commit -m "feat(pickleball): tournament setup and draft editor"
```

---

### Task 9: Running the tournament: substitutes, opponent swaps, champion

**Files:**
- Create: `src/pickleball-open/tournament/SubstituteSheet.jsx`, `ChampionBanner.jsx`
- Replace: `src/pickleball-open/tournament/TournamentHost.jsx`
- Modify: `src/pickleball-open/components/CaptainConsole.jsx`, `src/styles/pickleball-open.css`
- Modify: `tests/e2e/pickleball/open-tournament.spec.js` (append)
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: `TournamentHost` props (Task 8); `tap`, `commandFor` (Task 8); `SUBSTITUTE_PLAYER`, `SWAP_OPPONENTS` (Task 6).
- Produces: `SubstituteSheet({ tournament, players, onSubstitute, onClose })`, `ChampionBanner({ champion, tv? })` (`data-testid="champion"`, `pb-celebrate`), the `.pb-celebrate` keyframe animation.

- [ ] **Step 1: Write the failing e2e tests**

Append to `tests/e2e/pickleball/open-tournament.spec.js`:

```js

async function playCourt(page, testId, loser = '6') {
  const card = page.getByTestId(testId)
  await card.getByRole('button', { name: 'Start' }).click()
  await card.getByRole('button', { name: 'Game over' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('radio').first().click()
  await dialog.getByRole('button', { name: loser, exact: true }).click()
  await dialog.getByRole('button', { name: `Save 11–${loser}` }).click()
  await expect(dialog).toHaveCount(0)
}

test.describe('running a tournament (screens)', () => {
  test('the host plays a knockout to a champion from the console', async ({ page, request }) => {
    const { code, hostKey } = await readyTournament(request)
    await page.goto(`/pickleball/s/${code}#host=${hostKey}`)
    await playCourt(page, 'court-1')
    await expect(page.getByRole('article', { name: 'Final', exact: true })).toContainText('Ana & Ben')
    await playCourt(page, 'court-2')
    await expect(page.getByTestId('court-1')).toContainText('Final')
    await playCourt(page, 'court-1')
    await expect(page.getByTestId('champion')).toContainText('Ana & Ben')
  })

  test('the host substitutes a player and swaps opponents from the console', async ({ page, request }) => {
    const { code, hostKey } = await createTournament(request, { players: 17, courtCount: 1, format: 'SINGLE_ELIMINATION' })
    await ok(request, code, hostKey, { type: 'GENERATE_DRAW', format: 'SINGLE_ELIMINATION', pairing: 'MANUAL', seeding: 'MANUAL' })
    const host = await hostSnapshot(request, code, hostKey)
    await ok(request, code, hostKey, { type: 'SET_PLAYER_STATUS', playerId: host.players.find((p) => p.name === 'Quin').id, status: 'BREAK' })
    await ok(request, code, hostKey, { type: 'START_TOURNAMENT' })
    await page.goto(`/pickleball/s/${code}#host=${hostKey}`)

    await page.getByRole('button', { name: 'Substitute a player' }).click()
    const sheet = page.getByRole('dialog')
    // Seeds 1–8 in list order: quarter-final 3 is Cy & Di v Max & Ned, quarter-final 4 Eva & Fin v Kai & Lu.
    await sheet.getByRole('combobox', { name: 'Pair' }).selectOption({ label: 'Kai & Lu' })
    await sheet.getByRole('combobox', { name: 'Player coming off' }).selectOption({ label: 'Lu' })
    await sheet.getByRole('combobox', { name: 'Substitute' }).selectOption({ label: 'Quin (on a break)' })
    await sheet.getByRole('button', { name: 'Substitute' }).click()
    await expect(page.getByRole('article', { name: 'Quarter-final 4' })).toContainText('Kai & Quin')

    // Quarter-finals 3 and 4 have not started: swap their second pairs.
    await page.getByRole('article', { name: 'Quarter-final 3' }).getByRole('button', { name: 'Max & Ned' }).click()
    await page.getByRole('article', { name: 'Quarter-final 4' }).getByRole('button', { name: 'Kai & Quin' }).click()
    await expect(page.getByRole('article', { name: 'Quarter-final 3' })).toContainText('Kai & Quin')
    await expect(page.getByRole('article', { name: 'Quarter-final 4' })).toContainText('Max & Ned')
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm run build && npx playwright test tests/e2e/pickleball/open-tournament.spec.js -g "running a tournament"`
Expected: FAIL. There is no `champion` banner and no "Substitute a player" button.

- [ ] **Step 3: Implement**

```jsx
// src/pickleball-open/tournament/ChampionBanner.jsx
// Spec §11: "a short CSS celebration plays for a tournament winner". Transform
// and opacity only, twice, and not at all under prefers-reduced-motion.
export default function ChampionBanner({ champion, tv = false }) {
  if (!champion) return null
  return (
    <div role="status" data-testid="champion"
      className={`pb-celebrate rounded-2xl bg-pickle-neon text-ink ${tv ? 'p-[1vw] text-[clamp(1.5rem,3vw,4rem)]' : 'px-5 py-4 text-xl'}`}>
      <p className="text-[0.6em] font-bold uppercase tracking-[0.14em]">Champions</p>
      <p className="font-bold [overflow-wrap:anywhere]">{champion.name}</p>
    </div>
  )
}
```

```jsx
// src/pickleball-open/tournament/SubstituteSheet.jsx
// Spec §6.5: after Start a player in a pair can be substituted while that pair
// is not on court. Results stay with the pair.
import { useState } from 'react'
import { Button, Sheet } from '../components/ui.jsx'

const field = 'min-h-11 w-full rounded-xl border border-navy-700 bg-navy-900 px-3 text-base text-white'

export default function SubstituteSheet({ tournament, players, onSubstitute, onClose }) {
  const [pairId, setPairId] = useState(tournament.pairs[0]?.id ?? '')
  const pair = tournament.pairs.find((p) => p.id === pairId)
  const [outId, setOutId] = useState('')
  const [inId, setInId] = useState('')
  const nameOf = (id) => players.find((p) => p.id === id)?.name ?? '—'
  const paired = new Set(tournament.pairs.flatMap((p) => p.playerIds))
  const bench = players.filter((p) => p.status !== 'LEFT' && !paired.has(p.id))

  return (
    <Sheet title="Substitute a player" onClose={onClose}>
      <div className="grid gap-3">
        <label className="grid gap-1 text-sm text-mist">Pair
          <select className={field} value={pairId} onChange={(e) => { setPairId(e.target.value); setOutId('') }}>
            {tournament.pairs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-sm text-mist">Player coming off
          <select className={field} value={outId} onChange={(e) => setOutId(e.target.value)}>
            <option value="">Pick one</option>
            {pair?.playerIds.map((id) => <option key={id} value={id}>{nameOf(id)}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-sm text-mist">Substitute
          <select className={field} value={inId} onChange={(e) => setInId(e.target.value)}>
            <option value="">Pick one</option>
            {bench.map((p) => <option key={p.id} value={p.id}>{p.name}{p.status === 'BREAK' ? ' (on a break)' : ''}</option>)}
          </select>
        </label>
        {bench.length === 0 && <p className="text-sm text-amber-200">Everyone is in a pair. Add the substitute on the Players tab first.</p>}
        <p className="text-sm text-mist">The pair keeps its results and its place in the draw. A pair on court can be changed after its game.</p>
        <Button variant="primary" disabled={!pair || !outId || !inId} onClick={() => onSubstitute({ entrantId: pair.id, outPlayerId: outId, inPlayerId: inId })}>Substitute</Button>
      </div>
    </Sheet>
  )
}
```

Replace `src/pickleball-open/tournament/TournamentHost.jsx` with:

```jsx
// src/pickleball-open/tournament/TournamentHost.jsx
// The host console's tournament area (spec §6): setup and draft editor before
// Start; then courts, the live draw (with opponent swaps by tap-to-select),
// substitutions and standings. The console around it keeps the header, the
// Game over dialog, undo, results and the menu.
import { useState } from 'react'
import { Button, Panel } from '../components/ui.jsx'
import CourtCard from '../components/CourtCard.jsx'
import PlayersPanel from '../components/PlayersPanel.jsx'
import ResultsList from '../components/ResultsList.jsx'
import BracketView from './BracketView.jsx'
import ChampionBanner from './ChampionBanner.jsx'
import DraftEditor from './DraftEditor.jsx'
import { commandFor, tap } from './drawTaps'
import PairStandings from './PairStandings.jsx'
import SubstituteSheet from './SubstituteSheet.jsx'
import TournamentSetup from './TournamentSetup.jsx'

export default function TournamentHost({ host, send, tab, nameOf, courtLabel, onStart, onGameOver, onEditResult }) {
  const t = host.viewer.tournament
  const [selected, setSelected] = useState(null)
  const [subbing, setSubbing] = useState(false)
  const ended = host.viewer.status === 'ENDED'
  const running = t.phase === 'RUNNING' || t.phase === 'FINISHED'
  const playing = new Set(host.courts.flatMap((c) => (c.match?.status === 'IN_PROGRESS' ? [...c.match.teamA, ...c.match.teamB] : [])))
  const activeCount = host.players.filter((p) => p.status === 'ACTIVE').length
  // Phones show one tab at a time; from lg every section is on screen (spec §11).
  const section = (key) => `${tab === key ? 'block' : 'hidden'} lg:block`

  function onSlot(item) {
    const next = tap(selected, item)
    setSelected(next.selected)
    if (next.chosen) send(commandFor(next.chosen, t.phase))
  }

  async function substitute(edit) {
    setSubbing(false)
    await send({ type: 'SUBSTITUTE_PLAYER', ...edit })
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(300px,380px)]">
      <div className="grid content-start gap-5">
        <ChampionBanner champion={t.champion} />
        {running ? (
          <section className={section('courts')} aria-label="Courts">
            <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]">
              {host.courts.map((court) => (
                <CourtCard key={court.id} court={court} nameOf={nameOf} ended={ended} onStart={onStart} onGameOver={onGameOver} onEdit={null} />
              ))}
            </div>
          </section>
        ) : (
          tab === 'courts' && <p className="text-mist lg:hidden">Courts fill once you start the tournament.</p>
        )}
        <section className={section('draw')} aria-label="Draw">
          {running ? (
            <div className="grid gap-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold">{t.formatLabel}</h2>
                  {t.phase === 'RUNNING' && <p className="text-sm text-mist">To swap opponents, tap a pair in a game that has not started, then a pair in another game of the same round.</p>}
                </div>
                {t.phase === 'RUNNING' && <Button variant="ghost" onClick={() => setSubbing(true)}>Substitute a player</Button>}
              </div>
              <BracketView tournament={t} onSlot={t.phase === 'RUNNING' ? onSlot : null} selected={selected} />
            </div>
          ) : (
            <div className="grid gap-5">
              <TournamentSetup tournament={t} activeCount={activeCount} send={send} />
              {t.phase === 'DRAFT' && <DraftEditor tournament={t} nameOf={nameOf} send={send} />}
            </div>
          )}
        </section>
      </div>

      <aside className="grid content-start gap-5">
        <div className={section('players')}>
          <PlayersPanel players={host.players} waiting={[]} playing={playing} showSkill send={send} />
        </div>
        <div className={`${section('results')} grid gap-4`}>
          <Panel><h2 className="mb-2 text-lg font-bold">Standings</h2><PairStandings rows={t.standings} /></Panel>
          <Panel><h2 className="mb-2 text-lg font-bold">Results</h2>
            <ResultsList finished={host.finished} nameOf={nameOf} courtLabel={courtLabel} onEdit={onEditResult} />
          </Panel>
        </div>
      </aside>

      {subbing && <SubstituteSheet tournament={t} players={host.players} onSubstitute={substitute} onClose={() => setSubbing(false)} />}
    </div>
  )
}
```

In `src/styles/pickleball-open.css`:

1. Find:

```css
.pb-flip { animation: pb-flip 420ms ease-out; }

```

   Replace with:

```css
.pb-flip { animation: pb-flip 420ms ease-out; }
.pb-celebrate { animation: pb-celebrate 900ms ease-out 2; transform-origin: center; }

```

2. Find:

```css
@keyframes pb-flip { from { transform: rotateX(70deg); opacity: 0.2; } to { transform: rotateX(0); opacity: 1; } }

@media (prefers-reduced-motion: reduce) {
  .pb-anim *, .pb-flip, .pb-pulse { animation: none !important; }
}
```

   Replace with:

```css
@keyframes pb-flip { from { transform: rotateX(70deg); opacity: 0.2; } to { transform: rotateX(0); opacity: 1; } }
@keyframes pb-celebrate { 0% { transform: scale(0.85); opacity: 0; } 55% { transform: scale(1.06); opacity: 1; } 100% { transform: scale(1); opacity: 1; } }

@media (prefers-reduced-motion: reduce) {
  .pb-anim *, .pb-flip, .pb-pulse, .pb-celebrate { animation: none !important; }
}
```


In `src/pickleball-open/components/CaptainConsole.jsx` (a captain on a tournament court starts and saves games but does not edit them):

1. Find:

```jsx
          onGameOver={(match) => setDialog({ type: 'gameOver', match })}
          onEdit={(match) => setDialog({ type: 'edit', match })} />
        <Panel>
```

   Replace with:

```jsx
          onGameOver={(match) => setDialog({ type: 'gameOver', match })}
          onEdit={snapshot.viewer.kind === 'TOURNAMENT' ? null : (match) => setDialog({ type: 'edit', match })} />
        <Panel>
```


- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run lint && npm run build && npx playwright test tests/e2e/pickleball/open-tournament.spec.js`
Expected: PASS.

- [ ] **Step 5: CHANGELOG and commit**

```markdown
- Running a tournament: substitute a player in a pair that is off court, swap opponents between unstarted games of the same round by tap-to-select, and a short celebration for the champions (none under reduced motion).
```

```bash
git add src/pickleball-open src/styles/pickleball-open.css tests/e2e/pickleball/open-tournament.spec.js CHANGELOG.md
git commit -m "feat(pickleball): substitutes, opponent swaps and champions"
```

---

### Task 10: The public board and the TV for tournaments

**Files:**
- Create: `src/pickleball-open/tournament/TournamentPanels.jsx`
- Replace: `src/pickleball-open/lib/myStatus.js`
- Modify: `src/pickleball-open/lib/myStatus.test.js`, `src/pickleball-open/components/ViewerBoard.jsx`, `src/pickleball-open/TvBoard.jsx`, `src/pickleball-open/components/TvCourt.jsx`
- Modify: `tests/e2e/pickleball/open-tournament.spec.js` (append)
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: `TournamentView` (Task 7); `BracketView`, `GameCard`, `PairStandings`, `nextGames`, `BOARD_TABS` (Task 8); `ChampionBanner` (Task 9).
- Produces: `TournamentPanels({ viewer, courtsGrid, me, section })`; `myStatus` returns `{ kind: 'NEXT_GAME', label }` or `{ kind: 'DONE' }` in a running tournament instead of a place in line.

- [ ] **Step 1: Write the failing tests**

In `src/pickleball-open/lib/myStatus.test.js`:

1. Find:

```js
  })
})
```

   Replace with:

```js
  })
})

describe('myStatus in a tournament', () => {
  const tournament = {
    phase: 'RUNNING',
    pairs: [{ id: 'e1', playerIds: ['c', 'q'] }, { id: 'e2', playerIds: ['b', 'x'] }, { id: 'e3', playerIds: ['k', 'l'] }],
    fixtures: [
      { label: 'Semi-final 1', entrantAId: 'e1', entrantBId: 'e3', status: 'FINISHED' },
      { label: 'Final', entrantAId: 'e1', entrantBId: null, status: 'PENDING' },
    ],
  }
  const cup = { ...viewer, tournament, roster: [...viewer.roster, { id: 'k', name: 'Kit' }] }

  it('names the next game instead of a place in line, and says when a pair is done', () => {
    expect(myStatus(cup, 'c')).toEqual({ kind: 'NEXT_GAME', label: 'Final' })
    expect(myStatus(cup, 'k')).toEqual({ kind: 'DONE' })
    expect(myStatus(cup, 'b')).toEqual({ kind: 'UP_NEXT', court: 'Court 3' })
    expect(myStatus({ ...cup, tournament: { ...tournament, phase: 'DRAFT' } }, 'c')).toEqual({ kind: 'NONE' })
  })
})
```


Append to `tests/e2e/pickleball/open-tournament.spec.js`:

```js

test.describe('tournament board and TV (screens)', () => {
  test('a second screen sees the bracket fill as results are saved, then the champions', async ({ page, request }) => {
    const { code, hostKey } = await readyTournament(request)
    await page.goto(`/pickleball/s/${code}`)
    const final = page.getByRole('article', { name: 'Final', exact: true })
    await expect(final).toContainText('Winner of Semi-final 1')
    const host = await hostSnapshot(request, code, hostKey)
    await ok(request, code, hostKey, { type: 'RECORD_RESULT', matchId: host.courts[0].match.id, winner: 'A', scoreA: 11, scoreB: 4 })
    await expect(final).toContainText('Ana & Ben')
    await playToChampion(request, code, hostKey)
    await expect(page.getByTestId('champion')).toContainText('Ana & Ben')
  })

  test('a player who picks their name sees their next game', async ({ page, request }) => {
    const { code, hostKey } = await readyTournament(request, { courtCount: 1 })
    const host = await hostSnapshot(request, code, hostKey)
    await page.goto(`/pickleball/s/${code}`)
    await page.getByLabel("I'm…").selectOption({ label: 'Cy' })
    await expect(page.getByRole('status').filter({ hasText: 'Your next game: Semi-final 2' })).toBeVisible()
    await ok(request, code, hostKey, { type: 'RECORD_RESULT', matchId: host.courts[0].match.id, winner: 'A', scoreA: 11, scoreB: 4 })
    await expect(page.getByRole('status').filter({ hasText: "You're up on Court 1: walk on" })).toBeVisible()
  })

  test('the TV board names the game on each court, then shows the champions', async ({ page, request }) => {
    const { code, hostKey } = await readyTournament(request)
    await page.setViewportSize({ width: 1920, height: 1080 })
    await page.goto(`/pickleball/s/${code}/tv`)
    await expect(page.getByTestId('tv-court').first()).toContainText('Semi-final 1')
    await expect(page.getByTestId('fairness')).toHaveCount(0)
    await playToChampion(request, code, hostKey)
    await expect(page.getByTestId('champion')).toContainText('Ana & Ben')
  })

  for (const width of [390, 768, 1280, 1920]) {
    test(`the board's draw and the TV fit a ${width}px screen without sideways scrolling`, async ({ page, request }) => {
      const { code } = await readyTournament(request, { players: 16, courtCount: 4, format: 'POOL_TO_BRACKET' })
      await page.setViewportSize({ width, height: 900 })
      await page.goto(`/pickleball/s/${code}`)
      if (width < 1024) await page.getByRole('tab', { name: 'Draw' }).click()
      await expect(page.getByRole('region', { name: 'Pool A' })).toBeVisible()
      expect(await noSideScroll(page)).toBe(true)
      await page.goto(`/pickleball/s/${code}/tv`)
      await expect(page.getByTestId('tv-court')).toHaveCount(4)
      expect(await noSideScroll(page)).toBe(true)
    })
  }
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/pickleball-open/lib/myStatus.test.js`
Expected: FAIL (`WAITING` instead of `NEXT_GAME`).

- [ ] **Step 3: Implement**

Replace `src/pickleball-open/lib/myStatus.js` with:

```js
// src/pickleball-open/lib/myStatus.js
/** A tournament player's next unplayed game, or that their games are done (spec §7 "You're up next"). */
function tournamentStatus(tournament, playerId) {
  const pair = tournament.pairs.find((p) => p.playerIds.includes(playerId))
  if (!pair || tournament.phase === 'SETUP' || tournament.phase === 'DRAFT') return { kind: 'NONE' }
  const next = tournament.fixtures.find((f) => (f.entrantAId === pair.id || f.entrantBId === pair.id) && f.status !== 'FINISHED' && f.status !== 'BYE')
  return next ? { kind: 'NEXT_GAME', label: next.label } : { kind: 'DONE' }
}

/** Where the player who picked "I'm …" on this phone is right now. */
export function myStatus(viewer, playerId) {
  const me = viewer?.roster?.find((p) => p.id === playerId)
  if (!me) return { kind: 'NONE' }
  for (const court of viewer.courts) {
    if (![...court.teamA, ...court.teamB].includes(me.name)) continue
    if (court.state === 'PLAYING') return { kind: 'PLAYING', court: court.label }
    if (court.state === 'UP_NEXT') return { kind: 'UP_NEXT', court: court.label }
  }
  if (viewer.onBreak.some((p) => p.id === playerId)) return { kind: 'BREAK' }
  if (viewer.tournament) return tournamentStatus(viewer.tournament, playerId)
  const place = viewer.waiting.findIndex((w) => w.id === playerId)
  if (place >= 0) return { kind: 'WAITING', place: place + 1 }
  return { kind: 'NONE' }
}
```

```jsx
// src/pickleball-open/tournament/TournamentPanels.jsx
// The public board for a tournament (spec §7): courts and what is coming up,
// the draw (pools and bracket), and pair standings. Built only from the
// allowlisted viewer snapshot.
import { Panel } from '../components/ui.jsx'
import BracketView, { GameCard } from './BracketView.jsx'
import { nextGames } from './bracketLayout'
import ChampionBanner from './ChampionBanner.jsx'
import PairStandings from './PairStandings.jsx'

export default function TournamentPanels({ viewer, courtsGrid, me, section }) {
  const t = viewer.tournament
  const myPair = t.pairs.find((p) => p.playerIds.includes(me))?.id ?? null
  const coming = nextGames(t)
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
      <div className="grid content-start gap-5">
        <ChampionBanner champion={t.champion} />
        {t.phase === 'SETUP' && <p className="text-mist">The host is setting up the draw.</p>}
        {t.phase === 'DRAFT' && <p className="rounded-xl bg-navy-900 px-4 py-3 text-mist">Draft draw: the host may still change pairs and games before the start.</p>}
        <section className={section('courts')} aria-label="Courts">
          {courtsGrid}
          {coming.length > 0 && (
            <Panel className="mt-4">
              <h2 className="mb-2 font-bold">Coming up</h2>
              <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(min(100%,15rem),1fr))]">
                {coming.map((game) => <GameCard key={game.id} fixture={game} highlight={myPair} />)}
              </div>
            </Panel>
          )}
        </section>
        <section className={section('draw')} aria-label="Draw">
          <BracketView tournament={t} highlight={myPair} />
        </section>
      </div>
      <aside className={`${section('standings')} grid content-start gap-4`}>
        <Panel><h2 className="mb-2 text-lg font-bold">Standings</h2><PairStandings rows={t.standings} highlight={myPair} /></Panel>
      </aside>
    </div>
  )
}
```

In `src/pickleball-open/components/ViewerBoard.jsx`:

1. Find:

```jsx
import { myStatus } from '../lib/myStatus'
import StandingsTable from './StandingsTable.jsx'
import { Panel, TeamNames } from './ui.jsx'


```

   Replace with:

```jsx
import { myStatus } from '../lib/myStatus'
import { BOARD_TABS } from '../tournament/tabs'
import TournamentPanels from '../tournament/TournamentPanels.jsx'
import StandingsTable from './StandingsTable.jsx'
import { Panel, TeamNames } from './ui.jsx'

```

2. Find:

```jsx
    BREAK: "You're on a break",
  }[status.kind]
```

   Replace with:

```jsx
    BREAK: "You're on a break",
    NEXT_GAME: `Your next game: ${status.label}`,
    DONE: 'Your games are done. Thanks for playing!',
  }[status.kind]
```

3. Find:

```jsx
  const section = (key) => `${tab === key ? 'block' : 'hidden'} lg:block`

```

   Replace with:

```jsx
  const section = (key) => `${tab === key ? 'block' : 'hidden'} lg:block`
  const tournament = viewer.tournament
  const tabs = tournament ? BOARD_TABS : [['courts', 'Courts'], ['standings', 'Standings'], ['results', 'Results']]
  const courtsGrid = (
    <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]">
      {viewer.courts.map((court) => (
        <article key={`${court.id}-${court.teamA.join()}`} className={`pb-flip rounded-2xl p-4 ${court.state === 'UP_NEXT' ? 'border-2 border-pickle-neon' : 'bg-navy-900'}`}>
          <div className="flex items-baseline justify-between">
            <h2 className="text-2xl font-bold text-pickle-neon">{court.label}</h2>
            <span className={`text-xs ${court.state === 'UP_NEXT' ? 'font-bold text-pickle-neon' : 'text-mist'}`}>{COURT_STATE[court.state]}</span>
          </div>
          {court.fixtureLabel && <p className="text-xs font-bold uppercase tracking-[0.08em] text-mist">{court.fixtureLabel}</p>}
          {court.teamA.length > 0 && (
            <div className="mt-2 grid gap-1 text-[15px]">
              <TeamNames side="A" names={court.teamA} emphasis={myName ? [myName] : []} />
              <TeamNames side="B" names={court.teamB} emphasis={myName ? [myName] : []} />
            </div>
          )}
        </article>
      ))}
    </div>
  )

```

4. Find:

```jsx
          <h1 className="text-2xl font-bold sm:text-3xl">{viewer.name}</h1>
          <p className="text-sm text-mist">Hosted by {viewer.hostDisplayName} · {courtCount} court{courtCount === 1 ? '' : 's'} · {MODE_INFO[viewer.settings.mode]?.label ?? 'Paddle stack'}</p>
          {viewer.settings.selfCheckIn && viewer.status === 'ACTIVE' && (
```

   Replace with:

```jsx
          <h1 className="text-2xl font-bold sm:text-3xl">{viewer.name}</h1>
          <p className="text-sm text-mist">Hosted by {viewer.hostDisplayName} · {courtCount} court{courtCount === 1 ? '' : 's'} · {tournament ? tournament.formatLabel : MODE_INFO[viewer.settings.mode]?.label ?? 'Paddle stack'}</p>
          {viewer.settings.selfCheckIn && viewer.status === 'ACTIVE' && (
```

5. Find:

```jsx
      <div className="grid grid-cols-3 gap-1 rounded-xl bg-navy-900 p-1 lg:hidden" role="tablist" aria-label="Board sections">
        {[['courts', 'Courts'], ['standings', 'Standings'], ['results', 'Results']].map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
```

   Replace with:

```jsx
      <div className="grid grid-cols-3 gap-1 rounded-xl bg-navy-900 p-1 lg:hidden" role="tablist" aria-label="Board sections">
        {tabs.map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
```

6. Find:

```jsx

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
        <section className={section('courts')} aria-label="Courts">
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]">
            {viewer.courts.map((court) => (
              <article key={`${court.id}-${court.teamA.join()}`} className={`pb-flip rounded-2xl p-4 ${court.state === 'UP_NEXT' ? 'border-2 border-pickle-neon' : 'bg-navy-900'}`}>
                <div className="flex items-baseline justify-between">
                  <h2 className="text-2xl font-bold text-pickle-neon">{court.label}</h2>
                  <span className={`text-xs ${court.state === 'UP_NEXT' ? 'font-bold text-pickle-neon' : 'text-mist'}`}>{COURT_STATE[court.state]}</span>
                </div>
                {court.teamA.length > 0 && (
                  <div className="mt-2 grid gap-1 text-[15px]">
                    <TeamNames side="A" names={court.teamA} emphasis={myName ? [myName] : []} />
                    <TeamNames side="B" names={court.teamB} emphasis={myName ? [myName] : []} />
                  </div>
                )}
              </article>
            ))}
          </div>
          <Panel className="mt-4">
```

   Replace with:

```jsx

      {tournament ? <TournamentPanels viewer={viewer} courtsGrid={courtsGrid} me={me} section={section} /> : (
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
        <section className={section('courts')} aria-label="Courts">
          {courtsGrid}
          <Panel className="mt-4">
```

7. Find:

```jsx
      </div>
      <footer className="grid gap-3 pt-2 text-center">
```

   Replace with:

```jsx
      </div>
      )}
      <footer className="grid gap-3 pt-2 text-center">
```


In `src/pickleball-open/components/TvCourt.jsx`:

1. Find:

```jsx
  const [size, setSize] = useState(null)
  const signature = `${court.label}|${court.state}|${court.teamA.join('/')}|${court.teamB.join('/')}`
  useEffect(() => {
```

   Replace with:

```jsx
  const [size, setSize] = useState(null)
  const signature = `${court.label}|${court.state}|${court.fixtureLabel ?? ''}|${court.teamA.join('/')}|${court.teamB.join('/')}`
  useEffect(() => {
```

2. Find:

```jsx
        </div>
        {court.teamA.length > 0 && (
```

   Replace with:

```jsx
        </div>
        {court.fixtureLabel && <p className="text-[0.55em] font-bold uppercase tracking-[0.08em] text-mist">{court.fixtureLabel}</p>}
        {court.teamA.length > 0 && (
```


In `src/pickleball-open/TvBoard.jsx`:

1. Find:

```jsx
import TvCourt from './components/TvCourt.jsx'

```

   Replace with:

```jsx
import TvCourt from './components/TvCourt.jsx'
import { nextGames } from './tournament/bracketLayout'
import ChampionBanner from './tournament/ChampionBanner.jsx'

```

2. Find:

```jsx

function Standings({ viewer }) {
  const rows = viewer.standings.filter((row) => row.rank !== null).slice(0, 16).map((row) => ({
```

   Replace with:

```jsx

/** Tournament standings are by pair (spec §6.7); open play's are by player. */
function PairTable({ tournament }) {
  const rows = tournament.standings.filter((row) => row.played > 0).slice(0, 16).map((row) => ({
    key: row.entrantId,
    content: <span className="flex justify-between gap-2"><span className={WRAP}><b className="text-pickle-neon">{row.rank}</b> {row.name}</span><span className="shrink-0 text-mist">{row.wins}–{row.losses}</span></span>,
  }))
  if (rows.length === 0) return <p className="mt-1 text-mist">No games finished yet</p>
  return <FitList rows={rows} className="mt-1 grid gap-1 text-[clamp(1rem,1.3vw,1.75rem)]" />
}

function Standings({ viewer }) {
  if (viewer.tournament) return <PairTable tournament={viewer.tournament} />
  const rows = viewer.standings.filter((row) => row.rank !== null).slice(0, 16).map((row) => ({
```

3. Find:

```jsx
  }))
  if (rows.length === 0) return <p className="mt-1 text-mist">No games finished yet</p>
  return <FitList rows={rows} className="mt-1 grid gap-1 text-[clamp(1rem,1.3vw,1.75rem)]" />
}

/** Who walks on next: only as many whole names as the space left allows, so the fairness numbers below always show. */
```

   Replace with:

```jsx
  }))
  if (rows.length === 0) return <p className="mt-1 text-mist">No games finished yet</p>
  return <FitList rows={rows} className="mt-1 grid gap-1 text-[clamp(1rem,1.3vw,1.75rem)]" />
}

/** A tournament's next games from the draw, in the order courts take them. */
function ComingUp({ tournament }) {
  const rows = nextGames(tournament, 6).map((game) => ({ key: game.id, content: <span className={WRAP}><b>{game.label}</b>: {game.nameA} vs {game.nameB}</span> }))
  return (
    <section aria-label="Coming up" className="flex max-h-[30vh] min-h-0 shrink flex-col">
      <h2 className={H2}>Coming up</h2>
      {rows.length === 0
        ? <p className="mt-1 text-[clamp(1rem,1.3vw,1.75rem)] text-mist">Waiting for results</p>
        : <FitList rows={rows} className="mt-1 grid gap-1 text-[clamp(1rem,1.2vw,1.6rem)]" />}
    </section>
  )
}

/** Who walks on next: only as many whole names as the space left allows, so the fairness numbers below always show. */
```

4. Find:

```jsx
  const qrSize = Math.round(Math.min(220, Math.max(120, width * 0.08)))
  const modeLabel = MODE_INFO[viewer.settings.mode]?.label ?? 'Paddle stack'
  const grid = { '--tv-cols': cols, '--tv-rows': rows }
```

   Replace with:

```jsx
  const qrSize = Math.round(Math.min(220, Math.max(120, width * 0.08)))
  const tournament = viewer.tournament
  const modeLabel = tournament ? tournament.formatLabel : MODE_INFO[viewer.settings.mode]?.label ?? 'Paddle stack'
  const champion = tournament?.phase === 'FINISHED' ? tournament.champion : null
  const grid = { '--tv-cols': cols, '--tv-rows': rows }
```

5. Find:

```jsx
        {ended && <p className="grid place-items-center rounded-2xl bg-navy-900 p-8 text-center text-[clamp(2rem,6vw,7rem)] font-bold lg:col-span-full lg:row-span-full" role="status">Session ended</p>}
        {!ended && courts.length === 0 && <p className="grid place-items-center rounded-2xl bg-navy-900 p-8 text-center text-[clamp(1.5rem,3.5vw,4rem)] font-bold text-mist lg:col-span-full lg:row-span-full">No courts are in play right now</p>}
        {!ended && courts.map((court) => <TvCourt key={court.id} court={court} />)}
      </section>
```

   Replace with:

```jsx
        {ended && <p className="grid place-items-center rounded-2xl bg-navy-900 p-8 text-center text-[clamp(2rem,6vw,7rem)] font-bold lg:col-span-full lg:row-span-full" role="status">Session ended</p>}
        {champion && <div className="grid place-items-center lg:col-span-full lg:row-span-full"><ChampionBanner champion={champion} tv /></div>}
        {!ended && !champion && courts.length === 0 && <p className="grid place-items-center rounded-2xl bg-navy-900 p-8 text-center text-[clamp(1.5rem,3.5vw,4rem)] font-bold text-mist lg:col-span-full lg:row-span-full">No courts are in play right now</p>}
        {!ended && !champion && courts.map((court) => <TvCourt key={court.id} court={court} />)}
      </section>
```

6. Find:

```jsx
        </div>
        {!ended && <UpNext viewer={viewer} />}
        <div className="shrink-0"><FairnessPanel fairness={viewer.fairness} tv /></div>
        <section aria-label={panel === 'standings' ? 'Standings' : 'Recent results'} data-testid="tv-panel" className="flex min-h-0 flex-1 flex-col overflow-hidden">
```

   Replace with:

```jsx
        </div>
        {!ended && (tournament ? <ComingUp tournament={tournament} /> : <UpNext viewer={viewer} />)}
        {/* Fairness is about open-play rotation; a tournament's draw decides who plays. */}
        {!tournament && <div className="shrink-0"><FairnessPanel fairness={viewer.fairness} tv /></div>}
        <section aria-label={panel === 'standings' ? 'Standings' : 'Recent results'} data-testid="tv-panel" className="flex min-h-0 flex-1 flex-col overflow-hidden">
```


- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/pickleball-open && npm run lint && npm run build`
Expected: PASS.

Run: `npx playwright test tests/e2e/pickleball/open-tournament.spec.js tests/e2e/pickleball/open-play.spec.js`
Expected: PASS. The open-play TV fit tests measure type after layout; if one fails only under heavy parallel load, run it alone before treating it as a regression.

- [ ] **Step 5: CHANGELOG and commit**

```markdown
- The public board and TV for a tournament: the game each court is playing, what is coming up, the draw (pools side by side, then the bracket), pair standings, a player's own next game, and the champions. The TV hides the open-play fairness panel in a tournament.
```

```bash
git add src/pickleball-open tests/e2e/pickleball/open-tournament.spec.js CHANGELOG.md
git commit -m "feat(pickleball): tournament board and tv"
```

---

### Task 11: Guide, landing page and art for tournaments

**Files:**
- Create: `src/components/pickleball/art/BracketArt.jsx`
- Modify: `src/pages/pickleball/how-it-works.astro`, `src/pages/pickleball/index.astro`
- Modify: `tests/e2e/pickleball/pickleball-public-pages.spec.js`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: shipped Tasks 1–10 only (copy rule).
- Produces: `BracketArt` (decorative, `aria-hidden`, CSS-only motion); guide steps "Or run a tournament", "Edit the draw, then start", "Courts fill from the draw"; the "Tournaments, the same way" section; landing feature "Casual tournaments" and FAQ "Can I run a tournament?".

- [ ] **Step 1: Write the failing test, and lift the ban**

In `tests/e2e/pickleball/pickleball-public-pages.spec.js`:

1. Find:

```js
      // Whole words only: a bare substring check would flag "opi" inside "copied".
      for (const unshipped of ['tournament', 'bracket', 'dupr', 'sign in', 'opi', 'performance index', 'rally-by-rally', 'mexicano']) {
        expect(copy, `"${unshipped}" on ${path}`).not.toMatch(new RegExp(`\\b${unshipped.replace(/[-]/g, '\\-')}`))
```

   Replace with:

```js
      // Whole words only: a bare substring check would flag "opi" inside "copied".
      for (const unshipped of ['dupr', 'sign in', 'opi', 'performance index', 'rally-by-rally', 'mexicano']) {
        expect(copy, `"${unshipped}" on ${path}`).not.toMatch(new RegExp(`\\b${unshipped.replace(/[-]/g, '\\-')}`))
```

2. Find:

```js
    for (const claim of ['winners play winners', 'Fairness you can see', 'Keep friends together', 'Court captains', 'TV board']) expect(landing).toContain(claim)
  })
```

   Replace with:

```js
    for (const claim of ['winners play winners', 'Fairness you can see', 'Keep friends together', 'Court captains', 'TV board']) expect(landing).toContain(claim)
  })

  test('the guide and landing page describe tournaments as built', async ({ page }) => {
    await page.goto('/pickleball/how-it-works')
    const guide = await mainCopy(page)
    for (const claim of ['Or run a tournament', 'pools then a bracket', 'double elimination', 'Edit the draw, then start', 'substitute a player', 'Tournaments, the same way']) expect(guide).toContain(claim)
    await page.goto('/pickleball')
    const landing = await mainCopy(page)
    for (const claim of ['Casual tournaments', 'Can I run a tournament?']) expect(landing).toContain(claim)
  })
```


- [ ] **Step 2: Run it to verify it fails**

Run: `npx playwright test tests/e2e/pickleball/pickleball-public-pages.spec.js --project=static -g "tournaments as built"`
Expected: FAIL (no "Or run a tournament" step yet).

- [ ] **Step 3: Implement**

```jsx
// src/components/pickleball/art/BracketArt.jsx
// Original, hand-authored SVG. Decorative. Four first-round games feed two
// semi-finals and a final; the winning path lights up and the ball rises to
// the top. CSS-only motion (pb-fade-cycle, pb-bob), stopped for reduced motion.
const FIRST = [24, 64, 112, 152]
const SEMI = [44, 132]

export default function BracketArt({ className = '' }) {
  return (
    <svg viewBox="0 0 340 196" fill="none" className={className} aria-hidden="true">
      {FIRST.map((y) => <rect key={y} x="12" y={y} width="86" height="22" rx="6" fill="#3055d6" />)}
      {SEMI.map((y) => <rect key={y} x="128" y={y} width="86" height="22" rx="6" fill="#3055d6" />)}
      <rect x="244" y="88" width="86" height="22" rx="6" fill="#152b66" stroke="#7594fb" strokeWidth="2" />
      <path d="M98 35h15v20h15M98 75h15V55M98 123h15v20h15M98 163h15v-20M214 55h15v44h15M214 143h15V99" stroke="#7594fb" strokeWidth="3" strokeLinejoin="round" />
      <g className="pb-fade-cycle">
        <rect x="12" y="24" width="86" height="22" rx="6" fill="#c6ff2e" />
        <rect x="128" y="44" width="86" height="22" rx="6" fill="#c6ff2e" />
        <rect x="244" y="88" width="86" height="22" rx="6" fill="#c6ff2e" />
        <path d="M98 35h15v20h15M214 55h15v44h15" stroke="#c6ff2e" strokeWidth="4" strokeLinejoin="round" />
      </g>
      <g className="pb-bob">
        <circle cx="287" cy="60" r="12" fill="#c6ff2e" />
        <circle cx="283" cy="56" r="2" fill="#0b1426" />
        <circle cx="292" cy="62" r="2" fill="#0b1426" />
        <circle cx="285" cy="66" r="2" fill="#0b1426" />
      </g>
    </svg>
  )
}
```

In `src/pages/pickleball/how-it-works.astro`:

1. Find:

```astro
import Layout from '../../layouts/Layout.astro'
import ScoreTapArt from '../../components/pickleball/art/ScoreTapArt.jsx'
```

   Replace with:

```astro
import Layout from '../../layouts/Layout.astro'
import BracketArt from '../../components/pickleball/art/BracketArt.jsx'
import ScoreTapArt from '../../components/pickleball/art/ScoreTapArt.jsx'
```

2. Find:

```astro
  { title: 'Keep friends together, or apart', body: 'On the Players tab, set two players to always partner, or never share a court. Every way of matching keeps it; if no game fits, the court waits and says why. The fairness panel shows the games spread, the longest wait and repeat partners as you go.' },
  { title: 'Fix a mistake', body: 'Undo a save for 2 minutes, or edit any result later. Standings update straight away.' },
```

   Replace with:

```astro
  { title: 'Keep friends together, or apart', body: 'On the Players tab, set two players to always partner, or never share a court. Every way of matching keeps it; if no game fits, the court waits and says why. The fairness panel shows the games spread, the longest wait and repeat partners as you go.' },
  { title: 'Or run a tournament', body: 'Pick Tournament when you start. Choose round robin, pools then a bracket (the top 2 of each pool go through), single elimination or double elimination. Pairs are made at random, balanced by skill (strongest with weakest) or in list order, and seeded at random, by skill or in your own order.' },
  { title: 'Edit the draw, then start', body: 'Generate the draw and change anything: swap players between pairs, swap two pairs, move a pair to another pool, or change who plays whom. A change that would break the draw is refused with the reason. Start locks it; after that you can substitute a player in a pair that is off court, or swap opponents between games in the same round that have not started.' },
  { title: 'Courts fill from the draw', body: 'Whichever court frees next gets the next game the draw allows. The board and the TV show the pools, the bracket and the pair standings, later rounds fill in as results are saved, and the winners get a moment in the spotlight.' },
  { title: 'Fix a mistake', body: 'Undo a save for 2 minutes, or edit any result later. Standings update straight away.' },
```

3. Find:

```astro

    <div class="mt-12 flex flex-wrap items-center gap-4">
```

   Replace with:

```astro

    <section class="mt-12 grid items-center gap-6 rounded-2xl border border-[#193480] p-6 md:grid-cols-[1fr_1.2fr]" aria-labelledby="tournament-heading">
      <div>
        <h2 id="tournament-heading" class="text-2xl font-bold text-white">Tournaments, the same way</h2>
        <p class="mt-2 text-[#b5c4e1]">The same free session, with a draw instead of a rotation. Captain links, the TV board, the results CSV and the 7-day deletion all work the same.</p>
      </div>
      <div class="pb-anim mx-auto w-full max-w-[20rem]" data-testid="pb-artwork"><BracketArt className="w-full" /></div>
    </section>

    <div class="mt-12 flex flex-wrap items-center gap-4">
```


In `src/pages/pickleball/index.astro`:

1. Find:

```astro
  { title: 'A TV board for the venue', body: 'Every court, who is up next, standings and fairness numbers on one screen, readable from across the hall.' },
  { title: 'Free, with no sign-up', body: 'No accounts for the host or the players. Your host link is your key; the board link is view-only.' },
```

   Replace with:

```astro
  { title: 'A TV board for the venue', body: 'Every court, who is up next, standings and fairness numbers on one screen, readable from across the hall.' },
  { title: 'Casual tournaments', body: 'Round robin, pools then a bracket, or single or double elimination. Random, balanced or hand-picked pairs, a draft draw you can edit, and the live bracket on every phone.' },
  { title: 'Free, with no sign-up', body: 'No accounts for the host or the players. Your host link is your key; the board link is view-only.' },
```

2. Find:

```astro
  { q: 'How long are results kept?', a: 'Until 7 days after the last change to the session, then they are deleted. You can download a CSV of every game and the standings before that.' },
  { q: 'Can I use it on a tablet, laptop or big screen?', a: 'Yes. The courts reflow to fit any screen, from a phone to a wide monitor, and the TV board shows every court in large type on a venue screen.' },
```

   Replace with:

```astro
  { q: 'How long are results kept?', a: 'Until 7 days after the last change to the session, then they are deleted. You can download a CSV of every game and the standings before that.' },
  { q: 'Can I run a tournament?', a: 'Yes, for doubles: round robin, pools then a bracket, single elimination or double elimination. Generate the draw, edit it as much as you like, then start; courts get the next game by themselves.' },
  { q: 'Can I use it on a tablet, laptop or big screen?', a: 'Yes. The courts reflow to fit any screen, from a phone to a wide monitor, and the TV board shows every court in large type on a venue screen.' },
```


- [ ] **Step 4: Run the whole public-pages spec**

Run: `npm run build && npx playwright test tests/e2e/pickleball/pickleball-public-pages.spec.js`
Expected: PASS on `static` and both Safari projects. In particular the art guards (every `pb-artwork` svg `aria-hidden`, no island), reduced motion, phone width, the banned list, no comparative "vs", and no unbuilt bracket feature. (`the services page links to the pickleball product` needs the CMS content that the normal e2e setup seeds.)

- [ ] **Step 5: CHANGELOG and commit**

```markdown
- The host guide and landing page describe tournaments (formats, pairing and seeding, the editable draft, substitutes, the live bracket), with a bracket illustration. The public-pages copy guard no longer bans "tournament" or "bracket".
```

```bash
git add src/components/pickleball/art/BracketArt.jsx src/pages/pickleball tests/e2e/pickleball/pickleball-public-pages.spec.js CHANGELOG.md
git commit -m "feat(pickleball): guide and landing copy for tournaments"
```

---

### Task 12: Docs, full verification, and the preview deploy (no release)

**Files:**
- Modify: `docs/pickleball/architecture.md` ("Free open play (2026-10)" section and the phase table)
- Modify: `docs/pickleball/runbook.md` (open play section)
- Modify: `CHANGELOG.md` (docs line only; **no version bump**: the MINOR release is cut later with the user)

- [ ] **Step 1: Write the docs**

In `docs/pickleball/architecture.md`, after the "### Phase 2 additions" list, add:

```markdown
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
  app's `generateFixtures`, `advanceBracket`, `nextPlayableFixture`,
  `rankTournamentStandings` and `resolvePoolQualifiers` unchanged;
  `reuse.test.ts` pins that they import nothing Phase 5 deletes.
- **Phases.** SETUP → DRAFT (unrestricted edits, each re-validated) → RUNNING
  (substitute off-court players, swap opponents between unstarted games of a
  round) → FINISHED (every game played; champion known).
- **Snapshots.** `toTournamentView` (allowlist: names, ids, scores, court labels)
  is in the viewer snapshot and so in the host and captain ones; courts carry
  `fixtureLabel`.
```

In the phase table, change the Open play row's status to "Phase 3 built (preview), release pending".

In `docs/pickleball/runbook.md`, after "### Captain links", add:

````markdown
### Apply migration 0018

Same commands as 0017 (preview needs `CLOUDFLARE_ACCOUNT_ID` inline; the
preview deploy does not apply D1 migrations).

```bash
CLOUDFLARE_ACCOUNT_ID=<preview account ID> npx wrangler d1 migrations apply devlab-pickleball-preview --remote --env preview
```

Read back:

```sql
SELECT name FROM sqlite_master WHERE name IN ('open_tournaments', 'open_tournament_entrants', 'open_tournament_fixtures');
```

### Inspect a tournament

```sql
SELECT format, pairing, seeding, phase, started_at FROM open_tournaments WHERE session_id = (SELECT id FROM open_sessions WHERE public_code = ?);
SELECT bracket, pool_label, round_number, position, entrant_a_id, entrant_b_id, source_a, source_b, winner_entrant_id, status
  FROM open_tournament_fixtures WHERE session_id = (SELECT id FROM open_sessions WHERE public_code = ?)
  ORDER BY CASE bracket WHEN 'POOL' THEN 0 WHEN 'MAIN' THEN 1 ELSE 2 END, COALESCE(pool_label, ''), round_number, position;
```

Do not edit fixture rows by hand: a running DO keeps its cached copy, and the
engine's validity rules are not re-checked on load. A stuck tournament is fixed
from the console (undo or edit a result, substitute, swap opponents).
````

```markdown
- Docs: architecture and runbook cover Phase 3 tournaments (kind, migration 0018, the engine around the reused fixture modules, phases, snapshots).
```

```bash
git add docs/pickleball CHANGELOG.md
git commit -m "docs(pickleball): document phase 3 tournaments"
```

- [ ] **Step 2: Full local verification**

Run: `npm run typecheck && npm run build && npm run test:unit && npm run lint`
Expected: all pass.

Run: `npx playwright test`
Expected: the full suite passes, including `static`, `worker` and both Safari projects.

- [ ] **Step 3: Push `development` and apply 0018 to the preview D1**

Run: `git push origin development`
Expected: the preview deploy workflow runs.

Ask the user to paste a fresh `CLOUDFLARE_API_TOKEN` for this one command (`AGENTS.md`). Use it inline only; never write it to a file or echo it.

Run: `CLOUDFLARE_API_TOKEN=<pasted> CLOUDFLARE_ACCOUNT_ID=<preview account ID> npx wrangler d1 migrations apply devlab-pickleball-preview --remote --env preview`
Expected: `0018_open_tournaments.sql` applied.

Read back the three table names (runbook query above). Expected: three rows.

- [ ] **Step 4: Verify on the preview URL**

On `https://devlab-studios-preview.stpnrey-agustinez.workers.dev`:
- **An open-play session from before the deploy, if any is live.** Open it as host; it loads and a result saves.
- **Create a Tournament, Pools then bracket, with 16 players on 4 courts.** Generate with Balanced pairs and By-skill seeding. Swap two players, move a pair to the other pool, then try changing a round-robin opponent: it is refused with "would play each other twice".
- **Start.** All four courts get pool games. Save a few from the console and one from a captain link on a second phone. Undo one; edit one.
- **Board and TV.** On a phone, the board's Draw tab shows both pools stacked; on a laptop, side by side. The TV names the game on each court and shows "Coming up".
- **Play to the end.** The bracket fills from the pools; the champions appear on the console, the board and the TV. Download the CSV: stages and pair standings are there.

Report what was checked, and any failure, to the user. **Stop here.** The version bump, `[Unreleased]` retitle, production migration and `main` fast-forward happen in a separate release step with the user (`AGENTS.md`, "Versioning and releases").

- [ ] **Step 5: Housekeeping**

Stop any local `wrangler dev` or `npm run preview` servers this work started (`tasklist //FI "IMAGENAME eq node.exe"`).

---

## Self-review notes (for the executor)

**Spec coverage, Phase 3 (§14 row 3, §6):**

| Requirement | Task(s) |
|---|---|
| Pairs: Random (crypto), Balanced (snake by skill), Manual; odd player flagged (§6.1) | T2 (engine, `randomInt`), T3 (`unpairedPlayers`), T6 (Start refused), T8 (setup, flag in the draft) |
| Formats: round robin, pools A–H top 2 → bracket, single, double elimination, unchanged (§6.2) | T3 (`generateDraw` over the reused generator), T6 (`play.test.ts` for every format) |
| Seeding: Random, By skill, Manual (§6.3); OPI seeding not used | T2, T8 |
| Draft: unrestricted edits, each re-validated, refused with a reason (§6.4) | T4 (`drawRules`, `drawEdits`), T6 (`EDIT_DRAW`), T8 (tap-to-select editor, server reason shown) |
| Start locks; substitute off-court; swap opponents in same round and pool/bracket (§6.5) | T4, T6, T9 |
| Later slots fill via `advanceBracket` (§6.5) | T5 (`progress.ts`) |
| Court loop: next READY fixture whose pairs aren't on court, any free court (§6.6) | T6 (`courts.ts`) |
| Standings per pool and overall via `rankTournamentStandings`; board shows pools and brackets (§6.7, §7) | T5, T7 (view), T8/T10 (`BracketView`, `PairStandings`) |
| Results need both scores (owner) | T6 (same `RECORD_RESULT`/`validateResult`) |
| Kind on the session (§3.2, §4.1 "format: open play / tournament") | T1, T6 (create schema and route), T8 (create form) |
| D1 tables cascading from `open_sessions`, purge retention (§3.2, §8) | T1 (migration, purge test) |
| Allowlisted snapshots (§7) | T7 (`view.ts`, tests for no skill/DUPR) |
| Captains on tournament courts (§3.3) | T6 (unit), T7 (e2e), T9 (no Edit on court) |
| Results CSV (§8) | T7 |
| Live board and TV with a Bracket tab, readable 390–1920 (§7, §11) | T10 (and the responsive e2e in T8 and T10) |
| In-app celebration for a winner, reduced motion respected (§11) | T9 |
| Public pages and guide; banned list drops "tournament" (§11) | T11 |
| Tests: `drawEdits.ts` validity rules (§13); e2e generate → edit → start → finish (§13) | T4, T7, T8–T10 |
| CHANGELOG line per commit; MINOR, no bump here | every task; T12 |

**Deferred by design:**
- Singles tournaments, bracket resets, third-place games, consolation brackets, reseeding (spec §2 Out; the reused generator has none).
- Withdrawing a pair mid-tournament (the reused `resolveWithdrawal` exists but the spec allows only substitutions after Start).
- Google sign-in and the DUPR export (Phase 4); retiring the logged-in app (Phase 5).

**Names that cross tasks:**
- `TournamentState`, `TournamentEntrant`, `TournamentFixture`, `DraftEdit`, `RunningEdit`, `EditResult`, `RandomInt`, `emptyTournament`, `sortFixtures`, `sortEntrants`, `FIXTURE_ORDER_SQL` (T1).
- `formPairs`, `seedPairs`, `shuffle`, `NEUTRAL_SKILL`, `randomInt` (T2).
- `FORMAT_INFO`, `PAIRING_INFO`, `SEEDING_INFO`, `FORMAT_ORDER`, `pairName`, `roundLabel`, `fixtureLabel`, `sourceLabel`, `generateDraw`, `poolFixtures`, `unpairedPlayers` (T3).
- `drawViolation`, `applyDraftEdit`, `applyRunningEdit` (T4).
- `overallStandings`, `poolStandings`, `poolLabels`, `fixtureFinished`, `reopenFixture`, `editFixtureResult`, `champion` (T5).
- `applyTournamentCommand`, `syncFixture`, `undoBlocker`, `leavingRefusal`, `OPEN_PLAY_ONLY`, `proposeFixture`, `withoutStaleProposals`, `tournamentCourtNote`, `tournamentSession`, `makeCtx`, `run`, `refusal`, `playOut` (T6).
- `toTournamentView`, `TournamentView`, `FixtureView`, `csvText`, `tournamentResultsCsv`, e2e `createTournament`/`ok`/`refused`/`hostSnapshot`/`playToChampion`/`ipFor` (T7).
- `tap`, `isSelected`, `commandFor`, `drawSections`, `nextGames`, `TOURNAMENT_TABS`, `BOARD_TABS`, `GameCard`, `BracketView`, `TournamentHost`, e2e `readyTournament`/`noSideScroll` (T8).
- `ChampionBanner`, `SubstituteSheet`, e2e `playCourt` (T9).
- `TournamentPanels`, `myStatus` `NEXT_GAME`/`DONE` (T10).

**Verified while writing this plan:** this plan was replayed task by task onto clean checkouts of `ac37948` and `14b4c9c`, and the `ac37948` result compared file by file with the tree it was written from (identical). On `14b4c9c` the replay was checked after **each** task: `tsc` clean, `eslint` with no errors, and every unit test passing at that point. On that tree: all unit tests pass (`vitest`: the engine, repository, reducer, snapshot and client-helper tests), `tsc` and `eslint` are clean, `npm run build` passes, and against a local `wrangler dev` with `0018` applied the whole of `open-tournament.spec.js` (API and screens), `open-play.spec.js` and `pickleball-public-pages.spec.js` pass (the one exception, the services-page link test, needs CMS content the scratch environment did not seed).

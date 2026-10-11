# Free Open Play — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a free, no-login pickleball open-play tool. A host creates a session, adds players, runs any number of courts with paddle-stack rotation and once-per-game score entry, and players follow a live QR board. Every session is deleted 7 days after its last change. All public pickleball pages are rewritten around this, with new animated vector art.

**Architecture:** The pure domain logic lives in `src/lib/pickleball/open/` and is unit-tested: rotation, scoring rules, standings, a command reducer, snapshots and a state diff. D1 (`PICKLEBALL_DB`) is the source of truth, through new `open_*` tables. One new Durable Object per session (`OpenSessionDO`) serializes commands, keeps the session in memory, writes only changed rows in one `db.batch()`, and broadcasts snapshots over hibernating WebSockets. Hosts are identified by a secret link (`#host=…`); viewers need only the public code.

**Tech Stack:**
- Astro 7 (server output) on Cloudflare Workers
- D1, Durable Objects
- React 19 islands, Tailwind
- Zod 4
- Vitest 4, including `node:sqlite` for repository tests
- Playwright

**Spec:** `docs/superpowers/specs/2026-10-11-pickleball-free-open-play-design.md`. Read §1, §3–§5, §7, §8, §10, §11 and §13 before starting. Phase 1 is the first row of §14.

## Global Constraints

- **No login anywhere in Phase 1.** Google sign-in, captains, the other stacking modes, tournaments, TV mode and DUPR export are later phases and must not appear in code paths or copy.
- **Only paddle stack exists.** `settings.mode` is accepted only as `'PADDLE_STACK'` (Zod literal) in Phase 1; the type keeps all four values for later phases.
- **Caps per session:** 16 courts, 128 players, 2,000 matches. Names ≤ 40 characters, trimmed, with control characters and emoji stripped.
- **Retention:** every successful command sets `last_activity_at = now` and `expires_at = now + 7 days`. The daily cron deletes rows whose `expires_at < now`. A load treats an expired row as not found.
- **Secrets:** the host key is 16 random bytes, base64url. Only its SHA-256 (base64url) is stored. It travels in the URL fragment, the `X-Host-Key` header, or a WebSocket `AUTH` message, and never in a query string.
- **Rate limits:**
  - create: 10 per IP per day, and fails closed (503) when `env.RATE_LIMITER` is missing;
  - commands: 120 per minute per session;
  - WebSocket connects: 30 per minute per IP;
  - public `state`: 60 per minute per IP.
- **Turnstile** on create, with action `open_session_create`. Localhost without a secret is allowed, per the existing `verifyTurnstileToken` contract.
- **CHECK constraints cannot be widened later** (`docs/pickleball/architecture.md`, "Schema constraint"). Every enum CHECK in `0016` is written wide now.
- **Palette** (spec §11): DevLab tokens plus `pickle-neon` `#c6ff2e` and `pickle-teamb` `#8d9bff`.
  - Violet `brand` `#4500ff` with white text is the main action colour.
  - Neon is used only as a fill with `ink` text, or as text on dark surfaces.
  - The typeface is Plus Jakarta Sans.
- **Responsive:** every new screen works from 390 px to 1920 px with no horizontal page scroll. Courts use `repeat(auto-fill, minmax(240px, 1fr))`, and dialogs are bottom sheets below `md` and centred panels from `md` up.
- **Motion:** CSS keyframes only, animating only `transform` and `opacity`. Everything stops under `prefers-reduced-motion: reduce`. Marketing art ships no JavaScript (no `client:*` on art components).
- **Copy rule:** every claim on a public page must map to shipped Phase 1 code. The words *tournament, bracket, DUPR, captain, TV, sign in, OPI, rally-by-rally, winners vs winners, Mexicano* must not appear on `/pickleball`, `/pickleball/how-it-works` or `/pickleball/rotation`.
- **Per commit:** each commit adds its `[Unreleased]` line to `CHANGELOG.md` in the same commit (`AGENTS.md`). Commit subjects must be lowercase after the type (`commitlint` enforces this).
- **Before any push:** `npm run typecheck && npm run build && npm run test:unit` and the full Playwright suite (`npx playwright test`).
- **Do not touch the old app.** It stays reachable until Phase 5 (spec §12). The exceptions are the middleware exemption, the shared Turnstile hook parameter, and `pickleball-public-pages.spec.js`.

## Review Focus

1. **Two saves for the same court.** A host double-tap, or a retry after a timeout, must never count a game twice: the second `RECORD_RESULT` gets 409, and a repeated `idempotencyKey` gets the original response. Pinned in Task 6 (409) and Task 10 (idempotent replay).
2. **A player taken off court mid-proposal.** Setting a proposed player to *break*/*left* must drop that proposal and re-propose without them. Setting a player who is *playing* to break must be refused. Pinned in Task 6.
3. **Pasted rosters from real chat apps.** Numbering like `1.`/`4)`/`-`, emoji, blank lines, comma-joined names and duplicates differing only in case must all parse cleanly. Pinned in Task 3.
4. **Expired or unknown codes.** The board, the WebSocket and the API must all behave as "not found" for a code past `expires_at`, even before the cron has run. Pinned in Task 8 (load filter) and Task 18 (UI notice).
5. **Deuce scores.** 12–10, 13–11 and 15–13 must be accepted in a win-by-2 game to 11, and 12–9 and 11–10 rejected. The game-over pad must let the host enter a loser score above `target − 1`. Pinned in Task 2 and Task 14.

---

## File map

| File | Responsibility |
|---|---|
| `migrations/pickleball/0016_open_sessions.sql` | `open_sessions`, `open_players`, `open_courts`, `open_matches`, `open_idempotency` |
| `src/lib/pickleball/open/types.ts` | Domain types, limits, defaults, `CommandContext` |
| `src/lib/pickleball/open/constants.ts` | Shared constants (Turnstile action) |
| `src/lib/pickleball/open/codes.ts` | Public code generate/normalize/format |
| `src/lib/pickleball/open/scoreValidation.ts` | Final-score rules |
| `src/lib/pickleball/open/roster.ts` | Paste and CSV roster parsing |
| `src/lib/pickleball/open/standings.ts` | Session standings and ranking |
| `src/lib/pickleball/open/fairness.ts` | Games played, sit-outs, history, queue order |
| `src/lib/pickleball/open/modes/paddleStack.ts` | Four-player pick and team split |
| `src/lib/pickleball/open/propose.ts` | Mode dispatch, `fillProposals` |
| `src/lib/schemas/pickleball/open/commands.ts` | Zod command and envelope schemas |
| `src/lib/schemas/pickleball/open/createSession.ts` | Zod create-session schema |
| `src/lib/pickleball/open/reducer.ts` | `applyCommand`, `finalizeCommand` |
| `src/lib/pickleball/open/create.ts` | `buildInitialState` |
| `src/lib/pickleball/open/snapshot.ts` | Viewer (allowlist) and host snapshots |
| `src/lib/pickleball/open/diff.ts` | `diffState` |
| `src/lib/pickleball/open/resultsCsv.ts` | Results CSV with an injection guard |
| `src/lib/pickleball/open/secrets.ts` | `constantTimeEqual` |
| `src/worker/repositories/pickleball/open/openSessions.ts` | All D1 SQL for open sessions |
| `src/worker/repositories/pickleball/open/testing/sqliteD1.ts` | Test-only D1 adapter over `node:sqlite` |
| `src/worker/pickleball/open/OpenSessionDO.ts` | Coordinator DO |
| `src/worker/pickleball/open/routeHelpers.ts` | Stub lookup, code/key extraction, status mapping |
| `src/worker/pickleball/open/purge.ts` | Cron purge |
| `src/pages/api/pickleball/open/**` | Thin routes |
| `src/pages/pickleball/rt/open/[code].ts` | WebSocket route |
| `src/layouts/PickleballAppShell.astro` | Standalone app shell |
| `src/pages/pickleball/new.astro`, `src/pages/pickleball/s/[code].astro`, `src/pages/pickleball/rotation.astro` | Pages |
| `src/pickleball-open/**` | React islands, client data layer |
| `src/components/pickleball/art/{HeroRally,PaddleStack,ScoreTap,QrBoard,ExpiredCourt}Art.jsx` | New art |
| `src/styles/pickleball-open.css` | Keyframes and reduced-motion rules |
| `tests/e2e/pickleball/open-play.spec.js` | API and UI flows, responsive checks |

---

### Task 1: D1 schema and a test D1 adapter

**Files:**
- Create: `migrations/pickleball/0016_open_sessions.sql`
- Create: `src/worker/repositories/pickleball/open/testing/sqliteD1.ts`
- Test: `src/worker/repositories/pickleball/open/schema.test.ts`

**Interfaces:**
- Produces: `createSqliteD1(migrationFiles: string[]): { d1: D1Database; raw: DatabaseSync }`. It implements `prepare(sql).bind(...).all()/first()/run()` and `batch(statements)` inside one transaction.

- [ ] **Step 1: Write the failing test**

```ts
// src/worker/repositories/pickleball/open/schema.test.ts
import { describe, expect, it } from 'vitest'
import { createSqliteD1 } from './testing/sqliteD1'

const MIGRATION = 'migrations/pickleball/0016_open_sessions.sql'
const NOW = '2026-10-11T10:00:00.000Z'

function seed(raw: ReturnType<typeof createSqliteD1>['raw']) {
  raw.exec(`
    INSERT INTO open_sessions (id, public_code, host_key_hash, kind, name, host_display_name, location, settings_json, status, version, created_at, last_activity_at, expires_at)
    VALUES ('s1', 'ABCDE23456', 'hash', 'OPEN_PLAY', 'Sunday', 'Mike', NULL, '{}', 'ACTIVE', 0, '${NOW}', '${NOW}', '${NOW}');
    INSERT INTO open_courts (id, session_id, label, position, enabled) VALUES ('c1', 's1', 'Court 1', 1, 1);
    INSERT INTO open_players (id, session_id, name, skill, dupr_id, status, games_offset, joined_at, waiting_since, position)
    VALUES ('p1', 's1', 'Ana', NULL, NULL, 'ACTIVE', 0, '${NOW}', '${NOW}', 1);
    INSERT INTO open_matches (id, session_id, court_id, seq, status, team_a_json, team_b_json, score_a, score_b, winner, fixture_id, proposed_at, started_at, finished_at)
    VALUES ('m1', 's1', 'c1', 1, 'PROPOSED', '["p1","p2"]', '["p3","p4"]', NULL, NULL, NULL, NULL, '${NOW}', NULL, NULL);
    INSERT INTO open_idempotency (session_id, key, response_json, created_at) VALUES ('s1', 'k1', '{}', '${NOW}');
  `)
}

describe('0016_open_sessions', () => {
  it('deleting a session cascades to every child table', () => {
    const { raw } = createSqliteD1([MIGRATION])
    seed(raw)
    raw.exec("DELETE FROM open_sessions WHERE id = 's1'")
    for (const table of ['open_courts', 'open_players', 'open_matches', 'open_idempotency']) {
      const row = raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }
      expect(row.n, table).toBe(0)
    }
  })

  it('rejects values outside the enum CHECKs', () => {
    const { raw } = createSqliteD1([MIGRATION])
    seed(raw)
    expect(() => raw.exec("UPDATE open_matches SET status = 'BOGUS' WHERE id = 'm1'")).toThrow(/CHECK/)
    expect(() => raw.exec("UPDATE open_players SET status = 'GONE' WHERE id = 'p1'")).toThrow(/CHECK/)
    expect(() => raw.exec("UPDATE open_sessions SET kind = 'LEAGUE' WHERE id = 's1'")).toThrow(/CHECK/)
  })

  it('enforces one public code per session', () => {
    const { raw } = createSqliteD1([MIGRATION])
    seed(raw)
    expect(() => raw.exec(`INSERT INTO open_sessions (id, public_code, host_key_hash, kind, name, host_display_name, location, settings_json, status, version, created_at, last_activity_at, expires_at)
      VALUES ('s2', 'ABCDE23456', 'h', 'OPEN_PLAY', 'x', 'y', NULL, '{}', 'ACTIVE', 0, '${NOW}', '${NOW}', '${NOW}')`)).toThrow(/UNIQUE/)
  })

  it('batch() is all-or-nothing through the adapter', async () => {
    const { d1, raw } = createSqliteD1([MIGRATION])
    seed(raw)
    await expect(d1.batch([
      d1.prepare("UPDATE open_players SET name = 'Changed' WHERE id = 'p1'"),
      d1.prepare("UPDATE open_players SET status = 'BOGUS' WHERE id = 'p1'"),
    ])).rejects.toThrow()
    const row = raw.prepare("SELECT name FROM open_players WHERE id = 'p1'").get() as { name: string }
    expect(row.name).toBe('Ana')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/worker/repositories/pickleball/open/schema.test.ts`
Expected: FAIL, "Cannot find module './testing/sqliteD1'".

- [ ] **Step 3: Write the migration**

```sql
-- migrations/pickleball/0016_open_sessions.sql
--
-- Free, no-login open play (spec 2026-10-11-pickleball-free-open-play-design.md §3.2).
-- No user or organization columns: a session is owned by whoever holds its host
-- secret, and everything below cascades from open_sessions so the 7-day purge
-- is one DELETE. Enum CHECKs are deliberately wider than Phase 1 uses -- a
-- CHECK cannot be widened on D1 later (docs/pickleball/architecture.md).

CREATE TABLE open_sessions (
  id                TEXT PRIMARY KEY,
  public_code       TEXT NOT NULL UNIQUE,
  host_key_hash     TEXT NOT NULL,
  kind              TEXT NOT NULL CHECK (kind IN ('OPEN_PLAY', 'TOURNAMENT')),
  name              TEXT NOT NULL,
  host_display_name TEXT NOT NULL,
  location          TEXT,
  settings_json     TEXT NOT NULL,
  status            TEXT NOT NULL CHECK (status IN ('ACTIVE', 'ENDED')),
  version           INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL,
  last_activity_at  TEXT NOT NULL,
  expires_at        TEXT NOT NULL
);
CREATE INDEX idx_open_sessions_expires_at ON open_sessions(expires_at);

CREATE TABLE open_courts (
  id         TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES open_sessions(id) ON DELETE CASCADE,
  label      TEXT NOT NULL,
  position   INTEGER NOT NULL,
  enabled    INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1))
);
CREATE INDEX idx_open_courts_session ON open_courts(session_id);

CREATE TABLE open_players (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL REFERENCES open_sessions(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  skill         REAL,
  dupr_id       TEXT,
  status        TEXT NOT NULL CHECK (status IN ('ACTIVE', 'BREAK', 'LEFT')),
  games_offset  INTEGER NOT NULL DEFAULT 0,
  joined_at     TEXT NOT NULL,
  waiting_since TEXT NOT NULL,
  position      INTEGER NOT NULL
);
CREATE INDEX idx_open_players_session ON open_players(session_id);

CREATE TABLE open_matches (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL REFERENCES open_sessions(id) ON DELETE CASCADE,
  court_id    TEXT NOT NULL REFERENCES open_courts(id) ON DELETE CASCADE,
  seq         INTEGER NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('PROPOSED', 'IN_PROGRESS', 'FINISHED', 'ABANDONED')),
  team_a_json TEXT NOT NULL,
  team_b_json TEXT NOT NULL,
  score_a     INTEGER,
  score_b     INTEGER,
  winner      TEXT CHECK (winner IN ('A', 'B')),
  fixture_id  TEXT,
  proposed_at TEXT NOT NULL,
  started_at  TEXT,
  finished_at TEXT
);
CREATE INDEX idx_open_matches_session ON open_matches(session_id, seq);

CREATE TABLE open_idempotency (
  session_id    TEXT NOT NULL REFERENCES open_sessions(id) ON DELETE CASCADE,
  key           TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  PRIMARY KEY (session_id, key)
);
```

- [ ] **Step 4: Write the test adapter**

```ts
// src/worker/repositories/pickleball/open/testing/sqliteD1.ts
//
// TEST-ONLY. A minimal D1 stand-in over node:sqlite so repository code can be
// exercised by vitest against the real migration SQL. Never imported by
// application code (nothing outside *.test.ts may import this file).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

type Bindable = string | number | null

class Statement {
  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
    private readonly params: readonly Bindable[] = [],
  ) {}

  bind(...params: Bindable[]): Statement {
    return new Statement(this.db, this.sql, params)
  }

  async all<T>(): Promise<{ results: T[]; success: true; meta: Record<string, never> }> {
    return { results: this.db.prepare(this.sql).all(...this.params) as T[], success: true, meta: {} }
  }

  async first<T>(): Promise<T | null> {
    return (this.db.prepare(this.sql).get(...this.params) as T | undefined) ?? null
  }

  async run(): Promise<{ success: true; meta: { changes: number } }> {
    const result = this.db.prepare(this.sql).run(...this.params)
    return { success: true, meta: { changes: Number(result.changes) } }
  }

  runSync(): { changes: number } {
    const result = this.db.prepare(this.sql).run(...this.params)
    return { changes: Number(result.changes) }
  }
}

export function createSqliteD1(migrationFiles: readonly string[]): { d1: D1Database; raw: DatabaseSync } {
  const raw = new DatabaseSync(':memory:')
  raw.exec('PRAGMA foreign_keys = ON')
  for (const file of migrationFiles) raw.exec(readFileSync(join(process.cwd(), file), 'utf8'))

  const d1 = {
    prepare: (sql: string) => new Statement(raw, sql),
    batch: async (statements: Statement[]) => {
      raw.exec('BEGIN')
      try {
        const results = statements.map((statement) => statement.runSync())
        raw.exec('COMMIT')
        return results.map((result) => ({ success: true, meta: { changes: result.changes } }))
      } catch (error) {
        raw.exec('ROLLBACK')
        throw error
      }
    },
  }
  return { d1: d1 as unknown as D1Database, raw }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/worker/repositories/pickleball/open/schema.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Apply the migration locally and wire it into the e2e server start**

Run: `npx wrangler d1 migrations apply devlab-pickleball --local`
Expected: `0016_open_sessions.sql` listed as applied.

In `playwright.config.js`, prefix the `worker` webServer `command` so a fresh checkout has the tables before fixtures run:

```js
      command:
        'npx wrangler d1 migrations apply devlab-pickleball --local && node scripts/pickleball/apply-e2e-fixtures.mjs && node scripts/mailbox/apply-e2e-fixtures.mjs && npx wrangler dev --port 8787 --local',
```

- [ ] **Step 7: Commit**

CHANGELOG `[Unreleased]` → `### Added`: `- D1 migration 0016 adds the open_* tables for free, no-login open play sessions. Every table cascades from open_sessions so a single delete removes a session.`

```bash
git add migrations/pickleball/0016_open_sessions.sql src/worker/repositories/pickleball/open playwright.config.js CHANGELOG.md
git commit -m "feat(pickleball): add open_* tables for no-login sessions"
```

---

### Task 2: Domain types, public codes, score rules

**Files:**
- Create: `src/lib/pickleball/open/types.ts`, `src/lib/pickleball/open/constants.ts`, `src/lib/pickleball/open/codes.ts`, `src/lib/pickleball/open/scoreValidation.ts`, `src/lib/pickleball/open/secrets.ts`
- Test: `src/lib/pickleball/open/codes.test.ts`, `src/lib/pickleball/open/scoreValidation.test.ts`, `src/lib/pickleball/open/secrets.test.ts`

**Interfaces:**
- Produces:
  - All the types below.
  - Code helpers: `generatePublicCode(randomBytes?)`, `normalizePublicCode(input): string | null`, `formatPublicCode(code)`.
  - Score helpers: `expectedWinnerScore(loser, { target, winBy2 })`, `validateResult({ winner, scoreA, scoreB }, settings): ValidationResult`.
  - `constantTimeEqual(a, b): boolean`.
  - `OPEN_SESSION_TURNSTILE_ACTION = 'open_session_create'`.

- [ ] **Step 1: Write the types (no test, compile-checked by later tasks)**

```ts
// src/lib/pickleball/open/types.ts
export type StackingMode = 'PADDLE_STACK' | 'WINNERS_LOSERS' | 'BY_STANDING' | 'BALANCED'
export type TargetPoints = 11 | 15 | 21
export type ScoringStyle = 'SIDEOUT' | 'RALLY'

export interface SessionSettings {
  mode: StackingMode
  target: TargetPoints
  winBy2: boolean
  winnerOnly: boolean
  scoringStyle: ScoringStyle
}

export type PlayerStatus = 'ACTIVE' | 'BREAK' | 'LEFT'

export interface OpenPlayer {
  id: string
  name: string
  skill: number | null
  duprId: string | null
  status: PlayerStatus
  /** Games credited on arrival so a late player starts level (spec §4.4). */
  gamesOffset: number
  joinedAt: string
  /** When the player last became available to play. */
  waitingSince: string
  position: number
}

export interface OpenCourt {
  id: string
  label: string
  position: number
  enabled: boolean
}

export type MatchStatus = 'PROPOSED' | 'IN_PROGRESS' | 'FINISHED' | 'ABANDONED'
export type Team = readonly [string, string]
export type Side = 'A' | 'B'

export interface OpenMatch {
  id: string
  courtId: string
  seq: number
  status: MatchStatus
  teamA: Team
  teamB: Team
  scoreA: number | null
  scoreB: number | null
  winner: Side | null
  proposedAt: string
  startedAt: string | null
  finishedAt: string | null
}

export type SessionStatus = 'ACTIVE' | 'ENDED'

export interface OpenSessionState {
  id: string
  publicCode: string
  kind: 'OPEN_PLAY' | 'TOURNAMENT'
  name: string
  hostDisplayName: string
  location: string | null
  status: SessionStatus
  settings: SessionSettings
  players: readonly OpenPlayer[]
  courts: readonly OpenCourt[]
  matches: readonly OpenMatch[]
  version: number
  createdAt: string
  lastActivityAt: string
  expiresAt: string
}

export interface CommandContext {
  now: string
  newId: () => string
}

export const LIMITS = {
  maxCourts: 16,
  maxPlayers: 128,
  maxMatches: 2000,
  maxNameLength: 40,
  undoWindowMs: 120_000,
  retentionMs: 7 * 24 * 60 * 60 * 1000,
} as const

export const DEFAULT_SETTINGS: SessionSettings = {
  mode: 'PADDLE_STACK',
  target: 11,
  winBy2: true,
  winnerOnly: false,
  scoringStyle: 'SIDEOUT',
}

export function addMs(iso: string, ms: number): string {
  return new Date(Date.parse(iso) + ms).toISOString()
}
```

```ts
// src/lib/pickleball/open/constants.ts
// Shared by the create form (client) and the create route (server) so the
// Turnstile action they compare can never drift.
export const OPEN_SESSION_TURNSTILE_ACTION = 'open_session_create'
```

- [ ] **Step 2: Write the failing tests**

```ts
// src/lib/pickleball/open/codes.test.ts
import { describe, expect, it } from 'vitest'
import { CODE_ALPHABET, formatPublicCode, generatePublicCode, normalizePublicCode } from './codes'

describe('public codes', () => {
  it('generates 10 characters from the unambiguous alphabet', () => {
    for (let i = 0; i < 200; i += 1) {
      const code = generatePublicCode()
      expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{10}$/)
    }
  })

  it('rejects biased bytes (>= 248) instead of wrapping them', () => {
    const bytes = [255, 250, 248, ...Array.from({ length: 13 }, (_, i) => i)]
    const code = generatePublicCode(() => Uint8Array.from(bytes))
    expect(code).toBe(CODE_ALPHABET.slice(0, 10))
  })

  it('normalizes case, dashes and spaces, and rejects ambiguous letters', () => {
    expect(normalizePublicCode('abcde-23456')).toBe('ABCDE23456')
    expect(normalizePublicCode(' ABCDE 23456 ')).toBe('ABCDE23456')
    expect(normalizePublicCode('ABCDE2345O')).toBeNull()
    expect(normalizePublicCode('ABCDE2345')).toBeNull()
  })

  it('formats for humans as two groups of five', () => {
    expect(formatPublicCode('ABCDE23456')).toBe('ABCDE-23456')
  })
})
```

```ts
// src/lib/pickleball/open/scoreValidation.test.ts
import { describe, expect, it } from 'vitest'
import { expectedWinnerScore, validateResult } from './scoreValidation'
import { DEFAULT_SETTINGS } from './types'

const to11 = DEFAULT_SETTINGS
const to11NoWinBy2 = { ...DEFAULT_SETTINGS, winBy2: false }

describe('expectedWinnerScore', () => {
  it('is the target until deuce, then loser + 2', () => {
    expect(expectedWinnerScore(7, to11)).toBe(11)
    expect(expectedWinnerScore(9, to11)).toBe(11)
    expect(expectedWinnerScore(10, to11)).toBe(12)
    expect(expectedWinnerScore(13, to11)).toBe(15)
    expect(expectedWinnerScore(10, to11NoWinBy2)).toBe(11)
  })
})

describe('validateResult', () => {
  it.each([
    ['A', 11, 7], ['B', 4, 11], ['A', 12, 10], ['A', 13, 11], ['B', 13, 15],
  ])('accepts %s %i-%i to 11 win by 2', (winner, scoreA, scoreB) => {
    expect(validateResult({ winner: winner as 'A' | 'B', scoreA, scoreB }, to11)).toEqual({ ok: true })
  })

  it.each([
    ['A', 11, 10], ['A', 12, 9], ['A', 10, 8], ['A', 7, 11], ['A', 11, 11], ['A', 100, 98], ['A', 11.5, 7],
  ])('rejects %s %s-%s to 11 win by 2', (winner, scoreA, scoreB) => {
    const result = validateResult({ winner: winner as 'A' | 'B', scoreA: Number(scoreA), scoreB: Number(scoreB) }, to11)
    expect(result.ok).toBe(false)
  })

  it('without win-by-2, the game ends exactly at the target', () => {
    expect(validateResult({ winner: 'A', scoreA: 11, scoreB: 10 }, to11NoWinBy2)).toEqual({ ok: true })
    expect(validateResult({ winner: 'A', scoreA: 12, scoreB: 10 }, to11NoWinBy2).ok).toBe(false)
  })

  it('a winner-only save (both scores null) is always allowed', () => {
    expect(validateResult({ winner: 'B', scoreA: null, scoreB: null }, to11)).toEqual({ ok: true })
  })

  it('half a score is refused', () => {
    expect(validateResult({ winner: 'A', scoreA: 11, scoreB: null }, to11).ok).toBe(false)
  })

  it('a winner-only session refuses scores', () => {
    const settings = { ...to11, winnerOnly: true }
    expect(validateResult({ winner: 'A', scoreA: 11, scoreB: 5 }, settings).ok).toBe(false)
    expect(validateResult({ winner: 'A', scoreA: null, scoreB: null }, settings)).toEqual({ ok: true })
  })
})
```

```ts
// src/lib/pickleball/open/secrets.test.ts
import { describe, expect, it } from 'vitest'
import { constantTimeEqual } from './secrets'

describe('constantTimeEqual', () => {
  it('compares equal and unequal strings', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true)
    expect(constantTimeEqual('abc', 'abd')).toBe(false)
    expect(constantTimeEqual('abc', 'abcd')).toBe(false)
    expect(constantTimeEqual('', '')).toBe(true)
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/lib/pickleball/open`
Expected: FAIL, modules not found.

- [ ] **Step 4: Implement**

```ts
// src/lib/pickleball/open/codes.ts
// No I, L, O, 0 or 1: a code is read off a phone held up at the court and
// typed by hand, so characters that look alike are excluded.
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const CODE_LENGTH = 10
const CODE_PATTERN = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{10}$/
// Largest multiple of 31 below 256; bytes at or above it are discarded so
// every character is equally likely (no modulo bias).
const UNBIASED_LIMIT = 256 - (256 % CODE_ALPHABET.length)

function cryptoBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length))
}

export function generatePublicCode(randomBytes: (length: number) => Uint8Array = cryptoBytes): string {
  let code = ''
  while (code.length < CODE_LENGTH) {
    for (const byte of randomBytes(16)) {
      if (byte < UNBIASED_LIMIT && code.length < CODE_LENGTH) code += CODE_ALPHABET[byte % CODE_ALPHABET.length]
    }
  }
  return code
}

export function normalizePublicCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[\s-]/g, '')
  return CODE_PATTERN.test(code) ? code : null
}

export function formatPublicCode(code: string): string {
  return `${code.slice(0, 5)}-${code.slice(5)}`
}
```

```ts
// src/lib/pickleball/open/scoreValidation.ts
import type { SessionSettings, Side } from './types'

export interface ResultInput {
  winner: Side
  scoreA: number | null
  scoreB: number | null
}

export type ValidationResult = { ok: true } | { ok: false; reason: string }

const OK: ValidationResult = { ok: true }

function isScore(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 99
}

/** The only winning score a finished game can have, given the loser's. */
export function expectedWinnerScore(loserScore: number, settings: Pick<SessionSettings, 'target' | 'winBy2'>): number {
  if (!settings.winBy2) return settings.target
  return loserScore <= settings.target - 2 ? settings.target : loserScore + 2
}

export function validateResult(input: ResultInput, settings: SessionSettings): ValidationResult {
  const { winner, scoreA, scoreB } = input
  if (scoreA === null && scoreB === null) return OK
  if (settings.winnerOnly) return { ok: false, reason: 'This session records winners only.' }
  if (scoreA === null || scoreB === null) return { ok: false, reason: 'Enter both scores, or save the winner only.' }
  if (!isScore(scoreA) || !isScore(scoreB)) return { ok: false, reason: 'Scores must be whole numbers from 0 to 99.' }

  const winnerScore = winner === 'A' ? scoreA : scoreB
  const loserScore = winner === 'A' ? scoreB : scoreA
  if (winnerScore <= loserScore) return { ok: false, reason: 'The winning team must have the higher score.' }
  if (winnerScore !== expectedWinnerScore(loserScore, settings)) {
    const rule = settings.winBy2 ? `to ${settings.target}, win by 2` : `to ${settings.target}`
    return { ok: false, reason: `A game ${rule} can't end ${winnerScore}–${loserScore}.` }
  }
  return OK
}
```

```ts
// src/lib/pickleball/open/secrets.ts
/** Compares two strings in time independent of where they first differ. */
export function constantTimeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length
  const length = Math.max(a.length, b.length)
  for (let i = 0; i < length; i += 1) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  return diff === 0
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/pickleball/open`
Expected: PASS.

- [ ] **Step 6: Commit**

CHANGELOG `### Added`: `- Score rules for once-per-game results (target 11/15/21, win by 2, deuce) and unambiguous 10-character session codes.`

```bash
git add src/lib/pickleball/open CHANGELOG.md
git commit -m "feat(pickleball): open play types, session codes and score rules"
```

---

### Task 3: Roster parsing (paste and CSV)

**Files:**
- Create: `src/lib/pickleball/open/roster.ts`
- Test: `src/lib/pickleball/open/roster.test.ts`

**Interfaces:**
- Produces:
  - `cleanName(raw): string`
  - `parseRoster(text, existing?): { names: string[]; duplicates: string[] }`
  - `parseRosterCsv(text, existing?): { entries: RosterEntry[]; duplicates: string[]; warnings: string[] }`
  - `interface RosterEntry { name: string; skill: number | null; duprId: string | null }`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/pickleball/open/roster.test.ts
import { describe, expect, it } from 'vitest'
import { cleanName, parseRoster, parseRosterCsv } from './roster'

describe('cleanName', () => {
  it('strips list markers, emoji, control characters and extra spaces', () => {
    expect(cleanName('1. Ana 🔥')).toBe('Ana')
    expect(cleanName('4) Ivan')).toBe('Ivan')
    expect(cleanName('- Fay')).toBe('Fay')
    expect(cleanName('• Gio ✅')).toBe('Gio')
    expect(cleanName('  Mary   Jo \u0007 ')).toBe('Mary Jo')
    expect(cleanName('2Pac')).toBe('2Pac')
  })

  it('caps names at 40 characters', () => {
    expect(cleanName('x'.repeat(60))).toHaveLength(40)
  })
})

describe('parseRoster', () => {
  it('parses a messy list copied from Reclub or WhatsApp', () => {
    const text = '1. Ana 🔥\n2. Ben\n3. Carlo, Dina, Eli\n- Fay\nGio ✅\n\nHana\n4) Ivan\nJun, Kat, Leo, Mia, Nico\nben'
    const result = parseRoster(text)
    expect(result.names).toEqual(['Ana', 'Ben', 'Carlo', 'Dina', 'Eli', 'Fay', 'Gio', 'Hana', 'Ivan', 'Jun', 'Kat', 'Leo', 'Mia', 'Nico'])
    expect(result.duplicates).toEqual(['ben'])
  })

  it('skips names already in the session, case-insensitively', () => {
    expect(parseRoster('Ana\nZed', ['ANA'])).toEqual({ names: ['Zed'], duplicates: ['Ana'] })
  })

  it('returns nothing for blank input', () => {
    expect(parseRoster('  \n , \n')).toEqual({ names: [], duplicates: [] })
  })
})

describe('parseRosterCsv', () => {
  it('reads name, skill and DUPR ID, with or without a header row', () => {
    const csv = 'name,skill,dupr\nAna,4.5,ab12c3\n"Ben",3,\nCarlo,,QX7M2K'
    expect(parseRosterCsv(csv).entries).toEqual([
      { name: 'Ana', skill: 4.5, duprId: 'AB12C3' },
      { name: 'Ben', skill: 3, duprId: null },
      { name: 'Carlo', skill: null, duprId: 'QX7M2K' },
    ])
  })

  it('keeps the player but warns about a bad skill or DUPR ID', () => {
    const result = parseRosterCsv('Ana,12,TOOLONG1')
    expect(result.entries).toEqual([{ name: 'Ana', skill: null, duprId: null }])
    expect(result.warnings).toHaveLength(2)
  })

  it('reports duplicates', () => {
    expect(parseRosterCsv('Ana\nana').duplicates).toEqual(['ana'])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/pickleball/open/roster.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/pickleball/open/roster.ts
import { LIMITS } from './types'

// "1." "12)" "3 -" "-" "*" "•" "·" "–" "—" at the start of a line.
const LIST_MARKER = /^\s*(?:\d+\s*[.):-]|[-*•·–—])\s*/u
const PICTOGRAPHIC = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}]/gu
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001F\u007F]/g
const DUPR_ID = /^[A-Z0-9]{6}$/

export interface RosterEntry {
  name: string
  skill: number | null
  duprId: string | null
}

export function cleanName(raw: string): string {
  return raw
    .replace(LIST_MARKER, '')
    .replace(PICTOGRAPHIC, '')
    .replace(CONTROL, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, LIMITS.maxNameLength)
    .trim()
}

function seenSet(existing: readonly string[]): Set<string> {
  return new Set(existing.map((name) => name.toLocaleLowerCase()))
}

export function parseRoster(text: string, existing: readonly string[] = []): { names: string[]; duplicates: string[] } {
  const seen = seenSet(existing)
  const names: string[] = []
  const duplicates: string[] = []
  for (const line of text.split(/\r?\n/)) {
    for (const part of line.replace(LIST_MARKER, '').split(',')) {
      const name = cleanName(part)
      if (!name) continue
      const key = name.toLocaleLowerCase()
      if (seen.has(key)) {
        duplicates.push(name)
        continue
      }
      seen.add(key)
      names.push(name)
    }
  }
  return { names, duplicates }
}

function unquote(cell: string): string {
  return cell.trim().replace(/^"(.*)"$/, '$1').trim()
}

export function parseRosterCsv(
  text: string,
  existing: readonly string[] = [],
): { entries: RosterEntry[]; duplicates: string[]; warnings: string[] } {
  const seen = seenSet(existing)
  const entries: RosterEntry[] = []
  const duplicates: string[] = []
  const warnings: string[] = []

  text.split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return
    const cells = line.split(',').map(unquote)
    if (index === 0 && cells[0]?.toLowerCase() === 'name') return
    const name = cleanName(cells[0] ?? '')
    if (!name) return
    const key = name.toLocaleLowerCase()
    if (seen.has(key)) {
      duplicates.push(name)
      return
    }
    seen.add(key)

    const skillRaw = cells[1] ?? ''
    let skill: number | null = null
    if (skillRaw) {
      const value = Number(skillRaw)
      if (Number.isFinite(value) && value >= 1 && value <= 8) skill = Math.round(value * 100) / 100
      else warnings.push(`Line ${index + 1}: skill "${skillRaw}" ignored (use 1 to 8).`)
    }

    const duprRaw = (cells[2] ?? '').toUpperCase()
    let duprId: string | null = null
    if (duprRaw) {
      if (DUPR_ID.test(duprRaw)) duprId = duprRaw
      else warnings.push(`Line ${index + 1}: DUPR ID "${cells[2]}" ignored (6 letters or digits).`)
    }

    entries.push({ name, skill, duprId })
  })

  return { entries, duplicates, warnings }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/pickleball/open/roster.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

CHANGELOG `### Added`: `- Paste-a-list and CSV roster parsing that cleans numbering, emoji and duplicates from lists copied out of chat apps.`

```bash
git add src/lib/pickleball/open/roster.ts src/lib/pickleball/open/roster.test.ts CHANGELOG.md
git commit -m "feat(pickleball): parse pasted and csv rosters"
```

---

### Task 4: Session standings

**Files:**
- Create: `src/lib/pickleball/open/standings.ts`
- Test: `src/lib/pickleball/open/standings.test.ts`
- Also create the test fixture helper: `src/lib/pickleball/open/testing/fixtures.ts`

**Interfaces:**
- Consumes: the types from Task 2.
- Produces:
  - `interface StandingRow { playerId; name; played; wins; losses; pointsFor; pointsAgainst; scoredGames; winRate: number | null; avgDiff: number | null; avgFor: number | null; rank: number | null }`
  - `computeStandings(players, matches): StandingRow[]`
  - Fixture helpers `player(id, overrides?)`, `court(id, position)`, `finished(id, teamA, teamB, winner, scoreA, scoreB, at)`, `sessionState(overrides?)`.

- [ ] **Step 1: Write the fixture helper**

```ts
// src/lib/pickleball/open/testing/fixtures.ts
// Test-only builders. Never imported by application code.
import { DEFAULT_SETTINGS, type OpenCourt, type OpenMatch, type OpenPlayer, type OpenSessionState, type Side } from '../types'

export const T0 = '2026-10-11T10:00:00.000Z'

export function at(minutes: number): string {
  return new Date(Date.parse(T0) + minutes * 60_000).toISOString()
}

export function player(id: string, overrides: Partial<OpenPlayer> = {}): OpenPlayer {
  return { id, name: id, skill: null, duprId: null, status: 'ACTIVE', gamesOffset: 0, joinedAt: T0, waitingSince: T0, position: 0, ...overrides }
}

export function court(id: string, position: number, enabled = true): OpenCourt {
  return { id, label: `Court ${position}`, position, enabled }
}

export function finished(
  id: string, teamA: [string, string], teamB: [string, string], winner: Side,
  scoreA: number | null, scoreB: number | null, minute = 0, courtId = 'c1',
): OpenMatch {
  return {
    id, courtId, seq: minute, status: 'FINISHED', teamA, teamB, scoreA, scoreB, winner,
    proposedAt: at(minute), startedAt: at(minute), finishedAt: at(minute + 10),
  }
}

export function sessionState(overrides: Partial<OpenSessionState> = {}): OpenSessionState {
  return {
    id: 's1', publicCode: 'ABCDE23456', kind: 'OPEN_PLAY', name: 'Sunday', hostDisplayName: 'Mike', location: null,
    status: 'ACTIVE', settings: DEFAULT_SETTINGS, players: [], courts: [court('c1', 1)], matches: [],
    version: 1, createdAt: T0, lastActivityAt: T0, expiresAt: at(7 * 24 * 60), ...overrides,
  }
}
```

- [ ] **Step 2: Write the failing test**

```ts
// src/lib/pickleball/open/standings.test.ts
import { describe, expect, it } from 'vitest'
import { computeStandings } from './standings'
import { finished, player } from './testing/fixtures'

const names = (rows: { name: string }[]) => rows.map((row) => row.name)

describe('computeStandings', () => {
  it('ranks by win rate, then point difference PER GAME (spec §5.3 example)', () => {
    // Ana: 11-2, 11-3, 11-5, 9-11 (+21 / 4 = +5.25). Leo: 11-9, 11-9, 12-10, 9-11 (+4 / 4 = +1).
    const players = ['Ana', 'Leo', 'x1', 'x2', 'x3', 'x4'].map((id) => player(id))
    const matches = [
      finished('a1', ['Ana', 'x1'], ['x2', 'x3'], 'A', 11, 2, 1),
      finished('a2', ['Ana', 'x1'], ['x2', 'x3'], 'A', 11, 3, 2),
      finished('a3', ['Ana', 'x1'], ['x2', 'x3'], 'A', 11, 5, 3),
      finished('a4', ['Ana', 'x1'], ['x2', 'x3'], 'B', 9, 11, 4),
      finished('l1', ['Leo', 'x4'], ['x2', 'x3'], 'A', 11, 9, 5),
      finished('l2', ['Leo', 'x4'], ['x2', 'x3'], 'A', 11, 9, 6),
      finished('l3', ['Leo', 'x4'], ['x2', 'x3'], 'A', 12, 10, 7),
      finished('l4', ['Leo', 'x4'], ['x2', 'x3'], 'B', 9, 11, 8),
    ]
    const rows = computeStandings(players, matches)
    const ana = rows.find((row) => row.name === 'Ana')!
    expect(ana).toMatchObject({ played: 4, wins: 3, losses: 1, winRate: 0.75, avgDiff: 5.25, rank: 1 })
    expect(rows.indexOf(ana)).toBeLessThan(rows.findIndex((row) => row.name === 'Leo'))
  })

  it('compares per game, not totals, when game counts differ', () => {
    const players = ['A', 'B', 'o1', 'o2', 'o3'].map((id) => player(id))
    const matches = [
      // A: 1-0, +8 in one game. B: 2-0, +3 and +3 (total +6, but 100% too).
      finished('m1', ['A', 'o1'], ['o2', 'o3'], 'A', 11, 3, 1),
      finished('m2', ['B', 'o1'], ['o2', 'o3'], 'A', 11, 8, 2),
      finished('m3', ['B', 'o1'], ['o2', 'o3'], 'A', 11, 8, 3),
    ]
    expect(names(computeStandings(players, matches)).slice(0, 2)).toEqual(['A', 'B'])
  })

  it('winner-only games count toward W/L but not toward point averages', () => {
    const rows = computeStandings([player('A'), player('B'), player('C'), player('D')], [
      finished('m1', ['A', 'B'], ['C', 'D'], 'A', null, null, 1),
      finished('m2', ['A', 'B'], ['C', 'D'], 'A', 11, 5, 2),
    ])
    expect(rows.find((row) => row.name === 'A')).toMatchObject({ played: 2, wins: 2, scoredGames: 1, avgDiff: 6, avgFor: 11 })
  })

  it('breaks a full tie by head-to-head when the tied players met', () => {
    // Zed and Amy both finish 1-1, 20 for and 20 against: identical on every
    // core key. Zed beat Amy in m1, so Zed ranks first even though "Amy"
    // sorts first by name.
    // Every other player appears once, so only Zed and Amy finish 1-1.
    const players = ['Zed', 'Amy', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y'].map((id) => player(id))
    const rows = computeStandings(players, [
      finished('m1', ['Zed', 'r'], ['Amy', 's'], 'A', 11, 9, 1),
      finished('m2', ['Amy', 't'], ['u', 'v'], 'A', 11, 9, 2),
      finished('m3', ['Zed', 'w'], ['x', 'y'], 'B', 9, 11, 3),
    ])
    expect(names(rows).filter((n) => n === 'Zed' || n === 'Amy')).toEqual(['Zed', 'Amy'])
  })

  it('falls back to name when tied players never met', () => {
    const players = ['Zed', 'Amy', 'r', 's', 't', 'u'].map((id) => player(id))
    const rows = computeStandings(players, [
      finished('m1', ['Zed', 'r'], ['s', 't'], 'A', 11, 5, 1),
      finished('m2', ['Amy', 'u'], ['s', 't'], 'A', 11, 5, 2),
    ])
    expect(names(rows).slice(0, 4)).toEqual(['Amy', 'r', 'u', 'Zed'])
  })

  it('lists unplayed players last and unranked, and drops players who left without playing', () => {
    const rows = computeStandings(
      [player('A'), player('B'), player('C'), player('D'), player('New'), player('Gone', { status: 'LEFT' })],
      [finished('m1', ['A', 'B'], ['C', 'D'], 'A', 11, 4, 1)],
    )
    expect(rows.at(-1)).toMatchObject({ name: 'New', played: 0, rank: null, winRate: null })
    expect(names(rows)).not.toContain('Gone')
  })

  it('ignores matches that are not finished', () => {
    const live = { ...finished('m1', ['A', 'B'], ['C', 'D'], 'A', 11, 4, 1), status: 'IN_PROGRESS' as const, winner: null }
    const rows = computeStandings(['A', 'B', 'C', 'D'].map((id) => player(id)), [live])
    expect(rows.every((row) => row.played === 0)).toBe(true)
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/lib/pickleball/open/standings.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 4: Implement**

```ts
// src/lib/pickleball/open/standings.ts
import type { OpenMatch, OpenPlayer } from './types'

export interface StandingRow {
  playerId: string
  name: string
  played: number
  wins: number
  losses: number
  pointsFor: number
  pointsAgainst: number
  scoredGames: number
  winRate: number | null
  avgDiff: number | null
  avgFor: number | null
  rank: number | null
}

const EPSILON = 1e-9

interface Tally { played: number; wins: number; losses: number; pointsFor: number; pointsAgainst: number; scoredGames: number }
const EMPTY: Tally = { played: 0, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0, scoredGames: 0 }

function tallies(matches: readonly OpenMatch[]): ReadonlyMap<string, Tally> {
  return matches.reduce((acc, match) => {
    const scored = match.scoreA !== null && match.scoreB !== null
    const sides = [
      { team: match.teamA, won: match.winner === 'A', pf: match.scoreA ?? 0, pa: match.scoreB ?? 0 },
      { team: match.teamB, won: match.winner === 'B', pf: match.scoreB ?? 0, pa: match.scoreA ?? 0 },
    ]
    const next = new Map(acc)
    for (const side of sides) {
      for (const id of side.team) {
        const t = next.get(id) ?? EMPTY
        next.set(id, {
          played: t.played + 1,
          wins: t.wins + (side.won ? 1 : 0),
          losses: t.losses + (side.won ? 0 : 1),
          pointsFor: t.pointsFor + (scored ? side.pf : 0),
          pointsAgainst: t.pointsAgainst + (scored ? side.pa : 0),
          scoredGames: t.scoredGames + (scored ? 1 : 0),
        })
      }
    }
    return next
  }, new Map<string, Tally>())
}

function toRow(p: OpenPlayer, t: Tally): StandingRow {
  return {
    playerId: p.id, name: p.name, ...t,
    winRate: t.played ? t.wins / t.played : null,
    avgDiff: t.scoredGames ? (t.pointsFor - t.pointsAgainst) / t.scoredGames : null,
    avgFor: t.scoredGames ? t.pointsFor / t.scoredGames : null,
    rank: null,
  }
}

/** Descending; a null sorts after any number. */
function desc(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  return Math.abs(a - b) < EPSILON ? 0 : b - a
}

function compareCore(a: StandingRow, b: StandingRow): number {
  return desc(a.winRate, b.winRate) || desc(a.avgDiff, b.avgDiff) || desc(a.avgFor, b.avgFor)
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

/** Reorders a fully tied group by head-to-head wins if every pair met (spec §5.3 rule 4); else by name. */
function breakTie(group: StandingRow[], finished: readonly OpenMatch[]): StandingRow[] {
  const byName = [...group].sort((a, b) => a.name.localeCompare(b.name))
  if (group.length < 2) return byName
  const ids = new Set(group.map((row) => row.playerId))
  const met = new Set<string>()
  const h2h = new Map(group.map((row) => [row.playerId, 0]))
  for (const match of finished) {
    for (const a of match.teamA) {
      for (const b of match.teamB) {
        if (!ids.has(a) || !ids.has(b)) continue
        met.add(pairKey(a, b))
        const winnerId = match.winner === 'A' ? a : b
        h2h.set(winnerId, (h2h.get(winnerId) ?? 0) + 1)
      }
    }
  }
  const allMet = byName.every((a, i) => byName.slice(i + 1).every((b) => met.has(pairKey(a.playerId, b.playerId))))
  if (!allMet) return byName
  return byName.sort((a, b) => (h2h.get(b.playerId) ?? 0) - (h2h.get(a.playerId) ?? 0))
}

export function computeStandings(players: readonly OpenPlayer[], matches: readonly OpenMatch[]): StandingRow[] {
  const finished = matches.filter((m) => m.status === 'FINISHED' && m.winner !== null)
  const byPlayer = tallies(finished)
  const rows = players
    .map((p) => toRow(p, byPlayer.get(p.id) ?? EMPTY))
    .filter((row) => row.played > 0 || players.find((p) => p.id === row.playerId)?.status !== 'LEFT')

  const ranked = rows.filter((row) => row.played > 0).sort(compareCore)
  const unranked = rows.filter((row) => row.played === 0).sort((a, b) => a.name.localeCompare(b.name))

  const ordered: StandingRow[] = []
  let i = 0
  while (i < ranked.length) {
    let j = i + 1
    while (j < ranked.length && compareCore(ranked[i], ranked[j]) === 0) j += 1
    ordered.push(...breakTie(ranked.slice(i, j), finished))
    i = j
  }
  return [...ordered.map((row, index) => ({ ...row, rank: index + 1 })), ...unranked]
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/lib/pickleball/open/standings.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

CHANGELOG `### Added`: `- Session standings ranked by win rate, then point difference per game, then points per game, then head-to-head.`

```bash
git add src/lib/pickleball/open/standings.ts src/lib/pickleball/open/standings.test.ts src/lib/pickleball/open/testing CHANGELOG.md
git commit -m "feat(pickleball): rank open play standings by win rate and per-game margin"
```

---

### Task 5: Fairness and paddle-stack proposals

**Files:**
- Create: `src/lib/pickleball/open/fairness.ts`, `src/lib/pickleball/open/modes/paddleStack.ts`, `src/lib/pickleball/open/propose.ts`
- Test: `src/lib/pickleball/open/fairness.test.ts`, `src/lib/pickleball/open/propose.test.ts`

**Interfaces:**
- Consumes: the Task 2 types and Task 4 fixtures.
- Produces:
  - `pairKey(a, b)`, `matchIncludes(match, playerId)`, `gamesPlayed(player, matches)`, `busyPlayerIds(matches): Set<string>`, `roundsSatOut(player, state)`.
  - `pairingHistory(matches): PartnerHistory`, `queueOrder(state): QueueEntry[]`, `SIT_OUT_LIMIT = 2`.
  - `interface QueueEntry { player: OpenPlayer; games: number; satOut: number; forced: boolean }`.
  - `interface Proposal { teamA: Team; teamB: Team }`, `splitTeams(four, history): Proposal`, `proposePaddleStack(queue, history, exclude?): Proposal | null`.
  - `proposeForCourt(state, exclude?): Proposal | null`, `addProposal(state, courtId, proposal, ctx): OpenSessionState`, `fillProposals(state, ctx): OpenSessionState`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/pickleball/open/fairness.test.ts
import { describe, expect, it } from 'vitest'
import { busyPlayerIds, gamesPlayed, pairingHistory, pairKey, queueOrder, roundsSatOut } from './fairness'
import { at, court, finished, player, sessionState } from './testing/fixtures'

describe('fairness', () => {
  it('counts finished games plus the late-arrival offset', () => {
    const matches = [finished('m1', ['A', 'B'], ['C', 'D'], 'A', 11, 3, 1)]
    expect(gamesPlayed(player('A'), matches)).toBe(1)
    expect(gamesPlayed(player('E', { gamesOffset: 2 }), matches)).toBe(2)
  })

  it('treats proposed and in-progress players as busy', () => {
    const proposed = { ...finished('m1', ['A', 'B'], ['C', 'D'], 'A', null, null), status: 'PROPOSED' as const, winner: null }
    expect([...busyPlayerIds([proposed])].sort()).toEqual(['A', 'B', 'C', 'D'])
  })

  it('counts rounds sat out as started games since becoming available, per enabled court', () => {
    const state = sessionState({
      courts: [court('c1', 1), court('c2', 2), court('c3', 3, false)],
      players: [player('W', { waitingSince: at(0) })],
      matches: [1, 2, 3, 4, 5].map((n) => finished(`m${n}`, ['a', 'b'], ['c', 'd'], 'A', 11, 1, n)),
    })
    expect(roundsSatOut(state.players[0], state)).toBe(2) // 5 started games / 2 enabled courts
  })

  it('orders the queue: forced first, then fewest games, then longest wait', () => {
    const state = sessionState({
      courts: [court('c1', 1)],
      players: [
        player('Fresh', { waitingSince: at(30), position: 1 }),
        player('Veteran', { gamesOffset: 3, waitingSince: at(0), position: 2 }),
        player('Waiting', { gamesOffset: 3, waitingSince: at(0), position: 3 }),
        player('Rested', { waitingSince: at(10), position: 4 }),
      ],
      matches: [12, 13].map((n) => finished(`m${n}`, ['a', 'b'], ['c', 'd'], 'A', 11, 1, n)),
    })
    // Veteran and Waiting have sat out 2 rounds since minute 0 -> forced, oldest first by position tie.
    expect(queueOrder(state).map((e) => e.player.id)).toEqual(['Veteran', 'Waiting', 'Rested', 'Fresh'])
  })

  it('records partners and opponents from in-progress and finished games', () => {
    const history = pairingHistory([finished('m1', ['A', 'B'], ['C', 'D'], 'A', 11, 2)])
    expect(history.partners.get(pairKey('B', 'A'))).toBe(1)
    expect(history.opponents.get(pairKey('A', 'D'))).toBe(1)
    expect(history.partners.get(pairKey('A', 'C'))).toBeUndefined()
  })
})
```

```ts
// src/lib/pickleball/open/propose.test.ts
import { describe, expect, it } from 'vitest'
import { fillProposals, proposeForCourt } from './propose'
import { pairingHistory, pairKey } from './fairness'
import { splitTeams } from './modes/paddleStack'
import { at, court, finished, player, sessionState } from './testing/fixtures'
import type { OpenSessionState, CommandContext, OpenMatch } from './types'

function ctxAt(minute: number): CommandContext {
  let n = 0
  return { now: at(minute), newId: () => `id-${minute}-${(n += 1)}` }
}

describe('splitTeams', () => {
  it('never re-pairs earlier partners when another split avoids it', () => {
    const history = pairingHistory([finished('m1', ['A', 'B'], ['C', 'D'], 'A', 11, 5)])
    const { teamA, teamB } = splitTeams(['A', 'B', 'C', 'D'], history)
    expect(teamA.join('') === 'AB' || teamB.join('') === 'AB').toBe(false)
    expect(teamA.join('') === 'CD' || teamB.join('') === 'CD').toBe(false)
  })
})

describe('proposeForCourt / fillProposals', () => {
  it('fills every free enabled court and leaves busy courts alone', () => {
    const state = sessionState({
      courts: [court('c1', 1), court('c2', 2), court('c3', 3, false)],
      players: Array.from({ length: 10 }, (_, i) => player(`p${i}`, { position: i })),
    })
    const next = fillProposals(state, ctxAt(1))
    expect(next.matches.map((m) => m.courtId)).toEqual(['c1', 'c2'])
    expect(new Set(next.matches.flatMap((m) => [...m.teamA, ...m.teamB])).size).toBe(8)
    expect(fillProposals(next, ctxAt(2)).matches).toHaveLength(2)
  })

  it('proposes nothing with fewer than 4 available players, or once the session ended', () => {
    const three = sessionState({ players: ['a', 'b', 'c'].map((id) => player(id)) })
    expect(proposeForCourt(three)).toBeNull()
    const ended = sessionState({ status: 'ENDED', players: ['a', 'b', 'c', 'd'].map((id) => player(id)) })
    expect(proposeForCourt(ended)).toBeNull()
  })

  it('skipping a proposal offers a different four when possible', () => {
    const state = sessionState({ players: ['a', 'b', 'c', 'd', 'e'].map((id, i) => player(id, { position: i })) })
    const first = proposeForCourt(state)!
    const four = [...first.teamA, ...first.teamB]
    const second = proposeForCourt(state, four)!
    expect([...second.teamA, ...second.teamB].sort()).not.toEqual([...four].sort())
  })

  it('never seats a player on break or who left', () => {
    const state = sessionState({
      players: [player('a'), player('b'), player('c'), player('d', { status: 'BREAK' }), player('e', { status: 'LEFT' }), player('f')],
    })
    const p = proposeForCourt(state)!
    expect([...p.teamA, ...p.teamB].sort()).toEqual(['a', 'b', 'c', 'f'])
  })
})

// Deterministic PRNG so a failure is reproducible.
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Plays synchronous rounds: every court starts, then every court finishes. */
function playRounds(players: number, courts: number, rounds: number, seed: number) {
  const random = mulberry32(seed)
  let state: OpenSessionState = sessionState({
    courts: Array.from({ length: courts }, (_, i) => court(`c${i}`, i + 1)),
    players: Array.from({ length: players }, (_, i) => player(`p${i}`, { position: i })),
  })
  let minute = 0
  let maxSatOut = 0
  for (let round = 0; round < rounds; round += 1) {
    minute += 1
    state = fillProposals(state, ctxAt(minute))
    const proposed = state.matches.filter((m) => m.status === 'PROPOSED')
    // Invariant: nobody is in two live matches.
    const seated = proposed.flatMap((m) => [...m.teamA, ...m.teamB])
    expect(new Set(seated).size).toBe(seated.length)
    minute += 1
    state = {
      ...state,
      matches: state.matches.map((m): OpenMatch => (m.status === 'PROPOSED'
        ? { ...m, status: 'IN_PROGRESS', startedAt: at(minute) }
        : m)),
    }
    // Measure sit-outs for everyone not playing, right after the round starts.
    const playing = new Set(state.matches.filter((m) => m.status === 'IN_PROGRESS').flatMap((m) => [...m.teamA, ...m.teamB]))
    minute += 10
    state = {
      ...state,
      matches: state.matches.map((m): OpenMatch => (m.status === 'IN_PROGRESS'
        ? { ...m, status: 'FINISHED', winner: random() < 0.5 ? 'A' : 'B', finishedAt: at(minute) }
        : m)),
      players: state.players.map((p) => (playing.has(p.id) ? { ...p, waitingSince: at(minute) } : p)),
    }
    for (const p of state.players) {
      if (playing.has(p.id)) continue
      const satOutRounds = state.matches.filter((m) => Date.parse(m.proposedAt) > Date.parse(p.waitingSince) && m.status !== 'PROPOSED').length / courts
      maxSatOut = Math.max(maxSatOut, Math.floor(satOutRounds))
    }
  }
  return { state, maxSatOut }
}

describe('paddle stack fairness (property)', () => {
  it.each([
    [5, 1], [12, 1], [14, 3], [20, 2], [24, 2], [40, 4], [96, 8],
  ])('with %i players on %i courts, games played never spread by more than 1 after each round', (players, courts) => {
    for (const seed of [1, 2, 3]) {
      const { state } = playRounds(players, courts, 30, seed)
      const games = state.players.map((p) => state.matches.filter((m) => m.status === 'FINISHED' && (m.teamA.includes(p.id) || m.teamB.includes(p.id))).length)
      expect(Math.max(...games) - Math.min(...games)).toBeLessThanOrEqual(1)
    }
  })

  it.each([[12, 1], [14, 3], [24, 2], [96, 8]])('with ≤ 12 players per court (%i on %i), nobody sits out more than 2 rounds in a row', (players, courts) => {
    for (const seed of [1, 2, 3]) {
      expect(playRounds(players, courts, 30, seed).maxSatOut).toBeLessThanOrEqual(2)
    }
  })

  it('partners repeat only when the four have no unused split left', () => {
    const { state } = playRounds(8, 2, 6, 7)
    const counts = new Map<string, number>()
    for (const m of state.matches) for (const team of [m.teamA, m.teamB]) counts.set(pairKey(team[0], team[1]), (counts.get(pairKey(team[0], team[1])) ?? 0) + 1)
    // 8 players have 28 possible partnerships; 6 rounds x 2 courts x 2 teams = 24 teams.
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(2)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/pickleball/open/fairness.test.ts src/lib/pickleball/open/propose.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement fairness**

```ts
// src/lib/pickleball/open/fairness.ts
import type { OpenMatch, OpenPlayer, OpenSessionState } from './types'

export const SIT_OUT_LIMIT = 2

export interface PartnerHistory {
  partners: ReadonlyMap<string, number>
  opponents: ReadonlyMap<string, number>
}

export interface QueueEntry {
  player: OpenPlayer
  games: number
  satOut: number
  forced: boolean
}

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

export function matchIncludes(match: OpenMatch, playerId: string): boolean {
  return match.teamA.includes(playerId) || match.teamB.includes(playerId)
}

export function gamesPlayed(player: OpenPlayer, matches: readonly OpenMatch[]): number {
  return player.gamesOffset + matches.filter((m) => m.status === 'FINISHED' && matchIncludes(m, player.id)).length
}

export function busyPlayerIds(matches: readonly OpenMatch[]): Set<string> {
  return new Set(
    matches
      .filter((m) => m.status === 'PROPOSED' || m.status === 'IN_PROGRESS')
      .flatMap((m) => [...m.teamA, ...m.teamB]),
  )
}

/** Rounds (started games per enabled court) the player has watched since they last became available. */
export function roundsSatOut(player: OpenPlayer, state: OpenSessionState): number {
  const courts = Math.max(1, state.courts.filter((c) => c.enabled).length)
  const since = Date.parse(player.waitingSince)
  const started = state.matches.filter(
    (m) => m.status !== 'PROPOSED' && Date.parse(m.proposedAt) > since && !matchIncludes(m, player.id),
  ).length
  return Math.floor(started / courts)
}

function bump(map: ReadonlyMap<string, number>, key: string): Map<string, number> {
  return new Map(map).set(key, (map.get(key) ?? 0) + 1)
}

export function pairingHistory(matches: readonly OpenMatch[]): PartnerHistory {
  return matches
    .filter((m) => m.status === 'IN_PROGRESS' || m.status === 'FINISHED')
    .reduce<PartnerHistory>((history, m) => {
      let partners = bump(bump(history.partners, pairKey(m.teamA[0], m.teamA[1])), pairKey(m.teamB[0], m.teamB[1]))
      let opponents = new Map(history.opponents)
      for (const a of m.teamA) for (const b of m.teamB) opponents = bump(opponents, pairKey(a, b))
      partners = new Map(partners)
      return { partners, opponents }
    }, { partners: new Map(), opponents: new Map() })
}

function byWait(a: QueueEntry, b: QueueEntry): number {
  return Date.parse(a.player.waitingSince) - Date.parse(b.player.waitingSince) || a.player.position - b.player.position
}

/** Available players in the order paddle stack would seat them. */
export function queueOrder(state: OpenSessionState): QueueEntry[] {
  const busy = busyPlayerIds(state.matches)
  return state.players
    .filter((p) => p.status === 'ACTIVE' && !busy.has(p.id))
    .map((p) => {
      const satOut = roundsSatOut(p, state)
      return { player: p, games: gamesPlayed(p, state.matches), satOut, forced: satOut >= SIT_OUT_LIMIT }
    })
    .sort((a, b) => {
      if (a.forced !== b.forced) return a.forced ? -1 : 1
      if (a.forced) return byWait(a, b)
      return a.games - b.games || byWait(a, b)
    })
}
```

- [ ] **Step 4: Implement paddle stack and propose**

```ts
// src/lib/pickleball/open/modes/paddleStack.ts
import { pairKey, type PartnerHistory, type QueueEntry } from '../fairness'
import type { Team } from '../types'

export interface Proposal {
  teamA: Team
  teamB: Team
}

const SPLITS: ReadonlyArray<readonly [number, number, number, number]> = [
  [0, 1, 2, 3],
  [0, 2, 1, 3],
  [0, 3, 1, 2],
]

/** Chooses the split of four with the fewest repeated partners, then opponents. */
export function splitTeams(four: readonly string[], history: PartnerHistory): Proposal {
  const scored = SPLITS.map(([a, b, c, d]) => {
    const teamA: Team = [four[a], four[b]]
    const teamB: Team = [four[c], four[d]]
    const partnerCost = (history.partners.get(pairKey(...teamA)) ?? 0) + (history.partners.get(pairKey(...teamB)) ?? 0)
    const opponentCost = teamA.reduce((sum, x) => sum + teamB.reduce((s, y) => s + (history.opponents.get(pairKey(x, y)) ?? 0), 0), 0)
    return { proposal: { teamA, teamB }, cost: partnerCost * 100 + opponentCost }
  })
  return scored.reduce((best, next) => (next.cost < best.cost ? next : best)).proposal
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|')
}

export function proposePaddleStack(
  queue: readonly QueueEntry[],
  history: PartnerHistory,
  exclude?: readonly string[],
): Proposal | null {
  if (queue.length < 4) return null
  const first = queue.slice(0, 4).map((entry) => entry.player.id)
  const four = exclude && queue.length > 4 && sameSet(first, exclude)
    ? [...first.slice(0, 3), queue[4].player.id]
    : first
  return splitTeams(four, history)
}
```

```ts
// src/lib/pickleball/open/propose.ts
import { pairingHistory, queueOrder } from './fairness'
import { proposePaddleStack, type Proposal } from './modes/paddleStack'
import { LIMITS, type CommandContext, type OpenSessionState } from './types'

export function proposeForCourt(state: OpenSessionState, exclude?: readonly string[]): Proposal | null {
  if (state.status !== 'ACTIVE' || state.matches.length >= LIMITS.maxMatches) return null
  const queue = queueOrder(state)
  const history = pairingHistory(state.matches)
  switch (state.settings.mode) {
    case 'PADDLE_STACK':
      return proposePaddleStack(queue, history, exclude)
    default:
      // Unreachable in Phase 1: the create schema only accepts PADDLE_STACK.
      throw new Error(`Stacking mode ${state.settings.mode} is not available yet.`)
  }
}

export function addProposal(state: OpenSessionState, courtId: string, proposal: Proposal, ctx: CommandContext): OpenSessionState {
  const seq = state.matches.reduce((max, m) => Math.max(max, m.seq), 0) + 1
  return {
    ...state,
    matches: [
      ...state.matches,
      {
        id: ctx.newId(), courtId, seq, status: 'PROPOSED', teamA: proposal.teamA, teamB: proposal.teamB,
        scoreA: null, scoreB: null, winner: null, proposedAt: ctx.now, startedAt: null, finishedAt: null,
      },
    ],
  }
}

function courtIsFree(state: OpenSessionState, courtId: string): boolean {
  return !state.matches.some((m) => m.courtId === courtId && (m.status === 'PROPOSED' || m.status === 'IN_PROGRESS'))
}

/** Proposes a match for every enabled court that has none (spec §5.2). */
export function fillProposals(state: OpenSessionState, ctx: CommandContext): OpenSessionState {
  return [...state.courts]
    .filter((c) => c.enabled)
    .sort((a, b) => a.position - b.position)
    .reduce((acc, court) => {
      if (!courtIsFree(acc, court.id)) return acc
      const proposal = proposeForCourt(acc)
      return proposal ? addProposal(acc, court.id, proposal, ctx) : acc
    }, state)
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/pickleball/open`
Expected: PASS. If the 96-on-8 sit-out case fails, check `roundsSatOut` before touching the test. Its measurement (started games after `waitingSince`, per enabled court) must match the test's own calculation exactly.

- [ ] **Step 6: Commit**

CHANGELOG `### Added`: `- Paddle-stack rotation for open play: fewest games first, longest wait next, forced in after two rounds out, partners split to avoid repeats.`

```bash
git add src/lib/pickleball/open CHANGELOG.md
git commit -m "feat(pickleball): paddle stack proposals with sit-out guard"
```

---

### Task 6: Commands, reducer and initial state

**Files:**
- Create: `src/lib/schemas/pickleball/open/commands.ts`, `src/lib/schemas/pickleball/open/createSession.ts`, `src/lib/pickleball/open/reducer.ts`, `src/lib/pickleball/open/create.ts`
- Test: `src/lib/pickleball/open/reducer.test.ts`, `src/lib/pickleball/open/create.test.ts`

**Interfaces:**
- Consumes: Tasks 2–5.
- Produces:
  - `commandSchema` and `commandEnvelopeSchema` (Zod), with `type OpenCommand = z.infer<typeof commandSchema>` and `type CommandEnvelope = z.infer<typeof commandEnvelopeSchema>`.
  - `createSessionSchema`, with `type CreateSessionBody`.
  - `applyCommand(state, command, ctx): CommandResult`, where `CommandResult = { ok: true; state } | { ok: false; status: 400 | 404 | 409; error: string }`.
  - `finalizeCommand(state, ctx): OpenSessionState`, which bumps the version, refreshes the expiry and fills proposals.
  - `buildInitialState(input: CreateSessionInput, ctx: CommandContext & { publicCode: string; sessionId: string }): OpenSessionState`.

- [ ] **Step 1: Write the schemas**

```ts
// src/lib/schemas/pickleball/open/commands.ts
import { z } from 'zod'

const id = z.string().min(1).max(64)
const side = z.enum(['A', 'B'])
const score = z.number().int().min(0).max(99).nullable()

export const commandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ADD_PLAYERS'), names: z.array(z.string().max(200)).min(1).max(128) }),
  z.object({ type: z.literal('SET_PLAYER_STATUS'), playerId: id, status: z.enum(['ACTIVE', 'BREAK', 'LEFT']) }),
  z.object({ type: z.literal('RENAME_PLAYER'), playerId: id, name: z.string().max(200) }),
  z.object({ type: z.literal('SET_COURT_ENABLED'), courtId: id, enabled: z.boolean() }),
  z.object({ type: z.literal('EDIT_PROPOSAL'), matchId: id, teamA: z.tuple([id, id]), teamB: z.tuple([id, id]) }),
  z.object({ type: z.literal('SKIP_PROPOSAL'), matchId: id }),
  z.object({ type: z.literal('START_MATCH'), matchId: id }),
  z.object({ type: z.literal('RECORD_RESULT'), matchId: id, winner: side, scoreA: score, scoreB: score }),
  z.object({ type: z.literal('UNDO_RESULT'), matchId: id }),
  z.object({ type: z.literal('EDIT_RESULT'), matchId: id, winner: side, scoreA: score, scoreB: score }),
  z.object({ type: z.literal('ABANDON_MATCH'), matchId: id }),
  z.object({ type: z.literal('END_SESSION') }),
])

export const commandEnvelopeSchema = z.object({
  idempotencyKey: z.string().min(8).max(64),
  command: commandSchema,
})

export type OpenCommand = z.infer<typeof commandSchema>
export type CommandEnvelope = z.infer<typeof commandEnvelopeSchema>
```

```ts
// src/lib/schemas/pickleball/open/createSession.ts
import { z } from 'zod'

export const createSessionSchema = z.object({
  name: z.string().trim().min(1).max(60),
  hostDisplayName: z.string().trim().min(1).max(40),
  location: z.string().trim().max(120).nullable().optional(),
  courtCount: z.number().int().min(1).max(16),
  settings: z.object({
    // Phase 1 ships paddle stack only (spec §14); later phases widen this literal.
    mode: z.literal('PADDLE_STACK'),
    target: z.union([z.literal(11), z.literal(15), z.literal(21)]),
    winBy2: z.boolean(),
    winnerOnly: z.boolean(),
    scoringStyle: z.enum(['SIDEOUT', 'RALLY']),
  }),
  players: z.array(z.object({
    name: z.string().max(200),
    skill: z.number().min(1).max(8).nullable().optional(),
    duprId: z.string().regex(/^[A-Za-z0-9]{6}$/).nullable().optional(),
  })).max(128),
  turnstileToken: z.string().max(2048).optional(),
})

export type CreateSessionBody = z.infer<typeof createSessionSchema>
```

- [ ] **Step 2: Write the failing tests**

```ts
// src/lib/pickleball/open/create.test.ts
import { describe, expect, it } from 'vitest'
import { buildInitialState } from './create'
import { DEFAULT_SETTINGS } from './types'

const ctx = () => {
  let n = 0
  return { now: '2026-10-11T10:00:00.000Z', newId: () => `id${(n += 1)}`, publicCode: 'ABCDE23456', sessionId: 's1' }
}

describe('buildInitialState', () => {
  it('creates labelled courts, cleaned unique players, first proposals and a 7-day expiry', () => {
    const state = buildInitialState({
      name: 'Sunday', hostDisplayName: 'Mike', location: null, courtCount: 2, settings: DEFAULT_SETTINGS,
      players: ['1. Ana', 'Ben', 'ben', 'Carlo', 'Dina', 'Eli', 'Fay', 'Gio', 'Hana', 'Ivan'].map((name) => ({ name, skill: null, duprId: null })),
    }, ctx())
    expect(state.courts.map((c) => c.label)).toEqual(['Court 1', 'Court 2'])
    expect(state.players.map((p) => p.name)).toEqual(['Ana', 'Ben', 'Carlo', 'Dina', 'Eli', 'Fay', 'Gio', 'Hana', 'Ivan'])
    expect(state.matches.filter((m) => m.status === 'PROPOSED')).toHaveLength(2)
    expect(state.expiresAt).toBe('2026-10-18T10:00:00.000Z')
    expect(state.version).toBe(1)
  })

  it('caps players at 128', () => {
    const players = Array.from({ length: 140 }, (_, i) => ({ name: `P${i}`, skill: null, duprId: null }))
    const state = buildInitialState({ name: 'x', hostDisplayName: 'y', location: null, courtCount: 1, settings: DEFAULT_SETTINGS, players }, ctx())
    expect(state.players).toHaveLength(128)
  })
})
```

```ts
// src/lib/pickleball/open/reducer.test.ts
import { describe, expect, it } from 'vitest'
import { applyCommand, finalizeCommand } from './reducer'
import { fillProposals } from './propose'
import { at, court, player, sessionState } from './testing/fixtures'
import type { CommandContext, OpenSessionState } from './types'

function ctxAt(minute: number): CommandContext {
  let n = 0
  return { now: at(minute), newId: () => `n${minute}-${(n += 1)}` }
}

function ready(): OpenSessionState {
  const base = sessionState({
    courts: [court('c1', 1), court('c2', 2)],
    players: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'].map((id, i) => player(id, { position: i })),
  })
  return fillProposals(base, ctxAt(0))
}

function must(result: ReturnType<typeof applyCommand>): OpenSessionState {
  if (!result.ok) throw new Error(result.error)
  return result.state
}

const proposedOn = (state: OpenSessionState, courtId: string) =>
  state.matches.find((m) => m.courtId === courtId && m.status === 'PROPOSED')!

describe('applyCommand', () => {
  it('records a result from a proposed match (host forgot Start) and frees the court', () => {
    const state = ready()
    const match = proposedOn(state, 'c1')
    const next = must(applyCommand(state, { type: 'RECORD_RESULT', matchId: match.id, winner: 'A', scoreA: 11, scoreB: 7 }, ctxAt(12)))
    const saved = next.matches.find((m) => m.id === match.id)!
    expect(saved).toMatchObject({ status: 'FINISHED', scoreA: 11, scoreB: 7, winner: 'A', startedAt: at(12), finishedAt: at(12) })
    const finalized = finalizeCommand(next, ctxAt(12))
    expect(finalized.matches.filter((m) => m.courtId === 'c1' && m.status === 'PROPOSED')).toHaveLength(1)
    expect(finalized.version).toBe(state.version + 1)
  })

  it('refuses a second save of the same game (409), so it is never counted twice', () => {
    const state = ready()
    const match = proposedOn(state, 'c1')
    const once = must(applyCommand(state, { type: 'RECORD_RESULT', matchId: match.id, winner: 'A', scoreA: 11, scoreB: 7 }, ctxAt(12)))
    const twice = applyCommand(once, { type: 'RECORD_RESULT', matchId: match.id, winner: 'B', scoreA: 5, scoreB: 11 }, ctxAt(13))
    expect(twice).toMatchObject({ ok: false, status: 409 })
  })

  it('rejects an impossible score (400)', () => {
    const state = ready()
    const match = proposedOn(state, 'c1')
    expect(applyCommand(state, { type: 'RECORD_RESULT', matchId: match.id, winner: 'A', scoreA: 11, scoreB: 10 }, ctxAt(5))).toMatchObject({ ok: false, status: 400 })
  })

  it('undo within 2 minutes reopens the game and drops the court\'s next proposal', () => {
    const state = ready()
    const match = proposedOn(state, 'c1')
    const saved = finalizeCommand(must(applyCommand(state, { type: 'RECORD_RESULT', matchId: match.id, winner: 'A', scoreA: 11, scoreB: 7 }, ctxAt(12))), ctxAt(12))
    const undone = must(applyCommand(saved, { type: 'UNDO_RESULT', matchId: match.id }, ctxAt(13)))
    expect(undone.matches.find((m) => m.id === match.id)).toMatchObject({ status: 'IN_PROGRESS', scoreA: null, winner: null, finishedAt: null })
    expect(undone.matches.filter((m) => m.courtId === 'c1' && m.status === 'PROPOSED')).toHaveLength(0)
  })

  it('undo after 2 minutes is refused with a pointer to edit', () => {
    const state = ready()
    const match = proposedOn(state, 'c1')
    const saved = must(applyCommand(state, { type: 'RECORD_RESULT', matchId: match.id, winner: 'A', scoreA: 11, scoreB: 7 }, ctxAt(12)))
    expect(applyCommand(saved, { type: 'UNDO_RESULT', matchId: match.id }, ctxAt(15))).toMatchObject({ ok: false, status: 409 })
  })

  it('editing a finished result changes the score in place', () => {
    const state = ready()
    const match = proposedOn(state, 'c1')
    const saved = must(applyCommand(state, { type: 'RECORD_RESULT', matchId: match.id, winner: 'A', scoreA: 11, scoreB: 7 }, ctxAt(12)))
    const edited = must(applyCommand(saved, { type: 'EDIT_RESULT', matchId: match.id, winner: 'B', scoreA: 9, scoreB: 11 }, ctxAt(40)))
    expect(edited.matches.find((m) => m.id === match.id)).toMatchObject({ status: 'FINISHED', winner: 'B', scoreA: 9, scoreB: 11 })
  })

  it('putting a proposed player on break drops that proposal; a playing player cannot go on break', () => {
    const state = ready()
    const match = proposedOn(state, 'c1')
    const onBreak = must(applyCommand(state, { type: 'SET_PLAYER_STATUS', playerId: match.teamA[0], status: 'BREAK' }, ctxAt(1)))
    expect(onBreak.matches.find((m) => m.id === match.id)).toBeUndefined()
    const refilled = finalizeCommand(onBreak, ctxAt(1))
    const seated = refilled.matches.filter((m) => m.status === 'PROPOSED').flatMap((m) => [...m.teamA, ...m.teamB])
    expect(seated).not.toContain(match.teamA[0])

    const started = must(applyCommand(state, { type: 'START_MATCH', matchId: match.id }, ctxAt(1)))
    expect(applyCommand(started, { type: 'SET_PLAYER_STATUS', playerId: match.teamA[0], status: 'BREAK' }, ctxAt(2))).toMatchObject({ ok: false, status: 409 })
  })

  it('edit proposal: swaps in an available player and refuses a busy or unknown one', () => {
    const state = ready()
    const c1 = proposedOn(state, 'c1')
    const c2 = proposedOn(state, 'c2')
    const idle = state.players.find((p) => ![...c1.teamA, ...c1.teamB, ...c2.teamA, ...c2.teamB].includes(p.id))!
    const edited = must(applyCommand(state, { type: 'EDIT_PROPOSAL', matchId: c1.id, teamA: [idle.id, c1.teamA[1]], teamB: c1.teamB as [string, string] }, ctxAt(1)))
    expect(edited.matches.find((m) => m.id === c1.id)!.teamA[0]).toBe(idle.id)
    expect(applyCommand(state, { type: 'EDIT_PROPOSAL', matchId: c1.id, teamA: [c2.teamA[0], c1.teamA[1]], teamB: c1.teamB as [string, string] }, ctxAt(1))).toMatchObject({ ok: false, status: 409 })
    expect(applyCommand(state, { type: 'EDIT_PROPOSAL', matchId: c1.id, teamA: ['ghost', c1.teamA[1]], teamB: c1.teamB as [string, string] }, ctxAt(1))).toMatchObject({ ok: false, status: 404 })
    expect(applyCommand(state, { type: 'EDIT_PROPOSAL', matchId: c1.id, teamA: [c1.teamA[1], c1.teamA[1]], teamB: c1.teamB as [string, string] }, ctxAt(1))).toMatchObject({ ok: false, status: 400 })
  })

  it('skip proposal re-proposes a different four on the same court', () => {
    const state = ready()
    const c1 = proposedOn(state, 'c1')
    const skipped = must(applyCommand(state, { type: 'SKIP_PROPOSAL', matchId: c1.id }, ctxAt(1)))
    const replacement = proposedOn(skipped, 'c1')
    expect(replacement.id).not.toBe(c1.id)
    expect([...replacement.teamA, ...replacement.teamB].sort()).not.toEqual([...c1.teamA, ...c1.teamB].sort())
  })

  it('late arrivals start level with the least-played active player', () => {
    let state = ready()
    const c1 = proposedOn(state, 'c1')
    state = finalizeCommand(must(applyCommand(state, { type: 'RECORD_RESULT', matchId: c1.id, winner: 'A', scoreA: 11, scoreB: 3 }, ctxAt(10))), ctxAt(10))
    const c2 = proposedOn(state, 'c2')
    state = finalizeCommand(must(applyCommand(state, { type: 'RECORD_RESULT', matchId: c2.id, winner: 'A', scoreA: 11, scoreB: 3 }, ctxAt(11))), ctxAt(11))
    const added = must(applyCommand(state, { type: 'ADD_PLAYERS', names: ['Late', 'a'] }, ctxAt(12)))
    const late = added.players.find((p) => p.name === 'Late')!
    expect(late.gamesOffset).toBe(0) // player 'i' has still played 0, so the minimum is 0
    expect(added.players.filter((p) => p.name === 'a')).toHaveLength(1) // duplicate ignored
  })

  it('caps the roster at 128 players', () => {
    const full = sessionState({ players: Array.from({ length: 128 }, (_, i) => player(`p${i}`, { name: `P${i}` })) })
    expect(applyCommand(full, { type: 'ADD_PLAYERS', names: ['One more'] }, ctxAt(1))).toMatchObject({ ok: false, status: 409 })
  })

  it('disabling a court with a game in progress is refused; with a proposal, the proposal goes', () => {
    const state = ready()
    const c1 = proposedOn(state, 'c1')
    const off = must(applyCommand(state, { type: 'SET_COURT_ENABLED', courtId: 'c1', enabled: false }, ctxAt(1)))
    expect(off.matches.find((m) => m.id === c1.id)).toBeUndefined()
    const started = must(applyCommand(state, { type: 'START_MATCH', matchId: c1.id }, ctxAt(1)))
    expect(applyCommand(started, { type: 'SET_COURT_ENABLED', courtId: 'c1', enabled: false }, ctxAt(2))).toMatchObject({ ok: false, status: 409 })
  })

  it('ending the session removes proposals but keeps games in progress recordable', () => {
    const state = ready()
    const c1 = proposedOn(state, 'c1')
    const started = must(applyCommand(state, { type: 'START_MATCH', matchId: c1.id }, ctxAt(1)))
    const ended = finalizeCommand(must(applyCommand(started, { type: 'END_SESSION' }, ctxAt(2))), ctxAt(2))
    expect(ended.status).toBe('ENDED')
    expect(ended.matches.filter((m) => m.status === 'PROPOSED')).toHaveLength(0)
    expect(applyCommand(ended, { type: 'RECORD_RESULT', matchId: c1.id, winner: 'B', scoreA: 4, scoreB: 11 }, ctxAt(9)).ok).toBe(true)
  })

  it('returns 404 for an unknown match or player', () => {
    const state = ready()
    expect(applyCommand(state, { type: 'START_MATCH', matchId: 'nope' }, ctxAt(1))).toMatchObject({ ok: false, status: 404 })
    expect(applyCommand(state, { type: 'RENAME_PLAYER', playerId: 'nope', name: 'x' }, ctxAt(1))).toMatchObject({ ok: false, status: 404 })
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/lib/pickleball/open/reducer.test.ts src/lib/pickleball/open/create.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 4: Implement the reducer**

```ts
// src/lib/pickleball/open/reducer.ts
import type { OpenCommand } from '../../schemas/pickleball/open/commands'
import { busyPlayerIds, gamesPlayed, matchIncludes } from './fairness'
import { addProposal, fillProposals, proposeForCourt } from './propose'
import { cleanName } from './roster'
import { validateResult } from './scoreValidation'
import { addMs, LIMITS, type CommandContext, type OpenMatch, type OpenPlayer, type OpenSessionState, type Team } from './types'

type Failure = { ok: false; status: 400 | 404 | 409; error: string }
export type CommandResult = { ok: true; state: OpenSessionState } | Failure

const fail = (status: Failure['status'], error: string): Failure => ({ ok: false, status, error })
const ok = (state: OpenSessionState): CommandResult => ({ ok: true, state })

function withMatch(state: OpenSessionState, match: OpenMatch): OpenSessionState {
  return { ...state, matches: state.matches.map((m) => (m.id === match.id ? match : m)) }
}

function withoutMatches(state: OpenSessionState, drop: (m: OpenMatch) => boolean): OpenSessionState {
  return { ...state, matches: state.matches.filter((m) => !drop(m)) }
}

function withPlayers(state: OpenSessionState, ids: ReadonlySet<string>, patch: Partial<OpenPlayer>): OpenSessionState {
  return { ...state, players: state.players.map((p) => (ids.has(p.id) ? { ...p, ...patch } : p)) }
}

function minActiveGames(state: OpenSessionState): number {
  const games = state.players.filter((p) => p.status !== 'LEFT').map((p) => gamesPlayed(p, state.matches))
  return games.length ? Math.min(...games) : 0
}

function nameTaken(state: OpenSessionState, name: string, exceptId?: string): boolean {
  const key = name.toLocaleLowerCase()
  return state.players.some((p) => p.id !== exceptId && p.name.toLocaleLowerCase() === key)
}

function addPlayers(state: OpenSessionState, rawNames: readonly string[], ctx: CommandContext): CommandResult {
  const offset = minActiveGames(state)
  let next = state
  let position = state.players.reduce((max, p) => Math.max(max, p.position), 0) + 1
  for (const name of rawNames.map(cleanName).filter(Boolean)) {
    const existing = next.players.find((p) => p.name.toLocaleLowerCase() === name.toLocaleLowerCase())
    if (existing) {
      if (existing.status !== 'ACTIVE') next = withPlayers(next, new Set([existing.id]), { status: 'ACTIVE', waitingSince: ctx.now })
      continue
    }
    if (next.players.length >= LIMITS.maxPlayers) return fail(409, `A session can have at most ${LIMITS.maxPlayers} players.`)
    const added: OpenPlayer = {
      id: ctx.newId(), name, skill: null, duprId: null, status: 'ACTIVE',
      gamesOffset: offset, joinedAt: ctx.now, waitingSince: ctx.now, position,
    }
    position += 1
    next = { ...next, players: [...next.players, added] }
  }
  return ok(next)
}

function setPlayerStatus(state: OpenSessionState, playerId: string, status: OpenPlayer['status'], ctx: CommandContext): CommandResult {
  const target = state.players.find((p) => p.id === playerId)
  if (!target) return fail(404, 'Player not found.')
  if (target.status === status) return ok(state)
  const playing = state.matches.some((m) => m.status === 'IN_PROGRESS' && matchIncludes(m, playerId))
  if (status !== 'ACTIVE' && playing) return fail(409, `${target.name} is playing. Finish or abandon their game first.`)
  const cleared = status === 'ACTIVE' ? state : withoutMatches(state, (m) => m.status === 'PROPOSED' && matchIncludes(m, playerId))
  const patch: Partial<OpenPlayer> = status === 'ACTIVE' ? { status, waitingSince: ctx.now } : { status }
  return ok(withPlayers(cleared, new Set([playerId]), patch))
}

function editProposal(state: OpenSessionState, matchId: string, teamA: Team, teamB: Team): CommandResult {
  const match = state.matches.find((m) => m.id === matchId)
  if (!match) return fail(404, 'Game not found.')
  if (match.status !== 'PROPOSED') return fail(409, 'Only a game that has not started can be edited.')
  const ids = [...teamA, ...teamB]
  if (new Set(ids).size !== 4) return fail(400, 'Pick four different players.')
  const busyElsewhere = busyPlayerIds(state.matches.filter((m) => m.id !== matchId))
  for (const id of ids) {
    const p = state.players.find((x) => x.id === id)
    if (!p) return fail(404, 'Player not found.')
    if (p.status !== 'ACTIVE') return fail(409, `${p.name} is not available.`)
    if (busyElsewhere.has(id)) return fail(409, `${p.name} is already on another court.`)
  }
  return ok(withMatch(state, { ...match, teamA, teamB }))
}

function recordResult(state: OpenSessionState, command: Extract<OpenCommand, { type: 'RECORD_RESULT' | 'EDIT_RESULT' }>, ctx: CommandContext): CommandResult {
  const match = state.matches.find((m) => m.id === command.matchId)
  if (!match) return fail(404, 'Game not found.')
  const editing = command.type === 'EDIT_RESULT'
  if (editing && match.status !== 'FINISHED') return fail(409, 'Only a saved result can be edited.')
  if (!editing && match.status === 'FINISHED') return fail(409, 'This game was already saved.')
  if (!editing && match.status !== 'PROPOSED' && match.status !== 'IN_PROGRESS') return fail(409, 'This game cannot be saved.')
  const check = validateResult({ winner: command.winner, scoreA: command.scoreA, scoreB: command.scoreB }, state.settings)
  if (!check.ok) return fail(400, check.reason)
  const saved: OpenMatch = {
    ...match, status: 'FINISHED', winner: command.winner, scoreA: command.scoreA, scoreB: command.scoreB,
    startedAt: match.startedAt ?? ctx.now, finishedAt: editing ? match.finishedAt : ctx.now,
  }
  const next = withMatch(state, saved)
  return ok(editing ? next : withPlayers(next, new Set([...match.teamA, ...match.teamB]), { waitingSince: ctx.now }))
}

function undoResult(state: OpenSessionState, matchId: string, ctx: CommandContext): CommandResult {
  const match = state.matches.find((m) => m.id === matchId)
  if (!match) return fail(404, 'Game not found.')
  if (match.status !== 'FINISHED' || !match.finishedAt) return fail(409, 'Only a saved result can be undone.')
  if (Date.parse(ctx.now) - Date.parse(match.finishedAt) > LIMITS.undoWindowMs) {
    return fail(409, 'The 2-minute undo has passed. Edit the result instead.')
  }
  const ids = [...match.teamA, ...match.teamB]
  const nowPlaying = state.matches.find((m) => m.id !== matchId && m.status === 'IN_PROGRESS' && ids.some((id) => matchIncludes(m, id)))
  if (nowPlaying) return fail(409, 'Someone from that game is already playing again. Edit the result instead.')
  const cleared = withoutMatches(state, (m) => m.status === 'PROPOSED' && (m.courtId === match.courtId || ids.some((id) => matchIncludes(m, id))))
  return ok(withMatch(cleared, { ...match, status: 'IN_PROGRESS', winner: null, scoreA: null, scoreB: null, finishedAt: null }))
}

export function applyCommand(state: OpenSessionState, command: OpenCommand, ctx: CommandContext): CommandResult {
  const ended = state.status === 'ENDED'
  switch (command.type) {
    case 'ADD_PLAYERS':
      return addPlayers(state, command.names, ctx)
    case 'SET_PLAYER_STATUS':
      return setPlayerStatus(state, command.playerId, command.status, ctx)
    case 'RENAME_PLAYER': {
      const target = state.players.find((p) => p.id === command.playerId)
      if (!target) return fail(404, 'Player not found.')
      const name = cleanName(command.name)
      if (!name) return fail(400, 'Enter a name.')
      if (nameTaken(state, name, target.id)) return fail(409, `${name} is already in this session.`)
      return ok(withPlayers(state, new Set([target.id]), { name }))
    }
    case 'SET_COURT_ENABLED': {
      const target = state.courts.find((c) => c.id === command.courtId)
      if (!target) return fail(404, 'Court not found.')
      const live = state.matches.some((m) => m.courtId === target.id && m.status === 'IN_PROGRESS')
      if (!command.enabled && live) return fail(409, `${target.label} has a game in progress.`)
      const cleared = command.enabled ? state : withoutMatches(state, (m) => m.courtId === target.id && m.status === 'PROPOSED')
      return ok({ ...cleared, courts: cleared.courts.map((c) => (c.id === target.id ? { ...c, enabled: command.enabled } : c)) })
    }
    case 'EDIT_PROPOSAL':
      if (ended) return fail(409, 'This session has ended.')
      return editProposal(state, command.matchId, command.teamA, command.teamB)
    case 'SKIP_PROPOSAL': {
      if (ended) return fail(409, 'This session has ended.')
      const match = state.matches.find((m) => m.id === command.matchId)
      if (!match) return fail(404, 'Game not found.')
      if (match.status !== 'PROPOSED') return fail(409, 'Only a game that has not started can be skipped.')
      const cleared = withoutMatches(state, (m) => m.id === match.id)
      const replacement = proposeForCourt(cleared, [...match.teamA, ...match.teamB])
      return ok(replacement ? addProposal(cleared, match.courtId, replacement, ctx) : cleared)
    }
    case 'START_MATCH': {
      if (ended) return fail(409, 'This session has ended.')
      const match = state.matches.find((m) => m.id === command.matchId)
      if (!match) return fail(404, 'Game not found.')
      if (match.status !== 'PROPOSED') return fail(409, 'This game has already started.')
      return ok(withMatch(state, { ...match, status: 'IN_PROGRESS', startedAt: ctx.now }))
    }
    case 'RECORD_RESULT':
    case 'EDIT_RESULT':
      return recordResult(state, command, ctx)
    case 'UNDO_RESULT':
      return undoResult(state, command.matchId, ctx)
    case 'ABANDON_MATCH': {
      const match = state.matches.find((m) => m.id === command.matchId)
      if (!match) return fail(404, 'Game not found.')
      if (match.status !== 'IN_PROGRESS') return fail(409, 'Only a game in progress can be abandoned.')
      const next = withMatch(state, { ...match, status: 'ABANDONED', finishedAt: ctx.now })
      return ok(withPlayers(next, new Set([...match.teamA, ...match.teamB]), { waitingSince: ctx.now }))
    }
    case 'END_SESSION':
      return ok({ ...withoutMatches(state, (m) => m.status === 'PROPOSED'), status: 'ENDED' })
  }
}

/** Every successful command: bump version, push expiry out 7 days, fill free courts. */
export function finalizeCommand(state: OpenSessionState, ctx: CommandContext): OpenSessionState {
  const touched: OpenSessionState = {
    ...state,
    version: state.version + 1,
    lastActivityAt: ctx.now,
    expiresAt: addMs(ctx.now, LIMITS.retentionMs),
  }
  return fillProposals(touched, ctx)
}
```

- [ ] **Step 5: Implement the initial state**

```ts
// src/lib/pickleball/open/create.ts
import { fillProposals } from './propose'
import { cleanName, type RosterEntry } from './roster'
import { addMs, LIMITS, type CommandContext, type OpenPlayer, type OpenSessionState, type SessionSettings } from './types'

export interface CreateSessionInput {
  name: string
  hostDisplayName: string
  location: string | null
  courtCount: number
  settings: SessionSettings
  players: readonly RosterEntry[]
}

function uniquePlayers(entries: readonly RosterEntry[], ctx: CommandContext): OpenPlayer[] {
  const seen = new Set<string>()
  return entries.reduce<OpenPlayer[]>((acc, entry) => {
    const name = cleanName(entry.name)
    const key = name.toLocaleLowerCase()
    if (!name || seen.has(key) || acc.length >= LIMITS.maxPlayers) return acc
    seen.add(key)
    return [...acc, {
      id: ctx.newId(), name, skill: entry.skill ?? null, duprId: entry.duprId ? entry.duprId.toUpperCase() : null,
      status: 'ACTIVE', gamesOffset: 0, joinedAt: ctx.now, waitingSince: ctx.now, position: acc.length + 1,
    }]
  }, [])
}

export function buildInitialState(
  input: CreateSessionInput,
  ctx: CommandContext & { publicCode: string; sessionId: string },
): OpenSessionState {
  const courtCount = Math.min(Math.max(1, Math.trunc(input.courtCount)), LIMITS.maxCourts)
  const state: OpenSessionState = {
    id: ctx.sessionId,
    publicCode: ctx.publicCode,
    kind: 'OPEN_PLAY',
    name: input.name.trim(),
    hostDisplayName: input.hostDisplayName.trim(),
    location: input.location?.trim() || null,
    status: 'ACTIVE',
    settings: input.settings,
    players: uniquePlayers(input.players, ctx),
    courts: Array.from({ length: courtCount }, (_, i) => ({ id: ctx.newId(), label: `Court ${i + 1}`, position: i + 1, enabled: true })),
    matches: [],
    version: 1,
    createdAt: ctx.now,
    lastActivityAt: ctx.now,
    expiresAt: addMs(ctx.now, LIMITS.retentionMs),
  }
  return fillProposals(state, ctx)
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/lib/pickleball/open && npm run typecheck`
Expected: PASS. Typecheck clean for the new files.

- [ ] **Step 7: Commit**

CHANGELOG `### Added`: `- The open play command set: add players, breaks, courts on/off, edit or skip a proposed game, start, save, undo (2 minutes), edit and abandon a result, and end the session.`

```bash
git add src/lib/pickleball/open src/lib/schemas/pickleball/open CHANGELOG.md
git commit -m "feat(pickleball): open play command reducer and initial session state"
```

---

### Task 7: Snapshots, state diff, results CSV

**Files:**
- Create: `src/lib/pickleball/open/snapshot.ts`, `src/lib/pickleball/open/diff.ts`, `src/lib/pickleball/open/resultsCsv.ts`
- Test: `src/lib/pickleball/open/snapshot.test.ts`, `src/lib/pickleball/open/diff.test.ts`, `src/lib/pickleball/open/resultsCsv.test.ts`

**Interfaces:**
- Consumes: Tasks 2–6.
- Produces:
  - `ViewerSnapshot`, `ViewerCourt`, `HostSnapshot`, `HostPlayer`, `HostCourt`.
  - `toViewerSnapshot(state): ViewerSnapshot`, `toHostSnapshot(state): HostSnapshot`.
  - `interface StateDiff { sessionChanged; upsertPlayers; upsertCourts; upsertMatches; deleteMatchIds }`, `diffState(prev, next): StateDiff`.
  - `resultsCsv(state): string`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/pickleball/open/snapshot.test.ts
import { describe, expect, it } from 'vitest'
import { toHostSnapshot, toViewerSnapshot } from './snapshot'
import { fillProposals } from './propose'
import { at, court, finished, player, sessionState } from './testing/fixtures'

function state() {
  const base = sessionState({
    courts: [court('c1', 1), court('c2', 2), court('c3', 3, false)],
    players: ['a', 'b', 'c', 'd', 'e'].map((id, i) => player(id, { position: i, skill: 4, duprId: 'AB12C3' })),
    matches: [finished('m0', ['a', 'b'], ['c', 'd'], 'A', 11, 4, 1)],
  })
  return fillProposals(base, { now: at(20), newId: () => 'p1' })
}

describe('toViewerSnapshot', () => {
  it('never exposes skill, DUPR IDs, the session id or the host key hash', () => {
    const json = JSON.stringify(toViewerSnapshot(state()))
    expect(json).not.toContain('AB12C3')
    expect(json).not.toContain('skill')
    expect(json).not.toContain('"s1"')
    expect(json).not.toMatch(/hash|hostKey/i)
  })

  it('shows names on up-next courts, waiting-for-players and off courts', () => {
    const viewer = toViewerSnapshot(state())
    expect(viewer.courts.map((c) => c.state)).toEqual(['UP_NEXT', 'WAITING_FOR_PLAYERS', 'OFF'])
    expect(viewer.courts[0].teamA).toHaveLength(2)
    expect(viewer.waiting.map((w) => w.name)).toHaveLength(1)
    expect(viewer.recentResults[0]).toMatchObject({ scoreA: 11, scoreB: 4, winner: 'A' })
  })
})

describe('toHostSnapshot', () => {
  it('includes match ids per court and per-player games', () => {
    const host = toHostSnapshot(state())
    expect(host.courts[0].match?.status).toBe('PROPOSED')
    expect(host.players.find((p) => p.id === 'a')).toMatchObject({ games: 1, busy: expect.any(Boolean) })
  })
})
```

```ts
// src/lib/pickleball/open/diff.test.ts
import { describe, expect, it } from 'vitest'
import { diffState } from './diff'
import { court, finished, player, sessionState } from './testing/fixtures'

describe('diffState', () => {
  it('lists only changed rows and deleted matches', () => {
    const prev = sessionState({ players: [player('a'), player('b')], courts: [court('c1', 1)], matches: [finished('m1', ['a', 'b'], ['c', 'd'], 'A', 11, 2)] })
    const next = { ...prev, version: 2, players: [prev.players[0], { ...prev.players[1], name: 'Bea' }], matches: [] }
    const diff = diffState(prev, next)
    expect(diff.sessionChanged).toBe(true)
    expect(diff.upsertPlayers.map((p) => p.name)).toEqual(['Bea'])
    expect(diff.upsertCourts).toEqual([])
    expect(diff.deleteMatchIds).toEqual(['m1'])
  })
})
```

```ts
// src/lib/pickleball/open/resultsCsv.test.ts
import { describe, expect, it } from 'vitest'
import { resultsCsv } from './resultsCsv'
import { finished, player, sessionState } from './testing/fixtures'

describe('resultsCsv', () => {
  it('writes games then standings, quoting and neutralising formula-like names', () => {
    const state = sessionState({
      players: [player('a', { name: '=HYPERLINK("x")' }), player('b', { name: 'Ben, Jr.' }), player('c'), player('d')],
      matches: [finished('m1', ['a', 'b'], ['c', 'd'], 'A', 11, 7, 1)],
    })
    const csv = resultsCsv(state)
    const lines = csv.split('\r\n')
    expect(lines[0]).toBe('Game,Court,Started,Finished,Team A,Team B,Score A,Score B,Winner')
    expect(csv).toContain(`"'=HYPERLINK(""x"") & Ben, Jr."`)
    expect(csv).toContain('Rank,Player,Played,Won,Lost,Win %,+/- per game,Points per game')
    expect(csv).toContain(',11,7,A')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/pickleball/open/snapshot.test.ts src/lib/pickleball/open/diff.test.ts src/lib/pickleball/open/resultsCsv.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/lib/pickleball/open/snapshot.ts
// The viewer snapshot is an ALLOWLIST (spec §7): it is built field by field,
// never by spreading state, so a new column can never leak to the public
// board by accident.
import { busyPlayerIds, gamesPlayed, queueOrder, roundsSatOut } from './fairness'
import { computeStandings, type StandingRow } from './standings'
import type { OpenMatch, OpenSessionState, Side } from './types'

export interface ViewerCourt {
  id: string
  label: string
  state: 'PLAYING' | 'UP_NEXT' | 'WAITING_FOR_PLAYERS' | 'OFF'
  teamA: string[]
  teamB: string[]
  startedAt: string | null
}

export interface ViewerSnapshot {
  code: string
  name: string
  hostDisplayName: string
  status: 'ACTIVE' | 'ENDED'
  expiresAt: string
  settings: { target: number; winBy2: boolean; winnerOnly: boolean; mode: string }
  version: number
  courts: ViewerCourt[]
  waiting: Array<{ id: string; name: string }>
  onBreak: Array<{ id: string; name: string }>
  roster: Array<{ id: string; name: string }>
  standings: StandingRow[]
  recentResults: Array<{ matchId: string; courtLabel: string; teamA: string[]; teamB: string[]; scoreA: number | null; scoreB: number | null; winner: Side; finishedAt: string }>
}

export interface HostPlayer {
  id: string
  name: string
  status: 'ACTIVE' | 'BREAK' | 'LEFT'
  games: number
  satOut: number
  busy: boolean
  skill: number | null
  duprId: string | null
}

export interface HostCourt {
  id: string
  label: string
  position: number
  enabled: boolean
  match: OpenMatch | null
}

export interface HostSnapshot {
  viewer: ViewerSnapshot
  players: HostPlayer[]
  courts: HostCourt[]
  finished: OpenMatch[]
  settings: OpenSessionState['settings']
}

function namesOf(state: OpenSessionState, ids: readonly string[]): string[] {
  return ids.map((id) => state.players.find((p) => p.id === id)?.name ?? '—')
}

function liveMatch(state: OpenSessionState, courtId: string): OpenMatch | null {
  return state.matches.find((m) => m.courtId === courtId && m.status === 'IN_PROGRESS')
    ?? state.matches.find((m) => m.courtId === courtId && m.status === 'PROPOSED')
    ?? null
}

export function toViewerSnapshot(state: OpenSessionState): ViewerSnapshot {
  const courts = [...state.courts].sort((a, b) => a.position - b.position)
  return {
    code: state.publicCode,
    name: state.name,
    hostDisplayName: state.hostDisplayName,
    status: state.status,
    expiresAt: state.expiresAt,
    settings: { target: state.settings.target, winBy2: state.settings.winBy2, winnerOnly: state.settings.winnerOnly, mode: state.settings.mode },
    version: state.version,
    courts: courts.map((c) => {
      const match = c.enabled ? liveMatch(state, c.id) : null
      const courtState: ViewerCourt['state'] = !c.enabled ? 'OFF' : !match ? 'WAITING_FOR_PLAYERS' : match.status === 'IN_PROGRESS' ? 'PLAYING' : 'UP_NEXT'
      return {
        id: c.id, label: c.label, state: courtState,
        teamA: match ? namesOf(state, match.teamA) : [], teamB: match ? namesOf(state, match.teamB) : [],
        startedAt: match?.startedAt ?? null,
      }
    }),
    waiting: queueOrder(state).map((e) => ({ id: e.player.id, name: e.player.name })),
    onBreak: state.players.filter((p) => p.status === 'BREAK').map((p) => ({ id: p.id, name: p.name })),
    roster: state.players.filter((p) => p.status !== 'LEFT').map((p) => ({ id: p.id, name: p.name })),
    standings: computeStandings(state.players, state.matches),
    recentResults: state.matches
      .filter((m): m is OpenMatch & { winner: Side; finishedAt: string } => m.status === 'FINISHED' && m.winner !== null && m.finishedAt !== null)
      .sort((a, b) => Date.parse(b.finishedAt) - Date.parse(a.finishedAt) || b.seq - a.seq)
      .slice(0, 10)
      .map((m) => ({
        matchId: m.id, courtLabel: state.courts.find((c) => c.id === m.courtId)?.label ?? '',
        teamA: namesOf(state, m.teamA), teamB: namesOf(state, m.teamB),
        scoreA: m.scoreA, scoreB: m.scoreB, winner: m.winner, finishedAt: m.finishedAt,
      })),
  }
}

export function toHostSnapshot(state: OpenSessionState): HostSnapshot {
  const busy = busyPlayerIds(state.matches)
  return {
    viewer: toViewerSnapshot(state),
    players: state.players.map((p) => ({
      id: p.id, name: p.name, status: p.status, games: gamesPlayed(p, state.matches),
      satOut: roundsSatOut(p, state), busy: busy.has(p.id), skill: p.skill, duprId: p.duprId,
    })),
    courts: [...state.courts].sort((a, b) => a.position - b.position).map((c) => ({
      id: c.id, label: c.label, position: c.position, enabled: c.enabled, match: c.enabled ? liveMatch(state, c.id) : null,
    })),
    finished: state.matches.filter((m) => m.status === 'FINISHED').sort((a, b) => b.seq - a.seq),
    settings: state.settings,
  }
}
```

```ts
// src/lib/pickleball/open/diff.ts
import type { OpenCourt, OpenMatch, OpenPlayer, OpenSessionState } from './types'

export interface StateDiff {
  sessionChanged: boolean
  upsertPlayers: OpenPlayer[]
  upsertCourts: OpenCourt[]
  upsertMatches: OpenMatch[]
  deleteMatchIds: string[]
}

function changed<T extends { id: string }>(prev: readonly T[], next: readonly T[]): T[] {
  const before = new Map(prev.map((row) => [row.id, JSON.stringify(row)]))
  return next.filter((row) => before.get(row.id) !== JSON.stringify(row))
}

const SESSION_FIELDS = ['name', 'hostDisplayName', 'location', 'status', 'settings', 'version', 'lastActivityAt', 'expiresAt'] as const

export function diffState(prev: OpenSessionState, next: OpenSessionState): StateDiff {
  const nextMatchIds = new Set(next.matches.map((m) => m.id))
  return {
    sessionChanged: SESSION_FIELDS.some((field) => JSON.stringify(prev[field]) !== JSON.stringify(next[field])),
    upsertPlayers: changed(prev.players, next.players),
    upsertCourts: changed(prev.courts, next.courts),
    upsertMatches: changed(prev.matches, next.matches),
    deleteMatchIds: prev.matches.filter((m) => !nextMatchIds.has(m.id)).map((m) => m.id),
  }
}
```

```ts
// src/lib/pickleball/open/resultsCsv.ts
import { computeStandings } from './standings'
import type { OpenSessionState } from './types'

// A cell opening with = + - @ is executed as a formula by Excel and Sheets.
// Player names are user input, so text cells are prefixed with ' to defuse that.
function text(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value
  return /[",\r\n]/.test(safe) || safe !== value ? `"${safe.replace(/"/g, '""')}"` : safe
}

function num(value: number | null, digits = 0): string {
  return value === null ? '' : value.toFixed(digits)
}

export function resultsCsv(state: OpenSessionState): string {
  const name = (id: string) => state.players.find((p) => p.id === id)?.name ?? ''
  const court = (id: string) => state.courts.find((c) => c.id === id)?.label ?? ''
  const games = state.matches
    .filter((m) => m.status === 'FINISHED')
    .sort((a, b) => a.seq - b.seq)
    .map((m, i) => [
      String(i + 1), text(court(m.courtId)), m.startedAt ?? '', m.finishedAt ?? '',
      text(m.teamA.map(name).join(' & ')), text(m.teamB.map(name).join(' & ')),
      num(m.scoreA), num(m.scoreB), m.winner ?? '',
    ].join(','))
  const standings = computeStandings(state.players, state.matches).map((row) => [
    row.rank === null ? '' : String(row.rank), text(row.name), String(row.played), String(row.wins), String(row.losses),
    row.winRate === null ? '' : (row.winRate * 100).toFixed(0), num(row.avgDiff, 1), num(row.avgFor, 1),
  ].join(','))
  return [
    'Game,Court,Started,Finished,Team A,Team B,Score A,Score B,Winner',
    ...games,
    '',
    'Rank,Player,Played,Won,Lost,Win %,+/- per game,Points per game',
    ...standings,
  ].join('\r\n')
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/pickleball/open`
Expected: PASS.

- [ ] **Step 5: Commit**

CHANGELOG `### Added`: `- Public board snapshot built from an allowlist (no skill or DUPR data), a host snapshot, and a results CSV that defuses formula-like names.`

```bash
git add src/lib/pickleball/open CHANGELOG.md
git commit -m "feat(pickleball): viewer and host snapshots, state diff and results csv"
```

---

### Task 8: Repository (D1)

**Files:**
- Create: `src/worker/repositories/pickleball/open/openSessions.ts`
- Test: `src/worker/repositories/pickleball/open/openSessions.test.ts`

**Interfaces:**
- Consumes: `diffState` (Task 7), the types and the test adapter (Task 1).
- Produces:
  - `createOpenSession(db, state, hostKeyHash): Promise<void>`
  - `loadOpenSession(db, code, nowIso): Promise<{ state: OpenSessionState; hostKeyHash: string } | null>`
  - `persistDiff(db, prev, next, idempotency: { key; responseJson; now; cutoff } | null): Promise<void>`
  - `findIdempotentResponse(db, sessionId, key): Promise<string | null>`
  - `deleteOpenSession(db, sessionId): Promise<void>`
  - `purgeExpiredOpenSessions(db, nowIso, limit?): Promise<string[]>`, which returns the purged public codes.

- [ ] **Step 1: Write the failing test**

```ts
// src/worker/repositories/pickleball/open/openSessions.test.ts
import { describe, expect, it } from 'vitest'
import { createSqliteD1 } from './testing/sqliteD1'
import { createOpenSession, deleteOpenSession, findIdempotentResponse, loadOpenSession, persistDiff, purgeExpiredOpenSessions } from './openSessions'
import { buildInitialState } from '../../../../lib/pickleball/open/create'
import { applyCommand, finalizeCommand } from '../../../../lib/pickleball/open/reducer'
import { DEFAULT_SETTINGS } from '../../../../lib/pickleball/open/types'

const MIGRATION = 'migrations/pickleball/0016_open_sessions.sql'
const NOW = '2026-10-11T10:00:00.000Z'

function fresh(code = 'ABCDE23456') {
  let n = 0
  return buildInitialState({
    name: 'Sunday', hostDisplayName: 'Mike', location: null, courtCount: 2, settings: DEFAULT_SETTINGS,
    players: ['Ana', 'Ben', 'Carlo', 'Dina', 'Eli', 'Fay', 'Gio', 'Hana', 'Ivan'].map((name) => ({ name, skill: null, duprId: null })),
  }, { now: NOW, newId: () => `${code}-${(n += 1)}`, publicCode: code, sessionId: `sess-${code}` })
}

describe('open sessions repository', () => {
  it('round-trips a created session exactly', async () => {
    const { d1 } = createSqliteD1([MIGRATION])
    const state = fresh()
    await createOpenSession(d1, state, 'hash')
    const loaded = await loadOpenSession(d1, 'ABCDE23456', NOW)
    expect(loaded?.hostKeyHash).toBe('hash')
    expect(loaded?.state).toEqual(state)
  })

  it('persists only the diff, and a reload equals the in-memory state', async () => {
    const { d1 } = createSqliteD1([MIGRATION])
    const state = fresh()
    await createOpenSession(d1, state, 'hash')
    const match = state.matches[0]
    const ctx = { now: '2026-10-11T10:15:00.000Z', newId: () => 'new-proposal' }
    const result = applyCommand(state, { type: 'RECORD_RESULT', matchId: match.id, winner: 'A', scoreA: 11, scoreB: 6 }, ctx)
    if (!result.ok) throw new Error(result.error)
    const next = finalizeCommand(result.state, ctx)
    await persistDiff(d1, state, next, { key: 'idem-12345', responseJson: '{"ok":1}', now: ctx.now, cutoff: NOW })
    expect((await loadOpenSession(d1, 'ABCDE23456', ctx.now))?.state).toEqual(next)
    expect(await findIdempotentResponse(d1, state.id, 'idem-12345')).toBe('{"ok":1}')
  })

  it('treats an expired session as not found even before the purge runs', async () => {
    const { d1 } = createSqliteD1([MIGRATION])
    await createOpenSession(d1, fresh(), 'hash')
    expect(await loadOpenSession(d1, 'ABCDE23456', '2026-10-18T10:00:00.001Z')).toBeNull()
  })

  it('purges only expired sessions, with all their rows', async () => {
    const { d1, raw } = createSqliteD1([MIGRATION])
    await createOpenSession(d1, fresh('AAAAA22222'), 'h1')
    await createOpenSession(d1, { ...fresh('BBBBB33333'), expiresAt: '2026-12-01T00:00:00.000Z' }, 'h2')
    const purged = await purgeExpiredOpenSessions(d1, '2026-10-19T00:00:00.000Z')
    expect(purged).toEqual(['AAAAA22222'])
    const left = raw.prepare('SELECT COUNT(*) AS n FROM open_players').get() as { n: number }
    expect(left.n).toBe(9)
  })

  it('deletes a session and everything under it', async () => {
    const { d1, raw } = createSqliteD1([MIGRATION])
    const state = fresh()
    await createOpenSession(d1, state, 'hash')
    await deleteOpenSession(d1, state.id)
    expect((raw.prepare('SELECT COUNT(*) AS n FROM open_matches').get() as { n: number }).n).toBe(0)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/worker/repositories/pickleball/open/openSessions.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// src/worker/repositories/pickleball/open/openSessions.ts
// Every SQL statement for free open play lives here (repository pattern).
// Writes are always one db.batch() -- D1 batches are transactional, so a
// command is either fully stored or not stored at all.
import { diffState } from '../../../../lib/pickleball/open/diff'
import type { OpenCourt, OpenMatch, OpenPlayer, OpenSessionState, Team } from '../../../../lib/pickleball/open/types'

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
  started_at: string | null; finished_at: string | null
}

const UPSERT_PLAYER = `INSERT INTO open_players (id, session_id, name, skill, dupr_id, status, games_offset, joined_at, waiting_since, position)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET name = excluded.name, skill = excluded.skill, dupr_id = excluded.dupr_id, status = excluded.status,
    games_offset = excluded.games_offset, waiting_since = excluded.waiting_since, position = excluded.position`
const UPSERT_COURT = `INSERT INTO open_courts (id, session_id, label, position, enabled) VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET label = excluded.label, position = excluded.position, enabled = excluded.enabled`
const UPSERT_MATCH = `INSERT INTO open_matches (id, session_id, court_id, seq, status, team_a_json, team_b_json, score_a, score_b, winner, fixture_id, proposed_at, started_at, finished_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET status = excluded.status, team_a_json = excluded.team_a_json, team_b_json = excluded.team_b_json,
    score_a = excluded.score_a, score_b = excluded.score_b, winner = excluded.winner, started_at = excluded.started_at, finished_at = excluded.finished_at`

function playerStatement(db: D1Database, sessionId: string, p: OpenPlayer): D1PreparedStatement {
  return db.prepare(UPSERT_PLAYER).bind(p.id, sessionId, p.name, p.skill, p.duprId, p.status, p.gamesOffset, p.joinedAt, p.waitingSince, p.position)
}
function courtStatement(db: D1Database, sessionId: string, c: OpenCourt): D1PreparedStatement {
  return db.prepare(UPSERT_COURT).bind(c.id, sessionId, c.label, c.position, c.enabled ? 1 : 0)
}
function matchStatement(db: D1Database, sessionId: string, m: OpenMatch): D1PreparedStatement {
  return db.prepare(UPSERT_MATCH).bind(
    m.id, sessionId, m.courtId, m.seq, m.status, JSON.stringify(m.teamA), JSON.stringify(m.teamB),
    m.scoreA, m.scoreB, m.winner, m.proposedAt, m.startedAt, m.finishedAt,
  )
}
function sessionUpdate(db: D1Database, s: OpenSessionState): D1PreparedStatement {
  return db.prepare(`UPDATE open_sessions SET name = ?, host_display_name = ?, location = ?, settings_json = ?, status = ?,
      version = ?, last_activity_at = ?, expires_at = ? WHERE id = ?`)
    .bind(s.name, s.hostDisplayName, s.location, JSON.stringify(s.settings), s.status, s.version, s.lastActivityAt, s.expiresAt, s.id)
}

export async function createOpenSession(db: D1Database, state: OpenSessionState, hostKeyHash: string): Promise<void> {
  await db.batch([
    db.prepare(`INSERT INTO open_sessions (id, public_code, host_key_hash, kind, name, host_display_name, location, settings_json, status, version, created_at, last_activity_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(state.id, state.publicCode, hostKeyHash, state.kind, state.name, state.hostDisplayName, state.location,
        JSON.stringify(state.settings), state.status, state.version, state.createdAt, state.lastActivityAt, state.expiresAt),
    ...state.courts.map((c) => courtStatement(db, state.id, c)),
    ...state.players.map((p) => playerStatement(db, state.id, p)),
    ...state.matches.map((m) => matchStatement(db, state.id, m)),
  ])
}

export async function loadOpenSession(
  db: D1Database, code: string, nowIso: string,
): Promise<{ state: OpenSessionState; hostKeyHash: string } | null> {
  const session = await db.prepare('SELECT * FROM open_sessions WHERE public_code = ? AND expires_at > ?').bind(code, nowIso).first<SessionRow>()
  if (!session) return null
  const [players, courts, matches] = await Promise.all([
    db.prepare('SELECT * FROM open_players WHERE session_id = ? ORDER BY position').bind(session.id).all<PlayerRow>(),
    db.prepare('SELECT * FROM open_courts WHERE session_id = ? ORDER BY position').bind(session.id).all<CourtRow>(),
    db.prepare('SELECT * FROM open_matches WHERE session_id = ? ORDER BY seq').bind(session.id).all<MatchRow>(),
  ])
  return {
    hostKeyHash: session.host_key_hash,
    state: {
      id: session.id, publicCode: session.public_code, kind: session.kind, name: session.name,
      hostDisplayName: session.host_display_name, location: session.location, status: session.status,
      settings: JSON.parse(session.settings_json), version: session.version, createdAt: session.created_at,
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
        startedAt: m.started_at, finishedAt: m.finished_at,
      })),
    },
  }
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

export async function purgeExpiredOpenSessions(db: D1Database, nowIso: string, limit = 500): Promise<string[]> {
  const expired = await db.prepare('SELECT id, public_code FROM open_sessions WHERE expires_at < ? LIMIT ?').bind(nowIso, limit).all<{ id: string; public_code: string }>()
  if (!expired.results.length) return []
  await db.batch(expired.results.map((row) => db.prepare('DELETE FROM open_sessions WHERE id = ?').bind(row.id)))
  return expired.results.map((row) => row.public_code)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/worker/repositories/pickleball/open && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

CHANGELOG `### Added`: `- D1 repository for open sessions: transactional create, diff-only writes, idempotency records, expiry-aware load and purge.`

```bash
git add src/worker/repositories/pickleball/open CHANGELOG.md
git commit -m "feat(pickleball): d1 repository for open sessions"
```

---

### Task 9: `OpenSessionDO` and wiring

**Files:**
- Create: `src/worker/pickleball/open/OpenSessionDO.ts`
- Modify:
  - `src/worker.ts`: import and export `OpenSessionDO`.
  - `wrangler.jsonc`: top-level and `env.preview` `durable_objects.bindings` and `migrations`.
  - `src/env.d.ts`: the `OPEN_SESSION` binding.

**Interfaces:**
- Consumes: Tasks 2, 6, 7 and 8, plus `sha256Base64Url` from `src/lib/pickleball/webCrypto.js`.
- Produces (DO RPC, called from routes via `env.OPEN_SESSION.get(env.OPEN_SESSION.idFromName(code))`):
  - `viewer(code): Promise<ViewerSnapshot | null>`
  - `host(code, hostKey): Promise<DoResult<HostSnapshot>>`
  - `command(code, hostKey, envelope: unknown): Promise<DoResult<{ version: number; host: HostSnapshot }>>`
  - `results(code, hostKey): Promise<DoResult<{ csv: string; filename: string }>>`
  - `remove(code, hostKey): Promise<DoResult<{ deleted: true }>>`
  - `evict(): Promise<void>`
  - `fetch(request)` for the WebSocket upgrade, reading the header `X-Open-Code`.
  - Shapes: `type DoResult<T> = { status: number; body: T | { error: string } }`.
  - Socket messages out: `{ type: 'VIEWER', payload }`, `{ type: 'HOST', payload }`, `{ type: 'AUTH_FAILED' }`. In: `{ type: 'AUTH', hostKey }`, `{ type: 'RESYNC' }`.
  - Close code `4404` means the session is gone.

- [ ] **Step 1: Implement the DO**

```ts
// src/worker/pickleball/open/OpenSessionDO.ts
//
// One instance per open session, addressed by idFromName(publicCode). D1 is
// the source of truth (spec §3.2); this object serializes commands, keeps
// the session in memory between them, writes only the rows a command
// changed, and broadcasts to hibernating sockets. Memory is updated only
// AFTER the D1 batch succeeds, so a failed write leaves nothing half-applied.
import { DurableObject } from 'cloudflare:workers'
import { commandEnvelopeSchema } from '../../../lib/schemas/pickleball/open/commands'
import { applyCommand, finalizeCommand } from '../../../lib/pickleball/open/reducer'
import { resultsCsv } from '../../../lib/pickleball/open/resultsCsv'
import { constantTimeEqual } from '../../../lib/pickleball/open/secrets'
import { toHostSnapshot, toViewerSnapshot, type HostSnapshot, type ViewerSnapshot } from '../../../lib/pickleball/open/snapshot'
import type { OpenSessionState } from '../../../lib/pickleball/open/types'
import { sha256Base64Url } from '../../../lib/pickleball/webCrypto.js'
import {
  deleteOpenSession, findIdempotentResponse, loadOpenSession, persistDiff,
} from '../../repositories/pickleball/open/openSessions'

export type DoResult<T> = { status: number; body: T | { error: string } }
type Loaded = { state: OpenSessionState; hostKeyHash: string }
type Attachment = { code: string; role: 'viewer' | 'host' }

const IDEMPOTENCY_TTL_MS = 10 * 60_000
const GONE = 4404

export class OpenSessionDO extends DurableObject<Env> {
  private loaded: Loaded | null = null
  private chain: Promise<unknown> = Promise.resolve()

  /** Runs fn after every earlier call has settled: one command at a time, even across awaits. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn)
    this.chain = run.catch(() => undefined)
    return run
  }

  private async load(code: string): Promise<Loaded | null> {
    const now = new Date().toISOString()
    if (this.loaded && this.loaded.state.publicCode === code && this.loaded.state.expiresAt > now) return this.loaded
    this.loaded = await loadOpenSession(this.env.PICKLEBALL_DB, code, now)
    return this.loaded
  }

  private async isHost(loaded: Loaded, hostKey: string | null): Promise<boolean> {
    if (!hostKey) return false
    return constantTimeEqual(await sha256Base64Url(hostKey), loaded.hostKeyHash)
  }

  private async authorized(code: string, hostKey: string | null): Promise<Loaded | DoResult<never>> {
    const loaded = await this.load(code)
    if (!loaded) return { status: 404, body: { error: 'Session not found.' } }
    if (!(await this.isHost(loaded, hostKey))) return { status: 403, body: { error: 'Only the host can do that.' } }
    return loaded
  }

  async viewer(code: string): Promise<ViewerSnapshot | null> {
    return this.serial(async () => {
      const loaded = await this.load(code)
      return loaded ? toViewerSnapshot(loaded.state) : null
    })
  }

  async host(code: string, hostKey: string | null): Promise<DoResult<HostSnapshot>> {
    return this.serial(async () => {
      const auth = await this.authorized(code, hostKey)
      return 'state' in auth ? { status: 200, body: toHostSnapshot(auth.state) } : auth
    })
  }

  async command(code: string, hostKey: string | null, envelope: unknown): Promise<DoResult<{ version: number; host: HostSnapshot }>> {
    return this.serial(async () => {
      const parsed = commandEnvelopeSchema.safeParse(envelope)
      if (!parsed.success) return { status: 400, body: { error: 'That request was not understood.' } }
      const auth = await this.authorized(code, hostKey)
      if (!('state' in auth)) return auth
      const db = this.env.PICKLEBALL_DB
      const prior = await findIdempotentResponse(db, auth.state.id, parsed.data.idempotencyKey)
      if (prior) return JSON.parse(prior) as DoResult<{ version: number; host: HostSnapshot }>

      const now = new Date().toISOString()
      const ctx = { now, newId: () => crypto.randomUUID() }
      const result = applyCommand(auth.state, parsed.data.command, ctx)
      if (!result.ok) return { status: result.status, body: { error: result.error } }

      const next = finalizeCommand(result.state, ctx)
      const response: DoResult<{ version: number; host: HostSnapshot }> = { status: 200, body: { version: next.version, host: toHostSnapshot(next) } }
      await persistDiff(db, auth.state, next, {
        key: parsed.data.idempotencyKey,
        responseJson: JSON.stringify(response),
        now,
        cutoff: new Date(Date.parse(now) - IDEMPOTENCY_TTL_MS).toISOString(),
      })
      this.loaded = { ...auth, state: next }
      this.broadcast()
      return response
    })
  }

  async results(code: string, hostKey: string | null): Promise<DoResult<{ csv: string; filename: string }>> {
    return this.serial(async () => {
      const auth = await this.authorized(code, hostKey)
      if (!('state' in auth)) return auth
      const slug = auth.state.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'session'
      return { status: 200, body: { csv: resultsCsv(auth.state), filename: `${slug}-${auth.state.createdAt.slice(0, 10)}-results.csv` } }
    })
  }

  async remove(code: string, hostKey: string | null): Promise<DoResult<{ deleted: true }>> {
    return this.serial(async () => {
      const auth = await this.authorized(code, hostKey)
      if (!('state' in auth)) return auth
      await deleteOpenSession(this.env.PICKLEBALL_DB, auth.state.id)
      this.closeAll()
      return { status: 200, body: { deleted: true } }
    })
  }

  /** Called by the purge cron after it deleted this session's rows. */
  async evict(): Promise<void> {
    this.closeAll()
  }

  private closeAll(): void {
    this.loaded = null
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.close(GONE, 'Session ended')
      } catch {
        // already closing
      }
    }
  }

  private broadcast(): void {
    if (!this.loaded) return
    const viewer = JSON.stringify({ type: 'VIEWER', payload: toViewerSnapshot(this.loaded.state) })
    const host = JSON.stringify({ type: 'HOST', payload: toHostSnapshot(this.loaded.state) })
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment() as Attachment | null
      try {
        ws.send(attachment?.role === 'host' ? host : viewer)
      } catch {
        // a socket mid-close; it is dropped by the runtime
      }
    }
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket upgrade.', { status: 400 })
    const code = request.headers.get('X-Open-Code') ?? ''
    if (!this.ctx.id.equals(this.env.OPEN_SESSION.idFromName(code))) return new Response('Coordinator mismatch.', { status: 400 })
    const snapshot = await this.viewer(code)
    if (!snapshot) return new Response('Session not found.', { status: 404 })

    const [client, server] = Object.values(new WebSocketPair())
    this.ctx.acceptWebSocket(server)
    server.serializeAttachment({ code, role: 'viewer' } satisfies Attachment)
    server.send(JSON.stringify({ type: 'VIEWER', payload: snapshot }))
    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): Promise<void> {
    let parsed: { type?: string; hostKey?: unknown }
    try {
      parsed = JSON.parse(String(message))
    } catch {
      return
    }
    const attachment = ws.deserializeAttachment() as Attachment | null
    if (!attachment) return

    if (parsed.type === 'AUTH' && typeof parsed.hostKey === 'string') {
      const result = await this.host(attachment.code, parsed.hostKey)
      if (result.status === 200) {
        ws.serializeAttachment({ code: attachment.code, role: 'host' } satisfies Attachment)
        ws.send(JSON.stringify({ type: 'HOST', payload: result.body }))
      } else {
        ws.send(JSON.stringify({ type: 'AUTH_FAILED' }))
      }
      return
    }

    if (parsed.type === 'RESYNC') {
      if (attachment.role === 'host') {
        const loaded = await this.serial(() => this.load(attachment.code))
        if (loaded) ws.send(JSON.stringify({ type: 'HOST', payload: toHostSnapshot(loaded.state) }))
      } else {
        const snapshot = await this.viewer(attachment.code)
        if (snapshot) ws.send(JSON.stringify({ type: 'VIEWER', payload: snapshot }))
      }
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    // 1005/1006 are reserved and cannot be echoed back; anything else is.
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, reason)
    } catch {
      // already closed
    }
  }
}
```

- [ ] **Step 2: Wire it up**

In `src/worker.ts`, add the import beside the other DO imports and export it:

```ts
import { OpenSessionDO } from './worker/pickleball/open/OpenSessionDO'
// …
export { SessionCoordinatorDO, RateLimiterDO, OpenSessionDO }
```

In `wrangler.jsonc`, in **both** the top-level block and `env.preview`, add the binding next to `SESSION_COORDINATOR`:

```jsonc
          { "name": "OPEN_SESSION", "class_name": "OpenSessionDO" }
```

Then, in **both** `migrations` arrays, append:

```jsonc
    { "tag": "v3", "new_sqlite_classes": ["OpenSessionDO"] }
```

In `src/env.d.ts`, add after `RATE_LIMITER`:

```ts
  OPEN_SESSION: DurableObjectNamespace<import('./worker/pickleball/open/OpenSessionDO').OpenSessionDO>
```

- [ ] **Step 3: Verify it compiles and boots**

Run: `npm run typecheck && npm run build`
Expected: both succeed.

Run: `npx wrangler dev --port 8787 --local`, then `curl http://localhost:8787/api/health`, then stop the server.
Expected: health returns 200, and the wrangler output lists the `OPEN_SESSION` binding. The DO's behaviour is covered end to end by Task 10's API tests.

- [ ] **Step 4: Commit**

CHANGELOG `### Added`: `- OpenSessionDO: one coordinator per open session that serializes commands, writes only changed rows, and pushes live updates to every connected screen.`

```bash
git add src/worker/pickleball/open/OpenSessionDO.ts src/worker.ts wrangler.jsonc src/env.d.ts CHANGELOG.md
git commit -m "feat(pickleball): open session durable object"
```

---

### Task 10: API routes, middleware and abuse controls

**Files:**
- Create:
  - `src/worker/pickleball/open/routeHelpers.ts`
  - `src/pages/api/pickleball/open/sessions.ts`
  - `src/pages/api/pickleball/open/s/[code]/state.ts`, `host.ts`, `commands.ts`, `results.csv.ts`, `session.ts`
  - `src/pages/pickleball/rt/open/[code].ts`
- Modify:
  - `src/middleware.ts`: exempt `/api/pickleball/open/`.
  - `src/components/islands/useTurnstile.js`: add an `action` parameter.
- Test: `tests/e2e/pickleball/open-play.spec.js` (API section).

**Interfaces:**
- Consumes: the Task 9 DO RPC methods, plus `checkRateLimit`, `clientIp`, `rateLimitedResponse`, `verifyTurnstileToken`, `jsonResponse`, `apiErrorResponse`, `randomBase64Url`, `sha256Base64Url`, `getEnv`.
- Produces the HTTP contract:
  - `POST /api/pickleball/open/sessions` takes a `CreateSessionBody` and returns `201 { code, hostKey }`.
  - `GET /api/pickleball/open/s/:code/state` returns a `ViewerSnapshot`.
  - `GET /api/pickleball/open/s/:code/host` (with `X-Host-Key`) returns a `HostSnapshot`.
  - `POST /api/pickleball/open/s/:code/commands` (with `X-Host-Key`) takes a `CommandEnvelope` and returns `{ version, host }`.
  - `GET /api/pickleball/open/s/:code/results.csv` (with `X-Host-Key`) returns `text/csv`.
  - `DELETE /api/pickleball/open/s/:code/session` (with `X-Host-Key`) returns `{ deleted: true }`.
  - `GET /pickleball/rt/open/:code` is the WebSocket.

- [ ] **Step 1: Write the failing API tests**

```js
// tests/e2e/pickleball/open-play.spec.js
import { test, expect } from '@playwright/test'

const ROSTER = ['Ana', 'Ben', 'Carlo', 'Dina', 'Eli', 'Fay', 'Gio', 'Hana', 'Ivan']

export async function createSession(request, overrides = {}) {
  const response = await request.post('/api/pickleball/open/sessions', {
    data: {
      name: 'Sunday Open Play',
      hostDisplayName: 'Coach Mike',
      courtCount: 2,
      settings: { mode: 'PADDLE_STACK', target: 11, winBy2: true, winnerOnly: false, scoringStyle: 'SIDEOUT' },
      players: ROSTER.map((name) => ({ name })),
      ...overrides,
    },
  })
  expect(response.status()).toBe(201)
  return response.json()
}

function command(request, code, hostKey, cmd, idempotencyKey = crypto.randomUUID()) {
  return request.post(`/api/pickleball/open/s/${code}/commands`, {
    headers: { 'X-Host-Key': hostKey },
    data: { idempotencyKey, command: cmd },
  })
}

test.describe('open play API', () => {
  test('create, then the public board shows proposals and nothing private', async ({ request }) => {
    const { code, hostKey } = await createSession(request)
    expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{10}$/)
    expect(hostKey.length).toBeGreaterThanOrEqual(20)

    const state = await (await request.get(`/api/pickleball/open/s/${code}/state`)).json()
    expect(state.courts.map((c) => c.state)).toEqual(['UP_NEXT', 'UP_NEXT'])
    expect(JSON.stringify(state)).not.toMatch(/hostKey|host_key|hash/i)
  })

  test('commands need the host key', async ({ request }) => {
    const { code } = await createSession(request)
    const denied = await command(request, code, 'wrong-key-wrong-key', { type: 'END_SESSION' })
    expect(denied.status()).toBe(403)
    const missing = await request.get(`/api/pickleball/open/s/${code}/host`)
    expect(missing.status()).toBe(403)
  })

  test('a game is saved once: replay returns the same answer, a second save is 409', async ({ request }) => {
    const { code, hostKey } = await createSession(request)
    const host = await (await request.get(`/api/pickleball/open/s/${code}/host`, { headers: { 'X-Host-Key': hostKey } })).json()
    const match = host.courts[0].match
    const save = { type: 'RECORD_RESULT', matchId: match.id, winner: 'A', scoreA: 11, scoreB: 7 }

    const first = await command(request, code, hostKey, save, 'same-key-123456')
    expect(first.status()).toBe(200)
    const replay = await command(request, code, hostKey, save, 'same-key-123456')
    expect(replay.status()).toBe(200)
    expect((await replay.json()).version).toBe((await first.json()).version)

    const again = await command(request, code, hostKey, save)
    expect(again.status()).toBe(409)

    const state = await (await request.get(`/api/pickleball/open/s/${code}/state`)).json()
    expect(state.recentResults).toHaveLength(1)
    expect(state.standings[0]).toMatchObject({ wins: 1, losses: 0 })
  })

  test('an impossible score is refused with a reason', async ({ request }) => {
    const { code, hostKey } = await createSession(request)
    const host = await (await request.get(`/api/pickleball/open/s/${code}/host`, { headers: { 'X-Host-Key': hostKey } })).json()
    const response = await command(request, code, hostKey, { type: 'RECORD_RESULT', matchId: host.courts[0].match.id, winner: 'A', scoreA: 11, scoreB: 10 })
    expect(response.status()).toBe(400)
    expect((await response.json()).error).toContain('win by 2')
  })

  test('results download as CSV, and delete removes the session for everyone', async ({ request }) => {
    const { code, hostKey } = await createSession(request)
    const csv = await request.get(`/api/pickleball/open/s/${code}/results.csv`, { headers: { 'X-Host-Key': hostKey } })
    expect(csv.status()).toBe(200)
    expect(csv.headers()['content-type']).toContain('text/csv')
    expect(await csv.text()).toContain('Rank,Player')

    const removed = await request.delete(`/api/pickleball/open/s/${code}/session`, { headers: { 'X-Host-Key': hostKey } })
    expect(removed.status()).toBe(200)
    expect((await request.get(`/api/pickleball/open/s/${code}/state`)).status()).toBe(404)
  })

  test('bad input is a 400, an unknown code a 404', async ({ request }) => {
    const bad = await request.post('/api/pickleball/open/sessions', { data: { name: '', courtCount: 99 } })
    expect(bad.status()).toBe(400)
    expect((await request.get('/api/pickleball/open/s/ZZZZZ22222/state')).status()).toBe(404)
    expect((await request.get('/api/pickleball/open/s/not-a-code/state')).status()).toBe(404)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx playwright test tests/e2e/pickleball/open-play.spec.js --project=worker`
Expected: FAIL (the creation POST returns 403 from the middleware or 404).

- [ ] **Step 3: Add the shared route helpers**

```ts
// src/worker/pickleball/open/routeHelpers.ts
import { normalizePublicCode } from '../../../lib/pickleball/open/codes'
import { jsonResponse } from '../../utils/responses.js'
import type { DoResult } from './OpenSessionDO'

export function openSessionStub(env: Env, code: string) {
  return env.OPEN_SESSION.get(env.OPEN_SESSION.idFromName(code))
}

export function codeFrom(params: Record<string, string | undefined>): string | null {
  return normalizePublicCode(params.code ?? '')
}

export function hostKeyFrom(request: Request): string | null {
  const key = request.headers.get('X-Host-Key')
  return key && key.length <= 128 ? key : null
}

export function doResponse<T>(result: DoResult<T>): Response {
  return jsonResponse(result.body, result.status)
}

export const notFound = (): Response => jsonResponse({ error: 'Session not found.' }, 404)
```

- [ ] **Step 4: Add the routes**

```ts
// src/pages/api/pickleball/open/sessions.ts
import type { APIRoute } from 'astro'
import { getEnv } from '../../../../lib/env'
import { OPEN_SESSION_TURNSTILE_ACTION } from '../../../../lib/pickleball/open/constants'
import { generatePublicCode } from '../../../../lib/pickleball/open/codes'
import { buildInitialState } from '../../../../lib/pickleball/open/create'
import { createSessionSchema } from '../../../../lib/schemas/pickleball/open/createSession'
import { randomBase64Url, sha256Base64Url } from '../../../../lib/pickleball/webCrypto.js'
import { createOpenSession } from '../../../../worker/repositories/pickleball/open/openSessions'
import { checkRateLimit, clientIp, rateLimitedResponse } from '../../../../worker/rateLimit.js'
import { verifyTurnstileToken } from '../../../../worker/turnstile.js'
import { apiErrorResponse, jsonResponse } from '../../../../worker/utils/responses.js'

const CREATE_LIMIT = 10
const DAY_MS = 86_400_000

export const POST: APIRoute = async ({ request }) => {
  const env = getEnv()
  try {
    // Fails CLOSED (spec §10): anonymous creation without a working limiter
    // is an open spam relay, unlike a read endpoint briefly not counting.
    if (!env.RATE_LIMITER) {
      await request.arrayBuffer().catch(() => {})
      return jsonResponse({ error: 'Starting sessions is temporarily unavailable. Try again shortly.' }, 503)
    }
    const rate = await checkRateLimit(env, 'open-create', clientIp(request), { limit: CREATE_LIMIT, windowMs: DAY_MS })
    if (rate.limited) {
      await request.arrayBuffer().catch(() => {})
      return rateLimitedResponse('That is a lot of sessions for one day. Try again tomorrow.', rate.retryAfterSeconds)
    }

    const parsed = createSessionSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return jsonResponse({ error: 'Check the session details and try again.' }, 400)

    const hostname = new URL(request.url).hostname
    const isLocal = hostname === 'localhost' || hostname === '127.0.0.1'
    const verification = await verifyTurnstileToken(env.TURNSTILE_SECRET_KEY, parsed.data.turnstileToken, clientIp(request), {
      expectedHostname: hostname,
      expectedAction: OPEN_SESSION_TURNSTILE_ACTION,
      allowMissingSecret: isLocal,
    })
    if (!verification.ok) {
      const unavailable = verification.reason === 'configuration-missing' || verification.reason === 'verification-request-failed'
      return jsonResponse({ error: unavailable ? 'Verification is unavailable. Try again shortly.' : 'Verification failed. Please try again.' }, unavailable ? 503 : 400)
    }

    const hostKey = randomBase64Url(16)
    const hostKeyHash = await sha256Base64Url(hostKey)
    const { name, hostDisplayName, location, courtCount, settings, players } = parsed.data
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const state = buildInitialState(
        { name, hostDisplayName, location: location ?? null, courtCount, settings, players: players.map((p) => ({ name: p.name, skill: p.skill ?? null, duprId: p.duprId ?? null })) },
        { now: new Date().toISOString(), newId: () => crypto.randomUUID(), publicCode: generatePublicCode(), sessionId: crypto.randomUUID() },
      )
      try {
        await createOpenSession(env.PICKLEBALL_DB, state, hostKeyHash)
        return jsonResponse({ code: state.publicCode, hostKey }, 201)
      } catch (error) {
        const collision = error instanceof Error && /UNIQUE/i.test(error.message)
        if (!collision || attempt === 2) throw error
      }
    }
    return jsonResponse({ error: 'Could not start the session. Try again.' }, 500)
  } catch (error) {
    return apiErrorResponse(error)
  }
}
```

```ts
// src/pages/api/pickleball/open/s/[code]/state.ts
import type { APIRoute } from 'astro'
import { getEnv } from '../../../../../../lib/env'
import { codeFrom, notFound, openSessionStub } from '../../../../../../worker/pickleball/open/routeHelpers'
import { checkRateLimit, clientIp, rateLimitedResponse } from '../../../../../../worker/rateLimit.js'
import { apiErrorResponse, jsonResponse } from '../../../../../../worker/utils/responses.js'

export const GET: APIRoute = async ({ request, params }) => {
  const env = getEnv()
  try {
    const rate = await checkRateLimit(env, 'open-state', clientIp(request), { limit: 60, windowMs: 60_000 })
    if (rate.limited) return rateLimitedResponse('Too many requests. Try again shortly.', rate.retryAfterSeconds)
    const code = codeFrom(params)
    if (!code) return notFound()
    const snapshot = await openSessionStub(env, code).viewer(code)
    return snapshot ? jsonResponse(snapshot, 200) : notFound()
  } catch (error) {
    return apiErrorResponse(error)
  }
}
```

```ts
// src/pages/api/pickleball/open/s/[code]/host.ts
import type { APIRoute } from 'astro'
import { getEnv } from '../../../../../../lib/env'
import { codeFrom, doResponse, hostKeyFrom, notFound, openSessionStub } from '../../../../../../worker/pickleball/open/routeHelpers'
import { apiErrorResponse } from '../../../../../../worker/utils/responses.js'

export const GET: APIRoute = async ({ request, params }) => {
  try {
    const code = codeFrom(params)
    if (!code) return notFound()
    return doResponse(await openSessionStub(getEnv(), code).host(code, hostKeyFrom(request)))
  } catch (error) {
    return apiErrorResponse(error)
  }
}
```

```ts
// src/pages/api/pickleball/open/s/[code]/commands.ts
import type { APIRoute } from 'astro'
import { getEnv } from '../../../../../../lib/env'
import { codeFrom, doResponse, hostKeyFrom, notFound, openSessionStub } from '../../../../../../worker/pickleball/open/routeHelpers'
import { checkRateLimit, rateLimitedResponse } from '../../../../../../worker/rateLimit.js'
import { apiErrorResponse, jsonResponse } from '../../../../../../worker/utils/responses.js'

export const POST: APIRoute = async ({ request, params }) => {
  const env = getEnv()
  try {
    const code = codeFrom(params)
    if (!code) {
      await request.arrayBuffer().catch(() => {})
      return notFound()
    }
    const rate = await checkRateLimit(env, 'open-commands', code, { limit: 120, windowMs: 60_000 })
    if (rate.limited) {
      await request.arrayBuffer().catch(() => {})
      return rateLimitedResponse('Slow down a little and try again.', rate.retryAfterSeconds)
    }
    const body = await request.json().catch(() => null)
    if (body === null) return jsonResponse({ error: 'That request was not understood.' }, 400)
    return doResponse(await openSessionStub(env, code).command(code, hostKeyFrom(request), body))
  } catch (error) {
    return apiErrorResponse(error)
  }
}
```

```ts
// src/pages/api/pickleball/open/s/[code]/results.csv.ts
import type { APIRoute } from 'astro'
import { getEnv } from '../../../../../../lib/env'
import { codeFrom, doResponse, hostKeyFrom, notFound, openSessionStub } from '../../../../../../worker/pickleball/open/routeHelpers'
import { apiErrorResponse } from '../../../../../../worker/utils/responses.js'

export const GET: APIRoute = async ({ request, params }) => {
  try {
    const code = codeFrom(params)
    if (!code) return notFound()
    const result = await openSessionStub(getEnv(), code).results(code, hostKeyFrom(request))
    if (result.status !== 200 || !('csv' in result.body)) return doResponse(result)
    return new Response(`﻿${result.body.csv}`, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${result.body.filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    return apiErrorResponse(error)
  }
}
```

```ts
// src/pages/api/pickleball/open/s/[code]/session.ts
import type { APIRoute } from 'astro'
import { getEnv } from '../../../../../../lib/env'
import { codeFrom, doResponse, hostKeyFrom, notFound, openSessionStub } from '../../../../../../worker/pickleball/open/routeHelpers'
import { apiErrorResponse } from '../../../../../../worker/utils/responses.js'

export const DELETE: APIRoute = async ({ request, params }) => {
  try {
    const code = codeFrom(params)
    if (!code) return notFound()
    return doResponse(await openSessionStub(getEnv(), code).remove(code, hostKeyFrom(request)))
  } catch (error) {
    return apiErrorResponse(error)
  }
}
```

```ts
// src/pages/pickleball/rt/open/[code].ts
import type { APIRoute } from 'astro'
import { getEnv } from '../../../../lib/env'
import { codeFrom, notFound, openSessionStub } from '../../../../worker/pickleball/open/routeHelpers'
import { checkRateLimit, clientIp, rateLimitedResponse } from '../../../../worker/rateLimit.js'
import { apiErrorResponse, jsonResponse } from '../../../../worker/utils/responses.js'

export const GET: APIRoute = async ({ request, params }) => {
  const env = getEnv()
  try {
    if (request.headers.get('Upgrade') !== 'websocket') return jsonResponse({ error: 'Expected a WebSocket upgrade request.' }, 400)
    const rate = await checkRateLimit(env, 'open-ws', clientIp(request), { limit: 30, windowMs: 60_000 })
    if (rate.limited) return rateLimitedResponse('Too many connections. Try again shortly.', rate.retryAfterSeconds)
    const code = codeFrom(params)
    if (!code) return notFound()
    const headers = new Headers(request.headers)
    headers.set('X-Open-Code', code)
    return openSessionStub(env, code).fetch(new Request(request, { headers }))
  } catch (error) {
    return apiErrorResponse(error)
  }
}
```

- [ ] **Step 5: Exempt the open routes from the operator-login middleware**

In `src/middleware.ts`, beside `PICKLEBALL_PUBLIC_STATE_PREFIX`:

```ts
// Free open play (spec 2026-10-11) has no login at all: its routes authorize
// with the session's host key inside the Durable Object, so the operator
// session gate below must never run for them.
const PICKLEBALL_OPEN_PREFIX = '/api/pickleball/open/'
```

Add `!url.pathname.startsWith(PICKLEBALL_OPEN_PREFIX) &&` to the condition block at lines 113–117, next to the other `startsWith` exclusions.

- [ ] **Step 6: Let the Turnstile hook take an action**

In `src/components/islands/useTurnstile.js`, change the signature to `export function useTurnstile(siteKey, enabled = true, action = TURNSTILE_ACTION)`. On the render options (line 52), replace `action: TURNSTILE_ACTION,` with `action,`, and add `action` to that effect's dependency array. Existing callers pass two arguments, so they are unchanged.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx playwright test tests/e2e/pickleball/open-play.spec.js --project=worker`
Expected: PASS (6 tests).

Run: `npx playwright test tests/e2e/contact-form.spec.js`
Expected: still PASS (Turnstile hook unchanged for existing callers).

- [ ] **Step 8: Commit**

CHANGELOG `### Added`: `- Public API for free open play under /api/pickleball/open/: create (Turnstile, 10 per IP per day), board state, host commands with idempotency, results CSV, delete, and a live WebSocket.`

```bash
git add src/pages/api/pickleball/open src/pages/pickleball/rt/open src/worker/pickleball/open/routeHelpers.ts src/middleware.ts src/components/islands/useTurnstile.js tests/e2e/pickleball/open-play.spec.js CHANGELOG.md
git commit -m "feat(pickleball): open play api routes and websocket"
```

---

### Task 11: Daily purge

**Files:**
- Create: `src/worker/pickleball/open/purge.ts`
- Modify: `src/worker.ts` (`scheduled`)
- Test: `src/worker/pickleball/open/purge.test.ts`

**Interfaces:**
- Consumes: `purgeExpiredOpenSessions` (Task 8) and `OPEN_SESSION.evict()` (Task 9).
- Produces: `runOpenSessionPurge(env: Pick<Env, 'PICKLEBALL_DB' | 'OPEN_SESSION'>, { now }): Promise<number>`.

- [ ] **Step 1: Write the failing test**

```ts
// src/worker/pickleball/open/purge.test.ts
import { describe, expect, it, vi } from 'vitest'
import { createSqliteD1 } from '../../repositories/pickleball/open/testing/sqliteD1'
import { createOpenSession } from '../../repositories/pickleball/open/openSessions'
import { buildInitialState } from '../../../lib/pickleball/open/create'
import { DEFAULT_SETTINGS } from '../../../lib/pickleball/open/types'
import { runOpenSessionPurge } from './purge'

function stubNamespace(evict: () => Promise<void>) {
  return { idFromName: (name: string) => name, get: () => ({ evict }) } as unknown as Env['OPEN_SESSION']
}

describe('runOpenSessionPurge', () => {
  it('deletes expired sessions, evicts their coordinators and survives an evict failure', async () => {
    const { d1, raw } = createSqliteD1(['migrations/pickleball/0016_open_sessions.sql'])
    let n = 0
    for (const code of ['AAAAA22222', 'BBBBB33333']) {
      await createOpenSession(d1, buildInitialState(
        { name: 'x', hostDisplayName: 'y', location: null, courtCount: 1, settings: DEFAULT_SETTINGS, players: [] },
        { now: '2026-10-01T00:00:00.000Z', newId: () => `id${(n += 1)}`, publicCode: code, sessionId: code },
      ), 'h')
    }
    const evict = vi.fn().mockRejectedValueOnce(new Error('cold')).mockResolvedValue(undefined)
    const purged = await runOpenSessionPurge({ PICKLEBALL_DB: d1, OPEN_SESSION: stubNamespace(evict) }, { now: new Date('2026-10-09T00:00:00.000Z') })
    expect(purged).toBe(2)
    expect(evict).toHaveBeenCalledTimes(2)
    expect((raw.prepare('SELECT COUNT(*) AS n FROM open_sessions').get() as { n: number }).n).toBe(0)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/worker/pickleball/open/purge.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// src/worker/pickleball/open/purge.ts
import { purgeExpiredOpenSessions } from '../../repositories/pickleball/open/openSessions'

const BATCH = 500
const MAX_BATCHES = 20

/** Deletes every open session past its 7-day expiry (spec §8). Returns how many were purged. */
export async function runOpenSessionPurge(
  env: Pick<Env, 'PICKLEBALL_DB' | 'OPEN_SESSION'>,
  { now }: { now: Date },
): Promise<number> {
  let total = 0
  for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
    const codes = await purgeExpiredOpenSessions(env.PICKLEBALL_DB, now.toISOString(), BATCH)
    total += codes.length
    // Close any sockets still attached; the rows are already gone, so a
    // failure here only means a viewer keeps a stale screen until it reconnects.
    await Promise.allSettled(codes.map((code) => env.OPEN_SESSION.get(env.OPEN_SESSION.idFromName(code)).evict()))
    if (codes.length < BATCH) break
  }
  return total
}
```

In `src/worker.ts`, add the import and a third, independent `ctx.waitUntil` in `scheduled()` after the lead-engine tick:

```ts
import { runOpenSessionPurge } from './worker/pickleball/open/purge'
// …
    // Free open play retention (spec §8): its own waitUntil so it can neither
    // block nor be blocked by the digest or the lead engine.
    ctx.waitUntil(
      runOpenSessionPurge(env, { now: new Date(event.scheduledTime) })
        .then((purged) => console.log(JSON.stringify({ event: 'pickleball_open.purge', outcome: 'ok', purged })))
        .catch((error) => {
          console.log(JSON.stringify({ event: 'pickleball_open.purge', outcome: 'crashed', error: error instanceof Error ? error.message : 'unknown' }))
        }),
    )
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/worker/pickleball/open && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

CHANGELOG `### Added`: `- The daily cron deletes open sessions 7 days after their last change and closes any screens still watching them.`

```bash
git add src/worker/pickleball/open/purge.ts src/worker/pickleball/open/purge.test.ts src/worker.ts CHANGELOG.md
git commit -m "feat(pickleball): purge open sessions 7 days after last activity"
```

---

### Task 12: Design tokens, app shell and client data layer

**Files:**
- Modify: `tailwind.config.js`
- Create:
  - `src/styles/pickleball-open.css`, `src/layouts/PickleballAppShell.astro`
  - `src/pickleball-open/lib/api.js`, `src/pickleball-open/lib/hostKeys.js`, `src/pickleball-open/lib/useOpenSession.js`, `src/pickleball-open/lib/useCommandQueue.js`
  - `src/pickleball-open/components/ui.jsx`, `src/pickleball-open/components/QrCode.jsx`
- Test: `src/pickleball-open/lib/hostKeys.test.js`

**Interfaces:**
- Produces:
  - API helpers `createSession`, `fetchViewer`, `fetchHost`, `postCommand`, `downloadResults`, `deleteSession` and `class ApiError { status }`.
  - Host-link helpers `rememberHostedSession({ code, hostKey, name })`, `hostKeyFor(code)`, `hostedSessions()`, `forgetHostedSession(code)`, `hostKeyFromHash(hash)`, `hostLink(origin, code, key)`, `viewerLink(origin, code)`.
  - `useOpenSession(code, hostKey) → { status: 'connecting'|'open'|'reconnecting'|'not-found', viewer, host, authFailed, setHost }`.
  - `useCommandQueue(code, hostKey, onHost) → { send(command): Promise<boolean>, pending: number, error: string|null, clearError() }`.
  - UI primitives `Button`, `Panel`, `TeamNames`, `Dot`, `Sheet`, and `QrCode({ url, size })`.

- [ ] **Step 1: Write the failing test**

```js
// src/pickleball-open/lib/hostKeys.test.js
import { describe, expect, it } from 'vitest'
import { hostKeyFromHash, hostLink, viewerLink } from './hostKeys'

describe('host links', () => {
  it('reads the host key from the fragment only', () => {
    expect(hostKeyFromHash('#host=abc_DEF-123')).toBe('abc_DEF-123')
    expect(hostKeyFromHash('#x=1&host=k2')).toBe('k2')
    expect(hostKeyFromHash('')).toBeNull()
    expect(hostKeyFromHash('#host=')).toBeNull()
  })

  it('builds host and viewer links', () => {
    expect(hostLink('https://x.test', 'ABCDE23456', 'k')).toBe('https://x.test/pickleball/s/ABCDE23456#host=k')
    expect(viewerLink('https://x.test', 'ABCDE23456')).toBe('https://x.test/pickleball/s/ABCDE23456')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/pickleball-open/lib/hostKeys.test.js`
Expected: FAIL, module not found. (The existing `src/**/*.test.js` glob in `vitest.config.js` already picks this file up.)

- [ ] **Step 3: Implement the tokens, styles and shell**

In `tailwind.config.js`, inside `theme.extend.colors`, add:

```js
        // Free open play (spec §11): one neon accent layered on DevLab navy/violet.
        pickle: {
          neon: '#c6ff2e',
          teamb: '#8d9bff',
        },
```

```css
/* src/styles/pickleball-open.css
 * Motion for the open-play pages and app. Only transform/opacity animate
 * (spec §11), and everything stops for people who ask for less motion. */
.pb-anim .pb-ball { animation: pb-ball-arc 2.4s ease-in-out infinite alternate; transform-box: fill-box; }
.pb-anim .pb-bob { animation: pb-bob 1.8s ease-in-out infinite; transform-box: fill-box; transform-origin: center bottom; }
.pb-anim .pb-step { animation: pb-step 4s ease-in-out infinite; }
.pb-pulse { animation: pb-pulse 1.6s ease-in-out infinite; }
.pb-anim .pb-fade-cycle { animation: pb-fade-cycle 4s ease-in-out infinite; }
.pb-flip { animation: pb-flip 420ms ease-out; }

@keyframes pb-ball-arc {
  0% { transform: translate(0, 0); }
  50% { transform: translate(130px, -96px); }
  100% { transform: translate(260px, 0); }
}
@keyframes pb-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-5px); } }
@keyframes pb-step {
  0%, 15% { transform: translateX(0); opacity: 1; }
  45%, 70% { transform: translateX(var(--pb-step-x, 120px)); opacity: 1; }
  85% { transform: translateX(var(--pb-step-x, 120px)); opacity: 0; }
  100% { transform: translateX(0); opacity: 0; }
}
@keyframes pb-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }
@keyframes pb-fade-cycle { 0%, 20% { opacity: 0; } 35%, 80% { opacity: 1; } 100% { opacity: 0; } }
@keyframes pb-flip { from { transform: rotateX(70deg); opacity: 0.2; } to { transform: rotateX(0); opacity: 1; } }

@media (prefers-reduced-motion: reduce) {
  .pb-anim *, .pb-flip, .pb-pulse { animation: none !important; }
}
```

```astro
---
// src/layouts/PickleballAppShell.astro
// Standalone shell for the open-play app screens (create, board/console).
// Not Layout.astro: these are full-screen tools without the site nav.
import '../index.css'
import '../styles/pickleball-open.css'

interface Props {
  title: string
  description?: string
  indexable?: boolean
}
const { title, description, indexable = false } = Astro.props
---
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <link rel="icon" type="image/png" href="/devlabstudios-logo-only.png" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" />
    {!indexable && <meta name="robots" content="noindex, nofollow" />}
    {description && <meta name="description" content={description} />}
    <meta name="theme-color" content="#0b1426" />
    <title>{title}</title>
  </head>
  <body class="min-h-screen bg-ink font-sans text-white antialiased">
    <slot />
  </body>
</html>
```

- [ ] **Step 4: Implement the client data layer**

```js
// src/pickleball-open/lib/api.js
const JSON_HEADERS = { 'Content-Type': 'application/json' }

export class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.status = status
  }
}

async function parse(response) {
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new ApiError(body.error || 'Something went wrong. Try again.', response.status)
  return body
}

const base = (code) => `/api/pickleball/open/s/${code}`

export async function createSession(input) {
  return parse(await fetch('/api/pickleball/open/sessions', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input) }))
}
export async function fetchViewer(code) {
  return parse(await fetch(`${base(code)}/state`))
}
export async function fetchHost(code, hostKey) {
  return parse(await fetch(`${base(code)}/host`, { headers: { 'X-Host-Key': hostKey } }))
}
export async function postCommand(code, hostKey, envelope) {
  return parse(await fetch(`${base(code)}/commands`, { method: 'POST', headers: { ...JSON_HEADERS, 'X-Host-Key': hostKey }, body: JSON.stringify(envelope) }))
}
export async function downloadResults(code, hostKey) {
  const response = await fetch(`${base(code)}/results.csv`, { headers: { 'X-Host-Key': hostKey } })
  if (!response.ok) throw new ApiError('Could not download results.', response.status)
  const disposition = response.headers.get('Content-Disposition') || ''
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] || 'results.csv'
  return { blob: await response.blob(), filename }
}
export async function deleteSession(code, hostKey) {
  return parse(await fetch(`${base(code)}/session`, { method: 'DELETE', headers: { 'X-Host-Key': hostKey } }))
}
```

```js
// src/pickleball-open/lib/hostKeys.js
// The host key lives in this browser's localStorage so closing the tab never
// costs the host their session (spec §3.3). Every access is guarded: storage
// can be missing or throw (private mode, blocked site data).
const STORAGE_KEY = 'devlab-pickleball-hosted'
const MAX_REMEMBERED = 10

function read() {
  try {
    const value = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) || '[]')
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

function write(list) {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX_REMEMBERED)))
  } catch {
    // storage unavailable: the host link itself still works
  }
}

export function rememberHostedSession({ code, hostKey, name }) {
  write([{ code, hostKey, name, savedAt: new Date().toISOString() }, ...read().filter((entry) => entry.code !== code)])
}
export function hostKeyFor(code) {
  return read().find((entry) => entry.code === code)?.hostKey ?? null
}
export function hostedSessions() {
  return read()
}
export function forgetHostedSession(code) {
  write(read().filter((entry) => entry.code !== code))
}
export function hostKeyFromHash(hash) {
  const match = /(?:^#|&)host=([A-Za-z0-9_-]+)/.exec(hash || '')
  return match ? match[1] : null
}
export function hostLink(origin, code, hostKey) {
  return `${origin}/pickleball/s/${code}#host=${hostKey}`
}
export function viewerLink(origin, code) {
  return `${origin}/pickleball/s/${code}`
}
```

```js
// src/pickleball-open/lib/useOpenSession.js
import { useEffect, useState } from 'react'
import { fetchViewer } from './api'

const POLL_MS = 5000
const GONE = 4404

/** Live board state: WebSocket first, 5-second polling while it is down (spec §3.4). */
export function useOpenSession(code, hostKey) {
  const [status, setStatus] = useState('connecting')
  const [viewer, setViewer] = useState(null)
  const [host, setHost] = useState(null)
  const [authFailed, setAuthFailed] = useState(false)

  useEffect(() => {
    let socket = null
    let retryTimer = null
    let pollTimer = null
    let cancelled = false
    let attempt = 0

    async function poll() {
      try {
        const snapshot = await fetchViewer(code)
        if (!cancelled) setViewer(snapshot)
        return true
      } catch (error) {
        if (!cancelled && error?.status === 404) setStatus('not-found')
        return error?.status !== 404
      }
    }

    function connect() {
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
      socket = new WebSocket(`${protocol}://${window.location.host}/pickleball/rt/open/${code}`)
      socket.onopen = () => {
        attempt = 0
        clearInterval(pollTimer)
        setStatus('open')
        if (hostKey) socket.send(JSON.stringify({ type: 'AUTH', hostKey }))
      }
      socket.onmessage = (event) => {
        let message
        try {
          message = JSON.parse(event.data)
        } catch {
          return
        }
        if (message.type === 'VIEWER') setViewer(message.payload)
        if (message.type === 'HOST') {
          setHost(message.payload)
          setViewer(message.payload.viewer)
        }
        if (message.type === 'AUTH_FAILED') setAuthFailed(true)
      }
      socket.onclose = (event) => {
        if (cancelled) return
        if (event.code === GONE) {
          setStatus('not-found')
          return
        }
        setStatus('reconnecting')
        clearInterval(pollTimer)
        pollTimer = setInterval(poll, POLL_MS)
        retryTimer = setTimeout(connect, Math.min(1000 * 2 ** attempt, 8000))
        attempt += 1
      }
    }

    poll().then((found) => {
      if (found && !cancelled) connect()
    })

    return () => {
      cancelled = true
      clearTimeout(retryTimer)
      clearInterval(pollTimer)
      socket?.close()
    }
  }, [code, hostKey])

  return { status, viewer, host, authFailed, setHost }
}
```

```js
// src/pickleball-open/lib/useCommandQueue.js
import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, postCommand } from './api'

const RETRY_MS = 3000

/**
 * Sends host commands in order. A network failure or 5xx keeps the command
 * queued and retries it with the SAME idempotency key, so a flaky court-side
 * connection can never apply a tap twice (spec §3.4). A 4xx is final and
 * surfaces its message.
 */
export function useCommandQueue(code, hostKey, onHost) {
  const queueRef = useRef([])
  const flushingRef = useRef(false)
  const [pending, setPending] = useState(0)
  const [error, setError] = useState(null)

  const flush = useCallback(async () => {
    if (flushingRef.current) return
    flushingRef.current = true
    try {
      while (queueRef.current.length) {
        const item = queueRef.current[0]
        try {
          const result = await postCommand(code, hostKey, item.envelope)
          onHost(result.host)
          queueRef.current = queueRef.current.slice(1)
          item.resolve(true)
        } catch (failure) {
          if (failure instanceof ApiError && failure.status < 500 && failure.status !== 429) {
            queueRef.current = queueRef.current.slice(1)
            setError(failure.message)
            item.resolve(false)
          } else {
            break
          }
        } finally {
          setPending(queueRef.current.length)
        }
      }
    } finally {
      flushingRef.current = false
    }
  }, [code, hostKey, onHost])

  const send = useCallback((command) => new Promise((resolve) => {
    queueRef.current = [...queueRef.current, { envelope: { idempotencyKey: crypto.randomUUID(), command }, resolve }]
    setPending(queueRef.current.length)
    flush()
  }), [flush])

  useEffect(() => {
    const timer = setInterval(() => {
      if (queueRef.current.length) flush()
    }, RETRY_MS)
    return () => clearInterval(timer)
  }, [flush])

  return { send, pending, error, clearError: () => setError(null) }
}
```

- [ ] **Step 5: Implement the UI primitives**

```jsx
// src/pickleball-open/components/ui.jsx
const VARIANTS = {
  primary: 'bg-brand text-white hover:bg-[#3a00d6]',
  neon: 'bg-pickle-neon text-ink hover:brightness-95',
  ghost: 'border border-navy-700 text-white hover:bg-navy-900',
  quiet: 'text-pickle-neon hover:underline',
  danger: 'border border-rose-400/60 text-rose-200 hover:bg-rose-500/10',
}

/** @param {{ variant?: keyof typeof VARIANTS, className?: string } & import('react').ButtonHTMLAttributes<HTMLButtonElement>} props */
export function Button({ variant = 'primary', className = '', type = 'button', ...props }) {
  return (
    <button
      type={type}
      className={`inline-flex min-h-11 items-center justify-center rounded-xl px-4 py-2.5 font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pickle-neon disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  )
}

export function Panel({ className = '', as: Tag = 'div', ...props }) {
  return <Tag className={`rounded-2xl bg-navy-900 p-4 ${className}`} {...props} />
}

export function Dot({ side }) {
  return <span aria-hidden="true" className={`inline-block h-2.5 w-2.5 rounded-full ${side === 'A' ? 'bg-pickle-neon' : 'bg-pickle-teamb'}`} />
}

export function TeamNames({ side, names, emphasis = [] }) {
  return (
    <div className="flex items-center gap-2">
      <Dot side={side} />
      <span className="sr-only">{side === 'A' ? 'Team A:' : 'Team B:'}</span>
      <span>
        {names.map((name, index) => (
          <span key={name}>
            {index > 0 && <span className="text-mist"> · </span>}
            <span className={emphasis.includes(name) ? 'font-bold text-pickle-neon' : ''}>{name}</span>
          </span>
        ))}
      </span>
    </div>
  )
}

/** Bottom sheet on phones, centred panel from md up (spec §11). */
export function Sheet({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 md:items-center" role="presentation" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="pb-flip max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-navy-950 p-5 shadow-elevated md:max-w-lg md:rounded-3xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="text-xl font-bold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="min-h-11 min-w-11 rounded-xl text-mist hover:bg-navy-900">✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}
```

```jsx
// src/pickleball-open/components/QrCode.jsx
import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

// Client-side SVG from a URL this app built itself (never raw user input), so
// injecting the library's markup is safe. Same approach as the operator app's
// PublicLinkQRCode, copied here because that app is retired in Phase 5.
export default function QrCode({ url, size = 176 }) {
  const [markup, setMarkup] = useState(null)
  useEffect(() => {
    let ignore = false
    QRCode.toString(url, { type: 'svg', width: size, margin: 1, color: { dark: '#0b1426', light: '#ffffff' } })
      .then((svg) => { if (!ignore) setMarkup(svg) })
      .catch(() => {})
    return () => { ignore = true }
  }, [url, size])
  if (!markup) return <div style={{ width: size, height: size }} className="rounded-xl bg-white/10" aria-hidden="true" />
  return <div role="img" aria-label="QR code for the player board" className="overflow-hidden rounded-xl bg-white p-1" dangerouslySetInnerHTML={{ __html: markup }} />
}
```

- [ ] **Step 6: Run the tests and build**

Run: `npx vitest run src/pickleball-open && npm run build`
Expected: PASS, and the build succeeds.

- [ ] **Step 7: Commit**

CHANGELOG `### Added`: `- Pickleball neon (#c6ff2e) as a design token on the DevLab palette, an app shell for the open-play screens, and the client data layer (live connection with polling fallback, retrying command queue).`

```bash
git add tailwind.config.js src/styles/pickleball-open.css src/layouts/PickleballAppShell.astro src/pickleball-open CHANGELOG.md
git commit -m "feat(pickleball): open play design tokens, shell and client data layer"
```

---

### Task 13: Create flow (`/pickleball/new`)

**Files:**
- Create: `src/pages/pickleball/new.astro`, `src/pickleball-open/CreateSessionApp.jsx`, `src/pickleball-open/components/HostLinkPanel.jsx`

**Interfaces:**
- Consumes: `createSession`, `rememberHostedSession`, `hostLink`, `viewerLink`, `parseRoster`, `parseRosterCsv`, `useTurnstile(siteKey, enabled, action)`, `OPEN_SESSION_TURNSTILE_ACTION`, `formatPublicCode`, and the UI primitives.
- Produces: the page `/pickleball/new`. After creating, it shows `HostLinkPanel` with a "Go to courts" link to `/pickleball/s/{code}#host={key}`.

- [ ] **Step 1: Write the page**

```astro
---
// src/pages/pickleball/new.astro
import PickleballAppShell from '../../layouts/PickleballAppShell.astro'
import CreateSessionApp from '../../pickleball-open/CreateSessionApp.jsx'
import { resolveTurnstileSiteKey } from '../../lib/turnstileSiteKey'

const siteKey = resolveTurnstileSiteKey(Astro.request.url)
---
<PickleballAppShell title="Start a free session — Devlab Pickleball" description="Start a free pickleball open play session. No sign-up." indexable>
  <CreateSessionApp siteKey={siteKey} client:load />
</PickleballAppShell>
```

- [ ] **Step 2: Write the host-link panel**

```jsx
// src/pickleball-open/components/HostLinkPanel.jsx
import { useState } from 'react'
import { formatPublicCode } from '../../lib/pickleball/open/codes'
import { hostLink, viewerLink } from '../lib/hostKeys'
import QrCode from './QrCode.jsx'
import { Button, Panel } from './ui.jsx'

export default function HostLinkPanel({ code, hostKey, name }) {
  const origin = window.location.origin
  const host = hostLink(origin, code, hostKey)
  const viewer = viewerLink(origin, code)
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(host)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  async function share() {
    if (navigator.share) {
      await navigator.share({ title: `Host link: ${name}`, text: 'My host link (keep private)', url: host }).catch(() => {})
    } else {
      await copy()
    }
  }

  return (
    <div className="mx-auto grid max-w-5xl gap-5 px-4 py-8 md:grid-cols-2 md:py-14">
      <div className="md:col-span-2">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-pickle-neon">Session is live</p>
        <h1 className="mt-2 text-3xl font-bold leading-tight md:text-4xl">Two links. Keep the first one to yourself.</h1>
      </div>
      <Panel className="border-2 border-pickle-neon">
        <h2 className="text-lg font-bold">Your host link</h2>
        <p className="mt-1 text-sm text-mist">Full control. This device remembers it; open it on another phone to host from there.</p>
        <p className="mt-3 truncate rounded-lg bg-ink px-3 py-2 font-mono text-xs text-mist">{viewer}#host=••••••••</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button variant="neon" onClick={copy}>{copied ? 'Copied ✓' : 'Copy'}</Button>
          <Button variant="ghost" onClick={share}>Send to myself</Button>
        </div>
        <p className="mt-3 text-xs text-mist">Lose it on a new phone and it can't be recovered, so save it somewhere now.</p>
      </Panel>
      <Panel className="flex items-center gap-4">
        <QrCode url={viewer} size={150} />
        <div>
          <h2 className="text-lg font-bold">Player board</h2>
          <p className="mt-1 text-sm text-mist">Show or print this. Players see courts, who's next and standings. View only.</p>
          <p className="mt-2 text-xl font-bold tracking-[0.08em] text-pickle-neon">{formatPublicCode(code)}</p>
        </div>
      </Panel>
      <a href={`/pickleball/s/${code}#host=${hostKey}`} className="md:col-span-2 inline-flex min-h-12 items-center justify-center rounded-xl bg-brand px-6 text-lg font-bold text-white hover:bg-[#3a00d6]">
        I saved it — go to courts
      </a>
    </div>
  )
}
```

- [ ] **Step 3: Write the create app**

```jsx
// src/pickleball-open/CreateSessionApp.jsx
import { useMemo, useState } from 'react'
import { useTurnstile, VERIFICATION_MESSAGES } from '../components/islands/useTurnstile.js'
import { OPEN_SESSION_TURNSTILE_ACTION } from '../lib/pickleball/open/constants'
import { parseRoster, parseRosterCsv } from '../lib/pickleball/open/roster'
import { createSession } from './lib/api'
import { rememberHostedSession } from './lib/hostKeys'
import HostLinkPanel from './components/HostLinkPanel.jsx'
import { Button, Panel } from './components/ui.jsx'

const TARGETS = [11, 15, 21]
const field = 'w-full rounded-xl border border-navy-700 bg-navy-900 px-3 py-3 text-base text-white placeholder:text-mist/70 focus:border-pickle-neon focus:outline-none'

export default function CreateSessionApp({ siteKey }) {
  const [step, setStep] = useState('details')
  const [details, setDetails] = useState({ name: 'Open Play', hostDisplayName: '', courtCount: 4, target: 11, winBy2: true, winnerOnly: false })
  const [rosterMode, setRosterMode] = useState('paste')
  const [pasted, setPasted] = useState('')
  const [csvText, setCsvText] = useState('')
  const [created, setCreated] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const turnstile = useTurnstile(siteKey, step === 'players', OPEN_SESSION_TURNSTILE_ACTION)

  const roster = useMemo(() => {
    if (rosterMode === 'csv') {
      const parsed = parseRosterCsv(csvText)
      return { entries: parsed.entries, duplicates: parsed.duplicates, warnings: parsed.warnings }
    }
    const parsed = parseRoster(pasted)
    return { entries: parsed.names.map((name) => ({ name, skill: null, duprId: null })), duplicates: parsed.duplicates, warnings: [] }
  }, [rosterMode, pasted, csvText])

  const update = (patch) => setDetails((current) => ({ ...current, ...patch }))

  async function onCsvFile(event) {
    const file = event.target.files?.[0]
    if (file) setCsvText(await file.text())
  }

  async function start() {
    setError(null)
    if (!turnstile.token) {
      setError(VERIFICATION_MESSAGES[turnstile.state] || VERIFICATION_MESSAGES.error)
      return
    }
    setBusy(true)
    try {
      const result = await createSession({
        name: details.name,
        hostDisplayName: details.hostDisplayName,
        courtCount: details.courtCount,
        settings: { mode: 'PADDLE_STACK', target: details.target, winBy2: details.winBy2, winnerOnly: details.winnerOnly, scoringStyle: 'SIDEOUT' },
        players: roster.entries,
        turnstileToken: turnstile.token,
      })
      rememberHostedSession({ code: result.code, hostKey: result.hostKey, name: details.name })
      setCreated(result)
      setStep('done')
    } catch (failure) {
      setError(failure.message)
      turnstile.reset()
    } finally {
      setBusy(false)
    }
  }

  if (step === 'done' && created) return <HostLinkPanel code={created.code} hostKey={created.hostKey} name={details.name} />

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 md:py-12">
      <a href="/pickleball" className="text-sm text-mist hover:text-white">← Devlab Pickleball</a>
      <h1 className="mt-3 text-3xl font-bold md:text-4xl">{step === 'details' ? 'New session' : 'Add players'}</h1>
      <p className="mt-1 text-mist">Step {step === 'details' ? 1 : 2} of 2 · free, no sign-up</p>

      {step === 'details' && (
        <form className="mt-6 grid gap-5 md:grid-cols-2" onSubmit={(event) => { event.preventDefault(); setStep('players') }}>
          <label className="grid gap-1.5 text-sm text-mist">Session name
            <input required maxLength={60} className={field} value={details.name} onChange={(e) => update({ name: e.target.value })} />
          </label>
          <label className="grid gap-1.5 text-sm text-mist">Your name (shown as "Hosted by")
            <input required maxLength={40} className={field} value={details.hostDisplayName} placeholder="e.g. Coach Mike" onChange={(e) => update({ hostDisplayName: e.target.value })} />
          </label>
          <Panel>
            <div className="flex items-center justify-between">
              <span className="font-semibold">Courts</span>
              <div className="flex items-center gap-3">
                <Button variant="ghost" aria-label="Fewer courts" className="!px-0 w-11" onClick={() => update({ courtCount: Math.max(1, details.courtCount - 1) })}>−</Button>
                <output className="w-8 text-center text-2xl font-bold" aria-live="polite">{details.courtCount}</output>
                <Button variant="ghost" aria-label="More courts" className="!px-0 w-11" onClick={() => update({ courtCount: Math.min(16, details.courtCount + 1) })}>+</Button>
              </div>
            </div>
          </Panel>
          <Panel>
            <span className="font-semibold">Games to</span>
            <div className="mt-2 grid grid-cols-4 gap-2" role="radiogroup" aria-label="Games to">
              {TARGETS.map((target) => (
                <Button key={target} role="radio" aria-checked={!details.winnerOnly && details.target === target} variant={!details.winnerOnly && details.target === target ? 'neon' : 'ghost'} onClick={() => update({ target, winnerOnly: false })}>{target}</Button>
              ))}
              <Button role="radio" aria-checked={details.winnerOnly} variant={details.winnerOnly ? 'neon' : 'ghost'} className="text-sm" onClick={() => update({ winnerOnly: true })}>Winner only</Button>
            </div>
            <label className="mt-3 flex items-center justify-between text-sm">
              <span>Win by 2</span>
              <input type="checkbox" className="h-5 w-5 accent-[#c6ff2e]" checked={details.winBy2} disabled={details.winnerOnly} onChange={(e) => update({ winBy2: e.target.checked })} />
            </label>
          </Panel>
          <Panel className="md:col-span-2">
            <p className="font-semibold">Who plays next: <span className="text-pickle-neon">paddle stack</span></p>
            <p className="mt-1 text-sm text-mist">Fewest games first, then longest wait. Partners rotate, and every proposed game can be edited before it starts.</p>
          </Panel>
          <Button type="submit" variant="primary" className="md:col-span-2 text-lg">Next: add players</Button>
        </form>
      )}

      {step === 'players' && (
        <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-2" role="tablist" aria-label="How to add players">
              <Button role="tab" aria-selected={rosterMode === 'paste'} variant={rosterMode === 'paste' ? 'neon' : 'ghost'} onClick={() => setRosterMode('paste')}>Paste list</Button>
              <Button role="tab" aria-selected={rosterMode === 'csv'} variant={rosterMode === 'csv' ? 'neon' : 'ghost'} onClick={() => setRosterMode('csv')}>Upload CSV</Button>
            </div>
            {rosterMode === 'paste' ? (
              <label className="grid gap-1.5 text-sm text-mist">Paste names from Reclub, WhatsApp or anywhere: one per line, or comma-separated
                <textarea className={`${field} h-48 font-mono text-sm`} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder={'1. Ana\n2. Ben\nCarlo, Dina'} />
              </label>
            ) : (
              <label className="grid gap-1.5 text-sm text-mist">CSV with columns: name, skill (1–8, optional), DUPR ID (optional)
                <input type="file" accept=".csv,text/csv" className={field} onChange={onCsvFile} />
              </label>
            )}
            <p className="text-sm text-mist">You can add late arrivals any time. The board is public to anyone with the link, so first names or nicknames are fine.</p>
          </div>
          <Panel>
            <div className="flex items-baseline justify-between">
              <h2 className="font-bold">{roster.entries.length} players found</h2>
              {roster.duplicates.length > 0 && <span className="text-xs text-mist">{roster.duplicates.length} duplicate{roster.duplicates.length > 1 ? 's' : ''} removed</span>}
            </div>
            <ul className="mt-3 flex flex-wrap gap-1.5 text-sm">
              {roster.entries.map((entry) => <li key={entry.name} className="rounded-full bg-navy-800 px-3 py-1">{entry.name}</li>)}
            </ul>
            {roster.warnings.map((warning) => <p key={warning} className="mt-2 text-xs text-amber-200">{warning}</p>)}
            {roster.entries.length > 0 && roster.entries.length < 4 && <p className="mt-3 text-sm text-amber-200">Add at least 4 players for the first game.</p>}
          </Panel>
          <div className="lg:col-span-2 grid gap-3">
            <div ref={turnstile.containerRef} />
            {error && <p role="alert" className="rounded-xl bg-rose-500/15 px-4 py-3 text-rose-100">{error}</p>}
            <div className="flex flex-wrap gap-3">
              <Button variant="ghost" onClick={() => setStep('details')}>Back</Button>
              <Button variant="primary" className="flex-1 text-lg" disabled={busy} onClick={start}>
                {busy ? 'Starting…' : `Start session · ${roster.entries.length} players, ${details.courtCount} court${details.courtCount > 1 ? 's' : ''}`}
              </Button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
```

Check `useTurnstile`'s return shape before relying on it (`containerRef`, `token`, `state`, `reset`). If it names these differently, use its names; the hook is shared and is not changed beyond Task 10's `action` parameter.

- [ ] **Step 4: Check the page renders**

Run: `npm run build && npx wrangler dev --port 8787 --local`. Open `http://localhost:8787/pickleball/new` at 390 px and 1440 px widths, create a session with 9 pasted names, and confirm the host-link panel appears. Then stop the server. This flow is pinned in Task 18's e2e.

- [ ] **Step 5: Commit**

CHANGELOG `### Added`: `- /pickleball/new: start a free session in two steps (details, then paste or upload players), then save the host link and show the player QR.`

```bash
git add src/pages/pickleball/new.astro src/pickleball-open CHANGELOG.md
git commit -m "feat(pickleball): create session flow with host link and player qr"
```

---

### Task 14: Host console

**Files:**
- Create:
  - `src/pickleball-open/components/HostConsole.jsx`, `src/pickleball-open/components/CourtCard.jsx`
  - `src/pickleball-open/components/GameOverDialog.jsx`, `src/pickleball-open/components/EditMatchDialog.jsx`
  - `src/pickleball-open/components/PlayersPanel.jsx`, `src/pickleball-open/components/StandingsTable.jsx`, `src/pickleball-open/components/ResultsList.jsx`
  - `src/pickleball-open/components/UndoToast.jsx`
- Test: `src/pickleball-open/components/scorePad.test.js` (pure helper)

**Interfaces:**
- Consumes:
  - `HostSnapshot` (Task 7); `useCommandQueue` (Task 12).
  - `expectedWinnerScore` and `validateResult` (Task 2).
  - The API helpers `downloadResults` and `deleteSession`, plus `forgetHostedSession`.
- Produces:
  - `HostConsole({ code, hostKey, host, status, onHost })`.
  - `scorePadOptions(target): number[]`, exported from `GameOverDialog.jsx`'s sibling helper `src/pickleball-open/components/scorePad.js`.

- [ ] **Step 1: Write the failing test for the score pad helper**

```js
// src/pickleball-open/components/scorePad.test.js
import { describe, expect, it } from 'vitest'
import { resultFromPad, scorePadOptions } from './scorePad'

describe('score pad', () => {
  it('offers every losing score up to target - 1, then deuce scores', () => {
    expect(scorePadOptions(11).slice(0, 11)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(scorePadOptions(11)).toContain(13)
  })

  it('fills the winner score from the loser score', () => {
    const settings = { target: 11, winBy2: true, winnerOnly: false }
    expect(resultFromPad('A', 7, settings)).toEqual({ winner: 'A', scoreA: 11, scoreB: 7 })
    expect(resultFromPad('B', 10, settings)).toEqual({ winner: 'B', scoreA: 10, scoreB: 12 })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails, then implement the helper**

Run: `npx vitest run src/pickleball-open/components/scorePad.test.js`
Expected: FAIL.

```js
// src/pickleball-open/components/scorePad.js
import { expectedWinnerScore } from '../../lib/pickleball/open/scoreValidation'

/** Losing scores a host can tap: 0..target-1, plus four deuce steps (Review Focus 5). */
export function scorePadOptions(target) {
  return [...Array.from({ length: target }, (_, i) => i), target, target + 1, target + 2, target + 3]
}

export function resultFromPad(winner, loserScore, settings) {
  const winnerScore = expectedWinnerScore(loserScore, settings)
  return winner === 'A'
    ? { winner, scoreA: winnerScore, scoreB: loserScore }
    : { winner, scoreA: loserScore, scoreB: winnerScore }
}
```

Run the test again. Expected: PASS.

- [ ] **Step 3: Write the court card and dialogs**

```jsx
// src/pickleball-open/components/CourtCard.jsx
import { Button, TeamNames } from './ui.jsx'

function minutesSince(iso) {
  return iso ? Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000)) : 0
}

export default function CourtCard({ court, nameOf, onStart, onGameOver, onEdit }) {
  const match = court.match
  if (!court.enabled) {
    return <article className="rounded-2xl border border-navy-800 p-4 text-mist"><h3 className="font-bold text-white">{court.label}</h3><p className="mt-2 text-sm">Off</p></article>
  }
  if (!match) {
    return (
      <article className="rounded-2xl border border-dashed border-navy-700 p-4">
        <h3 className="font-bold">{court.label}</h3>
        <p className="mt-2 text-sm text-mist">Waiting for players. Fills automatically when the next game ends.</p>
      </article>
    )
  }
  const proposed = match.status === 'PROPOSED'
  return (
    <article key={match.id} className={`pb-flip flex flex-col gap-3 rounded-2xl p-4 ${proposed ? 'border-2 border-dashed border-pickle-neon bg-ink' : 'bg-navy-900'}`} data-testid={`court-${court.position}`}>
      <div className="flex items-baseline justify-between">
        <h3 className="text-lg font-bold">{court.label}</h3>
        <span className={`text-xs ${proposed ? 'font-bold text-pickle-neon' : 'text-mist'}`}>{proposed ? 'Up next' : `${minutesSince(match.startedAt)} min`}</span>
      </div>
      <div className="grid gap-1 text-[15px]">
        <TeamNames side="A" names={match.teamA.map(nameOf)} />
        <TeamNames side="B" names={match.teamB.map(nameOf)} />
      </div>
      {proposed ? (
        <div className="grid grid-cols-2 gap-2">
          <Button variant="neon" onClick={() => onStart(match)}>Start</Button>
          <Button variant="ghost" onClick={() => onEdit(match)}>Edit</Button>
          <Button variant="quiet" className="col-span-2 !min-h-9 text-sm" onClick={() => onGameOver(match)}>Already played? Enter result</Button>
        </div>
      ) : (
        <Button variant="primary" onClick={() => onGameOver(match)}>Game over</Button>
      )}
    </article>
  )
}
```

```jsx
// src/pickleball-open/components/GameOverDialog.jsx
import { useState } from 'react'
import { validateResult } from '../../lib/pickleball/open/scoreValidation'
import { resultFromPad, scorePadOptions } from './scorePad'
import { Button, Sheet } from './ui.jsx'

export default function GameOverDialog({ title, match, nameOf, settings, initial, onSave, onAbandon, onClose }) {
  const [winner, setWinner] = useState(initial?.winner ?? null)
  const [loserScore, setLoserScore] = useState(initial ? Math.min(initial.scoreA ?? 0, initial.scoreB ?? 0) : null)
  const teamA = match.teamA.map(nameOf).join(' · ')
  const teamB = match.teamB.map(nameOf).join(' · ')
  const result = winner && loserScore !== null && !settings.winnerOnly ? resultFromPad(winner, loserScore, settings) : null
  const check = result ? validateResult(result, settings) : null

  return (
    <Sheet title={title} onClose={onClose}>
      <p className="mb-3 text-sm text-mist">{settings.winnerOnly ? 'Winner only' : `Game to ${settings.target}${settings.winBy2 ? ' · win by 2' : ''}`}</p>
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Who won?">
        {[['A', teamA], ['B', teamB]].map(([side, label]) => (
          <button key={side} type="button" role="radio" aria-checked={winner === side} onClick={() => setWinner(side)}
            className={`min-h-16 rounded-2xl p-3 text-left font-semibold ${winner === side ? 'bg-pickle-neon text-ink' : 'border border-navy-700 bg-navy-900'}`}>
            <span className="block text-xs font-bold tracking-[0.08em]">{winner === side ? 'WINNER ✓' : 'TAP IF THEY WON'}</span>
            {label}
          </button>
        ))}
      </div>

      {!settings.winnerOnly && winner && (
        <>
          <p className="mt-4 text-sm text-mist">Losing team's score</p>
          <div className="mt-2 grid grid-cols-6 gap-1.5 sm:grid-cols-8">
            {scorePadOptions(settings.target).map((value) => (
              <button key={value} type="button" aria-pressed={loserScore === value} onClick={() => setLoserScore(value)}
                className={`min-h-11 rounded-lg text-base ${loserScore === value ? 'bg-pickle-teamb font-bold text-ink' : 'bg-navy-900'}`}>{value}</button>
            ))}
          </div>
          {result && (
            <p className="mt-3 text-center text-3xl font-bold" aria-live="polite">
              <span className={result.winner === 'A' ? 'text-pickle-neon' : ''}>{result.scoreA}</span>
              <span className="mx-2 text-mist">–</span>
              <span className={result.winner === 'B' ? 'text-pickle-neon' : ''}>{result.scoreB}</span>
            </p>
          )}
          {check && !check.ok && <p role="alert" className="mt-2 text-sm text-rose-200">{check.reason}</p>}
        </>
      )}

      <div className="mt-5 grid gap-2">
        {!settings.winnerOnly && (
          <Button variant="primary" disabled={!result || !check?.ok} onClick={() => onSave(result)}>
            {result ? `Save ${result.scoreA}–${result.scoreB}` : 'Pick the winner and score'}
          </Button>
        )}
        <Button variant={settings.winnerOnly ? 'primary' : 'ghost'} disabled={!winner} onClick={() => onSave({ winner, scoreA: null, scoreB: null })}>Save winner only</Button>
        {onAbandon && <Button variant="quiet" onClick={onAbandon}>Game abandoned (no result)</Button>}
      </div>
    </Sheet>
  )
}
```

```jsx
// src/pickleball-open/components/EditMatchDialog.jsx
import { useState } from 'react'
import { Button, Sheet } from './ui.jsx'

export default function EditMatchDialog({ match, players, nameOf, onSave, onSkip, onClose }) {
  const [slots, setSlots] = useState([...match.teamA, ...match.teamB])
  const [selected, setSelected] = useState(null)
  const available = players.filter((p) => p.status === 'ACTIVE' && (!p.busy || slots.includes(p.id)) && !slots.includes(p.id))
    .sort((a, b) => b.satOut - a.satOut || a.games - b.games)

  function tapSlot(index) {
    if (selected === null) return setSelected(index)
    if (selected === index) return setSelected(null)
    const next = [...slots]
    ;[next[selected], next[index]] = [next[index], next[selected]]
    setSlots(next)
    setSelected(null)
  }

  function replaceWith(playerId) {
    if (selected === null) return
    setSlots(slots.map((id, i) => (i === selected ? playerId : id)))
    setSelected(null)
  }

  const slotButton = (index) => (
    <button key={index} type="button" onClick={() => tapSlot(index)} aria-pressed={selected === index}
      className={`min-h-12 rounded-xl px-3 text-left ${selected === index ? 'border-2 border-pickle-neon bg-white font-bold text-ink' : 'bg-navy-800'}`}>
      {nameOf(slots[index])}{selected === index ? ' · replace…' : ''}
    </button>
  )

  return (
    <Sheet title="Edit before start" onClose={onClose}>
      <p className="text-sm text-mist">Tap a player, then tap someone waiting to put them in, or tap a second player to swap teams. A player you swap out keeps their place in line.</p>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="grid gap-2"><p className="text-xs font-bold text-pickle-neon">TEAM A</p>{slotButton(0)}{slotButton(1)}</div>
        <div className="grid gap-2"><p className="text-xs font-bold text-pickle-teamb">TEAM B</p>{slotButton(2)}{slotButton(3)}</div>
      </div>
      {selected !== null && (
        <div className="mt-4 grid gap-1.5">
          <p className="text-sm text-mist">Put in instead of {nameOf(slots[selected])}</p>
          {available.length === 0 && <p className="text-sm text-mist">Nobody else is free right now.</p>}
          {available.map((p) => (
            <button key={p.id} type="button" onClick={() => replaceWith(p.id)} className="flex min-h-11 items-center justify-between rounded-xl border border-navy-700 px-3 hover:border-pickle-neon">
              <span>{p.name}</span><span className="text-xs text-mist">{p.games} games · sat out {p.satOut}</span>
            </button>
          ))}
        </div>
      )}
      <div className="mt-5 grid grid-cols-2 gap-2">
        <Button variant="ghost" onClick={onSkip}>Suggest another four</Button>
        <Button variant="neon" onClick={() => onSave(slots)}>Save</Button>
      </div>
    </Sheet>
  )
}
```

```jsx
// src/pickleball-open/components/UndoToast.jsx
import { useEffect, useState } from 'react'

const UNDO_MS = 120_000

export default function UndoToast({ label, savedAt, onUndo, onDismiss }) {
  const [left, setLeft] = useState(UNDO_MS - (Date.now() - savedAt))
  useEffect(() => {
    const timer = setInterval(() => setLeft(UNDO_MS - (Date.now() - savedAt)), 1000)
    return () => clearInterval(timer)
  }, [savedAt])
  useEffect(() => { if (left <= 0) onDismiss() }, [left, onDismiss])
  const seconds = Math.max(0, Math.ceil(left / 1000))
  return (
    <div role="status" className="fixed inset-x-3 bottom-20 z-30 mx-auto flex max-w-md items-center gap-3 rounded-2xl bg-white px-4 py-3 text-ink shadow-elevated lg:bottom-6">
      <span className="flex-1 text-sm font-semibold">{label}</span>
      <button type="button" onClick={onUndo} className="min-h-10 rounded-lg bg-ink px-3 font-bold text-pickle-neon">
        Undo · {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Write the side panels**

```jsx
// src/pickleball-open/components/StandingsTable.jsx
export default function StandingsTable({ rows, highlightId = null, compact = false }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[15px]">
        <caption className="sr-only">Standings</caption>
        <thead className="text-xs text-mist">
          <tr><th className="py-2 pr-2">#</th><th className="py-2">Player</th><th className="py-2 text-right">W–L</th><th className="py-2 text-right">Win %</th>{!compact && <th className="py-2 text-right">+/− per game</th>}</tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.playerId} className={`border-t border-navy-800 ${row.playerId === highlightId ? 'font-bold text-pickle-neon' : ''}`}>
              <td className="py-2 pr-2 font-bold text-pickle-neon">{row.rank ?? '–'}</td>
              <td className="py-2">{row.name}{row.played === 0 && <span className="text-mist"> · no games yet</span>}</td>
              <td className="py-2 text-right">{row.wins}–{row.losses}</td>
              <td className="py-2 text-right">{row.winRate === null ? '–' : Math.round(row.winRate * 100)}</td>
              {!compact && <td className="py-2 text-right">{row.avgDiff === null ? '–' : `${row.avgDiff > 0 ? '+' : ''}${row.avgDiff.toFixed(1)}`}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-mist">Ranked by win %, then point difference per game, then points per game, then head-to-head. Just for today.</p>
    </div>
  )
}
```

```jsx
// src/pickleball-open/components/PlayersPanel.jsx
import { useState } from 'react'
import { Button } from './ui.jsx'

const STATUS_LABEL = { ACTIVE: 'Playing', BREAK: 'On break', LEFT: 'Left' }

export default function PlayersPanel({ players, waiting, send }) {
  const [names, setNames] = useState('')
  const order = new Map(waiting.map((w, index) => [w.id, index + 1]))

  async function add(event) {
    event.preventDefault()
    const list = names.split(/[\n,]/).map((n) => n.trim()).filter(Boolean)
    if (list.length && (await send({ type: 'ADD_PLAYERS', names: list }))) setNames('')
  }

  return (
    <section aria-labelledby="players-heading" className="grid gap-3">
      <h2 id="players-heading" className="text-lg font-bold">Players ({players.filter((p) => p.status !== 'LEFT').length})</h2>
      <form onSubmit={add} className="flex gap-2">
        <label className="sr-only" htmlFor="add-players">Add players</label>
        <input id="add-players" value={names} onChange={(e) => setNames(e.target.value)} placeholder="Add late arrivals (comma-separated)"
          className="min-h-11 flex-1 rounded-xl border border-navy-700 bg-navy-900 px-3 text-white placeholder:text-mist/70" />
        <Button type="submit" variant="neon">Add</Button>
      </form>
      <ul className="grid gap-1.5">
        {players.filter((p) => p.status !== 'LEFT').map((p) => (
          <li key={p.id} className="flex items-center gap-2 rounded-xl bg-navy-900 px-3 py-2 text-[15px]">
            <span className="flex-1">{order.has(p.id) ? `${order.get(p.id)} · ` : ''}{p.name}</span>
            <span className="text-xs text-mist">{p.busy ? 'on court' : STATUS_LABEL[p.status]} · {p.games} games</span>
            {p.status === 'ACTIVE' && !p.busy && <Button variant="quiet" className="!min-h-9 !px-2 text-sm" onClick={() => send({ type: 'SET_PLAYER_STATUS', playerId: p.id, status: 'BREAK' })}>Break</Button>}
            {p.status === 'BREAK' && <Button variant="quiet" className="!min-h-9 !px-2 text-sm" onClick={() => send({ type: 'SET_PLAYER_STATUS', playerId: p.id, status: 'ACTIVE' })}>Back in</Button>}
            {!p.busy && <Button variant="quiet" className="!min-h-9 !px-2 text-sm text-mist" aria-label={`${p.name} left`} onClick={() => send({ type: 'SET_PLAYER_STATUS', playerId: p.id, status: 'LEFT' })}>Left</Button>}
          </li>
        ))}
      </ul>
    </section>
  )
}
```

```jsx
// src/pickleball-open/components/ResultsList.jsx
import { Button } from './ui.jsx'

export default function ResultsList({ finished, nameOf, courtLabel, onEdit }) {
  if (!finished.length) return <p className="text-sm text-mist">No results yet.</p>
  return (
    <ul className="grid gap-1.5">
      {finished.map((m) => (
        <li key={m.id} className="flex items-center gap-3 rounded-xl bg-navy-900 px-3 py-2 text-sm">
          <span className="w-16 text-xs text-mist">{courtLabel(m.courtId)}</span>
          <span className="flex-1">
            <span className={m.winner === 'A' ? 'font-bold' : ''}>{m.teamA.map(nameOf).join(' · ')}</span>
            <span className="text-mist"> vs </span>
            <span className={m.winner === 'B' ? 'font-bold' : ''}>{m.teamB.map(nameOf).join(' · ')}</span>
          </span>
          <span className="font-bold">{m.scoreA === null ? `${m.winner} won` : `${m.scoreA}–${m.scoreB}`}</span>
          <Button variant="quiet" className="!min-h-9 !px-2" onClick={() => onEdit(m)}>Edit</Button>
        </li>
      ))}
    </ul>
  )
}
```

- [ ] **Step 5: Write the console**

```jsx
// src/pickleball-open/components/HostConsole.jsx
import { useCallback, useMemo, useState } from 'react'
import { formatPublicCode } from '../../lib/pickleball/open/codes'
import { deleteSession, downloadResults } from '../lib/api'
import { forgetHostedSession, viewerLink } from '../lib/hostKeys'
import { useCommandQueue } from '../lib/useCommandQueue'
import CourtCard from './CourtCard.jsx'
import EditMatchDialog from './EditMatchDialog.jsx'
import GameOverDialog from './GameOverDialog.jsx'
import PlayersPanel from './PlayersPanel.jsx'
import QrCode from './QrCode.jsx'
import ResultsList from './ResultsList.jsx'
import StandingsTable from './StandingsTable.jsx'
import UndoToast from './UndoToast.jsx'
import { Button, Panel, Sheet } from './ui.jsx'

const TABS = [['courts', 'Courts'], ['players', 'Players'], ['results', 'Results']]

export default function HostConsole({ code, hostKey, host, status, onHost }) {
  const { send, pending, error, clearError } = useCommandQueue(code, hostKey, onHost)
  const [tab, setTab] = useState('courts')
  const [dialog, setDialog] = useState(null)
  const [undo, setUndo] = useState(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const viewer = host.viewer
  const names = useMemo(() => new Map(host.players.map((p) => [p.id, p.name])), [host.players])
  const nameOf = useCallback((id) => names.get(id) ?? '—', [names])
  const courtLabel = useCallback((id) => host.courts.find((c) => c.id === id)?.label ?? '', [host.courts])
  const dismissUndo = useCallback(() => setUndo(null), [])

  async function save(match, result) {
    setDialog(null)
    const ok = await send({ type: 'RECORD_RESULT', matchId: match.id, ...result })
    if (ok) setUndo({ matchId: match.id, savedAt: Date.now(), label: `${courtLabel(match.courtId)} saved${result.scoreA === null ? '' : ` ${result.scoreA}–${result.scoreB}`}.` })
  }

  async function download() {
    const { blob, filename } = await downloadResults(code, hostKey)
    const url = URL.createObjectURL(blob)
    const link = Object.assign(document.createElement('a'), { href: url, download: filename })
    link.click()
    URL.revokeObjectURL(url)
  }

  async function remove() {
    if (!window.confirm('Delete this session and all its results now? This cannot be undone.')) return
    await deleteSession(code, hostKey)
    forgetHostedSession(code)
    window.location.assign('/pickleball')
  }

  const section = (key) => `${tab === key ? 'block' : 'hidden'} lg:block`

  return (
    <div className="mx-auto max-w-[1600px] px-3 pb-24 pt-3 sm:px-5 lg:pb-8">
      <header className="flex flex-wrap items-center gap-3 py-2">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-bold sm:text-2xl">{viewer.name}</h1>
          <p className="text-xs text-mist">
            {host.players.filter((p) => p.status !== 'LEFT').length} players · {host.courts.filter((c) => c.enabled).length} courts · paddle stack
            {status !== 'open' && <span className="ml-2 text-amber-200">· Reconnecting…</span>}
            {pending > 0 && <span className="ml-2 text-amber-200">· Sending {pending}…</span>}
            {viewer.status === 'ENDED' && <span className="ml-2 text-pickle-neon">· Ended</span>}
          </p>
        </div>
        <Button variant="neon" onClick={() => setDialog({ type: 'share' })}>Share board</Button>
        <div className="relative">
          <Button variant="ghost" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>More</Button>
          {menuOpen && (
            <div className="absolute right-0 z-20 mt-2 grid w-56 gap-1 rounded-2xl bg-navy-950 p-2 shadow-elevated">
              <Button variant="ghost" onClick={() => { setMenuOpen(false); download() }}>Download results (CSV)</Button>
              {viewer.status === 'ACTIVE' && <Button variant="ghost" onClick={() => { setMenuOpen(false); send({ type: 'END_SESSION' }) }}>End session</Button>}
              <Button variant="danger" onClick={() => { setMenuOpen(false); remove() }}>Delete now</Button>
            </div>
          )}
        </div>
      </header>

      {error && (
        <p role="alert" className="my-2 flex items-center justify-between rounded-xl bg-rose-500/15 px-4 py-3 text-rose-100">
          {error}<button type="button" onClick={clearError} className="ml-3 underline">OK</button>
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(300px,380px)]">
        <section className={section('courts')} aria-label="Courts">
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]">
            {host.courts.map((court) => (
              <CourtCard key={court.id} court={court} nameOf={nameOf}
                onStart={(match) => send({ type: 'START_MATCH', matchId: match.id })}
                onGameOver={(match) => setDialog({ type: 'gameOver', match })}
                onEdit={(match) => setDialog({ type: 'edit', match })} />
            ))}
          </div>
          <Panel className="mt-4">
            <h2 className="font-bold">Waiting</h2>
            {viewer.waiting.length === 0 ? <p className="mt-1 text-sm text-mist">Everyone is on court.</p> : (
              <ol className="mt-2 flex flex-wrap gap-1.5 text-sm">
                {viewer.waiting.map((w, i) => <li key={w.id} className="rounded-full bg-navy-800 px-3 py-1">{i + 1} · {w.name}</li>)}
              </ol>
            )}
          </Panel>
        </section>

        <aside className="grid content-start gap-5">
          <div className={section('players')}><PlayersPanel players={host.players} waiting={viewer.waiting} send={send} /></div>
          <div className={section('results')}>
            <Panel><h2 className="mb-2 text-lg font-bold">Standings</h2><StandingsTable rows={viewer.standings} compact /></Panel>
            <Panel className="mt-4"><h2 className="mb-2 text-lg font-bold">Results</h2>
              <ResultsList finished={host.finished} nameOf={nameOf} courtLabel={courtLabel} onEdit={(match) => setDialog({ type: 'editResult', match })} />
            </Panel>
          </div>
        </aside>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-3 border-t border-navy-800 bg-ink lg:hidden" aria-label="Sections">
        {TABS.map(([key, label]) => (
          <button key={key} type="button" aria-current={tab === key} onClick={() => setTab(key)}
            className={`min-h-14 text-sm ${tab === key ? 'font-bold text-pickle-neon' : 'text-mist'}`}>{label}</button>
        ))}
      </nav>

      {dialog?.type === 'gameOver' && (
        <GameOverDialog title={`${courtLabel(dialog.match.courtId)} · who won?`} match={dialog.match} nameOf={nameOf} settings={host.settings}
          onSave={(result) => save(dialog.match, result)}
          onAbandon={dialog.match.status === 'IN_PROGRESS' ? () => { setDialog(null); send({ type: 'ABANDON_MATCH', matchId: dialog.match.id }) } : null}
          onClose={() => setDialog(null)} />
      )}
      {dialog?.type === 'editResult' && (
        <GameOverDialog title="Edit result" match={dialog.match} nameOf={nameOf} settings={host.settings} initial={dialog.match}
          onSave={(result) => { setDialog(null); send({ type: 'EDIT_RESULT', matchId: dialog.match.id, ...result }) }}
          onClose={() => setDialog(null)} />
      )}
      {dialog?.type === 'edit' && (
        <EditMatchDialog match={dialog.match} players={host.players} nameOf={nameOf}
          onSave={(slots) => { setDialog(null); send({ type: 'EDIT_PROPOSAL', matchId: dialog.match.id, teamA: [slots[0], slots[1]], teamB: [slots[2], slots[3]] }) }}
          onSkip={() => { setDialog(null); send({ type: 'SKIP_PROPOSAL', matchId: dialog.match.id }) }}
          onClose={() => setDialog(null)} />
      )}
      {dialog?.type === 'share' && (
        <Sheet title="Player board" onClose={() => setDialog(null)}>
          <div className="flex flex-col items-center gap-3 text-center">
            <QrCode url={viewerLink(window.location.origin, code)} size={220} />
            <p className="text-2xl font-bold tracking-[0.08em] text-pickle-neon">{formatPublicCode(code)}</p>
            <p className="text-sm text-mist">Players scan this to follow courts and standings. It can't change anything.</p>
          </div>
        </Sheet>
      )}
      {undo && (
        <UndoToast label={undo.label} savedAt={undo.savedAt} onDismiss={dismissUndo}
          onUndo={() => { setUndo(null); send({ type: 'UNDO_RESULT', matchId: undo.matchId }) }} />
      )}
    </div>
  )
}
```

- [ ] **Step 6: Build**

Run: `npx vitest run src/pickleball-open && npm run build`
Expected: PASS, and the build succeeds. The console is exercised in Task 18 (it needs the session page from Task 15 to mount).

- [ ] **Step 7: Commit**

CHANGELOG `### Added`: `- Host console for open play: a responsive courts grid, one-tap "Game over" with a score pad that fills the winning score, 2-minute undo, edit or skip a proposed game, late arrivals, breaks, result edits, CSV download, end and delete.`

```bash
git add src/pickleball-open/components CHANGELOG.md
git commit -m "feat(pickleball): host console with game over, undo and match editing"
```

---

### Task 15: Session page, viewer board, expired notice, resume banner

**Files:**
- Create:
  - `src/pages/pickleball/s/[code].astro`, `src/pickleball-open/SessionApp.jsx`
  - `src/pickleball-open/components/ViewerBoard.jsx`, `src/pickleball-open/components/ExpiredNotice.jsx`, `src/pickleball-open/ResumeBanner.jsx`
  - `src/pickleball-open/lib/myStatus.js`
- Test: `src/pickleball-open/lib/myStatus.test.js`

**Interfaces:**
- Consumes: `useOpenSession`, `hostKeyFromHash`, `hostKeyFor`, `rememberHostedSession`, `forgetHostedSession`, `hostedSessions`, `HostConsole`, `StandingsTable`, `TeamNames`.
- Produces:
  - `myStatus(viewer, playerId): { kind: 'PLAYING'|'UP_NEXT'|'WAITING'|'BREAK'|'NONE', court?: string, place?: number }`.
  - `ResumeBanner`, mounted on the landing page in Task 17.

- [ ] **Step 1: Write the failing test**

```js
// src/pickleball-open/lib/myStatus.test.js
import { describe, expect, it } from 'vitest'
import { myStatus } from './myStatus'

const viewer = {
  roster: [{ id: 'a', name: 'Ana' }, { id: 'b', name: 'Ben' }, { id: 'c', name: 'Cyd' }, { id: 'd', name: 'Dex' }],
  courts: [
    { label: 'Court 1', state: 'PLAYING', teamA: ['Ana', 'x'], teamB: ['y', 'z'] },
    { label: 'Court 3', state: 'UP_NEXT', teamA: ['Ben', 'x'], teamB: ['y', 'z'] },
  ],
  waiting: [{ id: 'q', name: 'Q' }, { id: 'c', name: 'Cyd' }],
  onBreak: [{ id: 'd', name: 'Dex' }],
}

describe('myStatus', () => {
  it('finds where a viewer is', () => {
    expect(myStatus(viewer, 'a')).toEqual({ kind: 'PLAYING', court: 'Court 1' })
    expect(myStatus(viewer, 'b')).toEqual({ kind: 'UP_NEXT', court: 'Court 3' })
    expect(myStatus(viewer, 'c')).toEqual({ kind: 'WAITING', place: 2 })
    expect(myStatus(viewer, 'd')).toEqual({ kind: 'BREAK' })
    expect(myStatus(viewer, 'zz')).toEqual({ kind: 'NONE' })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails, then implement**

Run: `npx vitest run src/pickleball-open/lib/myStatus.test.js`
Expected: FAIL.

```js
// src/pickleball-open/lib/myStatus.js
/** Where the player who picked "I'm …" on this phone is right now. */
export function myStatus(viewer, playerId) {
  const me = viewer?.roster?.find((p) => p.id === playerId)
  if (!me) return { kind: 'NONE' }
  for (const court of viewer.courts) {
    if (![...court.teamA, ...court.teamB].includes(me.name)) continue
    if (court.state === 'PLAYING') return { kind: 'PLAYING', court: court.label }
    if (court.state === 'UP_NEXT') return { kind: 'UP_NEXT', court: court.label }
  }
  const place = viewer.waiting.findIndex((w) => w.id === playerId)
  if (place >= 0) return { kind: 'WAITING', place: place + 1 }
  if (viewer.onBreak.some((p) => p.id === playerId)) return { kind: 'BREAK' }
  return { kind: 'NONE' }
}
```

Run the test again. Expected: PASS.

- [ ] **Step 3: Write the page and the session app**

```astro
---
// src/pages/pickleball/s/[code].astro
import PickleballAppShell from '../../../layouts/PickleballAppShell.astro'
import SessionApp from '../../../pickleball-open/SessionApp.jsx'
import { normalizePublicCode } from '../../../lib/pickleball/open/codes'

const code = normalizePublicCode(Astro.params.code ?? '') ?? ''
---
<PickleballAppShell title="Live board — Devlab Pickleball">
  <SessionApp code={code} client:only="react" />
</PickleballAppShell>
```

```jsx
// src/pickleball-open/SessionApp.jsx
import { useEffect, useMemo } from 'react'
import { forgetHostedSession, hostKeyFor, hostKeyFromHash, rememberHostedSession } from './lib/hostKeys'
import { useOpenSession } from './lib/useOpenSession'
import ExpiredNotice from './components/ExpiredNotice.jsx'
import HostConsole from './components/HostConsole.jsx'
import ViewerBoard from './components/ViewerBoard.jsx'

export default function SessionApp({ code }) {
  // The fragment is read once and removed from the address bar, so the key is
  // never left on screen or in a screenshot of the URL (spec §3.3).
  const hostKey = useMemo(() => {
    const fromHash = hostKeyFromHash(window.location.hash)
    if (fromHash) {
      window.history.replaceState(null, '', window.location.pathname)
      return fromHash
    }
    return hostKeyFor(code)
  }, [code])

  const { status, viewer, host, authFailed, setHost } = useOpenSession(code, hostKey)

  useEffect(() => {
    if (host && hostKey) rememberHostedSession({ code, hostKey, name: host.viewer.name })
  }, [host, hostKey, code])

  useEffect(() => {
    if (status === 'not-found') forgetHostedSession(code)
    if (authFailed) forgetHostedSession(code)
  }, [status, authFailed, code])

  if (!code || status === 'not-found') return <ExpiredNotice />
  if (host && hostKey && !authFailed) return <HostConsole code={code} hostKey={hostKey} host={host} status={status} onHost={setHost} />
  if (!viewer) return <p className="p-8 text-center text-mist" role="status">Loading the board…</p>
  return <ViewerBoard viewer={viewer} status={status} invalidHostLink={authFailed} />
}
```

- [ ] **Step 4: Write the viewer board, expired notice and resume banner**

```jsx
// src/pickleball-open/components/ViewerBoard.jsx
import { useState } from 'react'
import { myStatus } from '../lib/myStatus'
import StandingsTable from './StandingsTable.jsx'
import { Panel, TeamNames } from './ui.jsx'

const ME_KEY = (code) => `devlab-pickleball-me:${code}`

function readMe(code) {
  try { return globalThis.localStorage?.getItem(ME_KEY(code)) ?? '' } catch { return '' }
}
function writeMe(code, id) {
  try { globalThis.localStorage?.setItem(ME_KEY(code), id) } catch { /* optional convenience */ }
}

const COURT_STATE = { PLAYING: 'Playing', UP_NEXT: 'Walk on now', WAITING_FOR_PLAYERS: 'Waiting for players', OFF: 'Off' }

function MeBanner({ status }) {
  const text = {
    PLAYING: `You're playing on ${status.court}`,
    UP_NEXT: `You're up on ${status.court}: walk on`,
    WAITING: `You're #${status.place} in line`,
    BREAK: "You're on a break",
  }[status.kind]
  if (!text) return null
  return <p className="rounded-2xl bg-pickle-neon px-4 py-3 text-lg font-bold text-ink" role="status">{text}</p>
}

export default function ViewerBoard({ viewer, status, invalidHostLink }) {
  const [me, setMe] = useState(() => readMe(viewer.code))
  const [tab, setTab] = useState('courts')
  const mine = myStatus(viewer, me)
  const myName = viewer.roster.find((p) => p.id === me)?.name
  const expires = new Date(viewer.expiresAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  const section = (key) => `${tab === key ? 'block' : 'hidden'} lg:block`

  return (
    <main className="mx-auto grid max-w-[1500px] gap-4 px-3 pb-10 pt-4 sm:px-5">
      {invalidHostLink && <p role="alert" className="rounded-xl bg-amber-400/15 px-4 py-3 text-amber-100">That host link isn't valid for this session. You're seeing the player board.</p>}
      <header className="flex flex-wrap items-end gap-3">
        <div className="flex-1">
          <p className="flex items-center gap-2 text-xs font-bold text-pickle-neon">
            <span className={`h-2 w-2 rounded-full bg-pickle-neon ${viewer.status === 'ACTIVE' ? 'pb-pulse' : ''}`} aria-hidden="true" />
            {viewer.status === 'ACTIVE' ? 'LIVE' : 'ENDED'}{status !== 'open' && <span className="text-amber-200"> · reconnecting</span>}
          </p>
          <h1 className="text-2xl font-bold sm:text-3xl">{viewer.name}</h1>
          <p className="text-sm text-mist">Hosted by {viewer.hostDisplayName} · {viewer.courts.filter((c) => c.state !== 'OFF').length} courts</p>
        </div>
        <label className="grid gap-1 text-xs text-mist">I'm…
          <select value={me} onChange={(e) => { setMe(e.target.value); writeMe(viewer.code, e.target.value) }}
            className="min-h-11 rounded-xl border border-navy-700 bg-navy-900 px-3 text-base text-white">
            <option value="">Pick your name</option>
            {viewer.roster.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
      </header>

      <MeBanner status={mine} />

      <div className="grid grid-cols-3 gap-1 rounded-xl bg-navy-900 p-1 lg:hidden" role="tablist" aria-label="Board sections">
        {[['courts', 'Courts'], ['standings', 'Standings'], ['results', 'Results']].map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
            className={`min-h-11 rounded-lg text-sm ${tab === key ? 'bg-pickle-neon font-bold text-ink' : 'text-mist'}`}>{label}</button>
        ))}
      </div>

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
            <h2 className="font-bold">Waiting</h2>
            <ol className="mt-2 flex flex-wrap gap-1.5 text-sm">
              {viewer.waiting.map((w, i) => <li key={w.id} className={`rounded-full px-3 py-1 ${w.id === me ? 'bg-pickle-neon font-bold text-ink' : 'bg-navy-800'}`}>{i + 1} · {w.name}</li>)}
              {viewer.onBreak.map((p) => <li key={p.id} className="rounded-full bg-navy-900 px-3 py-1 text-mist">{p.name} · break</li>)}
            </ol>
          </Panel>
        </section>
        <aside className="grid content-start gap-4">
          <Panel className={section('standings')}><h2 className="mb-2 text-lg font-bold">Standings</h2><StandingsTable rows={viewer.standings} highlightId={me} /></Panel>
          <Panel className={section('results')}>
            <h2 className="mb-2 text-lg font-bold">Recent results</h2>
            {viewer.recentResults.length === 0 ? <p className="text-sm text-mist">No results yet.</p> : (
              <ul className="grid gap-1.5 text-sm">
                {viewer.recentResults.map((r) => (
                  <li key={r.matchId}>{r.courtLabel}: <b>{(r.winner === 'A' ? r.teamA : r.teamB).join(' · ')}</b> beat {(r.winner === 'A' ? r.teamB : r.teamA).join(' · ')}{r.scoreA !== null && ` ${Math.max(r.scoreA, r.scoreB)}–${Math.min(r.scoreA, r.scoreB)}`}</li>
                ))}
              </ul>
            )}
          </Panel>
        </aside>
      </div>
      <footer className="grid gap-3 pt-2 text-center">
        <p className="text-xs text-mist">Results are deleted 7 days after the last game ({expires}). No sign-up; this phone only remembers which name you picked.</p>
        <a href="/pickleball/new" className="mx-auto inline-flex min-h-11 items-center rounded-xl border border-navy-700 px-5 hover:bg-navy-900">Run your own games, free</a>
      </footer>
    </main>
  )
}
```

```jsx
// src/pickleball-open/components/ExpiredNotice.jsx
import ExpiredCourtArt from '../../components/pickleball/art/ExpiredCourtArt.jsx'

export default function ExpiredNotice() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-5 px-6 text-center">
      <div className="pb-anim w-56 text-mist"><ExpiredCourtArt className="w-full" /></div>
      <p className="text-xs font-bold uppercase tracking-[0.14em] text-pickle-neon">Game, set, done</p>
      <h1 className="text-3xl font-bold leading-tight">This session has ended and its results were deleted.</h1>
      <p className="text-mist">Sessions are cleared 7 days after their last game. That's how it stays free and keeps names private.</p>
      <a href="/pickleball/new" className="inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-brand text-lg font-bold text-white hover:bg-[#3a00d6]">Start your own session</a>
      <a href="/pickleball/how-it-works" className="text-sm text-pickle-neon hover:underline">How it works</a>
    </main>
  )
}
```

```jsx
// src/pickleball-open/ResumeBanner.jsx
import { useEffect, useState } from 'react'
import { forgetHostedSession, hostedSessions } from './lib/hostKeys'

/** "Welcome back" card on /pickleball for a host who closed the tab (spec What-if). Renders nothing otherwise. */
export default function ResumeBanner() {
  const [sessions, setSessions] = useState([])
  useEffect(() => setSessions(hostedSessions()), [])
  if (!sessions.length) return null
  const [latest] = sessions
  return (
    <section aria-label="Resume your session" className="mx-auto mt-6 max-w-3xl rounded-2xl bg-pickle-neon p-5 text-ink">
      <p className="text-xs font-bold tracking-[0.1em]">WELCOME BACK</p>
      <p className="mt-1 text-xl font-bold">{latest.name} is saved on this phone</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <a href={`/pickleball/s/${latest.code}`} className="inline-flex min-h-11 items-center rounded-xl bg-ink px-4 font-bold text-pickle-neon">Resume as host</a>
        <button type="button" className="min-h-11 rounded-xl px-3 underline" onClick={() => { forgetHostedSession(latest.code); setSessions(hostedSessions()) }}>Forget it</button>
      </div>
    </section>
  )
}
```

`ExpiredCourtArt` is created in Task 16. If this task runs first, create that file first: Task 16 Step 1 lists its full source.

- [ ] **Step 5: Build**

Run: `npx vitest run src/pickleball-open && npm run build`
Expected: PASS, and the build succeeds.

- [ ] **Step 6: Commit**

CHANGELOG `### Added`: `- /pickleball/s/<code>: the live player board (courts, "you're up next", waiting order, standings, results), the host console for whoever holds the host link, and a friendly page once a session has been deleted.`

```bash
git add src/pages/pickleball/s src/pickleball-open CHANGELOG.md
git commit -m "feat(pickleball): live qr board, session page and expired notice"
```

---

### Task 16: Animated art set

**Files:**
- Create: `src/components/pickleball/art/HeroRallyArt.jsx`, `PaddleStackArt.jsx`, `ScoreTapArt.jsx`, `QrBoardArt.jsx`, `ExpiredCourtArt.jsx` (all in that folder)

**Interfaces:**
- Produces five components, each `({ className }) => <svg viewBox … aria-hidden="true">`. They are animated only via the classes `pb-ball`, `pb-bob`, `pb-step`, `pb-pulse` and `pb-fade-cycle`, inside a `.pb-anim` wrapper.
- Unique viewBoxes, used as page markers in Task 17: Hero `0 0 480 300`, PaddleStack `0 0 360 200`, ScoreTap `0 0 220 200`, QrBoard `0 0 260 180`, ExpiredCourt `0 0 220 170`.

- [ ] **Step 1: Write the components**

Follow the header convention of `CourtSceneArt.jsx` (original, hand-authored, decorative, `aria-hidden`), with these colours:
- court `#3055d6` and `#7594fb`
- lines `#ffffff`
- ball `#c6ff2e`
- Team B `#8d9bff`
- paddles `#4500ff` and `#ffffff`

```jsx
// src/components/pickleball/art/HeroRallyArt.jsx
// Original, hand-authored SVG. Decorative (aria-hidden). Animates only via
// pickleball-open.css classes inside a .pb-anim wrapper; static otherwise.
export default function HeroRallyArt({ className = '' }) {
  return (
    <svg viewBox="0 0 480 300" fill="none" className={className} aria-hidden="true">
      <rect x="40" y="110" width="400" height="170" rx="10" fill="#3055d6" />
      <rect x="58" y="124" width="364" height="142" stroke="#fff" strokeWidth="2.5" />
      <rect x="196" y="124" width="88" height="142" fill="#4d72ef" stroke="#fff" strokeWidth="2.5" />
      <path d="M240 104v176" stroke="#fff" strokeWidth="5" strokeLinecap="round" />
      <path d="M92 190q148-170 296 0" stroke="#c6ff2e" strokeWidth="2" strokeDasharray="4 8" opacity="0.7" />
      <g className="pb-ball">
        <circle cx="96" cy="182" r="13" fill="#c6ff2e" />
        <circle cx="92" cy="178" r="1.8" fill="#0b1426" /><circle cx="100" cy="184" r="1.8" fill="#0b1426" /><circle cx="95" cy="188" r="1.8" fill="#0b1426" />
      </g>
      <g className="pb-bob" transform="rotate(-22 88 214)">
        <rect x="74" y="190" width="30" height="40" rx="14" fill="#4500ff" />
        <rect x="85" y="228" width="8" height="22" rx="3" fill="#11214d" />
      </g>
      <g className="pb-bob" style={{ animationDelay: '0.9s' }} transform="rotate(20 396 206)">
        <rect x="382" y="182" width="30" height="40" rx="14" fill="#fff" />
        <rect x="393" y="220" width="8" height="22" rx="3" fill="#b5c4e1" />
      </g>
      {[[120, 240], [170, 160], [310, 240], [360, 160]].map(([x, y], i) => (
        <g key={x} className="pb-bob" style={{ animationDelay: `${i * 0.3}s` }}>
          <circle cx={x} cy={y - 18} r="8" fill={i < 2 ? '#c6ff2e' : '#8d9bff'} />
          <path d={`M${x - 9} ${y + 4}q9-20 18 0`} stroke={i < 2 ? '#c6ff2e' : '#8d9bff'} strokeWidth="6" strokeLinecap="round" />
        </g>
      ))}
    </svg>
  )
}
```

```jsx
// src/components/pickleball/art/PaddleStackArt.jsx
// Original, hand-authored SVG. Decorative. Four waiting players step onto the free court in turn.
export default function PaddleStackArt({ className = '' }) {
  return (
    <svg viewBox="0 0 360 200" fill="none" className={className} aria-hidden="true">
      <rect x="190" y="30" width="150" height="140" rx="8" fill="#3055d6" />
      <path d="M190 100h150" stroke="#fff" strokeWidth="3" />
      <rect x="200" y="40" width="130" height="120" stroke="#fff" strokeWidth="2" />
      <rect x="20" y="40" width="120" height="120" rx="12" stroke="#7594fb" strokeWidth="2" strokeDasharray="5 6" />
      {[0, 1, 2, 3].map((i) => (
        <g key={i} className="pb-step" style={{ animationDelay: `${i * 0.25}s`, '--pb-step-x': `${190 + (i % 2) * 70}px` }}>
          <circle cx={50 + (i % 2) * 40} cy={70 + Math.floor(i / 2) * 50} r="10" fill={i < 2 ? '#c6ff2e' : '#8d9bff'} />
        </g>
      ))}
      <path d="M150 100h30m-8-7 8 7-8 7" stroke="#c6ff2e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
```

```jsx
// src/components/pickleball/art/ScoreTapArt.jsx
// Original, hand-authored SVG. Decorative. A phone showing a saved 11–7 with a pulsing tap target.
export default function ScoreTapArt({ className = '' }) {
  return (
    <svg viewBox="0 0 220 200" fill="none" className={className} aria-hidden="true">
      <rect x="60" y="10" width="100" height="180" rx="16" fill="#11214d" stroke="#7594fb" strokeWidth="2" />
      <rect x="72" y="34" width="76" height="40" rx="8" fill="#c6ff2e" />
      <path d="M86 54h48" stroke="#0b1426" strokeWidth="6" strokeLinecap="round" />
      <text x="110" y="112" textAnchor="middle" fontFamily="Plus Jakarta Sans, sans-serif" fontWeight="700" fontSize="30" fill="#fff">11–7</text>
      <rect x="76" y="136" width="68" height="30" rx="10" fill="#4500ff" />
      <circle className="pb-pulse" cx="150" cy="160" r="16" stroke="#c6ff2e" strokeWidth="3" />
    </svg>
  )
}
```

```jsx
// src/components/pickleball/art/QrBoardArt.jsx
// Original, hand-authored SVG. Decorative. A QR card beaming the board to a phone.
export default function QrBoardArt({ className = '' }) {
  const cells = [[0, 0], [2, 0], [4, 1], [1, 2], [3, 2], [0, 4], [2, 3], [4, 4], [3, 4]]
  return (
    <svg viewBox="0 0 260 180" fill="none" className={className} aria-hidden="true">
      <rect x="16" y="30" width="110" height="110" rx="12" fill="#fff" />
      {[[28, 42], [86, 42], [28, 100]].map(([x, y]) => <rect key={`${x}${y}`} x={x} y={y} width="28" height="28" rx="4" stroke="#0b1426" strokeWidth="6" />)}
      {cells.map(([cx, cy]) => <rect key={`${cx}-${cy}`} x={64 + cx * 9} y={70 + cy * 9} width="7" height="7" fill="#0b1426" />)}
      <path className="pb-fade-cycle" d="M136 84c20-12 40-12 60 0M142 98c14-8 28-8 42 0" stroke="#c6ff2e" strokeWidth="3" strokeLinecap="round" />
      <rect x="196" y="40" width="50" height="96" rx="10" fill="#11214d" stroke="#7594fb" strokeWidth="2" />
      <rect className="pb-fade-cycle" x="204" y="56" width="34" height="12" rx="3" fill="#c6ff2e" />
      <rect x="204" y="74" width="34" height="8" rx="3" fill="#7594fb" />
      <rect x="204" y="88" width="34" height="8" rx="3" fill="#7594fb" />
    </svg>
  )
}
```

```jsx
// src/components/pickleball/art/ExpiredCourtArt.jsx
// Original, hand-authored SVG. Decorative. A quiet court with a resting ball.
export default function ExpiredCourtArt({ className = '' }) {
  return (
    <svg viewBox="0 0 220 170" fill="none" className={className} aria-hidden="true">
      <rect x="20" y="60" width="180" height="96" rx="6" fill="#11214d" />
      <rect x="32" y="70" width="156" height="76" stroke="#7594fb" strokeWidth="2" />
      <path d="M110 60v96" stroke="#7594fb" strokeWidth="4" />
      <g className="pb-bob"><circle cx="150" cy="134" r="12" fill="#c6ff2e" /></g>
      <path className="pb-fade-cycle" d="M140 38h12l-12 12h12M162 24h9l-9 9h9" stroke="#b5c4e1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

CHANGELOG `### Added`: `- Five new animated pickleball illustrations (rally, paddle stack, score tap, QR board, quiet court), CSS-only, stopped for reduced motion.`

```bash
git add src/components/pickleball/art CHANGELOG.md
git commit -m "feat(pickleball): animated vector art for the open play pages"
```

---

### Task 17: Public pages rewritten (landing, guide, rotation), SEO and share image

**Files:**
- Modify:
  - `src/pages/pickleball/index.astro` (full rewrite), `src/pages/pickleball/how-it-works.astro` (full rewrite)
  - `src/data/seoContent.js`, `src/config/publicRoutes.ts`
  - `scripts/og/pickleball-card.html`, `public/og-pickleball.png`
- Create: `src/pages/pickleball/rotation.astro`, `src/lib/pickleball/open/rotationExample.ts`
- Test:
  - `src/lib/pickleball/open/rotationExample.test.ts`
  - `tests/e2e/pickleball/pickleball-public-pages.spec.js`: replace every test that targets `/pickleball` or `/pickleball/how-it-works`, and keep the `/pickleball/methodology` tests unchanged.

**Interfaces:**
- Consumes: the art from Task 16, `ResumeBanner` (Task 15), `fillProposals` (Task 5), `Layout.astro`, `loadPageSeo`, and the existing `ContactForm`.
- Produces: `rotationExample(): Array<{ round: number; courts: Array<{ label: string; teamA: string[]; teamB: string[] }>; sittingOut: string[] }>`, which is deterministic.

- [ ] **Step 1: Write the failing test for the build-time rotation example**

```ts
// src/lib/pickleball/open/rotationExample.test.ts
import { describe, expect, it } from 'vitest'
import { rotationExample } from './rotationExample'

describe('rotationExample', () => {
  it('14 players on 3 courts: 12 play each round, 2 sit out, and nobody sits out twice in a row', () => {
    const rounds = rotationExample()
    expect(rounds).toHaveLength(4)
    for (const round of rounds) {
      expect(round.courts).toHaveLength(3)
      expect(round.sittingOut).toHaveLength(2)
    }
    for (let i = 1; i < rounds.length; i += 1) {
      for (const name of rounds[i].sittingOut) expect(rounds[i - 1].sittingOut).not.toContain(name)
    }
  })
})
```

- [ ] **Step 2: Run the test to verify it fails, then implement**

Run: `npx vitest run src/lib/pickleball/open/rotationExample.test.ts`
Expected: FAIL.

```ts
// src/lib/pickleball/open/rotationExample.ts
// The /pickleball/rotation page's worked example is COMPUTED by the real
// engine at build time (spec §11), so the explanation can never describe a
// rotation the app does not actually produce.
import { fillProposals } from './propose'
import { DEFAULT_SETTINGS, type OpenMatch, type OpenSessionState } from './types'

const NAMES = ['Ana', 'Ben', 'Carlo', 'Dina', 'Eli', 'Fay', 'Gio', 'Hana', 'Ivan', 'Jun', 'Kat', 'Leo', 'Mia', 'Nico']
const T0 = Date.parse('2026-01-01T09:00:00.000Z')
const iso = (minute: number) => new Date(T0 + minute * 60_000).toISOString()

export function rotationExample(rounds = 4) {
  let n = 0
  const ctx = (minute: number) => ({ now: iso(minute), newId: () => `x${(n += 1)}` })
  let state: OpenSessionState = {
    id: 'example', publicCode: 'EXAMPLE234', kind: 'OPEN_PLAY', name: 'Example', hostDisplayName: 'Host', location: null,
    status: 'ACTIVE', settings: DEFAULT_SETTINGS, version: 1, createdAt: iso(0), lastActivityAt: iso(0), expiresAt: iso(10_000),
    players: NAMES.map((name, i) => ({ id: name, name, skill: null, duprId: null, status: 'ACTIVE', gamesOffset: 0, joinedAt: iso(0), waitingSince: iso(0), position: i + 1 })),
    courts: [1, 2, 3].map((p) => ({ id: `c${p}`, label: `Court ${p}`, position: p, enabled: true })),
    matches: [],
  }
  const out = []
  let minute = 0
  for (let round = 1; round <= rounds; round += 1) {
    minute += 1
    state = fillProposals(state, ctx(minute))
    const live = state.matches.filter((m) => m.status === 'PROPOSED')
    const seated = new Set(live.flatMap((m) => [...m.teamA, ...m.teamB]))
    out.push({
      round,
      courts: live.map((m) => ({ label: state.courts.find((c) => c.id === m.courtId)!.label, teamA: [...m.teamA], teamB: [...m.teamB] })),
      sittingOut: NAMES.filter((name) => !seated.has(name)),
    })
    minute += 12
    state = {
      ...state,
      matches: state.matches.map((m): OpenMatch => (m.status === 'PROPOSED'
        ? { ...m, status: 'FINISHED', startedAt: iso(minute - 11), finishedAt: iso(minute), winner: m.seq % 2 ? 'A' : 'B', scoreA: 11, scoreB: 7 }
        : m)),
      players: state.players.map((p) => (seated.has(p.id) ? { ...p, waitingSince: iso(minute) } : p)),
    }
  }
  return out
}
```

Run the test again. Expected: PASS.

- [ ] **Step 3: Rewrite the e2e copy guards first (they fail until the pages change)**

In `tests/e2e/pickleball/pickleball-public-pages.spec.js`:
- Keep the `mainCopy` helper.
- Keep every test whose `path` is `/pickleball/methodology`.
- Keep the favicon loop, changing its paths to `['/pickleball', '/pickleball/how-it-works', '/pickleball/rotation', '/pickleball/new']`.
- Keep the OG loop, changing its paths to `['/pickleball', '/pickleball/how-it-works', '/pickleball/rotation']`.
- Change the `artPages` entries for the landing and guide to `{ path: '/pickleball', htmlMarker: 'Run every court from one phone.', viewBox: '0 0 480 300' }`, `{ path: '/pickleball/how-it-works', htmlMarker: 'How to run open play with Devlab Pickleball', viewBox: '0 0 220 200' }` and `{ path: '/pickleball/rotation', htmlMarker: 'How fair rotation works', viewBox: '0 0 360 200' }`.
- Delete every other test that asserted the old landing or guide copy. Then add:

```js
  test('the landing page leads with starting a free session', async ({ page }) => {
    const response = await page.goto('/pickleball')
    expect(response.status()).toBe(200)
    await expect(page.locator('main h1')).toHaveText('Run every court from one phone.')
    await expect(page.getByRole('link', { name: 'Start a free session' }).first()).toHaveAttribute('href', '/pickleball/new')
    await expect(page.getByRole('link', { name: 'See how it works' })).toHaveAttribute('href', '/pickleball/how-it-works')
    await expect(page.getByRole('link', { name: 'Operator sign in' })).toHaveCount(0)
  })

  for (const path of ['/pickleball', '/pickleball/how-it-works', '/pickleball/rotation']) {
    test(`claims only what Phase 1 ships (${path})`, async ({ page }) => {
      await page.goto(path)
      const copy = (await mainCopy(page)).toLowerCase()
      // Whole words only: a bare substring check would flag "opi" inside "copied".
      for (const unshipped of ['tournament', 'bracket', 'dupr', 'captain', 'tv mode', 'sign in', 'opi', 'performance index', 'rally-by-rally', 'winners vs winners', 'mexicano']) {
        expect(copy, `"${unshipped}" on ${path}`).not.toMatch(new RegExp(`\\b${unshipped.replace(/[-]/g, '\\-')}`))
      }
    })

    test(`animations stop for reduced motion (${path})`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.goto(path)
      const running = await page.locator('.pb-anim *').evaluateAll((nodes) => nodes.filter((n) => getComputedStyle(n).animationName !== 'none').length)
      expect(running).toBe(0)
    })

    test(`no horizontal scroll at phone width (${path})`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto(path)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    })
  }

  test('the landing page pins its key promises', async ({ page }) => {
    await page.goto('/pickleball')
    const copy = await mainCopy(page)
    for (const claim of ['Free', 'No sign-up', '7 days', 'fewest games']) expect(copy).toContain(claim)
  })
```

Run: `npx playwright test tests/e2e/pickleball/pickleball-public-pages.spec.js --project=worker`
Expected: the new landing, guide and rotation tests FAIL. The methodology tests still PASS.

- [ ] **Step 4: Rewrite `/pickleball`**

Replace the whole of `src/pages/pickleball/index.astro`. Keep the existing `accessFormCopy` object and the `<section id="request-access">` block (from the current file, lines 223–232), retitled as shown.

```astro
---
import Layout from '../../layouts/Layout.astro'
import HeroRallyArt from '../../components/pickleball/art/HeroRallyArt.jsx'
import PaddleStackArt from '../../components/pickleball/art/PaddleStackArt.jsx'
import ScoreTapArt from '../../components/pickleball/art/ScoreTapArt.jsx'
import QrBoardArt from '../../components/pickleball/art/QrBoardArt.jsx'
import ResumeBanner from '../../pickleball-open/ResumeBanner.jsx'
import ContactForm from '../../components/islands/ContactForm.jsx'
import { resolveTurnstileSiteKey } from '../../lib/turnstileSiteKey'
import { loadPageSeo } from '../../lib/content/seo'
import '../../styles/pickleball-open.css'

const seo = await loadPageSeo('pickleball')
const turnstileSiteKey = resolveTurnstileSiteKey(Astro.request.url)
// subjectPlaceholder is kept verbatim: the /api/contact subject handling for
// this form depends on it (CHANGELOG, "legacy /api/contact subject").
const accessFormCopy = {
  nameLabel: 'Your name',
  subjectLabel: 'Subject',
  subjectPlaceholder: 'Pickleball early access request',
  messageLabel: 'Tell us about your club',
  messagePlaceholder: 'Your club or venue, how many players and courts, and how often you run open play.',
  submitLabel: 'Send',
  helperText: 'We read every message personally.',
}

const steps = [
  { Art: PaddleStackArt, title: 'Add your players', body: 'Paste a list from Reclub, WhatsApp or anywhere. Numbering, emoji and duplicates are cleaned up for you. Late arrivals can join any time.' },
  { Art: ScoreTapArt, title: 'Tap the score when a game ends', body: 'Pick the winner and the losing score; the winning score fills itself in. The next fair match is ready on that court straight away.' },
  { Art: QrBoardArt, title: 'Everyone follows by QR', body: 'Players scan one code to see who is on every court, who is up next and the standings. No app, no account.' },
]

const features = [
  { title: 'Fair rotation', body: 'Paddle stack: fewest games first, then longest wait. Partners rotate so nobody gets the same partner twice when there is another way to split the four.' },
  { title: 'One person, every court', body: 'Up to 16 courts on one screen. Any proposed game can be edited before it starts, and a wrong score can be undone or fixed.' },
  { title: 'Free, with no sign-up', body: 'No accounts for the host or the players. Your host link is your key; the board link is view-only.' },
  { title: 'Private by default', body: 'Results are deleted 7 days after the last game. Download them as a spreadsheet any time before then.' },
]

const faqs = [
  { q: 'Is it really free?', a: 'Yes. Every court, every player, no paid tier.' },
  { q: 'Do players need an app or an account?', a: 'No. They scan the QR code or open the link in any browser. Nobody signs up.' },
  { q: 'What if I close the tab?', a: 'Nothing is lost: every tap is saved on our servers. Open the site on the same phone and choose “Resume as host”, or open your host link on another device.' },
  { q: 'How long are results kept?', a: 'Until 7 days after the last change to the session, then they are deleted. You can download a CSV of every game and the standings before that.' },
  { q: 'Can I use it on a tablet, laptop or big screen?', a: 'Yes. The courts reflow to fit any screen, from a phone to a wide monitor.' },
]
---
<Layout title="Devlab Pickleball: free open play manager" seo={seo}>
  <div class="mx-auto max-w-6xl px-4 py-10 md:py-16">
    <section class="grid items-center gap-10 md:grid-cols-[1.1fr_1fr]">
      <div>
        <p class="text-xs font-bold uppercase tracking-[0.14em] text-[#c6ff2e]">Free · No sign-up · Up to 16 courts</p>
        <h1 class="mt-3 text-4xl font-bold leading-[1.05] text-white md:text-6xl">Run every court from one phone.</h1>
        <p class="mt-4 max-w-xl text-lg text-[#b5c4e1]">Add players, tap the score when a game ends, and the next fair match is ready. Everyone follows along by QR.</p>
        <div class="mt-7 flex flex-wrap gap-3">
          <a href="/pickleball/new" class="inline-flex min-h-12 items-center rounded-xl bg-[#4500ff] px-6 text-lg font-bold text-white hover:bg-[#3a00d6]">Start a free session</a>
          <a href="/pickleball/how-it-works" class="inline-flex min-h-12 items-center rounded-xl border border-[#193480] px-6 font-semibold text-white hover:bg-[#11214d]">See how it works</a>
        </div>
      </div>
      <div class="pb-anim" data-testid="pb-artwork"><HeroRallyArt className="w-full" /></div>
    </section>

    <ResumeBanner client:load />

    <section class="mt-20" aria-labelledby="steps-heading">
      <h2 id="steps-heading" class="text-3xl font-bold text-white">Three steps, then just play</h2>
      <ol class="mt-8 grid gap-5 md:grid-cols-3">
        {steps.map(({ Art, title, body }, index) => (
          <li class="rounded-2xl bg-[#11214d] p-6">
            <div class="pb-anim h-36 text-white" data-testid="pb-artwork"><Art className="h-full w-full" /></div>
            <p class="mt-4 text-sm font-bold text-[#c6ff2e]">Step {index + 1}</p>
            <h3 class="mt-1 text-xl font-bold text-white">{title}</h3>
            <p class="mt-2 text-[#b5c4e1]">{body}</p>
          </li>
        ))}
      </ol>
    </section>

    <section class="mt-20 grid gap-4 md:grid-cols-2" aria-label="Features">
      {features.map(({ title, body }) => (
        <div class="rounded-2xl border border-[#193480] p-6">
          <h3 class="text-xl font-bold text-white">{title}</h3>
          <p class="mt-2 text-[#b5c4e1]">{body}</p>
        </div>
      ))}
    </section>

    <section class="mt-20" aria-labelledby="faq-heading">
      <h2 id="faq-heading" class="text-3xl font-bold text-white">Questions</h2>
      <div class="mt-6 grid gap-3">
        {faqs.map(({ q, a }) => (
          <details class="rounded-2xl bg-[#11214d] p-5">
            <summary class="cursor-pointer text-lg font-semibold text-white">{q}</summary>
            <p class="mt-2 text-[#b5c4e1]">{a}</p>
          </details>
        ))}
      </div>
    </section>

    <section id="request-access" class="mt-20 scroll-mt-24">
      <h2 class="text-3xl font-semibold text-white">Running a club or venue?</h2>
      <p class="mt-3 max-w-2xl text-[#b5c4e1]">Tell us about your sessions and we'll help you set it up.</p>
      <div class="mt-8 rounded-2xl bg-white/[0.92] p-6 ring-1 ring-slate-200">
        <ContactForm client:visible siteKey={turnstileSiteKey} copy={accessFormCopy} />
      </div>
    </section>
  </div>
</Layout>
```

Before deleting the old file's content, check how its markup sets text colour on the dark public shell (for example `.public-shell` class mappings). If `Layout.astro` forces a light surface, keep explicit hex colours as written above, so contrast never depends on the shell's class remapping.

- [ ] **Step 5: Rewrite `/pickleball/how-it-works` and add `/pickleball/rotation`**

`how-it-works.astro`:
- Same imports, `Layout` and `loadPageSeo('pickleball-how-it-works')` as the landing page.
- `<h1>`: `How to run open play with Devlab Pickleball`.
- Hero art: `ScoreTapArt` (viewBox `0 0 220 200`) inside `.pb-anim[data-testid="pb-artwork"]`.
- An ordered list of these eight steps, each an `<li>` with an `<h2>` and a `<p>`, with the copy exactly as written:

  1. **Start a session.** Open "Start a free session", name it, choose how many courts and what games go to (11, 15, 21 or winner only). No account needed.
  2. **Add players.** Paste your list or upload a CSV. Numbering, emoji and duplicates are removed.
  3. **Save your host link, share the board.** Your host link controls the session; keep it. Show players the QR code for the view-only board.
  4. **Start the proposed game.** Each free court shows the next four players. Tap Start, or tap Edit to swap anyone first. Players never belong to a court: whichever court frees first gets the next match.
  5. **Tap the result.** When a game ends, tap Game over, pick the winner and the losing score. The winning score fills in, and the court gets its next match.
  6. **Late arrivals and breaks.** Add players any time; they start level with whoever has played least. Put someone on a break and they are skipped until you bring them back.
  7. **Fix a mistake.** Undo a save for 2 minutes, or edit any result later. Standings update straight away.
  8. **Finish up.** End the session and download the results as a CSV. Everything is deleted 7 days after the last change, or delete it yourself any time.

- Close with a link "Start a free session" → `/pickleball/new`.

`rotation.astro`:
- `Layout`, with `loadPageSeo('pickleball-rotation')`.
- `<h1>`: `How fair rotation works`.
- `PaddleStackArt` in `.pb-anim[data-testid="pb-artwork"]`.
- A rules list:
  - Fewest games first.
  - Then longest wait.
  - Anyone who has sat out 2 rounds in a row goes on next.
  - The four are split into teams so earlier partners are kept apart when another split allows it.
  - A late arrival starts level with whoever has played least.
- Then the computed example: `const rounds = rotationExample()` in the frontmatter, rendered as one card per round. Each card lists its courts with `teamA.join(' & ')` vs `teamB.join(' & ')`, and "Sitting out: …".
- A footnote: "With up to 12 players per court, nobody sits out more than 2 rounds in a row. With more, the wait is shared evenly."

- [ ] **Step 6: SEO defaults, sitemap and share image**

In `src/data/seoContent.js`, replace the `seo-pickleball` and `seo-pickleball-how-it-works` entries' title, description and OG/Twitter text, and add `seo-pickleball-rotation` with the same `ogImage`:

```js
      metaTitle: 'Free Pickleball Open Play Manager: Devlab Pickleball',
      metaDescription: 'Run pickleball open play free, with no sign-up: fair paddle-stack rotation for up to 16 courts, one-tap results, and a live QR board players follow on their own phones.',
      metaKeywords: 'free pickleball open play app, pickleball court rotation, paddle stack app, pickleball queue, open play scheduler, pickleball live board',
      ogTitle: 'Run every pickleball court from one phone. Free.',
      ogDescription: 'Fair rotation, one-tap results and a live QR board. No sign-up.',
      twitterTitle: 'Run every pickleball court from one phone. Free.',
      twitterDescription: 'Fair rotation, one-tap results and a live QR board. No sign-up.',
```

Guide: title `How to Run Pickleball Open Play: Devlab Pickleball Guide`, description `Step by step: start a free session, add players, start proposed games, tap results, handle late arrivals and breaks, and download results.`

Rotation: `pageSlug: 'pickleball-rotation'`, `canonicalUrl: 'https://www.devlabstudios.com/pickleball/rotation'`, title `How Fair Rotation Works: Devlab Pickleball`, description `The exact rules behind paddle-stack rotation, with a worked example computed by the app itself.`

In `src/config/publicRoutes.ts`, add `{ path: '/pickleball/how-it-works', … }` if it is absent, plus `{ path: '/pickleball/rotation', changefreq: 'monthly', priority: '0.5' }` and `{ path: '/pickleball/new', changefreq: 'monthly', priority: '0.6' }`.

Share image:
- Edit `scripts/og/pickleball-card.html` with the new headline "Run every court from one phone. Free.", ink `#0b1426` ground, the neon `#c6ff2e` ball and a violet `#4500ff` CTA chip.
- Render it:

Run: `npx playwright screenshot --viewport-size=1200,630 "file://$PWD/scripts/og/pickleball-card.html" public/og-pickleball.png`
Expected: a 1200×630 PNG. Open it and check that it reads clearly.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm run build && npx playwright test tests/e2e/pickleball/pickleball-public-pages.spec.js tests/e2e/public-pages.spec.js`
Expected: PASS. If the SEO coverage test complains about the new routes, add their `seoContent` entries.

- [ ] **Step 8: Commit**

CHANGELOG `### Changed`: `- The pickleball pages are rewritten around free, no-sign-up open play: a new landing page with animated art and FAQ, a step-by-step host guide, and a new "How fair rotation works" page whose example is computed by the app's own rotation engine. The old operator sign-in link is gone from the landing page.`

```bash
git add src/pages/pickleball src/lib/pickleball/open/rotationExample* src/data/seoContent.js src/config/publicRoutes.ts scripts/og public/og-pickleball.png tests/e2e/pickleball/pickleball-public-pages.spec.js CHANGELOG.md
git commit -m "feat(pickleball): rewrite public pages for free open play"
```

---

### Task 18: End-to-end user flows and responsive checks

**Files:**
- Modify: `tests/e2e/pickleball/open-play.spec.js` (append a UI section)

**Interfaces:**
- Consumes: everything above. Reuses `createSession` from the same file.

- [ ] **Step 1: Write the UI tests**

```js
// Append to tests/e2e/pickleball/open-play.spec.js
test.describe('open play UI', () => {
  test('a host creates a session in the browser and lands on the console', async ({ page }) => {
    await page.goto('/pickleball/new')
    await page.getByLabel('Your name (shown as "Hosted by")').fill('Coach Mike')
    await page.getByRole('button', { name: 'Next: add players' }).click()
    await page.getByLabel(/Paste names/).fill('1. Ana\n2. Ben\nCarlo, Dina, Eli\nFay\nGio\nHana\nben')
    await expect(page.getByText('8 players found')).toBeVisible()
    await page.getByRole('button', { name: /^Start session/ }).click()
    await expect(page.getByRole('heading', { name: 'Two links. Keep the first one to yourself.' })).toBeVisible()
    await page.getByRole('link', { name: 'I saved it — go to courts' }).click()
    await expect(page.getByTestId('court-1')).toContainText('Up next')
    expect(page.url()).not.toContain('#host=')
  })

  test('saving a result updates a second screen and offers undo', async ({ page, browser, request }) => {
    const { code, hostKey } = await createSession(request)
    await page.goto(`/pickleball/s/${code}#host=${hostKey}`)
    const viewerContext = await browser.newContext()
    const viewer = await viewerContext.newPage()
    await viewer.goto(`/pickleball/s/${code}`)
    await expect(viewer.getByText('Walk on now').first()).toBeVisible()

    await page.getByTestId('court-1').getByRole('button', { name: 'Start' }).click()
    await expect(viewer.getByText('Playing').first()).toBeVisible()

    await page.getByTestId('court-1').getByRole('button', { name: 'Game over' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('radio').first().click()
    await dialog.getByRole('button', { name: '7', exact: true }).click()
    await dialog.getByRole('button', { name: 'Save 11–7' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'saved 11–7' })).toBeVisible()
    await expect(viewer.getByText('11–7')).toBeVisible()

    await page.getByRole('button', { name: /^Undo/ }).click()
    await expect(viewer.getByText('11–7')).toHaveCount(0)
    await viewerContext.close()
  })

  test('a deuce score is accepted from the pad', async ({ page, request }) => {
    const { code, hostKey } = await createSession(request)
    await page.goto(`/pickleball/s/${code}#host=${hostKey}`)
    await page.getByTestId('court-1').getByRole('button', { name: 'Already played? Enter result' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('radio').nth(1).click()
    await dialog.getByRole('button', { name: '13', exact: true }).click()
    await expect(dialog.getByRole('button', { name: 'Save 13–15' })).toBeEnabled()
  })

  test('closing the tab loses nothing: the landing page offers to resume', async ({ page, request }) => {
    const { code, hostKey } = await createSession(request, { name: 'Resume Me' })
    await page.goto(`/pickleball/s/${code}#host=${hostKey}`)
    await expect(page.getByTestId('court-1')).toBeVisible()
    await page.goto('/pickleball')
    await expect(page.getByText('Resume Me is saved on this phone')).toBeVisible()
    await page.getByRole('link', { name: 'Resume as host' }).click()
    await expect(page.getByTestId('court-1')).toBeVisible()
  })

  test('an unknown or deleted code shows the ended notice', async ({ page }) => {
    await page.goto('/pickleball/s/ZZZZZ22222')
    await expect(page.getByRole('heading', { name: 'This session has ended and its results were deleted.' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Start your own session' })).toHaveAttribute('href', '/pickleball/new')
  })

  for (const width of [390, 768, 1280, 1920]) {
    test(`console and board fit a ${width}px screen without sideways scrolling`, async ({ page, request }) => {
      const { code, hostKey } = await createSession(request, { courtCount: 8, players: Array.from({ length: 30 }, (_, i) => ({ name: `Player ${i + 1}` })) })
      await page.setViewportSize({ width, height: 900 })
      await page.goto(`/pickleball/s/${code}#host=${hostKey}`)
      await expect(page.getByTestId('court-1')).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await page.goto(`/pickleball/s/${code}`)
      await expect(page.getByText('Walk on now').first()).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    })
  }
})
```

- [ ] **Step 2: Run them**

Run: `npx playwright test tests/e2e/pickleball/open-play.spec.js --project=worker`
Expected: PASS. A failure here is a real bug in Tasks 12–15: fix the component, not the test, unless the test is wrong about the spec.

- [ ] **Step 3: Run everything**

Run: `npm run typecheck && npm run lint && npm run build && npm run test:unit && npx playwright test`
Expected: all green. The old operator suites must still pass, because the old app is untouched.

- [ ] **Step 4: Commit**

CHANGELOG: no new user-facing line (tests only).

```bash
git add tests/e2e/pickleball/open-play.spec.js
git commit -m "test(pickleball): end-to-end open play flows at four screen widths"
```

---

### Task 19: Docs, release to preview, then production

**Files:**
- Modify:
  - `docs/pickleball/architecture.md`: add a "Free open play (2026-10)" section at the top, and correct the phase table (C2–C5 shipped).
  - `docs/pickleball/runbook.md`: add the open-play migration, purge and troubleshooting.
  - `CHANGELOG.md`, `package.json`, `package-lock.json`.

- [ ] **Step 1: Write the docs**

`architecture.md` new section (keep it short and factual):
- Purpose.
- The `open_*` tables.
- The `OpenSessionDO` pattern (load once, diff-batch, broadcast).
- Host key model.
- Routes list.
- Retention and purge.
- A statement that the operator app below is legacy until Phase 5.

In the phase table, add rows C2–C5 as Complete, with their commit references from `git log --oneline -- src/lib/pickleball/tournament`.

`runbook.md`:
- Applying `0016` locally, to preview and to production.
- How to inspect a session by code: `SELECT id, status, expires_at FROM open_sessions WHERE public_code = ?`.
- How to force-delete one: `DELETE FROM open_sessions WHERE public_code = ?`, after reading it first.
- What the purge log line looks like: `pickleball_open.purge`.

- [ ] **Step 2: Commit the docs**

```bash
git add docs/pickleball CHANGELOG.md
git commit -m "docs(pickleball): document free open play and the corrected phase history"
```

- [ ] **Step 3: Push the branch and fast-forward `development`**

Run: `git push origin development`
Expected: the preview deploy workflow runs.

- [ ] **Step 4: Apply the migration to the preview D1**

Ask the user to paste a fresh `CLOUDFLARE_API_TOKEN` for this one command (`AGENTS.md`). Use it inline and never write it anywhere.

Run: `CLOUDFLARE_API_TOKEN=<pasted> npx wrangler d1 migrations apply devlab-pickleball-preview --remote --env preview`
Expected: `0016_open_sessions.sql` applied.

Read back: `CLOUDFLARE_API_TOKEN=<pasted> npx wrangler d1 execute devlab-pickleball-preview --remote --env preview --command "SELECT name FROM sqlite_master WHERE name LIKE 'open_%'"`
Expected: five `open_*` tables.

Check the CMS SEO rows on preview before relying on the new defaults:

Run: `CLOUDFLARE_API_TOKEN=<pasted> npx wrangler d1 execute devlab-studios-cms-preview --remote --env preview --command "SELECT page_slug, meta_title FROM seo WHERE page_slug LIKE 'pickleball%'"`

If rows exist that override the old copy, update only those rows' text fields with a targeted `UPDATE … WHERE page_slug = ?`, after showing the user the before and after. If the table or column names differ, read `src/lib/content/seo.ts` for the real names first.

- [ ] **Step 5: Verify on the preview URL**

On `https://devlab-studios-preview.stpnrey-agustinez.workers.dev`:
- Create a session on a real phone and on a laptop.
- Run 2 courts for 3 games, with one undo and one edit.
- Open the board on a second device and check it updates.
- Close the tab, then resume from `/pickleball`.
- Download the CSV.
- Delete the session and confirm the board shows the ended notice.

Report what was checked, and any failure, to the user before going further.

- [ ] **Step 6: Release**

Once the user confirms the preview run:

1. Bump `package.json` and `package-lock.json` to the next MINOR version. Edit only the two root `"version"` fields in the lock file, then `git diff package-lock.json` to confirm nothing else changed.
2. Retitle `[Unreleased]` to `## [X.Y.0] - YYYY-MM-DD` and add a fresh `[Unreleased]`.
3. Commit as `chore: release X.Y.0 - free open play`.
4. Ask for a fresh token and apply `0016` to production:

```bash
CLOUDFLARE_API_TOKEN=<pasted> npx wrangler d1 migrations apply devlab-pickleball --remote
```

5. Read the production tables back as in Step 4, and do the same SEO-row check against `devlab-studios-cms` (no `--env`).
6. Fast-forward `main` to `development` and `git push origin main` (Workers Builds deploys it; CI tags the release). Then confirm `development` and `main` point at the same commit.
7. Smoke-test production: create, run one game, view the board, delete.

- [ ] **Step 7: Housekeeping**

Stop any local `wrangler dev` or `npm run preview` servers this work started (`tasklist //FI "IMAGENAME eq node.exe"`).

---

## Self-review notes (for the executor)

- **Spec coverage for Phase 1 (§14 row 1):**
  - anonymous create with Turnstile and limits: T10
  - roster paste, manual entry and CSV: T3, T13, T14
  - courts: T6, T14
  - paddle stack: T5
  - final score with undo and edit: T2, T6, T14
  - proposal editing: T6, T14
  - live QR board: T15
  - results CSV: T7, T10, T14
  - 7-day expiry through the cron: T6, T8, T11
  - public pages with the new art: T16, T17
  - responsive layout: T12, T14, T15, T18
  - resume after closing the tab: T12, T15, T18
  - concurrency, idempotency and retry: T6, T9, T10, T12
- **Deferred by design:**
  - Phase 2: the other modes, captains, TV mode, self check-in and the fairness panel.
  - Phase 3: tournaments.
  - Phase 4: Google sign-in and DUPR.
  - Phase 5: retirement and legacy cleanup.
- **Names that cross tasks:** `applyCommand` / `finalizeCommand` (T6), `toViewerSnapshot` / `toHostSnapshot` (T7), `persistDiff` / `loadOpenSession` (T8), the `OpenSessionDO` methods `viewer`, `host`, `command`, `results`, `remove` and `evict` (T9), `useOpenSession` / `useCommandQueue` (T12), and `HostConsole` props `{ code, hostKey, host, status, onHost }` (T14, used in T15).

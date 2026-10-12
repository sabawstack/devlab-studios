# Free Open Play — Phase 5 (retire the logged-in app and clean up its data) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the logged-in operator app (its SPA, pages, `/api/pickleball/*` routes outside `open/`, auth, scoring, OPI, `SessionCoordinatorDO`, repositories, tests and tooling), make the shared Google callback serve host sign-in only, answer the old app's links through the CMS `redirects` table, and drop its 27 D1 tables on preview and production with a backup first, leaving the free-session product exactly as Phase 4 shipped it.

**Architecture:** Code goes first and data second. Tasks 1–4 remove code in dependency order (routes and pages, then the Durable Object, then the modules only they used), each ending green, and a guard test (`src/worker/pickleball/retirement.test.ts`) grows with each task so nothing comes back. Task 5 adds `0020_drop_legacy_pickleball.sql`, checked against the real foreign keys of 0001–0015. Old URLs become rows in the CMS `redirects` table, which `src/middleware.ts` already consults on a 404; Task 1 teaches `findRedirect` a trailing `/*` wildcard so one row covers every `/pickleball/live/{code}` QR link. The controller then deploys to preview, backs up and drops the preview tables, and repeats on production only inside the owner's 2.0.0 release.

**Tech Stack:**
- Astro 7 (server output) on Cloudflare Workers, custom entrypoint `src/worker.ts`
- D1 (`PICKLEBALL_DB`, CMS `DB`), Durable Objects (wrangler migration tags)
- Vitest 4 with `node:sqlite` (`createSqliteD1`, `createTestD1`)
- Playwright (`worker` project for `tests/e2e/pickleball/**`)
- Wrangler 4 (`d1 export`, `d1 migrations apply`, `d1 time-travel`, `deploy --dry-run`)

**Spec:** `docs/superpowers/specs/2026-10-11-pickleball-free-open-play-design.md`. Phase 5 is the fifth row of §14 ("Retire the logged-in app (§12)", **major**). Read §12 in full, plus §1 ("Existing app: No production users. It is retired, not migrated."), §3.1, §9.1 (the reused `oauth.js` and the registered callback) and §14. The Phase 4 plan (`docs/superpowers/plans/2026-10-12-pickleball-free-open-play-phase4.md`) is being implemented now and **lands before this plan runs**: read its header, Global Constraints and Task 5. **The current code is the source of truth where it differs from this plan.** This plan was written against `bb39596` (Phase 4 Tasks 1–8 committed: hosts, logins and claims in `0019`, Google sign-in on the shared callback with `legacyOperatorCallback` still serving requests that carry the old `devlab_pb_oauth` cookie, My sessions and reopen, the DUPR email export, account deletion and the login purge in `src/worker.ts`), with Phase 4 Tasks 9–11 (console DUPR sheet, My sessions page and guide, docs) still to come; see "Verified while writing this plan" at the end. Phase 4 Tasks 9–11 add only files under `open/`, `src/pickleball-open/` and `src/pages/pickleball/my-sessions.astro` that import nothing deleted here (Phase 4's `phase5Safety.test.ts` enforces that), and edit `src/worker.ts`, `index.astro`, `how-it-works.astro`, the public-pages spec and the docs in places this plan's Find blocks do not overlap. If a Find block no longer matches, reconcile it with the current code rather than forcing it.

## Global Constraints

- **What goes** (§12, "Code removal"): "the SPA `src/pickleball-app/`, `/pickleball/app/*`, `/pickleball/accept-invite/*`, `/pickleball/live/*`, every route under `/api/pickleball/` except `open/**` and host auth, `authContext.js`, `session.js`, `permissions.ts`, `quota.ts`, invites, platform pages, audit, per-rally scoring (`src/lib/pickleball/scoring/*`), OPI (`opi.ts`, snapshots), `SessionCoordinatorDO`, and the old repositories and e2e specs."
- **What stays** (§12, "Kept"): `src/worker/pickleball/oauth.js` (host sign-in), `RateLimiterDO`, the reused pure modules (`src/lib/pickleball/tournament/{generateFixtures,advanceBracket,nextPlayableFixture,rankTournamentStandings,resolvePoolQualifiers}.ts`, pinned by `src/lib/pickleball/open/tournament/reuse.test.ts`), and `src/lib/pickleball/webCrypto.js`. `PublicLinkQRCode` is **not** kept: nothing outside the SPA uses it (`src/pickleball-open/components/QrCode.jsx` is its copy).
- **Everything Phase 4 uses stays**: every file under `src/pages/api/pickleball/open/**`, `src/worker/pickleball/open/**`, `src/worker/repositories/pickleball/open/**`, `src/lib/pickleball/open/**`, `src/lib/schemas/pickleball/open/**`, `src/pickleball-open/**`, `src/pages/pickleball/{index,how-it-works,rotation,new,my-sessions}.astro`, `src/pages/pickleball/s/**`, `src/pages/pickleball/rt/open/**`, migrations `0016`–`0019`, and `POST /api/pickleball/open/host/test-login` gated by `PICKLEBALL_TEST_AUTH_ENABLED`.
- **The Google callback path never moves** (Phase 4 constraint): `${PICKLEBALL_OAUTH_REDIRECT_BASE_URL}/api/pickleball/auth/google/callback` is the URI registered with Google. Phase 5 keeps the file and deletes only its old-app branch.
- **Redirects** (§12, `AGENTS.md`): "`/pickleball/app` -> `/pickleball/new`, `/pickleball/methodology` -> `/pickleball/rotation` and `/pickleball/live/*` -> `/pickleball` get rows in the D1 `redirects` table, not hardcoded page redirects." The table is the CMS database's (`migrations/0004_content_model_v2.sql`), read by `findRedirect` in `src/middleware.ts` only on a GET that 404'd. Do not add them to `PERMANENT_PATH_REDIRECTS` and do not leave a page that redirects.
- **Database cleanup** (§12): read row counts first; take a `wrangler d1 export` backup "to a local file outside the repo"; drop "children before parents" including the trigger; "The `open_*` tables and `hosts` are untouched"; deleted DO class "in both environments"; "Read back the table list after applying to confirm only the new tables remain." The owner has authorized the drops on preview **and** production.
- **Production D1 writes** (`AGENTS.md`): ask the user to paste a fresh `CLOUDFLARE_API_TOKEN` for the action, use it inline for that one command only, never write it to a file, log it or echo it. Read the current value before overwriting anything, apply the minimal change, read it back. Never run a seed script against a database with real data. Both pickleball databases (and the preview Worker) live in the owner's **personal** Cloudflare account, so every remote command needs `CLOUDFLARE_ACCOUNT_ID=<personal account ID>` inline. Never write the account ID into a file, a commit or a doc: this plan uses the placeholder.
- **Never edit an applied migration.** `0001`–`0019` keep their comments (several mention `SessionCoordinatorDO`); D1 records migrations by file name.
- **Env and vars** (§12.6): "keep `GOOGLE_OAUTH_CLIENT_ID`, the OAuth secret and `PICKLEBALL_OAUTH_REDIRECT_BASE_URL` (host sign-in). Remove any pickleball invite/org-only vars." The only one is `PICKLEBALL_SESSION_SECRET`. `PICKLEBALL_TEST_AUTH_ENABLED` stays (Phase 4's test login).
- **Versioning:** Phase 5 removes public routes, `/api/*` endpoints and D1 tables, so the release that ships it is **MAJOR (2.0.0)** (spec §12, `CHANGELOG.md` policy). **This plan bumps no version, retitles no `[Unreleased]` and creates no tag**; the owner cuts the release.
- **Per commit:** one line in `CHANGELOG.md`'s `## [Unreleased]` in the same commit (`AGENTS.md`). Removals go under a `### Removed` heading that Task 2 creates; its first line says the next release is MAJOR. Commit subjects are lowercase after the type.
- **Start each task on a clean slate for its files:** if `git status --short <file>` shows changes to a file this task edits that you did not make, stop and ask the controller to land them first (interactive staging is not available, and `git add` would sweep them into your commit).
- **Lint:** `eslint-plugin-react-hooks` 7 and `react-refresh/only-export-components` are on.
- **Before any push:** `npm run typecheck && npm run build && npm run test:unit && npm run lint`, then the full Playwright suite (`npx playwright test`). Known and unrelated failures: `src/lead-engine/jobs/handlers.test.js` ("has a handler for every job type the schema allows") and the public-pages "services page links to the pickleball product" test, which needs CMS content a fresh local D1 does not have. `npm run lint` reports one pre-existing warning (unused `eslint-disable` in `src/lib/pickleball/open/roster.ts`), 0 errors.
- **Housekeeping:** stop any `wrangler dev` or `npm run preview` you started (`tasklist //FI "IMAGENAME eq node.exe"`). Playwright reuses a server already on port 8787 or 4173, so stop stale ones before a run.

## Review Focus

1. **A player scans a QR code printed from the old app** (`/pickleball/live/{code}` or `/pickleball/live/{code}/display`). They must land on `/pickleball`, not a 404 or a 500, without a row per code. Pinned in Task 1 (`redirects.test.js`: "a wildcard row answers every path below its prefix, but not the prefix"), Task 2 (e2e "the retired page is gone", 301 to the mapped page or 404 where the rows are absent) and Task 8 (curl on preview and production).
2. **A bookmark deep inside the old SPA, or with a trailing slash** (`/pickleball/app/sessions/123`, `/pickleball/app/`). It must reach `/pickleball/new`. Pinned in Task 1 ("tries the path without its trailing slash…", "a wildcard row answers…").
3. **A browser that still holds the old app's in-flight sign-in cookie comes back from Google** after the old branch is deleted. It must get the host flow's plain `?signin=failed` redirect, never a JSON error or a 500. Pinned in Task 2 (e2e "the Google callback answers a stale operator sign-in with a host sign-in failure").
4. **Dropping tables that still hold rows** (production has 3 `users`, 1 `organizations`, 6 `audit_events`; preview has demo data). A parent dropped before a child that references it makes D1's implicit `DELETE` fail midway. Pinned in Task 5 (`dropLegacy.test.ts`: "drops every table only after every table that references it", "…even when the old tables hold data") and verified against local D1 with rows (Task 5 Step 5).
5. **A deploy that still binds, exports or deletes the old class in only one environment.** Wrangler refuses the deploy or leaves preview's objects behind. Pinned in Task 3 (`retirement.test.ts`: "production and preview each delete the class with tag v4…") and `wrangler deploy --dry-run` for both environments.

---

## Decisions recorded for this phase (not to be reopened)

From the owner and the spec: the old app has no users and is retired, not migrated; its data is dropped on preview and production after a backup; the Google callback path stays; old URLs redirect through the CMS table; Phase 5 is MAJOR but the owner cuts the release.

Resolved by this plan where the spec or the brief was silent or ambiguous:
1. **Migration number** `0020_drop_legacy_pickleball.sql`: Phase 4 ends at `0019_hosts.sql`.
2. **27 tables, not 28.** Migrations 0001–0015 create exactly the 27 tables §12 lists, plus one trigger (verified by applying them to SQLite). The 2026-10-12 inventory's 28th name on production is D1's own bookkeeping (`d1_migrations`, or `_cf_*`), which is never dropped. Task 8 lists everything first and stops on any name it does not expect.
3. **`/pickleball/live/*` needs a wildcard.** The `redirects` table matches `from_path` exactly. Task 1 makes `findRedirect` also try `/prefix/*` rows for each parent of the path (exact row first, then the longest wildcard), still one indexed query and still only on a 404. The data stays in the table, editable on the admin's Redirects screen; nothing is hardcoded.
4. **Rows:** `/pickleball/app` and `/pickleball/app/*` → `/pickleball/new` (the SPA had many deep links); `/pickleball/methodology` → `/pickleball/rotation`; `/pickleball/live/*` → `/pickleball`. All 301. `/pickleball/accept-invite/*` gets none (the spec lists none; its only links were invite emails to the owner's own accounts) and 404s.
5. **Rows are written by hand per environment** with guarded `INSERT … SELECT … WHERE NOT EXISTS`, not by a CMS migration: a migration would also apply any other pending CMS migration to production, and the seed files are not a mirror of reality (`AGENTS.md`). A local or e2e database has no rows, so the e2e test accepts a 301 to the mapped page or a 404, and nothing else.
6. **Order: code first, then data.** Preview: push `development` (the deploy deletes `SessionCoordinatorDO` via tag `v4`), then back up and drop. Production: only inside the owner's 2.0.0 release, after `main` is deployed, because production runs the old app until then. `wrangler d1 migrations apply` cannot stop at a given file, so the production drop runs only when `0020` is the **only** pending migration; if `0016`–`0019` are pending too, stop and ask the owner.
7. **Preview's probe objects** (`zz_probe`, `zz_trg_probe`, `zz_probe_trg`, `zz_trg_probe_t`) are dropped by hand on preview only, after the backup, never by the migration.
8. **Art:** the 9 components the kept pages import stay; the 17 used only by the methodology page or the old guide are deleted (checked by import closure).
9. **Tournament tests** of the five kept modules stay; `seeding.ts` and its test go (§6.3: "`seeding.ts`'s OPI ordering is not used"; not in `reuse.test.ts`'s list).
10. **`docs/pickleball/opi-methodology.md` stays with a "Retired" banner**: `src/lib/pickleball/open/standings.ts` and its test cite it for the per-game points share.
11. **`_bootstrap-org-tmp.sql`** is untracked and gitignored (it holds the owner's real email): delete the local file, keep its `.gitignore` rule as a guard.
12. **`PICKLEBALL_SESSION_SECRET`** goes from `src/env.d.ts`, `.env.example`, the local `.dev.vars` and, if `wrangler secret list` shows it, from the preview and production Workers.
13. **The methodology SEO record** goes from the static fallback (`src/data/seoContent.js`). A CMS row for it, if any, is left alone (no page reads it).
14. **`robots.txt`** loses `Disallow: /pickleball/app` (it now redirects to an indexable page) and keeps `/pickleball/rt/`.
15. **Old plans and specs** get a one-paragraph "Superseded" banner under their title; nothing else in them changes.
16. **Phase 4's `phase5Safety.test.ts` stays** (it still guards the Phase 4 roots); `retirement.test.ts` is the Phase 5 guard.

## File map

| File | Responsibility | Task |
|---|---|---|
| `src/worker/repositories/redirects.js`, `redirects.test.js`, `src/admin-app/lib/fieldDescriptors.js`, `src/middleware.ts` (comment) | `/*` wildcard rows | 1 |
| delete: `src/pickleball-app/`, old pages, old API routes, old e2e specs; `src/pages/api/pickleball/auth/google/callback.ts`, `src/middleware.ts`, `hostAuth.ts`/`QrCode.jsx` comments, public-pages spec, `seoContent.js`, `robots.txt`, `src/worker/pickleball/retirement.test.ts` | routes and pages; callback host-only | 2 |
| delete: `SessionCoordinatorDO.ts`, `gameProjection.ts`, `sessionSnapshot.js`; `wrangler.jsonc`, `src/worker.ts`, `src/env.d.ts`, `securityHeaders.ts`/`http.ts` comments | the Durable Object | 3 |
| delete: old worker modules, repositories, domain code, schemas, art, `scripts/pickleball/`, `_bootstrap-org-tmp.sql`; `package.json`, `playwright.config.js`, `.env.example`, `src/env.d.ts`, mailbox fixture comment | domain code and tooling | 4 |
| `migrations/pickleball/0020_drop_legacy_pickleball.sql`, `src/worker/repositories/pickleball/open/dropLegacy.test.ts` | the drop | 5 |
| `docs/pickleball/{architecture,schema,realtime,runbook,opi-methodology}.md`, ADR 0006, `docs/{operations,security}.md`, `docs/lead-engine/environment.md`, old plans/specs | docs | 6 |
| — | verification, preview deploy | 7 |
| — (remote D1, CMS rows, secrets) | operations | 8 |

---

### Task 1: Wildcard rows in the CMS redirects table

**Files:**
- Modify: `src/worker/repositories/redirects.js` (`findRedirect`)
- Create: `src/worker/repositories/redirects.test.js`
- Modify: `src/admin-app/lib/fieldDescriptors.js` (the From Path help text)
- Modify: `src/middleware.ts` (one comment)
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: `createTestD1(schemaSql[])` (`src/worker/repositories/testSupport/d1Sqlite.js`); `upsertRedirect(db, { fromPath, toPath, statusCode?, note? })` (unchanged; it returns `findRedirect(db, fromPath)`).
- Produces: `redirectCandidates(pathname: string): string[]` (the path, the path without a trailing slash, then `/a/b/*`, `/a/*` for each parent, at most 12 wildcards, never `/*`); `findRedirect(db, fromPath)` keeps its signature and return shape (`{ id, fromPath, toPath, statusCode, note, createdAt, updatedAt } | null`) and now returns the exact row if there is one, else the longest matching wildcard row. Task 8 writes the four rows; Task 2's e2e relies on the behaviour.

- [ ] **Step 1: Write the failing test**

`src/worker/repositories/redirects.test.js`:

```js
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import { createTestD1 } from './testSupport/d1Sqlite.js'
import { findRedirect, redirectCandidates, upsertRedirect } from './redirects.js'

// Only the table, copied from migrations/0004_content_model_v2.sql: the rest of
// that migration builds content tables these tests do not touch.
const MIGRATION = readFileSync(new URL('../../../migrations/0004_content_model_v2.sql', import.meta.url), 'utf8')
const REDIRECTS_DDL = MIGRATION.slice(MIGRATION.indexOf('CREATE TABLE IF NOT EXISTS redirects'), MIGRATION.indexOf(');', MIGRATION.indexOf('CREATE TABLE IF NOT EXISTS redirects')) + 2)

describe('redirectCandidates', () => {
  it('lists the path, then each parent wildcard, deepest first', () => {
    expect(redirectCandidates('/pickleball/live/ABCDE23456/display')).toEqual([
      '/pickleball/live/ABCDE23456/display',
      '/pickleball/live/ABCDE23456/*',
      '/pickleball/live/*',
      '/pickleball/*',
    ])
  })

  it('tries the path without its trailing slash, and never offers a root wildcard', () => {
    expect(redirectCandidates('/pickleball/app/')).toEqual(['/pickleball/app/', '/pickleball/app', '/pickleball/*'])
    expect(redirectCandidates('/pickleball')).toEqual(['/pickleball'])
    expect(redirectCandidates('/')).toEqual(['/'])
  })

  it('stops at twelve levels of wildcards', () => {
    const deep = `/${Array.from({ length: 30 }, (_, i) => `s${i}`).join('/')}`
    expect(redirectCandidates(deep).filter((path) => path.endsWith('/*'))).toHaveLength(12)
  })
})

describe('findRedirect', () => {
  let db

  beforeEach(async () => {
    db = createTestD1([REDIRECTS_DDL])
    await upsertRedirect(db, { fromPath: '/pickleball/app', toPath: '/pickleball/new' })
    await upsertRedirect(db, { fromPath: '/pickleball/app/*', toPath: '/pickleball/new' })
    await upsertRedirect(db, { fromPath: '/pickleball/live/*', toPath: '/pickleball' })
    await upsertRedirect(db, { fromPath: '/pickleball/live/KEEP/*', toPath: '/pickleball/s/KEEP' })
  })

  it('an exact row answers its own path', async () => {
    expect((await findRedirect(db, '/pickleball/app'))?.toPath).toBe('/pickleball/new')
  })

  it('a wildcard row answers every path below its prefix, but not the prefix', async () => {
    expect((await findRedirect(db, '/pickleball/live/ABCDE23456'))?.toPath).toBe('/pickleball')
    expect((await findRedirect(db, '/pickleball/live/ABCDE23456/display'))?.toPath).toBe('/pickleball')
    expect((await findRedirect(db, '/pickleball/app/sessions/123'))?.toPath).toBe('/pickleball/new')
    expect(await findRedirect(db, '/pickleball/live')).toBeNull()
  })

  it('the longest wildcard wins, and an exact row beats any wildcard', async () => {
    expect((await findRedirect(db, '/pickleball/live/KEEP/display'))?.toPath).toBe('/pickleball/s/KEEP')
    await upsertRedirect(db, { fromPath: '/pickleball/live/A', toPath: '/exact' })
    expect((await findRedirect(db, '/pickleball/live/A'))?.toPath).toBe('/exact')
  })

  it('a path no row covers finds nothing', async () => {
    expect(await findRedirect(db, '/pickleball/new')).toBeNull()
    expect(await findRedirect(db, '/elsewhere/live/x')).toBeNull()
  })

  it('saving a wildcard row returns that row', async () => {
    const saved = await upsertRedirect(db, { fromPath: '/pickleball/accept-invite/*', toPath: '/pickleball', note: 'x' })
    expect(saved).toMatchObject({ fromPath: '/pickleball/accept-invite/*', toPath: '/pickleball', statusCode: 301 })
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/worker/repositories/redirects.test.js`
Expected: FAIL — 5 of 8 fail (`redirectCandidates is not a function`, and the wildcard lookups return `null`).

- [ ] **Step 3: Teach `findRedirect` the wildcard**

In `src/worker/repositories/redirects.js`, find:

```js
/** Used by middleware only when a response already 404'd (see src/middleware.ts) — a fast indexed lookup, not a full table scan. */
export async function findRedirect(db, fromPath) {
  const row = await db
    .prepare('SELECT id, from_path, to_path, status_code, note, created_at, updated_at FROM redirects WHERE from_path = ?')
    .bind(fromPath)
    .first()
  return row ? toRedirect(row) : null
}
```

Replace it with:

```js
// The deepest parent a wildcard row can name. Bounds the IN (...) list below;
// no URL on this site comes close.
const MAX_WILDCARD_DEPTH = 12

/**
 * Every from_path that could answer this path, most specific first: the path
 * itself, the path without its trailing slash, then a `/*` wildcard for each
 * parent ("/a/b/c" gives "/a/b/*", then "/a/*"). A wildcard row covers
 * everything below its prefix but never the prefix itself, and there is no
 * root "/*".
 *
 * @param {string} pathname
 * @returns {string[]}
 */
export function redirectCandidates(pathname) {
  const exact = String(pathname || '')
  const trimmed = exact.length > 1 ? exact.replace(/\/+$/, '') : exact
  const segments = trimmed.split('/').filter(Boolean)
  const wildcards = []
  for (let depth = Math.min(segments.length - 1, MAX_WILDCARD_DEPTH); depth >= 1; depth -= 1) {
    wildcards.push(`/${segments.slice(0, depth).join('/')}/*`)
  }
  return [...new Set([exact, trimmed, ...wildcards])].filter(Boolean)
}

/**
 * Used by middleware only when a response already 404'd (see src/middleware.ts).
 * One indexed lookup (from_path is UNIQUE) over the path and its parent
 * wildcards: an exact row wins, then the longest wildcard.
 */
export async function findRedirect(db, fromPath) {
  const candidates = redirectCandidates(fromPath)
  if (candidates.length === 0) return null
  const placeholders = candidates.map(() => '?').join(', ')
  const row = await db
    .prepare(
      `SELECT id, from_path, to_path, status_code, note, created_at, updated_at FROM redirects
       WHERE from_path IN (${placeholders})
       ORDER BY (from_path = ?) DESC, length(from_path) DESC
       LIMIT 1`,
    )
    .bind(...candidates, candidates[0])
    .first()
  return row ? toRedirect(row) : null
}
```

The `(from_path = ?) DESC` term matters: `/a/b/c` and `/a/b/*` have the same length, so length alone could pick the wildcard over an exact row.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/worker/repositories/redirects.test.js`
Expected: PASS (8 tests).

- [ ] **Step 5: Say so where admins and readers look**

In `src/admin-app/lib/fieldDescriptors.js`, find:

```js
  { name: 'fromPath', label: 'From Path', type: 'text', required: true, help: 'Must start with / — e.g. /old-page' },
```

Replace it with:

```js
  { name: 'fromPath', label: 'From Path', type: 'text', required: true, help: 'Must start with / — e.g. /old-page. End it with /* to match every path below it, e.g. /old-section/*.' },
```

In `src/middleware.ts`, find:

```ts
  // consulted for paths nothing else already handled — so this only ever
  // runs on an actual 404, not on every request/asset.
```

Replace it with:

```ts
  // consulted for paths nothing else already handled — so this only ever
  // runs on an actual 404, not on every request/asset. A row matches its exact
  // path, or every path below it when its from_path ends in /* (findRedirect).
```

`redirectSchema` (`src/lib/schemas/collections.ts`) already accepts a `fromPath` ending in `/*` (it only requires a leading `/`), so the admin's Redirects screen can create and edit wildcard rows with no further change.

- [ ] **Step 6: Typecheck, lint and commit**

Run: `npm run typecheck && npx eslint src/worker/repositories src/admin-app/lib src/middleware.ts`
Expected: 0 errors.

Add under `### Changed` in `## [Unreleased]` (the first `### Changed` heading in the file; if `[Unreleased]` has none, add `### Changed` as its last subsection):

```markdown
- CMS redirects: a `from_path` ending in `/*` now matches every path below it (`/pickleball/live/*` covers `/pickleball/live/{any code}` and deeper). An exact row still wins, then the longest wildcard; the table is still consulted only on a 404.
```

```bash
git add src/worker/repositories/redirects.js src/worker/repositories/redirects.test.js src/admin-app/lib/fieldDescriptors.js src/middleware.ts CHANGELOG.md
git commit -m "feat(cms): wildcard rows in the redirects table"
```

---

### Task 2: Retire the operator routes, pages and SPA; the callback serves host sign-in only

**Files:**
- Create: `src/worker/pickleball/retirement.test.ts`
- Delete: `src/pickleball-app/` (whole folder, including `PublicLinkQRCode.jsx` and `pickleball.css`)
- Delete: `src/pages/pickleball/app/`, `src/pages/pickleball/accept-invite/`, `src/pages/pickleball/live/`, `src/pages/pickleball/methodology.astro`, `src/pages/pickleball/rt/[sessionId].ts`, `src/pages/pickleball/rt/public/`
- Delete: `src/pages/api/pickleball/auth/google/start.ts`, `auth/logout.ts`, `auth/org-invites/`, `auth/session.ts`, `auth/switch-org.ts`, `auth/test-login.ts`, and the folders `courts/`, `organizations/`, `platform/`, `players/`, `public/`, `scoring-rulesets/`, `sessions/`, `venues/` (all under `src/pages/api/pickleball/`)
- Delete: every `tests/e2e/pickleball/pickleball-*.spec.js` **except** `pickleball-public-pages.spec.js`, plus `tests/e2e/pickleball/helpers.js` and `tests/e2e/pickleball/d1Read.js`
- Rewrite: `src/pages/api/pickleball/auth/google/callback.ts`
- Modify: `src/middleware.ts`, `src/worker/pickleball/open/hostAuth.ts` (one comment), `src/pickleball-open/components/QrCode.jsx` (one comment), `src/data/seoContent.js`, `public/robots.txt`, `tests/e2e/pickleball/pickleball-public-pages.spec.js`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: Phase 4's `finishHostSignIn(env, request)`, `DEFAULT_RETURN_PATH` (`'/pickleball/my-sessions'`) and `withSignInResult(path, result)` from `src/worker/pickleball/open/hostAuth.ts`; Task 1's wildcard `findRedirect` (for the e2e's 301 branch).
- Produces: `GET /api/pickleball/auth/google/callback` → always a 302 from `finishHostSignIn` (or to `/pickleball/my-sessions?signin=failed` if it throws). `retirement.test.ts` with its first `describe`; Tasks 3 and 4 append to it. After this task the only files under `src/pages/api/pickleball/` are `open/**` and `auth/google/callback.ts`.

- [ ] **Step 1: Write the failing guard test**

`src/worker/pickleball/retirement.test.ts`:

```ts
// Phase 5 of the free open play spec (docs/superpowers/specs/
// 2026-10-11-pickleball-free-open-play-design.md §12) retired the logged-in
// operator app. These checks keep it retired: only the free-session routes and
// pages exist, the one shared Google callback serves host sign-in alone, and
// none of the old app's files come back.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8')

/** Every file under dir, as repo-relative paths with forward slashes. */
function filesUnder(dir: string): string[] {
  const absolute = join(ROOT, dir)
  if (!existsSync(absolute)) return []
  return readdirSync(absolute).flatMap((name) => {
    const path = join(absolute, name)
    if (statSync(path).isDirectory()) return filesUnder(relative(ROOT, path))
    return [relative(ROOT, path).split('\\').join('/')]
  })
}

describe('the operator app is retired: routes and pages', () => {
  it('the only pickleball API routes are the free-session ones and the Google callback', () => {
    const stray = filesUnder('src/pages/api/pickleball').filter(
      (file) => !file.startsWith('src/pages/api/pickleball/open/') && file !== 'src/pages/api/pickleball/auth/google/callback.ts',
    )
    expect(stray).toEqual([])
  })

  it('the only pickleball pages are the public ones, the free sessions and their socket', () => {
    const allowed = /^src\/pages\/pickleball\/(index|how-it-works|rotation|new|my-sessions)\.astro$|^src\/pages\/pickleball\/s\/|^src\/pages\/pickleball\/rt\/open\//
    expect(filesUnder('src/pages/pickleball').filter((file) => !allowed.test(file))).toEqual([])
  })

  it('the operator SPA and its e2e suites are gone', () => {
    expect(existsSync(join(ROOT, 'src/pickleball-app'))).toBe(false)
    const specs = filesUnder('tests/e2e/pickleball').filter((file) => file.endsWith('.spec.js'))
    expect(specs.filter((file) => !/\/(open-[a-z-]+|pickleball-public-pages)\.spec\.js$/.test(file))).toEqual([])
  })

  it('the Google callback serves host sign-in and nothing else', () => {
    const source = read('src/pages/api/pickleball/auth/google/callback.ts')
    const imports = [...source.matchAll(/from ['"]([^'"]+)['"]/g)].map((match) => match[1])
    expect(imports.sort()).toEqual(['../../../../../lib/env', '../../../../../worker/pickleball/open/hostAuth', 'astro'])
  })

  it('the middleware no longer gates /api/pickleball/ behind the operator session', () => {
    const source = read('src/middleware.ts')
    expect(source).not.toMatch(/requirePickleballSession|PICKLEBALL_API_PREFIX|authContext/)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/worker/pickleball/retirement.test.ts`
Expected: FAIL — all 5 fail (stray `sessions/…` routes, `app/[...path].astro`, `src/pickleball-app` exists, the callback imports `users.js`, the middleware imports `authContext.js`).

- [ ] **Step 3: Confirm nothing kept imports what this task deletes, then delete it**

Run (Git Bash, from the repo root):

```bash
{ grep -rlE "pickleball-app/|pages/pickleball/(app|accept-invite|live)/|methodology\.astro" src tests scripts
  grep -rlE "(helpers|d1Read)\.js'" tests/e2e/pickleball; } \
  | grep -vE "^src/pickleball-app/|^src/pages/pickleball/(app|accept-invite|live)/|^src/pages/pickleball/methodology\.astro$|^tests/e2e/pickleball/pickleball-[a-z-]+\.spec\.js$"
echo "---end"
```

Expected: only `src/components/pickleball/art/CourtSceneArt.jsx` (a comment naming the SPA's illustration; Task 4 deletes the file), then `---end`. Anything else listed is a kept file that depends on what this step deletes: stop and report it.

Then delete:

```bash
git rm -rq src/pickleball-app \
  src/pages/pickleball/app src/pages/pickleball/accept-invite src/pages/pickleball/live \
  src/pages/pickleball/methodology.astro "src/pages/pickleball/rt/[sessionId].ts" src/pages/pickleball/rt/public \
  src/pages/api/pickleball/auth/google/start.ts src/pages/api/pickleball/auth/logout.ts \
  src/pages/api/pickleball/auth/org-invites src/pages/api/pickleball/auth/session.ts \
  src/pages/api/pickleball/auth/switch-org.ts src/pages/api/pickleball/auth/test-login.ts \
  src/pages/api/pickleball/courts src/pages/api/pickleball/organizations src/pages/api/pickleball/platform \
  src/pages/api/pickleball/players src/pages/api/pickleball/public src/pages/api/pickleball/scoring-rulesets \
  src/pages/api/pickleball/sessions src/pages/api/pickleball/venues
git rm -q $(ls tests/e2e/pickleball/pickleball-*.spec.js | grep -v pickleball-public-pages) \
  tests/e2e/pickleball/helpers.js tests/e2e/pickleball/d1Read.js
find src/pages/api/pickleball -type f | sort
```

Expected: the last command lists only `src/pages/api/pickleball/auth/google/callback.ts` and files under `src/pages/api/pickleball/open/`.

- [ ] **Step 4: The callback serves host sign-in only**

Replace the whole of `src/pages/api/pickleball/auth/google/callback.ts` (Phase 4 left `GET` choosing between `finishHostSignIn` and `legacyOperatorCallback`, plus the old imports, `OAUTH_COOKIE_NAME`, `SESSION_MAX_AGE_SECONDS` and `LOGIN_PATH`) with:

```ts
import type { APIRoute } from 'astro'
import { getEnv } from '../../../../../lib/env'
import { DEFAULT_RETURN_PATH, finishHostSignIn, withSignInResult } from '../../../../../worker/pickleball/open/hostAuth'

// The redirect URI registered with Google (spec §9.1), so this path never
// moves even though everything else under /api/pickleball/ outside open/ is
// gone: the logged-in operator app that once shared it was retired in Phase 5
// (§12). Every visit is a host sign-in coming back from Google, and every
// outcome is a redirect with ?signin=…, never a raw error body.
export const GET: APIRoute = async ({ request }) => {
  try {
    return await finishHostSignIn(getEnv(), request)
  } catch (error) {
    console.log(JSON.stringify({ event: 'pickleball_open.host_signin_failed', error: error instanceof Error ? error.message : 'unknown' }))
    return new Response(null, { status: 302, headers: { Location: withSignInResult(DEFAULT_RETURN_PATH, 'failed'), 'Cache-Control': 'no-store' } })
  }
}
```

In `src/worker/pickleball/open/hostAuth.ts`, find:

```ts
// wrangler.jsonc once shipped this literal until real credentials existed (see auth/google/start.ts).
```

Replace it with:

```ts
// wrangler.jsonc once shipped this literal until real credentials existed.
```

- [ ] **Step 5: Remove the operator session gate from the middleware**

In `src/middleware.ts`, delete the line:

```ts
import { requirePickleballSession } from './worker/pickleball/authContext.js'
```

Delete every line from `const PICKLEBALL_API_PREFIX = '/api/pickleball/'` up to, **not** including, `const MAINTENANCE_PAGE = '/maintenance'`. At the time of writing that is the `PICKLEBALL_API_PREFIX`, `PICKLEBALL_PUBLIC_ROUTES`, `PICKLEBALL_PUBLIC_STATE_PREFIX`, `PICKLEBALL_OPEN_PREFIX`, `PICKLEBALL_ORG_INVITE_ACCEPT_PREFIX` and `PICKLEBALL_PLATFORM_ADMIN_PREFIX` constants and their comments (45 lines).

Delete the whole block that starts with:

```ts
  if (
    url.pathname.startsWith(PICKLEBALL_API_PREFIX) &&
```

through its closing `}` and the blank line after it, so that the line after the admin block's closing `}` and blank line is `  if (isMaintenanceGated(url.pathname) && url.pathname !== MAINTENANCE_PAGE) {`. At the time of writing the block was:

```ts
  if (
    url.pathname.startsWith(PICKLEBALL_API_PREFIX) &&
    !PICKLEBALL_PUBLIC_ROUTES.has(url.pathname) &&
    !url.pathname.startsWith(PICKLEBALL_PUBLIC_STATE_PREFIX) &&
    !url.pathname.startsWith(PICKLEBALL_OPEN_PREFIX) &&
    !url.pathname.startsWith(PICKLEBALL_ORG_INVITE_ACCEPT_PREFIX) &&
    !url.pathname.startsWith(PICKLEBALL_PLATFORM_ADMIN_PREFIX)
  ) {
    try {
      await requirePickleballSession(context.request, getEnv())
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unexpected error.'
      const rawStatus = error instanceof Error ? (error as Error & { status?: unknown }).status : undefined
      const status = typeof rawStatus === 'number' ? rawStatus : 500
      if (shouldDrainUnreadBodies()) await discardUnreadBody(context.request)
      return applySecurityHeaders(
        new Response(JSON.stringify({ error: message }), { status }),
        url.pathname,
        url.hostname,
      )
    }
  }
```

`discardUnreadBody` and `shouldDrainUnreadBodies` stay: the line after `await next()` still uses them.

Nothing under `/api/pickleball/` needs the gate any more: `open/**` authorizes with the host or captain key inside the Durable Object (and the host cookie for account routes), and the callback is public by nature.

- [ ] **Step 6: Drop the methodology page's metadata and crawl rule; fix two comments**

In `src/data/seoContent.js`, delete this whole entry (including its trailing `},`):

```js
    {
      id: 'seo-pickleball-methodology',
      pageSlug: 'pickleball-methodology',
      metaTitle: 'How OPI Works — Devlab Pickleball',
      metaDescription:
        'OPI, the Open Play Performance Index, measures how a player performs relative to the points scored in their games. Read the formula, the confidence tiers, and what OPI deliberately is not.',
      metaKeywords:
        'OPI, open play performance index, pickleball performance metric, pickleball rating explained, pickleball statistics',
      canonicalUrl: 'https://www.devlabstudios.com/pickleball/methodology',
      ogTitle: 'How OPI Works — Devlab Pickleball',
      ogDescription:
        'The formula behind the Open Play Performance Index, its confidence tiers, and what it deliberately is not.',
      ogImage: 'https://www.devlabstudios.com/og-pickleball.png',
      twitterTitle: 'How OPI Works — Devlab Pickleball',
      twitterDescription:
        'The formula behind the Open Play Performance Index, and what it deliberately is not.',
      twitterImage: 'https://www.devlabstudios.com/og-pickleball.png',
    },
```

In `public/robots.txt`, delete the line:

```text
Disallow: /pickleball/app
```

(`Disallow: /pickleball/rt/` stays: the free sessions' socket lives there.)

In `src/pickleball-open/components/QrCode.jsx`, find:

```js
// injecting the library's markup is safe. Same approach as the operator app's
// PublicLinkQRCode, copied here because that app is retired in Phase 5.
```

Replace it with:

```js
// injecting the library's markup is safe. Copied from the operator app's
// PublicLinkQRCode, which Phase 5 deleted with the rest of that app.
```

- [ ] **Step 7: The public-pages spec stops visiting the methodology page and pins the retirement**

In `tests/e2e/pickleball/pickleball-public-pages.spec.js`, find:

```js
    { path: '/pickleball/rotation', htmlMarker: 'How fair rotation works', viewBox: '0 0 360 200' },
    // RankOrderArt's viewBox, unique to the methodology page.
    { path: '/pickleball/methodology', htmlMarker: 'How OPI works', viewBox: '0 0 320 160' },
  ]
```

Replace it with:

```js
    { path: '/pickleball/rotation', htmlMarker: 'How fair rotation works', viewBox: '0 0 360 200' },
  ]
```

Find:

```js
  for (const path of ['/pickleball', '/pickleball/how-it-works', '/pickleball/methodology']) {
    test(`skips no heading level (${path})`, async ({ page }) => {
```

Replace it with:

```js
  for (const path of ['/pickleball', '/pickleball/how-it-works', '/pickleball/rotation']) {
    test(`skips no heading level (${path})`, async ({ page }) => {
```

Find:

```js
    ['/pickleball/rotation', 'How Fair Rotation Works: Devlab Pickleball'],
    ['/pickleball/methodology', 'How OPI Works'],
  ]) {
```

Replace it with:

```js
    ['/pickleball/rotation', 'How Fair Rotation Works: Devlab Pickleball'],
  ]) {
```

Find:

```js
  test('a blocked sign-in offers a way to request access', async ({ page }) => {
    await page.goto('/pickleball/app?error=no_access')

    await expect(page.getByRole('alert')).toContainText('no active Pickleball membership')
    await expect(page.getByRole('link', { name: 'Request access' })).toHaveAttribute(
      'href',
      '/pickleball#request-access',
    )
  })
```

Replace it with:

```js
  // Phase 5 (spec §12) retired the logged-in app. Its pages answer only
  // through the CMS redirects table (rows added by hand per environment, see
  // docs/pickleball/runbook.md), so a local database without the rows 404s
  // and an environment with them 301s to the new page. Nothing else is allowed.
  for (const [path, target] of [
    ['/pickleball/app', '/pickleball/new'],
    ['/pickleball/app/sessions/abc', '/pickleball/new'],
    ['/pickleball/methodology', '/pickleball/rotation'],
    ['/pickleball/live/ABCDE23456', '/pickleball'],
    ['/pickleball/live/ABCDE23456/display', '/pickleball'],
  ]) {
    test(`the retired page is gone (${path})`, async ({ page }) => {
      const response = await page.request.get(path, { maxRedirects: 0 })
      expect([301, 404], `${path} answered ${response.status()}`).toContain(response.status())
      if (response.status() === 301) expect(new URL(response.headers().location).pathname).toBe(target)
    })
  }

  for (const path of ['/pickleball/accept-invite/some-token', '/api/pickleball/sessions', '/api/pickleball/auth/session', '/api/pickleball/public/ABCDE23456/state']) {
    test(`the retired route is gone (${path})`, async ({ page }) => {
      expect((await page.request.get(path, { maxRedirects: 0 })).status()).toBe(404)
    })
  }

  // A browser can still hold the retired app's in-flight sign-in cookie when
  // Google sends it back. The shared callback treats every visit as a host
  // sign-in, so this is a plain failed host sign-in, never a JSON error.
  test('the Google callback answers a stale operator sign-in with a host sign-in failure', async ({ page }) => {
    const response = await page.request.get('/api/pickleball/auth/google/callback?code=x&state=y', {
      headers: { Cookie: 'devlab_pb_oauth=%7B%22state%22%3A%22y%22%7D' },
      maxRedirects: 0,
    })
    expect(response.status()).toBe(302)
    expect(response.headers().location).toBe('/pickleball/my-sessions?signin=failed')
  })
```

The landing page's "Running a club or venue?" request-access form is a contact form, not a sign-in, and its test stays.

- [ ] **Step 8: Run the guard and the unit suite**

Run: `npx vitest run src/worker/pickleball/retirement.test.ts src/worker/pickleball/open src/lib/content/seo.test.ts`
Expected: PASS — the 5 guard tests, Phase 4's `hostAuth.test.ts` and `phase5Safety.test.ts`, every other test in the folder, and the SEO coverage test (the methodology route is gone from `PUBLIC_ROUTES` already, so removing its record breaks nothing).

- [ ] **Step 9: Typecheck, lint, build and the pickleball e2e**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: 0 errors (the one pre-existing lint warning in `roster.ts`).

Run (stop stale servers first, see Global Constraints): `npx playwright test --project=worker tests/e2e/pickleball/`
Expected: PASS — `open-play.spec.js`, `open-tournament.spec.js`, Phase 4's `open-host.spec.js` and `pickleball-public-pages.spec.js` (including the new "the retired page is gone", "the retired route is gone" and stale-callback tests), apart from the known services-page test. The playwright `worker` server command still runs `scripts/pickleball/apply-e2e-fixtures.mjs` until Task 4; that is expected and harmless here.

- [ ] **Step 10: Commit**

In `CHANGELOG.md`'s `## [Unreleased]`, add a `### Removed` heading as its **last** subsection (directly above the first `## [` release heading that follows `## [Unreleased]`), with:

```markdown
### Removed
- **Breaking — the next release is MAJOR (2.0.0).** Pickleball's logged-in operator app is retired (spec 2026-10-11 §12; it had no users). Removed: the operator SPA at `/pickleball/app`, `/pickleball/accept-invite/*`, the live and TV views at `/pickleball/live/*`, the OPI page `/pickleball/methodology`, the operator socket routes `/pickleball/rt/{sessionId}` and `/pickleball/rt/public/{code}`, and every `/api/pickleball/` route outside `open/` except the Google callback (organizations, memberships, platform, invites, venues, courts, players, rulesets, sessions, games and rally scoring, queue, pairs, tournaments, leaderboard, audit, public state, and the old auth routes). The operator session gate is gone from the middleware, and `/api/pickleball/auth/google/callback` now serves only host sign-in for the DUPR export.
```

```bash
git add -A src/pickleball-app src/pages/pickleball src/pages/api/pickleball tests/e2e/pickleball \
  src/worker/pickleball/retirement.test.ts src/worker/pickleball/open/hostAuth.ts src/middleware.ts \
  src/pickleball-open/components/QrCode.jsx src/data/seoContent.js public/robots.txt CHANGELOG.md
git commit -m "feat(pickleball)!: retire the operator app's routes, pages and spa"
```

(`git rm` already staged the deletions; `git add -A <paths>` stages the edits and is a no-op for anything already staged.)

---

### Task 3: Delete `SessionCoordinatorDO` in both environments

**Files:**
- Delete: `src/worker/pickleball/SessionCoordinatorDO.ts`, `src/worker/pickleball/gameProjection.ts`, `src/worker/pickleball/sessionSnapshot.js`
- Modify: `wrangler.jsonc` (top level and `env.preview`), `src/worker.ts`, `src/env.d.ts`
- Modify: `src/lib/securityHeaders.ts`, `src/lib/http.ts` (comments that point at the deleted file)
- Test: `src/worker/pickleball/retirement.test.ts` (append)
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: Task 2's `retirement.test.ts` helpers `ROOT`, `read(path)`.
- Produces: wrangler migration tag `v4` = `{ "tag": "v4", "deleted_classes": ["SessionCoordinatorDO"] }` in both `migrations` lists (tags are append-only, so `v1` stays); the only Durable Object bindings are `OPEN_SESSION` and `RATE_LIMITER`; `src/worker.ts` exports `RateLimiterDO, OpenSessionDO`. Deploying this deletes every `SessionCoordinatorDO` object and its storage in that environment (preview on the Task 7 push, production on the owner's 2.0.0 deploy).

- [ ] **Step 1: Write the failing test**

Append to `src/worker/pickleball/retirement.test.ts`:

```ts

describe('the operator app is retired: SessionCoordinatorDO', () => {
  const wrangler = read('wrangler.jsonc')

  it('no environment binds it any more', () => {
    expect(wrangler).not.toContain('SESSION_COORDINATOR')
    expect(wrangler.match(/\{ "name": "OPEN_SESSION", "class_name": "OpenSessionDO" \}/g)).toHaveLength(2)
    expect(wrangler.match(/\{ "name": "RATE_LIMITER", "class_name": "RateLimiterDO" \}/g)).toHaveLength(2)
  })

  it('production and preview each delete the class with tag v4, after its v1 tag', () => {
    expect(wrangler.match(/\{ "tag": "v4", "deleted_classes": \["SessionCoordinatorDO"\] \}/g)).toHaveLength(2)
    expect(wrangler.match(/\{ "tag": "v1", "new_sqlite_classes": \["SessionCoordinatorDO"\] \}/g)).toHaveLength(2)
  })

  it('the Worker no longer exports it and the env type no longer names it', () => {
    expect(existsSync(join(ROOT, 'src/worker/pickleball/SessionCoordinatorDO.ts'))).toBe(false)
    expect(read('src/worker.ts')).not.toContain('SessionCoordinatorDO')
    expect(read('src/env.d.ts')).not.toContain('SESSION_COORDINATOR')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/worker/pickleball/retirement.test.ts`
Expected: FAIL — the 3 new tests (the 5 from Task 2 still pass).

- [ ] **Step 3: Confirm only the deleted files use it, then delete it**

Run: `grep -rlE "SessionCoordinatorDO|SESSION_COORDINATOR|gameProjection|sessionSnapshot" src --include=*.ts --include=*.js --include=*.jsx --include=*.astro`
Expected: `src/env.d.ts`, `src/worker.ts`, `src/lib/http.ts`, `src/lib/securityHeaders.ts` (edited below), `src/lib/pickleball/open/tournament/reuse.test.ts` and `src/worker/pickleball/open/phase5Safety.test.ts` (both name it in a ban list, which stays), the three files deleted now, and files Task 4 deletes (`src/lib/pickleball/{queueEngine,sessionLifecycle}.ts`, `src/lib/pickleball/scoring/replayEvents*.ts`, `src/lib/schemas/pickleball/games.ts`, `src/worker/repositories/pickleball/*.js`; comments only). Anything else: stop and report it.

```bash
git rm -q src/worker/pickleball/SessionCoordinatorDO.ts src/worker/pickleball/gameProjection.ts src/worker/pickleball/sessionSnapshot.js
```

- [ ] **Step 4: Unbind it and delete the class in both environments**

In `wrangler.jsonc`, find (top level):

```jsonc
  // One Durable Object per Open Play session, keyed by session id, so two
  // simultaneous court assignments are serialized by construction rather than
  // by client-side button-disabling. D1 stays the source of truth.
  "durable_objects": {
    "bindings": [
      { "name": "SESSION_COORDINATOR", "class_name": "SessionCoordinatorDO" },
      { "name": "OPEN_SESSION", "class_name": "OpenSessionDO" },
      { "name": "RATE_LIMITER", "class_name": "RateLimiterDO" }
    ]
  },
  "migrations": [
    { "tag": "v1", "new_sqlite_classes": ["SessionCoordinatorDO"] },
    { "tag": "v2", "new_sqlite_classes": ["RateLimiterDO"] },
    { "tag": "v3", "new_sqlite_classes": ["OpenSessionDO"] }
  ],
```

Replace it with:

```jsonc
  // One OpenSessionDO per free session, keyed by its public code, so two
  // results saved at once are serialized by construction. D1 stays the source
  // of truth. Tags are append-only: v4 deletes the retired operator app's
  // SessionCoordinatorDO and every object it stored (spec 2026-10-11 §12), so
  // its v1 tag stays in the list.
  "durable_objects": {
    "bindings": [
      { "name": "OPEN_SESSION", "class_name": "OpenSessionDO" },
      { "name": "RATE_LIMITER", "class_name": "RateLimiterDO" }
    ]
  },
  "migrations": [
    { "tag": "v1", "new_sqlite_classes": ["SessionCoordinatorDO"] },
    { "tag": "v2", "new_sqlite_classes": ["RateLimiterDO"] },
    { "tag": "v3", "new_sqlite_classes": ["OpenSessionDO"] },
    { "tag": "v4", "deleted_classes": ["SessionCoordinatorDO"] }
  ],
```

In `wrangler.jsonc`, find (inside `env.preview`):

```jsonc
      "durable_objects": {
        "bindings": [
          { "name": "SESSION_COORDINATOR", "class_name": "SessionCoordinatorDO" },
          { "name": "OPEN_SESSION", "class_name": "OpenSessionDO" },
          { "name": "RATE_LIMITER", "class_name": "RateLimiterDO" }
        ]
      },
      "migrations": [
        { "tag": "v1", "new_sqlite_classes": ["SessionCoordinatorDO"] },
        { "tag": "v2", "new_sqlite_classes": ["RateLimiterDO"] },
        { "tag": "v3", "new_sqlite_classes": ["OpenSessionDO"] }
      ]
```

Replace it with:

```jsonc
      "durable_objects": {
        "bindings": [
          { "name": "OPEN_SESSION", "class_name": "OpenSessionDO" },
          { "name": "RATE_LIMITER", "class_name": "RateLimiterDO" }
        ]
      },
      "migrations": [
        { "tag": "v1", "new_sqlite_classes": ["SessionCoordinatorDO"] },
        { "tag": "v2", "new_sqlite_classes": ["RateLimiterDO"] },
        { "tag": "v3", "new_sqlite_classes": ["OpenSessionDO"] },
        { "tag": "v4", "deleted_classes": ["SessionCoordinatorDO"] }
      ]
```

In `src/worker.ts`, delete the line:

```ts
import { SessionCoordinatorDO } from './worker/pickleball/SessionCoordinatorDO'
```

and find:

```ts
export { SessionCoordinatorDO, RateLimiterDO, OpenSessionDO }
```

Replace it with:

```ts
export { RateLimiterDO, OpenSessionDO }
```

In `src/env.d.ts`, delete the line:

```ts
  SESSION_COORDINATOR: DurableObjectNamespace<import('./worker/pickleball/SessionCoordinatorDO').SessionCoordinatorDO>
```

- [ ] **Step 5: Point two comments at code that still exists**

In `src/lib/securityHeaders.ts`, find:

```ts
  // it passes through completely untouched. See src/worker/pickleball/
  // SessionCoordinatorDO.ts's fetch() for the response this guards.
```

Replace it with:

```ts
  // it passes through completely untouched. See src/worker/pickleball/open/
  // OpenSessionDO.ts's fetch() for the response this guards.
```

In `src/lib/http.ts`, find:

```ts
 * (console.error being how logging reaches `wrangler tail` on Workers — see
 * worker/pickleball/SessionCoordinatorDO.ts) and answered generically.
```

Replace it with:

```ts
 * (console.error being how logging reaches `wrangler tail` on Workers) and
 * answered generically.
```

- [ ] **Step 6: Run the tests, typecheck, and dry-run both deploys**

Run: `npx vitest run src/worker/pickleball/retirement.test.ts`
Expected: PASS (8 tests).

Run: `npm run typecheck && npm run lint`
Expected: 0 errors.

Run: `npm run build && npx wrangler deploy --dry-run`
Expected: the binding table lists `env.OPEN_SESSION (OpenSessionDO)` and `env.RATE_LIMITER (RateLimiterDO)`, no `SESSION_COORDINATOR`, and it ends with `--dry-run: exiting now.` with no error. Then check what the build baked in:

```bash
node -e "const c=require('./dist/server/wrangler.json');console.log(c.name, JSON.stringify(c.durable_objects.bindings.map(b=>b.name)), JSON.stringify(c.migrations.at(-1)))"
```

Expected: `devlab-studios ["OPEN_SESSION","RATE_LIMITER"] {"tag":"v4","deleted_classes":["SessionCoordinatorDO"]}`.

Run: `CLOUDFLARE_ENV=preview npm run build && npx wrangler deploy --dry-run`, then the same `node -e` line.
Expected: the same, with `devlab-studios-preview`, `DB (devlab-studios-cms-preview)` and `PICKLEBALL_DB (devlab-pickleball-preview)` in the table. Run `npm run build` once more afterwards so `dist/` is the production build again.

- [ ] **Step 7: Commit**

Add under `### Removed` in `## [Unreleased]`:

```markdown
- `SessionCoordinatorDO`, the operator app's Durable Object: unbound in both environments and deleted with wrangler migration tag `v4` (`deleted_classes`), which also deletes every object it stored when each environment next deploys.
```

```bash
git add -A src/worker/pickleball wrangler.jsonc src/worker.ts src/env.d.ts src/lib/securityHeaders.ts src/lib/http.ts CHANGELOG.md
git commit -m "feat(pickleball)!: delete the operator app's durable object"
```

---

### Task 4: Delete the old domain code, repositories and data tooling

**Files:**
- Delete: `src/worker/pickleball/{authContext,authContext.test,inviteEmail,inviteEmail.test,session,session.test}.js`
- Delete: every `src/worker/repositories/pickleball/*.js` (the 24 old repositories; the `open/` folder stays)
- Delete: in `src/lib/pickleball/`: `attendance.ts`, `inviteValidation.ts`, `opi.ts`, `pairSelection.ts`, `permissions.ts`, `publicSessionView.ts`, `queueEngine.ts`, `quota.ts`, `sessionLifecycle.ts`, `sessionStateMachine.ts`, `standings.ts` and their `.test.ts` files, the `scoring/` folder, `tournament/seeding.ts` and `tournament/seeding.test.ts`
- Delete: every `src/lib/schemas/pickleball/*.ts` (the 12 old schemas; the `open/` folder stays)
- Delete: in `src/components/pickleball/art/`: `ConfidenceArt`, `CourtSceneArt`, `EligibilityArt`, `QueueFlowArt`, `RankOrderArt`, `ScoreboardArt`, `ShareLiveArt`, `StandingsArt`, `Step1CreateArt` … `Step9CompleteArt` (17 `.jsx` files)
- Delete: `scripts/pickleball/` (`create-organization.mjs`, `apply-e2e-fixtures.mjs`, `seed/`), and the untracked local file `_bootstrap-org-tmp.sql`
- Modify: `package.json` (two scripts), `playwright.config.js` (the fixture step), `.env.example`, `src/env.d.ts`, `scripts/mailbox/apply-e2e-fixtures.mjs` (one comment)
- Test: `src/worker/pickleball/retirement.test.ts` (append)
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: Task 2's `retirement.test.ts` helpers.
- Produces: what is left of the old code is exactly `src/worker/pickleball/oauth.js` (+ test), `src/lib/pickleball/webCrypto.js` (+ test), the five tournament modules (+ their tests) and the 9 art components the public pages import. `Env` no longer has `PICKLEBALL_SESSION_SECRET` or `SESSION_COORDINATOR`; `App.Locals` no longer has `pickleballSession`. The `worker` Playwright server no longer seeds organizations, which Task 5's migration would otherwise break.

- [ ] **Step 1: Write the failing test**

Append to `src/worker/pickleball/retirement.test.ts`:

```ts

describe('the operator app is retired: its code and data tooling', () => {
  /** The files directly in dir (not in its subfolders). */
  const topLevel = (dir: string): string[] =>
    readdirSync(join(ROOT, dir)).filter((name) => statSync(join(ROOT, dir, name)).isFile()).sort()

  it('of the old worker code only oauth.js remains (host sign-in reuses it)', () => {
    expect(topLevel('src/worker/pickleball')).toEqual(['oauth.js', 'oauth.test.js', 'retirement.test.ts'])
    expect(topLevel('src/worker/repositories/pickleball')).toEqual([])
  })

  it('of the old domain code only webCrypto and the five reused tournament modules remain', () => {
    expect(topLevel('src/lib/pickleball')).toEqual(['webCrypto.js', 'webCrypto.test.js'])
    expect(topLevel('src/lib/schemas/pickleball')).toEqual([])
    expect(existsSync(join(ROOT, 'src/lib/pickleball/scoring'))).toBe(false)
    const modules = topLevel('src/lib/pickleball/tournament').filter((name) => !name.endsWith('.test.ts'))
    expect(modules).toEqual(['advanceBracket.ts', 'generateFixtures.ts', 'nextPlayableFixture.ts', 'rankTournamentStandings.ts', 'resolvePoolQualifiers.ts'])
  })

  it('the organization bootstrap, demo seed and e2e fixtures are gone', () => {
    expect(existsSync(join(ROOT, 'scripts/pickleball'))).toBe(false)
    expect(existsSync(join(ROOT, '_bootstrap-org-tmp.sql'))).toBe(false)
    expect(read('package.json')).not.toMatch(/pickleball:(create-organization|seed:demo)/)
    expect(read('playwright.config.js')).not.toContain('scripts/pickleball')
  })

  it('the operator session secret is no longer configured anywhere', () => {
    for (const file of ['src/env.d.ts', '.env.example', 'wrangler.jsonc']) {
      expect(read(file), file).not.toContain('PICKLEBALL_SESSION_SECRET')
    }
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/worker/pickleball/retirement.test.ts`
Expected: FAIL — the 4 new tests (the 8 earlier ones still pass).

- [ ] **Step 3: Confirm nothing kept imports what this task deletes**

Run:

```bash
grep -rlE "pickleball/(authContext|inviteEmail|session)(\.js)?'|repositories/pickleball/[A-Za-z]+(\.js)?'|lib/pickleball/(attendance|inviteValidation|opi|pairSelection|permissions|publicSessionView|queueEngine|quota|sessionLifecycle|sessionStateMachine|standings|scoring/[A-Za-z]+)(\.ts|\.js)?'|tournament/seeding'|schemas/pickleball/[A-Za-z]+'|art/(Confidence|CourtScene|Eligibility|QueueFlow|RankOrder|Scoreboard|ShareLive|Standings|Step[1-9][A-Za-z]+)Art|scripts/pickleball/" \
  src tests scripts playwright.config.js package.json
```

Expected: files this task deletes, the four it edits (`playwright.config.js`, `package.json`, `scripts/mailbox/apply-e2e-fixtures.mjs` for its comment, `src/env.d.ts` only if it names one), and Phase 4's `src/worker/pickleball/open/phase5Safety.test.ts` (its ban list names these paths; it stays). Nothing else under `src/lib/pickleball/open/`, `src/worker/pickleball/open/`, `src/worker/repositories/pickleball/open/`, `src/pickleball-open/` or `src/pages/` may appear; if one does, stop and report it. This grep only sees imports that spell the folder out; relative imports such as `'../opi'` are caught by `npm run typecheck` and `npm run build` in Step 7, which fail on any import of a deleted file.

- [ ] **Step 4: Delete the code**

```bash
git rm -q src/worker/pickleball/authContext.js src/worker/pickleball/authContext.test.js \
  src/worker/pickleball/inviteEmail.js src/worker/pickleball/inviteEmail.test.js \
  src/worker/pickleball/session.js src/worker/pickleball/session.test.js
git rm -q src/worker/repositories/pickleball/*.js
( cd src/lib/pickleball && git rm -q attendance.ts attendance.test.ts inviteValidation.ts inviteValidation.test.ts \
    opi.ts opi.test.ts pairSelection.ts pairSelection.test.ts permissions.ts permissions.test.ts \
    publicSessionView.ts publicSessionView.test.ts queueEngine.ts queueEngine.test.ts quota.ts quota.test.ts \
    sessionLifecycle.ts sessionStateMachine.ts sessionStateMachine.test.ts standings.ts standings.test.ts \
    tournament/seeding.ts tournament/seeding.test.ts && git rm -rq scoring )
git rm -q src/lib/schemas/pickleball/*.ts
( cd src/components/pickleball/art && git rm -q ConfidenceArt.jsx CourtSceneArt.jsx EligibilityArt.jsx QueueFlowArt.jsx \
    RankOrderArt.jsx ScoreboardArt.jsx ShareLiveArt.jsx StandingsArt.jsx Step1CreateArt.jsx Step2OpenArt.jsx \
    Step3CheckInArt.jsx Step4QueueArt.jsx Step5AssignArt.jsx Step6StartArt.jsx Step7ScoreArt.jsx \
    Step8FinishArt.jsx Step9CompleteArt.jsx )
git rm -rq scripts/pickleball
ls src/components/pickleball/art
```

Expected: `BalancedSplitArt.jsx BracketArt.jsx ExpiredCourtArt.jsx HeroRallyArt.jsx PaddleStackArt.jsx QrBoardArt.jsx ScoreTapArt.jsx StandingWindowArt.jsx WinnersShuffleArt.jsx` (the ones `index.astro`, `how-it-works.astro`, `rotation.astro` and `ExpiredNotice.jsx` import). If Phase 4 made a page import one of the deleted 17, `npm run build` in Step 7 fails: restore that one file with `git checkout HEAD -- <file>` and say so in the commit message.

`_bootstrap-org-tmp.sql` (repo root) is gitignored and untracked, and holds the owner's real email. Check it is the old organization bootstrap, then delete the local file:

```bash
head -c 200 _bootstrap-org-tmp.sql 2>/dev/null; echo
rm -f _bootstrap-org-tmp.sql
```

Expected first output: `INSERT INTO organizations (id, name, slug, created_at, updated_at)…` (or nothing, if the file is already gone). Keep its `.gitignore` rule: it guards real emails if anyone ever recreates the file.

- [ ] **Step 5: Remove the tooling hooks and the operator session secret**

In `package.json`, find:

```json
    "lead-engine:zoho": "node scripts/lead-engine/zoho-setup.mjs",
    "pickleball:create-organization": "node scripts/pickleball/create-organization.mjs",
    "pickleball:seed:demo": "node scripts/pickleball/seed/generate-demo-seed.mjs > scripts/pickleball/seed/demo-seed.sql"
  },
```

Replace it with:

```json
    "lead-engine:zoho": "node scripts/lead-engine/zoho-setup.mjs"
  },
```

In `playwright.config.js`, find:

```js
        'npx wrangler d1 migrations apply devlab-pickleball --local && node scripts/pickleball/apply-e2e-fixtures.mjs && node scripts/mailbox/apply-e2e-fixtures.mjs && npx wrangler dev --port 8787 --local ' +
```

Replace it with:

```js
        'npx wrangler d1 migrations apply devlab-pickleball --local && node scripts/mailbox/apply-e2e-fixtures.mjs && npx wrangler dev --port 8787 --local ' +
```

In `.env.example`, find:

```bash
# Pickleball — Google OAuth (see docs/pickleball/runbook.md)
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
PICKLEBALL_SESSION_SECRET=
PICKLEBALL_OAUTH_REDIRECT_BASE_URL=http://localhost:8787
# Never set outside local/CI wrangler dev — enables POST /api/pickleball/auth/test-login
PICKLEBALL_TEST_AUTH_ENABLED=
```

Replace it with:

```bash
# Pickleball — Google sign-in for session hosts' DUPR export (see docs/pickleball/runbook.md)
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
PICKLEBALL_OAUTH_REDIRECT_BASE_URL=http://localhost:8787
# Never set outside local/CI wrangler dev — enables POST /api/pickleball/open/host/test-login
# and returns the DUPR export email in the response instead of sending it
PICKLEBALL_TEST_AUTH_ENABLED=
```

In `src/env.d.ts`, delete the line:

```ts
  PICKLEBALL_SESSION_SECRET?: string
```

and, in `App.Locals`, the line:

```ts
    pickleballSession?: { userId: string; googleSub: string; activeOrgId: string | null; exp: number }
```

In `scripts/mailbox/apply-e2e-fixtures.mjs`, find:

```js
 * <pkg>/bin/wrangler.js, two levels up and back down. Same resolution as
 * scripts/pickleball/apply-e2e-fixtures.mjs.
 */
```

Replace it with:

```js
 * <pkg>/bin/wrangler.js, two levels up and back down.
 */
```

In your own local `.dev.vars` (gitignored, never committed), delete the `PICKLEBALL_SESSION_SECRET=` line if present. Nothing reads it any more.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/worker/pickleball src/lib/pickleball src/lib/content`
Expected: PASS — the 12 guard tests, `oauth.test.js`, `webCrypto.test.js`, the tournament module tests (`advanceBracket`, `doubleElimination`, `generateFixtures`, `nextPlayableFixture`, `poolToBracket`, `rankTournamentStandings`, `singleElimination`), `reuse.test.ts`, and every free-session test.

- [ ] **Step 7: Typecheck, lint, build and the pickleball e2e**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: 0 errors.

Run: `npx playwright test --project=worker tests/e2e/pickleball/`
Expected: PASS as in Task 2 (the server command no longer runs the pickleball fixture script).

- [ ] **Step 8: Commit**

Add under `### Removed` in `## [Unreleased]`:

```markdown
- The operator app's code and tooling: its session cookie and auth (`authContext.js`, `session.js`), invite email, permissions, quotas, attendance, queue engine, per-rally scoring, OPI, standings, seeding, the 24 old repositories and 12 schemas, 17 illustrations only it used, `scripts/pickleball/` (organization bootstrap, demo seed, e2e fixtures) and the `pickleball:create-organization` / `pickleball:seed:demo` scripts. `PICKLEBALL_SESSION_SECRET` is no longer read; Google sign-in for hosts keeps `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` and `PICKLEBALL_OAUTH_REDIRECT_BASE_URL`.
```

```bash
git add -A src/worker/pickleball src/worker/repositories/pickleball src/lib/pickleball src/lib/schemas/pickleball \
  src/components/pickleball/art scripts/pickleball package.json playwright.config.js .env.example src/env.d.ts \
  scripts/mailbox/apply-e2e-fixtures.mjs CHANGELOG.md
git commit -m "feat(pickleball)!: delete the operator app's domain code and tooling"
```

---

### Task 5: Migration 0020 drops the legacy tables

**Files:**
- Create: `migrations/pickleball/0020_drop_legacy_pickleball.sql`
- Test: `src/worker/repositories/pickleball/open/dropLegacy.test.ts`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: `createSqliteD1(migrationFiles)` (`src/worker/repositories/pickleball/open/testing/sqliteD1.ts`, returns `{ d1, raw }` with foreign keys on); migrations `0001`–`0019`.
- Produces: `0020_drop_legacy_pickleball.sql`, which leaves exactly `host_logins, hosts, open_captains, open_courts, open_dupr_exports, open_host_keys, open_idempotency, open_matches, open_players, open_sessions, open_tournament_entrants, open_tournament_fixtures, open_tournaments` (plus D1's own `d1_migrations`, `_cf_*`, `sqlite_sequence`) and no trigger. Task 8 applies it remotely; Task 2's Playwright server command already applies it locally on every e2e run.

- [ ] **Step 1: Write the failing test**

`src/worker/repositories/pickleball/open/dropLegacy.test.ts`:

```ts
// 0020_drop_legacy_pickleball.sql (spec 2026-10-11 §12) runs once against
// production and preview data, so it is checked here against the real
// migrations rather than a hand-written schema.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { createSqliteD1 } from './testing/sqliteD1'

const DIR = 'migrations/pickleball'
const DROP = '0020_drop_legacy_pickleball.sql'
const ALL = readdirSync(join(process.cwd(), DIR)).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort()
const paths = (names: string[]) => names.map((name) => `${DIR}/${name}`)
/** 0001-0015: the logged-in app's schema. */
const LEGACY = ALL.filter((name) => Number(name.slice(0, 4)) <= 15)
/** Everything before the drop: the database as production and preview have it. */
const BEFORE_DROP = ALL.filter((name) => name < DROP)
const DROP_SQL = readFileSync(join(process.cwd(), DIR, DROP), 'utf8')

/** The free-session tables, which must survive untouched. */
const KEPT = [
  'host_logins', 'hosts', 'open_captains', 'open_courts', 'open_dupr_exports', 'open_host_keys', 'open_idempotency',
  'open_matches', 'open_players', 'open_sessions', 'open_tournament_entrants', 'open_tournament_fixtures', 'open_tournaments',
]

const names = (raw: DatabaseSync, type: 'table' | 'trigger'): string[] =>
  (raw.prepare("SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE 'sqlite_%' ORDER BY name").all(type) as { name: string }[]).map((row) => row.name)

const dropped = (kind: 'TABLE' | 'TRIGGER'): string[] =>
  [...DROP_SQL.matchAll(new RegExp(`^DROP ${kind} IF EXISTS (\\w+);$`, 'gm'))].map((match) => match[1])

describe('0020_drop_legacy_pickleball', () => {
  it('is the next migration after 0019', () => {
    expect(ALL.indexOf(DROP)).toBe(ALL.indexOf('0019_hosts.sql') + 1)
  })

  it('drops exactly the tables and the trigger of 0001-0015', () => {
    const { raw } = createSqliteD1(paths(LEGACY))
    expect([...dropped('TABLE')].sort()).toEqual(names(raw, 'table'))
    expect(dropped('TRIGGER')).toEqual(names(raw, 'trigger'))
    expect(dropped('TABLE')).toHaveLength(27)
  })

  it('drops every table only after every table that references it', () => {
    const { raw } = createSqliteD1(paths(LEGACY))
    const order = dropped('TABLE')
    order.forEach((table, index) => {
      const remaining = order.slice(index + 1)
      for (const child of remaining) {
        const parents = (raw.prepare(`PRAGMA foreign_key_list(${child})`).all() as { table: string }[]).map((fk) => fk.table)
        expect(parents, `${child} still references ${table} when ${table} is dropped`).not.toContain(table)
      }
    })
  })

  it('leaves only the free-session tables, with their rows, even when the old tables hold data', () => {
    const { raw } = createSqliteD1(paths(BEFORE_DROP))
    const now = '2026-10-12T10:00:00.000Z'
    raw.exec(`
      INSERT INTO users (id, google_sub, email, name, created_at, updated_at) VALUES ('u1', 'g1', 'a@example.com', 'A', '${now}', '${now}');
      INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES ('o1', 'Club', 'club', '${now}', '${now}');
      INSERT INTO organization_memberships (id, organization_id, user_id, invited_email, role, status, created_at, updated_at)
        VALUES ('m1', 'o1', 'u1', 'a@example.com', 'ADMIN', 'ACTIVE', '${now}', '${now}');
      INSERT INTO audit_events (id, organization_id, actor_user_id, action, entity_type, entity_id, created_at)
        VALUES ('e1', 'o1', 'u1', 'x', 'y', 'z', '${now}');
      INSERT INTO hosts (id, google_sub, email, display_name, created_at, last_seen_at) VALUES ('h1', 'g1', 'a@example.com', 'A', '${now}', '${now}');
      INSERT INTO open_sessions (id, public_code, host_key_hash, kind, name, host_display_name, settings_json, status, created_at, last_activity_at, expires_at, host_id)
        VALUES ('s1', 'ABCDE23456', 'hash', 'OPEN_PLAY', 'Sunday', 'Mo', '{}', 'ACTIVE', '${now}', '${now}', '${now}', 'h1');
    `)
    raw.exec(DROP_SQL)
    expect(names(raw, 'table')).toEqual(KEPT)
    expect(names(raw, 'trigger')).toEqual([])
    expect(raw.prepare("SELECT host_id FROM open_sessions WHERE id = 's1'").get()).toEqual({ host_id: 'h1' })
  })

  it('is a no-op the second time', () => {
    const { raw } = createSqliteD1(paths(ALL))
    expect(() => raw.exec(DROP_SQL)).not.toThrow()
    expect(names(raw, 'table')).toEqual(KEPT)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/worker/repositories/pickleball/open/dropLegacy.test.ts`
Expected: FAIL — `ENOENT … 0020_drop_legacy_pickleball.sql`.

- [ ] **Step 3: Write the migration**

`migrations/pickleball/0020_drop_legacy_pickleball.sql`:

```sql
-- migrations/pickleball/0020_drop_legacy_pickleball.sql
-- Free sessions, Phase 5: retire the logged-in operator app's data
-- (spec 2026-10-11-pickleball-free-open-play-design.md §12).
--
-- Drops the 27 tables of migrations 0001-0015 and their one trigger. The
-- open_* tables, hosts and host_logins (0016-0019) are not touched.
--
-- Order matters: children before parents. D1 enforces foreign keys, and
-- DROP TABLE first runs an implicit DELETE, so dropping a table that a
-- remaining table still references with rows would fail the migration.
-- src/worker/repositories/pickleball/open/dropLegacy.test.ts checks this order
-- against the real foreign keys of 0001-0015.
--
-- IF EXISTS everywhere, so the file is a no-op for anything already gone. DROP
-- TABLE is safe on D1; only table rebuilds are dangerous (docs/pickleball/
-- architecture.md, "Schema constraint"). Take a `wrangler d1 export` backup
-- first (docs/pickleball/runbook.md, "Retire the legacy tables").

DROP TRIGGER IF EXISTS trg_session_pairs_one_active_pair_per_player;

DROP TABLE IF EXISTS audit_events;
DROP TABLE IF EXISTS player_performance_snapshots;
DROP TABLE IF EXISTS player_game_stats;
DROP TABLE IF EXISTS matchmaking_history;
DROP TABLE IF EXISTS idempotency_keys;
DROP TABLE IF EXISTS score_events;
DROP TABLE IF EXISTS game_participants;
DROP TABLE IF EXISTS tournament_fixtures;
DROP TABLE IF EXISTS tournament_entrants;
DROP TABLE IF EXISTS games;
DROP TABLE IF EXISTS team_members;
DROP TABLE IF EXISTS teams;
DROP TABLE IF EXISTS queue_entries;
DROP TABLE IF EXISTS session_pairs;
DROP TABLE IF EXISTS session_players;
DROP TABLE IF EXISTS session_operator_grants;
DROP TABLE IF EXISTS public_session_tokens;
DROP TABLE IF EXISTS session_courts;
DROP TABLE IF EXISTS pickleball_sessions;
DROP TABLE IF EXISTS scoring_rulesets;
DROP TABLE IF EXISTS courts;
DROP TABLE IF EXISTS venues;
DROP TABLE IF EXISTS players;
DROP TABLE IF EXISTS organization_invites;
DROP TABLE IF EXISTS organization_memberships;
DROP TABLE IF EXISTS organizations;
DROP TABLE IF EXISTS users;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/worker/repositories/pickleball/open`
Expected: PASS — the 5 new tests and every existing repository test (they build their own databases from `0016`–`0019` and never read `0020`).

Check that the order test can fail: temporarily move the `DROP TABLE IF EXISTS users;` line to just after the trigger line and re-run; expected `audit_events still references users when users is dropped`. Put the line back and re-run (PASS).

- [ ] **Step 5: Apply it to a local D1 that holds old rows**

`createSqliteD1` is node's SQLite; this checks D1's own engine (workerd via miniflare). Use a throwaway state directory under the repo's ignored `.wrangler/` so your normal local database is untouched:

```bash
S=.wrangler/p5-check
rm -rf "$S"
mv migrations/pickleball/0020_drop_legacy_pickleball.sql /tmp/0020.sql
npx wrangler d1 migrations apply devlab-pickleball --local --persist-to "$S"
N=2026-10-12T10:00:00.000Z
npx wrangler d1 execute devlab-pickleball --local --persist-to "$S" --command "INSERT INTO users (id, google_sub, email, name, created_at, updated_at) VALUES ('u1','g1','a@example.com','A','$N','$N'); INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES ('o1','Club','club','$N','$N'); INSERT INTO organization_memberships (id, organization_id, user_id, invited_email, role, status, created_at, updated_at) VALUES ('m1','o1','u1','a@example.com','ADMIN','ACTIVE','$N','$N'); INSERT INTO audit_events (id, organization_id, actor_user_id, action, entity_type, entity_id, created_at) VALUES ('e1','o1','u1','x','y','z','$N'); INSERT INTO open_sessions (id, public_code, host_key_hash, kind, name, host_display_name, settings_json, status, created_at, last_activity_at, expires_at) VALUES ('s1','ABCDE23456','hash','OPEN_PLAY','Sunday','Mo','{}','ACTIVE','$N','$N','2099-01-01T00:00:00.000Z');"
mv /tmp/0020.sql migrations/pickleball/0020_drop_legacy_pickleball.sql
npx wrangler d1 migrations apply devlab-pickleball --local --persist-to "$S"
npx wrangler d1 execute devlab-pickleball --local --persist-to "$S" --command "SELECT type, name FROM sqlite_master WHERE type IN ('table','trigger') ORDER BY type, name; SELECT COUNT(*) AS n FROM open_sessions"
rm -rf "$S"
```

Expected: the second `apply` reports `0020_drop_legacy_pickleball.sql ✅`; the read-back lists `_cf_METADATA`, `d1_migrations`, the 13 kept tables and `sqlite_sequence`, no trigger, and `n = 1`. (On Windows, keep the state directory short: miniflare's database file names are 64 hex characters, and a deep path passes the 260-character limit with an opaque "internal error".)

- [ ] **Step 6: Commit**

Add under `### Removed` in `## [Unreleased]`:

```markdown
- D1 (`PICKLEBALL_DB`): migration `0020_drop_legacy_pickleball.sql` drops the operator app's 27 tables (organizations, users, memberships, invites, venues, courts, rulesets, sessions, players, queue, pairs, teams, games, score events, stats, OPI snapshots, tournaments, audit) and the one-active-pair trigger, children first. The `open_*` tables, `hosts` and `host_logins` are untouched. Apply it only after a `wrangler d1 export` backup (`docs/pickleball/runbook.md`).
```

```bash
git add migrations/pickleball/0020_drop_legacy_pickleball.sql src/worker/repositories/pickleball/open/dropLegacy.test.ts CHANGELOG.md
git commit -m "feat(pickleball)!: drop the operator app's d1 tables (migration 0020)"
```

---

### Task 6: Docs describe only what exists

**Files:**
- Modify: `docs/pickleball/architecture.md`, `docs/pickleball/runbook.md`
- Rewrite: `docs/pickleball/schema.md`, `docs/pickleball/realtime.md`
- Modify: `docs/pickleball/opi-methodology.md` (banner), `docs/architecture/decisions/0006-pickleball-durable-objects.md`, `docs/operations.md`, `docs/security.md`, `docs/lead-engine/environment.md`
- Modify: the 17 old pickleball plans and 6 old pickleball specs under `docs/superpowers/` (banner only)
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: the facts of Tasks 1–5 (paths, tags, migration, redirect rows) and Phase 4 Task 11's docs, which this task edits around rather than over.
- Produces: the runbook sections "Retire the legacy tables (migration 0020)" and "Redirects for the retired app's links", which Task 8 follows.

- [ ] **Step 1: Architecture**

In `docs/pickleball/architecture.md`, replace everything from the first line through the line `Spec: \`docs/superpowers/specs/2026-10-11-pickleball-free-open-play-design.md\`.` (the first line of the "Free open play (2026-10)" section; the title, the operator-platform intro, the OPI non-goal paragraph and the `## Free open play (2026-10)` heading go with it) with:

```markdown
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
```

Find:

```markdown
session is deleted 7 days after its last activity. The logged-in operator app
described in the rest of this document is **legacy until Phase 5** of that spec
and is untouched by this feature; the two share only the `PICKLEBALL_DB`
database and the Worker.
```

Replace it with:

```markdown
session is deleted 7 days after its last activity. The logged-in operator app
that came before it was retired in Phase 5 (below).
```

Find:

```markdown
  by win rate, then OPI per-game points share, then head-to-head, then name.
```

Replace it with:

```markdown
  by win rate, then the per-game share of points won, then head-to-head, then name.
```

If Phase 4's section says `` `finishHostSignIn` (the old operator branch goes in Phase 5)``, replace that phrase with `` `finishHostSignIn` (its only caller since Phase 5)``.

Replace everything from the line `## Foundational pieces` up to, **not** including, `### Schema constraint: CHECK clauses cannot be widened` with:

```markdown
### Phase 5 (the logged-in app retired)

- **Removed.** The operator SPA (`/pickleball/app`), invites
  (`/pickleball/accept-invite/*`), the live and TV views (`/pickleball/live/*`),
  the OPI methodology page, every `/api/pickleball/` route outside `open/`
  except the Google callback, the operator session cookie and its middleware
  gate, per-rally scoring, OPI, `SessionCoordinatorDO` (wrangler tag `v4`,
  `deleted_classes`) and the 27 tables of migrations 0001–0015
  (`0020_drop_legacy_pickleball.sql`, children first).
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

```

Find:

```markdown
`pickleball_sessions` alone is referenced by nine foreign keys across five
migrations. So: model a new enum value as a **new nullable column** with its
own CHECK (`ALTER TABLE ... ADD COLUMN` with a column-level CHECK does work,
and is verified), or make the original CHECK wide enough up front. This is why
a tournament is a `FIXED_PAIRS` session carrying a `tournament_format` rather
than a third `session_type`.
```

Replace it with:

```markdown
`open_sessions` is referenced by every other free-session table, each with
`ON DELETE CASCADE`, so rebuilding it would empty them all. Model a new enum
value as a **new nullable column** with its own CHECK (`ALTER TABLE ... ADD
COLUMN` with a column-level CHECK does work, and is verified), or write the
original CHECK wide enough up front, as 0016 did for `kind`. Dropping a whole
table is safe: 0020 dropped the retired app's 27 tables, children first.
```

Replace everything from the line `## Multi-tenancy & RBAC` to the end of the file (the RBAC section, the old phase table, including any row Phase 4 edited, and the "Deliberately not built" paragraph) with:

```markdown
## Phase history

| Phase | Scope | Status |
|---|---|---|
| Operator app (2026-08 to 2026-09) | Logged-in club platform: organizations and invites, Google sign-in, attendance, queue, per-rally scoring, OPI, live and TV views, fixed pairs, tournaments C1–C5 | Retired in Phase 5 |
| Free sessions 1 | Anonymous create, roster, courts, paddle stack, final-score entry, live QR board, results CSV, 7-day purge, public pages rewritten (`0016`) | Built |
| Free sessions 2 | Four stacking modes, keep together/apart, fairness panel, QR check-in, court captains, TV board (`0017`) | Built |
| Free sessions 3 | Doubles tournaments (`0018`) | Built |
| Free sessions 4 | Google host sign-in, claim, DUPR export email, My sessions, account deletion (`0019`) | Built |
| Free sessions 5 | The operator app and its data retired (`0020`, wrangler `v4`) | Built (preview); production with the 2.0.0 release |

Which release shipped each phase is in `CHANGELOG.md`.
```

Run: `grep -nE "SessionCoordinatorDO|organization_id|operator SPA|/pickleball/app|OPI" docs/pickleball/architecture.md`
Expected: only lines inside "Phase 5 (the logged-in app retired)", the phase table, and Phase 3's sentence about `reuse.test.ts`.

- [ ] **Step 2: Schema (whole file)**

Replace the whole of `docs/pickleball/schema.md` with:

````markdown
# Devlab Pickleball — Schema

D1 database `PICKLEBALL_DB` (production `devlab-pickleball`, preview
`devlab-pickleball-preview`), migrations in `migrations/pickleball/`. Every
session-owned table cascades from `open_sessions`, so the daily purge deletes a
session with one `DELETE` (`src/worker/pickleball/open/purge.ts`). Rules: a
CHECK cannot be widened later, `ALTER TABLE … ADD COLUMN` is safe, never
rebuild a table (`architecture.md`, "Schema constraint"). Timestamps are ISO
8601 text; ids are random UUIDs unless noted.

## Migration files

| File | What it does |
|---|---|
| `0001`–`0015` | The retired operator app's schema. Kept because D1 records applied migrations by file name; never edit them. Their tables are gone (0020). |
| `0016_open_sessions.sql` | `open_sessions`, `open_courts`, `open_players`, `open_matches`, `open_idempotency` |
| `0017_open_captains.sql` | `open_captains`; `open_matches.recorded_by` |
| `0018_open_tournaments.sql` | `open_tournaments`, `open_tournament_entrants`, `open_tournament_fixtures` |
| `0019_hosts.sql` | `hosts`, `host_logins`, `open_sessions.host_id`, `open_host_keys`, `open_dupr_exports` |
| `0020_drop_legacy_pickleball.sql` | Drops the 27 tables of 0001–0015 and their trigger, children first |

## Sessions

### `open_sessions`

| Column | Notes |
|---|---|
| `id` | primary key |
| `public_code` | UNIQUE, 10 characters, in the board URL `/pickleball/s/{code}` |
| `host_key_hash` | SHA-256 of the host secret (the secret is never stored) |
| `kind` | `OPEN_PLAY` or `TOURNAMENT` (CHECK), fixed at creation |
| `name`, `host_display_name`, `location` | free text; `location` nullable |
| `settings_json` | mode, target, scoring style, keep-together/apart rules (read through `normalizeSettings`) |
| `status` | `ACTIVE` or `ENDED` (CHECK) |
| `version` | bumped by every command; persisted so it survives hibernation |
| `created_at`, `last_activity_at`, `expires_at` | `expires_at` = last activity + 7 days; indexed for the purge |
| `host_id` | nullable, `REFERENCES hosts(id) ON DELETE SET NULL`: the Google account that claimed the session (0019) |

### `open_courts`
`id`, `session_id` (cascade), `label`, `position`, `enabled` (0/1).

### `open_players`
`id`, `session_id` (cascade), `name`, `skill` (nullable real), `dupr_id` (nullable),
`status` (`ACTIVE` | `BREAK` | `LEFT`), `games_offset` (a late player's starting
count), `joined_at`, `waiting_since`, `position`.

### `open_matches`
`id`, `session_id` (cascade), `court_id` (cascade), `seq`, `status`
(`PROPOSED` | `IN_PROGRESS` | `FINISHED` | `ABANDONED`), `team_a_json`,
`team_b_json` (player id pairs), `score_a`, `score_b`, `winner` (`A` | `B`),
`fixture_id` (a tournament game's fixture, text), `proposed_at`, `started_at`,
`finished_at`, `recorded_by` (`Host` or a captain's label, 0017).

### `open_idempotency`
Primary key (`session_id`, `key`); `response_json`, `created_at`. Replays a retried command's response.

### `open_captains` (0017)
`id`, `session_id` (cascade), `court_id` (cascade), `key_hash` (UNIQUE), `label`,
`created_at`, `revoked_at` (a revoked link keeps its row).

## Tournaments (0018)

### `open_tournaments`
`session_id` (primary key, cascade), `format` (`ROUND_ROBIN` | `POOL_TO_BRACKET` |
`SINGLE_ELIMINATION` | `DOUBLE_ELIMINATION`), `pairing`, `seeding`, `phase`
(no CHECK; normalized on read), `started_at`.

### `open_tournament_entrants`
`id`, `session_id` (cascade), `player_a_id`, `player_b_id`, `seed`, `pool_label`.

### `open_tournament_fixtures`
`id`, `session_id` (cascade), `bracket` (`POOL` | `MAIN` | `LOSERS`), `pool_label`,
`round_number`, `position`, `entrant_a_id`, `entrant_b_id`, `source_a`,
`source_b`, `winner_entrant_id`, `status` (`PENDING` | `READY` | `IN_PROGRESS` |
`FINISHED` | `BYE`). Rows have no order column: `tournament/order.ts` is the one
order. Entrant and fixture ids reference each other only as text.

## Hosts and the DUPR export (0019)

### `hosts`
`id`, `google_sub` (UNIQUE), `email` (verified Google address), `display_name`,
`dupr_club_id`, `marketing_opt_in` (0/1, default 0), `created_at`,
`last_seen_at`. Not subject to the 7-day expiry; removed by "Delete my account".

### `host_logins`
`token_hash` (primary key, SHA-256 of the `devlab_pb_host` cookie's token),
`host_id` (cascade from `hosts`), `created_at`, `expires_at` (30 days; the daily
cron deletes expired rows).

### `open_host_keys`
`id`, `session_id` (cascade), `key_hash` (UNIQUE), `created_at`: extra host links
minted when a signed-in host reopens a claimed session (at most 10).

### `open_dupr_exports`
`id`, `session_id` (cascade), `sent_at`, `game_count`, `skipped_count`: one row per
export email, for the 5-per-24-hours limit. No personal data.
````

- [ ] **Step 3: Realtime (whole file)**

Replace the whole of `docs/pickleball/realtime.md` with:

```markdown
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
```

- [ ] **Step 4: Runbook**

In `docs/pickleball/runbook.md`, replace everything from the first line up to, **not** including, `## Free open play` with:

````markdown
# Devlab Pickleball — Runbook

Devlab Pickleball is the free, no-login session tool at `/pickleball`
(`architecture.md`, `schema.md`, `realtime.md`). The logged-in operator app that
came before it was retired in 2.0.0; "Retire the legacy tables" below records how
its data was removed.

## Local development

1. Apply migrations: `npx wrangler d1 migrations apply devlab-pickleball --local`.
2. `npm run build`, then `npx wrangler dev --local`, and open
   `http://localhost:8787/pickleball/new`. No account is needed to run a session.
3. Host sign-in for the DUPR export (optional): add to `.dev.vars` (gitignored)
   ```
   GOOGLE_OAUTH_CLIENT_ID=<from Google Cloud Console>
   GOOGLE_OAUTH_CLIENT_SECRET=<from Google Cloud Console>
   PICKLEBALL_OAUTH_REDIRECT_BASE_URL=http://localhost:8787
   ```
   with `http://localhost:8787/api/pickleball/auth/google/callback` as an
   authorized redirect URI. For e2e, `PICKLEBALL_TEST_AUTH_ENABLED=true` instead
   lets `POST /api/pickleball/open/host/test-login` stand in for Google.

## Running tests

- Unit: `npm run test:unit -- src/lib/pickleball src/worker/pickleball src/worker/repositories/pickleball`
- E2E: `npx playwright test --project=worker tests/e2e/pickleball/`. The `worker`
  project's server command applies the pickleball migrations to the local D1
  itself; no fixtures are needed.

````

Insert immediately before the line `## Notes`:

````markdown
### Retire the legacy tables (migration 0020)

`0020_drop_legacy_pickleball.sql` drops the operator app's 27 tables and its
trigger. It was applied to preview, then to production with the 2.0.0 release,
in this order, each command with `CLOUDFLARE_ACCOUNT_ID=<personal account ID>`
and a freshly pasted `CLOUDFLARE_API_TOKEN` inline (`--env preview` for preview):

1. Deploy the code that no longer uses the tables first (preview: push
   `development`; production: the release deploy of `main`).
2. `npx wrangler d1 migrations list <db> --remote`: `0020` must be the only
   pending file. `migrations apply` cannot stop at a file, so if `0016`–`0019`
   are pending too, stop and ask the owner.
3. List the tables and count the 27 legacy tables' rows (Task 8 of
   `docs/superpowers/plans/2026-10-12-pickleball-free-open-play-phase5.md` has
   the exact SQL). Production held 3 `users`, 1 `organizations`, 6
   `audit_events` (the owner's own accounts) and at most the 1 seeded
   `scoring_rulesets` row; anything else means stop.
4. Record a Time Travel bookmark: `npx wrangler d1 time-travel info <db>`.
5. Back up outside the repo:
   `npx wrangler d1 export <db> --remote --output "$HOME/devlab-backups/pickleball-2.0/<db>-before-0020.sql"`.
6. `npx wrangler d1 migrations apply <db> --remote`.
7. Read the table list back: only `open_*`, `hosts`, `host_logins` and D1's own
   `d1_migrations` / `_cf_*` remain, with no trigger.

To restore, either `npx wrangler d1 time-travel restore <db> --bookmark=<bookmark>`
(within 30 days; it rolls back **everything** after the bookmark, including free
sessions), or apply the export to a new database and copy rows out of it.

### Redirects for the retired app's links

The old URLs answer through the CMS `redirects` table (`DB`, not
`PICKLEBALL_DB`), consulted by `src/middleware.ts` only on a 404; a `from_path`
ending in `/*` covers everything below it. Rows, all 301: `/pickleball/app` and
`/pickleball/app/*` → `/pickleball/new`, `/pickleball/methodology` →
`/pickleball/rotation`, `/pickleball/live/*` → `/pickleball`. They are written
with guarded inserts (never the seed script), so re-running is a no-op:

```sql
INSERT INTO redirects (id, from_path, to_path, status_code, note, created_at, updated_at)
SELECT 'redirect-pickleball-app', '/pickleball/app', '/pickleball/new', 301, 'Pickleball 2.0: the logged-in app was retired.', datetime('now'), datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM redirects WHERE from_path = '/pickleball/app');
INSERT INTO redirects (id, from_path, to_path, status_code, note, created_at, updated_at)
SELECT 'redirect-pickleball-app-all', '/pickleball/app/*', '/pickleball/new', 301, 'Pickleball 2.0: every page of the retired app.', datetime('now'), datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM redirects WHERE from_path = '/pickleball/app/*');
INSERT INTO redirects (id, from_path, to_path, status_code, note, created_at, updated_at)
SELECT 'redirect-pickleball-methodology', '/pickleball/methodology', '/pickleball/rotation', 301, 'Pickleball 2.0: OPI retired; the rotation page explains the new engine.', datetime('now'), datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM redirects WHERE from_path = '/pickleball/methodology');
INSERT INTO redirects (id, from_path, to_path, status_code, note, created_at, updated_at)
SELECT 'redirect-pickleball-live-all', '/pickleball/live/*', '/pickleball', 301, 'Pickleball 2.0: old live and TV links (QR codes) of the retired app.', datetime('now'), datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM redirects WHERE from_path = '/pickleball/live/*');
```

They can also be edited on the admin's Redirects screen. Deleting one turns
those old links into 404s, nothing worse.

````

Replace everything from the line `## Notes` to the end of the file with:

```markdown
## Notes

- `PICKLEBALL_TEST_AUTH_ENABLED` must never be set in `wrangler.jsonc`'s committed `vars` — it exists only for local/CI `.dev.vars`.
- Nobody needs an account to run or view a session. The only accounts are `hosts`, created when a host signs in with Google for the DUPR export.
```

Run: `grep -nE "create-organization|PICKLEBALL_SESSION_SECRET|/pickleball/app\b|platform admin|seed:demo" docs/pickleball/runbook.md`
Expected: only `/pickleball/app` inside the redirects section.

- [ ] **Step 5: The smaller docs**

In `docs/pickleball/opi-methodology.md`, insert after the first line (`# Devlab Pickleball — OPI Methodology`) a blank line and:

```markdown
> **Retired (2.0.0).** OPI and its public page (`/pickleball/methodology`) were removed with the logged-in app. One idea survives: free-session standings break ties by the same per-game share of points won (`src/lib/pickleball/open/standings.ts`). The rest of this document is history.
```

In `docs/architecture/decisions/0006-pickleball-durable-objects.md`, find:

```markdown
## Status
Accepted
```

Replace it with:

```markdown
## Status
Accepted (amended 2026-10, see "Amendment" at the end)
```

and append at the end of the file:

```markdown

## Amendment (2026-10, Pickleball 2.0)
`SessionCoordinatorDO` was deleted with the logged-in app it served (wrangler
tag `v4`, `deleted_classes`). The free sessions that replaced it use the same
pattern with one change: `OpenSessionDO` (one per session,
`idFromName(publicCode)`) keeps the session in memory after one load from D1 and
writes only the changed rows per command, instead of re-deriving from D1 on every
call. D1 is still the source of truth. The custom entrypoint stays, for
`OpenSessionDO`, `RateLimiterDO` and `scheduled()`.
```

In `docs/operations.md`, find:

```markdown
| `SESSION_COORDINATOR` | Durable Object | `SessionCoordinatorDO` (Pickleball) |
```

Replace it with:

```markdown
| `OPEN_SESSION` | Durable Object | `OpenSessionDO` (Pickleball, one per free session) |
```

In `docs/lead-engine/environment.md`, find:

```markdown
`IMAGES`, `MEDIA_BUCKET` (R2), `PICKLEBALL_DB` and `SESSION_COORDINATOR` exist
```

Replace it with:

```markdown
`IMAGES`, `MEDIA_BUCKET` (R2), `PICKLEBALL_DB` and `OPEN_SESSION` exist
```

In `docs/security.md`, find:

```markdown
| `public-state` (Pickleball) | client IP | 60 per min |
```

Replace it with:

```markdown
| `open-create` (Pickleball) | client IP | 10 per day; fails closed |
| `open-state` (Pickleball) | client IP | 1200 per min |
| `open-ws` (Pickleball) | client IP | 300 connects per min |
| `open-host-ip` (Pickleball) | client IP | 600 per min |
| `open-checkin-ip` (Pickleball) | client IP | 30 per 10 min; fails closed |
| `open-host-account` (Pickleball) | client IP | 120 per min |
| `open-host-signin` (Pickleball) | client IP | 20 per 10 min |
```

Check those numbers against the code before saving (`grep -rn "checkRateLimit(env, 'open" src`); if Phase 4 changed one, write what the code says.

- [ ] **Step 6: Mark the old plans and specs superseded**

```bash
BANNER='> **Superseded (2026-10-12).** This describes the logged-in operator app, retired in 2.0.0 by Phase 5 of `docs/superpowers/specs/2026-10-11-pickleball-free-open-play-design.md`. Kept as history: the routes, tables and files it names no longer exist.'
for f in docs/superpowers/plans/2026-08-2[4-7]-devlab-pickleball-*.md \
         docs/superpowers/plans/2026-09-01-devlab-pickleball-platform-pilot.md \
         docs/superpowers/plans/2026-09-01-pickleball-operator-ui-redesign.md \
         docs/superpowers/plans/2026-09-0[678]-pickleball-*.md \
         docs/superpowers/specs/2026-08-2[456]-devlab-pickleball*.md \
         docs/superpowers/specs/2026-09-01-*pickleball*.md \
         docs/superpowers/specs/2026-09-06-pickleball-pages-pairs-tournaments-design.md; do
  grep -q '^> \*\*Superseded (2026-10-12)' "$f" || node -e "const fs=require('fs');const [f,b]=process.argv.slice(1);const s=fs.readFileSync(f,'utf8');const i=s.indexOf('\n');fs.writeFileSync(f,s.slice(0,i+1)+'\n'+b+'\n'+s.slice(i+1))" "$f" "$BANNER"
done
grep -l '^> \*\*Superseded (2026-10-12)' docs/superpowers/plans/*.md docs/superpowers/specs/*.md | wc -l
```

Expected: `23` (17 plans, 6 specs). The free open play spec and its phase plans are not touched.

- [ ] **Step 7: Commit**

Add under `### Removed` in `## [Unreleased]`:

```markdown
- Docs: `docs/pickleball/{architecture,schema,realtime,runbook}.md` describe only the free sessions (the operator app's setup, platform admin, demo data, RBAC and schema sections are gone; the runbook records how its tables were dropped and how the old links redirect); ADR 0006 is amended, `opi-methodology.md` and the old pickleball plans and specs are marked retired or superseded.
```

```bash
git add docs CHANGELOG.md
git commit -m "docs(pickleball): describe the product after the operator app's retirement"
```

---

### Task 7: Full verification and the preview deploy (no release)

**Files:** none changed (fix-ups, if any, go in their own commits with their own CHANGELOG line).

**Interfaces:**
- Consumes: Tasks 1–6.
- Produces: `development` pushed and deployed to preview, with `SessionCoordinatorDO` deleted there; Task 8 depends on this deploy having succeeded.

- [ ] **Step 1: Nothing retired is left behind**

```bash
grep -rnE "pickleball-app|SessionCoordinatorDO|SESSION_COORDINATOR|requirePickleballSession|PICKLEBALL_SESSION_SECRET|authContext|legacyOperatorCallback" \
  src tests scripts wrangler.jsonc playwright.config.js package.json .env.example public
```

Expected: only `src/worker/pickleball/retirement.test.ts`, `src/worker/pickleball/open/phase5Safety.test.ts`, `src/lib/pickleball/open/tournament/reuse.test.ts` (their ban lists), `src/pickleball-open/components/QrCode.jsx` (the "Copied from" comment), the `v1` and `v4` tags in `wrangler.jsonc`, and `src/worker/pickleball/open/hostSession.ts`'s comment about the old secret. Anything else: fix it in its own commit.

- [ ] **Step 2: Full local verification**

Stop stale servers (`tasklist //FI "IMAGENAME eq node.exe"`; kill any `wrangler dev` / `astro preview` you started).

Run: `npm run typecheck && npm run build && npm run test:unit && npm run lint`
Expected: 0 type errors; build completes; all unit tests pass except the known `src/lead-engine/jobs/handlers.test.js` failure; lint 0 errors (1 known warning).

Run: `npx playwright test`
Expected: the full suite passes (`static`, `admin-auth`, `worker`, `desktop-safari`, `mobile-safari`) apart from the known services-page test. The old `tests/e2e/pickleball/pickleball-*.spec.js` suites (except public pages) no longer exist, so the `worker` project's pickleball count drops accordingly; nothing that remains may fail. The server command applies `0020` to your default local D1, dropping your local legacy tables; that is intended.

- [ ] **Step 3: Push `development` and watch the preview deploy**

```bash
git push origin development
gh run list --workflow deploy-preview.yml --limit 1
gh run watch "$(gh run list --workflow deploy-preview.yml --limit 1 --json databaseId -q '.[0].databaseId')" --exit-status
```

Expected: the run succeeds. Its `wrangler deploy` applies DO migration `v4` (the log mentions deleting `SessionCoordinatorDO`). If it fails on the DO migration, stop and report the log; do not edit tags by hand.

- [ ] **Step 4: Smoke-test the code on preview (before any data change)**

```bash
P=https://devlab-studios-preview.stpnrey-agustinez.workers.dev
for path in /pickleball /pickleball/new /pickleball/rotation /pickleball/how-it-works; do printf '%s %s\n' "$(curl -s -o /dev/null -w '%{http_code}' "$P$path")" "$path"; done
for path in /api/pickleball/auth/session /api/pickleball/sessions /pickleball/accept-invite/x; do printf '%s %s\n' "$(curl -s -o /dev/null -w '%{http_code}' "$P$path")" "$path"; done
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' "$P/api/pickleball/auth/google/callback?code=x&state=y"
```

Expected: `200` for the four pages; `404` for the three retired routes; the callback `302 …/pickleball/my-sessions?signin=failed`. Then on a phone: create a session, play one game, open the board in a second browser, and (if Google is configured on preview) sign in for the DUPR sheet; all work as before. Report what was checked.

---

### Task 8: Operations — back up and drop the data, add the redirects, remove the secret

The controller runs this with the user. It changes remote data; every write is read first and read back. Ask the user to paste a fresh `CLOUDFLARE_API_TOKEN` and to give the personal account ID for these commands; put both inline on each command as shown, never `export` them, write them to a file or echo them. If the sandbox blocks a command that combines the token with a remote write, retry once; if it still blocks, stop and let the user decide (`AGENTS.md`).

**Files:** none in the repo. Backups and the two SQL helpers go in `$HOME/devlab-backups/pickleball-2.0/`, outside the repo.

**Interfaces:**
- Consumes: Task 5's migration, Task 1's wildcard lookup, Task 7's preview deploy.
- Produces: preview (and later production) with only the free-session tables, the four redirect rows, no `PICKLEBALL_SESSION_SECRET` secret, and a dated export of each database before the drop.

- [ ] **Step 1: Prepare the backup folder and the two SQL helpers**

```bash
B="$HOME/devlab-backups/pickleball-2.0"
mkdir -p "$B"
cat > "$B/legacy-counts.sql" <<'SQL'
SELECT 'users' AS t, COUNT(*) AS n FROM users UNION ALL SELECT 'organizations', COUNT(*) FROM organizations
UNION ALL SELECT 'organization_memberships', COUNT(*) FROM organization_memberships UNION ALL SELECT 'organization_invites', COUNT(*) FROM organization_invites
UNION ALL SELECT 'players', COUNT(*) FROM players UNION ALL SELECT 'venues', COUNT(*) FROM venues
UNION ALL SELECT 'courts', COUNT(*) FROM courts UNION ALL SELECT 'scoring_rulesets', COUNT(*) FROM scoring_rulesets
UNION ALL SELECT 'pickleball_sessions', COUNT(*) FROM pickleball_sessions UNION ALL SELECT 'session_courts', COUNT(*) FROM session_courts
UNION ALL SELECT 'public_session_tokens', COUNT(*) FROM public_session_tokens UNION ALL SELECT 'session_operator_grants', COUNT(*) FROM session_operator_grants
UNION ALL SELECT 'session_players', COUNT(*) FROM session_players UNION ALL SELECT 'session_pairs', COUNT(*) FROM session_pairs
UNION ALL SELECT 'queue_entries', COUNT(*) FROM queue_entries UNION ALL SELECT 'teams', COUNT(*) FROM teams
UNION ALL SELECT 'team_members', COUNT(*) FROM team_members UNION ALL SELECT 'games', COUNT(*) FROM games
UNION ALL SELECT 'tournament_entrants', COUNT(*) FROM tournament_entrants UNION ALL SELECT 'tournament_fixtures', COUNT(*) FROM tournament_fixtures
UNION ALL SELECT 'game_participants', COUNT(*) FROM game_participants UNION ALL SELECT 'score_events', COUNT(*) FROM score_events
UNION ALL SELECT 'idempotency_keys', COUNT(*) FROM idempotency_keys UNION ALL SELECT 'matchmaking_history', COUNT(*) FROM matchmaking_history
UNION ALL SELECT 'player_game_stats', COUNT(*) FROM player_game_stats UNION ALL SELECT 'player_performance_snapshots', COUNT(*) FROM player_performance_snapshots
UNION ALL SELECT 'audit_events', COUNT(*) FROM audit_events
UNION ALL SELECT '(free) open_sessions', COUNT(*) FROM open_sessions UNION ALL SELECT '(free) hosts', COUNT(*) FROM hosts;
SQL
```

Then write `$B/pickleball-redirects.sql` with exactly the four `INSERT … WHERE NOT EXISTS` statements from `docs/pickleball/runbook.md`, "Redirects for the retired app's links" (copy them from there; do not retype).

- [ ] **Step 2: Preview — read before anything changes**

```bash
CLOUDFLARE_API_TOKEN=<pasted> CLOUDFLARE_ACCOUNT_ID=<personal account ID> npx wrangler d1 migrations list devlab-pickleball-preview --remote --env preview
CLOUDFLARE_API_TOKEN=<pasted> CLOUDFLARE_ACCOUNT_ID=<personal account ID> npx wrangler d1 execute devlab-pickleball-preview --remote --env preview --json \
  --command "SELECT type, name, tbl_name FROM sqlite_master WHERE type IN ('table','trigger') AND name NOT LIKE 'sqlite_%' ORDER BY type, name"
CLOUDFLARE_API_TOKEN=<pasted> CLOUDFLARE_ACCOUNT_ID=<personal account ID> npx wrangler d1 execute devlab-pickleball-preview --remote --env preview --json --file "$B/legacy-counts.sql"
```

Expected: exactly one pending migration, `0020_drop_legacy_pickleball.sql`. Tables: the 27 legacy names (as in `legacy-counts.sql`), the 13 free-session tables, `d1_migrations`, any `_cf_*`, plus the probe tables `zz_probe` and `zz_trg_probe`; triggers: `trg_session_pairs_one_active_pair_per_player`, `zz_probe_trg`, `zz_trg_probe_t`. Counts: demo data; write them down with the `open_sessions` and `hosts` counts. Any other pending migration, table or trigger: stop and report.

- [ ] **Step 3: Preview — bookmark and back up**

```bash
CLOUDFLARE_API_TOKEN=<pasted> CLOUDFLARE_ACCOUNT_ID=<personal account ID> npx wrangler d1 time-travel info devlab-pickleball-preview --env preview
CLOUDFLARE_API_TOKEN=<pasted> CLOUDFLARE_ACCOUNT_ID=<personal account ID> npx wrangler d1 export devlab-pickleball-preview --remote --env preview --output "$B/devlab-pickleball-preview-before-0020.sql"
ls -l "$B/devlab-pickleball-preview-before-0020.sql"; grep -c "CREATE TABLE" "$B/devlab-pickleball-preview-before-0020.sql"
```

Expected: a bookmark (write it down next to the counts); a non-empty export containing at least 40 `CREATE TABLE` statements. No export, no drop.

- [ ] **Step 4: Preview only — remove the probe objects by hand**

Read them first:

```bash
CLOUDFLARE_API_TOKEN=<pasted> CLOUDFLARE_ACCOUNT_ID=<personal account ID> npx wrangler d1 execute devlab-pickleball-preview --remote --env preview --json \
  --command "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name LIKE 'zz%' ORDER BY type, name"
```

Expected: exactly `zz_probe` and `zz_trg_probe` (tables) and `zz_probe_trg`, `zz_trg_probe_t` (triggers). If there is anything else, or a trigger whose `tbl_name` is not a `zz_` table, stop and report it. Then:

```bash
CLOUDFLARE_API_TOKEN=<pasted> CLOUDFLARE_ACCOUNT_ID=<personal account ID> npx wrangler d1 execute devlab-pickleball-preview --remote --env preview \
  --command "DROP TRIGGER IF EXISTS zz_probe_trg; DROP TRIGGER IF EXISTS zz_trg_probe_t; DROP TABLE IF EXISTS zz_trg_probe; DROP TABLE IF EXISTS zz_probe;"
```

Re-run the read: expected no rows.

- [ ] **Step 5: Preview — apply 0020 and read back**

```bash
CLOUDFLARE_API_TOKEN=<pasted> CLOUDFLARE_ACCOUNT_ID=<personal account ID> npx wrangler d1 migrations apply devlab-pickleball-preview --remote --env preview
CLOUDFLARE_API_TOKEN=<pasted> CLOUDFLARE_ACCOUNT_ID=<personal account ID> npx wrangler d1 execute devlab-pickleball-preview --remote --env preview --json \
  --command "SELECT type, name FROM sqlite_master WHERE type IN ('table','trigger') AND name NOT LIKE 'sqlite_%' ORDER BY type, name; SELECT COUNT(*) AS sessions FROM open_sessions; SELECT COUNT(*) AS hosts FROM hosts"
```

Expected: `0020_drop_legacy_pickleball.sql ✅`; tables exactly `d1_migrations`, any `_cf_*`, `host_logins`, `hosts`, `open_captains`, `open_courts`, `open_dupr_exports`, `open_host_keys`, `open_idempotency`, `open_matches`, `open_players`, `open_sessions`, `open_tournament_entrants`, `open_tournament_fixtures`, `open_tournaments`; no trigger; `sessions` and `hosts` equal to Step 2's counts (minus any session the daily purge removed in between, which `expires_at` would show). If the apply fails partway, stop: D1 rolls the migration file back as one unit; report the error with the backup path.

- [ ] **Step 6: Preview — the redirect rows in the preview CMS database**

```bash
CLOUDFLARE_API_TOKEN=<pasted> CLOUDFLARE_ACCOUNT_ID=<personal account ID> npx wrangler d1 execute devlab-studios-cms-preview --remote --env preview --json \
  --command "SELECT id, from_path, to_path, status_code FROM redirects WHERE from_path LIKE '/pickleball%' ORDER BY from_path"
```

Also read by the fixed ids, since a row can hold one of them under a different path: `SELECT id, from_path, to_path FROM redirects WHERE id IN ('redirect-pickleball-app', 'redirect-pickleball-app-all', 'redirect-pickleball-methodology', 'redirect-pickleball-live-all')`. A fixed id on a different `from_path` also means stop. Note that `npm run cms:mirror-preview` copies production's redirects over preview's: run this step after any mirror.

Expected for both reads: no rows, or only rows identical to the four planned ones. If a row has one of the four `from_path`s with a different `to_path`, stop and ask the owner (the guarded insert would leave it as is). Then:

```bash
CLOUDFLARE_API_TOKEN=<pasted> CLOUDFLARE_ACCOUNT_ID=<personal account ID> npx wrangler d1 execute devlab-studios-cms-preview --remote --env preview --file "$B/pickleball-redirects.sql"
```

Re-run the read: expected the four rows. Then check them live:

```bash
P=https://devlab-studios-preview.stpnrey-agustinez.workers.dev
for path in /pickleball/app /pickleball/app/sessions/123 /pickleball/methodology /pickleball/live/ABCDE23456 /pickleball/live/ABCDE23456/display; do
  curl -s -o /dev/null -w "%{http_code} %{redirect_url}  $path\n" "$P$path"; done
```

Expected: `301 …/pickleball/new` (twice), `301 …/pickleball/rotation`, `301 …/pickleball` (twice).

- [ ] **Step 7: Preview — the retired secret**

```bash
CLOUDFLARE_API_TOKEN=<pasted> CLOUDFLARE_ACCOUNT_ID=<personal account ID> npx wrangler secret list --env preview
```

If `PICKLEBALL_SESSION_SECRET` is listed:

```bash
CLOUDFLARE_API_TOKEN=<pasted> CLOUDFLARE_ACCOUNT_ID=<personal account ID> npx wrangler secret delete PICKLEBALL_SESSION_SECRET --env preview
```

(In a non-interactive shell wrangler takes its default "yes" for the confirmation and says so.) List again: it is gone; `GOOGLE_OAUTH_CLIENT_SECRET`, `RESEND_API_KEY` and `TURNSTILE_SECRET_KEY` are still there. `PICKLEBALL_TEST_AUTH_ENABLED` must not be listed.

- [ ] **Step 8: Preview — verify and report; stop**

Repeat Task 7 Step 4 on preview (pages, a session, a game, the board, host sign-in). Report to the user: the counts and bookmark from Steps 2–3, the backup path, the table list after the drop, the redirect checks, and the secret change. **Stop here.** Production waits for the owner's 2.0.0 release.

- [ ] **Step 9: Production — only inside the owner's 2.0.0 release**

Run this only after the owner has bumped to 2.0.0, pushed `main`, and Workers Builds has deployed it (production then runs this code and DO migration `v4` has run). Confirm first:

```bash
W=https://www.devlabstudios.com
for path in /api/pickleball/auth/session /pickleball/new; do printf '%s %s\n' "$(curl -s -o /dev/null -w '%{http_code}' "$W$path")" "$path"; done
CLOUDFLARE_API_TOKEN=<pasted> CLOUDFLARE_ACCOUNT_ID=<personal account ID> npx wrangler d1 migrations list devlab-pickleball --remote
```

Expected: `404 /api/pickleball/auth/session` and `200 /pickleball/new`. Production has the 27 legacy tables and no `open_*` or `hosts` tables, so `migrations list` shows `0016`-`0020` all pending: that is expected, and the single `migrations apply` below runs all five together as part of the 2.0.0 release. Stop if the pending list is anything other than exactly 0016-0020. CI never applies D1 migrations: apply right after Workers Builds finishes deploying `main` (the free routes return 500 until then) and check `/pickleball/new`; applying just before the deploy also works (the old 1.13.0 app loses its tables and has no users), but right after is the recommendation.

Then, against `devlab-pickleball` with no `--env` flag (personal account, `CLOUDFLARE_ACCOUNT_ID=<account ID>` inline per command):

1. Read the legacy counts with a legacy-only query (Step 2's `legacy-counts.sql` minus its `open_sessions` and `hosts` lines, which do not exist before 0016), database `devlab-pickleball`, no `--env`, plus the table and trigger list. Expected: the 27 legacy tables and the trigger `trg_session_pairs_one_active_pair_per_player`, no `zz_*` objects, `users` 3, `organizations` 1, `audit_events` 6, every other legacy count 0. Stop on anything else; the owner authorized dropping test data only.
2. `npx wrangler d1 time-travel info devlab-pickleball` (record the bookmark), then `npx wrangler d1 export devlab-pickleball --remote --output "$B/devlab-pickleball-before-0016-0020.sql"` with `$B` a directory outside the repo (check the file as in Step 3). Then `npx wrangler d1 migrations list devlab-pickleball --remote` must show exactly 0016-0020 pending; stop on anything else.
3. `npx wrangler d1 migrations apply devlab-pickleball --remote` (runs 0016-0020 in one go), then read back: the 13 kept tables exist with 0 rows, no legacy tables, no trigger. Check `/pickleball/new` and create a test session.
4. Redirect rows in the production CMS database `devlab-studios-cms`. Both live in the personal account: run `npx wrangler d1 info devlab-studios-cms` with `CLOUDFLARE_ACCOUNT_ID=<account ID>` (personal account) first; it must report id `6ff5e313-51a4-43d5-a649-678eeff1ff25` (the top-level `DB` binding in `wrangler.jsonc`). If it does not, ask the user which account holds it; do not guess. Then Step 6's read (by path and by the fixed ids), the guarded insert file and the read-back, without `--env preview`, and the curl checks against `https://www.devlabstudios.com`.
5. `npx wrangler secret list` (no `--env`) and, if listed, `npx wrangler secret delete PICKLEBALL_SESSION_SECRET`.

Report the same items as Step 8. Keep `$B` (the backups) until the owner says otherwise; Time Travel covers 30 days, the exports cover longer.

- [ ] **Step 10: Housekeeping**

Stop any local server you started. Delete nothing from `$B`.

---

## Self-review notes (for the executor)

**Spec coverage, Phase 5 (§12, §14 row 5):**

| Requirement | Task(s) |
|---|---|
| Read row counts on production, confirm test/demo data only; `wrangler d1 export` backup outside the repo (§12.1) | T8 Steps 2–3, 9 |
| `00NN_drop_legacy_pickleball.sql` drops the trigger and the 27 tables children before parents; `open_*` and `hosts` untouched (§12.2) | T5 (`dropLegacy.test.ts` pins the set, the order against real foreign keys, rows surviving, idempotence) |
| `deleted_classes: ["SessionCoordinatorDO"]` in both environments (§12.3) | T3 (tag `v4` top level and `env.preview`, dry-runs), T7 (preview deploy), owner's 2.0.0 deploy |
| Read back the table list after applying (§12.4) | T5 Step 5 (local D1), T8 Steps 5, 9 |
| Delete `_bootstrap-org-tmp.sql`, `create-organization.mjs`, `seed/*`, the e2e fixtures; old plans and specs kept and marked superseded (§12.5) | T4, T6 Step 6 |
| Keep the Google vars, remove invite/org-only vars (§12.6) | T4 (`env.d.ts`, `.env.example`), T8 Step 7 and 9.5 (Worker secrets) |
| Delete the SPA, `/pickleball/app/*`, accept-invite, live, every `/api/pickleball/` route except `open/**` and host auth, auth/session/permissions/quota, invites, platform, audit, scoring, OPI, `SessionCoordinatorDO`, old repositories and e2e specs | T2, T3, T4 (`retirement.test.ts` allowlists each folder) |
| Keep `oauth.js`, `RateLimiterDO`, the reused pure modules; `PublicLinkQRCode` only if still used | T4 test ("only oauth.js remains", "five reused tournament modules"); `PublicLinkQRCode` unused → deleted with the SPA (T2) |
| Phase 4's callback old-app branch removed | T2 Step 4 (whole file replaced; guard test pins its imports; e2e pins a stale cookie's outcome) |
| Redirect rows in the D1 `redirects` table, not hardcoded | T1 (wildcard support), T8 Steps 6, 9.4 (rows), T2 e2e (301 or 404 only) |
| Remove copy mentioning sign-in, operators or OPI | Pages already clean (checked); T2 removes the methodology SEO record and the stale spec checks; T6 rewrites the docs |
| Docs: architecture, schema, realtime, runbook rewritten | T6 Steps 1–4 |
| MAJOR (2.0.0), no bump here | Global Constraints; T2's `### Removed` first line; no task touches `package.json`'s `version` |

**Deferred by design:** the version bump, `[Unreleased]` retitle and tag (owner's release); the production half of Task 8 (inside that release); any CMS SEO row for `pickleball-methodology` (inert, left alone); a redirect for `/pickleball/accept-invite/*` (none in the spec).

**Names that cross tasks:** `redirectCandidates`, `findRedirect` (T1); `retirement.test.ts` with `ROOT`, `read`, `filesUnder` (T2) and `topLevel` (T4); wrangler tag `v4` (T3); `0020_drop_legacy_pickleball.sql`, `KEPT` table list (T5); runbook sections "Retire the legacy tables (migration 0020)" and "Redirects for the retired app's links" (T6, used by T8); `$B/legacy-counts.sql`, `$B/pickleball-redirects.sql` (T8).

**Verified while writing this plan:** in a scratch worktree of `770fca2` with Phase 4 Task 5's files and the committed middleware body-draining change copied in (Phase 4 Tasks 6–8, since committed as `cf586db`…`bb39596`, add nothing the deletions touch; the import closure was re-checked against `bb39596`), every change in Tasks 1–5 was applied and checked as a whole: an import-closure script from every kept file confirmed that nothing kept imports a deleted file (the only kept old files are the ones listed in Task 4); `astro check` 0 errors; `eslint .` 0 errors (1 pre-existing warning); `npm run test:unit` all pass except the known `handlers.test.js` (1682 passed); `npm run build` passes for production and with `CLOUDFLARE_ENV=preview`, and `wrangler deploy --dry-run` lists only `OPEN_SESSION` and `RATE_LIMITER` with tag `v4` in both; `redirects.test.js` fails (5 of 8) before Task 1's change and passes after; `dropLegacy.test.ts` passes and fails as described when `users` is moved first; `0020` applied through `wrangler d1 migrations apply --local` to a D1 holding old rows and a free session left exactly the 13 kept tables and the session; and against `wrangler dev` with `0020` applied, `open-play.spec.js`, `open-tournament.spec.js` and `pickleball-public-pages.spec.js` passed 149 of 149, with the four redirect rows present (301s) and absent (404s), plus the stale-callback test. The docs text in Task 6 was not built (Markdown), and Task 8 was not run (remote data).

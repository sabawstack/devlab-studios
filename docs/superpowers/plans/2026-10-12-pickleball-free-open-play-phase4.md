# Free Open Play — Phase 4 (Google host sign-in and the DUPR export) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the host of a free session, and only the host, sign in with Google to link the session to their account once, enter their DUPR Club ID once, fix missing DUPR IDs, and get a DUPR club match-import CSV emailed to their verified Google address (5 per session per day), with every left-out game and why; plus My sessions (reopen a linked session as host from any device) and Delete my account.

**Architecture:** Everything lives under `/api/pickleball/open/**`, which the old operator middleware already skips and Phase 5 keeps. Migration `0019` adds `hosts`, `host_logins` (hashed login tokens), `open_sessions.host_id` (the claim), `open_host_keys` (extra host links for reopening) and `open_dupr_exports` (the 5-a-day log). The Durable Object loads a session's host access alongside the session and is the only writer of claims, extra host keys and the export log, so they are serialized per session; nothing about a claim or an export ever enters a snapshot. The CSV and the email are pure modules pinned to `tests/fixtures/dupr-import-template.csv`; the worker only delivers them through the existing Resend provider. Google sign-in reuses `oauth.js` and the already-registered callback path, which now hands host sign-ins to `finishHostSignIn`.

**Tech Stack:**
- Astro 7 (server output) on Cloudflare Workers
- D1, Durable Objects (RPC methods on `OpenSessionDO`)
- React 19 islands, Tailwind
- Zod 4
- Vitest 4, including `node:sqlite` for repository tests
- Playwright (`worker` project for `tests/e2e/pickleball/**`)
- Resend (existing `createResendProvider`), Google OAuth 2.0 with PKCE (existing `oauth.js`)

**Spec:** `docs/superpowers/specs/2026-10-11-pickleball-free-open-play-design.md`. Phase 4 is the fourth row of §14 ("Google host sign-in, claim, DUPR Club ID, DUPR CSV email; account deletion; optional offline PWA"). Read §1 (decisions table), §3.2 (the `hosts` table and "deletable on request"), §3.3, §9 in full, §10, §12 (what Phase 5 deletes and keeps) and §13 before starting. The Phase 3 plan (`docs/superpowers/plans/2026-10-12-pickleball-free-open-play-phase3.md`) shows what exists. **The current code is the source of truth where it differs from either.** This plan was written against commit `78f1432` ("fix(pickleball): phase 3 final review fixes"). Every file below was built in a scratch worktree of that commit and verified there (see "Verified while writing this plan" at the end), and every "Find" block was checked by script to be unique in its file and to turn the file at `78f1432` into the tested file when the tasks run in order. If `HEAD` has moved, reconcile any block that no longer matches with the current code rather than forcing it.

## Global Constraints

- **No login to run or view a session** (spec §1): "Google sign-in **only** when the session host wants a DUPR export." No new screen, route or prompt may require an account for anything else.
- **Only the session host exports, by email** (§1, §9.6): "The export is **emailed** to the host's verified Google address." A Google profile whose `email_verified` is not true is never stored.
- **The Google callback path is fixed.** Every host sign-in uses `${PICKLEBALL_OAUTH_REDIRECT_BASE_URL}/api/pickleball/auth/google/callback`, the URI already registered with Google (production `https://www.devlabstudios.com`, preview `https://devlab-studios-preview.stpnrey-agustinez.workers.dev`). Never register or use another.
- **Survive Phase 5** (§12): new code may import `src/worker/pickleball/oauth.js` but nothing Phase 5 deletes: `session.js`, `authContext.js`, `permissions.ts`, `quota.ts`, `inviteEmail.js`, `SessionCoordinatorDO`, the `users`/`memberships`/`organizationInvites` repositories, `src/pickleball-app/`. `phase5Safety.test.ts` (Task 5) enforces it.
- **Cookie `devlab_pb_host`** (§9.1): HttpOnly, Secure (on https), SameSite=Lax, and every state-changing route that trusts it refuses a cross-site request (`sameOrigin.ts`).
- **Marketing opt-in is unticked by default** (§9.1) and only the host ever ticks it.
- **CSV layout** (§9.4), pinned to `tests/fixtures/dupr-import-template.csv`: `matchType` = `D`; `event` = session name; `date` = `YYYY-MM-DD` in the session's local date; `scoreType` = `SIDEOUT`, or `RALLY` if the host chose rally scoring; `location` = the session's venue text; one row per game with only game 1 filled; `*ExternalId` = our session player id; no instruction rows.
- **Eligibility** (§9.4): "A game is exported only if it is a finished doubles match with a score that passes those rules [no ties; a team reached 6] and all four players have a DUPR ID. DUPR IDs are validated as 6 alphanumeric characters, uppercased." The email lists each skipped game and the reason, says the host's DUPR account must be a Club Director or Organizer, and gives the click path (Matches → Add Matches → Import Matches via CSV).
- **Limits** (§9.6, §10): "Exports are limited to 5 per session per day." Host routes keep the existing per-IP limit (600 per minute, `hostIpLimited`); host-account routes get 120 per minute per IP; sign-in 20 per 10 minutes per IP.
- **Claim** (§9.2): "A session can be claimed once, only by someone holding the host key. After that the export is restricted to that account; a viewer or captain never sees the button."
- **Retention** (§3.2, §8): `hosts` "is **not** subject to the 7-day session expiry. It is deletable on request ('Delete my account' on the export screen)." A claimed session still expires 7 days after its last activity like any session.
- **No DUPR or Reclub API calls, no scraping** (§9).
- **Snapshots stay allowlists** (§7): no claim, host id, Club ID, email or export data in the viewer, host or captain snapshot. The DUPR panel has its own host-key-only route.
- **Test login** (§13): `POST /api/pickleball/open/host/test-login` answers only when `PICKLEBALL_TEST_AUTH_ENABLED === 'true'` (`.dev.vars`; never in `wrangler.jsonc`). The same flag suppresses the email and returns it in the response for e2e.
- **D1 schema rules** (`docs/pickleball/architecture.md`, "Schema constraint"): CHECKs cannot be widened later; `ALTER TABLE … ADD COLUMN` is safe; never rebuild a table. Session-owned rows cascade from `open_sessions`.
- **`OpenSessionDO.ts` stays under 600 lines** (§3.5); it ends this phase at about 546.
- **Lint:** `eslint-plugin-react-hooks` 7 and `react-refresh/only-export-components` are on: never call `setState` synchronously in an effect body, and keep shared helpers in `.js` files, not component files.
- **Per commit:** one line under `### Added` in `CHANGELOG.md`'s `## [Unreleased]` (the first `### Added` heading in the file) in the same commit (`AGENTS.md`). Commit subjects are lowercase after the type. Phase 4 is a **MINOR** release, but this plan bumps no version.
- **Before any push:** `npm run typecheck && npm run build && npm run test:unit && npm run lint`, then the full Playwright suite (`npx playwright test`). Two failures are known and unrelated at `78f1432`: `src/lead-engine/jobs/handlers.test.js` ("has a handler for every job type the schema allows") fails on a clean checkout, and the public-pages "services page links to the pickleball product" test needs CMS content a fresh local D1 does not have.
- **Running e2e locally:** Playwright reuses a server already on port 8787 or 4173. Stop any `wrangler dev` or `npm run preview` you or an earlier run left (`tasklist //FI "IMAGENAME eq node.exe"`) so the suite starts its own on the new build; its start command applies `0019` to the local D1 itself.

## Review Focus

1. **Two players in one game have the same DUPR ID** (a pasted roster, a typo). DUPR would refuse the file; the game must be left out with "Ana and Ben have the same DUPR ID.", and the host cannot type an ID another player already has. Pinned in Task 2 (`export.test.ts`: "refuses two players with the same DUPR ID…") and Task 3 (`reducer.dupr.test.ts`: "refuses an ID another player already has…").
2. **An evening game and a host whose phone is not on UTC.** A game finished at 23:30 UTC in Manila is dated the next day; an unknown zone falls back to UTC rather than failing. Pinned in Task 2 ("dates each game in the host's time zone").
3. **A host deletes their account while the session's Durable Object is warm, then signs in again.** The session must read as unlinked at once (not after the object is evicted), keep running, and be linkable again. Pinned in Task 8 (e2e "deleting the account unlinks its sessions…").
4. **Another site posts to claim, export, sign-out or delete with the host's cookie.** Every such request is refused with 403, as is one that does not say where it came from. Pinned in Task 4 (`hostSession.test.ts`, "same-origin guard") and Task 8 (e2e "host routes refuse a request from another site…").
5. **A host on a phone taps Sign in with Google and comes back.** They land on the same console with the DUPR sheet open where they left it, or with a plain reason when Google refused (cancelled, unverified email, too many tries); the `?signin=` value never stays in the address bar. Pinned in Task 5 (`hostAuth.test.ts`) and Task 9 (e2e "signed out, the sheet offers Google…").

---

## Decisions recorded for this phase (not to be reopened)

From the owner and the spec: Google sign-in only for the DUPR export; the export is emailed to the verified Google address with the CSV attached; claim once by the host-key holder; DUPR Club ID entered once and saved on `hosts`; 5 exports per session per day; My sessions as the lost-link recovery path; Delete my account; the registered callback path cannot change; the old operator app is retired in Phase 5 and nobody uses it.

Resolved by this plan where the spec was silent or ambiguous:
1. **One callback, two flows.** `/api/pickleball/auth/google/callback` stays the only redirect URI. It hands the request to `finishHostSignIn` whenever the host flow's in-flight cookie is present, or when neither flow's cookie is; the old operator code runs only when its own cookie alone is present, and Phase 5 deletes it.
2. **The cookie holds an opaque token, not a signed host id.** A 32-byte random token whose SHA-256 is stored in `host_logins` (like the host key). Signing out really ends that login, deleting an account ends every login at once (cascade), a database leak yields no usable cookie, and no signing secret is needed (`PICKLEBALL_SESSION_SECRET` belongs to the retired app). Cost: one indexed D1 read per host-account request. `Path=/api/pickleball/open`, 30 days.
3. **CSRF**: SameSite=Lax plus an `Origin` check (or `Sec-Fetch-Site: same-origin` when Origin is absent) on every write that trusts the cookie: claim, export, `PATCH`/`DELETE` me, sign-out, reopen, test login.
4. **Claiming is an explicit step** ("Link to my account") that needs the host key and the cookie, never overwrites a claim, and is written only by its own statement (`claimSession`); `persistDiff` never touches `host_id`, so a warm Durable Object cannot write a stale claim back.
5. **Reopen mints an extra host link** (`open_host_keys`, at most 10 per session) instead of rotating the original, so the phone that still has the first link keeps working. A device that already has the key saved just opens it.
6. **The marketing checkbox sits beside "Sign in with Google"**, unticked, travels in the OAuth in-flight cookie and is applied only when the `hosts` row is created; it is changeable later in the account panel.
7. **The DUPR Club ID is not a CSV column** (the pinned template has none). It is required before sending, shown in the email's upload instructions, and validated loosely (3–20 letters, digits or dashes) because DUPR publishes no format.
8. **"The session's local date"**: sessions store no time zone, so the host's device sends its IANA zone with the request (`?tz=` and the export body); an invalid zone means UTC.
9. **"5 per session per day"** is a rolling 24 hours per session, whoever sends. An export is reserved before the email is sent and released if sending fails.
10. **Host edits of DUPR IDs did not exist** (no command, no UI). `SET_PLAYER_DUPR_ID` adds them: host only, allowed after the session ends, refuses an ID another player has. The DUPR sheet lists exactly the players whose missing ID blocks a game.
11. **Only finished games are judged.** Abandoned or unplayed games are not "skipped games". Numbering follows the results CSV (finished games in play order). Four distinct valid IDs are required.
12. **Nothing to send is refused** (409) rather than emailing an empty file; the sheet shows the count and every reason before the host sends.
13. **Claiming and exporting do not touch the session** (no version bump, no new 7-day window, no broadcast): nothing on the board changes, and the spec says claimed sessions expire like any other.
14. **Deleting an account** removes the host and every login, unlinks (keeps) its sessions, tells their Durable Objects to forget the link, and leaves the export log alone (it holds no host or recipient).
15. **Sign-in outcomes come back as `?signin=ok|cancelled|unverified|failed|busy|unavailable`** on the page the host started from, which must be `/pickleball/s/{code}` or `/pickleball/my-sessions` (anything else falls back to My sessions; no open redirect).
16. **The optional offline PWA (§14) is deferred.** The privacy policy page is CMS content and is not edited here; the account panel says what is kept until deletion (flagged for the owner in Task 11).

## File map

| File | Responsibility | Task |
|---|---|---|
| `migrations/pickleball/0019_hosts.sql` | `hosts`, `host_logins`, `open_sessions.host_id`, `open_host_keys`, `open_dupr_exports` | 1 |
| `src/worker/repositories/pickleball/open/{hosts,hostAccess}.ts` | host and login SQL; claim, extra keys, export log SQL | 1 |
| `tests/fixtures/dupr-import-template.csv`, `src/lib/pickleball/open/dupr/{export,email}.ts` | pinned template, CSV builder and eligibility, email text | 2 |
| `src/lib/schemas/pickleball/open/commands.ts`, `src/lib/pickleball/open/reducer.ts` | `SET_PLAYER_DUPR_ID` | 3 |
| `src/worker/pickleball/open/{hostCookies,sameOrigin,hostSession}.ts`, `src/lib/schemas/pickleball/open/host.ts`, routes `open/host/{test-login,me,sign-out}.ts` | cookie, CSRF guard, login, profile | 4 |
| `src/worker/pickleball/open/hostAuth.ts`, `open/host/sign-in.ts`, `auth/google/callback.ts` | Google sign-in on the registered callback | 5 |
| `src/lib/pickleball/open/dupr/policy.ts`, `OpenSessionDO.ts`, routes `open/s/[code]/{claim,dupr}.ts`, `open/host/sessions.ts`, `open/host/sessions/[code]/reopen.ts` | claim, DUPR status, My sessions API, reopen | 6 |
| `src/worker/delivery/providers.js`, `src/worker/pickleball/open/duprExport.ts`, `OpenSessionDO.ts`, `open/s/[code]/dupr-export.ts` | sending the export | 7 |
| `open/host/me.ts` (DELETE), `OpenSessionDO.ts`, `purge.ts`, `src/worker.ts` | account deletion, login purge | 8 |
| `src/pickleball-open/lib/api.js`, `src/pickleball-open/host/{duprSteps.js,ClubIdForm,HostAccount,DuprSheet}.jsx`, `HostConsole.jsx` | the console's DUPR sheet | 9 |
| `src/pickleball-open/host/MySessionsApp.jsx`, `src/pages/pickleball/my-sessions.astro`, `how-it-works.astro`, `index.astro`, public-pages spec | My sessions page, guide and FAQ | 10 |
| `tests/e2e/pickleball/open-host.spec.js` | e2e, one `describe` block per task | 6–10 |
| `docs/pickleball/{architecture,runbook}.md` | docs | 11 |

---

### Task 1: Migration 0019 and the host repositories

**Files:**
- Create: `migrations/pickleball/0019_hosts.sql`
- Create: `src/worker/repositories/pickleball/open/hosts.ts`
- Create: `src/worker/repositories/pickleball/open/hostAccess.ts`
- Test: `src/worker/repositories/pickleball/open/hosts.test.ts`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: `createSqliteD1` (`./testing/sqliteD1`), `createOpenSession`, `purgeExpiredOpenSessions` (`./openSessions`), `buildInitialState`, `DEFAULT_SETTINGS`.
- Produces:
  - `hosts.ts`: `HostRecord { id; googleSub; email; displayName; duprClubId: string | null; marketingOptIn: boolean; createdAt; lastSeenAt }`, `HostProfile { email; displayName; duprClubId; marketingOptIn }`, `HostSessionSummary { code; name; kind; status; lastActivityAt; expiresAt }`, `LOGIN_TTL_MS` (30 days), `MAX_LISTED_SESSIONS` (50), `toHostProfile(host)`, `upsertHost(db, { googleSub, email, displayName, marketingOptIn }, { now, newId }): Promise<HostRecord>`, `createHostLogin(db, { tokenHash, hostId, now })`, `findHostByLogin(db, tokenHash, now): Promise<HostRecord | null>`, `deleteHostLogin(db, tokenHash)`, `updateHostProfile(db, hostId, { duprClubId?, marketingOptIn? }): Promise<HostRecord | null>`, `deleteHost(db, hostId): Promise<string[]>` (public codes it unlinked), `listHostSessions(db, hostId, now)`, `purgeExpiredHostLogins(db, now): Promise<number>`.
  - `hostAccess.ts`: `HostAccess { hostId: string | null; extraKeyHashes: string[] }`, `MAX_EXTRA_HOST_KEYS` (10), `loadHostAccess(db, sessionId)`, `claimSession(db, sessionId, hostId): Promise<boolean>`, `insertHostKey(db, { id, sessionId, keyHash, createdAt })`, `recentDuprExports(db, sessionId, sinceIso): Promise<string[]>`, `insertDuprExport(db, { id, sessionId, sentAt, gameCount, skippedCount })`, `deleteDuprExport(db, sessionId, id)`.

- [ ] **Step 1: Write the failing test**

`src/worker/repositories/pickleball/open/hosts.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createSqliteD1 } from './testing/sqliteD1'
import { createOpenSession, purgeExpiredOpenSessions } from './openSessions'
import {
  createHostLogin, deleteHost, deleteHostLogin, findHostByLogin, listHostSessions, LOGIN_TTL_MS, purgeExpiredHostLogins,
  toHostProfile, updateHostProfile, upsertHost,
} from './hosts'
import { claimSession, deleteDuprExport, insertDuprExport, insertHostKey, loadHostAccess, recentDuprExports } from './hostAccess'
import { buildInitialState } from '../../../../lib/pickleball/open/create'
import { DEFAULT_SETTINGS } from '../../../../lib/pickleball/open/types'

const MIGRATIONS = [
  'migrations/pickleball/0016_open_sessions.sql',
  'migrations/pickleball/0017_open_captains.sql',
  'migrations/pickleball/0018_open_tournaments.sql',
  'migrations/pickleball/0019_hosts.sql',
]
const NOW = '2026-10-12T10:00:00.000Z'
const LATER = '2026-10-12T11:00:00.000Z'

function setup() {
  const { d1, raw } = createSqliteD1(MIGRATIONS)
  let n = 0
  return { d1, raw, newId: () => `id-${(n += 1)}` }
}

async function session(d1: D1Database, code: string, now = NOW) {
  let n = 0
  const state = buildInitialState(
    { name: `Session ${code}`, hostDisplayName: 'Mo', location: null, courtCount: 1, settings: DEFAULT_SETTINGS, players: [] },
    { now, newId: () => `${code}-${(n += 1)}`, publicCode: code, sessionId: `sess-${code}` },
  )
  await createOpenSession(d1, state, 'hash')
  return state
}

const count = (raw: ReturnType<typeof createSqliteD1>['raw'], sql: string) => (raw.prepare(sql).get() as { n: number }).n
const ANA = { googleSub: 'g-ana', email: 'ana@example.com', displayName: 'Ana', marketingOptIn: false }

describe('hosts', () => {
  it('creates a host on first sign-in and refreshes only email, name and last seen after that', async () => {
    const { d1, newId } = setup()
    const first = await upsertHost(d1, { ...ANA, marketingOptIn: true }, { now: NOW, newId })
    expect(first).toMatchObject({ googleSub: 'g-ana', email: 'ana@example.com', marketingOptIn: true, duprClubId: null, createdAt: NOW, lastSeenAt: NOW })
    const again = await upsertHost(d1, { ...ANA, email: 'ana@new.example', displayName: 'Ana P', marketingOptIn: false }, { now: LATER, newId })
    expect(again.id).toBe(first.id)
    expect(again).toMatchObject({ email: 'ana@new.example', displayName: 'Ana P', marketingOptIn: true, createdAt: NOW, lastSeenAt: LATER })
  })

  it('marketing opt-in is off unless the host ticked it', async () => {
    const { raw } = setup()
    raw.exec(`INSERT INTO hosts (id, google_sub, email, display_name, created_at, last_seen_at) VALUES ('h1', 's', 'e', 'n', '${NOW}', '${NOW}')`)
    expect(count(raw, "SELECT marketing_opt_in AS n FROM hosts WHERE id = 'h1'")).toBe(0)
    expect(() => raw.exec("UPDATE hosts SET marketing_opt_in = 2 WHERE id = 'h1'")).toThrow(/CHECK/)
  })

  it('a login finds its host until it expires, and signing out removes it', async () => {
    const { d1, newId } = setup()
    const host = await upsertHost(d1, ANA, { now: NOW, newId })
    await createHostLogin(d1, { tokenHash: 't1', hostId: host.id, now: NOW })
    expect((await findHostByLogin(d1, 't1', LATER))?.id).toBe(host.id)
    expect(await findHostByLogin(d1, 'nope', LATER)).toBeNull()
    const expiry = new Date(Date.parse(NOW) + LOGIN_TTL_MS).toISOString()
    expect(await findHostByLogin(d1, 't1', expiry)).toBeNull()
    await deleteHostLogin(d1, 't1')
    expect(await findHostByLogin(d1, 't1', LATER)).toBeNull()
  })

  it('updates only the fields given and returns the profile without the Google subject', async () => {
    const { d1, newId } = setup()
    const host = await upsertHost(d1, ANA, { now: NOW, newId })
    const withClub = await updateHostProfile(d1, host.id, { duprClubId: '12345' })
    expect(withClub).toMatchObject({ duprClubId: '12345', marketingOptIn: false })
    const optedIn = await updateHostProfile(d1, host.id, { marketingOptIn: true })
    expect(optedIn).toMatchObject({ duprClubId: '12345', marketingOptIn: true })
    expect(toHostProfile(optedIn!)).toEqual({ email: 'ana@example.com', displayName: 'Ana', duprClubId: '12345', marketingOptIn: true })
    expect(await updateHostProfile(d1, 'missing', { duprClubId: null })).toBeNull()
  })

  it('deleting an account unlinks its sessions, keeps them, and signs it out everywhere', async () => {
    const { d1, raw, newId } = setup()
    const host = await upsertHost(d1, ANA, { now: NOW, newId })
    await createHostLogin(d1, { tokenHash: 't1', hostId: host.id, now: NOW })
    await createHostLogin(d1, { tokenHash: 't2', hostId: host.id, now: NOW })
    const a = await session(d1, 'AAAAA22222')
    await session(d1, 'BBBBB33333')
    expect(await claimSession(d1, a.id, host.id)).toBe(true)
    expect(await deleteHost(d1, host.id)).toEqual(['AAAAA22222'])
    expect(count(raw, 'SELECT COUNT(*) AS n FROM hosts')).toBe(0)
    expect(count(raw, 'SELECT COUNT(*) AS n FROM host_logins')).toBe(0)
    expect(count(raw, 'SELECT COUNT(*) AS n FROM open_sessions')).toBe(2)
    expect(count(raw, 'SELECT COUNT(*) AS n FROM open_sessions WHERE host_id IS NOT NULL')).toBe(0)
  })

  it('a deleted host row also unlinks sessions through the foreign key', async () => {
    const { d1, raw, newId } = setup()
    const host = await upsertHost(d1, ANA, { now: NOW, newId })
    const a = await session(d1, 'AAAAA22222')
    await claimSession(d1, a.id, host.id)
    raw.exec(`DELETE FROM hosts WHERE id = '${host.id}'`)
    expect(count(raw, 'SELECT COUNT(*) AS n FROM open_sessions WHERE host_id IS NULL')).toBe(1)
  })

  it('lists only the host’s live sessions, most recently active first', async () => {
    const { d1, raw, newId } = setup()
    const host = await upsertHost(d1, ANA, { now: NOW, newId })
    const other = await upsertHost(d1, { ...ANA, googleSub: 'g-bo', email: 'bo@example.com' }, { now: NOW, newId })
    const older = await session(d1, 'AAAAA22222', '2026-10-10T09:00:00.000Z')
    const newer = await session(d1, 'BBBBB33333', '2026-10-11T09:00:00.000Z')
    const expired = await session(d1, 'CCCCC44444', '2026-09-01T09:00:00.000Z')
    const theirs = await session(d1, 'DDDDD55555')
    for (const s of [older, newer, expired]) await claimSession(d1, s.id, host.id)
    await claimSession(d1, theirs.id, other.id)
    const listed = await listHostSessions(d1, host.id, NOW)
    expect(listed.map((s) => s.code)).toEqual(['BBBBB33333', 'AAAAA22222'])
    expect(listed[0]).toMatchObject({ name: 'Session BBBBB33333', kind: 'OPEN_PLAY', status: 'ACTIVE' })
    expect(count(raw, 'SELECT COUNT(*) AS n FROM open_sessions')).toBe(4)
  })

  it('the cron removes expired logins only', async () => {
    const { d1, raw, newId } = setup()
    const host = await upsertHost(d1, ANA, { now: NOW, newId })
    await createHostLogin(d1, { tokenHash: 'old', hostId: host.id, now: '2026-08-01T00:00:00.000Z' })
    await createHostLogin(d1, { tokenHash: 'new', hostId: host.id, now: NOW })
    expect(await purgeExpiredHostLogins(d1, NOW)).toBe(1)
    expect(count(raw, 'SELECT COUNT(*) AS n FROM host_logins')).toBe(1)
  })
})

describe('host access', () => {
  it('a session is claimed once, and never by a host that no longer exists', async () => {
    const { d1, newId } = setup()
    const ana = await upsertHost(d1, ANA, { now: NOW, newId })
    const bo = await upsertHost(d1, { ...ANA, googleSub: 'g-bo' }, { now: NOW, newId })
    const s = await session(d1, 'AAAAA22222')
    expect(await claimSession(d1, s.id, 'ghost')).toBe(false)
    expect(await claimSession(d1, s.id, ana.id)).toBe(true)
    expect(await claimSession(d1, s.id, bo.id)).toBe(false)
    expect(await claimSession(d1, s.id, ana.id)).toBe(false)
    expect((await loadHostAccess(d1, s.id)).hostId).toBe(ana.id)
  })

  it('extra host keys load oldest first and cascade with the purge', async () => {
    const { d1, raw } = setup()
    const s = await session(d1, 'AAAAA22222', '2026-09-01T09:00:00.000Z')
    await insertHostKey(d1, { id: 'k2', sessionId: s.id, keyHash: 'h2', createdAt: '2026-09-01T10:00:00.000Z' })
    await insertHostKey(d1, { id: 'k1', sessionId: s.id, keyHash: 'h1', createdAt: '2026-09-01T09:30:00.000Z' })
    expect(await loadHostAccess(d1, s.id)).toEqual({ hostId: null, extraKeyHashes: ['h1', 'h2'] })
    await insertDuprExport(d1, { id: 'x1', sessionId: s.id, sentAt: '2026-09-01T10:00:00.000Z', gameCount: 3, skippedCount: 1 })
    expect(await purgeExpiredOpenSessions(d1, NOW)).toEqual(['AAAAA22222'])
    expect(count(raw, 'SELECT COUNT(*) AS n FROM open_host_keys')).toBe(0)
    expect(count(raw, 'SELECT COUNT(*) AS n FROM open_dupr_exports')).toBe(0)
  })

  it('the export log counts sends after a time, and a failed send can be given back', async () => {
    const { d1 } = setup()
    const s = await session(d1, 'AAAAA22222')
    await insertDuprExport(d1, { id: 'x1', sessionId: s.id, sentAt: '2026-10-11T09:00:00.000Z', gameCount: 3, skippedCount: 0 })
    await insertDuprExport(d1, { id: 'x2', sessionId: s.id, sentAt: '2026-10-12T09:00:00.000Z', gameCount: 3, skippedCount: 0 })
    await insertDuprExport(d1, { id: 'x3', sessionId: s.id, sentAt: '2026-10-12T09:30:00.000Z', gameCount: 3, skippedCount: 0 })
    expect(await recentDuprExports(d1, s.id, '2026-10-11T10:00:00.000Z')).toEqual(['2026-10-12T09:00:00.000Z', '2026-10-12T09:30:00.000Z'])
    await deleteDuprExport(d1, 'other-session', 'x3')
    expect(await recentDuprExports(d1, s.id, '2026-10-11T10:00:00.000Z')).toHaveLength(2)
    await deleteDuprExport(d1, s.id, 'x3')
    expect(await recentDuprExports(d1, s.id, '2026-10-11T10:00:00.000Z')).toEqual(['2026-10-12T09:00:00.000Z'])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/worker/repositories/pickleball/open/hosts.test.ts`
Expected: FAIL — `ENOENT … migrations/pickleball/0019_hosts.sql` (and the imports of `./hosts` and `./hostAccess` do not resolve).

- [ ] **Step 3: Write the migration**

`migrations/pickleball/0019_hosts.sql`:

```sql
-- migrations/pickleball/0019_hosts.sql
-- Free sessions, Phase 4: Google-verified hosts for the DUPR export
-- (spec 2026-10-11-pickleball-free-open-play-design.md §3.2, §9).
--
-- hosts is account data a host chose to create. It is NOT subject to the
-- 7-day session expiry; "Delete my account" removes it. marketing_opt_in
-- defaults to 0 (unticked) and is only ever set by the host.
--
-- host_logins: one row per signed-in browser. The devlab_pb_host cookie holds
-- a random token; only its SHA-256 is stored, like the session host key. A
-- login cascades away with its host, so deleting an account signs it out
-- everywhere at once. Expired rows are removed by the daily cron.
--
-- open_sessions.host_id: set once, by a claim made with the session's host key
-- (§9.2). ON DELETE SET NULL, so deleting an account unlinks its sessions but
-- leaves them running and expiring exactly like any other session. ADD COLUMN
-- with a REFERENCES clause is allowed on SQLite/D1 because its default is NULL;
-- only table rebuilds are dangerous on D1.
--
-- open_host_keys: extra host links minted for a signed-in host who reopens a
-- claimed session from another device (§9.5, the lost-link recovery path).
-- Only hashes are stored. They cascade from open_sessions, so the purge
-- removes them.
--
-- open_dupr_exports: one row per DUPR email sent, for the 5-per-session-per-day
-- limit (§9.6). No host or recipient column: the limit is per session, and
-- the log needs no personal data. Cascades from open_sessions.

CREATE TABLE hosts (
  id               TEXT PRIMARY KEY,
  google_sub       TEXT NOT NULL UNIQUE,
  email            TEXT NOT NULL,
  display_name     TEXT NOT NULL,
  dupr_club_id     TEXT,
  marketing_opt_in INTEGER NOT NULL DEFAULT 0 CHECK (marketing_opt_in IN (0, 1)),
  created_at       TEXT NOT NULL,
  last_seen_at     TEXT NOT NULL
);

CREATE TABLE host_logins (
  token_hash TEXT PRIMARY KEY,
  host_id    TEXT NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_host_logins_host ON host_logins(host_id);
CREATE INDEX idx_host_logins_expires_at ON host_logins(expires_at);

ALTER TABLE open_sessions ADD COLUMN host_id TEXT REFERENCES hosts(id) ON DELETE SET NULL;
CREATE INDEX idx_open_sessions_host ON open_sessions(host_id);

CREATE TABLE open_host_keys (
  id         TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES open_sessions(id) ON DELETE CASCADE,
  key_hash   TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_open_host_keys_session ON open_host_keys(session_id);

CREATE TABLE open_dupr_exports (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL REFERENCES open_sessions(id) ON DELETE CASCADE,
  sent_at       TEXT NOT NULL,
  game_count    INTEGER NOT NULL,
  skipped_count INTEGER NOT NULL
);
CREATE INDEX idx_open_dupr_exports_session ON open_dupr_exports(session_id, sent_at);
```

- [ ] **Step 4: Write the repositories**

`src/worker/repositories/pickleball/open/hosts.ts`:

```ts
// Google-verified hosts (spec §9) and their browser logins. Every SQL statement
// for the hosts and host_logins tables lives here (repository pattern). A host
// row is account data and never expires; a login expires after LOGIN_TTL_MS.

export interface HostRecord {
  id: string
  googleSub: string
  email: string
  displayName: string
  duprClubId: string | null
  marketingOptIn: boolean
  createdAt: string
  lastSeenAt: string
}

/** What the host's own screens may show about their account. Never the Google subject id. */
export interface HostProfile {
  email: string
  displayName: string
  duprClubId: string | null
  marketingOptIn: boolean
}

export interface HostSessionSummary {
  code: string
  name: string
  kind: 'OPEN_PLAY' | 'TOURNAMENT'
  status: 'ACTIVE' | 'ENDED'
  lastActivityAt: string
  expiresAt: string
}

interface HostRow {
  id: string; google_sub: string; email: string; display_name: string; dupr_club_id: string | null
  marketing_opt_in: number; created_at: string; last_seen_at: string
}

export const LOGIN_TTL_MS = 30 * 24 * 60 * 60 * 1000
export const MAX_LISTED_SESSIONS = 50

function toRecord(row: HostRow): HostRecord {
  return {
    id: row.id, googleSub: row.google_sub, email: row.email, displayName: row.display_name,
    duprClubId: row.dupr_club_id, marketingOptIn: row.marketing_opt_in === 1, createdAt: row.created_at, lastSeenAt: row.last_seen_at,
  }
}

export function toHostProfile(host: HostRecord): HostProfile {
  return { email: host.email, displayName: host.displayName, duprClubId: host.duprClubId, marketingOptIn: host.marketingOptIn }
}

/**
 * Creates the host on first sign-in, or refreshes their email, name and
 * last_seen_at. The marketing choice is taken only when the row is created:
 * signing in again never changes a choice the host already made.
 */
export async function upsertHost(
  db: D1Database,
  profile: { googleSub: string; email: string; displayName: string; marketingOptIn: boolean },
  ctx: { now: string; newId: () => string },
): Promise<HostRecord> {
  const row = await db.prepare(`INSERT INTO hosts (id, google_sub, email, display_name, dupr_club_id, marketing_opt_in, created_at, last_seen_at)
      VALUES (?, ?, ?, ?, NULL, ?, ?, ?)
      ON CONFLICT(google_sub) DO UPDATE SET email = excluded.email, display_name = excluded.display_name, last_seen_at = excluded.last_seen_at
      RETURNING *`)
    .bind(ctx.newId(), profile.googleSub, profile.email, profile.displayName, profile.marketingOptIn ? 1 : 0, ctx.now, ctx.now)
    .first<HostRow>()
  if (!row) throw new Error('Host upsert returned no row.')
  return toRecord(row)
}

export async function createHostLogin(db: D1Database, login: { tokenHash: string; hostId: string; now: string }): Promise<void> {
  const expiresAt = new Date(Date.parse(login.now) + LOGIN_TTL_MS).toISOString()
  await db.prepare('INSERT INTO host_logins (token_hash, host_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(login.tokenHash, login.hostId, login.now, expiresAt).run()
}

/** The host a live login belongs to, or null for an unknown, expired or deleted one. */
export async function findHostByLogin(db: D1Database, tokenHash: string, now: string): Promise<HostRecord | null> {
  const row = await db.prepare(`SELECT h.* FROM host_logins l JOIN hosts h ON h.id = l.host_id
      WHERE l.token_hash = ? AND l.expires_at > ?`).bind(tokenHash, now).first<HostRow>()
  return row ? toRecord(row) : null
}

export async function deleteHostLogin(db: D1Database, tokenHash: string): Promise<void> {
  await db.prepare('DELETE FROM host_logins WHERE token_hash = ?').bind(tokenHash).run()
}

/** Applies only the fields given. Returns the updated host, or null when it no longer exists. */
export async function updateHostProfile(
  db: D1Database, hostId: string, patch: { duprClubId?: string | null; marketingOptIn?: boolean },
): Promise<HostRecord | null> {
  const sets: string[] = []
  const values: Array<string | number | null> = []
  if (patch.duprClubId !== undefined) {
    sets.push('dupr_club_id = ?')
    values.push(patch.duprClubId)
  }
  if (patch.marketingOptIn !== undefined) {
    sets.push('marketing_opt_in = ?')
    values.push(patch.marketingOptIn ? 1 : 0)
  }
  if (sets.length) await db.prepare(`UPDATE hosts SET ${sets.join(', ')} WHERE id = ?`).bind(...values, hostId).run()
  const row = await db.prepare('SELECT * FROM hosts WHERE id = ?').bind(hostId).first<HostRow>()
  return row ? toRecord(row) : null
}

/**
 * Deletes the account (spec §3.2 "Delete my account"): its sessions are
 * unlinked, not deleted, and every login goes with it (cascade). Returns the
 * public codes of the sessions that were linked, so their coordinators can
 * drop the link from memory.
 */
export async function deleteHost(db: D1Database, hostId: string): Promise<string[]> {
  const linked = await db.prepare('SELECT public_code FROM open_sessions WHERE host_id = ?').bind(hostId).all<{ public_code: string }>()
  await db.batch([
    db.prepare('UPDATE open_sessions SET host_id = NULL WHERE host_id = ?').bind(hostId),
    db.prepare('DELETE FROM hosts WHERE id = ?').bind(hostId),
  ])
  return linked.results.map((row) => row.public_code)
}

/** The host's claimed sessions that have not expired, most recently active first (spec §9.5). */
export async function listHostSessions(db: D1Database, hostId: string, now: string): Promise<HostSessionSummary[]> {
  const rows = await db.prepare(`SELECT public_code, name, kind, status, last_activity_at, expires_at FROM open_sessions
      WHERE host_id = ? AND expires_at > ? ORDER BY last_activity_at DESC LIMIT ?`)
    .bind(hostId, now, MAX_LISTED_SESSIONS)
    .all<{ public_code: string; name: string; kind: HostSessionSummary['kind']; status: HostSessionSummary['status']; last_activity_at: string; expires_at: string }>()
  return rows.results.map((r) => ({
    code: r.public_code, name: r.name, kind: r.kind, status: r.status, lastActivityAt: r.last_activity_at, expiresAt: r.expires_at,
  }))
}

/** Removes expired logins (daily cron). Returns how many were removed. */
export async function purgeExpiredHostLogins(db: D1Database, now: string): Promise<number> {
  const result = await db.prepare('DELETE FROM host_logins WHERE expires_at <= ?').bind(now).run()
  return result.meta.changes ?? 0
}
```

`src/worker/repositories/pickleball/open/hostAccess.ts`:

```ts
// Per-session host access beyond the original host key (spec §9): the claim
// (open_sessions.host_id), extra host links minted for the claiming account,
// and the DUPR export log behind the 5-per-day limit. The Durable Object is
// the only caller, so every change here is serialized per session.

export interface HostAccess {
  /** The Google-verified host who claimed the session, or null. */
  hostId: string | null
  /** SHA-256 hashes of extra host links, oldest first. */
  extraKeyHashes: string[]
}

export const MAX_EXTRA_HOST_KEYS = 10

export async function loadHostAccess(db: D1Database, sessionId: string): Promise<HostAccess> {
  const [session, keys] = await Promise.all([
    db.prepare('SELECT host_id FROM open_sessions WHERE id = ?').bind(sessionId).first<{ host_id: string | null }>(),
    db.prepare('SELECT key_hash FROM open_host_keys WHERE session_id = ? ORDER BY created_at, id').bind(sessionId).all<{ key_hash: string }>(),
  ])
  return { hostId: session?.host_id ?? null, extraKeyHashes: keys.results.map((k) => k.key_hash) }
}

/**
 * Links an unclaimed session to a host that still exists. False when the
 * session was already claimed or the host is gone (deleted mid-flow), so a
 * claim can never be overwritten and never points at a missing account.
 */
export async function claimSession(db: D1Database, sessionId: string, hostId: string): Promise<boolean> {
  const result = await db.prepare(`UPDATE open_sessions SET host_id = ?
      WHERE id = ? AND host_id IS NULL AND EXISTS (SELECT 1 FROM hosts WHERE id = ?)`)
    .bind(hostId, sessionId, hostId).run()
  return (result.meta.changes ?? 0) === 1
}

export async function insertHostKey(db: D1Database, key: { id: string; sessionId: string; keyHash: string; createdAt: string }): Promise<void> {
  await db.prepare('INSERT INTO open_host_keys (id, session_id, key_hash, created_at) VALUES (?, ?, ?, ?)')
    .bind(key.id, key.sessionId, key.keyHash, key.createdAt).run()
}

/** When each DUPR export since `sinceIso` was sent, oldest first. */
export async function recentDuprExports(db: D1Database, sessionId: string, sinceIso: string): Promise<string[]> {
  const rows = await db.prepare('SELECT sent_at FROM open_dupr_exports WHERE session_id = ? AND sent_at > ? ORDER BY sent_at')
    .bind(sessionId, sinceIso).all<{ sent_at: string }>()
  return rows.results.map((r) => r.sent_at)
}

export async function insertDuprExport(
  db: D1Database, row: { id: string; sessionId: string; sentAt: string; gameCount: number; skippedCount: number },
): Promise<void> {
  await db.prepare('INSERT INTO open_dupr_exports (id, session_id, sent_at, game_count, skipped_count) VALUES (?, ?, ?, ?, ?)')
    .bind(row.id, row.sessionId, row.sentAt, row.gameCount, row.skippedCount).run()
}

/** Gives an export back when its email could not be sent. */
export async function deleteDuprExport(db: D1Database, sessionId: string, id: string): Promise<void> {
  await db.prepare('DELETE FROM open_dupr_exports WHERE id = ? AND session_id = ?').bind(id, sessionId).run()
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/worker/repositories/pickleball/open`
Expected: PASS — the 11 new tests, and every existing repository test (they list migrations `0016`–`0018` only, and nothing they call reads the new column).

- [ ] **Step 6: Commit**

Add under `### Added` in `## [Unreleased]`:

```markdown
- Free sessions, Phase 4: migration `0019` adds `hosts` (Google-verified DUPR exporters; marketing opt-in off by default; never expires), `host_logins` (hashed login tokens), `open_sessions.host_id` (the claim, unlinked when an account is deleted), `open_host_keys` (extra host links) and `open_dupr_exports` (the 5-a-day log). Session rows still all cascade from `open_sessions`.
```

```bash
git add migrations/pickleball/0019_hosts.sql src/worker/repositories/pickleball/open/hosts.ts src/worker/repositories/pickleball/open/hostAccess.ts src/worker/repositories/pickleball/open/hosts.test.ts CHANGELOG.md
git commit -m "feat(pickleball): hosts, logins and session claims (migration 0019)"
```

---

### Task 2: The DUPR CSV and its email

**Files:**
- Create: `tests/fixtures/dupr-import-template.csv`
- Create: `src/lib/pickleball/open/dupr/export.ts`
- Create: `src/lib/pickleball/open/dupr/email.ts`
- Test: `src/lib/pickleball/open/dupr/export.test.ts`, `src/lib/pickleball/open/dupr/email.test.ts`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: `csvText` (`src/lib/pickleball/open/csv.ts`), `OpenSessionState`, `OpenMatch`, `OpenPlayer`; test fixtures `court`, `finished`, `player`, `sessionState` (`src/lib/pickleball/open/testing/fixtures.ts`).
- Produces:
  - `export.ts`: `DUPR_COLUMNS` (27 names), `DUPR_ID_PATTERN`, `MIN_WINNING_POINTS` (6), `DuprSkip { game; court; summary; reason }`, `DuprExport { csv; exported; skipped: DuprSkip[]; missingIds: Array<{ id; name }> }`, `normalizeTimeZone(value: unknown): string`, `localDate(iso, timeZone): string`, `listNames(names): string`, `skipReason(match, find): string | null`, `buildDuprExport(state, { timeZone }): DuprExport`.
  - `email.ts`: `DuprEmailInput { hostName; sessionName; date; clubId; exported; skipped }`, `DuprEmail { subject; text; html }`, `DUPR_CLICK_PATH` (`'Matches → Add Matches → Import Matches via CSV'`), `duprFilename(sessionName, date)`, `buildDuprEmail(input): DuprEmail`.

- [ ] **Step 1: Pin the template**

`tests/fixtures/dupr-import-template.csv` is DUPR's club match-import header, exactly as spec §9.4 gives it, as one line (no instruction rows):

```csv
matchType,event,date,playerA1,playerA1DuprId,playerA1ExternalId,playerA2,playerA2DuprId,playerA2ExternalId,playerB1,playerB1DuprId,playerB1ExternalId,playerB2,playerB2DuprId,playerB2ExternalId,teamAGame1,teamBGame1,teamAGame2,teamBGame2,teamAGame3,teamBGame3,teamAGame4,teamBGame4,teamAGame5,teamBGame5,location,scoreType
```

- [ ] **Step 2: Write the failing tests**

`src/lib/pickleball/open/dupr/export.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { court, finished, player, sessionState } from '../testing/fixtures'
import type { OpenMatch } from '../types'
import { buildDuprExport, DUPR_COLUMNS, listNames, localDate, normalizeTimeZone, skipReason } from './export'

const TEMPLATE = readFileSync(join(process.cwd(), 'tests/fixtures/dupr-import-template.csv'), 'utf8').split(/\r?\n/)[0]

const players = [
  player('a', { name: 'Ana', duprId: 'AAA111', position: 1 }),
  player('b', { name: 'Ben', duprId: 'BBB222', position: 2 }),
  player('c', { name: 'Cy', duprId: 'CCC333', position: 3 }),
  player('d', { name: 'Di', duprId: 'DDD444', position: 4 }),
  player('e', { name: 'Eve', duprId: null, position: 5 }),
  player('f', { name: '=Fay', duprId: 'FFF666', position: 6 }),
]

function stateWith(matches: OpenMatch[], overrides = {}) {
  return sessionState({ name: 'Sunday, "Open"', location: 'Riverside Courts', players, courts: [court('c1', 1), court('c2', 2)], matches, ...overrides })
}

const cellsOf = (line: string) => line.match(/("([^"]|"")*"|[^,]*)(,|$)/g)!.slice(0, -1).map((c) => c.replace(/,$/, ''))

describe('the DUPR template', () => {
  it('matches the pinned fixture column for column', () => {
    expect(DUPR_COLUMNS.join(',')).toBe(TEMPLATE)
    expect(DUPR_COLUMNS).toHaveLength(27)
  })
})

describe('buildDuprExport', () => {
  it('writes one doubles row per eligible game with only game 1 filled', () => {
    const out = buildDuprExport(stateWith([finished('m1', ['a', 'b'], ['c', 'd'], 'A', 11, 7, 0)]), { timeZone: 'UTC' })
    const [header, line, ...rest] = out.csv.split('\r\n')
    expect(header).toBe(TEMPLATE)
    expect(rest).toEqual([])
    const cells = cellsOf(line)
    expect(cells).toHaveLength(27)
    expect(cells).toEqual([
      'D', '"Sunday, ""Open"""', '2026-10-11',
      'Ana', 'AAA111', 'a', 'Ben', 'BBB222', 'b', 'Cy', 'CCC333', 'c', 'Di', 'DDD444', 'd',
      '11', '7', '', '', '', '', '', '', '', '',
      'Riverside Courts', 'SIDEOUT',
    ])
    expect(out.exported).toBe(1)
    expect(out.skipped).toEqual([])
  })

  it('uses RALLY when the host chose rally scoring, and a blank location when none was given', () => {
    const state = stateWith([finished('m1', ['a', 'b'], ['c', 'd'], 'B', 9, 11)], {
      location: null, settings: { ...sessionState().settings, scoringStyle: 'RALLY' },
    })
    const cells = cellsOf(buildDuprExport(state, { timeZone: 'UTC' }).csv.split('\r\n')[1])
    expect(cells.slice(15, 17)).toEqual(['9', '11'])
    expect(cells.slice(25)).toEqual(['', 'RALLY'])
  })

  it('dates each game in the host’s time zone', () => {
    const late = { ...finished('m1', ['a', 'b'], ['c', 'd'], 'A', 11, 7), finishedAt: '2026-10-11T23:30:00.000Z' }
    const row = (timeZone: string) => cellsOf(buildDuprExport(stateWith([late]), { timeZone }).csv.split('\r\n')[1])[2]
    expect(row('UTC')).toBe('2026-10-11')
    expect(row('Asia/Manila')).toBe('2026-10-12')
    expect(row('America/Los_Angeles')).toBe('2026-10-11')
    expect(row('Not/AZone')).toBe('2026-10-11')
  })

  it('lists every game it leaves out, numbered like the results CSV, with the reason', () => {
    const matches: OpenMatch[] = [
      finished('m1', ['a', 'b'], ['c', 'd'], 'A', 11, 7, 1),
      finished('m2', ['a', 'e'], ['c', 'd'], 'A', 11, 4, 2, 'c2'),
      finished('m3', ['a', 'b'], ['c', 'd'], 'A', null, null, 3),
      finished('m4', ['a', 'b'], ['c', 'd'], 'A', 5, 3, 4),
      { ...finished('m5', ['a', 'b'], ['c', 'd'], 'A', 11, 2, 5), status: 'ABANDONED' },
    ]
    const out = buildDuprExport(stateWith(matches), { timeZone: 'UTC' })
    expect(out.exported).toBe(1)
    expect(out.skipped).toEqual([
      { game: 2, court: 'Court 2', summary: 'Ana & Eve 11–4 Cy & Di', reason: 'Eve has no DUPR ID.' },
      { game: 3, court: 'Court 1', summary: 'Ana & Ben against Cy & Di', reason: 'No score was saved.' },
      { game: 4, court: 'Court 1', summary: 'Ana & Ben 5–3 Cy & Di', reason: 'DUPR needs one team to reach 6 points.' },
    ])
    expect(out.missingIds).toEqual([{ id: 'e', name: 'Eve' }])
  })

  it('refuses two players with the same DUPR ID and defuses a formula-looking name', () => {
    const twin = { ...players[1], duprId: 'AAA111' }
    const state = stateWith([finished('m1', ['a', 'b'], ['c', 'f'], 'A', 11, 9)], { players: players.map((p) => (p.id === 'b' ? twin : p)) })
    expect(buildDuprExport(state, { timeZone: 'UTC' }).skipped[0].reason).toBe('Ana and Ben have the same DUPR ID.')
    const ok = buildDuprExport(stateWith([finished('m1', ['a', 'b'], ['c', 'f'], 'A', 11, 9)]), { timeZone: 'UTC' })
    expect(cellsOf(ok.csv.split('\r\n')[1])[12]).toBe(`"'=Fay"`)
  })

  it('an empty session is a header and nothing else', () => {
    expect(buildDuprExport(stateWith([]), { timeZone: 'UTC' })).toEqual({ csv: TEMPLATE, exported: 0, skipped: [], missingIds: [] })
  })
})

describe('skipReason', () => {
  const find = (id: string) => players.find((p) => p.id === id)
  it('names a tie, more than one missing player, and a player who is not in the session', () => {
    expect(skipReason(finished('m', ['a', 'b'], ['c', 'd'], 'A', 10, 10), find)).toBe('DUPR does not accept a tie.')
    const noIds = (id: string) => (id === 'a' ? players[0] : { ...players[1], id, name: id.toUpperCase(), duprId: null })
    expect(skipReason(finished('m', ['a', 'x'], ['y', 'z'], 'A', 11, 3), noIds)).toBe('X, Y and Z have no DUPR ID.')
    expect(skipReason(finished('m', ['a', 'b'], ['c', 'ghost'], 'A', 11, 3), find)).toBe('DUPR needs four players in a doubles game.')
  })
})

describe('helpers', () => {
  it('normalizes a time zone and joins names', () => {
    expect(normalizeTimeZone('Europe/Berlin')).toBe('Europe/Berlin')
    expect(normalizeTimeZone(42)).toBe('UTC')
    expect(normalizeTimeZone('')).toBe('UTC')
    expect(localDate('2026-01-05T12:00:00.000Z', 'UTC')).toBe('2026-01-05')
    expect(listNames(['Ana'])).toBe('Ana')
    expect(listNames(['Ana', 'Ben'])).toBe('Ana and Ben')
    expect(listNames(['Ana', 'Ben', 'Cy'])).toBe('Ana, Ben and Cy')
  })
})
```

`src/lib/pickleball/open/dupr/email.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildDuprEmail, DUPR_CLICK_PATH, duprFilename } from './email'

const base = { hostName: 'Mo', sessionName: 'Sunday <Open>', date: '2026-10-12', clubId: '987654', exported: 3, skipped: [] }

describe('buildDuprEmail', () => {
  it('says how many games are attached, where to upload them and who may upload', () => {
    const email = buildDuprEmail(base)
    expect(email.subject).toBe('DUPR export: Sunday <Open> (2026-10-12)')
    expect(email.text).toContain('is attached: 3 games.')
    expect(email.text).toContain('Club ID 987654')
    expect(email.text).toContain(DUPR_CLICK_PATH)
    expect(email.text).toContain('Club Director or Organizer')
    expect(email.text).toContain('reply to this email')
    expect(email.text).not.toContain('Left out')
  })

  it('lists every skipped game with its reason, in text and HTML', () => {
    const email = buildDuprEmail({ ...base, exported: 1, skipped: [{ game: 2, court: 'Court 1', summary: 'Ana & Eve 11–4 Cy & Di', reason: 'Eve has no DUPR ID.' }] })
    expect(email.text).toContain('is attached: 1 game.')
    expect(email.text).toContain('Left out (1 game):')
    expect(email.text).toContain('- Game 2, Court 1: Ana & Eve 11–4 Cy & Di. Eve has no DUPR ID.')
    expect(email.html).toContain('Game 2, Court 1: Ana &amp; Eve 11–4 Cy &amp; Di. Eve has no DUPR ID.')
  })

  it('escapes everything the host typed in the HTML', () => {
    const email = buildDuprEmail({ ...base, hostName: '<b>Mo</b>' })
    expect(email.html).toContain('Sunday &lt;Open&gt;')
    expect(email.html).toContain('&lt;b&gt;Mo&lt;/b&gt;')
    expect(email.html).not.toContain('<b>Mo</b>')
  })
})

describe('duprFilename', () => {
  it('slugs the session name', () => {
    expect(duprFilename('Sunday Open Play!', '2026-10-12')).toBe('dupr-sunday-open-play-2026-10-12.csv')
    expect(duprFilename('!!!', '2026-10-12')).toBe('dupr-session-2026-10-12.csv')
  })
})
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run src/lib/pickleball/open/dupr`
Expected: FAIL — `Failed to resolve import "./export"` and `"./email"`.

- [ ] **Step 4: Write the builder and the email**

`src/lib/pickleball/open/dupr/export.ts`:

```ts
// The DUPR club match-import CSV (spec §9.4). Pure: no I/O. The column layout
// is pinned to tests/fixtures/dupr-import-template.csv; if DUPR changes its
// template, the fixture and DUPR_COLUMNS change together.
import { csvText } from '../csv'
import type { OpenMatch, OpenPlayer, OpenSessionState } from '../types'

export const DUPR_COLUMNS = [
  'matchType', 'event', 'date',
  'playerA1', 'playerA1DuprId', 'playerA1ExternalId', 'playerA2', 'playerA2DuprId', 'playerA2ExternalId',
  'playerB1', 'playerB1DuprId', 'playerB1ExternalId', 'playerB2', 'playerB2DuprId', 'playerB2ExternalId',
  'teamAGame1', 'teamBGame1', 'teamAGame2', 'teamBGame2', 'teamAGame3', 'teamBGame3',
  'teamAGame4', 'teamBGame4', 'teamAGame5', 'teamBGame5',
  'location', 'scoreType',
] as const

/** DUPR IDs are 6 letters or digits, stored uppercased (spec §9.4). */
export const DUPR_ID_PATTERN = /^[A-Z0-9]{6}$/
/** DUPR rejects a game in which neither team reached 6 points. */
export const MIN_WINNING_POINTS = 6

export interface DuprSkip {
  /** The game's number in the results CSV: finished games in the order they were played. */
  game: number
  court: string
  /** "Ana & Ben 11–7 Cy & Di" */
  summary: string
  reason: string
}

export interface DuprExport {
  csv: string
  exported: number
  skipped: DuprSkip[]
  /** Players who would unblock a game by adding a DUPR ID, in roster order. */
  missingIds: Array<{ id: string; name: string }>
}

/** A valid IANA zone, or UTC. The zone comes from the host's own device. */
export function normalizeTimeZone(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 64) return 'UTC'
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })
    return value
  } catch {
    return 'UTC'
  }
}

/** YYYY-MM-DD of an instant in a time zone. */
export function localDate(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(iso))
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

/** "Ana", "Ana and Ben", "Ana, Ben and Cy". */
export function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

type Lookup = (id: string) => OpenPlayer | undefined

function teamNames(team: readonly string[], find: Lookup): string {
  return team.map((id) => find(id)?.name ?? '—').join(' & ')
}

function summary(match: OpenMatch, find: Lookup): string {
  const score = match.scoreA !== null && match.scoreB !== null ? ` ${match.scoreA}–${match.scoreB} ` : ' against '
  return `${teamNames(match.teamA, find)}${score}${teamNames(match.teamB, find)}`
}

const validId = (player: OpenPlayer | undefined): string | null =>
  player?.duprId && DUPR_ID_PATTERN.test(player.duprId) ? player.duprId : null

/** Why a game score cannot go to DUPR, or null when it can. Checked before the players. */
function scoreProblem(match: OpenMatch): string | null {
  if (match.scoreA === null || match.scoreB === null) return 'No score was saved.'
  if (match.scoreA === match.scoreB) return 'DUPR does not accept a tie.'
  if (Math.max(match.scoreA, match.scoreB) < MIN_WINNING_POINTS) return `DUPR needs one team to reach ${MIN_WINNING_POINTS} points.`
  return null
}

/** Why this finished game is left out of the export, or null when it goes in. */
export function skipReason(match: OpenMatch, find: Lookup): string | null {
  const score = scoreProblem(match)
  if (score) return score
  const players = [...match.teamA, ...match.teamB].map(find)
  if (match.teamA.length !== 2 || match.teamB.length !== 2 || players.some((p) => !p)) return 'DUPR needs four players in a doubles game.'
  const missing = players.filter((p) => !validId(p)).map((p) => (p as OpenPlayer).name)
  if (missing.length) return `${listNames(missing)} ${missing.length === 1 ? 'has' : 'have'} no DUPR ID.`
  const seen = new Map<string, string>()
  for (const p of players as OpenPlayer[]) {
    const id = validId(p) as string
    const first = seen.get(id)
    if (first) return `${first} and ${p.name} have the same DUPR ID.`
    seen.set(id, p.name)
  }
  return null
}

function row(state: OpenSessionState, match: OpenMatch, find: Lookup, timeZone: string): string {
  const cells = (id: string) => {
    const p = find(id) as OpenPlayer
    return [csvText(p.name), validId(p) as string, p.id]
  }
  const date = localDate(match.finishedAt ?? match.startedAt ?? match.proposedAt, timeZone)
  return [
    'D', csvText(state.name), date,
    ...cells(match.teamA[0]), ...cells(match.teamA[1]), ...cells(match.teamB[0]), ...cells(match.teamB[1]),
    String(match.scoreA), String(match.scoreB), '', '', '', '', '', '', '', '',
    csvText(state.location ?? ''), state.settings.scoringStyle,
  ].join(',')
}

/**
 * One row per finished game that DUPR will accept: a doubles game with a
 * score that is not a tie and in which a team reached 6, and four distinct,
 * valid DUPR IDs. Only game 1 is filled. No instruction rows (spec §9.4).
 */
export function buildDuprExport(state: OpenSessionState, { timeZone }: { timeZone: string }): DuprExport {
  const byId = new Map(state.players.map((p) => [p.id, p]))
  const find: Lookup = (id) => byId.get(id)
  const zone = normalizeTimeZone(timeZone)
  const games = state.matches.filter((m) => m.status === 'FINISHED').sort((a, b) => a.seq - b.seq)
  const rows: string[] = []
  const skipped: DuprSkip[] = []
  const missing = new Set<string>()
  games.forEach((match, index) => {
    const reason = skipReason(match, find)
    if (!reason) {
      rows.push(row(state, match, find, zone))
      return
    }
    skipped.push({
      game: index + 1, court: state.courts.find((c) => c.id === match.courtId)?.label ?? '', summary: summary(match, find), reason,
    })
    if (!scoreProblem(match)) for (const id of [...match.teamA, ...match.teamB]) if (!validId(find(id))) missing.add(id)
  })
  return {
    csv: [DUPR_COLUMNS.join(','), ...rows].join('\r\n'),
    exported: rows.length,
    skipped,
    missingIds: state.players.filter((p) => missing.has(p.id)).map((p) => ({ id: p.id, name: p.name })),
  }
}
```

`src/lib/pickleball/open/dupr/email.ts`:

```ts
// The DUPR export email (spec §9.4, §9.6). Pure: builds the subject, the
// plain-text body and an HTML body with inline styles only (email clients
// strip <style>). The CSV goes as an attachment, added by the sender.
import type { DuprSkip } from './export'

export interface DuprEmailInput {
  hostName: string
  sessionName: string
  /** The session's local date, YYYY-MM-DD. */
  date: string
  clubId: string
  exported: number
  skipped: readonly DuprSkip[]
}

export interface DuprEmail {
  subject: string
  text: string
  html: string
}

export const DUPR_CLICK_PATH = 'Matches → Add Matches → Import Matches via CSV'

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

const games = (n: number) => `${n} game${n === 1 ? '' : 's'}`

export function duprFilename(sessionName: string, date: string): string {
  const slug = sessionName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'session'
  return `dupr-${slug}-${date}.csv`
}

function skipLine(skip: DuprSkip): string {
  return `Game ${skip.game}${skip.court ? `, ${skip.court}` : ''}: ${skip.summary}. ${skip.reason}`
}

export function buildDuprEmail(input: DuprEmailInput): DuprEmail {
  const subject = `DUPR export: ${input.sessionName} (${input.date})`
  const intro = `Your DUPR match file for "${input.sessionName}" is attached: ${games(input.exported)}.`
  const upload = `To upload it, open your club (Club ID ${input.clubId}) in DUPR, go to ${DUPR_CLICK_PATH}, and choose the attached file. Your DUPR account must be a Club Director or Organizer of that club.`
  const skippedHeading = `Left out (${games(input.skipped.length)}):`
  const reply = 'If DUPR refuses the file, reply to this email with the message it shows.'

  const text = [
    `Hi ${input.hostName},`,
    '',
    intro,
    '',
    upload,
    ...(input.skipped.length ? ['', skippedHeading, ...input.skipped.map((s) => `- ${skipLine(s)}`)] : []),
    '',
    reply,
    '',
    'Devlab Pickleball · devlabstudios.com/pickleball',
  ].join('\n')

  const font = "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;"
  const skippedHtml = input.skipped.length
    ? `<p style="margin:18px 0 6px 0;font-weight:700;color:#111321;">${escapeHtml(skippedHeading)}</p>
<ul style="margin:0;padding-left:20px;">${input.skipped.map((s) => `<li style="margin:0 0 4px 0;">${escapeHtml(skipLine(s))}</li>`).join('')}</ul>`
    : ''
  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background-color:#f4f5fa;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f5fa;"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background-color:#ffffff;border:1px solid #e4e7f2;border-radius:14px;">
<tr><td style="padding:28px 32px;${font}font-size:15px;line-height:1.6;color:#3c4356;">
<p style="margin:0 0 6px 0;font-size:12px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:#5b6478;">Devlab Pickleball</p>
<h1 style="margin:0 0 14px 0;font-size:22px;line-height:1.25;color:#111321;">${escapeHtml(subject)}</h1>
<p style="margin:0 0 14px 0;">Hi ${escapeHtml(input.hostName)},</p>
<p style="margin:0 0 14px 0;">${escapeHtml(intro)}</p>
<p style="margin:0;">${escapeHtml(upload)}</p>
${skippedHtml}
<p style="margin:18px 0 0 0;color:#5b6478;font-size:13px;">${escapeHtml(reply)}</p>
</td></tr></table></td></tr></table>
</body>
</html>`

  return { subject, text, html }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/pickleball/open/dupr`
Expected: PASS (13 tests).

- [ ] **Step 6: Commit**

Add under `### Added` in `## [Unreleased]`:

```markdown
- Free sessions: the DUPR club match-import CSV, pinned column for column to `tests/fixtures/dupr-import-template.csv` (doubles, game 1 only, the host's local date, no instruction rows). Games with no score, a tie, no team at 6 points, or a missing or shared DUPR ID are left out with a reason, and the export email lists them with the upload steps.
```

```bash
git add tests/fixtures/dupr-import-template.csv src/lib/pickleball/open/dupr CHANGELOG.md
git commit -m "feat(pickleball): dupr import csv and export email"
```

---

### Task 3: The host sets a player's DUPR ID

**Files:**
- Modify: `src/lib/schemas/pickleball/open/commands.ts`
- Modify: `src/lib/pickleball/open/reducer.ts`
- Test: `src/lib/pickleball/open/reducer.dupr.test.ts`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: `applyCommand`, `finalizeCommand`, `captainRefusal` (`CAPTAIN_COMMANDS` does not include the new type, so captains are refused without any change there).
- Produces: command `{ type: 'SET_PLAYER_DUPR_ID'; playerId: string; duprId: string | null }` (6 letters or digits, trimmed; stored uppercased). 409 `"{name} already has DUPR ID {ID}."` when another player has it; 404 for an unknown player. Allowed after the session ends and in tournaments.

- [ ] **Step 1: Write the failing test**

`src/lib/pickleball/open/reducer.dupr.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { commandSchema, type OpenCommand } from '../../schemas/pickleball/open/commands'
import { captainRefusal } from './captains'
import { applyCommand, finalizeCommand } from './reducer'
import { at, court, player, sessionState } from './testing/fixtures'
import type { CommandContext, OpenSessionState } from './types'

let n = 0
const ctx = (minute: number): CommandContext => ({ now: at(minute), newId: () => `n${(n += 1)}` })

function run(state: OpenSessionState, command: OpenCommand): OpenSessionState {
  const result = applyCommand(state, command, ctx(1))
  if (!result.ok) throw new Error(result.error)
  return finalizeCommand(result.state, ctx(1))
}

function fail(state: OpenSessionState, command: OpenCommand) {
  const result = applyCommand(state, command, ctx(1))
  if (result.ok) throw new Error('expected a failure')
  return result
}

const base = () => sessionState({
  courts: [court('c1', 1)],
  players: [player('a', { name: 'Ana', duprId: 'AAA111' }), player('b', { name: 'Ben' })],
})

describe('SET_PLAYER_DUPR_ID', () => {
  it('sets an uppercased ID, clears it with null, and works after the session ends', () => {
    const set = run(base(), { type: 'SET_PLAYER_DUPR_ID', playerId: 'b', duprId: 'bbb222' })
    expect(set.players.find((p) => p.id === 'b')?.duprId).toBe('BBB222')
    const ended = run(set, { type: 'END_SESSION' })
    const cleared = run(ended, { type: 'SET_PLAYER_DUPR_ID', playerId: 'b', duprId: null })
    expect(cleared.players.find((p) => p.id === 'b')?.duprId).toBeNull()
  })

  it('refuses an ID another player already has, and an unknown player', () => {
    expect(fail(base(), { type: 'SET_PLAYER_DUPR_ID', playerId: 'b', duprId: 'aaa111' })).toMatchObject({ status: 409, error: 'Ana already has DUPR ID AAA111.' })
    expect(fail(base(), { type: 'SET_PLAYER_DUPR_ID', playerId: 'zz', duprId: 'CCC333' }).status).toBe(404)
  })

  it('setting a player’s own ID again is allowed', () => {
    expect(run(base(), { type: 'SET_PLAYER_DUPR_ID', playerId: 'a', duprId: 'AAA111' }).players[0].duprId).toBe('AAA111')
  })

  it('accepts only 6 letters or digits', () => {
    expect(commandSchema.safeParse({ type: 'SET_PLAYER_DUPR_ID', playerId: 'a', duprId: ' ab12c3 ' }).success).toBe(true)
    for (const bad of ['AB12C', 'AB12C34', 'AB-12C', '']) {
      expect(commandSchema.safeParse({ type: 'SET_PLAYER_DUPR_ID', playerId: 'a', duprId: bad }).success, bad).toBe(false)
    }
  })

  it('is the host’s alone: a captain is refused', () => {
    const captain = { id: 'cap', label: 'Court 1 captain', courtId: 'c1', keyHash: 'h', createdAt: at(0) }
    expect(captainRefusal({ type: 'SET_PLAYER_DUPR_ID', playerId: 'b', duprId: 'BBB222' }, captain, base())).toBe('Only the host can do that.')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/pickleball/open/reducer.dupr.test.ts`
Expected: FAIL — the schema rejects `SET_PLAYER_DUPR_ID` and the reducer has no case for it (type errors in the editor; `undefined` result at runtime).

- [ ] **Step 3: Add the command**

In `src/lib/schemas/pickleball/open/commands.ts`, find:

```ts
  z.object({ type: z.literal('SET_PLAYER_SKILL'), playerId: id, skill: z.number().min(1).max(8).nullable() }),
```

Replace it with:

```ts
  z.object({ type: z.literal('SET_PLAYER_SKILL'), playerId: id, skill: z.number().min(1).max(8).nullable() }),
  // DUPR IDs are 6 letters or digits (spec §9.3); null clears one. Host only: captains never get it.
  z.object({ type: z.literal('SET_PLAYER_DUPR_ID'), playerId: id, duprId: z.string().trim().regex(/^[A-Za-z0-9]{6}$/).nullable() }),
```

In `src/lib/pickleball/open/reducer.ts`, find:

```ts
    case 'ADD_RULE':
      return addRule(state, command.rule)
```

Replace it with:

```ts
    case 'SET_PLAYER_DUPR_ID': {
      // Allowed after the session ends: the DUPR export is often sent then (spec §9.3).
      const target = state.players.find((p) => p.id === command.playerId)
      if (!target) return fail(404, 'Player not found.')
      const duprId = command.duprId === null ? null : command.duprId.trim().toUpperCase()
      const holder = duprId ? state.players.find((p) => p.id !== target.id && p.duprId === duprId) : undefined
      if (holder) return fail(409, `${holder.name} already has DUPR ID ${duprId}.`)
      return ok(withPlayers(state, new Set([target.id]), { duprId }))
    }
    case 'ADD_RULE':
      return addRule(state, command.rule)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/pickleball/open src/lib/schemas/pickleball/open`
Expected: PASS — the 5 new tests and every existing engine and schema test.

- [ ] **Step 5: Commit**

Add under `### Added` in `## [Unreleased]`:

```markdown
- Open play and tournaments: the host can set or clear a player's DUPR ID (`SET_PLAYER_DUPR_ID`: 6 letters or digits, unique in the session, also after the session ends). Captains cannot.
```

```bash
git add src/lib/schemas/pickleball/open/commands.ts src/lib/pickleball/open/reducer.ts src/lib/pickleball/open/reducer.dupr.test.ts CHANGELOG.md
git commit -m "feat(pickleball): host edits a player's dupr id"
```

---

### Task 4: Host login: cookie, same-origin guard, test login and profile

**Files:**
- Create: `src/worker/pickleball/open/hostCookies.ts`
- Create: `src/worker/pickleball/open/sameOrigin.ts`
- Create: `src/worker/pickleball/open/hostSession.ts`
- Create: `src/lib/schemas/pickleball/open/host.ts`
- Create: `src/pages/api/pickleball/open/host/test-login.ts`
- Create: `src/pages/api/pickleball/open/host/me.ts` (GET and PATCH; Task 8 adds DELETE)
- Create: `src/pages/api/pickleball/open/host/sign-out.ts`
- Test: `src/worker/pickleball/open/hostSession.test.ts`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: Task 1's `upsertHost`, `createHostLogin`, `findHostByLogin`, `deleteHostLogin`, `updateHostProfile`, `toHostProfile`, `LOGIN_TTL_MS`; `randomBase64Url`, `sha256Base64Url` (`src/lib/pickleball/webCrypto.js`); `checkRateLimit`, `clientIp`, `rateLimitedResponse` (`src/worker/rateLimit.js`); `jsonResponse`; `drainRequestBody` (`src/lib/http`); `openErrorResponse` (`routeHelpers.ts`).
- Produces:
  - `hostCookies.ts`: `HOST_COOKIE` (`'devlab_pb_host'`), `HOST_OAUTH_COOKIE` (`'devlab_pb_host_oauth'`), `HOST_COOKIE_PATH` (`'/api/pickleball/open'`), `HOST_OAUTH_COOKIE_PATH` (`'/api/pickleball/auth/google'`), `parseCookies(header)`, `cookieFrom(request, name)`, `setCookieHeader(name, value, { path, maxAgeSeconds, secure })`, `clearCookieHeader(name, { path, secure })`, `isSecure(request)`.
  - `sameOrigin.ts`: `isSameOrigin(request): boolean`, `crossSiteRefusal(request): Response | null`.
  - `hostSession.ts`: `currentHost(env, request, now?): Promise<HostRecord | null>`, `beginHostLogin(env, request, hostId, now?): Promise<string>` (a Set-Cookie value), `endHostLogin(env, request): Promise<string>`, `signInFirst(): Response` (401 "Sign in with Google first."), `hostAccountIpLimited(env, request)`, `signInIpLimited(env, request)`.
  - `host.ts` (schemas): `testLoginSchema`, `DUPR_CLUB_ID_PATTERN`, `hostProfilePatchSchema`, `duprExportRequestSchema`, `HostProfilePatch`.
  - Routes: `POST /api/pickleball/open/host/test-login` `{ email, name?, marketingOptIn? }` → `{ host: HostProfile }` + cookie (404 unless the flag); `GET /api/pickleball/open/host/me` → `{ host: HostProfile | null }`; `PATCH …/me` `{ duprClubId?, marketingOptIn? }` → `{ host }`; `POST /api/pickleball/open/host/sign-out` → `{ signedOut: true }` + cleared cookie.

- [ ] **Step 1: Write the failing test**

`src/worker/pickleball/open/hostSession.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createSqliteD1 } from '../../repositories/pickleball/open/testing/sqliteD1'
import { upsertHost } from '../../repositories/pickleball/open/hosts'
import { clearCookieHeader, cookieFrom, HOST_COOKIE, parseCookies, setCookieHeader } from './hostCookies'
import { beginHostLogin, currentHost, endHostLogin } from './hostSession'
import { crossSiteRefusal, isSameOrigin } from './sameOrigin'

const MIGRATIONS = ['0016_open_sessions', '0017_open_captains', '0018_open_tournaments', '0019_hosts'].map((m) => `migrations/pickleball/${m}.sql`)
const NOW = '2026-10-12T10:00:00.000Z'

async function setup() {
  const { d1, raw } = createSqliteD1(MIGRATIONS)
  const env = { PICKLEBALL_DB: d1 } as unknown as Pick<Env, 'PICKLEBALL_DB' | 'RATE_LIMITER'>
  const host = await upsertHost(d1, { googleSub: 'g1', email: 'mo@example.com', displayName: 'Mo', marketingOptIn: false }, { now: NOW, newId: () => 'h1' })
  return { env, raw, host }
}

const withCookie = (setCookie: string, url = 'https://www.devlabstudios.com/api/pickleball/open/host/me') =>
  new Request(url, { headers: { Cookie: setCookie.split(';')[0] } })

describe('host login', () => {
  it('a new login sets an HttpOnly, Lax, Secure cookie scoped to the open-play API that stores no host id', async () => {
    const { env, raw, host } = await setup()
    const header = await beginHostLogin(env, new Request('https://www.devlabstudios.com/x'), host.id, NOW)
    expect(header).toMatch(/^devlab_pb_host=[A-Za-z0-9_-]{43}; Path=\/api\/pickleball\/open; Max-Age=2592000; HttpOnly; SameSite=Lax; Secure$/)
    expect(header).not.toContain(host.id)
    const stored = raw.prepare('SELECT token_hash FROM host_logins').get() as { token_hash: string }
    expect(header).not.toContain(stored.token_hash)
    expect((await currentHost(env, withCookie(header), NOW))?.id).toBe(host.id)
  })

  it('plain-http local development gets no Secure flag', async () => {
    const { env, host } = await setup()
    expect(await beginHostLogin(env, new Request('http://localhost:8787/x'), host.id, NOW)).not.toContain('Secure')
  })

  it('a missing, malformed or unknown cookie is nobody', async () => {
    const { env } = await setup()
    expect(await currentHost(env, new Request('https://x.test/'), NOW)).toBeNull()
    expect(await currentHost(env, withCookie('devlab_pb_host=short'), NOW)).toBeNull()
    expect(await currentHost(env, withCookie(`devlab_pb_host=${'a'.repeat(43)}`), NOW)).toBeNull()
  })

  it('signing out ends that login only and clears the cookie', async () => {
    const { env, host } = await setup()
    const phone = await beginHostLogin(env, new Request('https://x.test/'), host.id, NOW)
    const laptop = await beginHostLogin(env, new Request('https://x.test/'), host.id, NOW)
    const cleared = await endHostLogin(env, withCookie(phone))
    expect(cleared).toContain('devlab_pb_host=; Path=/api/pickleball/open; Max-Age=0')
    expect(await currentHost(env, withCookie(phone), NOW)).toBeNull()
    expect((await currentHost(env, withCookie(laptop), NOW))?.id).toBe(host.id)
  })
})

describe('cookies', () => {
  it('parses the first value of each cookie and builds clear headers', () => {
    expect(parseCookies('a=1; b=2; a=3; junk; =x')).toEqual({ a: '1', b: '2' })
    expect(cookieFrom(new Request('https://x.test/', { headers: { Cookie: `${HOST_COOKIE}=tok` } }), HOST_COOKIE)).toBe('tok')
    expect(setCookieHeader('n', 'v', { path: '/p', maxAgeSeconds: 5, secure: false })).toBe('n=v; Path=/p; Max-Age=5; HttpOnly; SameSite=Lax')
    expect(clearCookieHeader('n', { path: '/p', secure: true })).toBe('n=; Path=/p; Max-Age=0; HttpOnly; SameSite=Lax; Secure')
  })
})

describe('same-origin guard', () => {
  const post = (headers: Record<string, string>) => new Request('https://www.devlabstudios.com/api/pickleball/open/host/me', { method: 'POST', headers })
  it('accepts this site and refuses any other, or a request that says nothing', () => {
    expect(isSameOrigin(post({ Origin: 'https://www.devlabstudios.com' }))).toBe(true)
    expect(isSameOrigin(post({ 'Sec-Fetch-Site': 'same-origin' }))).toBe(true)
    expect(isSameOrigin(post({ Origin: 'https://evil.example' }))).toBe(false)
    expect(isSameOrigin(post({ Origin: 'https://devlabstudios.com' }))).toBe(false)
    expect(isSameOrigin(post({ 'Sec-Fetch-Site': 'cross-site' }))).toBe(false)
    expect(isSameOrigin(post({}))).toBe(false)
    expect(crossSiteRefusal(post({ Origin: 'https://evil.example' }))?.status).toBe(403)
    expect(crossSiteRefusal(post({ Origin: 'https://www.devlabstudios.com' }))).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/worker/pickleball/open/hostSession.test.ts`
Expected: FAIL — `Failed to resolve import "./hostCookies"`.

- [ ] **Step 3: Write the cookie helpers, the guard and the login**

`src/worker/pickleball/open/hostCookies.ts`:

```ts
// Cookies for Google-verified hosts (spec §9.1). Self-contained on purpose:
// the old app's session.js is deleted in Phase 5 (§12), and nothing here may
// depend on it.

/** The signed-in host's login token: opaque, random, only its SHA-256 is stored (host_logins). */
export const HOST_COOKIE = 'devlab_pb_host'
/** The PKCE verifier, state and return path while Google sign-in is in flight. */
export const HOST_OAUTH_COOKIE = 'devlab_pb_host_oauth'
/** Only the open-play API ever reads the login cookie, so the browser sends it nowhere else. */
export const HOST_COOKIE_PATH = '/api/pickleball/open'
/** Only the Google callback reads the in-flight cookie. */
export const HOST_OAUTH_COOKIE_PATH = '/api/pickleball/auth/google'

export function parseCookies(header: string | null): Record<string, string> {
  const cookies: Record<string, string> = {}
  for (const part of (header ?? '').split(';')) {
    const index = part.indexOf('=')
    if (index < 1) continue
    const name = part.slice(0, index).trim()
    const value = part.slice(index + 1).trim()
    if (name && !(name in cookies)) cookies[name] = value
  }
  return cookies
}

export function cookieFrom(request: Request, name: string): string | null {
  return parseCookies(request.headers.get('Cookie'))[name] ?? null
}

interface CookieOptions {
  path: string
  maxAgeSeconds: number
  /** False only on plain-http local development. */
  secure: boolean
}

/**
 * HttpOnly (no script can read it), SameSite=Lax (sent on the top-level
 * navigation back from Google and from a link in an email, never on a
 * cross-site POST, which is half of the CSRF defence; sameOrigin.ts is the
 * other half), Secure on https.
 */
export function setCookieHeader(name: string, value: string, { path, maxAgeSeconds, secure }: CookieOptions): string {
  return [`${name}=${value}`, `Path=${path}`, `Max-Age=${maxAgeSeconds}`, 'HttpOnly', 'SameSite=Lax', ...(secure ? ['Secure'] : [])].join('; ')
}

export function clearCookieHeader(name: string, { path, secure }: Omit<CookieOptions, 'maxAgeSeconds'>): string {
  return setCookieHeader(name, '', { path, maxAgeSeconds: 0, secure })
}

export function isSecure(request: Request): boolean {
  return new URL(request.url).protocol === 'https:'
}
```

`src/worker/pickleball/open/sameOrigin.ts`:

```ts
// CSRF guard for every state-changing route that trusts the host cookie
// (spec §9: claim, export, account changes, sign-out, reopen). The cookie is
// SameSite=Lax, so a browser does not send it on a cross-site POST; this
// check refuses the request outright as well, so the defence never rests on
// one browser feature. Browsers send Origin on every POST, PATCH and DELETE;
// a request without Origin must at least say it came from this site.
import { jsonResponse } from '../../utils/responses.js'

export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('Origin')
  if (origin) return origin === new URL(request.url).origin
  return request.headers.get('Sec-Fetch-Site') === 'same-origin'
}

/** The 403 to send when the request did not come from this site, or null. The caller drains any body first. */
export function crossSiteRefusal(request: Request): Response | null {
  return isSameOrigin(request) ? null : jsonResponse({ error: 'That request did not come from this site.' }, 403)
}
```

`src/worker/pickleball/open/hostSession.ts`:

```ts
// Who the signed-in host is (spec §9.1). The devlab_pb_host cookie holds an
// opaque random token, never the host id itself: only its SHA-256 is stored
// (host_logins), so a database leak yields no usable cookie, signing out
// really ends the login, and deleting an account ends every login at once
// (cascade). No signing secret is needed, so nothing here depends on
// PICKLEBALL_SESSION_SECRET, which belongs to the app Phase 5 retires.
import { randomBase64Url, sha256Base64Url } from '../../../lib/pickleball/webCrypto.js'
import { createHostLogin, deleteHostLogin, findHostByLogin, LOGIN_TTL_MS, type HostRecord } from '../../repositories/pickleball/open/hosts'
import { checkRateLimit, clientIp, rateLimitedResponse } from '../../rateLimit.js'
import { jsonResponse } from '../../utils/responses.js'
import { clearCookieHeader, cookieFrom, HOST_COOKIE, HOST_COOKIE_PATH, isSecure, setCookieHeader } from './hostCookies'

type HostEnv = Pick<Env, 'PICKLEBALL_DB' | 'RATE_LIMITER'>

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,128}$/

function loginToken(request: Request): string | null {
  const token = cookieFrom(request, HOST_COOKIE)
  return token && TOKEN_PATTERN.test(token) ? token : null
}

/** The signed-in host, or null when the cookie is missing, malformed, expired, signed out or its account deleted. */
export async function currentHost(env: HostEnv, request: Request, now = new Date().toISOString()): Promise<HostRecord | null> {
  const token = loginToken(request)
  return token ? findHostByLogin(env.PICKLEBALL_DB, await sha256Base64Url(token), now) : null
}

/** Starts a login for this browser. Returns the Set-Cookie header to send. */
export async function beginHostLogin(env: HostEnv, request: Request, hostId: string, now = new Date().toISOString()): Promise<string> {
  const token = randomBase64Url(32)
  await createHostLogin(env.PICKLEBALL_DB, { tokenHash: await sha256Base64Url(token), hostId, now })
  return setCookieHeader(HOST_COOKIE, token, { path: HOST_COOKIE_PATH, maxAgeSeconds: Math.floor(LOGIN_TTL_MS / 1000), secure: isSecure(request) })
}

/** Ends this browser's login, if any. Returns the Set-Cookie header that clears it. */
export async function endHostLogin(env: HostEnv, request: Request): Promise<string> {
  const token = loginToken(request)
  if (token) await deleteHostLogin(env.PICKLEBALL_DB, await sha256Base64Url(token))
  return clearCookieHeader(HOST_COOKIE, { path: HOST_COOKIE_PATH, secure: isSecure(request) })
}

export const signInFirst = (): Response => jsonResponse({ error: 'Sign in with Google first.' }, 401)

/**
 * Per-IP limit on the host-account routes (me, sessions, reopen, sign-out).
 * 120 per minute: a club's Wi-Fi is one address. Fails open like every
 * read-mostly limiter here; the routes behind it need a valid login anyway.
 */
export async function hostAccountIpLimited(env: HostEnv, request: Request): Promise<Response | null> {
  const rate = await checkRateLimit(env, 'open-host-account', clientIp(request), { limit: 120, windowMs: 60_000 })
  return rate.limited ? rateLimitedResponse('Too many requests. Try again shortly.', rate.retryAfterSeconds) : null
}

/** Per-IP limit on starting and finishing a sign-in: 20 per 10 minutes. */
export async function signInIpLimited(env: HostEnv, request: Request): Promise<Response | null> {
  const rate = await checkRateLimit(env, 'open-host-signin', clientIp(request), { limit: 20, windowMs: 10 * 60_000 })
  return rate.limited ? rateLimitedResponse('Too many sign-in attempts. Try again in a few minutes.', rate.retryAfterSeconds) : null
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/worker/pickleball/open/hostSession.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Add the schemas and the routes**

`src/lib/schemas/pickleball/open/host.ts`:

```ts
import { z } from 'zod'

const email = z.string().trim().toLowerCase().max(254).regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)

/** The env-gated test login (spec §13): stands in for Google's verified profile. */
export const testLoginSchema = z.object({
  email,
  name: z.string().trim().min(1).max(80).optional(),
  marketingOptIn: z.boolean().optional(),
})

/**
 * A DUPR Club ID as the host types it: letters, digits and dashes, 3 to 20
 * long. DUPR does not publish its format, so this only keeps junk out; it is
 * shown back in the export email and never sent to DUPR by us.
 */
export const DUPR_CLUB_ID_PATTERN = /^[A-Za-z0-9-]{3,20}$/

/** PATCH /api/pickleball/open/host/me: either field, or both. */
export const hostProfilePatchSchema = z.object({
  duprClubId: z.string().trim().regex(DUPR_CLUB_ID_PATTERN).nullable().optional(),
  marketingOptIn: z.boolean().optional(),
}).refine((patch) => patch.duprClubId !== undefined || patch.marketingOptIn !== undefined)

/** POST /api/pickleball/open/s/{code}/dupr-export. The zone is the host's device's, for game dates. */
export const duprExportRequestSchema = z.object({
  timeZone: z.string().max(64).optional(),
})

export type HostProfilePatch = z.infer<typeof hostProfilePatchSchema>
```

`src/pages/api/pickleball/open/host/test-login.ts`:

```ts
import type { APIRoute } from 'astro'
import { getEnv } from '../../../../../lib/env'
import { drainRequestBody } from '../../../../../lib/http'
import { testLoginSchema } from '../../../../../lib/schemas/pickleball/open/host'
import { toHostProfile, upsertHost } from '../../../../../worker/repositories/pickleball/open/hosts'
import { beginHostLogin, signInIpLimited } from '../../../../../worker/pickleball/open/hostSession'
import { openErrorResponse } from '../../../../../worker/pickleball/open/routeHelpers'
import { crossSiteRefusal } from '../../../../../worker/pickleball/open/sameOrigin'
import { jsonResponse } from '../../../../../worker/utils/responses.js'

// Test-only stand-in for Google sign-in (spec §13), so Playwright can reach a
// signed-in host with no Google account. Answers only when
// PICKLEBALL_TEST_AUTH_ENABLED is exactly 'true': set in .dev.vars for local
// e2e, never in wrangler.jsonc's committed vars.
export const POST: APIRoute = async ({ request }) => {
  const env = getEnv()
  if (env.PICKLEBALL_TEST_AUTH_ENABLED !== 'true') {
    await drainRequestBody(request)
    return jsonResponse({ error: 'Not found.' }, 404)
  }
  try {
    const refused = crossSiteRefusal(request) ?? (await signInIpLimited(env, request))
    if (refused) {
      await drainRequestBody(request)
      return refused
    }
    const parsed = testLoginSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return jsonResponse({ error: 'Give an email address.' }, 400)
    const now = new Date().toISOString()
    const { email, name, marketingOptIn } = parsed.data
    const host = await upsertHost(env.PICKLEBALL_DB, {
      googleSub: `test-${email}`, email, displayName: name ?? email, marketingOptIn: marketingOptIn ?? false,
    }, { now, newId: () => crypto.randomUUID() })
    const cookie = await beginHostLogin(env, request, host.id, now)
    return jsonResponse({ host: toHostProfile(host) }, 200, { 'Set-Cookie': cookie })
  } catch (error) {
    return openErrorResponse(error, 'host.test-login')
  }
}
```

`src/pages/api/pickleball/open/host/me.ts`:

```ts
import type { APIRoute } from 'astro'
import { getEnv } from '../../../../../lib/env'
import { drainRequestBody } from '../../../../../lib/http'
import { hostProfilePatchSchema } from '../../../../../lib/schemas/pickleball/open/host'
import { toHostProfile, updateHostProfile } from '../../../../../worker/repositories/pickleball/open/hosts'
import { currentHost, hostAccountIpLimited, signInFirst } from '../../../../../worker/pickleball/open/hostSession'
import { openErrorResponse } from '../../../../../worker/pickleball/open/routeHelpers'
import { crossSiteRefusal } from '../../../../../worker/pickleball/open/sameOrigin'
import { jsonResponse } from '../../../../../worker/utils/responses.js'

/** The signed-in host's own profile, or { host: null }. Never the Google subject id. */
export const GET: APIRoute = async ({ request }) => {
  const env = getEnv()
  try {
    const limited = await hostAccountIpLimited(env, request)
    if (limited) return limited
    const host = await currentHost(env, request)
    return jsonResponse({ host: host ? toHostProfile(host) : null }, 200)
  } catch (error) {
    return openErrorResponse(error, 'host.me')
  }
}

const MAX_BODY_BYTES = 1024

/** Saves the DUPR Club ID (spec §9.3) and/or the marketing choice. */
export const PATCH: APIRoute = async ({ request }) => {
  const env = getEnv()
  try {
    const refused = crossSiteRefusal(request) ?? (await hostAccountIpLimited(env, request))
    if (refused || Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) {
      await drainRequestBody(request)
      return refused ?? jsonResponse({ error: 'That request is too large.' }, 413)
    }
    const parsed = hostProfilePatchSchema.safeParse(await request.json().catch(() => null))
    const host = await currentHost(env, request)
    if (!host) return signInFirst()
    if (!parsed.success) return jsonResponse({ error: 'A DUPR Club ID is 3 to 20 letters, digits or dashes.' }, 400)
    const updated = await updateHostProfile(env.PICKLEBALL_DB, host.id, parsed.data)
    return updated ? jsonResponse({ host: toHostProfile(updated) }, 200) : signInFirst()
  } catch (error) {
    return openErrorResponse(error, 'host.me.patch')
  }
}
```

`src/pages/api/pickleball/open/host/sign-out.ts`:

```ts
import type { APIRoute } from 'astro'
import { getEnv } from '../../../../../lib/env'
import { drainRequestBody } from '../../../../../lib/http'
import { endHostLogin, hostAccountIpLimited } from '../../../../../worker/pickleball/open/hostSession'
import { openErrorResponse } from '../../../../../worker/pickleball/open/routeHelpers'
import { crossSiteRefusal } from '../../../../../worker/pickleball/open/sameOrigin'
import { jsonResponse } from '../../../../../worker/utils/responses.js'

/** Ends this browser's host login. Other devices stay signed in. */
export const POST: APIRoute = async ({ request }) => {
  const env = getEnv()
  try {
    await drainRequestBody(request)
    const refused = crossSiteRefusal(request) ?? (await hostAccountIpLimited(env, request))
    if (refused) return refused
    return jsonResponse({ signedOut: true }, 200, { 'Set-Cookie': await endHostLogin(env, request) })
  } catch (error) {
    return openErrorResponse(error, 'host.sign-out')
  }
}
```

These live under `/api/pickleball/open/`, so `src/middleware.ts` already lets them through without the old operator session (its `PICKLEBALL_OPEN_PREFIX` exclusion); do not add them to `PICKLEBALL_PUBLIC_ROUTES`.

- [ ] **Step 6: Typecheck and lint**

Run: `npm run typecheck && npx eslint src/worker/pickleball/open src/pages/api/pickleball/open src/lib/schemas/pickleball/open`
Expected: 0 errors.

- [ ] **Step 7: Commit**

Add under `### Added` in `## [Unreleased]`:

```markdown
- Free sessions: host login plumbing. The `devlab_pb_host` cookie holds an opaque token (only its hash is stored; HttpOnly, Secure, SameSite=Lax, scoped to `/api/pickleball/open`), every write that trusts it must come from this site, `GET`/`PATCH /api/pickleball/open/host/me` read and update the profile (DUPR Club ID, news opt-in), `POST …/host/sign-out` ends the login, and `POST …/host/test-login` stands in for Google when `PICKLEBALL_TEST_AUTH_ENABLED=true`.
```

```bash
git add src/worker/pickleball/open/hostCookies.ts src/worker/pickleball/open/sameOrigin.ts src/worker/pickleball/open/hostSession.ts src/worker/pickleball/open/hostSession.test.ts src/lib/schemas/pickleball/open/host.ts src/pages/api/pickleball/open/host CHANGELOG.md
git commit -m "feat(pickleball): host login cookie, same-origin guard and test login"
```

---

### Task 5: Google sign-in on the registered callback

**Files:**
- Create: `src/worker/pickleball/open/hostAuth.ts`
- Create: `src/pages/api/pickleball/open/host/sign-in.ts`
- Modify: `src/pages/api/pickleball/auth/google/callback.ts`
- Test: `src/worker/pickleball/open/hostAuth.test.ts`, `src/worker/pickleball/open/phase5Safety.test.ts`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: `generatePkcePair`, `buildGoogleAuthorizationUrl`, `exchangeGoogleCode`, `fetchGoogleProfile` (`src/worker/pickleball/oauth.js`); `normalizePublicCode`; Task 1's `upsertHost`; Task 4's cookie helpers, `beginHostLogin`, `signInIpLimited`, `currentHost`.
- Produces: `SignInResult = 'ok' | 'cancelled' | 'unverified' | 'failed' | 'busy' | 'unavailable'`, `CALLBACK_PATH`, `DEFAULT_RETURN_PATH` (`'/pickleball/my-sessions'`), `GoogleDeps { exchange; profile }`, `safeReturnPath(raw): string`, `withSignInResult(path, result)`, `startHostSignIn(env, request): Promise<Response>`, `hasHostSignInPending(request): boolean`, `finishHostSignIn(env, request, deps?): Promise<Response>`. Route `GET /api/pickleball/open/host/sign-in?return=…&optIn=1` → 302.

- [ ] **Step 1: Write the failing tests**

`src/worker/pickleball/open/hostAuth.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { createSqliteD1 } from '../../repositories/pickleball/open/testing/sqliteD1'
import { finishHostSignIn, hasHostSignInPending, safeReturnPath, startHostSignIn, type GoogleDeps } from './hostAuth'
import { currentHost } from './hostSession'

const MIGRATIONS = ['0016_open_sessions', '0017_open_captains', '0018_open_tournaments', '0019_hosts'].map((m) => `migrations/pickleball/${m}.sql`)
const BASE = 'https://www.devlabstudios.com'

function makeEnv(overrides: Partial<Env> = {}) {
  const { d1, raw } = createSqliteD1(MIGRATIONS)
  const env = {
    PICKLEBALL_DB: d1, GOOGLE_OAUTH_CLIENT_ID: 'client-id', GOOGLE_OAUTH_CLIENT_SECRET: 'secret',
    PICKLEBALL_OAUTH_REDIRECT_BASE_URL: BASE, ...overrides,
  } as unknown as Env
  return { env, raw }
}

const setCookies = (response: Response) => response.headers.getSetCookie()
const cookieValue = (header: string) => header.split(';')[0]

async function started(env: Env, query = '?return=/pickleball/s/ABCDE23456&optIn=1') {
  const response = await startHostSignIn(env, new Request(`${BASE}/api/pickleball/open/host/sign-in${query}`))
  const google = new URL(response.headers.get('Location') ?? '')
  return { response, google, stash: cookieValue(setCookies(response)[0]), state: google.searchParams.get('state') ?? '' }
}

function callback(stash: string | null, query: string) {
  return new Request(`${BASE}/api/pickleball/auth/google/callback${query}`, { headers: stash ? { Cookie: stash } : {} })
}

const google = (profile: Partial<Awaited<ReturnType<GoogleDeps['profile']>>> = {}): GoogleDeps => ({
  exchange: vi.fn().mockResolvedValue({ accessToken: 'token' }),
  profile: vi.fn().mockResolvedValue({ sub: 'g-123', email: 'Mo@Example.com', emailVerified: true, name: 'Mo', picture: '', ...profile }),
})

describe('safeReturnPath', () => {
  it('allows only a session page or My sessions', () => {
    expect(safeReturnPath('/pickleball/s/ABCDE23456')).toBe('/pickleball/s/ABCDE23456')
    expect(safeReturnPath('/pickleball/my-sessions')).toBe('/pickleball/my-sessions')
    for (const bad of ['https://evil.example', '//evil.example', '/pickleball/s/ABCDE23456?x=1', '/pickleball/s/abcde23456', '/pickleball/s/ABCDE2345I', '/admin', null, 42]) {
      expect(safeReturnPath(bad), String(bad)).toBe('/pickleball/my-sessions')
    }
  })
})

describe('startHostSignIn', () => {
  it('sends the host to Google with PKCE, the registered callback and an account picker', async () => {
    const { env } = makeEnv()
    const { response, google: url, stash } = await started(env)
    expect(response.status).toBe(302)
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(url.searchParams.get('redirect_uri')).toBe(`${BASE}/api/pickleball/auth/google/callback`)
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('scope')).toBe('openid email profile')
    expect(url.searchParams.get('prompt')).toBe('select_account')
    expect(stash.startsWith('devlab_pb_host_oauth=')).toBe(true)
    expect(setCookies(response)[0]).toContain('Path=/api/pickleball/auth/google; Max-Age=600; HttpOnly; SameSite=Lax; Secure')
  })

  it('goes straight back with ?signin=unavailable when Google is not configured', async () => {
    const { env } = makeEnv({ GOOGLE_OAUTH_CLIENT_ID: 'REPLACE_ME' })
    const response = await startHostSignIn(env, new Request(`${BASE}/api/pickleball/open/host/sign-in?return=/pickleball/s/ABCDE23456`))
    expect(response.headers.get('Location')).toBe('/pickleball/s/ABCDE23456?signin=unavailable')
    expect(response.headers.getSetCookie()).toEqual([])
  })
})

describe('finishHostSignIn', () => {
  it('creates the host with the opt-in they ticked, signs them in and returns them to their session', async () => {
    const { env, raw } = makeEnv()
    const { stash, state } = await started(env)
    const deps = google()
    const response = await finishHostSignIn(env, callback(stash, `?code=abc&state=${state}`), deps)
    expect(response.headers.get('Location')).toBe('/pickleball/s/ABCDE23456?signin=ok')
    const [clearStash, login] = setCookies(response)
    expect(clearStash).toContain('devlab_pb_host_oauth=; Path=/api/pickleball/auth/google; Max-Age=0')
    expect(login).toMatch(/^devlab_pb_host=/)
    expect(deps.exchange).toHaveBeenCalledWith(expect.objectContaining({ code: 'abc', redirectUri: `${BASE}/api/pickleball/auth/google/callback` }))
    const host = await currentHost(env, new Request(`${BASE}/api/pickleball/open/host/me`, { headers: { Cookie: cookieValue(login) } }))
    expect(host).toMatchObject({ googleSub: 'g-123', email: 'mo@example.com', displayName: 'Mo', marketingOptIn: true })
    expect((raw.prepare('SELECT COUNT(*) AS n FROM hosts').get() as { n: number }).n).toBe(1)
  })

  it('opt-in stays off when the box was not ticked', async () => {
    const { env } = makeEnv()
    const { stash, state } = await started(env, '?return=/pickleball/my-sessions')
    const response = await finishHostSignIn(env, callback(stash, `?code=abc&state=${state}`), google())
    expect(response.headers.get('Location')).toBe('/pickleball/my-sessions?signin=ok')
    const host = await currentHost(env, new Request(`${BASE}/x`, { headers: { Cookie: cookieValue(setCookies(response)[1]) } }))
    expect(host?.marketingOptIn).toBe(false)
  })

  it('refuses an unverified Google email and stores nothing', async () => {
    const { env, raw } = makeEnv()
    const { stash, state } = await started(env)
    const response = await finishHostSignIn(env, callback(stash, `?code=abc&state=${state}`), google({ emailVerified: false }))
    expect(response.headers.get('Location')).toBe('/pickleball/s/ABCDE23456?signin=unverified')
    expect(setCookies(response)).toHaveLength(1)
    expect((raw.prepare('SELECT COUNT(*) AS n FROM hosts').get() as { n: number }).n).toBe(0)
  })

  it('a wrong state, a missing stash, a cancelled consent and a Google failure each say so', async () => {
    const { env } = makeEnv()
    const { stash, state } = await started(env)
    expect((await finishHostSignIn(env, callback(stash, '?code=abc&state=forged'), google())).headers.get('Location')).toBe('/pickleball/s/ABCDE23456?signin=failed')
    expect((await finishHostSignIn(env, callback(null, `?code=abc&state=${state}`), google())).headers.get('Location')).toBe('/pickleball/my-sessions?signin=failed')
    expect((await finishHostSignIn(env, callback(stash, '?error=access_denied'), google())).headers.get('Location')).toBe('/pickleball/s/ABCDE23456?signin=cancelled')
    const broken: GoogleDeps = { exchange: vi.fn().mockRejectedValue(new Error('Google OAuth code exchange failed.')), profile: vi.fn() }
    expect((await finishHostSignIn(env, callback(stash, `?code=abc&state=${state}`), broken)).headers.get('Location')).toBe('/pickleball/s/ABCDE23456?signin=failed')
  })

  it('knows when a host sign-in is in flight', async () => {
    const { env } = makeEnv()
    const { stash } = await started(env)
    expect(hasHostSignInPending(callback(stash, ''))).toBe(true)
    expect(hasHostSignInPending(callback('devlab_pb_oauth=x', ''))).toBe(false)
  })
})
```

`src/worker/pickleball/open/phase5Safety.test.ts` reads every source file of the free-session worker, its repositories, its routes, the DUPR engine and the host screens, so files added by later tasks are checked as they land:

```ts
// Phase 5 deletes the old operator app (spec §12) and keeps only oauth.js of
// its auth code. Host sign-in, the claim and the DUPR export must therefore
// import nothing Phase 5 deletes. This reads every file of the free-session
// worker, its repositories, its routes and the DUPR engine, so files added
// later are checked as they land.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOTS = [
  'src/worker/pickleball/open',
  'src/worker/repositories/pickleball/open',
  'src/pages/api/pickleball/open',
  'src/lib/pickleball/open/dupr',
  'src/pickleball-open/host',
]
const DELETED = /pickleball\/(session|authContext|permissions|quota|inviteEmail|SessionCoordinatorDO)(\.js|\.ts)?$|repositories\/pickleball\/(users|memberships|organizationInvites)(\.js)?$|pickleball-app\//

/** Every source file under dir; none while a later task has yet to create it. */
function files(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return files(path)
    return /\.(ts|js|jsx)$/.test(name) && !/\.test\.(ts|js)$/.test(name) ? [path] : []
  })
}

describe('Phase 4 survives Phase 5', () => {
  for (const root of ROOTS) {
    it(`nothing under ${root} imports code Phase 5 deletes`, () => {
      for (const file of files(join(process.cwd(), root))) {
        const source = readFileSync(file, 'utf8')
        for (const [, specifier] of source.matchAll(/from ['"]([^'"]+)['"]/g)) {
          expect(DELETED.test(specifier), `${file} imports ${specifier}`).toBe(false)
        }
      }
    })
  }

  it('the host flow reuses oauth.js, the one old auth file Phase 5 keeps', () => {
    const source = readFileSync(join(process.cwd(), 'src/worker/pickleball/open/hostAuth.ts'), 'utf8')
    expect(source).toContain("from '../oauth.js'")
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/worker/pickleball/open/hostAuth.test.ts src/worker/pickleball/open/phase5Safety.test.ts`
Expected: FAIL — `Failed to resolve import "./hostAuth"`, and the oauth.js check fails with `ENOENT … hostAuth.ts`.

- [ ] **Step 3: Write the sign-in**

`src/worker/pickleball/open/hostAuth.ts`:

```ts
// Google sign-in for hosts (spec §9.1). Reuses oauth.js (PKCE), the one file of
// the old app that Phase 5 keeps (§12). The callback path is the one already
// registered with Google, /api/pickleball/auth/google/callback; callback.ts
// hands every host sign-in to finishHostSignIn below.
import { normalizePublicCode } from '../../../lib/pickleball/open/codes'
import { randomBase64Url } from '../../../lib/pickleball/webCrypto.js'
import { upsertHost } from '../../repositories/pickleball/open/hosts'
import { buildGoogleAuthorizationUrl, exchangeGoogleCode, fetchGoogleProfile, generatePkcePair } from '../oauth.js'
import { clearCookieHeader, cookieFrom, HOST_OAUTH_COOKIE, HOST_OAUTH_COOKIE_PATH, isSecure, setCookieHeader } from './hostCookies'
import { beginHostLogin, signInIpLimited } from './hostSession'

/** How a sign-in ended, added to the return path as ?signin=… for the page to explain. */
export type SignInResult = 'ok' | 'cancelled' | 'unverified' | 'failed' | 'busy' | 'unavailable'

export const CALLBACK_PATH = '/api/pickleball/auth/google/callback'
export const DEFAULT_RETURN_PATH = '/pickleball/my-sessions'
const STASH_MAX_AGE_SECONDS = 600
// wrangler.jsonc once shipped this literal until real credentials existed (see auth/google/start.ts).
const CLIENT_ID_PLACEHOLDER = 'REPLACE_ME'

interface Stash { verifier: string; state: string; returnTo: string; optIn: boolean }

type AuthEnv = Pick<Env, 'PICKLEBALL_DB' | 'RATE_LIMITER' | 'GOOGLE_OAUTH_CLIENT_ID' | 'GOOGLE_OAUTH_CLIENT_SECRET' | 'PICKLEBALL_OAUTH_REDIRECT_BASE_URL'>

export interface GoogleDeps {
  exchange: typeof exchangeGoogleCode
  profile: typeof fetchGoogleProfile
}
const GOOGLE: GoogleDeps = { exchange: exchangeGoogleCode, profile: fetchGoogleProfile }

/**
 * Where a sign-in may send the browser back to: a session's board or console,
 * or My sessions. Anything else (another site, another path, a query string)
 * falls back to My sessions, so the return path can never be an open redirect.
 */
export function safeReturnPath(raw: unknown): string {
  if (raw === DEFAULT_RETURN_PATH) return raw
  const match = typeof raw === 'string' ? /^\/pickleball\/s\/([A-Za-z0-9]{10})$/.exec(raw) : null
  const code = match ? normalizePublicCode(match[1]) : null
  return code && code === match?.[1] ? `/pickleball/s/${code}` : DEFAULT_RETURN_PATH
}

export function withSignInResult(path: string, result: SignInResult): string {
  return `${path}?signin=${result}`
}

function configured(env: AuthEnv): boolean {
  const id = env.GOOGLE_OAUTH_CLIENT_ID
  return Boolean(id && id !== CLIENT_ID_PLACEHOLDER && env.GOOGLE_OAUTH_CLIENT_SECRET && env.PICKLEBALL_OAUTH_REDIRECT_BASE_URL)
}

function redirect(location: string, cookies: string[]): Response {
  const headers = new Headers({ Location: location, 'Cache-Control': 'no-store' })
  for (const cookie of cookies) headers.append('Set-Cookie', cookie)
  return new Response(null, { status: 302, headers })
}

/** GET /api/pickleball/open/host/sign-in?return=…&optIn=1 → Google. */
export async function startHostSignIn(env: AuthEnv, request: Request): Promise<Response> {
  const url = new URL(request.url)
  const returnTo = safeReturnPath(url.searchParams.get('return'))
  if (await signInIpLimited(env, request)) return redirect(withSignInResult(returnTo, 'busy'), [])
  if (!configured(env)) return redirect(withSignInResult(returnTo, 'unavailable'), [])

  const { verifier, challenge } = await generatePkcePair()
  const state = randomBase64Url(24)
  const google = new URL(buildGoogleAuthorizationUrl({
    clientId: env.GOOGLE_OAUTH_CLIENT_ID,
    redirectUri: `${env.PICKLEBALL_OAUTH_REDIRECT_BASE_URL}${CALLBACK_PATH}`,
    state,
    codeChallenge: challenge,
    scopes: ['openid', 'email', 'profile'],
  }))
  // A shared phone at the court: let the host pick which Google account.
  google.searchParams.set('prompt', 'select_account')
  const stash: Stash = { verifier, state, returnTo, optIn: url.searchParams.get('optIn') === '1' }
  return redirect(google.toString(), [
    setCookieHeader(HOST_OAUTH_COOKIE, encodeURIComponent(JSON.stringify(stash)), {
      path: HOST_OAUTH_COOKIE_PATH, maxAgeSeconds: STASH_MAX_AGE_SECONDS, secure: isSecure(request),
    }),
  ])
}

function readStash(request: Request): Stash | null {
  try {
    const value = JSON.parse(decodeURIComponent(cookieFrom(request, HOST_OAUTH_COOKIE) ?? '')) as Partial<Stash>
    if (typeof value.verifier !== 'string' || typeof value.state !== 'string') return null
    return { verifier: value.verifier, state: value.state, returnTo: safeReturnPath(value.returnTo), optIn: value.optIn === true }
  } catch {
    return null
  }
}

/** True while a host sign-in is in flight in this browser. */
export function hasHostSignInPending(request: Request): boolean {
  return cookieFrom(request, HOST_OAUTH_COOKIE) !== null
}

/**
 * Google's redirect back. Every outcome is a redirect to the page the host
 * started from with ?signin=…, never a raw error body. Only a verified Google
 * email is ever stored: the export is mailed to it (spec §9.6).
 */
export async function finishHostSignIn(env: AuthEnv, request: Request, deps: GoogleDeps = GOOGLE): Promise<Response> {
  const url = new URL(request.url)
  const stash = readStash(request)
  const returnTo = stash?.returnTo ?? DEFAULT_RETURN_PATH
  const clear = clearCookieHeader(HOST_OAUTH_COOKIE, { path: HOST_OAUTH_COOKIE_PATH, secure: isSecure(request) })
  const back = (result: SignInResult, extra: string[] = []) => redirect(withSignInResult(returnTo, result), [clear, ...extra])

  if (url.searchParams.get('error')) return back('cancelled')
  const code = url.searchParams.get('code')
  if (!stash || !code || url.searchParams.get('state') !== stash.state) return back('failed')
  if (await signInIpLimited(env, request)) return back('busy')
  if (!configured(env)) return back('unavailable')

  try {
    const { accessToken } = await deps.exchange({
      code, codeVerifier: stash.verifier,
      clientId: env.GOOGLE_OAUTH_CLIENT_ID, clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      redirectUri: `${env.PICKLEBALL_OAUTH_REDIRECT_BASE_URL}${CALLBACK_PATH}`,
    })
    const profile = await deps.profile(accessToken)
    if (!profile.emailVerified || !profile.sub || !profile.email) return back('unverified')
    const now = new Date().toISOString()
    const email = String(profile.email).trim().toLowerCase()
    const host = await upsertHost(env.PICKLEBALL_DB, {
      googleSub: String(profile.sub), email,
      displayName: String(profile.name || email).trim().slice(0, 80) || email,
      marketingOptIn: stash.optIn,
    }, { now, newId: () => crypto.randomUUID() })
    return back('ok', [await beginHostLogin(env, request, host.id, now)])
  } catch (error) {
    // The reason is for the logs only; the host just sees "sign-in failed".
    console.log(JSON.stringify({ event: 'pickleball_open.host_signin_failed', error: error instanceof Error ? error.message : 'unknown' }))
    return back('failed')
  }
}
```

`src/pages/api/pickleball/open/host/sign-in.ts`:

```ts
import type { APIRoute } from 'astro'
import { getEnv } from '../../../../../lib/env'
import { DEFAULT_RETURN_PATH, startHostSignIn, withSignInResult } from '../../../../../worker/pickleball/open/hostAuth'

/** A top-level navigation from the DUPR sheet or My sessions: always answers with a redirect. */
export const GET: APIRoute = async ({ request }) => {
  try {
    return await startHostSignIn(getEnv(), request)
  } catch (error) {
    console.log(JSON.stringify({ event: 'pickleball_open.host_signin_start_failed', error: error instanceof Error ? error.message : 'unknown' }))
    return new Response(null, { status: 302, headers: { Location: withSignInResult(DEFAULT_RETURN_PATH, 'failed') } })
  }
}
```

- [ ] **Step 4: Hand host sign-ins to it from the registered callback**

The old operator code is left as it is, renamed `legacyOperatorCallback`; Phase 5 deletes it.

In `src/pages/api/pickleball/auth/google/callback.ts`, find:

```ts
import { jsonResponse } from '../../../../../worker/utils/responses.js'
```

Replace it with:

```ts
import { jsonResponse } from '../../../../../worker/utils/responses.js'
import { finishHostSignIn, hasHostSignInPending } from '../../../../../worker/pickleball/open/hostAuth'
import { cookieFrom } from '../../../../../worker/pickleball/open/hostCookies'
```

In `src/pages/api/pickleball/auth/google/callback.ts`, find:

```ts
export const GET: APIRoute = async ({ request }) => {
  const env = getEnv()
  const url = new URL(request.url)
```

Replace it with:

```ts
// The callback Google redirects to is registered once and cannot move (spec
// §9.1), so this one route serves both sign-ins. A free-session host sign-in
// (open/host/sign-in) owns it whenever its own in-flight cookie is present, or
// when neither flow's cookie is (an expired attempt then lands on My sessions
// with "sign-in failed" rather than a raw JSON error). Phase 5 deletes the old
// operator app: it then deletes legacyOperatorCallback and every import only
// it uses, and GET becomes a one-line call to finishHostSignIn.
export const GET: APIRoute = async (context) => {
  const { request } = context
  if (hasHostSignInPending(request) || cookieFrom(request, OAUTH_COOKIE_NAME) === null) {
    return finishHostSignIn(getEnv(), request)
  }
  return legacyOperatorCallback(context)
}

const legacyOperatorCallback: APIRoute = async ({ request }) => {
  const env = getEnv()
  const url = new URL(request.url)
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/worker/pickleball/open`
Expected: PASS — the 8 sign-in tests, the Phase 5 guard (6 tests) and every existing test in the folder.

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 6: Commit**

Add under `### Added` in `## [Unreleased]`:

```markdown
- Free sessions: Google sign-in for hosts (`GET /api/pickleball/open/host/sign-in`), reusing `oauth.js` (PKCE) and the already-registered `/api/pickleball/auth/google/callback`, which now hands host sign-ins to the new flow. Only verified Google emails are stored, the news opt-in ticked beside the button is applied when the account is created, and every outcome returns to the page the host started from with `?signin=…`.
```

```bash
git add src/worker/pickleball/open/hostAuth.ts src/worker/pickleball/open/hostAuth.test.ts src/worker/pickleball/open/phase5Safety.test.ts src/pages/api/pickleball/open/host/sign-in.ts src/pages/api/pickleball/auth/google/callback.ts CHANGELOG.md
git commit -m "feat(pickleball): google sign-in for session hosts"
```

---

### Task 6: Linking a session, the DUPR panel, My sessions and reopening

**Files:**
- Create: `src/lib/pickleball/open/dupr/policy.ts`
- Modify: `src/worker/pickleball/open/OpenSessionDO.ts`
- Create: `src/pages/api/pickleball/open/s/[code]/claim.ts`
- Create: `src/pages/api/pickleball/open/s/[code]/dupr.ts`
- Create: `src/pages/api/pickleball/open/host/sessions.ts`
- Create: `src/pages/api/pickleball/open/host/sessions/[code]/reopen.ts`
- Test: `src/lib/pickleball/open/dupr/policy.test.ts`, `tests/e2e/pickleball/open-host.spec.js` (created here; later tasks append)
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: Task 1's `loadHostAccess`, `claimSession`, `insertHostKey`, `recentDuprExports`, `MAX_EXTRA_HOST_KEYS`, `listHostSessions`, `toHostProfile`; Task 2's `buildDuprExport`, `normalizeTimeZone`, `DuprSkip`; Task 4's `currentHost`, `signInFirst`, `hostAccountIpLimited`, `crossSiteRefusal`; `routeHelpers.ts` (`codeFrom`, `doResponse`, `hostIpLimited`, `hostKeyFrom`, `notFound`, `openErrorResponse`, `openSessionStub`).
- Produces:
  - `policy.ts`: `DUPR_EXPORT_LIMIT` (5), `DUPR_EXPORT_WINDOW_MS` (24 h), `ClaimState = 'UNCLAIMED' | 'MINE' | 'OTHER'`, `claimStateFor(sessionHostId, signedInHostId)`, `exportWindowStart(now)`, `exportsLeft(sentAt)`, `hoursUntilNextExport(sentAt, now)`, `limitMessage(sentAt, now)`.
  - `OpenSessionDO`: `DuprStatusBody { claim; exported; skipped; missingIds; exportsLeft; exportLimit }`; the private cache becomes `Cached = LoadedSession & { access: HostAccess }`; `isHost` accepts the original key or any extra key; RPC `duprStatus(code, hostKey, hostId | null, timeZone)`, `claim(code, hostKey, hostId)` → `{ claim }`, `reopen(code, hostId)` → 201 `{ hostKey }`.
  - Routes: `GET /api/pickleball/open/s/{code}/dupr?tz=` (host key; cookie optional) → `{ host: HostProfile | null, ...DuprStatusBody }`; `POST …/s/{code}/claim` (host key + cookie); `GET /api/pickleball/open/host/sessions` → `{ sessions: HostSessionSummary[] }`; `POST /api/pickleball/open/host/sessions/{code}/reopen` → 201 `{ hostKey }`.

- [ ] **Step 1: Write the failing unit test**

`src/lib/pickleball/open/dupr/policy.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { claimStateFor, DUPR_EXPORT_LIMIT, exportsLeft, exportWindowStart, hoursUntilNextExport, limitMessage } from './policy'

describe('claimStateFor', () => {
  it('is unclaimed, mine, or someone else’s (including when signed out)', () => {
    expect(claimStateFor(null, null)).toBe('UNCLAIMED')
    expect(claimStateFor(null, 'h1')).toBe('UNCLAIMED')
    expect(claimStateFor('h1', 'h1')).toBe('MINE')
    expect(claimStateFor('h1', 'h2')).toBe('OTHER')
    expect(claimStateFor('h1', null)).toBe('OTHER')
  })
})

describe('the 5-a-day limit', () => {
  const now = '2026-10-12T12:00:00.000Z'
  it('counts exports in the last 24 hours', () => {
    expect(DUPR_EXPORT_LIMIT).toBe(5)
    expect(exportWindowStart(now)).toBe('2026-10-11T12:00:00.000Z')
    expect(exportsLeft([])).toBe(5)
    expect(exportsLeft(['a', 'b', 'c', 'd', 'e', 'f'])).toBe(0)
  })

  it('says when the next export frees up', () => {
    const sent = ['2026-10-11T14:30:00.000Z', '2026-10-12T09:00:00.000Z']
    expect(hoursUntilNextExport(sent, now)).toBe(3)
    expect(hoursUntilNextExport(['2026-10-11T12:30:00.000Z'], now)).toBe(1)
    expect(limitMessage(sent, now)).toBe('A session can be sent to DUPR 5 times a day. Try again in about 3 hours.')
    expect(limitMessage(['2026-10-11T12:30:00.000Z'], now)).toBe('A session can be sent to DUPR 5 times a day. Try again in about 1 hour.')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/pickleball/open/dupr/policy.test.ts`
Expected: FAIL — `Failed to resolve import "./policy"`.

- [ ] **Step 3: Write the policy**

`src/lib/pickleball/open/dupr/policy.ts`:

```ts
// Who may export a session to DUPR, and how often (spec §9.2, §9.6). Pure.

/** Exports are limited to 5 per session in any 24 hours. */
export const DUPR_EXPORT_LIMIT = 5
export const DUPR_EXPORT_WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * The session's claim as one host sees it: nobody has claimed it, they have,
 * or another account has (which is also what a signed-out host sees for a
 * claimed session: they must sign in with that account).
 */
export type ClaimState = 'UNCLAIMED' | 'MINE' | 'OTHER'

export function claimStateFor(sessionHostId: string | null, signedInHostId: string | null): ClaimState {
  if (!sessionHostId) return 'UNCLAIMED'
  return sessionHostId === signedInHostId ? 'MINE' : 'OTHER'
}

/** The start of the window that counts toward the limit. */
export function exportWindowStart(now: string): string {
  return new Date(Date.parse(now) - DUPR_EXPORT_WINDOW_MS).toISOString()
}

/** How many exports are left, given when the ones in the window were sent. */
export function exportsLeft(sentAt: readonly string[]): number {
  return Math.max(0, DUPR_EXPORT_LIMIT - sentAt.length)
}

/** Whole hours until the oldest counted export leaves the window (at least 1). */
export function hoursUntilNextExport(sentAt: readonly string[], now: string): number {
  const oldest = sentAt.reduce((min, at) => (at < min ? at : min), sentAt[0] ?? now)
  return Math.max(1, Math.ceil((Date.parse(oldest) + DUPR_EXPORT_WINDOW_MS - Date.parse(now)) / 3_600_000))
}

export function limitMessage(sentAt: readonly string[], now: string): string {
  const hours = hoursUntilNextExport(sentAt, now)
  return `A session can be sent to DUPR ${DUPR_EXPORT_LIMIT} times a day. Try again in about ${hours} hour${hours === 1 ? '' : 's'}.`
}
```

Run: `npx vitest run src/lib/pickleball/open/dupr/policy.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 4: Give the Durable Object host access**

The session's host access is loaded with the session and kept beside it. Only the claim, reopen and (Task 7) export methods change it, each with its own statement, so `persistDiff` and the snapshots are untouched.

In `src/worker/pickleball/open/OpenSessionDO.ts`, find:

```ts
import { applyCheckIn } from '../../../lib/pickleball/open/checkIn'
```

Replace it with:

```ts
import { applyCheckIn } from '../../../lib/pickleball/open/checkIn'
import { buildDuprExport, normalizeTimeZone, type DuprSkip } from '../../../lib/pickleball/open/dupr/export'
import { claimStateFor, DUPR_EXPORT_LIMIT, exportsLeft, exportWindowStart, type ClaimState } from '../../../lib/pickleball/open/dupr/policy'
```

In `src/worker/pickleball/open/OpenSessionDO.ts`, find:

```ts
} from '../../repositories/pickleball/open/openSessions'
```

Replace it with:

```ts
} from '../../repositories/pickleball/open/openSessions'
import { claimSession, insertHostKey, loadHostAccess, MAX_EXTRA_HOST_KEYS, recentDuprExports, type HostAccess } from '../../repositories/pickleball/open/hostAccess'
```

In `src/worker/pickleball/open/OpenSessionDO.ts`, find:

```ts
export interface CaptainLinkBody { captainId: string; label: string; captainKey: string; host: HostSnapshot }
```

Replace it with:

```ts
export interface CaptainLinkBody { captainId: string; label: string; captainKey: string; host: HostSnapshot }
/** The host's DUPR panel (spec §9): never part of any snapshot, so viewers and captains never get it. */
export interface DuprStatusBody {
  claim: ClaimState
  exported: number
  skipped: DuprSkip[]
  missingIds: Array<{ id: string; name: string }>
  exportsLeft: number
  exportLimit: number
}

/** The session plus who, beyond the original host key, may act as its host (spec §9.2, §9.5). */
type Cached = LoadedSession & { access: HostAccess }
```

In `src/worker/pickleball/open/OpenSessionDO.ts`, find:

```ts
  private loaded: LoadedSession | null = null
```

Replace it with:

```ts
  private loaded: Cached | null = null
```

In `src/worker/pickleball/open/OpenSessionDO.ts`, find:

```ts
  private async load(code: string): Promise<LoadedSession | null> {
    // A request routed to the wrong coordinator must never load (or cache) another session's state.
    if (!this.ctx.id.equals(this.env.OPEN_SESSION.idFromName(code))) return null
    const now = new Date().toISOString()
    if (this.loaded && this.loaded.state.publicCode === code && this.loaded.state.expiresAt > now) return this.loaded
    this.loaded = await loadOpenSession(this.env.PICKLEBALL_DB, code, now)
    return this.loaded
  }

  private async isHost(loaded: LoadedSession, hostKey: string | null): Promise<boolean> {
    if (!hostKey) return false
    return constantTimeEqual(await sha256Base64Url(hostKey), loaded.hostKeyHash)
  }
```

Replace it with:

```ts
  private async load(code: string): Promise<Cached | null> {
    // A request routed to the wrong coordinator must never load (or cache) another session's state.
    if (!this.ctx.id.equals(this.env.OPEN_SESSION.idFromName(code))) return null
    const now = new Date().toISOString()
    if (this.loaded && this.loaded.state.publicCode === code && this.loaded.state.expiresAt > now) return this.loaded
    const loaded = await loadOpenSession(this.env.PICKLEBALL_DB, code, now)
    this.loaded = loaded ? { ...loaded, access: await loadHostAccess(this.env.PICKLEBALL_DB, loaded.state.id) } : null
    return this.loaded
  }

  /** The original host key, or an extra host link minted by reopen(). Every hash is compared, so timing says nothing. */
  private async isHost(loaded: Cached, hostKey: string | null): Promise<boolean> {
    if (!hostKey) return false
    const hash = await sha256Base64Url(hostKey)
    return [loaded.hostKeyHash, ...loaded.access.extraKeyHashes].reduce((match, known) => constantTimeEqual(hash, known) || match, false)
  }
```

In `src/worker/pickleball/open/OpenSessionDO.ts`, find:

```ts
  private async actorFor(loaded: LoadedSession, credentials: Credentials)
```

Replace it with:

```ts
  private async actorFor(loaded: Cached, credentials: Credentials)
```

In `src/worker/pickleball/open/OpenSessionDO.ts`, find:

```ts
  private async authorized(code: string, hostKey: string | null): Promise<LoadedSession | DoResult<never>> {
```

Replace it with:

```ts
  private async authorized(code: string, hostKey: string | null): Promise<Cached | DoResult<never>> {
```

In `src/worker/pickleball/open/OpenSessionDO.ts`, find:

```ts
  /** Called by the purge cron after it deleted this session's rows. */
```

Replace it with:

```ts
  /** The host's DUPR panel: claim, what would be exported and why games are left out, exports left today. */
  async duprStatus(code: string, hostKey: string | null, hostId: string | null, timeZone: string): Promise<DoResult<DuprStatusBody>> {
    return this.serial(async () => {
      const auth = await this.authorized(code, hostKey)
      if (!('state' in auth)) return auth
      const preview = buildDuprExport(auth.state, { timeZone: normalizeTimeZone(timeZone) })
      const sent = await recentDuprExports(this.env.PICKLEBALL_DB, auth.state.id, exportWindowStart(new Date().toISOString()))
      return {
        status: 200,
        body: {
          claim: claimStateFor(auth.access.hostId, hostId), exported: preview.exported, skipped: preview.skipped,
          missingIds: preview.missingIds, exportsLeft: exportsLeft(sent), exportLimit: DUPR_EXPORT_LIMIT,
        },
      }
    })
  }

  /** Links the session to a signed-in host: once, and only for whoever holds the host key (spec §9.2). */
  async claim(code: string, hostKey: string | null, hostId: string): Promise<DoResult<{ claim: ClaimState }>> {
    return this.serial(async () => {
      const auth = await this.authorized(code, hostKey)
      if (!('state' in auth)) return auth
      const current = claimStateFor(auth.access.hostId, hostId)
      if (current === 'MINE') return { status: 200, body: { claim: current } }
      if (current === 'OTHER') return { status: 409, body: { error: 'This session is already linked to another Google account.' } }
      if (!(await claimSession(this.env.PICKLEBALL_DB, auth.state.id, hostId))) {
        return { status: 409, body: { error: 'Your sign-in has ended. Sign in again and retry.' } }
      }
      this.loaded = { ...auth, access: { ...auth.access, hostId } }
      return { status: 200, body: { claim: 'MINE' } }
    })
  }

  /** A fresh host link for the account that claimed this session: the lost-link recovery path (spec §9.5). */
  async reopen(code: string, hostId: string): Promise<DoResult<{ hostKey: string }>> {
    return this.serial(async () => {
      const loaded = await this.load(code)
      if (!loaded) return { status: 404, body: { error: 'Session not found.' } }
      if (loaded.access.hostId !== hostId) return { status: 403, body: { error: 'This session is not linked to your account.' } }
      if (loaded.access.extraKeyHashes.length >= MAX_EXTRA_HOST_KEYS) {
        return { status: 409, body: { error: `This session already has ${MAX_EXTRA_HOST_KEYS} extra host links. Open it on a device you used before.` } }
      }
      const hostKey = randomBase64Url(16)
      const keyHash = await sha256Base64Url(hostKey)
      await insertHostKey(this.env.PICKLEBALL_DB, { id: crypto.randomUUID(), sessionId: loaded.state.id, keyHash, createdAt: new Date().toISOString() })
      this.loaded = { ...loaded, access: { ...loaded.access, extraKeyHashes: [...loaded.access.extraKeyHashes, keyHash] } }
      return { status: 201, body: { hostKey } }
    })
  }

  /** Called by the purge cron after it deleted this session's rows. */
```

- [ ] **Step 5: Add the routes**

`src/pages/api/pickleball/open/s/[code]/claim.ts`:

```ts
import type { APIRoute } from 'astro'
import { getEnv } from '../../../../../../lib/env'
import { drainRequestBody } from '../../../../../../lib/http'
import { currentHost, signInFirst } from '../../../../../../worker/pickleball/open/hostSession'
import { codeFrom, doResponse, hostIpLimited, hostKeyFrom, notFound, openErrorResponse, openSessionStub } from '../../../../../../worker/pickleball/open/routeHelpers'
import { crossSiteRefusal } from '../../../../../../worker/pickleball/open/sameOrigin'

/** Links this session to the signed-in Google account (spec §9.2). Needs the host key AND the host cookie. */
export const POST: APIRoute = async ({ request, params }) => {
  const env = getEnv()
  try {
    await drainRequestBody(request)
    const refused = crossSiteRefusal(request) ?? (await hostIpLimited(env, request))
    if (refused) return refused
    const code = codeFrom(params)
    if (!code) return notFound()
    const host = await currentHost(env, request)
    if (!host) return signInFirst()
    return doResponse(await openSessionStub(env, code).claim(code, hostKeyFrom(request), host.id))
  } catch (error) {
    return openErrorResponse(error, 'claim')
  }
}
```

`src/pages/api/pickleball/open/s/[code]/dupr.ts`:

```ts
import type { APIRoute } from 'astro'
import { getEnv } from '../../../../../../lib/env'
import { toHostProfile } from '../../../../../../worker/repositories/pickleball/open/hosts'
import { currentHost } from '../../../../../../worker/pickleball/open/hostSession'
import { codeFrom, hostIpLimited, hostKeyFrom, notFound, openErrorResponse, openSessionStub } from '../../../../../../worker/pickleball/open/routeHelpers'
import { jsonResponse } from '../../../../../../worker/utils/responses.js'

/**
 * The host console's DUPR panel (spec §9): who is signed in, whether the
 * session is linked to them, what would go to DUPR and why games are left
 * out. Needs the host key; the cookie is optional (signed out is a state the
 * panel explains). ?tz= is the host device's time zone, for game dates.
 */
export const GET: APIRoute = async ({ request, params }) => {
  const env = getEnv()
  try {
    const limited = await hostIpLimited(env, request)
    if (limited) return limited
    const code = codeFrom(params)
    if (!code) return notFound()
    const host = await currentHost(env, request)
    const timeZone = new URL(request.url).searchParams.get('tz') ?? 'UTC'
    const result = await openSessionStub(env, code).duprStatus(code, hostKeyFrom(request), host?.id ?? null, timeZone)
    if (result.status !== 200 || !('claim' in result.body)) return jsonResponse(result.body, result.status)
    return jsonResponse({ host: host ? toHostProfile(host) : null, ...result.body }, 200)
  } catch (error) {
    return openErrorResponse(error, 'dupr')
  }
}
```

`src/pages/api/pickleball/open/host/sessions.ts`:

```ts
import type { APIRoute } from 'astro'
import { getEnv } from '../../../../../lib/env'
import { listHostSessions } from '../../../../../worker/repositories/pickleball/open/hosts'
import { currentHost, hostAccountIpLimited, signInFirst } from '../../../../../worker/pickleball/open/hostSession'
import { openErrorResponse } from '../../../../../worker/pickleball/open/routeHelpers'
import { jsonResponse } from '../../../../../worker/utils/responses.js'

/** My sessions (spec §9.5): the signed-in host's claimed, unexpired sessions. */
export const GET: APIRoute = async ({ request }) => {
  const env = getEnv()
  try {
    const limited = await hostAccountIpLimited(env, request)
    if (limited) return limited
    const host = await currentHost(env, request)
    if (!host) return signInFirst()
    return jsonResponse({ sessions: await listHostSessions(env.PICKLEBALL_DB, host.id, new Date().toISOString()) }, 200)
  } catch (error) {
    return openErrorResponse(error, 'host.sessions')
  }
}
```

`src/pages/api/pickleball/open/host/sessions/[code]/reopen.ts`:

```ts
import type { APIRoute } from 'astro'
import { getEnv } from '../../../../../../../lib/env'
import { drainRequestBody } from '../../../../../../../lib/http'
import { currentHost, hostAccountIpLimited, signInFirst } from '../../../../../../../worker/pickleball/open/hostSession'
import { codeFrom, doResponse, notFound, openErrorResponse, openSessionStub } from '../../../../../../../worker/pickleball/open/routeHelpers'
import { crossSiteRefusal } from '../../../../../../../worker/pickleball/open/sameOrigin'

/** A fresh host link for a session this account claimed (spec §9.5): the lost-link recovery path. */
export const POST: APIRoute = async ({ request, params }) => {
  const env = getEnv()
  try {
    await drainRequestBody(request)
    const refused = crossSiteRefusal(request) ?? (await hostAccountIpLimited(env, request))
    if (refused) return refused
    const host = await currentHost(env, request)
    if (!host) return signInFirst()
    const code = codeFrom(params)
    if (!code) return notFound()
    return doResponse(await openSessionStub(env, code).reopen(code, host.id))
  } catch (error) {
    return openErrorResponse(error, 'host.reopen')
  }
}
```

Run: `npm run typecheck && npx vitest run src/worker src/lib/pickleball/open`
Expected: 0 type errors; all tests pass.

- [ ] **Step 6: Write the e2e tests**

`tests/e2e/pickleball/open-host.spec.js` (later tasks add imports, a helper and one `describe` block each):

```js
// Google-verified hosts and the DUPR export (spec §9), end to end against the
// real Worker, Durable Object and local D1. Google itself is replaced by the
// env-gated test login (spec §13): POST /api/pickleball/open/host/test-login
// answers only when PICKLEBALL_TEST_AUTH_ENABLED=true (.dev.vars), and with
// that flag on the export is never emailed: the response carries the outbox.
import { test, expect } from '@playwright/test'

const ROSTER = [
  { name: 'Ana', duprId: 'AAA111' }, { name: 'Ben', duprId: 'BBB222' }, { name: 'Cy', duprId: 'CCC333' },
  { name: 'Di', duprId: 'DDD444' }, { name: 'Eve' },
]

// Creation is limited per IP per day and the host routes per minute, and every
// local request shares one address, so each test claims its own (see open-play.spec.js).
const freshIp = () => `10.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 254) + 1}`
const testIp = new Map()
const ipFor = (key) => testIp.get(key) ?? testIp.set(key, freshIp()).get(key)
const uniqueEmail = (who) => `${who}-${crypto.randomUUID().slice(0, 8)}@example.com`

async function createSession(request, name = 'Saturday Social') {
  const response = await request.post('/api/pickleball/open/sessions', {
    headers: { 'cf-connecting-ip': freshIp() },
    data: { name, hostDisplayName: 'Coach Mo', courtCount: 1, settings: { mode: 'PADDLE_STACK', target: 11, scoringStyle: 'SIDEOUT' }, players: ROSTER },
  })
  expect(response.status()).toBe(201)
  return response.json()
}

/** Every write to a host route says where it came from, as a browser would. */
const writeHeaders = (baseURL, code, extra = {}) => ({ Origin: baseURL, 'cf-connecting-ip': ipFor(code), ...extra })

async function signIn(request, baseURL, email, key = email) {
  const response = await request.post('/api/pickleball/open/host/test-login', {
    headers: writeHeaders(baseURL, key), data: { email, name: 'Coach Mo' },
  })
  expect(response.status(), await response.text()).toBe(200)
  return (await response.json()).host
}

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

/** Plays one game on Court 1 with exactly these teams and score. */
async function play(request, code, hostKey, teamA, teamB, scoreA, scoreB) {
  let host = (await (await request.get(`/api/pickleball/open/s/${code}/host`, { headers: { 'X-Host-Key': hostKey, 'cf-connecting-ip': ipFor(code) } })).json())
  const id = (name) => host.players.find((p) => p.name === name).id
  const match = host.courts[0].match
  host = await ok(request, code, hostKey, { type: 'EDIT_PROPOSAL', matchId: match.id, teamA: teamA.map(id), teamB: teamB.map(id) })
  await ok(request, code, hostKey, { type: 'START_MATCH', matchId: match.id })
  return ok(request, code, hostKey, { type: 'RECORD_RESULT', matchId: match.id, winner: scoreA > scoreB ? 'A' : 'B', scoreA, scoreB })
}

const dupr = (request, code, hostKey, tz = 'UTC') =>
  request.get(`/api/pickleball/open/s/${code}/dupr?tz=${encodeURIComponent(tz)}`, { headers: { 'X-Host-Key': hostKey, 'cf-connecting-ip': ipFor(code) } })
const claim = (request, baseURL, code, hostKey, headers = {}) =>
  request.post(`/api/pickleball/open/s/${code}/claim`, { headers: writeHeaders(baseURL, code, { 'X-Host-Key': hostKey, ...headers }) })
const setClubId = (request, baseURL, key, duprClubId = '12345') =>
  request.patch('/api/pickleball/open/host/me', { headers: writeHeaders(baseURL, key), data: { duprClubId } })

/** A session linked to a freshly signed-in host with a Club ID and one exportable game. */
async function readyToExport(request, baseURL) {
  const session = await createSession(request)
  const email = uniqueEmail('mo')
  await signIn(request, baseURL, email, session.code)
  expect((await setClubId(request, baseURL, session.code)).status()).toBe(200)
  expect((await claim(request, baseURL, session.code, session.hostKey)).status()).toBe(200)
  await play(request, session.code, session.hostKey, ['Ana', 'Ben'], ['Cy', 'Di'], 11, 7)
  return { ...session, email }
}

test.describe('linking a session, and My sessions (API)', () => {
  test('a session is linked once: another account, a wrong host key and no sign-in are all refused', async ({ request, playwright, baseURL }) => {
    const { code, hostKey } = await readyToExport(request, baseURL)
    const other = await playwright.request.newContext({ baseURL })
    await signIn(other, baseURL, uniqueEmail('bo'), `${code}-bo`)
    expect((await setClubId(other, baseURL, `${code}-bo`)).status()).toBe(200)
    const taken = await claim(other, baseURL, code, hostKey)
    expect(taken.status()).toBe(409)
    expect((await taken.json()).error).toBe('This session is already linked to another Google account.')
    expect((await (await dupr(other, code, hostKey)).json()).claim).toBe('OTHER')

    expect((await claim(request, baseURL, code, 'not-the-host-key-at-all')).status()).toBe(403)
    const stranger = await playwright.request.newContext({ baseURL })
    expect((await claim(stranger, baseURL, code, hostKey)).status()).toBe(401)
    expect((await (await dupr(stranger, code, hostKey)).json())).toMatchObject({ host: null, claim: 'OTHER' })
    expect((await dupr(stranger, code, 'wrong-key-wrong-key')).status()).toBe(403)
    await other.dispose()
    await stranger.dispose()
  })

  test('My sessions lists linked sessions only, and reopens one with a new host link that leaves the old one working', async ({ request, playwright, baseURL }) => {
    const { code, hostKey } = await readyToExport(request, baseURL)
    const unlinked = await createSession(request, 'Not linked')
    const list = await (await request.get('/api/pickleball/open/host/sessions', { headers: { 'cf-connecting-ip': ipFor(code) } })).json()
    expect(list.sessions.map((s) => s.code)).toEqual([code])
    expect(list.sessions.map((s) => s.code)).not.toContain(unlinked.code)
    expect(list.sessions[0]).toMatchObject({ name: 'Saturday Social', kind: 'OPEN_PLAY', status: 'ACTIVE' })

    const reopened = await request.post(`/api/pickleball/open/host/sessions/${code}/reopen`, { headers: writeHeaders(baseURL, code) })
    expect(reopened.status()).toBe(201)
    const { hostKey: freshKey } = await reopened.json()
    expect(freshKey).not.toBe(hostKey)
    for (const key of [freshKey, hostKey]) {
      expect((await request.get(`/api/pickleball/open/s/${code}/host`, { headers: { 'X-Host-Key': key, 'cf-connecting-ip': ipFor(code) } })).status()).toBe(200)
    }
    expect((await command(request, code, freshKey, { type: 'SET_SELF_CHECK_IN', enabled: false })).status()).toBe(200)

    const other = await playwright.request.newContext({ baseURL })
    await signIn(other, baseURL, uniqueEmail('bo'), `${code}-bo`)
    expect((await other.post(`/api/pickleball/open/host/sessions/${code}/reopen`, { headers: writeHeaders(baseURL, `${code}-bo`) })).status()).toBe(403)
    expect((await (await other.get('/api/pickleball/open/host/sessions', { headers: { 'cf-connecting-ip': ipFor(`${code}-bo`) } })).json()).sessions).toEqual([])
    const stranger = await playwright.request.newContext({ baseURL })
    expect((await stranger.get('/api/pickleball/open/host/sessions')).status()).toBe(401)
    await other.dispose()
    await stranger.dispose()
  })

  test('sign-in never leaves the site except for Google, and the registered callback belongs to host sign-in', async ({ request }) => {
    const { code } = await createSession(request)
    const start = await request.get(`/api/pickleball/open/host/sign-in?return=/pickleball/s/${code}`, { maxRedirects: 0 })
    expect(start.status()).toBe(302)
    const location = start.headers()['location']
    if (location.startsWith('/')) {
      // No GOOGLE_OAUTH_CLIENT_SECRET in this environment: the host is sent straight back with a reason.
      expect(location).toBe(`/pickleball/s/${code}?signin=unavailable`)
    } else {
      const google = new URL(location)
      expect(google.origin + google.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
      expect(google.searchParams.get('redirect_uri')).toMatch(/\/api\/pickleball\/auth\/google\/callback$/)
    }
    const offsite = await request.get('/api/pickleball/open/host/sign-in?return=https://evil.example/', { maxRedirects: 0 })
    expect(offsite.headers()['location']).not.toContain('evil.example')

    const callback = await request.get('/api/pickleball/auth/google/callback?code=x&state=y', { maxRedirects: 0 })
    expect(callback.status()).toBe(302)
    expect(callback.headers()['location']).toBe('/pickleball/my-sessions?signin=failed')
  })
})
```

- [ ] **Step 7: Run them**

Stop any stale local server first (see Global Constraints), then:

Run: `npx playwright test tests/e2e/pickleball/open-host.spec.js --project=worker`
Expected: PASS (3 tests). The sign-in test takes its first branch locally when `.dev.vars` has no `GOOGLE_OAUTH_CLIENT_SECRET`; both branches are correct.

Run: `npx playwright test tests/e2e/pickleball/open-play.spec.js tests/e2e/pickleball/open-tournament.spec.js --project=worker`
Expected: PASS: the host-key check now also accepts extra keys, and nothing else in the console changed.

- [ ] **Step 8: Commit**

Add under `### Added` in `## [Unreleased]`:

```markdown
- Free sessions: whoever holds a session's host key can link it to their Google account, once (`POST /api/pickleball/open/s/{code}/claim`); the host's DUPR panel reads its status (`GET …/s/{code}/dupr`: claim, what would be exported, every left-out game and why, exports left today); a signed-in host lists their linked sessions (`GET /api/pickleball/open/host/sessions`) and reopens one from any device with a fresh host link that leaves the original working (`POST …/host/sessions/{code}/reopen`).
```

```bash
git add src/lib/pickleball/open/dupr/policy.ts src/lib/pickleball/open/dupr/policy.test.ts src/worker/pickleball/open/OpenSessionDO.ts "src/pages/api/pickleball/open/s/[code]/claim.ts" "src/pages/api/pickleball/open/s/[code]/dupr.ts" src/pages/api/pickleball/open/host/sessions.ts "src/pages/api/pickleball/open/host/sessions/[code]/reopen.ts" tests/e2e/pickleball/open-host.spec.js CHANGELOG.md
git commit -m "feat(pickleball): link a session to its host, my sessions and reopen"
```

---

### Task 7: Emailing the export

**Files:**
- Modify: `src/worker/delivery/providers.js`
- Create: `src/worker/pickleball/open/duprExport.ts`
- Modify: `src/worker/pickleball/open/OpenSessionDO.ts`
- Create: `src/pages/api/pickleball/open/s/[code]/dupr-export.ts`
- Test: `src/worker/delivery/providers.test.js`, `src/worker/pickleball/open/duprExport.test.ts`, `tests/e2e/pickleball/open-host.spec.js`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: `createResendProvider` (extended here, backward compatible: lead delivery keeps calling it as before); Task 1's `insertDuprExport`, `deleteDuprExport`; Task 2's `buildDuprEmail`, `duprFilename`, `localDate`, `DuprEmail`; Task 6's policy and DO cache; Task 4's `duprExportRequestSchema`, `currentHost`, `signInFirst`, `crossSiteRefusal`.
- Produces:
  - `createResendProvider(env, { name?, fromName? })`; `send({ to, replyTo?, subject, text, html, attachments? })` where `attachments` is Resend's `[{ filename, content }]` (base64).
  - `duprExport.ts`: `DuprOutbox { to; subject; text; filename; csv }`, `DuprDelivery = { delivery: 'SENT' } | { delivery: 'SUPPRESSED'; outbox } | { delivery: 'FAILED'; reason }`, `base64Utf8(text)`, `sendDuprExport(env, { to, email, filename, csv })`.
  - `OpenSessionDO`: `DuprPrepared { exportId; csv; filename; email; exported; skipped; exportsLeft }`; RPC `prepareDuprExport(code, hostKey, { id, displayName, duprClubId }, timeZone)` (409 unclaimed, 403 another account's, 409 nothing to send, 429 over the limit), `releaseDuprExport(code, hostKey, exportId)`.
  - Route `POST /api/pickleball/open/s/{code}/dupr-export` `{ timeZone? }` (host key + cookie + Club ID) → `{ delivery, to, exported, skipped, exportsLeft, outbox? }`; 409 "Add your DUPR Club ID first."; 502 when sending failed (the export is released).

- [ ] **Step 1: Write the failing unit tests**

`src/worker/delivery/providers.test.js`:

```js
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createResendProvider } from './providers.js'

afterEach(() => vi.unstubAllGlobals())

function stubFetch(response = { ok: true, status: 200, json: async () => ({ id: 'email-1' }) }) {
  const fetch = vi.fn().mockResolvedValue(response)
  vi.stubGlobal('fetch', fetch)
  return fetch
}

const sentBody = (fetch) => JSON.parse(fetch.mock.calls[0][1].body)

describe('createResendProvider', () => {
  it('keeps the studio sender and sends no attachments key by default', async () => {
    const fetch = stubFetch()
    const result = await createResendProvider({ RESEND_API_KEY: 'k', RESEND_FROM_EMAIL: 'hello@devlabstudios.com' })
      .send({ to: 'a@example.com', subject: 's', text: 't', html: 'h' })
    expect(result).toEqual({ ok: true, statusCode: 200 })
    expect(sentBody(fetch)).toEqual({ from: 'DevLab Studios <hello@devlabstudios.com>', to: ['a@example.com'], subject: 's', text: 't', html: 'h' })
  })

  it('names another sender and passes attachments and reply-to through', async () => {
    const fetch = stubFetch()
    await createResendProvider({ RESEND_API_KEY: 'k' }, { name: 'resend-dupr', fromName: 'Devlab Pickleball' })
      .send({ to: 'a@example.com', replyTo: 'hello@devlabstudios.com', subject: 's', text: 't', html: 'h', attachments: [{ filename: 'x.csv', content: 'YQ==' }] })
    expect(sentBody(fetch)).toMatchObject({
      from: 'Devlab Pickleball <hello@devlabstudios.com>', reply_to: 'hello@devlabstudios.com',
      attachments: [{ filename: 'x.csv', content: 'YQ==' }],
    })
  })

  it('reports an upstream refusal without throwing', async () => {
    stubFetch({ ok: false, status: 422, json: async () => ({ message: 'Invalid attachment' }) })
    const result = await createResendProvider({ RESEND_API_KEY: 'k' }).send({ to: 'a@example.com', subject: 's', text: 't', html: 'h' })
    expect(result).toEqual({ ok: false, statusCode: 422, networkError: false, errorMessage: 'Invalid attachment' })
  })
})
```

`src/worker/pickleball/open/duprExport.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { base64Utf8, sendDuprExport } from './duprExport'

afterEach(() => vi.unstubAllGlobals())

const email = { subject: 'DUPR export: Sunday (2026-10-12)', text: 'Hi Mo', html: '<p>Hi Mo</p>' }
const message = { to: 'mo@example.com', email, filename: 'dupr-sunday-2026-10-12.csv', csv: 'matchType,event\r\nD,Café' }

describe('sendDuprExport', () => {
  it('attaches the CSV as base64 and sends from Devlab Pickleball with a reply-to', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 'e1' }) })
    vi.stubGlobal('fetch', fetch)
    const result = await sendDuprExport({ RESEND_API_KEY: 'k', RESEND_FROM_EMAIL: 'hello@devlabstudios.com' }, message)
    expect(result).toEqual({ delivery: 'SENT' })
    const body = JSON.parse(fetch.mock.calls[0][1].body)
    expect(body).toMatchObject({
      from: 'Devlab Pickleball <hello@devlabstudios.com>', to: ['mo@example.com'], reply_to: 'hello@devlabstudios.com',
      subject: email.subject, text: email.text, html: email.html,
      attachments: [{ filename: 'dupr-sunday-2026-10-12.csv', content: base64Utf8(message.csv) }],
    })
    expect(new TextDecoder().decode(Uint8Array.from(atob(body.attachments[0].content), (c) => c.charCodeAt(0)))).toBe(message.csv)
  })

  it('never emails anyone in a test environment, and hands the message back instead', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const result = await sendDuprExport({ RESEND_API_KEY: 'k', PICKLEBALL_TEST_AUTH_ENABLED: 'true' }, message)
    expect(fetch).not.toHaveBeenCalled()
    expect(result).toEqual({ delivery: 'SUPPRESSED', outbox: { to: 'mo@example.com', subject: email.subject, text: 'Hi Mo', filename: message.filename, csv: message.csv } })
  })

  it('fails cleanly with no API key, or when Resend refuses', async () => {
    expect(await sendDuprExport({}, message)).toEqual({ delivery: 'FAILED', reason: 'missing_api_key' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 422, json: async () => ({ message: 'Invalid' }) }))
    expect(await sendDuprExport({ RESEND_API_KEY: 'k' }, message)).toEqual({ delivery: 'FAILED', reason: 'Invalid' })
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/worker/delivery/providers.test.js src/worker/pickleball/open/duprExport.test.ts`
Expected: FAIL — the custom sender name and the attachments never reach the request body, and `./duprExport` does not resolve.

- [ ] **Step 3: Extend the provider and write the sender**

In `src/worker/delivery/providers.js`, find:

```js
/** Transactional email via Resend — the studio's existing provider. */
export function createResendProvider(env, { name = 'resend' } = {}) {
```

Replace it with:

```js
/**
 * Transactional email via Resend — the studio's existing provider.
 * `fromName` labels the sender (Devlab Pickleball mail says so); `attachments`
 * are Resend's `{ filename, content }` with base64 content.
 */
export function createResendProvider(env, { name = 'resend', fromName = 'DevLab Studios' } = {}) {
```

In `src/worker/delivery/providers.js`, find:

```js
    async send({ to, replyTo, subject, text, html }) {
```

Replace it with:

```js
    async send({ to, replyTo, subject, text, html, attachments }) {
```

In `src/worker/delivery/providers.js`, find:

```js
          from: `DevLab Studios <${fromEmail}>`,
```

Replace it with:

```js
          from: `${fromName} <${fromEmail}>`,
```

In `src/worker/delivery/providers.js`, find:

```js
          subject,
          text,
          html,
        }),
      })

      if (error) {
        return { ok: false, statusCode: null, networkError: true, errorMessage: error.message }
      }

      // Only the id is read back.
```

Replace it with:

```js
          subject,
          text,
          html,
          ...(attachments?.length ? { attachments } : {}),
        }),
      })

      if (error) {
        return { ok: false, statusCode: null, networkError: true, errorMessage: error.message }
      }

      // Only the id is read back.
```

`src/worker/pickleball/open/duprExport.ts`:

```ts
// Sends the DUPR export to the host's verified Google email (spec §9.6),
// through the studio's existing Resend provider, with the CSV attached.
// The CSV and the email text are built by the pure modules in
// src/lib/pickleball/open/dupr/; this file only delivers them.
import type { DuprEmail } from '../../../lib/pickleball/open/dupr/email'
import { createResendProvider } from '../../delivery/providers.js'

const DEFAULT_SENDER = 'hello@devlabstudios.com'

export interface DuprOutbox { to: string; subject: string; text: string; filename: string; csv: string }

export type DuprDelivery =
  | { delivery: 'SENT' }
  /** Test environments never email anyone; the message comes back for the test to read instead. */
  | { delivery: 'SUPPRESSED'; outbox: DuprOutbox }
  | { delivery: 'FAILED'; reason: string }

type MailEnv = Pick<Env, 'RESEND_API_KEY' | 'RESEND_FROM_EMAIL' | 'PICKLEBALL_TEST_AUTH_ENABLED'>

/** Standard base64 of the UTF-8 bytes, which is what Resend expects for attachment content. */
export function base64Utf8(text: string): string {
  let binary = ''
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export async function sendDuprExport(
  env: MailEnv,
  message: { to: string; email: DuprEmail; filename: string; csv: string },
): Promise<DuprDelivery> {
  // An environment that accepts forged logins must not email real people
  // (the same rule as the old invite email): the e2e suite reads the outbox.
  if (env.PICKLEBALL_TEST_AUTH_ENABLED === 'true') {
    return { delivery: 'SUPPRESSED', outbox: { to: message.to, subject: message.email.subject, text: message.email.text, filename: message.filename, csv: message.csv } }
  }
  const provider = createResendProvider(env, { name: 'resend-dupr', fromName: 'Devlab Pickleball' })
  if (!provider.isConfigured) {
    console.log(JSON.stringify({ event: 'pickleball_open.dupr_email', outcome: 'skipped', reason: 'missing_api_key' }))
    return { delivery: 'FAILED', reason: 'missing_api_key' }
  }
  const result = await provider.send({
    to: message.to,
    // Hosts report a refused upload by replying (spec §9.4).
    replyTo: env.RESEND_FROM_EMAIL || DEFAULT_SENDER,
    subject: message.email.subject,
    text: message.email.text,
    html: message.email.html,
    attachments: [{ filename: message.filename, content: base64Utf8(message.csv) }],
  })
  // The recipient is deliberately absent from the log: it is personal data, and the outcome is diagnosable without it.
  console.log(JSON.stringify({ event: 'pickleball_open.dupr_email', outcome: result.ok ? 'success' : 'failure', statusCode: result.statusCode, reason: result.errorMessage }))
  return result.ok ? { delivery: 'SENT' } : { delivery: 'FAILED', reason: result.errorMessage || 'send failed' }
}
```

Run: `npx vitest run src/worker/delivery src/worker/pickleball/open/duprExport.test.ts src/worker/inquiryService.test.js`
Expected: PASS, including the existing lead-delivery tests.

- [ ] **Step 4: Reserve and release exports in the Durable Object**

In `src/worker/pickleball/open/OpenSessionDO.ts`, find:

```ts
import { buildDuprExport, normalizeTimeZone, type DuprSkip } from '../../../lib/pickleball/open/dupr/export'
import { claimStateFor, DUPR_EXPORT_LIMIT, exportsLeft, exportWindowStart, type ClaimState } from '../../../lib/pickleball/open/dupr/policy'
```

Replace it with:

```ts
import { buildDuprEmail, duprFilename, type DuprEmail } from '../../../lib/pickleball/open/dupr/email'
import { buildDuprExport, localDate, normalizeTimeZone, type DuprSkip } from '../../../lib/pickleball/open/dupr/export'
import { claimStateFor, DUPR_EXPORT_LIMIT, exportsLeft, exportWindowStart, limitMessage, type ClaimState } from '../../../lib/pickleball/open/dupr/policy'
```

In `src/worker/pickleball/open/OpenSessionDO.ts`, find:

```ts
import { claimSession, insertHostKey, loadHostAccess, MAX_EXTRA_HOST_KEYS, recentDuprExports, type HostAccess } from '../../repositories/pickleball/open/hostAccess'
```

Replace it with:

```ts
import {
  claimSession, deleteDuprExport, insertDuprExport, insertHostKey, loadHostAccess, MAX_EXTRA_HOST_KEYS, recentDuprExports, type HostAccess,
} from '../../repositories/pickleball/open/hostAccess'
```

In `src/worker/pickleball/open/OpenSessionDO.ts`, find:

```ts
/** The session plus who, beyond the original host key, may act as its host (spec §9.2, §9.5). */
```

Replace it with:

```ts
/** A reserved export, ready to send. The reservation counts toward the limit until released. */
export interface DuprPrepared {
  exportId: string
  csv: string
  filename: string
  email: DuprEmail
  exported: number
  skipped: number
  exportsLeft: number
}

/** The session plus who, beyond the original host key, may act as its host (spec §9.2, §9.5). */
```

In `src/worker/pickleball/open/OpenSessionDO.ts`, find:

```ts
  /** Called by the purge cron after it deleted this session's rows. */
```

Replace it with:

```ts
  /**
   * Builds the export and reserves one of the day's 5 (spec §9.6). Only the
   * account the session is linked to may export it. The route sends the email
   * and calls releaseDuprExport if sending failed, so a failure costs nothing.
   */
  async prepareDuprExport(
    code: string, hostKey: string | null, host: { id: string; displayName: string; duprClubId: string }, timeZone: string,
  ): Promise<DoResult<DuprPrepared>> {
    return this.serial(async () => {
      const auth = await this.authorized(code, hostKey)
      if (!('state' in auth)) return auth
      const claim = claimStateFor(auth.access.hostId, host.id)
      if (claim === 'UNCLAIMED') return { status: 409, body: { error: 'Link this session to your Google account first.' } }
      if (claim === 'OTHER') return { status: 403, body: { error: 'Only the Google account this session is linked to can export it.' } }
      const zone = normalizeTimeZone(timeZone)
      const preview = buildDuprExport(auth.state, { timeZone: zone })
      if (!preview.exported) {
        return { status: 409, body: { error: 'No game can go to DUPR yet: each needs a score and a DUPR ID for all four players.' } }
      }
      const now = new Date().toISOString()
      const sent = await recentDuprExports(this.env.PICKLEBALL_DB, auth.state.id, exportWindowStart(now))
      if (!exportsLeft(sent)) return { status: 429, body: { error: limitMessage(sent, now) } }
      const exportId = crypto.randomUUID()
      await insertDuprExport(this.env.PICKLEBALL_DB, {
        id: exportId, sessionId: auth.state.id, sentAt: now, gameCount: preview.exported, skippedCount: preview.skipped.length,
      })
      const date = localDate(auth.state.createdAt, zone)
      return {
        status: 200,
        body: {
          exportId, csv: preview.csv, filename: duprFilename(auth.state.name, date),
          email: buildDuprEmail({
            hostName: host.displayName, sessionName: auth.state.name, date, clubId: host.duprClubId,
            exported: preview.exported, skipped: preview.skipped,
          }),
          exported: preview.exported, skipped: preview.skipped.length, exportsLeft: exportsLeft(sent) - 1,
        },
      }
    })
  }

  /** Gives back a reserved export whose email could not be sent. */
  async releaseDuprExport(code: string, hostKey: string | null, exportId: string): Promise<void> {
    return this.serial(async () => {
      const auth = await this.authorized(code, hostKey)
      if ('state' in auth) await deleteDuprExport(this.env.PICKLEBALL_DB, auth.state.id, exportId)
    })
  }

  /** Called by the purge cron after it deleted this session's rows. */
```

- [ ] **Step 5: Add the route**

`src/pages/api/pickleball/open/s/[code]/dupr-export.ts`:

```ts
import type { APIRoute } from 'astro'
import { getEnv } from '../../../../../../lib/env'
import { drainRequestBody } from '../../../../../../lib/http'
import { duprExportRequestSchema } from '../../../../../../lib/schemas/pickleball/open/host'
import { sendDuprExport } from '../../../../../../worker/pickleball/open/duprExport'
import { currentHost, signInFirst } from '../../../../../../worker/pickleball/open/hostSession'
import { codeFrom, hostIpLimited, hostKeyFrom, notFound, openErrorResponse, openSessionStub } from '../../../../../../worker/pickleball/open/routeHelpers'
import { crossSiteRefusal } from '../../../../../../worker/pickleball/open/sameOrigin'
import { jsonResponse } from '../../../../../../worker/utils/responses.js'

const MAX_BODY_BYTES = 1024

/**
 * Emails the DUPR CSV to the signed-in host's verified Google address (spec
 * §9.6). Needs the host key, the host cookie, a claim by that account and a
 * DUPR Club ID. A failed send gives the reserved export back.
 */
export const POST: APIRoute = async ({ request, params }) => {
  const env = getEnv()
  try {
    const refused = crossSiteRefusal(request) ?? (await hostIpLimited(env, request))
    const code = codeFrom(params)
    if (refused || !code || Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) {
      await drainRequestBody(request)
      return refused ?? (code ? jsonResponse({ error: 'That request is too large.' }, 413) : notFound())
    }
    const parsed = duprExportRequestSchema.safeParse(await request.json().catch(() => ({})))
    const host = await currentHost(env, request)
    if (!host) return signInFirst()
    if (!host.duprClubId) return jsonResponse({ error: 'Add your DUPR Club ID first.' }, 409)

    const stub = openSessionStub(env, code)
    const hostKey = hostKeyFrom(request)
    const prepared = await stub.prepareDuprExport(code, hostKey, { id: host.id, displayName: host.displayName, duprClubId: host.duprClubId },
      parsed.success ? parsed.data.timeZone ?? 'UTC' : 'UTC')
    if (prepared.status !== 200 || !('exportId' in prepared.body)) return jsonResponse(prepared.body, prepared.status)

    const { exportId, email, filename, csv, exported, skipped, exportsLeft } = prepared.body
    const sent = await sendDuprExport(env, { to: host.email, email, filename, csv })
    if (sent.delivery === 'FAILED') {
      await stub.releaseDuprExport(code, hostKey, exportId)
      return jsonResponse({ error: 'The email could not be sent. Nothing was used up; try again in a minute.' }, 502)
    }
    return jsonResponse({
      delivery: sent.delivery, to: host.email, exported, skipped, exportsLeft,
      ...(sent.delivery === 'SUPPRESSED' ? { outbox: sent.outbox } : {}),
    }, 200)
  } catch (error) {
    return openErrorResponse(error, 'dupr-export')
  }
}
```

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 6: Write the e2e tests**

In `tests/e2e/pickleball/open-host.spec.js`, find:

```js
import { test, expect } from '@playwright/test'

const ROSTER
```

Replace it with:

```js
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect } from '@playwright/test'

const TEMPLATE = readFileSync(join(process.cwd(), 'tests/fixtures/dupr-import-template.csv'), 'utf8').split(/\r?\n/)[0]
const ROSTER
```

In `tests/e2e/pickleball/open-host.spec.js`, find:

```js
const setClubId =
```

Replace it with:

```js
const exportDupr = (request, baseURL, code, hostKey, timeZone = 'UTC') =>
  request.post(`/api/pickleball/open/s/${code}/dupr-export`, { headers: writeHeaders(baseURL, code, { 'X-Host-Key': hostKey }), data: { timeZone } })
const setClubId =
```

Append to the end of `tests/e2e/pickleball/open-host.spec.js`:

```js
test.describe('the DUPR export (API)', () => {
  test('sign in, add a Club ID, link, then export: the CSV matches the DUPR template and the email lists what was left out', async ({ request, baseURL }) => {
    const { code, hostKey } = await createSession(request)
    const email = uniqueEmail('mo')
    const before = await (await dupr(request, code, hostKey)).json()
    expect(before).toMatchObject({ host: null, claim: 'UNCLAIMED', exported: 0, exportsLeft: 5, exportLimit: 5 })

    const host = await signIn(request, baseURL, email, code)
    expect(host).toEqual({ email, displayName: 'Coach Mo', duprClubId: null, marketingOptIn: false })
    expect(JSON.stringify(host)).not.toMatch(/sub|test-/)

    const noClub = await exportDupr(request, baseURL, code, hostKey)
    expect(noClub.status()).toBe(409)
    expect((await noClub.json()).error).toBe('Add your DUPR Club ID first.')
    expect((await setClubId(request, baseURL, code, 'bad id!')).status()).toBe(400)
    expect((await (await setClubId(request, baseURL, code, 'CLUB-42')).json()).host.duprClubId).toBe('CLUB-42')

    const unclaimed = await exportDupr(request, baseURL, code, hostKey)
    expect(unclaimed.status()).toBe(409)
    expect((await unclaimed.json()).error).toBe('Link this session to your Google account first.')
    expect((await (await claim(request, baseURL, code, hostKey)).json())).toEqual({ claim: 'MINE' })
    expect((await claim(request, baseURL, code, hostKey)).status()).toBe(200)

    const empty = await exportDupr(request, baseURL, code, hostKey)
    expect(empty.status()).toBe(409)
    expect((await empty.json()).error).toMatch(/^No game can go to DUPR yet/)

    await play(request, code, hostKey, ['Ana', 'Ben'], ['Cy', 'Di'], 11, 7)
    await play(request, code, hostKey, ['Ana', 'Eve'], ['Cy', 'Di'], 11, 4)
    const status = await (await dupr(request, code, hostKey)).json()
    expect(status).toMatchObject({ claim: 'MINE', exported: 1, missingIds: [{ name: 'Eve' }] })
    expect(status.skipped).toEqual([{ game: 2, court: 'Court 1', summary: 'Ana & Eve 11–4 Cy & Di', reason: 'Eve has no DUPR ID.' }])

    const sent = await exportDupr(request, baseURL, code, hostKey, 'Asia/Manila')
    expect(sent.status(), await sent.text()).toBe(200)
    const body = await sent.json()
    expect(body).toMatchObject({ delivery: 'SUPPRESSED', to: email, exported: 1, skipped: 1, exportsLeft: 4 })
    const [header, row, ...rest] = body.outbox.csv.split('\r\n')
    expect(header).toBe(TEMPLATE)
    expect(rest).toEqual([])
    const cells = row.split(',')
    expect(cells).toHaveLength(27)
    expect(cells.slice(0, 2)).toEqual(['D', 'Saturday Social'])
    expect(cells[2]).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect([cells[3], cells[4], cells[15], cells[16], cells[26]]).toEqual(['Ana', 'AAA111', '11', '7', 'SIDEOUT'])
    expect(body.outbox.filename).toMatch(/^dupr-saturday-social-\d{4}-\d{2}-\d{2}\.csv$/)
    expect(body.outbox.text).toContain('Game 2, Court 1: Ana & Eve 11–4 Cy & Di. Eve has no DUPR ID.')
    expect(body.outbox.text).toContain('Club ID CLUB-42')
    expect(body.outbox.text).toContain('Import Matches via CSV')
    expect(body.outbox.text).toContain('Club Director or Organizer')

    const eve = status.missingIds[0].id
    await ok(request, code, hostKey, { type: 'SET_PLAYER_DUPR_ID', playerId: eve, duprId: 'eee555' })
    expect(await (await dupr(request, code, hostKey)).json()).toMatchObject({ exported: 2, skipped: [], missingIds: [], exportsLeft: 4 })
  })

  test('five exports per session a day, then a refusal that says when', async ({ request, baseURL }) => {
    const { code, hostKey } = await readyToExport(request, baseURL)
    for (let n = 4; n >= 0; n -= 1) {
      const sent = await exportDupr(request, baseURL, code, hostKey)
      expect(sent.status()).toBe(200)
      expect((await sent.json()).exportsLeft).toBe(n)
    }
    const sixth = await exportDupr(request, baseURL, code, hostKey)
    expect(sixth.status()).toBe(429)
    expect((await sixth.json()).error).toMatch(/^A session can be sent to DUPR 5 times a day\. Try again in about \d+ hours?\.$/)
    expect((await (await dupr(request, code, hostKey)).json()).exportsLeft).toBe(0)
  })

  test('only the account the session is linked to can export it', async ({ request, playwright, baseURL }) => {
    const { code, hostKey } = await readyToExport(request, baseURL)
    const other = await playwright.request.newContext({ baseURL })
    await signIn(other, baseURL, uniqueEmail('bo'), `${code}-bo`)
    expect((await setClubId(other, baseURL, `${code}-bo`)).status()).toBe(200)
    const refused = await exportDupr(other, baseURL, code, hostKey)
    expect(refused.status()).toBe(403)
    expect((await refused.json()).error).toBe('Only the Google account this session is linked to can export it.')
    expect((await exportDupr(request, baseURL, code, hostKey)).status()).toBe(200)
    await other.dispose()
  })
})
```

- [ ] **Step 7: Run them**

Run: `npx playwright test tests/e2e/pickleball/open-host.spec.js --project=worker`
Expected: PASS (6 tests).

- [ ] **Step 8: Commit**

Add under `### Added` in `## [Unreleased]`:

```markdown
- Free sessions: `POST /api/pickleball/open/s/{code}/dupr-export` emails the DUPR CSV to the linked host's verified Google address through Resend, as an attachment with a reply-to for upload problems; 5 per session in any 24 hours, and a send that fails is not counted. The Resend provider gains an optional sender name and attachments.
```

```bash
git add src/worker/delivery/providers.js src/worker/delivery/providers.test.js src/worker/pickleball/open/duprExport.ts src/worker/pickleball/open/duprExport.test.ts src/worker/pickleball/open/OpenSessionDO.ts "src/pages/api/pickleball/open/s/[code]/dupr-export.ts" tests/e2e/pickleball/open-host.spec.js CHANGELOG.md
git commit -m "feat(pickleball): email the dupr export to the session host"
```

---

### Task 8: Delete my account, and the login purge

**Files:**
- Modify: `src/worker/pickleball/open/OpenSessionDO.ts`
- Modify: `src/pages/api/pickleball/open/host/me.ts`
- Modify: `src/worker/pickleball/open/purge.ts`, `src/worker.ts`
- Test: `src/worker/pickleball/open/purge.test.ts`, `tests/e2e/pickleball/open-host.spec.js`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: Task 1's `deleteHost`, `purgeExpiredHostLogins`; Task 4's cookie helpers.
- Produces: RPC `OpenSessionDO.forgetHost(hostId)`; `DELETE /api/pickleball/open/host/me` → `{ deleted: true, unlinkedSessions }` + cleared cookie; `runHostLoginPurge(env, { now }): Promise<number>`; the cron's log line gains `logins`.

- [ ] **Step 1: Write the failing tests**

In `src/worker/pickleball/open/purge.test.ts`, find:

```ts
import { runOpenSessionPurge } from './purge'
```

Replace it with:

```ts
import { runHostLoginPurge, runOpenSessionPurge } from './purge'
import { createHostLogin, upsertHost } from '../../repositories/pickleball/open/hosts'
```

In `src/worker/pickleball/open/purge.test.ts`, find:

```ts
    expect((raw.prepare('SELECT COUNT(*) AS n FROM open_sessions').get() as { n: number }).n).toBe(0)
  })
})
```

Replace it with:

```ts
    expect((raw.prepare('SELECT COUNT(*) AS n FROM open_sessions').get() as { n: number }).n).toBe(0)
  })

  it('removes expired host logins and keeps the host and live logins', async () => {
    const { d1, raw } = createSqliteD1(['0016_open_sessions', '0017_open_captains', '0018_open_tournaments', '0019_hosts'].map((m) => `migrations/pickleball/${m}.sql`))
    const host = await upsertHost(d1, { googleSub: 'g', email: 'mo@example.com', displayName: 'Mo', marketingOptIn: false }, { now: '2026-08-01T00:00:00.000Z', newId: () => 'h1' })
    await createHostLogin(d1, { tokenHash: 'old', hostId: host.id, now: '2026-08-01T00:00:00.000Z' })
    await createHostLogin(d1, { tokenHash: 'new', hostId: host.id, now: '2026-10-08T00:00:00.000Z' })
    expect(await runHostLoginPurge({ PICKLEBALL_DB: d1 }, { now: new Date('2026-10-09T00:00:00.000Z') })).toBe(1)
    expect((raw.prepare('SELECT COUNT(*) AS n FROM hosts').get() as { n: number }).n).toBe(1)
    expect((raw.prepare('SELECT token_hash FROM host_logins').get() as { token_hash: string }).token_hash).toBe('new')
  })
})
```

Run: `npx vitest run src/worker/pickleball/open/purge.test.ts`
Expected: FAIL — `runHostLoginPurge` is not exported.

- [ ] **Step 2: Add the purge**

In `src/worker/pickleball/open/purge.ts`, find:

```ts
import { purgeExpiredOpenSessions } from '../../repositories/pickleball/open/openSessions'
```

Replace it with:

```ts
import { purgeExpiredHostLogins } from '../../repositories/pickleball/open/hosts'
import { purgeExpiredOpenSessions } from '../../repositories/pickleball/open/openSessions'
```

Append to the end of `src/worker/pickleball/open/purge.ts`:

```ts
/**
 * Removes expired host logins (30 days after sign-in). Host accounts
 * themselves never expire (spec §3.2); only "Delete my account" removes one.
 */
export async function runHostLoginPurge(env: Pick<Env, 'PICKLEBALL_DB'>, { now }: { now: Date }): Promise<number> {
  return purgeExpiredHostLogins(env.PICKLEBALL_DB, now.toISOString())
}
```

In `src/worker.ts`, find:

```ts
import { runOpenSessionPurge } from './worker/pickleball/open/purge'
```

Replace it with:

```ts
import { runHostLoginPurge, runOpenSessionPurge } from './worker/pickleball/open/purge'
```

In `src/worker.ts`, find:

```ts
      runOpenSessionPurge(env, { now: new Date(event.scheduledTime) })
        .then((purged) => console.log(JSON.stringify({ event: 'pickleball_open.purge', outcome: 'ok', purged })))
```

Replace it with:

```ts
      runOpenSessionPurge(env, { now: new Date(event.scheduledTime) })
        .then(async (purged) => {
          const logins = await runHostLoginPurge(env, { now: new Date(event.scheduledTime) })
          console.log(JSON.stringify({ event: 'pickleball_open.purge', outcome: 'ok', purged, logins }))
        })
```

Run: `npx vitest run src/worker/pickleball/open/purge.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 3: Let a coordinator forget a deleted host**

In `src/worker/pickleball/open/OpenSessionDO.ts`, find:

```ts
  /** Called by the purge cron after it deleted this session's rows. */
```

Replace it with:

```ts
  /** After an account is deleted (D1 already unlinked it): drop the link from memory too. */
  async forgetHost(hostId: string): Promise<void> {
    return this.serial(async () => {
      if (this.loaded?.access.hostId === hostId) this.loaded = { ...this.loaded, access: { ...this.loaded.access, hostId: null } }
    })
  }

  /** Called by the purge cron after it deleted this session's rows. */
```

- [ ] **Step 4: Add DELETE to the profile route**

In `src/pages/api/pickleball/open/host/me.ts`, find:

```ts
import { toHostProfile, updateHostProfile } from '../../../../../worker/repositories/pickleball/open/hosts'
import { currentHost, hostAccountIpLimited, signInFirst } from '../../../../../worker/pickleball/open/hostSession'
import { openErrorResponse } from '../../../../../worker/pickleball/open/routeHelpers'
```

Replace it with:

```ts
import { deleteHost, toHostProfile, updateHostProfile } from '../../../../../worker/repositories/pickleball/open/hosts'
import { clearCookieHeader, HOST_COOKIE, HOST_COOKIE_PATH, isSecure } from '../../../../../worker/pickleball/open/hostCookies'
import { currentHost, hostAccountIpLimited, signInFirst } from '../../../../../worker/pickleball/open/hostSession'
import { openErrorResponse, openSessionStub } from '../../../../../worker/pickleball/open/routeHelpers'
```

Append to the end of `src/pages/api/pickleball/open/host/me.ts`:

```ts
/**
 * "Delete my account" (spec §3.2): removes the host row and every login, and
 * unlinks (does not delete) the sessions it had claimed. They keep running and
 * expire 7 days after their last change, like any session.
 */
export const DELETE: APIRoute = async ({ request }) => {
  const env = getEnv()
  try {
    await drainRequestBody(request)
    const refused = crossSiteRefusal(request) ?? (await hostAccountIpLimited(env, request))
    if (refused) return refused
    const host = await currentHost(env, request)
    if (!host) return signInFirst()
    const codes = await deleteHost(env.PICKLEBALL_DB, host.id)
    // D1 is already unlinked; this only refreshes coordinators holding the session in memory.
    await Promise.allSettled(codes.map((code) => openSessionStub(env, code).forgetHost(host.id)))
    return jsonResponse({ deleted: true, unlinkedSessions: codes.length }, 200, {
      'Set-Cookie': clearCookieHeader(HOST_COOKIE, { path: HOST_COOKIE_PATH, secure: isSecure(request) }),
    })
  } catch (error) {
    return openErrorResponse(error, 'host.me.delete')
  }
}
```

- [ ] **Step 5: Write the e2e tests**

Append to the end of `tests/e2e/pickleball/open-host.spec.js`:

```js
test.describe('account deletion and cross-site requests (API)', () => {
  test('deleting the account unlinks its sessions, keeps them running and signs it out on every device', async ({ request, playwright, baseURL }) => {
    const { code, hostKey, email } = await readyToExport(request, baseURL)
    const laptop = await playwright.request.newContext({ baseURL })
    await signIn(laptop, baseURL, email, `${code}-laptop`)

    const deleted = await request.delete('/api/pickleball/open/host/me', { headers: writeHeaders(baseURL, code) })
    expect(deleted.status()).toBe(200)
    expect(await deleted.json()).toEqual({ deleted: true, unlinkedSessions: 1 })
    expect(deleted.headers()['set-cookie']).toContain('devlab_pb_host=;')
    expect((await (await laptop.get('/api/pickleball/open/host/me', { headers: { 'cf-connecting-ip': ipFor(`${code}-laptop`) } })).json()).host).toBeNull()

    // The session is untouched apart from the link, and can be linked again by a new sign-in.
    expect((await request.get(`/api/pickleball/open/s/${code}/host`, { headers: { 'X-Host-Key': hostKey, 'cf-connecting-ip': ipFor(code) } })).status()).toBe(200)
    expect((await (await dupr(request, code, hostKey)).json())).toMatchObject({ host: null, claim: 'UNCLAIMED', exported: 1 })
    const again = await signIn(request, baseURL, email, `${code}-again`)
    expect(again).toMatchObject({ email, duprClubId: null, marketingOptIn: false })
    expect((await claim(request, baseURL, code, hostKey)).status()).toBe(200)
    await laptop.dispose()
  })

  test('host routes refuse a request from another site, or one that does not say where it came from', async ({ request, baseURL }) => {
    const { code, hostKey } = await readyToExport(request, baseURL)
    const evil = { Origin: 'https://evil.example', 'cf-connecting-ip': ipFor(code) }
    expect((await request.post(`/api/pickleball/open/s/${code}/claim`, { headers: { ...evil, 'X-Host-Key': hostKey } })).status()).toBe(403)
    expect((await request.post(`/api/pickleball/open/s/${code}/dupr-export`, { headers: { ...evil, 'X-Host-Key': hostKey }, data: {} })).status()).toBe(403)
    expect((await request.patch('/api/pickleball/open/host/me', { headers: evil, data: { marketingOptIn: true } })).status()).toBe(403)
    expect((await request.delete('/api/pickleball/open/host/me', { headers: evil })).status()).toBe(403)
    expect((await request.delete('/api/pickleball/open/host/me', { headers: { 'cf-connecting-ip': ipFor(code) } })).status()).toBe(403)
    const me = await (await request.get('/api/pickleball/open/host/me', { headers: { 'cf-connecting-ip': ipFor(code) } })).json()
    expect(me.host).toMatchObject({ duprClubId: '12345', marketingOptIn: false })
  })
})
```

- [ ] **Step 6: Run them**

Run: `npm run typecheck && npx playwright test tests/e2e/pickleball/open-host.spec.js --project=worker`
Expected: 0 type errors; PASS (8 tests).

- [ ] **Step 7: Commit**

Add under `### Added` in `## [Unreleased]`:

```markdown
- Free sessions: "Delete my account" (`DELETE /api/pickleball/open/host/me`) removes the host and every login and unlinks, but keeps, their sessions, which their coordinators forget at once; the daily cron also removes expired host logins.
```

```bash
git add src/worker/pickleball/open/OpenSessionDO.ts src/pages/api/pickleball/open/host/me.ts src/worker/pickleball/open/purge.ts src/worker/pickleball/open/purge.test.ts src/worker.ts tests/e2e/pickleball/open-host.spec.js CHANGELOG.md
git commit -m "feat(pickleball): delete my host account and purge old logins"
```

---

### Task 9: The console's DUPR sheet

**Files:**
- Modify: `src/pickleball-open/lib/api.js`
- Create: `src/pickleball-open/host/duprSteps.js`
- Create: `src/pickleball-open/host/ClubIdForm.jsx`
- Create: `src/pickleball-open/host/HostAccount.jsx`
- Create: `src/pickleball-open/host/DuprSheet.jsx`
- Modify: `src/pickleball-open/components/HostConsole.jsx`
- Test: `src/pickleball-open/host/duprSteps.test.js`, `tests/e2e/pickleball/open-host.spec.js`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: every route from Tasks 4–8; `Sheet`, `Button` (`components/ui.jsx`); `DUPR_CLICK_PATH` (Task 2); `useCommandQueue`'s `send` (resolves true on success) and `error`.
- Produces:
  - `api.js`: `fetchDuprStatus(code, hostKey)`, `claimSession(code, hostKey)`, `emailDuprExport(code, hostKey)`, `fetchMe()`, `updateMe(patch)`, `deleteAccount()`, `signOut()`, `fetchMySessions()`, `reopenSession(code)`.
  - `duprSteps.js`: `readSignInResult(search)`, `SIGN_IN_MESSAGES`, `signInHref(returnPath, optIn)`, `duprStep(status)` (`LOADING | SIGN_IN | OTHER | CLAIM | CLUB_ID | READY`), `DUPR_ID_INPUT`, `CLUB_ID_INPUT`, `exportSummary(status)`, `sentMessage(result)`.
  - Components: `ClubIdForm({ current, onSaved })`, `HostAccount({ host, onChanged, showMySessions? })`, `DuprSheet({ code, hostKey, version, send, commandError?, signInResult?, onClose })`. HostConsole's More menu gains "Email me the DUPR export"; `?signin=` reopens the sheet and is removed from the address bar.

- [ ] **Step 1: Write the failing unit test**

`src/pickleball-open/host/duprSteps.test.js`:

```js
import { describe, expect, it } from 'vitest'
import { duprStep, exportSummary, readSignInResult, sentMessage, signInHref, SIGN_IN_MESSAGES } from './duprSteps'

const host = { email: 'mo@example.com', displayName: 'Mo', duprClubId: null, marketingOptIn: false }

describe('readSignInResult', () => {
  it('reads only the outcomes the server sends', () => {
    expect(readSignInResult('?signin=ok')).toBe('ok')
    expect(readSignInResult('?x=1&signin=unverified')).toBe('unverified')
    expect(readSignInResult('?signin=<script>')).toBeNull()
    expect(readSignInResult('')).toBeNull()
    for (const value of ['cancelled', 'unverified', 'failed', 'busy', 'unavailable']) expect(SIGN_IN_MESSAGES[value]).toBeTruthy()
  })
})

describe('signInHref', () => {
  it('carries the return path, and the opt-in only when ticked', () => {
    expect(signInHref('/pickleball/s/ABCDE23456', false)).toBe('/api/pickleball/open/host/sign-in?return=%2Fpickleball%2Fs%2FABCDE23456')
    expect(signInHref('/pickleball/my-sessions', true)).toBe('/api/pickleball/open/host/sign-in?return=%2Fpickleball%2Fmy-sessions&optIn=1')
  })
})

describe('duprStep', () => {
  it('walks sign in → link → Club ID → ready, and stops at someone else’s session', () => {
    expect(duprStep(null)).toBe('LOADING')
    expect(duprStep({ host: null, claim: 'UNCLAIMED' })).toBe('SIGN_IN')
    expect(duprStep({ host: null, claim: 'OTHER' })).toBe('SIGN_IN')
    expect(duprStep({ host, claim: 'OTHER' })).toBe('OTHER')
    expect(duprStep({ host, claim: 'UNCLAIMED' })).toBe('CLAIM')
    expect(duprStep({ host, claim: 'MINE' })).toBe('CLUB_ID')
    expect(duprStep({ host: { ...host, duprClubId: '12345' }, claim: 'MINE' })).toBe('READY')
  })
})

describe('messages', () => {
  it('summarises the export and the send', () => {
    expect(exportSummary({ exported: 0, skipped: [] })).toMatch(/^No game can go to DUPR yet/)
    expect(exportSummary({ exported: 1, skipped: [] })).toBe('1 game can go to DUPR.')
    expect(exportSummary({ exported: 3, skipped: [{}, {}] })).toBe('3 games can go to DUPR; 2 games left out.')
    expect(sentMessage({ delivery: 'SENT', to: 'mo@example.com', exported: 3 })).toBe('Sent to mo@example.com: 3 games. Upload the file in DUPR.')
    expect(sentMessage({ delivery: 'SUPPRESSED', to: 'mo@example.com', exported: 1 })).toBe('Test environment: nothing was emailed. 1 game would have gone to mo@example.com.')
  })
})
```

Run: `npx vitest run src/pickleball-open/host`
Expected: FAIL — `Failed to resolve import "./duprSteps"`.

- [ ] **Step 2: Write the helpers**

`src/pickleball-open/host/duprSteps.js`:

```js
// Pure helpers for the DUPR sheet and My sessions (spec §9). Kept out of the
// component files so they are unit-tested and react-refresh stays happy.

const RESULTS = ['ok', 'cancelled', 'unverified', 'failed', 'busy', 'unavailable']

/** What a ?signin= value on the return from Google says, or null. */
export function readSignInResult(search) {
  const value = new URLSearchParams(search || '').get('signin')
  return RESULTS.includes(value) ? value : null
}

export const SIGN_IN_MESSAGES = {
  ok: null,
  cancelled: 'Sign-in was cancelled. Nothing was changed.',
  unverified: 'That Google account has no verified email address, so the export could not be sent to it. Try another account.',
  failed: 'Sign-in did not finish. Try again.',
  busy: 'Too many sign-in attempts from this network. Try again in a few minutes.',
  unavailable: 'Google sign-in is not available right now. Try again later.',
}

/** The page to send the browser to for Google sign-in, coming back to `returnPath`. */
export function signInHref(returnPath, optIn) {
  const query = new URLSearchParams({ return: returnPath })
  if (optIn) query.set('optIn', '1')
  return `/api/pickleball/open/host/sign-in?${query.toString()}`
}

/**
 * Which step of the DUPR sheet to show for a status from GET …/dupr:
 * SIGN_IN, OTHER (linked to another account), CLAIM, CLUB_ID or READY.
 */
export function duprStep(status) {
  if (!status) return 'LOADING'
  if (!status.host) return 'SIGN_IN'
  if (status.claim === 'OTHER') return 'OTHER'
  if (status.claim === 'UNCLAIMED') return 'CLAIM'
  if (!status.host.duprClubId) return 'CLUB_ID'
  return 'READY'
}

export const DUPR_ID_INPUT = /^[A-Za-z0-9]{6}$/
export const CLUB_ID_INPUT = /^[A-Za-z0-9-]{3,20}$/

const games = (n) => `${n} game${n === 1 ? '' : 's'}`

/** One line for the READY step. */
export function exportSummary(status) {
  if (!status.exported) return 'No game can go to DUPR yet: each needs a score and a DUPR ID for all four players.'
  return `${games(status.exported)} can go to DUPR${status.skipped.length ? `; ${games(status.skipped.length)} left out` : ''}.`
}

/** What to say once the export went out (or, in a test environment, did not). */
export function sentMessage(result) {
  if (result.delivery === 'SUPPRESSED') return `Test environment: nothing was emailed. ${games(result.exported)} would have gone to ${result.to}.`
  return `Sent to ${result.to}: ${games(result.exported)}. Upload the file in DUPR.`
}
```

Run: `npx vitest run src/pickleball-open/host`
Expected: PASS (4 tests).

- [ ] **Step 3: Add the API calls**

Append to the end of `src/pickleball-open/lib/api.js`:

```js
// Google-verified host (spec §9). The devlab_pb_host cookie rides along on
// these same-origin requests by itself; the browser adds Origin, which the
// server checks on every write.
const HOST_API = '/api/pickleball/open/host'
const deviceTimeZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

export async function fetchDuprStatus(code, hostKey) {
  return parse(await fetch(`${base(code)}/dupr?tz=${encodeURIComponent(deviceTimeZone())}`, { headers: authHeaders({ hostKey }) }))
}
export async function claimSession(code, hostKey) {
  return parse(await fetch(`${base(code)}/claim`, { method: 'POST', headers: authHeaders({ hostKey }) }))
}
export async function emailDuprExport(code, hostKey) {
  return parse(await fetch(`${base(code)}/dupr-export`, {
    method: 'POST', headers: { ...JSON_HEADERS, ...authHeaders({ hostKey }) }, body: JSON.stringify({ timeZone: deviceTimeZone() }),
  }))
}
export async function fetchMe() {
  return parse(await fetch(`${HOST_API}/me`))
}
export async function updateMe(patch) {
  return parse(await fetch(`${HOST_API}/me`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(patch) }))
}
export async function deleteAccount() {
  return parse(await fetch(`${HOST_API}/me`, { method: 'DELETE' }))
}
export async function signOut() {
  return parse(await fetch(`${HOST_API}/sign-out`, { method: 'POST' }))
}
export async function fetchMySessions() {
  return parse(await fetch(`${HOST_API}/sessions`))
}
export async function reopenSession(code) {
  return parse(await fetch(`${HOST_API}/sessions/${encodeURIComponent(code)}/reopen`, { method: 'POST' }))
}
```

- [ ] **Step 4: Write the components**

`src/pickleball-open/host/ClubIdForm.jsx`:

```jsx
// The host's DUPR Club ID (spec §9.3): entered once, saved on their account.
import { useState } from 'react'
import { updateMe } from '../lib/api'
import { Button } from '../components/ui.jsx'
import { CLUB_ID_INPUT } from './duprSteps'

const errorText = (failure, fallback) => (failure instanceof Error && failure.message ? failure.message : fallback)

export default function ClubIdForm({ current, onSaved }) {
  const [value, setValue] = useState(current ?? '')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const trimmed = value.trim()

  async function save(event) {
    event.preventDefault()
    if (!CLUB_ID_INPUT.test(trimmed)) {
      setError('A DUPR Club ID is 3 to 20 letters, digits or dashes.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const { host } = await updateMe({ duprClubId: trimmed })
      onSaved(host)
    } catch (failure) {
      setError(errorText(failure, 'Could not save the Club ID. Try again.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={save} className="grid gap-2">
      <label className="grid gap-1 text-sm font-semibold">Your DUPR Club ID
        <input value={value} onChange={(event) => setValue(event.target.value)} maxLength={20} autoComplete="off"
          className="min-h-11 rounded-lg bg-ink px-3 py-2 font-mono text-white" />
      </label>
      <p className="text-xs text-mist">On your club’s page in DUPR. Saved for every session you export.</p>
      {error && <p role="alert" className="text-sm text-rose-200">{error}</p>}
      <Button type="submit" disabled={busy || trimmed === (current ?? '')}>{busy ? 'Saving…' : 'Save Club ID'}</Button>
    </form>
  )
}
```

`src/pickleball-open/host/HostAccount.jsx`:

```jsx
// The signed-in host's account controls, shared by the DUPR sheet and My
// sessions: news opt-in (never ticked for them), sign out, and "Delete my
// account" (spec §3.2).
import { useState } from 'react'
import { deleteAccount, signOut, updateMe } from '../lib/api'
import { Button } from '../components/ui.jsx'

const errorText = (failure, fallback) => (failure instanceof Error && failure.message ? failure.message : fallback)

export default function HostAccount({ host, onChanged, showMySessions = true }) {
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function run(action, fallback) {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (failure) {
      setError(errorText(failure, fallback))
    } finally {
      setBusy(false)
    }
  }

  const toggleNews = () => run(async () => onChanged((await updateMe({ marketingOptIn: !host.marketingOptIn })).host), 'Could not save that. Try again.')
  const leave = () => run(async () => {
    await signOut()
    onChanged(null)
  }, 'Could not sign out. Try again.')
  const remove = () => {
    if (!window.confirm('Delete your account? Your sessions keep running but are no longer linked to you, and their DUPR export needs a new sign-in.')) return
    run(async () => {
      await deleteAccount()
      onChanged(null)
    }, 'Could not delete the account. Try again.')
  }

  return (
    <section aria-label="Your account" className="mt-5 grid gap-3 border-t border-navy-800 pt-4 text-sm">
      <p className="text-mist">Signed in as <span className="font-semibold text-white">{host.email}</span>. We keep your Google name and email, your DUPR Club ID and your news choice until you delete your account.</p>
      <label className="flex min-h-11 items-center gap-3">
        <input type="checkbox" checked={host.marketingOptIn} disabled={busy} onChange={toggleNews} className="h-5 w-5" />
        Email me occasional Devlab Pickleball news
      </label>
      {error && <p role="alert" className="text-rose-200">{error}</p>}
      <div className="flex flex-wrap gap-2">
        {showMySessions && <a href="/pickleball/my-sessions" className="inline-flex min-h-11 items-center rounded-xl px-3 font-semibold text-pickle-neon underline">My sessions</a>}
        <Button variant="ghost" disabled={busy} onClick={leave}>Sign out</Button>
        <Button variant="danger" disabled={busy} onClick={remove}>Delete my account</Button>
      </div>
    </section>
  )
}
```

`src/pickleball-open/host/DuprSheet.jsx`:

```jsx
// The host console's DUPR export (spec §9): sign in with Google, link the
// session once, enter the DUPR Club ID once, fix missing DUPR IDs, then email
// the CSV to the verified Google address. Only HostConsole renders this:
// viewers and captains never see it.
import { useEffect, useState } from 'react'
import { DUPR_CLICK_PATH } from '../../lib/pickleball/open/dupr/email'
import { claimSession, emailDuprExport, fetchDuprStatus } from '../lib/api'
import { Button, Sheet } from '../components/ui.jsx'
import ClubIdForm from './ClubIdForm.jsx'
import HostAccount from './HostAccount.jsx'
import { DUPR_ID_INPUT, duprStep, exportSummary, sentMessage, SIGN_IN_MESSAGES, signInHref } from './duprSteps'

const errorText = (failure, fallback) => (failure instanceof Error && failure.message ? failure.message : fallback)
const alertClass = 'mb-3 rounded-xl bg-rose-500/15 px-4 py-3 text-rose-100'

export default function DuprSheet({ code, hostKey, version, send, commandError = null, signInResult = null, onClose }) {
  const [status, setStatus] = useState(null)
  const [error, setError] = useState(signInResult ? SIGN_IN_MESSAGES[signInResult] : null)
  const [notice, setNotice] = useState(null)
  const [busy, setBusy] = useState(false)
  const [optIn, setOptIn] = useState(false)
  const [reload, setReload] = useState(0)
  const [ids, setIds] = useState({})
  const step = duprStep(status)
  const refresh = () => setReload((n) => n + 1)

  // Refetched whenever the session changes (a DUPR ID was added) or an action here asks for it.
  useEffect(() => {
    let live = true
    fetchDuprStatus(code, hostKey).then(
      (next) => { if (live) setStatus(next) },
      (failure) => { if (live) setError(errorText(failure, 'Could not load the DUPR export. Try again.')) },
    )
    return () => { live = false }
  }, [code, hostKey, version, reload])

  async function act(action, fallback) {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (failure) {
      setError(errorText(failure, fallback))
    } finally {
      setBusy(false)
    }
  }

  const link = () => act(async () => {
    await claimSession(code, hostKey)
    refresh()
  }, 'Could not link the session. Try again.')

  const email = () => act(async () => {
    setNotice(null)
    setNotice(sentMessage(await emailDuprExport(code, hostKey)))
    refresh()
  }, 'Could not send the export. Try again.')

  async function saveId(player) {
    const value = (ids[player.id] ?? '').trim()
    if (!DUPR_ID_INPUT.test(value)) {
      setError(`A DUPR ID is 6 letters or digits. Check ${player.name}’s.`)
      return
    }
    setError(null)
    if (await send({ type: 'SET_PLAYER_DUPR_ID', playerId: player.id, duprId: value })) {
      setIds((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => id !== player.id)))
    }
  }

  return (
    <Sheet title="Email me the DUPR export" onClose={onClose}>
      {error && <p role="alert" className={alertClass}>{error}</p>}
      {commandError && <p role="alert" className={alertClass}>{commandError}</p>}
      {notice && <p role="status" className="mb-3 rounded-xl bg-pickle-neon px-4 py-3 font-semibold text-ink">{notice}</p>}
      {step === 'LOADING' && !error && <p role="status" className="text-mist">Loading…</p>}

      {step === 'SIGN_IN' && (
        <div className="grid gap-3">
          <p>{status.claim === 'OTHER'
            ? 'This session is linked to a Google account. Sign in with that account to send it to DUPR.'
            : 'The export is emailed to you, so sign in with Google first. That is only for DUPR: running a session never needs an account.'}</p>
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input type="checkbox" checked={optIn} onChange={(event) => setOptIn(event.target.checked)} className="h-5 w-5" />
            Email me occasional Devlab Pickleball news
          </label>
          <a href={signInHref(`/pickleball/s/${code}`, optIn)} className="inline-flex min-h-11 items-center justify-center rounded-xl bg-brand px-4 font-semibold text-white hover:bg-[#3a00d6]">Sign in with Google</a>
        </div>
      )}

      {step === 'OTHER' && <p>This session is linked to another Google account. Only that account can send it to DUPR.</p>}

      {step === 'CLAIM' && (
        <div className="grid gap-3">
          <p>Link this session to <strong>{status.host.email}</strong>? A session is linked once: from then on only this account can send it to DUPR, and it shows in My sessions on any device.</p>
          <Button disabled={busy} onClick={link}>Link to my account</Button>
        </div>
      )}

      {step === 'CLUB_ID' && <ClubIdForm current={null} onSaved={refresh} />}

      {step === 'READY' && (
        <div className="grid gap-3">
          <p className="font-semibold">{exportSummary(status)}</p>
          {status.skipped.length > 0 && (
            <ul aria-label="Left out" className="grid gap-1 text-sm text-mist">
              {status.skipped.map((s) => <li key={s.game}>Game {s.game}{s.court ? `, ${s.court}` : ''}: {s.summary}. {s.reason}</li>)}
            </ul>
          )}
          {status.missingIds.length > 0 && (
            <div className="grid gap-2">
              <p className="text-sm">Add a DUPR ID to bring their games in:</p>
              {status.missingIds.map((player) => (
                <form key={player.id} className="flex items-end gap-2" onSubmit={(event) => { event.preventDefault(); saveId(player) }}>
                  <label className="grid min-w-0 flex-1 gap-1 text-xs text-mist">DUPR ID for {player.name}
                    <input value={ids[player.id] ?? ''} maxLength={6} autoComplete="off"
                      onChange={(event) => setIds((prev) => ({ ...prev, [player.id]: event.target.value }))}
                      className="min-h-11 w-full min-w-0 rounded-lg bg-ink px-3 py-2 font-mono uppercase text-white" />
                  </label>
                  <Button type="submit" variant="ghost">Save</Button>
                </form>
              ))}
            </div>
          )}
          <p className="text-sm text-mist">Club ID {status.host.duprClubId}. In DUPR, go to {DUPR_CLICK_PATH} and choose the file. Your DUPR account must be a Club Director or Organizer of the club.</p>
          <Button variant="neon" disabled={busy || !status.exported || !status.exportsLeft} onClick={email}>{busy ? 'Sending…' : 'Email me the export'}</Button>
          <p className="text-xs text-mist">{status.exportsLeft} of {status.exportLimit} exports left today, sent to {status.host.email}.</p>
          <details>
            <summary className="min-h-11 cursor-pointer py-2 text-sm">Change Club ID</summary>
            <ClubIdForm current={status.host.duprClubId} onSaved={refresh} />
          </details>
        </div>
      )}

      {status?.host && <HostAccount host={status.host} onChanged={refresh} />}
    </Sheet>
  )
}
```

- [ ] **Step 5: Open it from the console**

Only `HostConsole` renders the sheet; `CaptainConsole` and `ViewerBoard` are not touched.

In `src/pickleball-open/components/HostConsole.jsx`, find:

```jsx
import TournamentHost from '../tournament/TournamentHost.jsx'
```

Replace it with:

```jsx
import TournamentHost from '../tournament/TournamentHost.jsx'
import DuprSheet from '../host/DuprSheet.jsx'
import { readSignInResult } from '../host/duprSteps'
```

In `src/pickleball-open/components/HostConsole.jsx`, find:

```jsx
  const [dialog, setDialog] = useState(null)
```

Replace it with:

```jsx
  // Back from Google sign-in (?signin=…): reopen the DUPR sheet where the host left it.
  const [dialog, setDialog] = useState(() => {
    const signInResult = readSignInResult(window.location.search)
    return signInResult ? { type: 'dupr', signInResult } : null
  })
```

In `src/pickleball-open/components/HostConsole.jsx`, find:

```jsx
  // A new error moves into view
```

Replace it with:

```jsx
  // The sign-in outcome is read once (above); keep it out of the address bar and of a reload.
  useEffect(() => {
    if (readSignInResult(window.location.search)) window.history.replaceState(null, '', window.location.pathname)
  }, [])

  // A new error moves into view
```

In `src/pickleball-open/components/HostConsole.jsx`, find:

```jsx
              <Button variant="ghost" onClick={() => { setMenuOpen(false); download() }}>Download results (CSV)</Button>
```

Replace it with:

```jsx
              <Button variant="ghost" onClick={() => { setMenuOpen(false); download() }}>Download results (CSV)</Button>
              <Button variant="ghost" onClick={() => { setMenuOpen(false); setDialog({ type: 'dupr' }) }}>Email me the DUPR export</Button>
```

In `src/pickleball-open/components/HostConsole.jsx`, find:

```jsx
      {undo && (
```

Replace it with:

```jsx
      {dialog?.type === 'dupr' && (
        <DuprSheet code={code} hostKey={hostKey} version={viewer.version} send={send} commandError={error}
          signInResult={dialog.signInResult ?? null} onClose={() => setDialog(null)} />
      )}
      {undo && (
```

Run: `npx eslint src/pickleball-open && npm run typecheck`
Expected: 0 errors.

- [ ] **Step 6: Write the e2e tests**

Append to the end of `tests/e2e/pickleball/open-host.spec.js`:

```js
test.describe('the DUPR sheet (screens)', () => {
  test('the host links the session, adds a Club ID and a missing DUPR ID, and emails the export from the console', async ({ page, request, baseURL }) => {
    const { code, hostKey } = await createSession(request)
    await play(request, code, hostKey, ['Ana', 'Eve'], ['Cy', 'Di'], 11, 4)
    await play(request, code, hostKey, ['Ana', 'Ben'], ['Cy', 'Di'], 11, 7)
    await signIn(page.request, baseURL, uniqueEmail('mo'), code)
    await page.goto(`/pickleball/s/${code}#host=${hostKey}`)
    await page.getByRole('button', { name: 'More' }).click()
    await page.getByRole('button', { name: 'Email me the DUPR export' }).click()
    const sheet = page.getByRole('dialog', { name: 'Email me the DUPR export' })
    await sheet.getByRole('button', { name: 'Link to my account' }).click()
    await sheet.getByLabel('Your DUPR Club ID').fill('12345')
    await sheet.getByRole('button', { name: 'Save Club ID' }).click()
    await expect(sheet.getByText('1 game can go to DUPR; 1 game left out.')).toBeVisible()
    await expect(sheet.getByRole('list', { name: 'Left out' })).toContainText('Eve has no DUPR ID.')
    await sheet.getByLabel('DUPR ID for Eve').fill('eee555')
    await sheet.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(sheet.getByText('2 games can go to DUPR.')).toBeVisible()
    await sheet.getByRole('button', { name: 'Email me the export' }).click()
    await expect(sheet.getByRole('status')).toContainText('Test environment: nothing was emailed. 2 games')
    await expect(sheet.getByText('4 of 5 exports left today')).toBeVisible()
  })

  test('signed out, the sheet offers Google with the news box unticked, and coming back from Google reopens it', async ({ page, request, baseURL }) => {
    const { code, hostKey } = await createSession(request)
    await page.goto(`/pickleball/s/${code}#host=${hostKey}`)
    await page.getByRole('button', { name: 'More' }).click()
    await page.getByRole('button', { name: 'Email me the DUPR export' }).click()
    const sheet = page.getByRole('dialog', { name: 'Email me the DUPR export' })
    const signInLink = sheet.getByRole('link', { name: 'Sign in with Google' })
    const news = sheet.getByLabel('Email me occasional Devlab Pickleball news')
    await expect(news).not.toBeChecked()
    await expect(signInLink).toHaveAttribute('href', `/api/pickleball/open/host/sign-in?return=%2Fpickleball%2Fs%2F${code}`)
    await news.check()
    await expect(signInLink).toHaveAttribute('href', `/api/pickleball/open/host/sign-in?return=%2Fpickleball%2Fs%2F${code}&optIn=1`)

    await signIn(page.request, baseURL, uniqueEmail('mo'), code)
    await page.goto(`/pickleball/s/${code}?signin=ok`)
    await expect(page.getByRole('dialog', { name: 'Email me the DUPR export' }).getByRole('button', { name: 'Link to my account' })).toBeVisible()
    expect(new URL(page.url()).search).toBe('')
    await page.goto(`/pickleball/s/${code}?signin=unverified`)
    await expect(page.getByRole('dialog', { name: 'Email me the DUPR export' }).getByRole('alert')).toContainText('no verified email')
  })

  test('the public board and a captain never see the DUPR export or the link', async ({ browser, request, baseURL }) => {
    const { code, hostKey } = await readyToExport(request, baseURL)
    const courtId = (await (await request.get(`/api/pickleball/open/s/${code}/host`, { headers: { 'X-Host-Key': hostKey, 'cf-connecting-ip': ipFor(code) } })).json()).courts[0].id
    const { captainKey } = await (await request.post(`/api/pickleball/open/s/${code}/captains`, { headers: { 'X-Host-Key': hostKey, 'cf-connecting-ip': ipFor(code) }, data: { courtId } })).json()
    const context = await browser.newContext()
    const viewer = await context.newPage()
    await viewer.goto(`/pickleball/s/${code}`)
    await expect(viewer.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(viewer.getByText(/dupr|link to my account|sign in with google/i)).toHaveCount(0)
    const captain = await (await browser.newContext()).newPage()
    await captain.goto(`/pickleball/s/${code}#cap=${captainKey}`)
    await expect(captain.getByText('Court 1 captain')).toBeVisible()
    await expect(captain.getByText(/dupr|link to my account|sign in with google/i)).toHaveCount(0)
    const state = await (await request.get(`/api/pickleball/open/s/${code}/state`)).json()
    expect(JSON.stringify(state)).not.toMatch(/dupr|hostId|host_id|claim/i)
    await context.close()
  })
})
```

- [ ] **Step 7: Run them**

Run: `npm run build && npx playwright test tests/e2e/pickleball/open-host.spec.js --project=worker`
Expected: PASS (11 tests).

- [ ] **Step 8: Commit**

Add under `### Added` in `## [Unreleased]`:

```markdown
- Free sessions host console: More → Email me the DUPR export walks the host through Google sign-in (the news box beside it unticked), linking the session, the DUPR Club ID, adding missing DUPR IDs and sending, then shows exports left today; the account panel has news opt-in, sign out and Delete my account. Coming back from Google reopens the sheet. The board and captain screens never show any of it.
```

```bash
git add src/pickleball-open/lib/api.js src/pickleball-open/host src/pickleball-open/components/HostConsole.jsx tests/e2e/pickleball/open-host.spec.js CHANGELOG.md
git commit -m "feat(pickleball): dupr export sheet on the host console"
```

---

### Task 10: My sessions page, guide and FAQ

**Files:**
- Create: `src/pickleball-open/host/MySessionsApp.jsx`
- Create: `src/pages/pickleball/my-sessions.astro`
- Modify: `src/pages/pickleball/how-it-works.astro`, `src/pages/pickleball/index.astro`
- Modify: `tests/e2e/pickleball/pickleball-public-pages.spec.js`
- Test: `tests/e2e/pickleball/open-host.spec.js`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: Task 9's `api.js` calls, `duprSteps.js`, `ClubIdForm`, `HostAccount`; `hostKeyFor`, `rememberHostedSession` (`lib/hostKeys.js`); `PickleballAppShell` (not indexed by default).
- Produces: page `/pickleball/my-sessions` (sign-in panel when signed out; linked sessions with "Open {name} as host", Club ID and account panel when signed in). Copy rule: every new claim maps to code (pinned by the public-pages spec).

- [ ] **Step 1: Write the page**

`src/pickleball-open/host/MySessionsApp.jsx`:

```jsx
// My sessions (spec §9.5): a signed-in host's linked sessions from any device,
// each reopenable as host. This is the recovery path for a lost host link.
import { useEffect, useState } from 'react'
import { fetchMe, fetchMySessions, reopenSession } from '../lib/api'
import { hostKeyFor, rememberHostedSession } from '../lib/hostKeys'
import { Button, Panel } from '../components/ui.jsx'
import ClubIdForm from './ClubIdForm.jsx'
import HostAccount from './HostAccount.jsx'
import { readSignInResult, SIGN_IN_MESSAGES, signInHref } from './duprSteps'

const errorText = (failure, fallback) => (failure instanceof Error && failure.message ? failure.message : fallback)
const dateOf = (iso) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })

export default function MySessionsApp() {
  const [signInResult] = useState(() => readSignInResult(window.location.search))
  const [host, setHost] = useState(undefined)
  const [sessions, setSessions] = useState([])
  const [error, setError] = useState(signInResult ? SIGN_IN_MESSAGES[signInResult] : null)
  const [optIn, setOptIn] = useState(false)
  const [opening, setOpening] = useState(null)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    if (signInResult) window.history.replaceState(null, '', window.location.pathname)
  }, [signInResult])

  useEffect(() => {
    let live = true
    fetchMe()
      .then(async ({ host: me }) => {
        const list = me ? (await fetchMySessions()).sessions : []
        if (!live) return
        setHost(me)
        setSessions(list)
      })
      .catch((failure) => { if (live) setError(errorText(failure, 'Could not load your sessions. Try again.')) })
    return () => { live = false }
  }, [reload])

  async function open(session) {
    if (hostKeyFor(session.code)) {
      window.location.assign(`/pickleball/s/${session.code}`)
      return
    }
    setOpening(session.code)
    setError(null)
    try {
      const { hostKey } = await reopenSession(session.code)
      // Saved on this device first, so the key never has to sit in the address bar.
      rememberHostedSession({ code: session.code, hostKey, name: session.name })
      window.location.assign(`/pickleball/s/${session.code}`)
    } catch (failure) {
      setError(errorText(failure, 'Could not open that session. Try again.'))
      setOpening(null)
    }
  }

  return (
    <main className="mx-auto grid max-w-2xl gap-5 px-4 py-8">
      <header>
        <a href="/pickleball" className="text-sm text-mist underline">Devlab Pickleball</a>
        <h1 className="mt-2 text-3xl font-bold">My sessions</h1>
        <p className="mt-1 text-mist">Sessions you linked to your Google account for the DUPR export. Open one as host from any device.</p>
      </header>
      {error && <p role="alert" className="rounded-xl bg-rose-500/15 px-4 py-3 text-rose-100">{error}</p>}
      {host === undefined && !error && <p role="status" className="text-mist">Loading…</p>}

      {host === null && (
        <Panel className="grid gap-3">
          <p>Sign in with the Google account you used for a DUPR export. Running a session never needs an account; only sessions you linked show here.</p>
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input type="checkbox" checked={optIn} onChange={(event) => setOptIn(event.target.checked)} className="h-5 w-5" />
            Email me occasional Devlab Pickleball news
          </label>
          <a href={signInHref('/pickleball/my-sessions', optIn)} className="inline-flex min-h-11 items-center justify-center rounded-xl bg-brand px-4 font-semibold text-white hover:bg-[#3a00d6]">Sign in with Google</a>
        </Panel>
      )}

      {host && (
        <>
          <section aria-label="Linked sessions" className="grid gap-3">
            {sessions.length === 0 && <Panel><p className="text-mist">No linked sessions yet. On a session’s console, choose More, then Email me the DUPR export, to link one.</p></Panel>}
            {sessions.map((session) => (
              <Panel key={session.code} className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-lg font-bold">{session.name}</h2>
                  <p className="text-sm text-mist">
                    {session.kind === 'TOURNAMENT' ? 'Tournament' : 'Open play'}{session.status === 'ENDED' ? ' · Ended' : ''} · Results deleted on {dateOf(session.expiresAt)}
                  </p>
                </div>
                <Button disabled={opening !== null} onClick={() => open(session)}>{opening === session.code ? 'Opening…' : `Open ${session.name} as host`}</Button>
              </Panel>
            ))}
          </section>
          <Panel>
            <ClubIdForm key={host.duprClubId ?? ''} current={host.duprClubId} onSaved={setHost} />
            <HostAccount host={host} showMySessions={false} onChanged={(next) => (next ? setHost(next) : setReload((n) => n + 1))} />
          </Panel>
        </>
      )}
    </main>
  )
}
```

`src/pages/pickleball/my-sessions.astro`:

```astro
---
// src/pages/pickleball/my-sessions.astro
// A signed-in host's linked sessions (spec §9.5). Not indexed: it is a private screen.
import PickleballAppShell from '../../layouts/PickleballAppShell.astro'
import MySessionsApp from '../../pickleball-open/host/MySessionsApp.jsx'
---
<PickleballAppShell title="My sessions — Devlab Pickleball">
  <MySessionsApp client:only="react" />
</PickleballAppShell>
```

- [ ] **Step 2: Write the copy**

Every sentence maps to shipped code: the More menu item and sheet (Task 9), Google sign-in for the export alone (Task 5), linking once (Task 6), the Club ID once (Task 4), missing DUPR IDs (Task 3), the CSV and the left-out list (Task 2), `DUPR_CLICK_PATH` and the Club Director or Organizer rule (Task 2), 5 a day (Task 6), Delete my account (Task 8), My sessions (this task). Never write "vs" on these pages.

In `src/pages/pickleball/how-it-works.astro`, find:

```astro
  { title: 'Save your host link, share the board', body: 'Your host link controls the session; keep it. Show players the QR code for the view-only board.' },
```

Replace it with:

```astro
  { title: 'Save your host link, share the board', body: 'Your host link controls the session; keep it. Show players the QR code for the view-only board. If you link the session to Google for a DUPR export, My sessions reopens it as host on any device.' },
```

In `src/pages/pickleball/how-it-works.astro`, find:

```astro
  { title: 'Finish up',
```

Replace it with:

```astro
  { title: 'Send games to DUPR', body: 'From More, choose Email me the DUPR export. This is the only step that asks anyone to sign in with Google, and only you, the host, can take it. Link the session to your Google account (once per session), enter your DUPR Club ID (once, for every session) and add any missing DUPR IDs. Every game with a score and a DUPR ID for all four players goes into a CSV emailed to your Google address, with each game left out and why. Upload it in DUPR under Matches → Add Matches → Import Matches via CSV; your DUPR account must be a Club Director or Organizer of the club. Up to 5 exports per session a day. Delete your account any time from the same screen.' },
  { title: 'Finish up',
```

In `src/pages/pickleball/how-it-works.astro`, find:

```astro
Free, with no sign-up for you or your players.</p>
```

Replace it with:

```astro
Free, with no sign-up for you or your players. Google sign-in is only for emailing yourself a DUPR export.</p>
```

In `src/pages/pickleball/index.astro`, find:

```astro
  { title: 'Free, with no sign-up', body: 'No accounts for the host or the players. Your host link is your key; the board link is view-only.' },
```

Replace it with:

```astro
  { title: 'Free, with no sign-up', body: 'No account to run a session, for the host or the players. Your host link is your key; the board link is view-only.' },
  { title: 'DUPR export', body: 'The host can email themselves a DUPR match file with every scored game whose four players have a DUPR ID, ready to upload as a club. Google sign-in is asked for this and nothing else.' },
```

In `src/pages/pickleball/index.astro`, find:

```astro
  { q: 'Can I run a tournament?',
```

Replace it with:

```astro
  { q: 'Can I send results to DUPR?', a: 'Yes, as the host. From More, choose Email me the DUPR export and sign in with Google. Games with a score and a DUPR ID for all four players arrive as a CSV to upload in DUPR as a Club Director or Organizer, with a list of any game left out and why.' },
  { q: 'I lost my host link. Can I get it back?', a: 'If you linked the session to Google for a DUPR export, open My sessions on any device and sign in with that account. Otherwise the host link is the only key, so keep it safe.' },
  { q: 'Can I run a tournament?',
```

- [ ] **Step 3: Update the copy guard**

`dupr` and `sign in` leave the banned list (they are shipped); claims of automatic submission join `UNBUILT_CLAIMS`; one new test pins the guide's DUPR wording to the code.

In `tests/e2e/pickleball/pickleball-public-pages.spec.js`, find:

```js
      for (const unshipped of ['dupr', 'sign in', 'opi', 'performance index', 'rally-by-rally', 'mexicano']) {
```

Replace it with:

```js
      // DUPR and sign-in are shipped (Phase 4): the host's DUPR export, with Google sign-in for it alone.
      for (const unshipped of ['opi', 'performance index', 'rally-by-rally', 'mexicano']) {
```

In `tests/e2e/pickleball/pickleball-public-pages.spec.js`, find:

```js
  const UNBUILT_CLAIMS = ['third-place', 'consolation', 'bracket reset', 'singles tournament', 'reseed']
```

Replace it with:

```js
  // The DUPR export is a CSV the host uploads: nothing is ever sent to DUPR by us, and no rating is shown.
  const UNBUILT_CLAIMS = ['third-place', 'consolation', 'bracket reset', 'singles tournament', 'reseed', 'dupr api', 'synced to dupr', 'sent to dupr automatically', 'dupr rating']
```

In `tests/e2e/pickleball/pickleball-public-pages.spec.js`, find:

```js
        expect(html, `${path} claims "${claim}", which is not built`).not.toContain(claim)
      }
    })
  }
```

Replace it with:

```js
        expect(html, `${path} claims "${claim}", which is not built`).not.toContain(claim)
      }
    })
  }

  // Every phrase maps to shipped code: the console's More menu item, DUPR_CLICK_PATH
  // (src/lib/pickleball/open/dupr/email.ts), the email's upload rule, DUPR_EXPORT_LIMIT
  // (dupr/policy.ts) and the My sessions page.
  test('the guide and FAQ describe the DUPR export exactly as shipped', async ({ page }) => {
    await page.goto('/pickleball/how-it-works')
    const guide = await mainCopy(page)
    for (const phrase of ['Email me the DUPR export', 'Matches → Add Matches → Import Matches via CSV', 'Club Director or Organizer', 'Up to 5 exports per session a day', 'My sessions']) {
      expect(guide).toContain(phrase)
    }
    await page.goto('/pickleball')
    const landing = await mainCopy(page)
    expect(landing).toContain('Can I send results to DUPR?')
    expect(landing).toContain('open My sessions on any device')
  })
```

- [ ] **Step 4: Write the e2e tests**

Append to the end of `tests/e2e/pickleball/open-host.spec.js`:

```js
test.describe('My sessions (screens)', () => {
  test('My sessions reopens a linked session as host on a new device', async ({ browser, request, baseURL }) => {
    const { code, email } = await readyToExport(request, baseURL)
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto('/pickleball/my-sessions')
    await expect(page.getByRole('link', { name: 'Sign in with Google' })).toHaveAttribute('href', '/api/pickleball/open/host/sign-in?return=%2Fpickleball%2Fmy-sessions')
    await signIn(page.request, baseURL, email, `${code}-device`)
    await page.reload()
    await page.getByRole('button', { name: 'Open Saturday Social as host' }).click()
    await expect(page).toHaveURL(new RegExp(`/pickleball/s/${code}$`))
    await expect(page.getByRole('button', { name: 'More' })).toBeVisible()
    await context.close()
  })

  for (const width of [390, 768, 1280, 1920]) {
    test(`the DUPR sheet and My sessions fit a ${width}px screen without sideways scrolling`, async ({ page, request, baseURL }) => {
      const { code, hostKey, email } = await readyToExport(request, baseURL)
      await page.setViewportSize({ width, height: 900 })
      await signIn(page.request, baseURL, email, `${code}-${width}`)
      await page.goto(`/pickleball/s/${code}#host=${hostKey}`)
      await page.getByRole('button', { name: 'More' }).click()
      await page.getByRole('button', { name: 'Email me the DUPR export' }).click()
      await expect(page.getByText('1 game can go to DUPR.')).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await page.goto('/pickleball/my-sessions')
      await expect(page.getByRole('button', { name: 'Open Saturday Social as host' })).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    })
  }
})
```

- [ ] **Step 5: Run them**

Run: `npm run build && npx playwright test tests/e2e/pickleball/open-host.spec.js tests/e2e/pickleball/pickleball-public-pages.spec.js --project=worker`
Expected: PASS: 16 in `open-host.spec.js`; in the public-pages spec everything except the known "services page links to the pickleball product" test (needs CMS content).

Run: `npx playwright test --project=static --project=mobile-safari --project=desktop-safari`
Expected: PASS apart from the same services-page test (the public-pages spec also runs on the preview server there).

- [ ] **Step 6: Commit**

Add under `### Added` in `## [Unreleased]`:

```markdown
- Free sessions: `/pickleball/my-sessions` lists a signed-in host's linked sessions and reopens one as host on any device. The host guide, landing page and FAQ describe the DUPR export and lost-link recovery; the copy guard now allows "DUPR" and "sign in" and bans claims of automatic DUPR submission or DUPR ratings.
```

```bash
git add src/pickleball-open/host/MySessionsApp.jsx src/pages/pickleball/my-sessions.astro src/pages/pickleball/how-it-works.astro src/pages/pickleball/index.astro tests/e2e/pickleball/pickleball-public-pages.spec.js tests/e2e/pickleball/open-host.spec.js CHANGELOG.md
git commit -m "feat(pickleball): my sessions page and dupr guide copy"
```

---

### Task 11: Docs, full verification, and the preview deploy (no release)

**Files:**
- Modify: `docs/pickleball/architecture.md` (after "### Phase 3 additions (tournaments)"; the phase table)
- Modify: `docs/pickleball/runbook.md` (after "### Inspect a tournament"; "### Troubleshooting"; "### Purge")
- Modify: `CHANGELOG.md` (docs line only; **no version bump**)

- [ ] **Step 1: Write the docs**

In `docs/pickleball/architecture.md`, after the "### Phase 3 additions (tournaments)" list (it ends with the "**Rate limit.**" bullet), add:

```markdown
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
- **Login.** The `devlab_pb_host` cookie holds an opaque token, not the host id
  (`hostSession.ts`): HttpOnly, Secure, SameSite=Lax, `Path=/api/pickleball/open`.
  Every write that trusts it must come from this site (`sameOrigin.ts`).
- **Google.** `hostAuth.ts` reuses `oauth.js` (PKCE) and the registered
  `/api/pickleball/auth/google/callback`, which hands host sign-ins to
  `finishHostSignIn` (the old operator branch goes in Phase 5). Outcomes return
  to the starting page as `?signin=…`.
- **Claim and access.** `OpenSessionDO` keeps `HostAccess` (claim and extra key
  hashes) beside the cached session and is its only writer: `claim` (host key +
  cookie, once), `reopen` (a new host link for the claiming account; the
  original keeps working), `forgetHost` (after an account is deleted). None of it
  is in any snapshot; the console reads it from `GET …/s/{code}/dupr`.
- **Export.** `src/lib/pickleball/open/dupr/` builds the CSV (pinned to
  `tests/fixtures/dupr-import-template.csv`) and the email; `prepareDuprExport`
  reserves one of 5 per rolling 24 hours, the route sends through Resend
  (`duprExport.ts`) and releases the reservation if sending failed. With
  `PICKLEBALL_TEST_AUTH_ENABLED=true` nothing is emailed and the response
  carries the message.
- **Phase 5.** `phase5Safety.test.ts` pins that none of this imports what
  Phase 5 deletes.
```

In the phase table, change the Open play row's status to "Phase 4 built (preview), release pending".

In `docs/pickleball/runbook.md`, after the "### Inspect a tournament" section, add:

````markdown
### Apply migration 0019

Same commands as 0018 (preview needs `CLOUDFLARE_ACCOUNT_ID` inline; the
preview deploy does not apply D1 migrations).

```bash
CLOUDFLARE_ACCOUNT_ID=<preview account ID> npx wrangler d1 migrations apply devlab-pickleball-preview --remote --env preview
```

Read back (expect four rows, then one):

```sql
SELECT name FROM sqlite_master WHERE name IN ('hosts', 'host_logins', 'open_host_keys', 'open_dupr_exports');
SELECT COUNT(*) FROM pragma_table_info('open_sessions') WHERE name = 'host_id';
```

### Host sign-in and the DUPR export

Needs `GOOGLE_OAUTH_CLIENT_ID` (var), `GOOGLE_OAUTH_CLIENT_SECRET` (secret),
`PICKLEBALL_OAUTH_REDIRECT_BASE_URL` (var), `RESEND_API_KEY` (secret) and
`RESEND_FROM_EMAIL` (var). `PICKLEBALL_TEST_AUTH_ENABLED` must be unset outside
local e2e: with it on, anyone can sign in as any email and no export is mailed.

- `?signin=unavailable`: the client id is missing or the placeholder, or the
  secret or redirect base is unset.
- `?signin=failed`: the in-flight cookie expired (10 minutes) or Google refused
  the code; `pickleball_open.host_signin_failed` in Workers Logs has the reason.
- `?signin=unverified`: the Google account has no verified email; it is not stored.
- Export 502: Resend refused or is unconfigured (`pickleball_open.dupr_email`,
  outcome `failure` or `skipped`); the export was not counted.
- A host says DUPR refused the file: compare the CSV header with
  `tests/fixtures/dupr-import-template.csv` and DUPR's current template; if
  DUPR changed it, update the fixture and `DUPR_COLUMNS` together.

```sql
-- Who claimed a session, and its exports in the last day
SELECT s.public_code, h.email, h.dupr_club_id FROM open_sessions s LEFT JOIN hosts h ON h.id = s.host_id WHERE s.public_code = ?;
SELECT sent_at, game_count, skipped_count FROM open_dupr_exports WHERE session_id = (SELECT id FROM open_sessions WHERE public_code = ?) ORDER BY sent_at;
```

Do not edit `host_id` or `open_host_keys` by hand: a running DO keeps its own
copy. To remove an account on request, the host uses "Delete my account"; if
they cannot, delete the `hosts` row (logins cascade, sessions unlink) and the
link disappears from a warm DO when it is next evicted.
````

In "### Troubleshooting", replace the "**Host lost their link:**" bullet with:

```markdown
- **Host lost their link:** the host key cannot be recovered. If the session
  was linked to Google for a DUPR export, the host signs in at
  `/pickleball/my-sessions` and reopens it (a new host link; at most 10 extra
  per session). Otherwise it expires on its own 7 days after its last activity.
```

In "### Purge", after the JSON example line, add: "The same run removes host logins older than 30 days and logs their count as `logins`."

```markdown
- Docs: architecture and runbook cover Phase 4 (accounts only for the export, migration 0019, the login cookie, the shared Google callback, claims and reopen, the DUPR export and its troubleshooting).
```

```bash
git add docs/pickleball CHANGELOG.md
git commit -m "docs(pickleball): document phase 4 host sign-in and dupr export"
```

- [ ] **Step 2: Full local verification**

Run: `npm run typecheck && npm run build && npm run test:unit && npm run lint`
Expected: all pass apart from the known `src/lead-engine/jobs/handlers.test.js` failure (present at `78f1432`).

Run: `npx playwright test`
Expected: the full suite passes, including `static`, `worker` and both Safari projects, apart from the known services-page link test.

- [ ] **Step 3: Check the preview's configuration, push `development`, apply 0019**

Ask the user to paste a fresh `CLOUDFLARE_API_TOKEN` for these commands (`AGENTS.md`). Use it inline only; never write it to a file or echo it.

Run: `CLOUDFLARE_API_TOKEN=<pasted> CLOUDFLARE_ACCOUNT_ID=<preview account ID> npx wrangler secret list --env preview`
Expected: `GOOGLE_OAUTH_CLIENT_SECRET` and `RESEND_API_KEY` are listed; `PICKLEBALL_TEST_AUTH_ENABLED` is **not**. If the Google secret is missing, stop and ask the owner to set it (`wrangler secret put GOOGLE_OAUTH_CLIENT_SECRET --env preview`); do not set it yourself.

Run: `git push origin development`
Expected: the preview deploy workflow runs and succeeds.

Run: `CLOUDFLARE_API_TOKEN=<pasted> CLOUDFLARE_ACCOUNT_ID=<preview account ID> npx wrangler d1 migrations apply devlab-pickleball-preview --remote --env preview`
Expected: `0019_hosts.sql` applied.

Read back with the two runbook queries. Expected: four rows, then `1`.

- [ ] **Step 4: Verify on the preview URL**

On `https://devlab-studios-preview.stpnrey-agustinez.workers.dev`, on a phone:
- **A session from before the deploy, if any is live:** opens as host; a result saves (the host check now reads extra keys too).
- **Create a session with 4 players with DUPR IDs and one without.** Play two games, one including the player without an ID.
- **More → Email me the DUPR export.** The news box is unticked. Sign in with a real Google account: Google's account picker appears, and you come back to the same console with the sheet open. Link the session, enter a Club ID, add the missing DUPR ID, send.
- **The email** arrives at that Google address from Devlab Pickleball, with the CSV attached (header identical to the fixture, one row per game), the upload steps, and Reply-To set. Send four more; the sixth is refused with "Try again in about … hours".
- **A second device:** sign in at `/pickleball/my-sessions` with the same account, open the session as host; the first phone still works.
- **The board and a captain link** show nothing about DUPR or sign-in.
- **Delete my account** from the sheet: My sessions now asks you to sign in, and the session's DUPR panel says it is not linked.

Report what was checked, and any failure, to the user. Mention that the privacy policy page (CMS content) does not yet describe the host account data; the owner should decide its wording. **Stop here.** The version bump, `[Unreleased]` retitle, production migration and `main` fast-forward happen in a separate release step with the user (`AGENTS.md`, "Versioning and releases").

- [ ] **Step 5: Housekeeping**

Stop any local `wrangler dev` or `npm run preview` servers this work started (`tasklist //FI "IMAGENAME eq node.exe"`).

---

## Self-review notes (for the executor)

**Spec coverage, Phase 4 (§14 row 4, §9, §3.2, §3.3, §13):**

| Requirement | Task(s) |
|---|---|
| "Email me the DUPR export" on the host console prompts Google sign-in, reusing `oauth.js` (PKCE) (§9.1) | T5 (sign-in), T9 (sheet and menu item) |
| `devlab_pb_host` cookie; `hosts` row on first sign-in; opt-in unticked by default (§9.1) | T1, T4, T5, T9 |
| Claim once, only by a host-key holder; export restricted to that account; viewer and captain never see the button (§9.2) | T6 (DO `claim`, route), T7 (`prepareDuprExport` refuses others), T9 (HostConsole only; e2e for board and captain) |
| DUPR Club ID entered once, saved on `hosts` (§9.3) | T4 (`PATCH …/me`), T9/T10 (`ClubIdForm`) |
| Players' DUPR IDs from check-in or the host's edits (§9.3) | T3 (`SET_PLAYER_DUPR_ID`), T9 (missing-ID inputs) |
| CSV layout, field values, games, no instruction rows, eligibility, skipped games with reasons, upload note (§9.4) | T2 (pinned fixture), T7 (email and attachment) |
| My sessions from any device; reopen as host (§9.5, §3.3, §15) | T6 (API), T10 (page) |
| Resend to the verified Google email with the CSV attached; 5 per session per day (§9.6) | T5 (verified only), T7 |
| `hosts` not subject to the 7-day expiry; "Delete my account" on the export screen (§3.2) | T1, T8, T9 (`HostAccount` in the sheet) |
| Claimed sessions still expire like any session (task brief, §8) | T1 (cascades; purge test), decision 13 |
| No DUPR or Reclub API calls (§9) | T7 sends only email; T10 copy guard bans "dupr api", "synced to dupr" |
| Phase 4 depends on nothing Phase 5 deletes except `oauth.js` (§12) | T5 (`phase5Safety.test.ts`) |
| Host Google sign-in tested through an env-gated test login (§13) | T4 (route), T6–T10 (e2e) |
| Abuse and limits (§10) | T4 (account and sign-in limits), T6–T7 (`hostIpLimited`), T7 (5 a day) |
| Public pages claim only shipped code (§11) | T10 |
| CHANGELOG line per commit; MINOR, no bump | every task; T11 |

**Deferred by design:**
- The optional offline PWA (§14 row 4 says "optional"; §2 calls it a stretch goal).
- The privacy policy page wording for host accounts (CMS content; flagged to the owner in T11).
- Direct DUPR submission and the Reclub partnership (business tracks, §9).
- Phase 5 removes `legacyOperatorCallback` and its imports from `callback.ts`.

**Covered by code review only:** the export route's release-on-failure branch. Test environments never send email (by design), so no e2e test can reach it; `sendDuprExport`'s `FAILED` results are unit-tested (T7) and the route's three lines are simple. Review them in T7.

**Names that cross tasks:**
- `HostRecord`, `HostProfile`, `HostSessionSummary`, `toHostProfile`, `upsertHost`, `createHostLogin`, `findHostByLogin`, `deleteHostLogin`, `updateHostProfile`, `deleteHost`, `listHostSessions`, `purgeExpiredHostLogins`, `LOGIN_TTL_MS`; `HostAccess`, `loadHostAccess`, `claimSession`, `insertHostKey`, `recentDuprExports`, `insertDuprExport`, `deleteDuprExport`, `MAX_EXTRA_HOST_KEYS` (T1).
- `DUPR_COLUMNS`, `DuprSkip`, `DuprExport`, `normalizeTimeZone`, `localDate`, `listNames`, `skipReason`, `buildDuprExport`; `DuprEmail`, `DUPR_CLICK_PATH`, `duprFilename`, `buildDuprEmail` (T2).
- `SET_PLAYER_DUPR_ID` (T3).
- `HOST_COOKIE`, `HOST_OAUTH_COOKIE`, `HOST_COOKIE_PATH`, `HOST_OAUTH_COOKIE_PATH`, `parseCookies`, `cookieFrom`, `setCookieHeader`, `clearCookieHeader`, `isSecure`; `isSameOrigin`, `crossSiteRefusal`; `currentHost`, `beginHostLogin`, `endHostLogin`, `signInFirst`, `hostAccountIpLimited`, `signInIpLimited`; `testLoginSchema`, `hostProfilePatchSchema`, `duprExportRequestSchema` (T4).
- `SignInResult`, `safeReturnPath`, `withSignInResult`, `startHostSignIn`, `hasHostSignInPending`, `finishHostSignIn`, `DEFAULT_RETURN_PATH` (T5).
- `DUPR_EXPORT_LIMIT`, `ClaimState`, `claimStateFor`, `exportWindowStart`, `exportsLeft`, `limitMessage`; DO `DuprStatusBody`, `duprStatus`, `claim`, `reopen`; e2e helpers `createSession`, `signIn`, `play`, `dupr`, `claim`, `setClubId`, `readyToExport`, `ipFor`, `uniqueEmail` (T6).
- `sendDuprExport`, `DuprDelivery`; DO `DuprPrepared`, `prepareDuprExport`, `releaseDuprExport`; e2e `exportDupr`, `TEMPLATE` (T7).
- DO `forgetHost`; `runHostLoginPurge` (T8).
- `readSignInResult`, `SIGN_IN_MESSAGES`, `signInHref`, `duprStep`, `exportSummary`, `sentMessage`; `ClubIdForm`, `HostAccount`, `DuprSheet`; `api.js` host calls (T9).
- `MySessionsApp` (T10).

**Verified while writing this plan:** every file in this plan was written into a scratch worktree, first of `a1fcaf3` and then moved onto `78f1432`, and checked there as a whole: `astro check` 0 errors; `eslint .` 0 problems; all unit tests pass (1888) apart from the `handlers.test.js` failure that also fails on a clean checkout; `npm run build` passes; migration `0019` applies to a local D1 through `wrangler d1 migrations apply --local`; and against `wrangler dev` with `0019` applied, `open-host.spec.js`, `open-play.spec.js`, `open-tournament.spec.js` and `pickleball-public-pages.spec.js` together passed 160 of 161 on `78f1432` (the one failure is the CMS-dependent services-page test). A script then checked that applying each task's Find/Replace blocks, in task order, to the files at `78f1432` (or to the file an earlier task creates) reproduces those tested files exactly. Intermediate states between tasks were checked by reading, not each re-run: re-run each task's own commands as you go.

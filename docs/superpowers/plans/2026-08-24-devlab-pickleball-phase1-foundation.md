# Devlab Pickleball — Phase 1 (Foundation) Implementation Plan

> **Superseded (2026-10-12).** This describes the logged-in operator app, retired in 2.0.0 by Phase 5 of `docs/superpowers/specs/2026-10-11-pickleball-free-open-play-design.md`. Kept as history: the routes, tables and files it names no longer exist.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the isolated Pickleball subsystem's foundation — its own D1 database, Google-OAuth-based multi-org auth with RBAC, and CRUD for organizations/memberships/players/venues/courts/sessions — with a minimal SPA shell an operator can actually log into.

**Architecture:** Astro `APIRoute` endpoints under `src/pages/api/pickleball/**` backed by plain-function D1 repositories under `src/worker/repositories/pickleball/` (no ORM), Zod-validated. Auth is a hand-rolled Google OAuth 2.0 + PKCE flow (raw `fetch` to Google's stable public endpoints, Web Crypto for PKCE/HMAC) issuing a stateless signed session cookie, styled after — but fully independent from — the existing `adminAuth.js` mechanism. The authenticated app is a React Router SPA island mounted under one Astro catch-all route, mirroring `admin-app/`.

**Tech Stack:** Astro 7 (SSR, Cloudflare adapter), Cloudflare D1 (raw SQL, no ORM), Zod v4, React 19 + react-router-dom v7, Tailwind 3.4, Vitest 4 (colocated unit tests), Playwright 1.62 (`worker` project against local `wrangler dev`).

**Spec:** `docs/superpowers/specs/2026-08-24-devlab-pickleball-design.md` (§2, §3, §4.1–§4.4, §11, §13)

**Deviation from spec, called out explicitly:** §3.2 of the spec suggested the `arctic` OAuth library. This plan hand-rolls the OAuth 2.0 + PKCE flow with raw `fetch` against Google's stable, publicly documented endpoints instead, because (a) it avoids depending on an exact third-party API surface this plan can't verify against the installed version, and (b) it matches this repo's one clear existing convention for auth-adjacent code — `adminAuth.js` hand-rolls PBKDF2/HMAC with the Web Crypto API rather than pulling in a library. PKCE itself is simple enough (random bytes → SHA-256 → base64url) that hand-rolling it carries no real security cost here.

## Global Constraints

- Pickleball data lives ONLY in `PICKLEBALL_DB` (a new, separate D1 database) — never in the CMS's `DB` binding, never as a CMS collection.
- All SQL is raw, via plain exported functions taking the D1 binding as the first argument — no ORM (matches `src/worker/repositories/*.js`).
- All table primary keys are `TEXT` UUIDs (`crypto.randomUUID()`); all timestamps are ISO-8601 UTC `TEXT`; enums are `CHECK` constraints; index names are `idx_<table>_<cols>` (matches `migrations/0001_cms_foundation.sql`).
- Zod validates every write endpoint's body; failures return `{ error, issues }` with HTTP 400 (matches `src/pages/api/admin/collections/[type]/index.ts`).
- No auth token (Google or session) is ever placed in `localStorage` or exposed to client JS. The session cookie is `HttpOnly; Secure; SameSite=Strict`.
- No secret (`GOOGLE_OAUTH_CLIENT_SECRET`, `PICKLEBALL_SESSION_SECRET`) is ever committed — placeholders only in `.env.example`, real values via `wrangler secret` / local `.dev.vars`.
- Role/permission checks happen server-side on every request, resolved from `organization_memberships` — never trusted from the client or the cookie payload beyond `activeOrgId` (a UX hint, re-verified every time).
- Migrations are additive-only: never edit an applied migration file, always add a new one (matches `docs/architecture/ARCHITECTURE.md`'s rollback rule).

---

## File Structure

```
migrations/pickleball/0001_foundation.sql          new — schema for this phase

wrangler.jsonc                                      modify — PICKLEBALL_DB binding (+ preview)
.env.example                                         modify — new var placeholders
src/env.d.ts                                         modify — Env interface + Locals

src/lib/pickleball/webCrypto.js                      new — base64url, random bytes, sha256, HMAC sign/verify (pure)
src/lib/pickleball/permissions.ts                    new — role → permission matrix (pure)
src/worker/pickleball/session.js                     new — session cookie sign/verify + cookie helpers
src/worker/pickleball/oauth.js                       new — PKCE pair, Google authorization URL, code exchange, profile fetch
src/worker/pickleball/authContext.js                 new — resolveSessionForGoogleProfile, requirePickleballSession, rate limiter

src/lib/schemas/pickleball/organizations.ts           new — Zod schemas: membership invite
src/lib/schemas/pickleball/players.ts                 new
src/lib/schemas/pickleball/venues.ts                  new
src/lib/schemas/pickleball/courts.ts                  new
src/lib/schemas/pickleball/sessions.ts                new

src/worker/repositories/pickleball/organizations.js   new
src/worker/repositories/pickleball/users.js           new
src/worker/repositories/pickleball/memberships.js     new
src/worker/repositories/pickleball/players.js         new
src/worker/repositories/pickleball/venues.js          new
src/worker/repositories/pickleball/courts.js          new
src/worker/repositories/pickleball/sessions.js        new

src/pages/api/pickleball/auth/google/start.ts         new
src/pages/api/pickleball/auth/google/callback.ts      new
src/pages/api/pickleball/auth/session.ts              new
src/pages/api/pickleball/auth/logout.ts               new
src/pages/api/pickleball/auth/switch-org.ts           new
src/pages/api/pickleball/auth/test-login.ts           new — test-only bypass, env-gated
src/pages/api/pickleball/organizations/[id]/memberships.ts   new
src/pages/api/pickleball/players/index.ts             new
src/pages/api/pickleball/players/[id].ts               new
src/pages/api/pickleball/venues/index.ts               new
src/pages/api/pickleball/venues/[id].ts                 new
src/pages/api/pickleball/courts/index.ts               new
src/pages/api/pickleball/courts/[id].ts                  new
src/pages/api/pickleball/sessions/index.ts              new
src/pages/api/pickleball/sessions/[id].ts                 new

src/middleware.ts                                      modify — pickleball auth gate

src/pickleball-app/PickleballApp.jsx                    new
src/pickleball-app/components/AppShell.jsx               new
src/pickleball-app/pages/LoginPage.jsx                    new
src/pickleball-app/pages/DashboardPage.jsx                new
src/pages/pickleball/app/[...path].astro                  new
src/pages/pickleball/index.astro                            new — minimal public landing

scripts/pickleball/create-organization.mjs                 new — bootstrap script

tests/e2e/pickleball/pickleball-auth.spec.js                new
tests/e2e/pickleball/pickleball-crud.spec.js                  new
playwright.config.js                                          modify — register new spec under `worker` project
```

---

### Task 1: Provision the Pickleball D1 database and wire bindings

**Files:**
- Modify: `wrangler.jsonc`
- Modify: `.env.example`
- Modify: `src/env.d.ts`

**Interfaces:**
- Produces: `Env.PICKLEBALL_DB: D1Database`, `Env.GOOGLE_OAUTH_CLIENT_ID`, `Env.GOOGLE_OAUTH_CLIENT_SECRET`, `Env.PICKLEBALL_SESSION_SECRET`, `Env.PICKLEBALL_OAUTH_REDIRECT_BASE_URL`, `Env.PICKLEBALL_TEST_AUTH_ENABLED` — consumed by every later task's D1/auth code.

- [ ] **Step 1: Create the two D1 databases**

Run:
```bash
npx wrangler d1 create devlab-pickleball
npx wrangler d1 create devlab-pickleball-preview
```
Note the `database_id` printed for each — you'll need both in Step 2.

- [ ] **Step 2: Add the bindings to `wrangler.jsonc`**

Add to the root `d1_databases` array (alongside the existing `DB` entry):
```jsonc
{
  "binding": "PICKLEBALL_DB",
  "database_name": "devlab-pickleball",
  "database_id": "<paste id from Step 1>"
}
```
Add to the `env.preview.d1_databases` array:
```jsonc
{
  "binding": "PICKLEBALL_DB",
  "database_name": "devlab-pickleball-preview",
  "database_id": "<paste preview id from Step 1>"
}
```
Add to the root `vars` object: `"PICKLEBALL_OAUTH_REDIRECT_BASE_URL": "https://www.devlabstudios.com"`. Add the same key to `env.preview.vars` with the preview domain. `GOOGLE_OAUTH_CLIENT_ID` is not a secret (it's public) — add it to both `vars` blocks once you have it from Google Cloud Console; use the placeholder `"REPLACE_ME"` for now if it isn't provisioned yet, and note this in the PR description.

- [ ] **Step 3: Add secret placeholders to `.env.example`**

Add:
```
# Pickleball — Google OAuth (see docs/pickleball/runbook.md)
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
PICKLEBALL_SESSION_SECRET=
PICKLEBALL_OAUTH_REDIRECT_BASE_URL=http://localhost:4321
# Never set outside local/CI wrangler dev — enables POST /api/pickleball/auth/test-login
PICKLEBALL_TEST_AUTH_ENABLED=
```

- [ ] **Step 4: Add matching secrets to your local `.dev.vars`**

Append (do not remove existing CMS lines already in that file):
```
GOOGLE_OAUTH_CLIENT_ID=<your local Google OAuth client id>
GOOGLE_OAUTH_CLIENT_SECRET=<your local Google OAuth client secret>
PICKLEBALL_SESSION_SECRET=<any long random string>
PICKLEBALL_OAUTH_REDIRECT_BASE_URL=http://localhost:8787
PICKLEBALL_TEST_AUTH_ENABLED=true
```

- [ ] **Step 5: Extend `src/env.d.ts`**

```typescript
interface Env {
  DB: D1Database
  MEDIA_BUCKET: R2Bucket
  SESSION: KVNamespace
  ADMIN_AUTH_MODE?: string
  R2_PUBLIC_BASE_URL?: string
  RESEND_API_KEY?: string
  RESEND_FROM_EMAIL?: string
  LEAD_NOTIFICATION_EMAIL?: string
  ADMIN_EMAIL?: string
  ADMIN_PASSWORD_HASH?: string
  ADMIN_SESSION_SECRET?: string
  ADMIN_USERS?: string
  TURNSTILE_SITE_KEY?: string
  TURNSTILE_SECRET_KEY?: string
  PICKLEBALL_DB: D1Database
  GOOGLE_OAUTH_CLIENT_ID?: string
  GOOGLE_OAUTH_CLIENT_SECRET?: string
  PICKLEBALL_SESSION_SECRET?: string
  PICKLEBALL_OAUTH_REDIRECT_BASE_URL?: string
  PICKLEBALL_TEST_AUTH_ENABLED?: string
}

declare namespace App {
  interface Locals {
    adminEmail?: string
    adminRole?: string
    adminAuthMode?: string
    cfContext?: { waitUntil(promise: Promise<unknown>): void }
    pickleballSession?: { userId: string; googleSub: string; activeOrgId: string | null; exp: number }
  }
}
```

- [ ] **Step 6: Verify**

Run: `npx wrangler d1 execute devlab-pickleball --local --command "SELECT 1"`
Expected: a successful result set (proves the local binding resolves before any migration exists).

- [ ] **Step 7: Commit**

```bash
git add wrangler.jsonc .env.example src/env.d.ts
git commit -m "chore: provision Pickleball D1 database and env bindings"
```

---

### Task 2: Foundation schema migration

**Files:**
- Create: `migrations/pickleball/0001_foundation.sql`
- Modify: `wrangler.jsonc` — add `"migrations_dir": "migrations/pickleball"` to the `PICKLEBALL_DB` entry (root and `env.preview`) and `"migrations_dir": "migrations"` to the existing CMS `DB` entry (root and `env.preview`). **Required, not optional**: without this, `wrangler d1 migrations apply` defaults every `d1_databases` entry to the same `./migrations` folder, so applying migrations to `devlab-pickleball` would apply the CMS's 7 migrations into it — exactly the cross-contamination the design forbids. The CMS-side addition is behavior-preserving (it names the folder D1 already defaulted to).

**Interfaces:**
- Produces: tables `organizations`, `users`, `organization_memberships`, `players`, `venues`, `courts`, `scoring_rulesets`, `pickleball_sessions`, `session_courts`, `public_session_tokens`, `session_operator_grants` — consumed by every repository task below.

- [ ] **Step 1: Write the migration**

```sql
-- Pickleball Phase 1: identity, tenancy, RBAC, and the core venue/court/
-- session entities every later phase builds on. Lives in its own D1
-- database (PICKLEBALL_DB) — never the CMS's `devlab-studios-cms` — see
-- docs/superpowers/specs/2026-08-24-devlab-pickleball-design.md §2.

CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  google_sub TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  avatar_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Invite-only: an ADMIN creates a membership row for an email before that
-- person ever signs in. Sign-in only grants access if a matching ACTIVE
-- row exists for the authenticated Google account's email.
CREATE TABLE IF NOT EXISTS organization_memberships (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  user_id TEXT,
  invited_email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('ADMIN', 'SESSION_FACILITATOR', 'SCOREKEEPER')),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVOKED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_memberships_org_email ON organization_memberships(organization_id, invited_email);
CREATE INDEX IF NOT EXISTS idx_memberships_user ON organization_memberships(user_id);

CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  linked_user_id TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  public_visible INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (linked_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_players_org_active ON players(organization_id, active);
CREATE INDEX IF NOT EXISTS idx_players_org_normalized_name ON players(organization_id, normalized_name);

CREATE TABLE IF NOT EXISTS venues (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  name TEXT NOT NULL,
  address TEXT,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_venues_org ON venues(organization_id);

CREATE TABLE IF NOT EXISTS courts (
  id TEXT PRIMARY KEY,
  venue_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 999,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_courts_venue_sort ON courts(venue_id, sort_order);

CREATE TABLE IF NOT EXISTS scoring_rulesets (
  id TEXT PRIMARY KEY,
  organization_id TEXT,
  name TEXT NOT NULL,
  rules_version TEXT NOT NULL,
  scoring_method TEXT NOT NULL DEFAULT 'SIDE_OUT' CHECK (scoring_method IN ('SIDE_OUT')),
  target_score INTEGER NOT NULL,
  win_by INTEGER NOT NULL DEFAULT 2,
  format TEXT NOT NULL CHECK (format IN ('SINGLES', 'DOUBLES')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_rulesets_org_active ON scoring_rulesets(organization_id, active);

CREATE TABLE IF NOT EXISTS pickleball_sessions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  venue_id TEXT NOT NULL,
  name TEXT NOT NULL,
  session_type TEXT NOT NULL CHECK (session_type IN ('OPEN_PLAY', 'FIXED_PAIRS')),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'OPEN_FOR_CHECKIN', 'LIVE', 'PAUSED', 'COMPLETED', 'CANCELLED')),
  scoring_ruleset_id TEXT NOT NULL,
  scheduled_start TEXT NOT NULL,
  scheduled_end TEXT NOT NULL,
  actual_start TEXT,
  actual_end TEXT,
  post_game_rotation_policy TEXT NOT NULL DEFAULT 'AUTO_REQUEUE_ALL' CHECK (post_game_rotation_policy IN ('AUTO_REQUEUE_ALL', 'MANUAL_REQUEUE')),
  leaderboard_min_games INTEGER NOT NULL DEFAULT 3,
  public_view_enabled INTEGER NOT NULL DEFAULT 1,
  public_leaderboard_enabled INTEGER NOT NULL DEFAULT 1,
  created_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE,
  FOREIGN KEY (scoring_ruleset_id) REFERENCES scoring_rulesets(id)
);

CREATE INDEX IF NOT EXISTS idx_sessions_org_status ON pickleball_sessions(organization_id, status);

CREATE TABLE IF NOT EXISTS session_courts (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  court_id TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE', 'ASSIGNED', 'WARMUP', 'PLAYING', 'FINISHING', 'OUT_OF_SERVICE')),
  current_game_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES pickleball_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (court_id) REFERENCES courts(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_session_courts_session_court ON session_courts(session_id, court_id);

CREATE TABLE IF NOT EXISTS public_session_tokens (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  public_code TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY (session_id) REFERENCES pickleball_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_public_tokens_session ON public_session_tokens(session_id);

CREATE TABLE IF NOT EXISTS session_operator_grants (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  granted_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES pickleball_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_operator_grants_session_user ON session_operator_grants(session_id, user_id);
```

- [ ] **Step 2: Apply locally and verify**

Run:
```bash
npx wrangler d1 migrations apply devlab-pickleball --local
npx wrangler d1 execute devlab-pickleball --local --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
```
Expected: all 11 tables listed above appear in the output.

- [ ] **Step 3: Commit**

```bash
git add migrations/pickleball/0001_foundation.sql
git commit -m "feat: add Pickleball foundation schema migration"
```

---

### Task 3: Shared Web Crypto helpers

**Files:**
- Create: `src/lib/pickleball/webCrypto.js`
- Test: `src/lib/pickleball/webCrypto.test.js`

**Interfaces:**
- Produces: `textBytes(value: string): Uint8Array`, `bytesToBase64Url(bytes: Uint8Array): string`, `base64UrlToBytes(value: string): Uint8Array`, `randomBase64Url(byteLength: number): string`, `sha256Base64Url(value: string): Promise<string>`, `hmacSign(payload: string, secret: string): Promise<string>`, `hmacVerify(payload: string, signature: string, secret: string): Promise<boolean>` — consumed by Tasks 5 and 7.

- [ ] **Step 1: Write the failing test**

```javascript
import { describe, it, expect } from 'vitest'
import { bytesToBase64Url, base64UrlToBytes, randomBase64Url, sha256Base64Url, hmacSign, hmacVerify } from './webCrypto.js'

describe('base64url roundtrip', () => {
  it('encodes and decodes bytes without padding or unsafe characters', () => {
    const original = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255])
    const encoded = bytesToBase64Url(original)
    expect(encoded).not.toMatch(/[+/=]/)
    expect(base64UrlToBytes(encoded)).toEqual(original)
  })
})

describe('randomBase64Url', () => {
  it('produces a different value on each call', () => {
    expect(randomBase64Url(32)).not.toBe(randomBase64Url(32))
  })
})

describe('sha256Base64Url', () => {
  it('is deterministic for the same input', async () => {
    const a = await sha256Base64Url('code-verifier-value')
    const b = await sha256Base64Url('code-verifier-value')
    expect(a).toBe(b)
  })

  it('differs for different input', async () => {
    const a = await sha256Base64Url('one')
    const b = await sha256Base64Url('two')
    expect(a).not.toBe(b)
  })
})

describe('hmacSign / hmacVerify', () => {
  it('verifies a signature produced with the same secret', async () => {
    const signature = await hmacSign('payload', 'secret-value')
    expect(await hmacVerify('payload', signature, 'secret-value')).toBe(true)
  })

  it('rejects a signature produced with a different secret', async () => {
    const signature = await hmacSign('payload', 'secret-value')
    expect(await hmacVerify('payload', signature, 'wrong-secret')).toBe(false)
  })

  it('rejects a tampered payload', async () => {
    const signature = await hmacSign('payload', 'secret-value')
    expect(await hmacVerify('tampered', signature, 'secret-value')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/pickleball/webCrypto.test.js`
Expected: FAIL — `webCrypto.js` does not exist yet.

- [ ] **Step 3: Implement**

```javascript
export function textBytes(value) {
  return new TextEncoder().encode(value)
}

export function bytesToBase64Url(bytes) {
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export function base64UrlToBytes(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return bytes
}

export function randomBase64Url(byteLength) {
  const bytes = new Uint8Array(byteLength)
  crypto.getRandomValues(bytes)
  return bytesToBase64Url(bytes)
}

export async function sha256Base64Url(value) {
  const digest = await crypto.subtle.digest('SHA-256', textBytes(value))
  return bytesToBase64Url(new Uint8Array(digest))
}

async function getHmacKey(secret) {
  return crypto.subtle.importKey('raw', textBytes(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

export async function hmacSign(payload, secret) {
  const key = await getHmacKey(secret)
  const signature = await crypto.subtle.sign('HMAC', key, textBytes(payload))
  return bytesToBase64Url(new Uint8Array(signature))
}

export async function hmacVerify(payload, signature, secret) {
  const key = await getHmacKey(secret)
  try {
    return await crypto.subtle.verify('HMAC', key, base64UrlToBytes(signature), textBytes(payload))
  } catch {
    return false
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/pickleball/webCrypto.test.js`
Expected: PASS (all 7 assertions)

- [ ] **Step 5: Commit**

```bash
git add src/lib/pickleball/webCrypto.js src/lib/pickleball/webCrypto.test.js
git commit -m "feat: add Pickleball Web Crypto helpers"
```

---

### Task 4: Permission matrix

**Files:**
- Create: `src/lib/pickleball/permissions.ts`
- Test: `src/lib/pickleball/permissions.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `type Role = 'ADMIN' | 'SESSION_FACILITATOR' | 'SCOREKEEPER'`, `type Permission = ...` (full list below), `can(role: Role, permission: Permission): boolean` — consumed by every API route task (6, 9, 10, 11, 12, 13).

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest'
import { can } from './permissions'

describe('can', () => {
  it('grants ADMIN every permission', () => {
    expect(can('ADMIN', 'MANAGE_OPERATORS')).toBe(true)
    expect(can('ADMIN', 'SCORE_GAME')).toBe(true)
  })

  it('grants SESSION_FACILITATOR session-management but not operator management', () => {
    expect(can('SESSION_FACILITATOR', 'MANAGE_SESSIONS')).toBe(true)
    expect(can('SESSION_FACILITATOR', 'MANAGE_OPERATORS')).toBe(false)
  })

  it('grants SCOREKEEPER only scoring-adjacent permissions', () => {
    expect(can('SCOREKEEPER', 'SCORE_GAME')).toBe(true)
    expect(can('SCOREKEEPER', 'FINISH_GAME')).toBe(true)
    expect(can('SCOREKEEPER', 'UNDO_SCORE_EVENT')).toBe(true)
    expect(can('SCOREKEEPER', 'REOPEN_GAME')).toBe(false)
    expect(can('SCOREKEEPER', 'MANAGE_QUEUE')).toBe(false)
  })

  it('returns false for an unrecognized role', () => {
    // @ts-expect-error — deliberately passing an invalid role to prove the function fails closed
    expect(can('NOT_A_ROLE', 'SCORE_GAME')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/pickleball/permissions.test.ts`
Expected: FAIL — `permissions.ts` does not exist yet.

- [ ] **Step 3: Implement**

```typescript
export type Role = 'ADMIN' | 'SESSION_FACILITATOR' | 'SCOREKEEPER'

export type Permission =
  | 'MANAGE_VENUES_COURTS'
  | 'MANAGE_OPERATORS'
  | 'MANAGE_SESSIONS'
  | 'MANAGE_PLAYERS'
  | 'CHECK_IN_PLAYERS'
  | 'MANAGE_QUEUE'
  | 'ASSIGN_COURT'
  | 'SCORE_GAME'
  | 'FINISH_GAME'
  | 'UNDO_SCORE_EVENT'
  | 'REOPEN_GAME'
  | 'CORRECT_GAME'
  | 'VIEW_AUDIT_LOG'
  | 'CONFIGURE_SYSTEM_DEFAULTS'

const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  ADMIN: new Set<Permission>([
    'MANAGE_VENUES_COURTS',
    'MANAGE_OPERATORS',
    'MANAGE_SESSIONS',
    'MANAGE_PLAYERS',
    'CHECK_IN_PLAYERS',
    'MANAGE_QUEUE',
    'ASSIGN_COURT',
    'SCORE_GAME',
    'FINISH_GAME',
    'UNDO_SCORE_EVENT',
    'REOPEN_GAME',
    'CORRECT_GAME',
    'VIEW_AUDIT_LOG',
    'CONFIGURE_SYSTEM_DEFAULTS',
  ]),
  SESSION_FACILITATOR: new Set<Permission>([
    'MANAGE_VENUES_COURTS',
    'MANAGE_SESSIONS',
    'MANAGE_PLAYERS',
    'CHECK_IN_PLAYERS',
    'MANAGE_QUEUE',
    'ASSIGN_COURT',
    'SCORE_GAME',
    'FINISH_GAME',
    'UNDO_SCORE_EVENT',
    'REOPEN_GAME',
    'CORRECT_GAME',
  ]),
  SCOREKEEPER: new Set<Permission>(['SCORE_GAME', 'FINISH_GAME', 'UNDO_SCORE_EVENT']),
}

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.has(permission) ?? false
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/pickleball/permissions.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/pickleball/permissions.ts src/lib/pickleball/permissions.test.ts
git commit -m "feat: add Pickleball role permission matrix"
```

---

### Task 5: Session cookie module

**Files:**
- Create: `src/worker/pickleball/session.js`
- Test: `src/worker/pickleball/session.test.js`

**Interfaces:**
- Consumes: `hmacSign`, `hmacVerify`, `textBytes` from `src/lib/pickleball/webCrypto.js` (Task 3)
- Produces: `SESSION_COOKIE_NAME` (string constant), `signSession(payload: object, secret: string): Promise<string>`, `verifySession(token: string, secret: string): Promise<object|null>`, `parseCookies(cookieHeader: string): Record<string,string>`, `buildSetCookieHeader(name: string, value: string, { secure: boolean, maxAgeSeconds: number }): string`, `buildClearCookieHeader(name: string, { secure: boolean }): string` — consumed by Tasks 8, 9.

- [ ] **Step 1: Write the failing test**

```javascript
import { describe, it, expect } from 'vitest'
import { signSession, verifySession, parseCookies, buildSetCookieHeader, buildClearCookieHeader, SESSION_COOKIE_NAME } from './session.js'

describe('signSession / verifySession', () => {
  it('round-trips a payload signed with the same secret', async () => {
    const now = Math.floor(Date.now() / 1000)
    const token = await signSession({ userId: 'user-1', exp: now + 3600 }, 'secret-a')
    const result = await verifySession(token, 'secret-a')
    expect(result).toMatchObject({ userId: 'user-1' })
  })

  it('rejects a token signed with a different secret', async () => {
    const now = Math.floor(Date.now() / 1000)
    const token = await signSession({ userId: 'user-1', exp: now + 3600 }, 'secret-a')
    expect(await verifySession(token, 'secret-b')).toBeNull()
  })

  it('rejects an expired token', async () => {
    const past = Math.floor(Date.now() / 1000) - 10
    const token = await signSession({ userId: 'user-1', exp: past }, 'secret-a')
    expect(await verifySession(token, 'secret-a')).toBeNull()
  })

  it('rejects a malformed token', async () => {
    expect(await verifySession('not-a-real-token', 'secret-a')).toBeNull()
  })
})

describe('parseCookies', () => {
  it('parses a Cookie header into a map', () => {
    expect(parseCookies('a=1; b=2')).toEqual({ a: '1', b: '2' })
  })

  it('returns an empty object for an empty header', () => {
    expect(parseCookies('')).toEqual({})
    expect(parseCookies(undefined)).toEqual({})
  })
})

describe('buildSetCookieHeader / buildClearCookieHeader', () => {
  it('includes HttpOnly, SameSite=Strict, and Secure when requested', () => {
    const header = buildSetCookieHeader(SESSION_COOKIE_NAME, 'token-value', { secure: true, maxAgeSeconds: 3600 })
    expect(header).toContain('HttpOnly')
    expect(header).toContain('SameSite=Strict')
    expect(header).toContain('Secure')
    expect(header).toContain('Max-Age=3600')
  })

  it('omits Secure when not requested (local http dev)', () => {
    const header = buildSetCookieHeader(SESSION_COOKIE_NAME, 'token-value', { secure: false, maxAgeSeconds: 3600 })
    expect(header).not.toContain('Secure')
  })

  it('clears the cookie with Max-Age=0', () => {
    expect(buildClearCookieHeader(SESSION_COOKIE_NAME, { secure: true })).toContain('Max-Age=0')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/worker/pickleball/session.test.js`
Expected: FAIL — `session.js` does not exist yet.

- [ ] **Step 3: Implement**

```javascript
import { hmacSign, hmacVerify, bytesToBase64Url, base64UrlToBytes, textBytes } from '../../lib/pickleball/webCrypto.js'

export const SESSION_COOKIE_NAME = 'devlab_pb_session'

export async function signSession(payload, secret) {
  const encodedPayload = bytesToBase64Url(textBytes(JSON.stringify(payload)))
  const signature = await hmacSign(encodedPayload, secret)
  return `v1.${encodedPayload}.${signature}`
}

export async function verifySession(token, secret) {
  const [version, encodedPayload, signature] = String(token || '').split('.')
  if (version !== 'v1' || !encodedPayload || !signature) return null

  const isValid = await hmacVerify(encodedPayload, signature, secret)
  if (!isValid) return null

  try {
    const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(encodedPayload)))
    if (!payload.exp || Date.now() >= payload.exp * 1000) return null
    return payload
  } catch {
    return null
  }
}

export function parseCookies(cookieHeader) {
  return String(cookieHeader || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const separatorIndex = part.indexOf('=')
      if (separatorIndex === -1) return cookies

      const name = part.slice(0, separatorIndex).trim()
      const value = part.slice(separatorIndex + 1).trim()
      cookies[name] = value
      return cookies
    }, {})
}

export function buildSetCookieHeader(name, value, { secure, maxAgeSeconds }) {
  const secureFlag = secure ? '; Secure' : ''
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Strict${secureFlag}; Max-Age=${maxAgeSeconds}`
}

export function buildClearCookieHeader(name, { secure }) {
  return buildSetCookieHeader(name, '', { secure, maxAgeSeconds: 0 })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/worker/pickleball/session.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/worker/pickleball/session.js src/worker/pickleball/session.test.js
git commit -m "feat: add Pickleball session cookie module"
```

---

### Task 6: Google OAuth helpers

**Files:**
- Create: `src/worker/pickleball/oauth.js`
- Test: `src/worker/pickleball/oauth.test.js`

**Interfaces:**
- Consumes: `randomBase64Url`, `sha256Base64Url` from `src/lib/pickleball/webCrypto.js` (Task 3)
- Produces: `generatePkcePair(): Promise<{ verifier: string, challenge: string }>`, `buildGoogleAuthorizationUrl({ clientId, redirectUri, state, codeChallenge, scopes }): string`, `exchangeGoogleCode({ code, codeVerifier, clientId, clientSecret, redirectUri }): Promise<{ accessToken: string }>`, `fetchGoogleProfile(accessToken: string): Promise<{ sub: string, email: string, name: string, picture: string }>` — consumed by Task 9.

- [ ] **Step 1: Write the failing test**

```javascript
import { describe, it, expect } from 'vitest'
import { generatePkcePair, buildGoogleAuthorizationUrl } from './oauth.js'
import { sha256Base64Url } from '../../lib/pickleball/webCrypto.js'

describe('generatePkcePair', () => {
  it('produces a challenge that is the SHA-256/base64url of the verifier', async () => {
    const { verifier, challenge } = await generatePkcePair()
    expect(challenge).toBe(await sha256Base64Url(verifier))
  })

  it('produces a different verifier on each call', async () => {
    const first = await generatePkcePair()
    const second = await generatePkcePair()
    expect(first.verifier).not.toBe(second.verifier)
  })
})

describe('buildGoogleAuthorizationUrl', () => {
  it('targets the Google authorization endpoint with PKCE and state params', () => {
    const url = new URL(buildGoogleAuthorizationUrl({
      clientId: 'client-123',
      redirectUri: 'https://example.com/callback',
      state: 'state-value',
      codeChallenge: 'challenge-value',
      scopes: ['openid', 'email', 'profile'],
    }))

    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(url.searchParams.get('client_id')).toBe('client-123')
    expect(url.searchParams.get('redirect_uri')).toBe('https://example.com/callback')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('state')).toBe('state-value')
    expect(url.searchParams.get('code_challenge')).toBe('challenge-value')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('scope')).toBe('openid email profile')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/worker/pickleball/oauth.test.js`
Expected: FAIL — `oauth.js` does not exist yet.

- [ ] **Step 3: Implement**

```javascript
import { randomBase64Url, sha256Base64Url } from '../../lib/pickleball/webCrypto.js'

const GOOGLE_AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const GOOGLE_USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo'

export async function generatePkcePair() {
  const verifier = randomBase64Url(32)
  const challenge = await sha256Base64Url(verifier)
  return { verifier, challenge }
}

export function buildGoogleAuthorizationUrl({ clientId, redirectUri, state, codeChallenge, scopes }) {
  const url = new URL(GOOGLE_AUTHORIZATION_ENDPOINT)
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('state', state)
  url.searchParams.set('code_challenge', codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('scope', scopes.join(' '))
  url.searchParams.set('access_type', 'online')
  return url.toString()
}

export async function exchangeGoogleCode({ code, codeVerifier, clientId, clientSecret, redirectUri }) {
  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      code_verifier: codeVerifier,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  })

  if (!response.ok) {
    const error = new Error('Google OAuth code exchange failed.')
    error.status = 502
    throw error
  }

  const body = await response.json()
  return { accessToken: body.access_token }
}

export async function fetchGoogleProfile(accessToken) {
  const response = await fetch(GOOGLE_USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!response.ok) {
    const error = new Error('Failed to fetch Google profile.')
    error.status = 502
    throw error
  }

  const body = await response.json()
  return { sub: body.sub, email: body.email, name: body.name || body.email, picture: body.picture || '' }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/worker/pickleball/oauth.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/worker/pickleball/oauth.js src/worker/pickleball/oauth.test.js
git commit -m "feat: add hand-rolled Google OAuth PKCE helpers"
```

---

### Task 7: Repositories — organizations, users, memberships

**Files:**
- Create: `src/worker/repositories/pickleball/organizations.js`
- Create: `src/worker/repositories/pickleball/users.js`
- Create: `src/worker/repositories/pickleball/memberships.js`

**Interfaces:**
- Produces:
  - `upsertUserByGoogleSub(db, { googleSub, email, name, avatarUrl }): Promise<User>`
  - `listActiveMembershipsForEmail(db, email): Promise<Membership[]>`
  - `getMembership(db, { organizationId, userId }): Promise<Membership|null>`
  - `createMembership(db, { organizationId, invitedEmail, role, invitedByUserId }): Promise<Membership>`
  - `listMembershipsForOrganization(db, organizationId): Promise<Membership[]>`
  - `linkMembershipUser(db, { organizationId, invitedEmail, userId }): Promise<void>` — **critical**: must be called after every successful Google (or test) login for each active membership matching the authenticated email, otherwise `organization_memberships.user_id` stays NULL forever and `getMembership(organizationId, userId)` — which `requirePickleballSession` depends on for every request — will never find a match. Task 9 wires this in.
  - `getUserByGoogleSub(db, googleSub): Promise<User|null>`
  - `getOrganization(db, id): Promise<Organization|null>`
  - `createOrganization(db, { name, slug }): Promise<Organization>`
- Consumed by Tasks 8, 9, and the organizations API route.

These are exercised end-to-end by Task 16's Playwright suite (this repo's established convention — see `src/worker/repositories/projects.test.js`, which only unit-tests pure helpers and leaves DB-touching functions to Playwright against real D1). No Vitest step in this task; correctness is verified when Task 16 runs.

- [ ] **Step 1: Implement `organizations.js`**

```javascript
import { nowIso } from '../../utils/responses.js'

function toOrganization(row) {
  if (!row) return null
  return { id: row.id, name: row.name, slug: row.slug, createdAt: row.created_at, updatedAt: row.updated_at }
}

export async function getOrganization(db, id) {
  const row = await db.prepare('SELECT id, name, slug, created_at, updated_at FROM organizations WHERE id = ?').bind(id).first()
  return toOrganization(row)
}

export async function createOrganization(db, { name, slug }) {
  const id = crypto.randomUUID()
  const timestamp = nowIso()

  await db
    .prepare('INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .bind(id, name, slug, timestamp, timestamp)
    .run()

  return getOrganization(db, id)
}
```

- [ ] **Step 2: Implement `users.js`**

```javascript
import { nowIso } from '../../utils/responses.js'

function toUser(row) {
  if (!row) return null
  return {
    id: row.id,
    googleSub: row.google_sub,
    email: row.email,
    name: row.name,
    avatarUrl: row.avatar_url || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function getUserByGoogleSub(db, googleSub) {
  const row = await db
    .prepare('SELECT id, google_sub, email, name, avatar_url, created_at, updated_at FROM users WHERE google_sub = ?')
    .bind(googleSub)
    .first()
  return toUser(row)
}

export async function upsertUserByGoogleSub(db, { googleSub, email, name, avatarUrl }) {
  const existing = await getUserByGoogleSub(db, googleSub)
  const timestamp = nowIso()

  if (existing) {
    await db
      .prepare('UPDATE users SET email = ?, name = ?, avatar_url = ?, updated_at = ? WHERE id = ?')
      .bind(email, name, avatarUrl || '', timestamp, existing.id)
      .run()
    return getUserByGoogleSub(db, googleSub)
  }

  const id = crypto.randomUUID()
  await db
    .prepare(
      `INSERT INTO users (id, google_sub, email, name, avatar_url, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, googleSub, email, name, avatarUrl || '', timestamp, timestamp)
    .run()

  return getUserByGoogleSub(db, googleSub)
}
```

- [ ] **Step 3: Implement `memberships.js`**

```javascript
import { nowIso } from '../../utils/responses.js'

function toMembership(row) {
  if (!row) return null
  return {
    id: row.id,
    organizationId: row.organization_id,
    userId: row.user_id,
    invitedEmail: row.invited_email,
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const MEMBERSHIP_COLUMNS = 'id, organization_id, user_id, invited_email, role, status, created_at, updated_at'

export async function listActiveMembershipsForEmail(db, email) {
  const result = await db
    .prepare(`SELECT ${MEMBERSHIP_COLUMNS} FROM organization_memberships WHERE invited_email = ? AND status = 'ACTIVE'`)
    .bind(String(email).trim().toLowerCase())
    .all()
  return (result.results || []).map(toMembership)
}

export async function getMembership(db, { organizationId, userId }) {
  const row = await db
    .prepare(`SELECT ${MEMBERSHIP_COLUMNS} FROM organization_memberships WHERE organization_id = ? AND user_id = ? AND status = 'ACTIVE'`)
    .bind(organizationId, userId)
    .first()
  return toMembership(row)
}

export async function listMembershipsForOrganization(db, organizationId) {
  const result = await db
    .prepare(`SELECT ${MEMBERSHIP_COLUMNS} FROM organization_memberships WHERE organization_id = ? ORDER BY created_at ASC`)
    .bind(organizationId)
    .all()
  return (result.results || []).map(toMembership)
}

export async function createMembership(db, { organizationId, invitedEmail, role }) {
  const id = crypto.randomUUID()
  const timestamp = nowIso()
  const normalizedEmail = String(invitedEmail).trim().toLowerCase()

  await db
    .prepare(
      `INSERT INTO organization_memberships (id, organization_id, user_id, invited_email, role, status, created_at, updated_at)
       VALUES (?, ?, NULL, ?, ?, 'ACTIVE', ?, ?)
       ON CONFLICT(organization_id, invited_email) DO UPDATE SET
         role = excluded.role,
         status = 'ACTIVE',
         updated_at = excluded.updated_at`,
    )
    .bind(id, organizationId, normalizedEmail, role, timestamp, timestamp)
    .run()

  const row = await db
    .prepare(`SELECT ${MEMBERSHIP_COLUMNS} FROM organization_memberships WHERE organization_id = ? AND invited_email = ?`)
    .bind(organizationId, normalizedEmail)
    .first()

  return toMembership(row)
}

export async function linkMembershipUser(db, { organizationId, invitedEmail, userId }) {
  await db
    .prepare(`UPDATE organization_memberships SET user_id = ?, updated_at = ? WHERE organization_id = ? AND invited_email = ?`)
    .bind(userId, nowIso(), organizationId, String(invitedEmail).trim().toLowerCase())
    .run()
}
```

- [ ] **Step 4: Commit**

```bash
git add src/worker/repositories/pickleball/organizations.js src/worker/repositories/pickleball/users.js src/worker/repositories/pickleball/memberships.js
git commit -m "feat: add Pickleball organization/user/membership repositories"
```

---

### Task 8: Auth resolution logic

**Files:**
- Create: `src/worker/pickleball/authContext.js`
- Test: `src/worker/pickleball/authContext.test.js`

**Interfaces:**
- Consumes: `Role` from `src/lib/pickleball/permissions.ts` (Task 4)
- Produces: `resolveActiveOrgId(memberships: {organizationId: string}[], requestedOrgId: string|null): string|null`, `pickSessionRole(memberships, activeOrgId): Role|null`, `isLoginRateLimited(key: string): boolean`, `recordFailedLogin(key: string): void`, `clearFailedLogins(key: string): void` — consumed by Task 9.

- [ ] **Step 1: Write the failing test**

```javascript
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { resolveActiveOrgId, pickSessionRole, isLoginRateLimited, recordFailedLogin, clearFailedLogins } from './authContext.js'

const memberships = [
  { organizationId: 'org-1', role: 'SESSION_FACILITATOR' },
  { organizationId: 'org-2', role: 'ADMIN' },
]

describe('resolveActiveOrgId', () => {
  it('picks the requested org when the user is a member of it', () => {
    expect(resolveActiveOrgId(memberships, 'org-2')).toBe('org-2')
  })

  it('falls back to the first membership when no org was requested', () => {
    expect(resolveActiveOrgId(memberships, null)).toBe('org-1')
  })

  it('falls back to the first membership when the requested org is not a real membership', () => {
    expect(resolveActiveOrgId(memberships, 'org-not-a-member')).toBe('org-1')
  })

  it('returns null when there are no memberships', () => {
    expect(resolveActiveOrgId([], 'org-1')).toBeNull()
  })
})

describe('pickSessionRole', () => {
  it('returns the role for the active org', () => {
    expect(pickSessionRole(memberships, 'org-2')).toBe('ADMIN')
  })

  it('returns null when the active org has no membership', () => {
    expect(pickSessionRole(memberships, 'org-missing')).toBeNull()
  })
})

describe('login rate limiting', () => {
  beforeEach(() => {
    vi.useRealTimers()
    clearFailedLogins('test-key')
  })

  it('is not rate limited before any failures', () => {
    expect(isLoginRateLimited('test-key')).toBe(false)
  })

  it('rate limits after 8 recorded failures', () => {
    for (let i = 0; i < 8; i += 1) recordFailedLogin('test-key')
    expect(isLoginRateLimited('test-key')).toBe(true)
  })

  it('clearing failed logins resets the limiter', () => {
    for (let i = 0; i < 8; i += 1) recordFailedLogin('test-key')
    clearFailedLogins('test-key')
    expect(isLoginRateLimited('test-key')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/worker/pickleball/authContext.test.js`
Expected: FAIL — `authContext.js` does not exist yet.

- [ ] **Step 3: Implement**

```javascript
const LOGIN_WINDOW_MS = 15 * 60 * 1000
const LOGIN_MAX_ATTEMPTS = 8
const loginAttempts = new Map()

export function resolveActiveOrgId(memberships, requestedOrgId) {
  if (!memberships.length) return null
  const requestedMatch = memberships.find((membership) => membership.organizationId === requestedOrgId)
  return requestedMatch ? requestedMatch.organizationId : memberships[0].organizationId
}

export function pickSessionRole(memberships, activeOrgId) {
  const membership = memberships.find((item) => item.organizationId === activeOrgId)
  return membership ? membership.role : null
}

export function isLoginRateLimited(key) {
  const now = Date.now()
  const attempt = loginAttempts.get(key)

  if (!attempt || now >= attempt.resetAt) {
    return false
  }

  return attempt.count >= LOGIN_MAX_ATTEMPTS
}

export function recordFailedLogin(key) {
  const now = Date.now()
  const attempt = loginAttempts.get(key)

  if (!attempt || now >= attempt.resetAt) {
    loginAttempts.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS })
    return
  }

  attempt.count += 1
}

export function clearFailedLogins(key) {
  loginAttempts.delete(key)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/worker/pickleball/authContext.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/worker/pickleball/authContext.js src/worker/pickleball/authContext.test.js
git commit -m "feat: add Pickleball auth resolution and login rate limiting"
```

---

### Task 9: Auth API routes + middleware gate

**Files:**
- Create: `src/pages/api/pickleball/auth/google/start.ts`
- Create: `src/pages/api/pickleball/auth/google/callback.ts`
- Create: `src/pages/api/pickleball/auth/session.ts`
- Create: `src/pages/api/pickleball/auth/logout.ts`
- Create: `src/pages/api/pickleball/auth/switch-org.ts`
- Create: `src/pages/api/pickleball/auth/test-login.ts`
- Modify: `src/middleware.ts`
- Modify: `src/worker/pickleball/authContext.js` (adds `requirePickleballSession`, per Step 1)

**Interfaces:**
- Consumes: everything from Tasks 3, 5, 6, 7, 8 (`generatePkcePair`, `buildGoogleAuthorizationUrl`, `exchangeGoogleCode`, `fetchGoogleProfile`, `signSession`, `verifySession`, `parseCookies`, `buildSetCookieHeader`, `buildClearCookieHeader`, `SESSION_COOKIE_NAME`, `upsertUserByGoogleSub`, `listActiveMembershipsForEmail`, `resolveActiveOrgId`, `pickSessionRole`, `isLoginRateLimited`, `recordFailedLogin`, `clearFailedLogins`, `randomBase64Url`)
- Produces: `requirePickleballSession(request, env): Promise<{ userId, googleSub, activeOrgId, role } | Response>` (exported from `test-login.ts`'s sibling — actually define in a new shared file) — **note:** extract this into `src/worker/pickleball/authContext.js` as `requirePickleballSession(request, env)` before this task, since every future API route task (10–13) depends on it. Add it as an additional export in this task's Step 1.

- [ ] **Step 1: Add `requirePickleballSession` to `src/worker/pickleball/authContext.js`**

```javascript
import { parseCookies, verifySession, SESSION_COOKIE_NAME } from './session.js'
import { getMembership } from '../repositories/pickleball/memberships.js'

export async function requirePickleballSession(request, env) {
  const secret = env.PICKLEBALL_SESSION_SECRET
  if (!secret) {
    const error = new Error('Pickleball session secret is not configured.')
    error.status = 503
    throw error
  }

  const cookies = parseCookies(request.headers.get('Cookie'))
  const session = await verifySession(cookies[SESSION_COOKIE_NAME], secret)
  if (!session?.userId) {
    const error = new Error('Pickleball login is required.')
    error.status = 401
    throw error
  }

  if (!session.activeOrgId) {
    const error = new Error('No active organization selected.')
    error.status = 403
    throw error
  }

  const membership = await getMembership(env.PICKLEBALL_DB, {
    organizationId: session.activeOrgId,
    userId: session.userId,
  })

  if (!membership) {
    const error = new Error('No active membership in this organization.')
    error.status = 403
    throw error
  }

  return { userId: session.userId, googleSub: session.googleSub, activeOrgId: session.activeOrgId, role: membership.role }
}
```

(Keep the existing exports from Task 8 in this same file — this adds one more.)

- [ ] **Step 2: `start.ts`**

```typescript
import type { APIRoute } from 'astro'
import { generatePkcePair, buildGoogleAuthorizationUrl } from '../../../../../worker/pickleball/oauth.js'
import { randomBase64Url } from '../../../../../lib/pickleball/webCrypto.js'
import { buildSetCookieHeader } from '../../../../../worker/pickleball/session.js'
import { getEnv } from '../../../../../lib/env'

const OAUTH_COOKIE_NAME = 'devlab_pb_oauth'

export const GET: APIRoute = async ({ request }) => {
  const env = getEnv()
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID
  const redirectBase = env.PICKLEBALL_OAUTH_REDIRECT_BASE_URL
  if (!clientId || !redirectBase) {
    return new Response(JSON.stringify({ error: 'Google OAuth is not configured.' }), { status: 503 })
  }

  const { verifier, challenge } = await generatePkcePair()
  const state = randomBase64Url(24)
  const redirectUri = `${redirectBase}/api/pickleball/auth/google/callback`

  const authorizationUrl = buildGoogleAuthorizationUrl({
    clientId,
    redirectUri,
    state,
    codeChallenge: challenge,
    scopes: ['openid', 'email', 'profile'],
  })

  const url = new URL(request.url)
  const secure = url.protocol === 'https:'
  const cookiePayload = encodeURIComponent(JSON.stringify({ verifier, state }))

  return new Response(null, {
    status: 302,
    headers: {
      Location: authorizationUrl,
      'Set-Cookie': buildSetCookieHeader(OAUTH_COOKIE_NAME, cookiePayload, { secure, maxAgeSeconds: 600 }),
    },
  })
}

export { OAUTH_COOKIE_NAME }
```

- [ ] **Step 3: `callback.ts`**

```typescript
import type { APIRoute } from 'astro'
import { exchangeGoogleCode, fetchGoogleProfile } from '../../../../../worker/pickleball/oauth.js'
import { upsertUserByGoogleSub } from '../../../../../worker/repositories/pickleball/users.js'
import { listActiveMembershipsForEmail, linkMembershipUser } from '../../../../../worker/repositories/pickleball/memberships.js'
import { resolveActiveOrgId } from '../../../../../worker/pickleball/authContext.js'
import { signSession, buildSetCookieHeader, buildClearCookieHeader } from '../../../../../worker/pickleball/session.js'
import { SESSION_COOKIE_NAME } from '../../../../../worker/pickleball/session.js'
import { getEnv } from '../../../../../lib/env'
import { parseCookies } from '../../../../../worker/pickleball/session.js'

const OAUTH_COOKIE_NAME = 'devlab_pb_oauth'
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 8

export const GET: APIRoute = async ({ request }) => {
  const env = getEnv()
  const url = new URL(request.url)
  const secure = url.protocol === 'https:'
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')

  const cookies = parseCookies(request.headers.get('Cookie'))
  let stashed
  try {
    stashed = JSON.parse(decodeURIComponent(cookies['devlab_pb_oauth'] || ''))
  } catch {
    stashed = null
  }

  if (!code || !state || !stashed?.state || stashed.state !== state) {
    return new Response(JSON.stringify({ error: 'Invalid OAuth state.' }), { status: 400 })
  }

  const redirectUri = `${env.PICKLEBALL_OAUTH_REDIRECT_BASE_URL}/api/pickleball/auth/google/callback`
  const { accessToken } = await exchangeGoogleCode({
    code,
    codeVerifier: stashed.verifier,
    clientId: env.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
    redirectUri,
  })

  const profile = await fetchGoogleProfile(accessToken)
  const user = await upsertUserByGoogleSub(env.PICKLEBALL_DB, {
    googleSub: profile.sub,
    email: profile.email,
    name: profile.name,
    avatarUrl: profile.picture,
  })

  const memberships = await listActiveMembershipsForEmail(env.PICKLEBALL_DB, profile.email)
  const clearOauthCookie = buildClearCookieHeader(OAUTH_COOKIE_NAME, { secure })

  if (!memberships.length) {
    return new Response(null, {
      status: 302,
      headers: { Location: '/pickleball/login?error=no_access', 'Set-Cookie': clearOauthCookie },
    })
  }

  // Link every active membership for this email to the real user id now
  // that we have one — requirePickleballSession's getMembership() lookup
  // is by (organizationId, userId), so without this every request after
  // login would find no membership and be rejected as unauthorized.
  await Promise.all(
    memberships.map((membership) =>
      linkMembershipUser(env.PICKLEBALL_DB, {
        organizationId: membership.organizationId,
        invitedEmail: profile.email,
        userId: user.id,
      }),
    ),
  )

  const activeOrgId = resolveActiveOrgId(memberships, null)
  const now = Math.floor(Date.now() / 1000)
  const token = await signSession(
    { userId: user.id, googleSub: user.googleSub, activeOrgId, iat: now, exp: now + SESSION_MAX_AGE_SECONDS },
    env.PICKLEBALL_SESSION_SECRET,
  )

  return new Response(null, {
    status: 302,
    headers: {
      Location: '/pickleball/app',
      'Set-Cookie': buildSetCookieHeader(SESSION_COOKIE_NAME, token, { secure, maxAgeSeconds: SESSION_MAX_AGE_SECONDS }),
    },
  })
}
```

- [ ] **Step 4: `session.ts`, `logout.ts`, `switch-org.ts`**

```typescript
// session.ts
import type { APIRoute } from 'astro'
import { requirePickleballSession } from '../../../../worker/pickleball/authContext.js'
import { getEnv } from '../../../../lib/env'
import { getUserByGoogleSub } from '../../../../worker/repositories/pickleball/users.js'
import { listActiveMembershipsForEmail } from '../../../../worker/repositories/pickleball/memberships.js'

export const GET: APIRoute = async ({ request }) => {
  const env = getEnv()
  try {
    const session = await requirePickleballSession(request, env)
    const user = await getUserByGoogleSub(env.PICKLEBALL_DB, session.googleSub)
    const memberships = await listActiveMembershipsForEmail(env.PICKLEBALL_DB, user.email)
    return new Response(
      JSON.stringify({
        userId: session.userId,
        activeOrgId: session.activeOrgId,
        role: session.role,
        email: user.email,
        name: user.name,
        organizations: memberships.map((m) => ({ organizationId: m.organizationId, role: m.role })),
      }),
      { status: 200 },
    )
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), { status: error.status || 500 })
  }
}
```

```typescript
// logout.ts
import type { APIRoute } from 'astro'
import { buildClearCookieHeader, SESSION_COOKIE_NAME } from '../../../../worker/pickleball/session.js'

export const POST: APIRoute = async ({ request }) => {
  const secure = new URL(request.url).protocol === 'https:'
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Set-Cookie': buildClearCookieHeader(SESSION_COOKIE_NAME, { secure }) },
  })
}
```

```typescript
// switch-org.ts
import type { APIRoute } from 'astro'
import { requirePickleballSession } from '../../../../worker/pickleball/authContext.js'
import { getUserByGoogleSub } from '../../../../worker/repositories/pickleball/users.js'
import { listActiveMembershipsForEmail } from '../../../../worker/repositories/pickleball/memberships.js'
import { resolveActiveOrgId } from '../../../../worker/pickleball/authContext.js'
import { signSession, buildSetCookieHeader, SESSION_COOKIE_NAME } from '../../../../worker/pickleball/session.js'
import { getEnv } from '../../../../lib/env'

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 8

export const POST: APIRoute = async ({ request }) => {
  const env = getEnv()
  try {
    const session = await requirePickleballSession(request, env)
    const body = await request.json().catch(() => ({}))
    const requestedOrgId = String(body.organizationId || '')

    const user = await getUserByGoogleSub(env.PICKLEBALL_DB, session.googleSub)
    const memberships = await listActiveMembershipsForEmail(env.PICKLEBALL_DB, user.email)
    const activeOrgId = resolveActiveOrgId(memberships, requestedOrgId)

    if (activeOrgId !== requestedOrgId) {
      return new Response(JSON.stringify({ error: 'Not a member of that organization.' }), { status: 403 })
    }

    const now = Math.floor(Date.now() / 1000)
    const token = await signSession(
      { userId: session.userId, googleSub: session.googleSub, activeOrgId, iat: now, exp: now + SESSION_MAX_AGE_SECONDS },
      env.PICKLEBALL_SESSION_SECRET,
    )
    const secure = new URL(request.url).protocol === 'https:'

    return new Response(JSON.stringify({ ok: true, activeOrgId }), {
      status: 200,
      headers: { 'Set-Cookie': buildSetCookieHeader(SESSION_COOKIE_NAME, token, { secure, maxAgeSeconds: SESSION_MAX_AGE_SECONDS }) },
    })
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), { status: error.status || 500 })
  }
}
```

- [ ] **Step 5: `test-login.ts` (test-only, env-gated)**

```typescript
import type { APIRoute } from 'astro'
import { upsertUserByGoogleSub } from '../../../../worker/repositories/pickleball/users.js'
import { listActiveMembershipsForEmail, linkMembershipUser } from '../../../../worker/repositories/pickleball/memberships.js'
import { resolveActiveOrgId } from '../../../../worker/pickleball/authContext.js'
import { signSession, buildSetCookieHeader, SESSION_COOKIE_NAME } from '../../../../worker/pickleball/session.js'
import { getEnv } from '../../../../lib/env'

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 8

// Test-only bypass for the Google OAuth redirect/exchange, so Playwright
// can reach an authenticated state without a live Google account. Only
// responds when PICKLEBALL_TEST_AUTH_ENABLED=true, which must never be set
// in wrangler.jsonc's committed vars (local .dev.vars / CI env only).
export const POST: APIRoute = async ({ request }) => {
  const env = getEnv()
  if (env.PICKLEBALL_TEST_AUTH_ENABLED !== 'true') {
    return new Response(JSON.stringify({ error: 'Not found.' }), { status: 404 })
  }

  const body = await request.json().catch(() => ({}))
  const email = String(body.email || '').trim().toLowerCase()
  if (!email) {
    return new Response(JSON.stringify({ error: 'email is required.' }), { status: 400 })
  }

  const memberships = await listActiveMembershipsForEmail(env.PICKLEBALL_DB, email)
  if (!memberships.length) {
    return new Response(JSON.stringify({ error: 'No active membership for that email.' }), { status: 403 })
  }

  const user = await upsertUserByGoogleSub(env.PICKLEBALL_DB, {
    googleSub: `test-${email}`,
    email,
    name: email,
    avatarUrl: '',
  })

  // Same linking requirement as the real callback (see google/callback.ts) —
  // without it, getMembership(organizationId, userId) never matches and
  // every subsequent authenticated request in the test suite would 403.
  await Promise.all(
    memberships.map((membership) =>
      linkMembershipUser(env.PICKLEBALL_DB, { organizationId: membership.organizationId, invitedEmail: email, userId: user.id }),
    ),
  )

  const activeOrgId = resolveActiveOrgId(memberships, null)
  const now = Math.floor(Date.now() / 1000)
  const token = await signSession(
    { userId: user.id, googleSub: user.googleSub, activeOrgId, iat: now, exp: now + SESSION_MAX_AGE_SECONDS },
    env.PICKLEBALL_SESSION_SECRET,
  )
  const secure = new URL(request.url).protocol === 'https:'

  return new Response(JSON.stringify({ ok: true, activeOrgId }), {
    status: 200,
    headers: { 'Set-Cookie': buildSetCookieHeader(SESSION_COOKIE_NAME, token, { secure, maxAgeSeconds: SESSION_MAX_AGE_SECONDS }) },
  })
}
```

- [ ] **Step 6: Wire the middleware gate**

In `src/middleware.ts`, add to the existing top-of-file import block:

```typescript
import { requirePickleballSession } from './worker/pickleball/authContext.js'
```

Add near the existing `ADMIN_API_PREFIX`/`ADMIN_PUBLIC_ROUTES` constants:

```typescript
const PICKLEBALL_API_PREFIX = '/api/pickleball/'
const PICKLEBALL_PUBLIC_ROUTES = new Set([
  '/api/pickleball/auth/google/start',
  '/api/pickleball/auth/google/callback',
  '/api/pickleball/auth/session',
  '/api/pickleball/auth/logout',
  '/api/pickleball/auth/test-login',
])
```

And inside `onRequest`, after the existing admin gate block (before the maintenance-mode check):

```typescript
  if (url.pathname.startsWith(PICKLEBALL_API_PREFIX) && !PICKLEBALL_PUBLIC_ROUTES.has(url.pathname)) {
    try {
      await requirePickleballSession(context.request, getEnv())
    } catch (error: any) {
      return applySecurityHeaders(
        new Response(JSON.stringify({ error: error.message }), { status: error.status || 500 }),
        url.pathname,
        url.hostname,
      )
    }
  }
```

This mirrors the existing `ADMIN_API_PREFIX` gate exactly, but does not attach role to `context.locals` here — each route re-resolves `requirePickleballSession` itself for its own `role` value, since `can()` checks (Task 4) happen per-route, not centrally (routes differ in which permission they require).

- [ ] **Step 7: Verify manually**

Run `npx wrangler dev --local` and visit `http://localhost:8787/api/pickleball/auth/google/start` — expect a 302 redirect to a URL starting with `https://accounts.google.com/o/oauth2/v2/auth`. (Full login requires a real Google OAuth client configured in `.dev.vars` — Task 16's Playwright suite covers this redirect assertion automatically and uses `test-login` for anything past it.)

- [ ] **Step 8: Commit**

```bash
git add src/pages/api/pickleball/auth src/worker/pickleball/authContext.js src/middleware.ts
git commit -m "feat: add Pickleball Google OAuth API routes and auth gate"
```

---

### Task 10: Organizations & memberships API (invite flow)

**Files:**
- Create: `src/lib/schemas/pickleball/organizations.ts`
- Create: `src/pages/api/pickleball/organizations/[id]/memberships.ts`

**Interfaces:**
- Consumes: `can` (Task 4), `requirePickleballSession` (Task 9), `createMembership`, `listMembershipsForOrganization` (Task 7)
- Produces: `inviteMembershipSchema` (Zod) — reused by no other task in this phase, but establishes the schema-per-endpoint convention Tasks 11–13 follow.

- [ ] **Step 1: Zod schema**

```typescript
import { z } from 'zod'

export const inviteMembershipSchema = z.object({
  invitedEmail: z.string().email(),
  role: z.enum(['ADMIN', 'SESSION_FACILITATOR', 'SCOREKEEPER']),
})

export type InviteMembershipInput = z.infer<typeof inviteMembershipSchema>
```

- [ ] **Step 2: API route**

```typescript
import type { APIRoute } from 'astro'
import { requirePickleballSession } from '../../../../../worker/pickleball/authContext.js'
import { can } from '../../../../../lib/pickleball/permissions'
import { createMembership, listMembershipsForOrganization } from '../../../../../worker/repositories/pickleball/memberships.js'
import { inviteMembershipSchema } from '../../../../../lib/schemas/pickleball/organizations'
import { getEnv } from '../../../../../lib/env'

export const GET: APIRoute = async ({ request, params }) => {
  const env = getEnv()
  try {
    const session = await requirePickleballSession(request, env)
    if (session.activeOrgId !== params.id) {
      return new Response(JSON.stringify({ error: 'Not found.' }), { status: 404 })
    }
    const memberships = await listMembershipsForOrganization(env.PICKLEBALL_DB, params.id)
    return new Response(JSON.stringify({ memberships }), { status: 200 })
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), { status: error.status || 500 })
  }
}

export const POST: APIRoute = async ({ request, params }) => {
  const env = getEnv()
  try {
    const session = await requirePickleballSession(request, env)
    if (session.activeOrgId !== params.id || !can(session.role, 'MANAGE_OPERATORS')) {
      return new Response(JSON.stringify({ error: 'Forbidden.' }), { status: 403 })
    }

    const body = await request.json().catch(() => null)
    const result = inviteMembershipSchema.safeParse(body)
    if (!result.success) {
      return new Response(JSON.stringify({ error: 'Validation failed.', issues: result.error.issues }), { status: 400 })
    }

    const membership = await createMembership(env.PICKLEBALL_DB, { organizationId: params.id, ...result.data })
    return new Response(JSON.stringify({ membership }), { status: 201 })
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), { status: error.status || 500 })
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/schemas/pickleball/organizations.ts src/pages/api/pickleball/organizations
git commit -m "feat: add Pickleball organization membership invite API"
```

---

### Task 11: Players repository, schema, and API

**Files:**
- Create: `src/worker/repositories/pickleball/players.js`
- Create: `src/lib/schemas/pickleball/players.ts`
- Create: `src/pages/api/pickleball/players/index.ts`
- Create: `src/pages/api/pickleball/players/[id].ts`

**Interfaces:**
- Produces: `listPlayers(db, organizationId, { includeInactive }): Promise<Player[]>`, `getPlayer(db, id, organizationId): Promise<Player|null>`, `createPlayer(db, { organizationId, displayName }): Promise<Player>`, `updatePlayer(db, id, organizationId, { displayName, active }): Promise<Player|null>`, `playerSchema` (Zod) — consumed by later phases' check-in/queue work, not by anything else in this phase.

- [ ] **Step 1: Repository**

```javascript
import { nowIso } from '../../utils/responses.js'

function normalizeName(displayName) {
  return String(displayName).trim().toLowerCase().replace(/\s+/g, ' ')
}

function toPlayer(row) {
  if (!row) return null
  return {
    id: row.id,
    organizationId: row.organization_id,
    displayName: row.display_name,
    normalizedName: row.normalized_name,
    linkedUserId: row.linked_user_id,
    active: Boolean(row.active),
    publicVisible: Boolean(row.public_visible),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const PLAYER_COLUMNS = 'id, organization_id, display_name, normalized_name, linked_user_id, active, public_visible, created_at, updated_at'

export async function listPlayers(db, organizationId, { includeInactive = false } = {}) {
  const activeClause = includeInactive ? '' : 'AND active = 1'
  const result = await db
    .prepare(`SELECT ${PLAYER_COLUMNS} FROM players WHERE organization_id = ? ${activeClause} ORDER BY display_name ASC`)
    .bind(organizationId)
    .all()
  return (result.results || []).map(toPlayer)
}

export async function getPlayer(db, id, organizationId) {
  const row = await db
    .prepare(`SELECT ${PLAYER_COLUMNS} FROM players WHERE id = ? AND organization_id = ?`)
    .bind(id, organizationId)
    .first()
  return toPlayer(row)
}

export async function createPlayer(db, { organizationId, displayName }) {
  const id = crypto.randomUUID()
  const timestamp = nowIso()

  await db
    .prepare(
      `INSERT INTO players (id, organization_id, display_name, normalized_name, active, public_visible, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, 1, ?, ?)`,
    )
    .bind(id, organizationId, displayName.trim(), normalizeName(displayName), timestamp, timestamp)
    .run()

  return getPlayer(db, id, organizationId)
}

export async function updatePlayer(db, id, organizationId, { displayName, active }) {
  const existing = await getPlayer(db, id, organizationId)
  if (!existing) return null

  const nextDisplayName = displayName !== undefined ? displayName.trim() : existing.displayName
  const nextActive = active !== undefined ? (active ? 1 : 0) : existing.active ? 1 : 0

  await db
    .prepare('UPDATE players SET display_name = ?, normalized_name = ?, active = ?, updated_at = ? WHERE id = ? AND organization_id = ?')
    .bind(nextDisplayName, normalizeName(nextDisplayName), nextActive, nowIso(), id, organizationId)
    .run()

  return getPlayer(db, id, organizationId)
}
```

- [ ] **Step 2: Zod schema**

```typescript
import { z } from 'zod'

export const createPlayerSchema = z.object({
  displayName: z.string().trim().min(1).max(120),
})

export const updatePlayerSchema = z.object({
  displayName: z.string().trim().min(1).max(120).optional(),
  active: z.boolean().optional(),
})

export type CreatePlayerInput = z.infer<typeof createPlayerSchema>
export type UpdatePlayerInput = z.infer<typeof updatePlayerSchema>
```

- [ ] **Step 3: `index.ts`**

```typescript
import type { APIRoute } from 'astro'
import { requirePickleballSession } from '../../../../worker/pickleball/authContext.js'
import { can } from '../../../../lib/pickleball/permissions'
import { listPlayers, createPlayer } from '../../../../worker/repositories/pickleball/players.js'
import { createPlayerSchema } from '../../../../lib/schemas/pickleball/players'
import { getEnv } from '../../../../lib/env'

export const GET: APIRoute = async ({ request }) => {
  const env = getEnv()
  try {
    const session = await requirePickleballSession(request, env)
    const players = await listPlayers(env.PICKLEBALL_DB, session.activeOrgId)
    return new Response(JSON.stringify({ players }), { status: 200 })
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), { status: error.status || 500 })
  }
}

export const POST: APIRoute = async ({ request }) => {
  const env = getEnv()
  try {
    const session = await requirePickleballSession(request, env)
    if (!can(session.role, 'MANAGE_PLAYERS')) {
      return new Response(JSON.stringify({ error: 'Forbidden.' }), { status: 403 })
    }

    const result = createPlayerSchema.safeParse(await request.json().catch(() => null))
    if (!result.success) {
      return new Response(JSON.stringify({ error: 'Validation failed.', issues: result.error.issues }), { status: 400 })
    }

    const player = await createPlayer(env.PICKLEBALL_DB, { organizationId: session.activeOrgId, ...result.data })
    return new Response(JSON.stringify({ player }), { status: 201 })
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), { status: error.status || 500 })
  }
}
```

- [ ] **Step 4: `[id].ts`**

```typescript
import type { APIRoute } from 'astro'
import { requirePickleballSession } from '../../../../worker/pickleball/authContext.js'
import { can } from '../../../../lib/pickleball/permissions'
import { getPlayer, updatePlayer } from '../../../../worker/repositories/pickleball/players.js'
import { updatePlayerSchema } from '../../../../lib/schemas/pickleball/players'
import { getEnv } from '../../../../lib/env'

export const GET: APIRoute = async ({ request, params }) => {
  const env = getEnv()
  try {
    const session = await requirePickleballSession(request, env)
    const player = await getPlayer(env.PICKLEBALL_DB, params.id, session.activeOrgId)
    if (!player) return new Response(JSON.stringify({ error: 'Not found.' }), { status: 404 })
    return new Response(JSON.stringify({ player }), { status: 200 })
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), { status: error.status || 500 })
  }
}

export const PUT: APIRoute = async ({ request, params }) => {
  const env = getEnv()
  try {
    const session = await requirePickleballSession(request, env)
    if (!can(session.role, 'MANAGE_PLAYERS')) {
      return new Response(JSON.stringify({ error: 'Forbidden.' }), { status: 403 })
    }

    const result = updatePlayerSchema.safeParse(await request.json().catch(() => null))
    if (!result.success) {
      return new Response(JSON.stringify({ error: 'Validation failed.', issues: result.error.issues }), { status: 400 })
    }

    const player = await updatePlayer(env.PICKLEBALL_DB, params.id, session.activeOrgId, result.data)
    if (!player) return new Response(JSON.stringify({ error: 'Not found.' }), { status: 404 })
    return new Response(JSON.stringify({ player }), { status: 200 })
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), { status: error.status || 500 })
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add src/worker/repositories/pickleball/players.js src/lib/schemas/pickleball/players.ts src/pages/api/pickleball/players
git commit -m "feat: add Pickleball players repository, schema, and API"
```

---

### Task 12: Venues & courts repositories, schemas, and API

**Files:**
- Create: `src/worker/repositories/pickleball/venues.js`
- Create: `src/worker/repositories/pickleball/courts.js`
- Create: `src/lib/schemas/pickleball/venues.ts`
- Create: `src/lib/schemas/pickleball/courts.ts`
- Create: `src/pages/api/pickleball/venues/index.ts`
- Create: `src/pages/api/pickleball/venues/[id].ts`
- Create: `src/pages/api/pickleball/courts/index.ts`
- Create: `src/pages/api/pickleball/courts/[id].ts`

**Interfaces:**
- Produces: `listVenues(db, organizationId)`, `getVenue(db, id, organizationId)`, `createVenue(db, { organizationId, name, address, timezone })`, `listCourtsForVenue(db, venueId, organizationId)`, `createCourt(db, { venueId, organizationId, name, sortOrder })` — consumed by Task 13 (sessions reference venues/courts) and later phases (session_courts).

- [ ] **Step 1: `venues.js`**

```javascript
import { nowIso } from '../../utils/responses.js'

function toVenue(row) {
  if (!row) return null
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    address: row.address || '',
    timezone: row.timezone,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const VENUE_COLUMNS = 'id, organization_id, name, address, timezone, created_at, updated_at'

export async function listVenues(db, organizationId) {
  const result = await db
    .prepare(`SELECT ${VENUE_COLUMNS} FROM venues WHERE organization_id = ? ORDER BY name ASC`)
    .bind(organizationId)
    .all()
  return (result.results || []).map(toVenue)
}

export async function getVenue(db, id, organizationId) {
  const row = await db
    .prepare(`SELECT ${VENUE_COLUMNS} FROM venues WHERE id = ? AND organization_id = ?`)
    .bind(id, organizationId)
    .first()
  return toVenue(row)
}

export async function createVenue(db, { organizationId, name, address, timezone }) {
  const id = crypto.randomUUID()
  const timestamp = nowIso()

  await db
    .prepare(
      `INSERT INTO venues (id, organization_id, name, address, timezone, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, organizationId, name.trim(), address ? address.trim() : '', timezone || 'UTC', timestamp, timestamp)
    .run()

  return getVenue(db, id, organizationId)
}
```

- [ ] **Step 2: `courts.js`**

```javascript
import { nowIso } from '../../utils/responses.js'

function toCourt(row) {
  if (!row) return null
  return {
    id: row.id,
    venueId: row.venue_id,
    organizationId: row.organization_id,
    name: row.name,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const COURT_COLUMNS = 'id, venue_id, organization_id, name, sort_order, created_at, updated_at'

export async function listCourtsForVenue(db, venueId, organizationId) {
  const result = await db
    .prepare(`SELECT ${COURT_COLUMNS} FROM courts WHERE venue_id = ? AND organization_id = ? ORDER BY sort_order ASC`)
    .bind(venueId, organizationId)
    .all()
  return (result.results || []).map(toCourt)
}

export async function getCourt(db, id, organizationId) {
  const row = await db
    .prepare(`SELECT ${COURT_COLUMNS} FROM courts WHERE id = ? AND organization_id = ?`)
    .bind(id, organizationId)
    .first()
  return toCourt(row)
}

export async function createCourt(db, { venueId, organizationId, name, sortOrder }) {
  const id = crypto.randomUUID()
  const timestamp = nowIso()

  await db
    .prepare(
      `INSERT INTO courts (id, venue_id, organization_id, name, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, venueId, organizationId, name.trim(), Number.isFinite(sortOrder) ? sortOrder : 999, timestamp, timestamp)
    .run()

  return getCourt(db, id, organizationId)
}
```

- [ ] **Step 3: Zod schemas**

```typescript
// src/lib/schemas/pickleball/venues.ts
import { z } from 'zod'

export const createVenueSchema = z.object({
  name: z.string().trim().min(1).max(160),
  address: z.string().trim().max(300).optional(),
  timezone: z.string().trim().min(1).max(64).optional(),
})

export type CreateVenueInput = z.infer<typeof createVenueSchema>
```

```typescript
// src/lib/schemas/pickleball/courts.ts
import { z } from 'zod'

export const createCourtSchema = z.object({
  venueId: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  sortOrder: z.number().int().min(0).max(9999).optional(),
})

export type CreateCourtInput = z.infer<typeof createCourtSchema>
```

- [ ] **Step 4: API routes**

```typescript
// src/pages/api/pickleball/venues/index.ts
import type { APIRoute } from 'astro'
import { requirePickleballSession } from '../../../../worker/pickleball/authContext.js'
import { can } from '../../../../lib/pickleball/permissions'
import { listVenues, createVenue } from '../../../../worker/repositories/pickleball/venues.js'
import { createVenueSchema } from '../../../../lib/schemas/pickleball/venues'
import { getEnv } from '../../../../lib/env'

export const GET: APIRoute = async ({ request }) => {
  const env = getEnv()
  try {
    const session = await requirePickleballSession(request, env)
    const venues = await listVenues(env.PICKLEBALL_DB, session.activeOrgId)
    return new Response(JSON.stringify({ venues }), { status: 200 })
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), { status: error.status || 500 })
  }
}

export const POST: APIRoute = async ({ request }) => {
  const env = getEnv()
  try {
    const session = await requirePickleballSession(request, env)
    if (!can(session.role, 'MANAGE_VENUES_COURTS')) {
      return new Response(JSON.stringify({ error: 'Forbidden.' }), { status: 403 })
    }

    const result = createVenueSchema.safeParse(await request.json().catch(() => null))
    if (!result.success) {
      return new Response(JSON.stringify({ error: 'Validation failed.', issues: result.error.issues }), { status: 400 })
    }

    const venue = await createVenue(env.PICKLEBALL_DB, { organizationId: session.activeOrgId, ...result.data })
    return new Response(JSON.stringify({ venue }), { status: 201 })
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), { status: error.status || 500 })
  }
}
```

```typescript
// src/pages/api/pickleball/venues/[id].ts
import type { APIRoute } from 'astro'
import { requirePickleballSession } from '../../../../worker/pickleball/authContext.js'
import { getVenue } from '../../../../worker/repositories/pickleball/venues.js'
import { getEnv } from '../../../../lib/env'

export const GET: APIRoute = async ({ request, params }) => {
  const env = getEnv()
  try {
    const session = await requirePickleballSession(request, env)
    const venue = await getVenue(env.PICKLEBALL_DB, params.id, session.activeOrgId)
    if (!venue) return new Response(JSON.stringify({ error: 'Not found.' }), { status: 404 })
    return new Response(JSON.stringify({ venue }), { status: 200 })
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), { status: error.status || 500 })
  }
}
```

```typescript
// src/pages/api/pickleball/courts/index.ts
import type { APIRoute } from 'astro'
import { requirePickleballSession } from '../../../../worker/pickleball/authContext.js'
import { can } from '../../../../lib/pickleball/permissions'
import { listCourtsForVenue, createCourt } from '../../../../worker/repositories/pickleball/courts.js'
import { getVenue } from '../../../../worker/repositories/pickleball/venues.js'
import { createCourtSchema } from '../../../../lib/schemas/pickleball/courts'
import { getEnv } from '../../../../lib/env'

export const GET: APIRoute = async ({ request, url }) => {
  const env = getEnv()
  try {
    const session = await requirePickleballSession(request, env)
    const venueId = url.searchParams.get('venueId')
    if (!venueId) return new Response(JSON.stringify({ error: 'venueId query param is required.' }), { status: 400 })
    const courts = await listCourtsForVenue(env.PICKLEBALL_DB, venueId, session.activeOrgId)
    return new Response(JSON.stringify({ courts }), { status: 200 })
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), { status: error.status || 500 })
  }
}

export const POST: APIRoute = async ({ request }) => {
  const env = getEnv()
  try {
    const session = await requirePickleballSession(request, env)
    if (!can(session.role, 'MANAGE_VENUES_COURTS')) {
      return new Response(JSON.stringify({ error: 'Forbidden.' }), { status: 403 })
    }

    const result = createCourtSchema.safeParse(await request.json().catch(() => null))
    if (!result.success) {
      return new Response(JSON.stringify({ error: 'Validation failed.', issues: result.error.issues }), { status: 400 })
    }

    // Required: without this check, org B could POST a venueId belonging to
    // org A and create a court row that cross-references another tenant's
    // venue (caught in Task 12's review — see the plan's task log).
    const venue = await getVenue(env.PICKLEBALL_DB, result.data.venueId, session.activeOrgId)
    if (!venue) {
      return new Response(JSON.stringify({ error: 'Venue not found in this organization.' }), { status: 400 })
    }

    const court = await createCourt(env.PICKLEBALL_DB, { organizationId: session.activeOrgId, ...result.data })
    return new Response(JSON.stringify({ court }), { status: 201 })
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), { status: error.status || 500 })
  }
}
```

```typescript
// src/pages/api/pickleball/courts/[id].ts
import type { APIRoute } from 'astro'
import { requirePickleballSession } from '../../../../worker/pickleball/authContext.js'
import { getCourt } from '../../../../worker/repositories/pickleball/courts.js'
import { getEnv } from '../../../../lib/env'

export const GET: APIRoute = async ({ request, params }) => {
  const env = getEnv()
  try {
    const session = await requirePickleballSession(request, env)
    const court = await getCourt(env.PICKLEBALL_DB, params.id, session.activeOrgId)
    if (!court) return new Response(JSON.stringify({ error: 'Not found.' }), { status: 404 })
    return new Response(JSON.stringify({ court }), { status: 200 })
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), { status: error.status || 500 })
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add src/worker/repositories/pickleball/venues.js src/worker/repositories/pickleball/courts.js src/lib/schemas/pickleball/venues.ts src/lib/schemas/pickleball/courts.ts src/pages/api/pickleball/venues src/pages/api/pickleball/courts
git commit -m "feat: add Pickleball venues and courts repositories, schemas, and API"
```

---

### Task 13: Sessions repository, schema, and API

**Files:**
- Create: `src/worker/repositories/pickleball/sessions.js`
- Create: `src/lib/schemas/pickleball/sessions.ts`
- Create: `src/pages/api/pickleball/sessions/index.ts`
- Create: `src/pages/api/pickleball/sessions/[id].ts`

**Interfaces:**
- Consumes: `getVenue` (Task 12)
- Produces: `listSessions(db, organizationId)`, `getSession(db, id, organizationId)`, `createSession(db, { organizationId, venueId, name, sessionType, scoringRulesetId, scheduledStart, scheduledEnd, createdByUserId })` — consumed by Phase 2 (attendance) onward.

A default `scoring_ruleset_id` must exist before a session can be created. This task seeds one global ruleset row as part of its migration-adjacent setup (Step 1 below), rather than requiring the caller to create one first — matches the spec's "global built-in profile" design (§4.3).

- [ ] **Step 1: Seed the default ruleset**

Create `migrations/pickleball/0002_default_ruleset.sql`:

```sql
-- A global (organization_id NULL) built-in scoring profile every new
-- session can reference immediately, matching the spec's "global default
-- ruleset" design (§4.3). Organizations can add their own later.
INSERT INTO scoring_rulesets (id, organization_id, name, rules_version, scoring_method, target_score, win_by, format, active, created_at, updated_at)
SELECT 'usap-2026-sideout-11-doubles', NULL, 'Side-Out to 11, Win by 2 (Doubles)', 'USAP-2026', 'SIDE_OUT', 11, 2, 'DOUBLES', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
WHERE NOT EXISTS (SELECT 1 FROM scoring_rulesets WHERE id = 'usap-2026-sideout-11-doubles');
```

Run: `npx wrangler d1 migrations apply devlab-pickleball --local`

- [ ] **Step 2: Repository**

```javascript
import { nowIso } from '../../utils/responses.js'

function toSession(row) {
  if (!row) return null
  return {
    id: row.id,
    organizationId: row.organization_id,
    venueId: row.venue_id,
    name: row.name,
    sessionType: row.session_type,
    status: row.status,
    scoringRulesetId: row.scoring_ruleset_id,
    scheduledStart: row.scheduled_start,
    scheduledEnd: row.scheduled_end,
    actualStart: row.actual_start,
    actualEnd: row.actual_end,
    postGameRotationPolicy: row.post_game_rotation_policy,
    leaderboardMinGames: row.leaderboard_min_games,
    publicViewEnabled: Boolean(row.public_view_enabled),
    publicLeaderboardEnabled: Boolean(row.public_leaderboard_enabled),
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const SESSION_COLUMNS = `id, organization_id, venue_id, name, session_type, status, scoring_ruleset_id,
  scheduled_start, scheduled_end, actual_start, actual_end, post_game_rotation_policy,
  leaderboard_min_games, public_view_enabled, public_leaderboard_enabled, created_by_user_id, created_at, updated_at`

export async function listSessions(db, organizationId) {
  const result = await db
    .prepare(`SELECT ${SESSION_COLUMNS} FROM pickleball_sessions WHERE organization_id = ? ORDER BY scheduled_start DESC`)
    .bind(organizationId)
    .all()
  return (result.results || []).map(toSession)
}

export async function getSession(db, id, organizationId) {
  const row = await db
    .prepare(`SELECT ${SESSION_COLUMNS} FROM pickleball_sessions WHERE id = ? AND organization_id = ?`)
    .bind(id, organizationId)
    .first()
  return toSession(row)
}

export async function createSession(db, {
  organizationId, venueId, name, sessionType, scoringRulesetId, scheduledStart, scheduledEnd, createdByUserId,
}) {
  const id = crypto.randomUUID()
  const timestamp = nowIso()

  await db
    .prepare(
      `INSERT INTO pickleball_sessions (
        id, organization_id, venue_id, name, session_type, status, scoring_ruleset_id,
        scheduled_start, scheduled_end, post_game_rotation_policy, leaderboard_min_games,
        public_view_enabled, public_leaderboard_enabled, created_by_user_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, 'AUTO_REQUEUE_ALL', 3, 1, 1, ?, ?, ?)`,
    )
    .bind(id, organizationId, venueId, name.trim(), sessionType, scoringRulesetId, scheduledStart, scheduledEnd, createdByUserId, timestamp, timestamp)
    .run()

  return getSession(db, id, organizationId)
}
```

- [ ] **Step 3: Zod schema**

```typescript
import { z } from 'zod'

export const createSessionSchema = z.object({
  venueId: z.string().uuid(),
  name: z.string().trim().min(1).max(160),
  sessionType: z.enum(['OPEN_PLAY', 'FIXED_PAIRS']),
  scoringRulesetId: z.string().min(1),
  scheduledStart: z.string().datetime(),
  scheduledEnd: z.string().datetime(),
})

export type CreateSessionInput = z.infer<typeof createSessionSchema>
```

- [ ] **Step 4: API routes**

```typescript
// src/pages/api/pickleball/sessions/index.ts
import type { APIRoute } from 'astro'
import { requirePickleballSession } from '../../../../worker/pickleball/authContext.js'
import { can } from '../../../../lib/pickleball/permissions'
import { listSessions, createSession } from '../../../../worker/repositories/pickleball/sessions.js'
import { getVenue } from '../../../../worker/repositories/pickleball/venues.js'
import { createSessionSchema } from '../../../../lib/schemas/pickleball/sessions'
import { getEnv } from '../../../../lib/env'

export const GET: APIRoute = async ({ request }) => {
  const env = getEnv()
  try {
    const session = await requirePickleballSession(request, env)
    const sessions = await listSessions(env.PICKLEBALL_DB, session.activeOrgId)
    return new Response(JSON.stringify({ sessions }), { status: 200 })
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), { status: error.status || 500 })
  }
}

export const POST: APIRoute = async ({ request }) => {
  const env = getEnv()
  try {
    const session = await requirePickleballSession(request, env)
    if (!can(session.role, 'MANAGE_SESSIONS')) {
      return new Response(JSON.stringify({ error: 'Forbidden.' }), { status: 403 })
    }

    const result = createSessionSchema.safeParse(await request.json().catch(() => null))
    if (!result.success) {
      return new Response(JSON.stringify({ error: 'Validation failed.', issues: result.error.issues }), { status: 400 })
    }

    const venue = await getVenue(env.PICKLEBALL_DB, result.data.venueId, session.activeOrgId)
    if (!venue) {
      return new Response(JSON.stringify({ error: 'Venue not found in this organization.' }), { status: 400 })
    }

    const created = await createSession(env.PICKLEBALL_DB, {
      organizationId: session.activeOrgId,
      createdByUserId: session.userId,
      ...result.data,
    })
    return new Response(JSON.stringify({ session: created }), { status: 201 })
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), { status: error.status || 500 })
  }
}
```

```typescript
// src/pages/api/pickleball/sessions/[id].ts
import type { APIRoute } from 'astro'
import { requirePickleballSession } from '../../../../worker/pickleball/authContext.js'
import { getSession } from '../../../../worker/repositories/pickleball/sessions.js'
import { getEnv } from '../../../../lib/env'

export const GET: APIRoute = async ({ request, params }) => {
  const env = getEnv()
  try {
    const session = await requirePickleballSession(request, env)
    const record = await getSession(env.PICKLEBALL_DB, params.id, session.activeOrgId)
    if (!record) return new Response(JSON.stringify({ error: 'Not found.' }), { status: 404 })
    return new Response(JSON.stringify({ session: record }), { status: 200 })
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), { status: error.status || 500 })
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add migrations/pickleball/0002_default_ruleset.sql src/worker/repositories/pickleball/sessions.js src/lib/schemas/pickleball/sessions.ts src/pages/api/pickleball/sessions
git commit -m "feat: add Pickleball sessions repository, schema, and API"
```

---

### Task 14: Bootstrap script for the first organization

**Files:**
- Create: `scripts/pickleball/create-organization.mjs`

**Interfaces:**
- Consumes: nothing (standalone script)
- Produces: a `.sql` file an operator applies with `wrangler d1 execute` — this is how the very first organization + ADMIN membership come to exist, since org creation is invite-only/no self-serve per the design (spec §3.1).

- [ ] **Step 1: Write the script**

```javascript
import { randomUUID } from 'node:crypto'

const [name, slug, adminEmail] = process.argv.slice(2)

if (!name || !slug || !adminEmail) {
  console.error('Usage: node scripts/pickleball/create-organization.mjs "<name>" "<slug>" "<admin-email>"')
  process.exit(1)
}

const now = new Date().toISOString()
const organizationId = randomUUID()
const membershipId = randomUUID()

const sql = `
INSERT INTO organizations (id, name, slug, created_at, updated_at)
VALUES ('${organizationId}', '${name.replace(/'/g, "''")}', '${slug.replace(/'/g, "''")}', '${now}', '${now}');

INSERT INTO organization_memberships (id, organization_id, user_id, invited_email, role, status, created_at, updated_at)
VALUES ('${membershipId}', '${organizationId}', NULL, '${adminEmail.trim().toLowerCase().replace(/'/g, "''")}', 'ADMIN', 'ACTIVE', '${now}', '${now}');
`.trim()

console.log(sql)
console.error(`\n-- Organization id: ${organizationId}`)
console.error('-- Apply with: npx wrangler d1 execute devlab-pickleball --local --file=<this output saved to a file>')
```

- [ ] **Step 2: Add the npm script**

In `package.json`, under `"scripts"`, add:
```json
"pickleball:create-organization": "node scripts/pickleball/create-organization.mjs"
```

- [ ] **Step 3: Verify locally**

Run:
```bash
npm run pickleball:create-organization -- "Devlab Pickleball Club" "devlab-pickleball" "you@example.com" > /tmp/org.sql
npx wrangler d1 execute devlab-pickleball --local --file=/tmp/org.sql
npx wrangler d1 execute devlab-pickleball --local --command "SELECT * FROM organization_memberships"
```
Expected: one row with `role = 'ADMIN'`, `status = 'ACTIVE'`, `invited_email = 'you@example.com'`.

- [ ] **Step 4: Commit**

```bash
git add scripts/pickleball/create-organization.mjs package.json
git commit -m "feat: add Pickleball organization bootstrap script"
```

---

### Task 15: SPA shell and public landing page

**Files:**
- Create: `src/pickleball-app/PickleballApp.jsx`
- Create: `src/pickleball-app/components/AppShell.jsx`
- Create: `src/pickleball-app/pages/LoginPage.jsx`
- Create: `src/pickleball-app/pages/DashboardPage.jsx`
- Create: `src/pages/pickleball/app/[...path].astro`
- Create: `src/pages/pickleball/index.astro`

**Interfaces:**
- Consumes: `GET /api/pickleball/auth/session`, `POST /api/pickleball/auth/logout`, `POST /api/pickleball/auth/switch-org`
- Produces: the mounted SPA at `/pickleball/app`, the public landing at `/pickleball` — this is the phase's user-visible deliverable.

- [ ] **Step 1: `LoginPage.jsx`**

```jsx
export default function LoginPage() {
  const params = new URLSearchParams(window.location.search)
  const error = params.get('error')

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-sm rounded-lg bg-white p-8 text-center shadow">
        <h1 className="mb-2 text-lg font-semibold text-slate-900">Devlab Pickleball</h1>
        <p className="mb-6 text-sm text-slate-500">Sign in with the Google account your organization invited.</p>
        {error === 'no_access' && (
          <p className="mb-4 rounded bg-red-50 px-3 py-2 text-sm text-red-700">
            Your Google account has no active Pickleball membership. Ask an admin to invite you.
          </p>
        )}
        <a
          href="/api/pickleball/auth/google/start"
          className="inline-flex w-full items-center justify-center rounded bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand/90"
        >
          Sign in with Google
        </a>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: `AppShell.jsx`**

```jsx
import { NavLink, Outlet } from 'react-router-dom'

const NAV_ITEMS = [
  { to: '/pickleball/app', label: 'Dashboard', end: true },
  { to: '/pickleball/app/players', label: 'Players' },
  { to: '/pickleball/app/venues', label: 'Venues' },
  { to: '/pickleball/app/sessions', label: 'Sessions' },
]

export default function AppShell({ session, organizations, onSwitchOrg, onLogout }) {
  return (
    <div className="flex min-h-screen bg-slate-50">
      <aside className="w-56 shrink-0 border-r border-slate-200 bg-white p-4">
        <p className="mb-4 text-sm font-semibold text-slate-900">Devlab Pickleball</p>
        <nav className="space-y-1">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `block rounded px-3 py-2 text-sm ${isActive ? 'bg-brand/10 font-semibold text-brand' : 'text-slate-600 hover:bg-slate-100'}`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        {organizations.length > 1 && (
          <select
            className="mt-6 w-full rounded border border-slate-300 px-2 py-1 text-sm"
            value={session.activeOrgId}
            onChange={(event) => onSwitchOrg(event.target.value)}
          >
            {organizations.map((org) => (
              <option key={org.organizationId} value={org.organizationId}>
                {org.organizationId}
              </option>
            ))}
          </select>
        )}
        <button type="button" onClick={onLogout} className="mt-6 w-full rounded border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">
          Sign out
        </button>
      </aside>
      <main className="flex-1 p-6">
        <Outlet />
      </main>
    </div>
  )
}
```

- [ ] **Step 3: `DashboardPage.jsx`**

```jsx
export default function DashboardPage() {
  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900">Welcome</h1>
      <p className="mt-2 text-sm text-slate-500">Session and queue management arrive in later phases.</p>
    </div>
  )
}
```

- [ ] **Step 4: `PickleballApp.jsx`**

```jsx
import { useEffect, useState } from 'react'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import AppShell from './components/AppShell'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'

function buildRouter(session, organizations, onSwitchOrg, onLogout) {
  return createBrowserRouter([
    {
      path: '/pickleball/app',
      element: <AppShell session={session} organizations={organizations} onSwitchOrg={onSwitchOrg} onLogout={onLogout} />,
      children: [{ index: true, element: <DashboardPage /> }],
    },
  ])
}

export default function PickleballApp() {
  const [session, setSession] = useState(null)
  const [organizations, setOrganizations] = useState([])
  const [isCheckingSession, setIsCheckingSession] = useState(true)

  async function loadSession() {
    try {
      const response = await fetch('/api/pickleball/auth/session', { credentials: 'include' })
      if (!response.ok) {
        setSession(null)
        setOrganizations([])
        return
      }
      const body = await response.json()
      setSession(body)
      setOrganizations(body.organizations || [])
    } catch {
      setSession(null)
      setOrganizations([])
    } finally {
      setIsCheckingSession(false)
    }
  }

  useEffect(() => {
    loadSession()
  }, [])

  async function handleSwitchOrg(organizationId) {
    await fetch('/api/pickleball/auth/switch-org', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ organizationId }),
    })
    await loadSession()
  }

  async function handleLogout() {
    await fetch('/api/pickleball/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {})
    setSession(null)
  }

  if (isCheckingSession) {
    return <div className="flex min-h-screen items-center justify-center text-sm font-semibold text-slate-500">Loading…</div>
  }

  if (!session) {
    return <LoginPage />
  }

  return <RouterProvider router={buildRouter(session, organizations, handleSwitchOrg, handleLogout)} />
}
```

- [ ] **Step 5: Astro mount route**

```astro
---
import '../../../index.css'
import PickleballApp from '../../../pickleball-app/PickleballApp.jsx'
---

<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="robots" content="noindex, nofollow" />
    <title>Devlab Pickleball</title>
  </head>
  <body>
    <div id="pickleball-root">
      <PickleballApp client:only="react" />
    </div>
  </body>
</html>
```

- [ ] **Step 6: Public landing page**

```astro
---
import Layout from '../../layouts/Layout.astro'
---

<Layout title="Devlab Pickleball">
  <main class="mx-auto max-w-2xl px-6 py-24 text-center">
    <h1 class="text-3xl font-bold text-navy">Devlab Pickleball</h1>
    <p class="mt-4 text-slate-600">Session management for recreational pickleball play.</p>
    <a href="/pickleball/app" class="mt-8 inline-flex rounded bg-brand px-5 py-3 text-sm font-semibold text-white">
      Operator sign in
    </a>
  </main>
</Layout>
```

If `src/layouts/Layout.astro` is not the actual shared layout component name, check `src/layouts/` first and use whichever existing layout other public pages (e.g. `src/pages/about.astro`) import — do not invent a new shared layout in this task.

- [ ] **Step 7: Manual verification**

Run `npm run dev`, visit `http://localhost:4321/pickleball` (landing renders, links to `/pickleball/app`), then `/pickleball/app` (shows the login page with a working "Sign in with Google" link).

- [ ] **Step 8: Commit**

```bash
git add src/pickleball-app src/pages/pickleball
git commit -m "feat: add Pickleball SPA shell and public landing page"
```

---

### Task 16: Playwright e2e coverage

**Files:**
- Create: `tests/e2e/pickleball/pickleball-auth.spec.js`
- Create: `tests/e2e/pickleball/pickleball-crud.spec.js`
- Modify: `playwright.config.js`

**Interfaces:**
- Consumes: every API route from Tasks 9–14, the SPA from Task 15.
- Produces: automated regression coverage for this phase's "working, testable software" deliverable.

- [ ] **Step 1: Check `playwright.config.js`'s `worker` project pattern**

Open `playwright.config.js` and find the `worker` project's `testMatch`/`testDir` for `tests/e2e/admin.spec.js`. Add `tests/e2e/pickleball/**/*.spec.js` to the same project's match pattern (or its `testDir` if it already covers the whole `tests/e2e/` tree — check before assuming; only change what's needed to include the new directory).

- [ ] **Step 2: `pickleball-auth.spec.js`**

```javascript
import { test, expect } from '@playwright/test'

test.describe('Pickleball auth', () => {
  test('unauthenticated session check returns 401', async ({ request }) => {
    const response = await request.get('/api/pickleball/auth/session')
    expect(response.status()).toBe(401)
  })

  test('OAuth start redirects to Google with PKCE and state params', async ({ request }) => {
    // Inspect the 302 response directly instead of letting a browser follow
    // it — this asserts our own redirect construction without making a real
    // network request to Google (avoids CI flakiness/external dependency).
    const response = await request.get('/api/pickleball/auth/google/start', { maxRedirects: 0 })
    expect(response.status()).toBe(302)

    const location = new URL(response.headers()['location'])
    expect(location.origin + location.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(location.searchParams.get('code_challenge_method')).toBe('S256')
    expect(location.searchParams.get('state')).toBeTruthy()
  })

  test('login page renders for an unauthenticated visit to /pickleball/app', async ({ page }) => {
    await page.goto('/pickleball/app')
    await expect(page.getByText('Sign in with Google')).toBeVisible()
  })

  test('test-login issues a working session for an invited email', async ({ request }) => {
    // Requires a membership for this email to already exist locally — seeded via
    // `npm run pickleball:create-organization -- "Test Club" "test-club" "operator@example.com"`
    // applied to the local D1 before running this suite (documented in docs/pickleball/runbook.md).
    const loginResponse = await request.post('/api/pickleball/auth/test-login', {
      data: { email: 'operator@example.com' },
    })
    expect(loginResponse.ok()).toBe(true)

    const sessionResponse = await request.get('/api/pickleball/auth/session')
    expect(sessionResponse.ok()).toBe(true)
    const body = await sessionResponse.json()
    expect(body.role).toBe('ADMIN')
  })
})
```

- [ ] **Step 3: `pickleball-crud.spec.js`**

```javascript
import { test, expect } from '@playwright/test'

test.describe('Pickleball CRUD (authenticated)', () => {
  test.beforeEach(async ({ request }) => {
    await request.post('/api/pickleball/auth/test-login', { data: { email: 'operator@example.com' } })
  })

  test('creates a venue, a court, and a session end to end', async ({ request }) => {
    const venueResponse = await request.post('/api/pickleball/venues', {
      data: { name: 'Main Venue', address: '123 Court St', timezone: 'America/Denver' },
    })
    expect(venueResponse.ok()).toBe(true)
    const { venue } = await venueResponse.json()

    const courtResponse = await request.post('/api/pickleball/courts', {
      data: { venueId: venue.id, name: 'Court 1', sortOrder: 1 },
    })
    expect(courtResponse.ok()).toBe(true)

    const sessionResponse = await request.post('/api/pickleball/sessions', {
      data: {
        venueId: venue.id,
        name: 'Sunday Open Play',
        sessionType: 'OPEN_PLAY',
        scoringRulesetId: 'usap-2026-sideout-11-doubles',
        scheduledStart: '2026-08-30T18:00:00.000Z',
        scheduledEnd: '2026-08-30T22:00:00.000Z',
      },
    })
    expect(sessionResponse.ok()).toBe(true)
    const { session } = await sessionResponse.json()
    expect(session.status).toBe('DRAFT')
  })

  test('rejects player creation for a SCOREKEEPER (no MANAGE_PLAYERS permission)', async ({ request }) => {
    // operator@example.com is ADMIN (seeded via the bootstrap script), so it can
    // invite a SCOREKEEPER into the same org purely through the API under test.
    const sessionResponse = await request.get('/api/pickleball/auth/session')
    const { activeOrgId } = await sessionResponse.json()

    const inviteResponse = await request.post(`/api/pickleball/organizations/${activeOrgId}/memberships`, {
      data: { invitedEmail: 'scorekeeper@example.com', role: 'SCOREKEEPER' },
    })
    expect(inviteResponse.ok()).toBe(true)

    const loginResponse = await request.post('/api/pickleball/auth/test-login', {
      data: { email: 'scorekeeper@example.com' },
    })
    expect(loginResponse.ok()).toBe(true)

    const response = await request.post('/api/pickleball/players', { data: { displayName: 'Alex' } })
    expect(response.status()).toBe(403)
  })
})
```

- [ ] **Step 4: Run the suite**

Run: `npx playwright test --project=worker tests/e2e/pickleball/`
Expected: all tests pass (assuming the `operator@example.com` membership fixture from Step 2's comment has been seeded into the local `devlab-pickleball` D1 first — add that seeding as a `beforeAll` in a shared fixture file if the suite is run in CI; for this phase, document it as a one-time local setup step in Task 17's runbook).

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/pickleball playwright.config.js
git commit -m "test: add Pickleball auth and CRUD e2e coverage"
```

---

### Task 17: Runbook documentation

**Files:**
- Create: `docs/pickleball/runbook.md`

**Interfaces:** none — documentation only.

- [ ] **Step 1: Write the runbook**

```markdown
# Devlab Pickleball — Local Development Runbook

## One-time setup

1. Create a Google OAuth 2.0 Client ID (Web application) in Google Cloud Console.
   Authorized redirect URI: `http://localhost:8787/api/pickleball/auth/google/callback`.
2. Add to your local `.dev.vars` (gitignored):
   ```
   GOOGLE_OAUTH_CLIENT_ID=<from Google Cloud Console>
   GOOGLE_OAUTH_CLIENT_SECRET=<from Google Cloud Console>
   PICKLEBALL_SESSION_SECRET=<any long random string>
   PICKLEBALL_OAUTH_REDIRECT_BASE_URL=http://localhost:8787
   PICKLEBALL_TEST_AUTH_ENABLED=true
   ```
3. Apply migrations: `npx wrangler d1 migrations apply devlab-pickleball --local`
4. Bootstrap your first organization:
   ```bash
   npm run pickleball:create-organization -- "Your Club Name" "your-club-slug" "your-email@example.com" > /tmp/org.sql
   npx wrangler d1 execute devlab-pickleball --local --file=/tmp/org.sql
   ```
5. Run `npx wrangler dev --local`, visit `http://localhost:8787/pickleball/app`, sign in with Google.

## Running tests

- Unit: `npm run test:unit -- src/lib/pickleball src/worker/pickleball`
- E2E: `npx playwright test --project=worker tests/e2e/pickleball/` (requires the bootstrap step above to have run first, so the `test-login` fixture email has an active membership)

## Notes

- `PICKLEBALL_TEST_AUTH_ENABLED` must never be set in `wrangler.jsonc`'s committed `vars` — it exists only for local/CI `.dev.vars`.
- Organization creation is invite-only by design — there is no self-serve signup. New organizations are created via `scripts/pickleball/create-organization.mjs`.
```

- [ ] **Step 2: Commit**

```bash
git add docs/pickleball/runbook.md
git commit -m "docs: add Pickleball local development runbook"
```

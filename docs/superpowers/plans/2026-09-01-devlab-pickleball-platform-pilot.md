# Devlab Pickleball — Platform Admin & Self-Serve Pilot Orgs Implementation Plan

> **Superseded (2026-10-12).** This describes the logged-in operator app, retired in 2.0.0 by Phase 5 of `docs/superpowers/specs/2026-10-11-pickleball-free-open-play-design.md`. Kept as history: the routes, tables and files it names no longer exist.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a platform-level super-admin tier, self-serve pilot organization creation gated by a super-admin-issued invite, per-role operator quotas, and a public "Be a beta-tester" CTA on `/services`.

**Architecture:** A boolean `is_platform_admin` on `users`, resolved fresh from D1 on every request (never trusted from the session cookie, matching this subsystem's existing role-resolution rule). A super-admin gets ADMIN-equivalent permissions in any org via a single `hasPermission()` check, never via real membership rows. Org-creation invites are a new, separate table from `organization_memberships` (an invite-to-create-an-org has no org yet). The beta-tester CTA reuses the site's existing Turnstile-protected `ContactForm`/leads pipeline verbatim.

**Tech Stack:** Astro 7 (SSR, Cloudflare adapter), Cloudflare D1 (raw SQL), Zod v4, React 19 + react-router-dom v7, Tailwind 3.4, Vitest 4, Playwright 1.62.

**Spec:** `docs/superpowers/specs/2026-09-01-devlab-pickleball-platform-pilot-design.md`

## Global Constraints

- No auth token or platform-admin status is ever trusted from the client or the session cookie payload — `isPlatformAdmin` is resolved fresh from `users.is_platform_admin` on every request, same rule this subsystem already applies to `role` (see `requirePickleballSession`).
- Migrations are additive-only: `migrations/pickleball/0011_platform_pilot.sql` is new; nothing in `0001`–`0010` is edited.
- A platform admin never gets a real `organization_memberships` row inserted on their behalf — cross-org access is a runtime permission-check bypass only, so membership tables and the audit log stay an honest record of real invites.
- `NULL` on `organizations.max_admins/max_facilitators/max_scorekeepers` means unlimited — every pre-existing org (including the one already bootstrapped in production) is unaffected by this feature with no backfill.
- Zod validates every write endpoint's body; failures return `{ error, issues }` with HTTP 400, matching every existing pickleball route.

---

## File Structure

```
migrations/pickleball/0011_platform_pilot.sql        new — schema for this feature

src/lib/pickleball/quota.ts                          new — pure quota-check function
src/lib/pickleball/quota.test.ts                      new
src/lib/pickleball/permissions.ts                     modify — add hasPermission()
src/lib/pickleball/permissions.test.ts                modify — add hasPermission tests

src/worker/repositories/pickleball/users.js           modify — add isPlatformAdmin()
src/worker/repositories/pickleball/organizations.js    modify — quotas, status, list-all-with-counts
src/worker/repositories/pickleball/organizationInvites.js  new — invite CRUD

src/worker/pickleball/authContext.js                  modify — requirePickleballSession resolves isPlatformAdmin; new requireGoogleIdentity()

src/lib/schemas/pickleball/platform.ts                 new — createOrgInviteSchema, acceptOrgInviteSchema

src/pages/api/pickleball/auth/google/callback.ts       modify — pending-invite fallback when no memberships
src/pages/api/pickleball/auth/switch-org.ts            modify — platform-admin can target any org
src/pages/api/pickleball/auth/session.ts               modify — response includes isPlatformAdmin
src/pages/api/pickleball/auth/org-invites/[token]/accept.ts  new
src/pages/api/pickleball/platform/organizations/index.ts     new — GET list
src/pages/api/pickleball/platform/organizations/[id]/suspend.ts    new
src/pages/api/pickleball/platform/organizations/[id]/reactivate.ts new
src/pages/api/pickleball/platform/org-invites/index.ts        new — GET list, POST create
src/pages/api/pickleball/platform/org-invites/[id]/revoke.ts   new
src/pages/api/pickleball/organizations/[id]/memberships.ts     modify — quota check before create

src/middleware.ts                                      modify — public prefix for accept-invite route

src/pickleball-app/components/AppShell.jsx             modify — Platform nav item, hasPermission
src/pickleball-app/pages/PlatformPage.jsx               new
src/pickleball-app/pages/AcceptOrgInvitePage.jsx        new
src/pickleball-app/PickleballApp.jsx                    modify — register new routes
src/pages/pickleball/accept-invite/[token].astro        new

src/pages/services.astro                               modify — beta-tester section + ContactForm

tests/e2e/pickleball/pickleball-platform.spec.js        new
```

(Every existing route file listed in Task 4's exact file list is also modified, but only for the one-line `can(session.role, X)` → `hasPermission(session, X)` swap — not repeated here since Task 4 enumerates them.)

---

### Task 1: Migration — platform admin, org quotas/status, invites table

**Files:**
- Create: `migrations/pickleball/0011_platform_pilot.sql`

**Interfaces:**
- Produces: `users.is_platform_admin`, `organizations.status/max_admins/max_facilitators/max_scorekeepers`, `organization_invites` table — consumed by every later task.

- [ ] **Step 1: Write the migration**

```sql
-- migrations/pickleball/0011_platform_pilot.sql

ALTER TABLE users ADD COLUMN is_platform_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_platform_admin IN (0, 1));

ALTER TABLE organizations ADD COLUMN status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED'));
ALTER TABLE organizations ADD COLUMN max_admins INTEGER;
ALTER TABLE organizations ADD COLUMN max_facilitators INTEGER;
ALTER TABLE organizations ADD COLUMN max_scorekeepers INTEGER;

CREATE TABLE IF NOT EXISTS organization_invites (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  invited_email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED')),
  max_admins INTEGER,
  max_facilitators INTEGER,
  max_scorekeepers INTEGER,
  created_by_user_id TEXT NOT NULL,
  organization_id TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_organization_invites_email ON organization_invites(invited_email);
```

- [ ] **Step 2: Apply locally and verify**

Run:
```bash
npx wrangler d1 migrations apply devlab-pickleball --local
npx wrangler d1 execute devlab-pickleball --local --command="SELECT is_platform_admin FROM users LIMIT 1"
npx wrangler d1 execute devlab-pickleball --local --command="SELECT status, max_admins FROM organizations LIMIT 1"
npx wrangler d1 execute devlab-pickleball --local --command="SELECT * FROM organization_invites"
```
Expected: all three queries run without error (empty result sets are fine — the columns/table exist).

- [ ] **Step 3: Commit**

```bash
git add migrations/pickleball/0011_platform_pilot.sql
git commit -m "feat: add platform-admin, org-quota/status, and org-invite schema"
```

---

### Task 2: Quota-check pure function

**Files:**
- Create: `src/lib/pickleball/quota.ts`
- Test: `src/lib/pickleball/quota.test.ts`

**Interfaces:**
- Produces: `type OrgRole = 'ADMIN' | 'SESSION_FACILITATOR' | 'SCOREKEEPER'`, `canAddOperator(org: { maxAdmins: number | null; maxFacilitators: number | null; maxScorekeepers: number | null }, role: OrgRole, currentActiveCount: number): boolean` — consumed by Task 11's memberships route.

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/pickleball/quota.test.ts
import { describe, it, expect } from 'vitest'
import { canAddOperator } from './quota'

const unlimited = { maxAdmins: null, maxFacilitators: null, maxScorekeepers: null }

describe('canAddOperator', () => {
  it('allows any count when the role cap is null (unlimited)', () => {
    expect(canAddOperator(unlimited, 'SCOREKEEPER', 999)).toBe(true)
  })

  it('allows adding when current active count is below the cap', () => {
    expect(canAddOperator({ ...unlimited, maxScorekeepers: 5 }, 'SCOREKEEPER', 4)).toBe(true)
  })

  it('blocks adding when current active count is already at the cap', () => {
    expect(canAddOperator({ ...unlimited, maxScorekeepers: 5 }, 'SCOREKEEPER', 5)).toBe(false)
  })

  it('blocks adding when current active count exceeds the cap', () => {
    expect(canAddOperator({ ...unlimited, maxScorekeepers: 5 }, 'SCOREKEEPER', 6)).toBe(false)
  })

  it('checks the cap matching the role being added, not other roles', () => {
    const org = { maxAdmins: 1, maxFacilitators: 2, maxScorekeepers: 3 }
    expect(canAddOperator(org, 'ADMIN', 1)).toBe(false)
    expect(canAddOperator(org, 'SESSION_FACILITATOR', 1)).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/pickleball/quota.test.ts`
Expected: FAIL — `Cannot find module './quota'`

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/lib/pickleball/quota.ts
export type OrgRole = 'ADMIN' | 'SESSION_FACILITATOR' | 'SCOREKEEPER'

export interface OrgQuotas {
  maxAdmins: number | null
  maxFacilitators: number | null
  maxScorekeepers: number | null
}

const CAP_FIELD_BY_ROLE: Record<OrgRole, keyof OrgQuotas> = {
  ADMIN: 'maxAdmins',
  SESSION_FACILITATOR: 'maxFacilitators',
  SCOREKEEPER: 'maxScorekeepers',
}

export function canAddOperator(org: OrgQuotas, role: OrgRole, currentActiveCount: number): boolean {
  const cap = org[CAP_FIELD_BY_ROLE[role]]
  if (cap === null || cap === undefined) return true
  return currentActiveCount < cap
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/pickleball/quota.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/pickleball/quota.ts src/lib/pickleball/quota.test.ts
git commit -m "feat: add the per-role operator quota check"
```

---

### Task 3: `hasPermission()` — platform-admin-aware permission check

**Files:**
- Modify: `src/lib/pickleball/permissions.ts`
- Modify: `src/lib/pickleball/permissions.test.ts` (create if it doesn't already exist)

**Interfaces:**
- Consumes: `Role`, `Permission`, `can()` (existing, unchanged).
- Produces: `interface PermissionSession { role: Role | null; isPlatformAdmin: boolean }`, `hasPermission(session: PermissionSession, permission: Permission): boolean` — consumed by Task 4 (every route swap) and Task 12 (AppShell).

- [ ] **Step 1: Write the failing test**

```typescript
// append to src/lib/pickleball/permissions.test.ts
import { hasPermission } from './permissions'

describe('hasPermission', () => {
  it('defers to can() for a normal (non-platform-admin) session', () => {
    expect(hasPermission({ role: 'SCOREKEEPER', isPlatformAdmin: false }, 'MANAGE_OPERATORS')).toBe(false)
    expect(hasPermission({ role: 'ADMIN', isPlatformAdmin: false }, 'MANAGE_OPERATORS')).toBe(true)
  })

  it('grants every permission to a platform admin regardless of role', () => {
    expect(hasPermission({ role: null, isPlatformAdmin: true }, 'MANAGE_OPERATORS')).toBe(true)
    expect(hasPermission({ role: 'SCOREKEEPER', isPlatformAdmin: true }, 'CONFIGURE_SYSTEM_DEFAULTS')).toBe(true)
  })

  it('returns false for a null role and no platform-admin override', () => {
    expect(hasPermission({ role: null, isPlatformAdmin: false }, 'MANAGE_OPERATORS')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/pickleball/permissions.test.ts`
Expected: FAIL — `hasPermission is not a function` (or `is not exported`)

- [ ] **Step 3: Add the implementation**

Append to `src/lib/pickleball/permissions.ts`:

```typescript
export interface PermissionSession {
  role: Role | null
  isPlatformAdmin: boolean
}

export function hasPermission(session: PermissionSession, permission: Permission): boolean {
  if (session.isPlatformAdmin) return true
  if (!session.role) return false
  return can(session.role, permission)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/pickleball/permissions.test.ts`
Expected: PASS (all tests, including the pre-existing `can()` ones)

- [ ] **Step 5: Commit**

```bash
git add src/lib/pickleball/permissions.ts src/lib/pickleball/permissions.test.ts
git commit -m "feat: add hasPermission() for platform-admin permission override"
```

---

### Task 4: Migrate every existing route from `can()` to `hasPermission()`

**Files (exact list — every file in the repo that currently calls `can(session.role` or `can(role`):**
```
src/pages/api/pickleball/courts/index.ts
src/pages/api/pickleball/organizations/[id]/audit-events.ts
src/pages/api/pickleball/organizations/[id]/memberships.ts
src/pages/api/pickleball/organizations/[id]/memberships/[membershipId].ts
src/pages/api/pickleball/players/[id].ts
src/pages/api/pickleball/players/index.ts
src/pages/api/pickleball/scoring-rulesets/[id].ts
src/pages/api/pickleball/scoring-rulesets/index.ts
src/pages/api/pickleball/sessions/[id]/courts/assign.ts
src/pages/api/pickleball/sessions/[id]/courts/disable.ts
src/pages/api/pickleball/sessions/[id]/courts/enable.ts
src/pages/api/pickleball/sessions/[id]/courts/release.ts
src/pages/api/pickleball/sessions/[id]/courts/replace.ts
src/pages/api/pickleball/sessions/[id]/games/[gameId]/abandon.ts
src/pages/api/pickleball/sessions/[id]/games/[gameId]/correct.ts
src/pages/api/pickleball/sessions/[id]/games/[gameId]/finish.ts
src/pages/api/pickleball/sessions/[id]/games/[gameId]/rally.ts
src/pages/api/pickleball/sessions/[id]/games/[gameId]/reopen.ts
src/pages/api/pickleball/sessions/[id]/games/[gameId]/undo.ts
src/pages/api/pickleball/sessions/[id]/games/start.ts
src/pages/api/pickleball/sessions/[id]/operators/grant.ts
src/pages/api/pickleball/sessions/[id]/operators/revoke.ts
src/pages/api/pickleball/sessions/[id]/players/availability.ts
src/pages/api/pickleball/sessions/[id]/players/cancel.ts
src/pages/api/pickleball/sessions/[id]/players/check-in-bulk.ts
src/pages/api/pickleball/sessions/[id]/players/check-in.ts
src/pages/api/pickleball/sessions/[id]/players/index.ts
src/pages/api/pickleball/sessions/[id]/players/leave.ts
src/pages/api/pickleball/sessions/[id]/queue/index.ts
src/pages/api/pickleball/sessions/[id]/queue/leave.ts
src/pages/api/pickleball/sessions/[id]/status.ts
src/pages/api/pickleball/sessions/index.ts
src/pages/api/pickleball/venues/index.ts
```
(`src/pickleball-app/components/AppShell.jsx` is handled separately in Task 12, since it also gets the new "Platform" nav item in the same edit.)

**Interfaces:**
- Consumes: `hasPermission(session, permission)` from Task 3.
- Produces: no `can(session.role` call sites remain anywhere except inside `permissions.ts` itself and its own test file.

This is a single mechanical text substitution repeated across every file above — same two changes each time:
1. `import { can } from '<relative path>/lib/pickleball/permissions'` → `import { hasPermission } from '<relative path>/lib/pickleball/permissions'`
2. Every `can(session.role, 'PERMISSION_NAME')` → `hasPermission(session, 'PERMISSION_NAME')`

- [ ] **Step 1: Run the substitution across every file in the list above**

```bash
FILES="src/pages/api/pickleball/courts/index.ts src/pages/api/pickleball/organizations/[id]/audit-events.ts src/pages/api/pickleball/organizations/[id]/memberships.ts src/pages/api/pickleball/organizations/[id]/memberships/[membershipId].ts src/pages/api/pickleball/players/[id].ts src/pages/api/pickleball/players/index.ts src/pages/api/pickleball/scoring-rulesets/[id].ts src/pages/api/pickleball/scoring-rulesets/index.ts src/pages/api/pickleball/sessions/[id]/courts/assign.ts src/pages/api/pickleball/sessions/[id]/courts/disable.ts src/pages/api/pickleball/sessions/[id]/courts/enable.ts src/pages/api/pickleball/sessions/[id]/courts/release.ts src/pages/api/pickleball/sessions/[id]/courts/replace.ts src/pages/api/pickleball/sessions/[id]/games/[gameId]/abandon.ts src/pages/api/pickleball/sessions/[id]/games/[gameId]/correct.ts src/pages/api/pickleball/sessions/[id]/games/[gameId]/finish.ts src/pages/api/pickleball/sessions/[id]/games/[gameId]/rally.ts src/pages/api/pickleball/sessions/[id]/games/[gameId]/reopen.ts src/pages/api/pickleball/sessions/[id]/games/[gameId]/undo.ts src/pages/api/pickleball/sessions/[id]/games/start.ts src/pages/api/pickleball/sessions/[id]/operators/grant.ts src/pages/api/pickleball/sessions/[id]/operators/revoke.ts src/pages/api/pickleball/sessions/[id]/players/availability.ts src/pages/api/pickleball/sessions/[id]/players/cancel.ts src/pages/api/pickleball/sessions/[id]/players/check-in-bulk.ts src/pages/api/pickleball/sessions/[id]/players/check-in.ts src/pages/api/pickleball/sessions/[id]/players/index.ts src/pages/api/pickleball/sessions/[id]/players/leave.ts src/pages/api/pickleball/sessions/[id]/queue/index.ts src/pages/api/pickleball/sessions/[id]/queue/leave.ts src/pages/api/pickleball/sessions/[id]/status.ts src/pages/api/pickleball/sessions/index.ts src/pages/api/pickleball/venues/index.ts"

for f in $FILES; do
  sed -i \
    -e "s/import { can } from '\(.*\)lib\/pickleball\/permissions'/import { hasPermission } from '\1lib\/pickleball\/permissions'/" \
    -e "s/can(session\.role, /hasPermission(session, /g" \
    "$f"
done
```

- [ ] **Step 2: Verify no call sites were missed and none reference the old name**

```bash
grep -rn "can(session\.role" src/pages/api/pickleball || echo "NONE LEFT — good"
grep -rln "import { can }" src/pages/api/pickleball | grep -v permissions.ts || echo "NONE LEFT — good"
```
Expected: both print "NONE LEFT — good".

- [ ] **Step 3: Type-check and run the affected unit/e2e suites**

```bash
npx tsc --noEmit -p tsconfig.json
npx vitest run src/lib/pickleball src/worker/pickleball
```
Expected: `tsc` clean, all existing unit tests still pass (this substitution changes no logic — every non-platform-admin session behaves identically to before).

- [ ] **Step 4: Commit**

```bash
git add src/pages/api/pickleball
git commit -m "refactor: migrate every route from can(session.role) to hasPermission(session)"
```

---

### Task 5: `isPlatformAdmin()` repo function + `requirePickleballSession`/`requireGoogleIdentity`

**Files:**
- Modify: `src/worker/repositories/pickleball/users.js`
- Modify: `src/worker/pickleball/authContext.js`

**Interfaces:**
- Consumes: `parseCookies`, `verifySession`, `SESSION_COOKIE_NAME` (existing, unchanged); `getOrganization` (Task 6 — note this creates a small forward dependency: do Task 6's `organizations.js` changes before this task's Step 2, or the import added here won't resolve).
- Produces: `isPlatformAdmin(db, userId): Promise<boolean>`; `requirePickleballSession(request, env)` now returns `{ userId, googleSub, activeOrgId: string | null, role: Role | null, isPlatformAdmin: boolean }` (widened from the previous always-non-null `activeOrgId`/`role`) and throws 403 for a `SUSPENDED` org regardless of role or platform-admin status; new `requireGoogleIdentity(request, env): Promise<{ userId: string; googleSub: string }>` — consumed by Task 10's accept-invite route.

**Note on task order:** this task's Step 2 imports `getOrganization` from `organizations.js`, which Task 6 modifies (adding `status`/quota columns to its `SELECT`). Do Task 6 before this task, or do Task 6's `organizations.js` edit first and return to it — the two are order-dependent despite being numbered 5 and 6.

- [ ] **Step 1: Add `isPlatformAdmin` to the users repository**

Append to `src/worker/repositories/pickleball/users.js`:

```javascript
export async function isPlatformAdmin(db, userId) {
  const row = await db.prepare('SELECT is_platform_admin FROM users WHERE id = ?').bind(userId).first()
  return Boolean(row?.is_platform_admin)
}
```

- [ ] **Step 2: Restructure `requirePickleballSession` and add `requireGoogleIdentity`**

Replace `requirePickleballSession` in `src/worker/pickleball/authContext.js` with:

```javascript
import { isPlatformAdmin } from '../repositories/pickleball/users.js'

// ... (keep every existing export above unchanged) ...

// Verifies the session cookie is a genuine, unexpired Google-authenticated
// session and returns identity only — no org/membership requirement. Used
// by the org-invite accept flow, where the caller by definition has no
// membership anywhere yet.
export async function requireGoogleIdentity(request, env) {
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

  return { userId: session.userId, googleSub: session.googleSub }
}

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

  const platformAdmin = await isPlatformAdmin(env.PICKLEBALL_DB, session.userId)

  if (!session.activeOrgId) {
    if (platformAdmin) {
      return { userId: session.userId, googleSub: session.googleSub, activeOrgId: null, role: null, isPlatformAdmin: true }
    }
    const error = new Error('No active organization selected.')
    error.status = 403
    throw error
  }

  const membership = await getMembership(env.PICKLEBALL_DB, {
    organizationId: session.activeOrgId,
    userId: session.userId,
  })

  if (!membership && !platformAdmin) {
    const error = new Error('No active membership in this organization.')
    error.status = 403
    throw error
  }

  // Centralized here (rather than in each of the ~32 org-scoped route
  // files) because every one of them already calls requirePickleballSession
  // first — one check here covers all of them. Applies to a platform admin
  // too: suspension is absolute, reactivate the org before acting on it.
  const organization = await getOrganization(env.PICKLEBALL_DB, session.activeOrgId)
  if (organization?.status === 'SUSPENDED') {
    const error = new Error('This organization is suspended.')
    error.status = 403
    throw error
  }

  if (!membership) {
    return { userId: session.userId, googleSub: session.googleSub, activeOrgId: session.activeOrgId, role: null, isPlatformAdmin: true }
  }

  return {
    userId: session.userId,
    googleSub: session.googleSub,
    activeOrgId: session.activeOrgId,
    role: membership.role,
    isPlatformAdmin: platformAdmin,
  }
}
```

Add the import at the top of `authContext.js`:

```javascript
import { getOrganization } from '../repositories/pickleball/organizations.js'
```

- [ ] **Step 3: Verify against existing unit tests and the running app**

Run:
```bash
npx vitest run src/worker/pickleball
npx tsc --noEmit -p tsconfig.json
```
Expected: PASS / clean. (No dedicated unit test exists for `requirePickleballSession` today — it's D1-touching and covered by e2e per this subsystem's established convention; this step is a regression check, not new test authoring.)

- [ ] **Step 4: Commit**

```bash
git add src/worker/repositories/pickleball/users.js src/worker/pickleball/authContext.js
git commit -m "feat: resolve isPlatformAdmin in requirePickleballSession; add requireGoogleIdentity"
```

---

### Task 6: Repository layer — organizations (quotas/status/list) and organization invites

**Files:**
- Modify: `src/worker/repositories/pickleball/organizations.js`
- Create: `src/worker/repositories/pickleball/organizationInvites.js`

**Interfaces:**
- Consumes: `nowIso()` from `../../utils/responses.js` (existing).
- Produces: `getOrganization` (extended shape below), `listAllOrganizationsWithCounts(db)`, `setOrganizationStatus(db, id, status)`; `createOrganizationInvite(db, { invitedEmail, maxAdmins, maxFacilitators, maxScorekeepers, createdByUserId })`, `getInviteByToken(db, token)`, `listOrganizationInvites(db)`, `markInviteAccepted(db, inviteId, organizationId)`, `revokeInvite(db, inviteId)`, `getPendingInviteForEmail(db, email)` — consumed by Tasks 8, 9, 10.

- [ ] **Step 1: Extend `organizations.js`**

Replace the whole file's contents with:

```javascript
import { nowIso } from '../../utils/responses.js'

function toOrganization(row) {
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status,
    maxAdmins: row.max_admins,
    maxFacilitators: row.max_facilitators,
    maxScorekeepers: row.max_scorekeepers,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const ORG_COLUMNS = 'id, name, slug, status, max_admins, max_facilitators, max_scorekeepers, created_at, updated_at'

export async function getOrganization(db, id) {
  const row = await db.prepare(`SELECT ${ORG_COLUMNS} FROM organizations WHERE id = ?`).bind(id).first()
  return toOrganization(row)
}

export async function createOrganization(db, { name, slug, maxAdmins = null, maxFacilitators = null, maxScorekeepers = null }) {
  const id = crypto.randomUUID()
  const timestamp = nowIso()

  await db
    .prepare(
      `INSERT INTO organizations (id, name, slug, status, max_admins, max_facilitators, max_scorekeepers, created_at, updated_at)
       VALUES (?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?)`,
    )
    .bind(id, name, slug, maxAdmins, maxFacilitators, maxScorekeepers, timestamp, timestamp)
    .run()

  return getOrganization(db, id)
}

export async function setOrganizationStatus(db, id, status) {
  const result = await db
    .prepare(`UPDATE organizations SET status = ?, updated_at = ? WHERE id = ?`)
    .bind(status, nowIso(), id)
    .run()
  return result.meta.changes > 0
}

// Platform-admin overview: every org plus how many ACTIVE members it has
// per role, so the UI can show "3 of 5 scorekeepers" without a second
// round-trip per org.
export async function listAllOrganizationsWithCounts(db) {
  const result = await db
    .prepare(
      `SELECT o.${ORG_COLUMNS.split(', ').map((c) => `${c}`).join(', o.')},
              SUM(CASE WHEN m.role = 'ADMIN' AND m.status = 'ACTIVE' THEN 1 ELSE 0 END) AS admin_count,
              SUM(CASE WHEN m.role = 'SESSION_FACILITATOR' AND m.status = 'ACTIVE' THEN 1 ELSE 0 END) AS facilitator_count,
              SUM(CASE WHEN m.role = 'SCOREKEEPER' AND m.status = 'ACTIVE' THEN 1 ELSE 0 END) AS scorekeeper_count
       FROM organizations o
       LEFT JOIN organization_memberships m ON m.organization_id = o.id
       GROUP BY o.id
       ORDER BY o.created_at ASC`,
    )
    .all()

  return (result.results || []).map((row) => ({
    ...toOrganization(row),
    adminCount: row.admin_count || 0,
    facilitatorCount: row.facilitator_count || 0,
    scorekeeperCount: row.scorekeeper_count || 0,
  }))
}

// Active-membership count for one org+role, used by the quota check at
// invite time (see canAddOperator in src/lib/pickleball/quota.ts).
export async function countActiveMembershipsByRole(db, organizationId, role) {
  const row = await db
    .prepare(`SELECT COUNT(*) AS count FROM organization_memberships WHERE organization_id = ? AND role = ? AND status = 'ACTIVE'`)
    .bind(organizationId, role)
    .first()
  return row?.count || 0
}
```

- [ ] **Step 2: Create `organizationInvites.js`**

```javascript
// src/worker/repositories/pickleball/organizationInvites.js
import { nowIso } from '../../utils/responses.js'
import { randomBase64Url } from '../../../lib/pickleball/webCrypto.js'

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

function toInvite(row) {
  if (!row) return null
  return {
    id: row.id,
    token: row.token,
    invitedEmail: row.invited_email,
    status: row.status,
    maxAdmins: row.max_admins,
    maxFacilitators: row.max_facilitators,
    maxScorekeepers: row.max_scorekeepers,
    createdByUserId: row.created_by_user_id,
    organizationId: row.organization_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
  }
}

const INVITE_COLUMNS =
  'id, token, invited_email, status, max_admins, max_facilitators, max_scorekeepers, created_by_user_id, organization_id, created_at, expires_at, accepted_at'

export async function createOrganizationInvite(db, { invitedEmail, maxAdmins = null, maxFacilitators = null, maxScorekeepers = null, createdByUserId }) {
  const id = crypto.randomUUID()
  const token = randomBase64Url(24)
  const timestamp = nowIso()
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString()

  await db
    .prepare(
      `INSERT INTO organization_invites
         (id, token, invited_email, status, max_admins, max_facilitators, max_scorekeepers, created_by_user_id, organization_id, created_at, expires_at, accepted_at)
       VALUES (?, ?, ?, 'PENDING', ?, ?, ?, ?, NULL, ?, ?, NULL)`,
    )
    .bind(id, token, String(invitedEmail).trim().toLowerCase(), maxAdmins, maxFacilitators, maxScorekeepers, createdByUserId, timestamp, expiresAt)
    .run()

  return getInviteById(db, id)
}

export async function getInviteById(db, id) {
  const row = await db.prepare(`SELECT ${INVITE_COLUMNS} FROM organization_invites WHERE id = ?`).bind(id).first()
  return toInvite(row)
}

export async function getInviteByToken(db, token) {
  const row = await db.prepare(`SELECT ${INVITE_COLUMNS} FROM organization_invites WHERE token = ?`).bind(token).first()
  return toInvite(row)
}

export async function listOrganizationInvites(db) {
  const result = await db.prepare(`SELECT ${INVITE_COLUMNS} FROM organization_invites ORDER BY created_at DESC`).all()
  return (result.results || []).map(toInvite)
}

// The most recent still-pending, unexpired invite for an email, checked by
// the Google OAuth callback when that email has zero real org memberships
// (see google/callback.ts) — an invite past its expires_at is deliberately
// excluded here rather than being flipped to EXPIRED, since no background
// sweep job exists; the accept route re-validates expiry independently.
export async function getPendingInviteForEmail(db, email) {
  const row = await db
    .prepare(
      `SELECT ${INVITE_COLUMNS} FROM organization_invites
       WHERE invited_email = ? AND status = 'PENDING' AND expires_at > ?
       ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(String(email).trim().toLowerCase(), nowIso())
    .first()
  return toInvite(row)
}

export async function markInviteAccepted(db, inviteId, organizationId) {
  await db
    .prepare(`UPDATE organization_invites SET status = 'ACCEPTED', organization_id = ?, accepted_at = ? WHERE id = ?`)
    .bind(organizationId, nowIso(), inviteId)
    .run()
}

export async function revokeInvite(db, inviteId) {
  const result = await db
    .prepare(`UPDATE organization_invites SET status = 'REVOKED' WHERE id = ? AND status = 'PENDING'`)
    .bind(inviteId)
    .run()
  return result.meta.changes > 0
}
```

- [ ] **Step 2b: Verify `randomBase64Url` is exported from `webCrypto.js`**

Run: `grep -n "export function randomBase64Url" src/lib/pickleball/webCrypto.js`
Expected: one match (it already exists from Phase 1 — no change needed to that file).

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: clean (these are plain `.js` files; `tsc` only checks the `.ts` consumers, which don't exist yet until later tasks).

- [ ] **Step 4: Commit**

```bash
git add src/worker/repositories/pickleball/organizations.js src/worker/repositories/pickleball/organizationInvites.js
git commit -m "feat: add organization quota/status fields and the organization_invites repository"
```

---

### Task 7: Zod schemas for the platform API

**Files:**
- Create: `src/lib/schemas/pickleball/platform.ts`

**Interfaces:**
- Produces: `createOrgInviteSchema`, `acceptOrgInviteSchema` — consumed by Tasks 8 and 10.

- [ ] **Step 1: Write the schemas**

```typescript
// src/lib/schemas/pickleball/platform.ts
import { z } from 'zod'

const quotaField = z.number().int().min(1).max(500).nullable().optional()

export const createOrgInviteSchema = z.object({
  invitedEmail: z.string().email(),
  maxAdmins: quotaField,
  maxFacilitators: quotaField,
  maxScorekeepers: quotaField,
})

export type CreateOrgInviteInput = z.infer<typeof createOrgInviteSchema>

const slugPattern = /^[a-z0-9]+(-[a-z0-9]+)*$/

export const acceptOrgInviteSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().min(1).max(80).regex(slugPattern, 'Slug must be lowercase letters, numbers, and hyphens only.'),
})

export type AcceptOrgInviteInput = z.infer<typeof acceptOrgInviteSchema>
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/lib/schemas/pickleball/platform.ts
git commit -m "feat: add zod schemas for org-invite creation and acceptance"
```

---

### Task 8: Platform API routes

**Files:**
- Create: `src/pages/api/pickleball/platform/organizations/index.ts`
- Create: `src/pages/api/pickleball/platform/organizations/[id]/suspend.ts`
- Create: `src/pages/api/pickleball/platform/organizations/[id]/reactivate.ts`
- Create: `src/pages/api/pickleball/platform/org-invites/index.ts`
- Create: `src/pages/api/pickleball/platform/org-invites/[id]/revoke.ts`

**Interfaces:**
- Consumes: `requirePickleballSession` (Task 5), `listAllOrganizationsWithCounts`/`setOrganizationStatus` (Task 6), `createOrganizationInvite`/`listOrganizationInvites`/`revokeInvite` (Task 6), `createOrgInviteSchema` (Task 7), `jsonResponse`/`apiErrorResponse` (existing).
- Produces: the 5 routes below, all gated on `session.isPlatformAdmin`.

- [ ] **Step 1: `organizations/index.ts` (GET — list all orgs)**

```typescript
// src/pages/api/pickleball/platform/organizations/index.ts
import type { APIRoute } from 'astro'
import { requirePickleballSession } from '../../../../../worker/pickleball/authContext.js'
import { listAllOrganizationsWithCounts } from '../../../../../worker/repositories/pickleball/organizations.js'
import { jsonResponse, apiErrorResponse } from '../../../../../worker/utils/responses.js'
import { getEnv } from '../../../../../lib/env'

export const GET: APIRoute = async ({ request }) => {
  const env = getEnv()
  try {
    const session = await requirePickleballSession(request, env)
    if (!session.isPlatformAdmin) return jsonResponse({ error: 'Forbidden.' }, 403)

    const organizations = await listAllOrganizationsWithCounts(env.PICKLEBALL_DB)
    return jsonResponse({ organizations }, 200)
  } catch (error) {
    return apiErrorResponse(error)
  }
}
```

- [ ] **Step 2: `organizations/[id]/suspend.ts` and `.../reactivate.ts`**

```typescript
// src/pages/api/pickleball/platform/organizations/[id]/suspend.ts
import type { APIRoute } from 'astro'
import { requirePickleballSession } from '../../../../../../worker/pickleball/authContext.js'
import { getOrganization, setOrganizationStatus } from '../../../../../../worker/repositories/pickleball/organizations.js'
import { jsonResponse, apiErrorResponse } from '../../../../../../worker/utils/responses.js'
import { getEnv } from '../../../../../../lib/env'

export const POST: APIRoute = async ({ request, params }) => {
  const env = getEnv()
  try {
    const session = await requirePickleballSession(request, env)
    if (!session.isPlatformAdmin) return jsonResponse({ error: 'Forbidden.' }, 403)

    const organizationId = params.id as string
    const organization = await getOrganization(env.PICKLEBALL_DB, organizationId)
    if (!organization) return jsonResponse({ error: 'Not found.' }, 404)

    await setOrganizationStatus(env.PICKLEBALL_DB, organizationId, 'SUSPENDED')
    return jsonResponse({ ok: true }, 200)
  } catch (error) {
    return apiErrorResponse(error)
  }
}
```

```typescript
// src/pages/api/pickleball/platform/organizations/[id]/reactivate.ts
import type { APIRoute } from 'astro'
import { requirePickleballSession } from '../../../../../../worker/pickleball/authContext.js'
import { getOrganization, setOrganizationStatus } from '../../../../../../worker/repositories/pickleball/organizations.js'
import { jsonResponse, apiErrorResponse } from '../../../../../../worker/utils/responses.js'
import { getEnv } from '../../../../../../lib/env'

export const POST: APIRoute = async ({ request, params }) => {
  const env = getEnv()
  try {
    const session = await requirePickleballSession(request, env)
    if (!session.isPlatformAdmin) return jsonResponse({ error: 'Forbidden.' }, 403)

    const organizationId = params.id as string
    const organization = await getOrganization(env.PICKLEBALL_DB, organizationId)
    if (!organization) return jsonResponse({ error: 'Not found.' }, 404)

    await setOrganizationStatus(env.PICKLEBALL_DB, organizationId, 'ACTIVE')
    return jsonResponse({ ok: true }, 200)
  } catch (error) {
    return apiErrorResponse(error)
  }
}
```

- [ ] **Step 3: `org-invites/index.ts` (GET list, POST create)**

```typescript
// src/pages/api/pickleball/platform/org-invites/index.ts
import type { APIRoute } from 'astro'
import { requirePickleballSession } from '../../../../../worker/pickleball/authContext.js'
import { createOrganizationInvite, listOrganizationInvites } from '../../../../../worker/repositories/pickleball/organizationInvites.js'
import { createOrgInviteSchema } from '../../../../../lib/schemas/pickleball/platform'
import { jsonResponse, apiErrorResponse } from '../../../../../worker/utils/responses.js'
import { getEnv } from '../../../../../lib/env'

export const GET: APIRoute = async ({ request }) => {
  const env = getEnv()
  try {
    const session = await requirePickleballSession(request, env)
    if (!session.isPlatformAdmin) return jsonResponse({ error: 'Forbidden.' }, 403)

    const invites = await listOrganizationInvites(env.PICKLEBALL_DB)
    return jsonResponse({ invites }, 200)
  } catch (error) {
    return apiErrorResponse(error)
  }
}

export const POST: APIRoute = async ({ request }) => {
  const env = getEnv()
  try {
    const session = await requirePickleballSession(request, env)
    if (!session.isPlatformAdmin) return jsonResponse({ error: 'Forbidden.' }, 403)

    const body = await request.json().catch(() => null)
    const result = createOrgInviteSchema.safeParse(body)
    if (!result.success) {
      return jsonResponse({ error: 'Validation failed.', issues: result.error.issues }, 400)
    }

    const invite = await createOrganizationInvite(env.PICKLEBALL_DB, {
      invitedEmail: result.data.invitedEmail,
      maxAdmins: result.data.maxAdmins ?? null,
      maxFacilitators: result.data.maxFacilitators ?? null,
      maxScorekeepers: result.data.maxScorekeepers ?? null,
      createdByUserId: session.userId,
    })

    const acceptUrl = `${env.PICKLEBALL_OAUTH_REDIRECT_BASE_URL}/pickleball/accept-invite/${invite.token}`
    return jsonResponse({ invite, acceptUrl }, 201)
  } catch (error) {
    return apiErrorResponse(error)
  }
}
```

- [ ] **Step 4: `org-invites/[id]/revoke.ts`**

```typescript
// src/pages/api/pickleball/platform/org-invites/[id]/revoke.ts
import type { APIRoute } from 'astro'
import { requirePickleballSession } from '../../../../../../worker/pickleball/authContext.js'
import { revokeInvite } from '../../../../../../worker/repositories/pickleball/organizationInvites.js'
import { jsonResponse, apiErrorResponse } from '../../../../../../worker/utils/responses.js'
import { getEnv } from '../../../../../../lib/env'

export const POST: APIRoute = async ({ request, params }) => {
  const env = getEnv()
  try {
    const session = await requirePickleballSession(request, env)
    if (!session.isPlatformAdmin) return jsonResponse({ error: 'Forbidden.' }, 403)

    const revoked = await revokeInvite(env.PICKLEBALL_DB, params.id as string)
    if (!revoked) return jsonResponse({ error: 'Invite not found or already resolved.' }, 409)

    return jsonResponse({ ok: true }, 200)
  } catch (error) {
    return apiErrorResponse(error)
  }
}
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/pages/api/pickleball/platform
git commit -m "feat: add platform-admin API routes for orgs and org-invites"
```

---

### Task 9: Wire platform admin + pilot invites into auth (callback, switch-org, session)

**Files:**
- Modify: `src/pages/api/pickleball/auth/google/callback.ts`
- Modify: `src/pages/api/pickleball/auth/switch-org.ts`
- Modify: `src/pages/api/pickleball/auth/session.ts`

**Interfaces:**
- Consumes: `getPendingInviteForEmail` (Task 6), `isPlatformAdmin` (Task 5), `getOrganization` (Task 6).
- Produces: a pilot invitee with zero memberships lands on `/pickleball/accept-invite/:token` instead of `?error=no_access`; `switch-org` accepts any organization id for a platform admin; `/api/pickleball/auth/session`'s response includes `isPlatformAdmin`.

- [ ] **Step 1: `google/callback.ts` — pending-invite fallback**

In `src/pages/api/pickleball/auth/google/callback.ts`, add the import:

```typescript
import { getPendingInviteForEmail } from '../../../../../worker/repositories/pickleball/organizationInvites.js'
```

Replace the `if (!memberships.length) { ... }` block with:

```typescript
    if (!memberships.length) {
      const pendingInvite = await getPendingInviteForEmail(env.PICKLEBALL_DB, profile.email)
      if (pendingInvite) {
        clearFailedLogins(loginKey)
        const now = Math.floor(Date.now() / 1000)
        const token = await signSession(
          { userId: user.id, googleSub: user.googleSub, activeOrgId: null, iat: now, exp: now + SESSION_MAX_AGE_SECONDS },
          env.PICKLEBALL_SESSION_SECRET,
        )
        return new Response(null, {
          status: 302,
          headers: {
            Location: `/pickleball/accept-invite/${pendingInvite.token}`,
            'Set-Cookie': buildSetCookieHeader(SESSION_COOKIE_NAME, token, { secure, maxAgeSeconds: SESSION_MAX_AGE_SECONDS }),
          },
        })
      }

      recordFailedLogin(loginKey)
      return new Response(null, {
        status: 302,
        headers: { Location: `${LOGIN_PATH}?error=no_access`, 'Set-Cookie': clearOauthCookie },
      })
    }
```

- [ ] **Step 2: `switch-org.ts` — platform-admin can target any org**

In `src/pages/api/pickleball/auth/switch-org.ts`, add the import:

```typescript
import { getOrganization } from '../../../../worker/repositories/pickleball/organizations.js'
```

Replace the body from `const activeOrgId = resolveActiveOrgId(...)` through the `if (activeOrgId !== requestedOrgId) { ... }` block with:

```typescript
    let activeOrgId: string
    if (session.isPlatformAdmin) {
      const organization = await getOrganization(env.PICKLEBALL_DB, requestedOrgId)
      if (!organization) {
        return jsonResponse({ error: 'Organization not found.' }, 404)
      }
      activeOrgId = requestedOrgId
    } else {
      const resolved = resolveActiveOrgId(memberships, requestedOrgId)
      if (resolved !== requestedOrgId) {
        return jsonResponse({ error: 'Not a member of that organization.' }, 403)
      }
      activeOrgId = resolved
    }
```

(This removes the old unconditional `const activeOrgId = ...` / `if (activeOrgId !== requestedOrgId)` pair — the rest of the file, including the `linkMembershipUser` call keyed on `targetMembership`, stays unchanged; for a platform admin acting on an org with no real membership, `targetMembership` is simply `undefined` and that block is skipped, exactly as it already handles any org the memberships array doesn't contain.)

- [ ] **Step 3: `session.ts` — include `isPlatformAdmin` in the response**

In `src/pages/api/pickleball/auth/session.ts`, add `isPlatformAdmin: session.isPlatformAdmin` to the returned JSON object:

```typescript
    return jsonResponse(
      {
        userId: session.userId,
        activeOrgId: session.activeOrgId,
        role: session.role,
        isPlatformAdmin: session.isPlatformAdmin,
        email: user.email,
        name: user.name,
        organizations: memberships.map((m: { organizationId: string; role: string }) => ({
          organizationId: m.organizationId,
          role: m.role,
        })),
      },
      200,
    )
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/pages/api/pickleball/auth/google/callback.ts src/pages/api/pickleball/auth/switch-org.ts src/pages/api/pickleball/auth/session.ts
git commit -m "feat: wire platform-admin org switching and pilot-invite fallback into auth"
```

---

### Task 10: Accept-invite route, page, and the middleware public-path exception

**Files:**
- Create: `src/pages/api/pickleball/auth/org-invites/[token]/accept.ts`
- Create: `src/pickleball-app/pages/AcceptOrgInvitePage.jsx`
- Create: `src/pages/pickleball/accept-invite/[token].astro`
- Modify: `src/middleware.ts`
- Modify: `src/pickleball-app/PickleballApp.jsx`

**Interfaces:**
- Consumes: `requireGoogleIdentity` (Task 5), `getInviteByToken`/`markInviteAccepted` (Task 6), `createOrganization` (Task 6), `createMembership` (existing), `acceptOrgInviteSchema` (Task 7), `pickleballApi` (existing SPA client).
- Produces: `POST /api/pickleball/auth/org-invites/:token/accept` → `{ ok: true, activeOrgId }` + sets the session cookie; the SPA route `pickleball/accept-invite/:token`.

- [ ] **Step 1: The accept API route**

```typescript
// src/pages/api/pickleball/auth/org-invites/[token]/accept.ts
import type { APIRoute } from 'astro'
import { requireGoogleIdentity } from '../../../../../../worker/pickleball/authContext.js'
import { getInviteByToken, markInviteAccepted } from '../../../../../../worker/repositories/pickleball/organizationInvites.js'
import { createOrganization } from '../../../../../../worker/repositories/pickleball/organizations.js'
import { createMembership } from '../../../../../../worker/repositories/pickleball/memberships.js'
import { getUserByGoogleSub } from '../../../../../../worker/repositories/pickleball/users.js'
import { acceptOrgInviteSchema } from '../../../../../../lib/schemas/pickleball/platform'
import { signSession, buildSetCookieHeader, SESSION_COOKIE_NAME } from '../../../../../../worker/pickleball/session.js'
import { jsonResponse, apiErrorResponse } from '../../../../../../worker/utils/responses.js'
import { getEnv } from '../../../../../../lib/env'

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 8

export const POST: APIRoute = async ({ request, params }) => {
  const env = getEnv()
  try {
    const identity = await requireGoogleIdentity(request, env)

    const invite = await getInviteByToken(env.PICKLEBALL_DB, params.token as string)
    if (!invite || invite.status !== 'PENDING') {
      return jsonResponse({ error: 'This invite is no longer valid.' }, 404)
    }
    if (new Date(invite.expiresAt).getTime() <= Date.now()) {
      return jsonResponse({ error: 'This invite has expired.' }, 410)
    }

    const user = await getUserByGoogleSub(env.PICKLEBALL_DB, identity.googleSub)
    if (!user || user.email.toLowerCase() !== invite.invitedEmail.toLowerCase()) {
      return jsonResponse({ error: 'This invite was issued to a different email address.' }, 403)
    }

    const body = await request.json().catch(() => null)
    const result = acceptOrgInviteSchema.safeParse(body)
    if (!result.success) {
      return jsonResponse({ error: 'Validation failed.', issues: result.error.issues }, 400)
    }

    const organization = await createOrganization(env.PICKLEBALL_DB, {
      name: result.data.name,
      slug: result.data.slug,
      maxAdmins: invite.maxAdmins,
      maxFacilitators: invite.maxFacilitators,
      maxScorekeepers: invite.maxScorekeepers,
    })
    if (!organization) {
      return jsonResponse({ error: 'That club slug is already taken.' }, 409)
    }

    await createMembership(env.PICKLEBALL_DB, { organizationId: organization.id, invitedEmail: user.email, role: 'ADMIN' })
    await markInviteAccepted(env.PICKLEBALL_DB, invite.id, organization.id)

    const now = Math.floor(Date.now() / 1000)
    const token = await signSession(
      { userId: user.id, googleSub: user.googleSub, activeOrgId: organization.id, iat: now, exp: now + SESSION_MAX_AGE_SECONDS },
      env.PICKLEBALL_SESSION_SECRET,
    )
    const secure = new URL(request.url).protocol === 'https:'

    return jsonResponse({ ok: true, activeOrgId: organization.id }, 200, {
      'Set-Cookie': buildSetCookieHeader(SESSION_COOKIE_NAME, token, { secure, maxAgeSeconds: SESSION_MAX_AGE_SECONDS }),
    })
  } catch (error) {
    return apiErrorResponse(error)
  }
}
```

- [ ] **Step 2: Add the middleware public-path exception**

In `src/middleware.ts`, add a new prefix constant near `PICKLEBALL_PUBLIC_STATE_PREFIX`:

```typescript
// The org-invite accept route requires only a valid Google-authenticated
// session (via requireGoogleIdentity), never org membership -- by
// definition, the caller has no membership anywhere yet. It cannot go
// through the blanket requirePickleballSession gate below, so it's
// excluded the same way the public state-polling prefix is.
const PICKLEBALL_ORG_INVITE_ACCEPT_PREFIX = '/api/pickleball/auth/org-invites/'
```

Update the gating condition to also exclude it:

```typescript
  if (
    url.pathname.startsWith(PICKLEBALL_API_PREFIX) &&
    !PICKLEBALL_PUBLIC_ROUTES.has(url.pathname) &&
    !url.pathname.startsWith(PICKLEBALL_PUBLIC_STATE_PREFIX) &&
    !url.pathname.startsWith(PICKLEBALL_ORG_INVITE_ACCEPT_PREFIX)
  ) {
```

- [ ] **Step 3: The SPA accept-invite page**

```jsx
// src/pickleball-app/pages/AcceptOrgInvitePage.jsx
import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { pickleballApi } from '../lib/pickleballApi'

export default function AcceptOrgInvitePage() {
  const { token } = useParams()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [message, setMessage] = useState(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    setMessage(null)
    setIsSubmitting(true)
    try {
      await pickleballApi.post(`/api/pickleball/auth/org-invites/${token}/accept`, { name, slug })
      window.location.href = '/pickleball/app'
    } catch (error) {
      setMessage({ type: 'error', text: error.message })
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4" style={{ background: 'linear-gradient(180deg, var(--devlab-dark-950) 0%, var(--devlab-dark-900) 60%, var(--devlab-dark-850) 100%)' }}>
      <div className="pb-scoreboard w-full max-w-sm p-8">
        <h1 className="mb-1 text-2xl font-extrabold tracking-tight text-white">Create your club</h1>
        <div className="pb-rule mb-5 h-[3px] w-11 rounded-full" />
        <p className="mb-6 text-sm text-slate-300">You've been invited to start your own Devlab Pickleball club. Name it below.</p>
        {message ? <p className="mb-4 rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{message.text}</p> : null}
        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-300">Club name</span>
            <input type="text" value={name} onChange={(event) => setName(event.target.value)} required className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white" />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-300">Slug (lowercase, hyphens)</span>
            <input type="text" value={slug} onChange={(event) => setSlug(event.target.value)} required pattern="[a-z0-9]+(-[a-z0-9]+)*" className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white" />
          </label>
          <button type="submit" disabled={isSubmitting || !name.trim() || !slug.trim()} className="pb-btn-primary w-full rounded-lg px-4 py-2.5 text-sm disabled:opacity-50">
            {isSubmitting ? 'Creating…' : 'Create club'}
          </button>
        </form>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Register the route in `PickleballApp.jsx`**

Add the import:
```jsx
import AcceptOrgInvitePage from './pages/AcceptOrgInvitePage'
```

Add a top-level route (outside the `AppShell` tree, since this page must render before the user has any org context) alongside the existing top-level route array entry:

```jsx
    {
      path: '/pickleball/accept-invite/:token',
      element: <AcceptOrgInvitePage />,
    },
```

- [ ] **Step 5: The Astro catch-all**

```astro
---
// src/pages/pickleball/accept-invite/[token].astro
import '../../../index.css'
import PickleballApp from '../../../pickleball-app/PickleballApp.jsx'
---

<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="robots" content="noindex, nofollow" />
    <title>Devlab Pickleball — Accept Invite</title>
  </head>
  <body>
    <div id="pickleball-root">
      <PickleballApp client:only="react" />
    </div>
  </body>
</html>
```

Note: `PickleballApp`'s own top-level logic (`if (!session) return <LoginPage />`) runs before the router mounts — check `PickleballApp.jsx`'s existing session-check flow when wiring Step 4's route in: since a freshly-redirected pilot invitee DOES have a valid session cookie now (Task 9 sets one with `activeOrgId: null`), `loadSession()` succeeds and `session` is truthy, so the router (and this new route) renders instead of `LoginPage`.

- [ ] **Step 6: Type-check and build**

```bash
npx tsc --noEmit -p tsconfig.json
npm run build
```
Expected: both clean/succeed.

- [ ] **Step 7: Commit**

```bash
git add src/pages/api/pickleball/auth/org-invites src/pickleball-app/pages/AcceptOrgInvitePage.jsx src/pages/pickleball/accept-invite src/middleware.ts src/pickleball-app/PickleballApp.jsx
git commit -m "feat: add the self-serve org-invite accept flow"
```

---

### Task 11: Quota enforcement on the existing operator-invite route

**Files:**
- Modify: `src/pages/api/pickleball/organizations/[id]/memberships.ts`

**Interfaces:**
- Consumes: `canAddOperator` (Task 2), `countActiveMembershipsByRole`/`getOrganization` (Task 6).

- [ ] **Step 1: Add the quota check to the `POST` handler**

Add imports:
```typescript
import { canAddOperator } from '../../../../../lib/pickleball/quota'
import { countActiveMembershipsByRole, getOrganization } from '../../../../../worker/repositories/pickleball/organizations.js'
```

In the `POST` handler, after the existing self-demotion guard (`if (existing && existing.userId === session.userId ...)`) and before `const membership = await createMembership(...)`, insert:

```typescript
    // Only checked when this invite would add a NEW active operator of that
    // role — an existing ACTIVE member being re-invited to the SAME role is
    // a no-op re-send, not a new seat, so it must not be blocked by a cap
    // that's already at capacity because of that very member.
    const isNewActiveSeatForRole = !existing || existing.status !== 'ACTIVE' || existing.role !== result.data.role
    if (isNewActiveSeatForRole) {
      const organization = await getOrganization(env.PICKLEBALL_DB, organizationId)
      if (organization) {
        const currentCount = await countActiveMembershipsByRole(env.PICKLEBALL_DB, organizationId, result.data.role)
        if (!canAddOperator(organization, result.data.role, currentCount)) {
          return jsonResponse({ error: `Role quota reached for this organization (${result.data.role}).` }, 409)
        }
      }
    }
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/pages/api/pickleball/organizations/[id]/memberships.ts
git commit -m "feat: enforce per-role operator quotas when inviting"
```

---

### Task 12: UI — AppShell "Platform" nav, PlatformPage, hasPermission in AppShell

**Files:**
- Modify: `src/pickleball-app/components/AppShell.jsx`
- Create: `src/pickleball-app/pages/PlatformPage.jsx`
- Modify: `src/pickleball-app/PickleballApp.jsx`

**Interfaces:**
- Consumes: `hasPermission` (Task 3), `session.isPlatformAdmin` (Task 9's session route), `pickleballApi` (existing).

- [ ] **Step 1: `AppShell.jsx` — swap `can` for `hasPermission`, add the Platform nav item**

Replace the import:
```jsx
import { hasPermission } from '../../lib/pickleball/permissions'
```

Replace the nav-filter line:
```jsx
  const visibleNavItems = NAV_ITEMS.filter((item) => !item.permission || hasPermission(session, item.permission))
```

Add a new nav item to `NAV_ITEMS` (after `Settings`), gated by a new `platformAdminOnly` flag rather than a `Permission` (platform-admin status is orthogonal to the role-permission system):

```jsx
  { to: '/pickleball/app/platform', label: 'Platform', platformAdminOnly: true },
```

Update the filter to also honor that flag:
```jsx
  const visibleNavItems = NAV_ITEMS.filter(
    (item) => (!item.permission || hasPermission(session, item.permission)) && (!item.platformAdminOnly || session.isPlatformAdmin),
  )
```

- [ ] **Step 2: `PlatformPage.jsx`**

```jsx
// src/pickleball-app/pages/PlatformPage.jsx
import { useEffect, useState } from 'react'
import { pickleballApi } from '../lib/pickleballApi'

const EMPTY_FORM = { invitedEmail: '', maxAdmins: '', maxFacilitators: '', maxScorekeepers: '' }

function toNullableInt(value) {
  const trimmed = String(value).trim()
  if (!trimmed) return undefined
  return Number(trimmed)
}

export default function PlatformPage() {
  const [organizations, setOrganizations] = useState(null)
  const [invites, setInvites] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [message, setMessage] = useState(null)

  async function reload() {
    const [orgsData, invitesData] = await Promise.all([
      pickleballApi.get('/api/pickleball/platform/organizations'),
      pickleballApi.get('/api/pickleball/platform/org-invites'),
    ])
    setOrganizations(orgsData.organizations)
    setInvites(invitesData.invites)
  }

  useEffect(() => {
    reload().catch((error) => setMessage({ type: 'error', text: error.message }))
  }, [])

  async function handleInvite() {
    setMessage(null)
    try {
      const { acceptUrl } = await pickleballApi.post('/api/pickleball/platform/org-invites', {
        invitedEmail: form.invitedEmail,
        maxAdmins: toNullableInt(form.maxAdmins),
        maxFacilitators: toNullableInt(form.maxFacilitators),
        maxScorekeepers: toNullableInt(form.maxScorekeepers),
      })
      setForm(EMPTY_FORM)
      setMessage({ type: 'success', text: `Invite created. Share this link: ${acceptUrl}` })
      await reload()
    } catch (error) {
      setMessage({ type: 'error', text: error.message })
    }
  }

  async function handleRevoke(inviteId) {
    setMessage(null)
    try {
      await pickleballApi.post(`/api/pickleball/platform/org-invites/${inviteId}/revoke`, {})
      await reload()
    } catch (error) {
      setMessage({ type: 'error', text: error.message })
    }
  }

  async function handleSuspend(orgId, suspend) {
    setMessage(null)
    try {
      await pickleballApi.post(`/api/pickleball/platform/organizations/${orgId}/${suspend ? 'suspend' : 'reactivate'}`, {})
      await reload()
    } catch (error) {
      setMessage({ type: 'error', text: error.message })
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">Platform</h1>
        <div className="pb-rule mt-1.5 h-[3px] w-11 rounded-full" />
      </div>

      {message ? (
        <p className={`text-sm ${message.type === 'error' ? 'text-rose-600' : 'text-emerald-700'}`}>{message.text}</p>
      ) : null}

      <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Invite a pilot club</h2>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Email</span>
          <input type="email" value={form.invitedEmail} onChange={(event) => setForm({ ...form, invitedEmail: event.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </label>
        <div className="grid grid-cols-3 gap-3">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">Max admins</span>
            <input type="number" min="1" value={form.maxAdmins} onChange={(event) => setForm({ ...form, maxAdmins: event.target.value })} placeholder="Unlimited" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">Max facilitators</span>
            <input type="number" min="1" value={form.maxFacilitators} onChange={(event) => setForm({ ...form, maxFacilitators: event.target.value })} placeholder="Unlimited" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">Max scorekeepers</span>
            <input type="number" min="1" value={form.maxScorekeepers} onChange={(event) => setForm({ ...form, maxScorekeepers: event.target.value })} placeholder="Unlimited" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </label>
        </div>
        <button type="button" onClick={handleInvite} disabled={!form.invitedEmail.trim()} className="pb-btn-primary rounded-lg px-4 py-2 text-sm">Send invite</button>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-slate-500">Organizations</h2>
        <div className="space-y-2" data-testid="platform-organizations-list">
          {(organizations || []).map((org) => (
            <div key={org.id} className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm">
              <div>
                <span className="font-semibold text-slate-900">{org.name}</span>
                <span className="ml-2 text-xs text-slate-500">
                  {org.adminCount}/{org.maxAdmins ?? '∞'} admins · {org.facilitatorCount}/{org.maxFacilitators ?? '∞'} facilitators · {org.scorekeeperCount}/{org.maxScorekeepers ?? '∞'} scorekeepers
                </span>
                {org.status === 'SUSPENDED' ? <span className="ml-2 rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-600">Suspended</span> : null}
              </div>
              <button type="button" onClick={() => handleSuspend(org.id, org.status === 'ACTIVE')} className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-medium hover:border-slate-300">
                {org.status === 'ACTIVE' ? 'Suspend' : 'Reactivate'}
              </button>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-slate-500">Invites</h2>
        <div className="space-y-2" data-testid="platform-invites-list">
          {(invites || []).map((invite) => (
            <div key={invite.id} className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm">
              <div>
                <span className="font-semibold text-slate-900">{invite.invitedEmail}</span>
                <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">{invite.status}</span>
              </div>
              {invite.status === 'PENDING' ? (
                <button type="button" onClick={() => handleRevoke(invite.id)} className="rounded-lg border border-rose-300 px-2 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50">Revoke</button>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Register the route in `PickleballApp.jsx`**

Add the import:
```jsx
import PlatformPage from './pages/PlatformPage'
```

Add a child route inside the existing `AppShell` route's `children` array (alongside `settings`):
```jsx
        { path: 'platform', element: <PlatformPage /> },
```

- [ ] **Step 4: Type-check and build**

```bash
npx tsc --noEmit -p tsconfig.json
npm run build
```
Expected: both clean.

- [ ] **Step 5: Commit**

```bash
git add src/pickleball-app/components/AppShell.jsx src/pickleball-app/pages/PlatformPage.jsx src/pickleball-app/PickleballApp.jsx
git commit -m "feat: add the platform-admin UI"
```

---

### Task 13: `/services` beta-tester section

**Files:**
- Modify: `src/pages/services.astro`

**Interfaces:**
- Consumes: `ContactForm` (existing, `src/components/islands/ContactForm.jsx`), `env.TURNSTILE_SITE_KEY` (existing pattern from `contact.astro`).

- [ ] **Step 1: Add the imports and reveal-state**

Add near the top of the frontmatter (alongside the other imports):
```astro
import ContactForm from '../components/islands/ContactForm.jsx'
import { getEnv } from '../lib/env'
```

Add near the other computed constants:
```astro
const env = getEnv()
const requestHostname = Astro.url.hostname
const isLocalRequest = requestHostname === 'localhost' || requestHostname === '127.0.0.1'
const turnstileSiteKey = isLocalRequest ? '1x00000000000000000000AA' : env.TURNSTILE_SITE_KEY || ''
const betaFormCopy = {
  subjectLabel: 'What would you like to test?',
  subjectPlaceholder: 'Pickleball beta tester request',
  messageLabel: 'Tell us about your club',
  messagePlaceholder: 'How many players, how often you run open play, and what you’d want out of the app.',
}
```

- [ ] **Step 2: Insert the new section immediately before "Quick Links"**

In the body, insert this section right before the `<section class="space-y-4">` that contains `<h3 class="text-center text-lg font-semibold text-brand-ink">Quick Links</h3>`:

```astro
    <section class="space-y-5">
      <SectionHeader title="Devlab Pickleball" subtitle="A live, open-play session manager we're piloting with a small group of clubs — check-in, queueing, court assignment, live scoring, and a real-time public scoreboard, all from one app." />
      <div class="rounded-2xl bg-white/[0.92] p-6 shadow-[0_12px_28px_rgba(60,28,120,0.08)] ring-1 ring-slate-200">
        <p class="text-sm leading-relaxed text-slate-600">
          We're running a small pilot before opening it up further. If you run open-play sessions for your own club and want early access, let us know below — we personally review every request.
        </p>
        <div class="mt-4">
          <PrimaryButton
            id="beta-tester-cta"
            client:load
            onClick={() => {
              const el = document.getElementById('beta-tester-form')
              if (el) {
                el.hidden = false
                el.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }
            }}
          >
            Be a beta-tester
          </PrimaryButton>
        </div>
        <div id="beta-tester-form" hidden class="mt-6">
          <ContactForm client:load siteKey={turnstileSiteKey} copy={betaFormCopy} />
        </div>
      </div>
    </section>
```

- [ ] **Step 3: Verify `PrimaryButton` supports a plain `onClick` + `client:load` this way**

Run: `grep -n "onClick" src/components/PrimaryButton.jsx`
If `PrimaryButton` does not forward arbitrary props (e.g. it's a Link-only wrapper), replace the button with a plain native button instead:
```astro
          <button
            id="beta-tester-cta"
            type="button"
            class="inline-flex items-center gap-2 rounded-xl bg-brand px-5 py-3 text-sm font-semibold text-white hover:brightness-95"
          >
            Be a beta-tester
          </button>
          <script>
            document.getElementById('beta-tester-cta')?.addEventListener('click', () => {
              const el = document.getElementById('beta-tester-form')
              if (el) {
                el.hidden = false
                el.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }
            })
          </script>
```
(Use whichever of these two variants matches what Step 3's `grep` reveals — do not keep both.)

- [ ] **Step 4: Build and visually check**

```bash
npm run build
```
Then start the app and navigate to `/services` in a browser (or via a Playwright screenshot script, per the `run` skill's browser-driven pattern already used earlier in this project) — confirm the new section renders between the FAQ and Quick Links, the button reveals the contact form, and submitting it (with a real Turnstile pass in a non-local environment, or the test sitekey locally) succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/pages/services.astro
git commit -m "feat: add the beta-tester CTA to the services page"
```

---

### Task 14: E2E test for the full pilot flow

**Files:**
- Create: `tests/e2e/pickleball/pickleball-platform.spec.js`

**Interfaces:**
- Consumes: `loginAsOperator`/`loginAs` (`tests/e2e/pickleball/helpers.js`, existing), the full platform API surface built in Tasks 8–11.

- [ ] **Step 1: Seed a platform admin for the test run**

This test needs a user with `is_platform_admin = 1` before it runs. Add this one-time D1 write to `scripts/pickleball/apply-e2e-fixtures.mjs` (the same fixture script `playwright.config.js`'s `worker` project already runs before every e2e run) — insert an `UPDATE users SET is_platform_admin = 1 WHERE ...` keyed on a fixture email, matching that file's existing idempotent-fixture pattern. Read that file first to match its exact SQL-batching convention before adding to it.

- [ ] **Step 2: Write the test**

```javascript
// tests/e2e/pickleball/pickleball-platform.spec.js
import { test, expect } from '@playwright/test'
import { loginAs } from './helpers.js'

const PLATFORM_ADMIN_EMAIL = 'platform-admin@example.com'

test('a platform admin can invite a pilot, the pilot creates their own club, and quotas block over-invites', async ({ request, page, context, baseURL }) => {
  await loginAs(request, context, baseURL, PLATFORM_ADMIN_EMAIL)

  const pilotEmail = `pilot-${Date.now()}@example.com`
  const inviteResponse = await request.post('/api/pickleball/platform/org-invites', {
    data: { invitedEmail: pilotEmail, maxScorekeepers: 1 },
  })
  expect(inviteResponse.ok()).toBe(true)
  const { invite, acceptUrl } = await inviteResponse.json()
  expect(invite.status).toBe('PENDING')
  expect(acceptUrl).toContain(`/pickleball/accept-invite/${invite.token}`)

  // The pilot logs in with a fresh context (their own cookie jar) and lands
  // on the accept-invite page rather than the dashboard.
  const pilotContext = await context.browser().newContext()
  const pilotRequest = pilotContext.request
  const loginResponse = await pilotRequest.post('/api/pickleball/auth/test-login', { data: { email: pilotEmail } })
  expect(loginResponse.ok()).toBe(true)
  const setCookie = loginResponse.headers()['set-cookie']
  const [nameValue] = setCookie.split(';')
  const separatorIndex = nameValue.indexOf('=')
  await pilotContext.addCookies([{ name: nameValue.slice(0, separatorIndex), value: nameValue.slice(separatorIndex + 1), url: baseURL }])

  const acceptResponse = await pilotRequest.post(`/api/pickleball/auth/org-invites/${invite.token}/accept`, {
    data: { name: `Pilot Club ${Date.now()}`, slug: `pilot-club-${Date.now()}` },
  })
  expect(acceptResponse.ok()).toBe(true)
  const { activeOrgId } = await acceptResponse.json()
  expect(activeOrgId).toBeTruthy()

  const sessionResponse = await pilotRequest.get('/api/pickleball/auth/session')
  const session = await sessionResponse.json()
  expect(session.activeOrgId).toBe(activeOrgId)
  expect(session.organizations.find((org) => org.organizationId === activeOrgId)?.role).toBe('ADMIN')

  // Quota: maxScorekeepers = 1. The first scorekeeper invite succeeds...
  const firstScorekeeper = await pilotRequest.post(`/api/pickleball/organizations/${activeOrgId}/memberships`, {
    data: { invitedEmail: `sk1-${Date.now()}@example.com`, role: 'SCOREKEEPER' },
  })
  expect(firstScorekeeper.status()).toBe(201)

  // ...the second is rejected by the quota.
  const secondScorekeeper = await pilotRequest.post(`/api/pickleball/organizations/${activeOrgId}/memberships`, {
    data: { invitedEmail: `sk2-${Date.now()}@example.com`, role: 'SCOREKEEPER' },
  })
  expect(secondScorekeeper.status()).toBe(409)

  await pilotContext.close()
})

test('a super-admin can suspend an organization, blocking its members', async ({ request, context, baseURL }) => {
  await loginAs(request, context, baseURL, PLATFORM_ADMIN_EMAIL)

  const inviteResponse = await request.post('/api/pickleball/platform/org-invites', {
    data: { invitedEmail: `suspend-target-${Date.now()}@example.com` },
  })
  const { invite } = await inviteResponse.json()
  const targetEmail = invite.invitedEmail

  const targetContext = await context.browser().newContext()
  const targetRequest = targetContext.request
  const loginResponse = await targetRequest.post('/api/pickleball/auth/test-login', { data: { email: targetEmail } })
  const setCookie = loginResponse.headers()['set-cookie']
  const [nameValue] = setCookie.split(';')
  const separatorIndex = nameValue.indexOf('=')
  await targetContext.addCookies([{ name: nameValue.slice(0, separatorIndex), value: nameValue.slice(separatorIndex + 1), url: baseURL }])

  const acceptResponse = await targetRequest.post(`/api/pickleball/auth/org-invites/${invite.token}/accept`, {
    data: { name: `Suspend Test Club ${Date.now()}`, slug: `suspend-test-${Date.now()}` },
  })
  const { activeOrgId } = await acceptResponse.json()

  const suspendResponse = await request.post(`/api/pickleball/platform/organizations/${activeOrgId}/suspend`)
  expect(suspendResponse.ok()).toBe(true)

  const blockedResponse = await targetRequest.get(`/api/pickleball/organizations/${activeOrgId}/memberships`)
  expect(blockedResponse.status()).toBe(403)

  await targetContext.close()
})
```

- [ ] **Step 3: Run the new test**

```bash
npx playwright test --project=worker tests/e2e/pickleball/pickleball-platform.spec.js
```
Expected: both tests pass — the second test's 403 comes from Task 5's centralized suspended-org check inside `requirePickleballSession`, which every route (including `organizations/[id]/memberships.ts`) already calls first.

- [ ] **Step 4: Run the full existing pickleball suite to confirm no regressions**

```bash
npx playwright test --project=worker tests/e2e/pickleball/
```
Expected: no new failures beyond any pre-existing flakiness already known in this environment.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/pickleball/pickleball-platform.spec.js scripts/pickleball/apply-e2e-fixtures.mjs
git commit -m "test: add e2e coverage for the platform-admin pilot flow"
```

---

## Final checklist

- [ ] `npx tsc --noEmit -p tsconfig.json` clean
- [ ] `npx vitest run src/lib/pickleball src/worker/pickleball` all passing
- [ ] `npx playwright test --project=worker tests/e2e/pickleball/` no new failures
- [ ] `npm run build` succeeds
- [ ] Manually verify in a real browser: sign in as the bootstrapped super-admin, promote yourself via `wrangler d1 execute ... --remote` (`UPDATE users SET is_platform_admin = 1 WHERE email = 'stpnrey.agustinez@gmail.com'`), see the new "Platform" nav item, issue a pilot invite, and confirm `/services` shows the new beta-tester section.

# Devlab Pickleball — Platform Admin & Self-Serve Pilot Orgs Design

> **Superseded (2026-10-12).** This describes the logged-in operator app, retired in 2.0.0 by Phase 5 of `docs/superpowers/specs/2026-10-11-pickleball-free-open-play-design.md`. Kept as history: the routes, tables and files it names no longer exist.

Extends the existing Devlab Pickleball subsystem (`docs/superpowers/specs/2026-08-24-devlab-pickleball-design.md` and its successors). This spec covers three additions on top of the already-shipped, single-org-per-invite system: a platform-level super-admin tier, self-serve pilot organization creation gated by a super-admin-issued invite, and per-role operator quotas per organization. It also covers a small, unrelated-in-code but related-in-purpose public marketing addition: a "Be a beta-tester" CTA on the main site's `/services` page.

## Context

Today, organization creation is **ops-only**: `scripts/pickleball/create-organization.mjs` prints raw SQL that someone with direct D1 access runs by hand (`migrations/pickleball/0001_foundation.sql`'s `organizations`/`organization_memberships` tables). Within an org, `src/lib/pickleball/permissions.ts` defines three roles (`ADMIN`, `SESSION_FACILITATOR`, `SCOREKEEPER`) with no cross-org concept and no limit on how many operators an `ADMIN` can invite via the existing Operators page (`src/pages/api/pickleball/organizations/[id]/memberships.ts`).

The user (`stpnrey.agustinez@gmail.com`) has just bootstrapped himself as `ADMIN` of the first org, "Devlab Pickleball Club", in production. He wants to run a pilot: personally vet and invite testers by email, let each invited tester self-serve create *their own* club (not join his), cap how many operators of each role a club can have, and put a public "Be a beta-tester" entry point on the marketing site feeding into that vetting process. The existing public spectator live-view/TV-display routes (`src/pickleball-app/LiveView.jsx`, `TVDisplay.jsx`) already require no authentication — no change needed there.

The site already has a working, Turnstile-protected lead-capture pipeline (`src/pages/api/contact.ts` → `src/worker/repositories/leads.js` → `src/worker/leadDelivery.js` via Resend → `src/admin-app/pages/LeadsPage.jsx`) that the beta-tester CTA reuses as-is.

## Decisions

1. **Super-admin is a boolean column, not an allowlist or a separate table.** `users.is_platform_admin` (default `0`). Chosen over an env-var allowlist for flexibility (promoting a second super-admin later needs a D1 update, not a redeploy) and over a separate `platform_admins` table because a single boolean on the existing `users` row is simpler for a 1-to-a-handful-of-people tier.
2. **A super-admin acts as `ADMIN` in any org via a permission-check bypass, never via real membership rows.** Inserting a membership row per org would pollute `organization_memberships` (implying a real invite that never happened) and the audit log. Instead, `hasPlatformOverride(session)` short-circuits every permission check; `activeOrgId` resolution gets a platform-admin-only bypass that allows targeting *any* organization id, not just ones the user has a membership row in.
3. **Org-creation invites are a distinct concept from operator-membership invites**, living in a new `organization_invites` table, not reusing `organization_memberships` (that table is scoped to an *existing* org; an org-creation invite by definition has no org yet).
4. **The invitee names their own club** (name + slug) when accepting — the super-admin only supplies the email and the quotas. Matches "self-serve" intent; the super-admin is vetting *people*, not designing their org for them.
5. **Invite expiry: 7 days, single-use.** Consumed (marked `ACCEPTED`) on first successful accept; naturally invalid after that regardless of expiry.
6. **Quotas are set per invite, not a global constant.** Stored on `organizations` (`max_admins`, `max_facilitators`, `max_scorekeepers`), copied from the invite at accept time. `NULL` = unlimited — every org that predates this feature (including the user's own "Devlab Pickleball Club") is unaffected, no backfill needed.
7. **Quota is enforced against ACTIVE membership count only**, at the point an `ADMIN` (or platform-admin-acting-as-`ADMIN`) tries to create/reactivate a membership for that role. A `REVOKED` operator frees their seat. This reuses the existing invite endpoint (`organizations/[id]/memberships.ts`) with one new precondition check — it does not become a new endpoint.
8. **Org suspension is a status flag (`ACTIVE`/`SUSPENDED`) on `organizations`, checked at session/auth resolution time** — a suspended org's members can authenticate (Google OAuth still succeeds) but every request scoped to that org 403s, same shape as the existing "no active membership" rejection.
9. **The beta-tester CTA reuses the existing `ContactForm` island verbatim**, passing a `copy` prop that pre-fills the subject to "Pickleball beta tester request" — no new API route, no new lead schema, no new Turnstile/rate-limit code. It lands in the existing admin Leads inbox; turning a lead into an actual org-creation invite is a manual step the super-admin takes afterward in the new platform-admin UI. This is deliberate — the whole point is the super-admin vets every pilot, not auto-provisioning from a public form.
10. **New pages, not new apps.** The platform-admin UI is one more route inside the existing `pickleball-app` SPA (`AppShell` nav gains a "Platform" link, visible only when `session.isPlatformAdmin`), and the accept-invite flow is one more Astro page + API route pair, following the same house style as everything else in this subsystem.

## Data Model

New migration `migrations/pickleball/0011_platform_pilot.sql`:

```sql
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

No `UNIQUE` on `invited_email` — a super-admin may need to re-issue a fresh invite after one expires; old ones just sit as `PENDING`-but-effectively-dead until the accept route's expiry check rejects them (a cleanup/expiry-sweep job is out of scope; the accept route checks `expires_at` live).

## Auth & Permissions

- `authContext.js`'s session resolution adds `isPlatformAdmin: boolean` (read from `users.is_platform_admin`) to the session object returned by `requirePickleballSession`.
- `permissions.ts` gets `hasPermission(session, permission)` = `session.isPlatformAdmin || can(session.role, permission)`. Existing route call sites (`can(session.role, 'X')`) are mechanically migrated to this new helper — this touches every route file that currently calls `can(...)` directly, but each change is a one-line swap, not a logic change.
- `resolveActiveOrgId` gains a platform-admin path: `switch-org` accepts any existing organization id when `session.isPlatformAdmin` is true, not just ids found in the caller's own memberships.
- Every org-scoped route's existing "does this org exist for this session's activeOrgId" check additionally verifies `organizations.status = 'ACTIVE'` — a `SUSPENDED` org 403s every scoped request, platform-admin included (suspension is absolute; reactivate first).

## API Surface (new routes)

All under `/api/pickleball/platform/*`, gated on `session.isPlatformAdmin` (403 otherwise — not 404, since these are meaningfully "you're not allowed" rather than "doesn't exist"):

- `GET /api/pickleball/platform/organizations` — list all orgs: name, slug, status, member counts per role, quotas.
- `POST /api/pickleball/platform/org-invites` — body `{ invitedEmail, maxAdmins?, maxFacilitators?, maxScorekeepers? }` → creates a `PENDING` invite, returns `{ invite, acceptUrl }`.
- `GET /api/pickleball/platform/org-invites` — list invites (for the super-admin to see pending/accepted/expired state).
- `POST /api/pickleball/platform/organizations/:id/suspend` and `.../reactivate` — flips `status`.
- `POST /api/pickleball/platform/org-invites/:id/revoke` — moves a `PENDING` invite straight to `REVOKED` (e.g. issued to the wrong email, or the super-admin changed their mind before the tester accepted). No-op-turned-409 if the invite is already `ACCEPTED`/`EXPIRED`/`REVOKED`.

New unauthenticated-until-Google-signed-in route:

- `POST /api/pickleball/auth/org-invites/:token/accept` — body `{ name, slug }`. Requires a valid Google session (any authenticated user, no existing membership needed) whose email matches `invited_email` exactly. Validates: token exists, `status = 'PENDING'`, not expired. Creates the organization (with the invite's quotas), creates an `ACTIVE` `ADMIN` membership for that email, marks the invite `ACCEPTED` with `organization_id` set. Slug uniqueness collision → 409 with a clear error (existing `organizations.slug UNIQUE` constraint already enforces this).

Existing route change:

- `organizations/[id]/memberships.ts` (`POST`) gains one precondition: before creating/reactivating a membership, count current `ACTIVE` memberships for that org+role; if the org's `max_<role>s` is not `NULL` and the count is already at or above it, return `409 { error: 'Role quota reached for this organization.' }`.

## UI

- `AppShell.jsx`: new nav item `Platform`, gated on `session.isPlatformAdmin` (mirrors the existing per-item `permission` gating pattern already used for `MANAGE_OPERATORS`/`VIEW_AUDIT_LOG`).
- New page `src/pickleball-app/pages/PlatformPage.jsx`: table of all orgs (name, status, member counts vs. quotas, suspend/reactivate button), a form to issue a new pilot invite (email + three optional quota number inputs), a list of outstanding invites with their status and a revoke button for `PENDING` ones.
- New page `src/pickleball-app/pages/AcceptOrgInvitePage.jsx` + Astro route `src/pages/pickleball/accept-invite/[token].astro`: name/slug form, calls the accept endpoint, redirects into the new org's dashboard on success. Must be reachable by an authenticated-but-membership-less user — the existing `src/middleware.ts` auth gate needs a narrow exception for this one path (authenticated is required, membership is not).
- `src/pages/services.astro`: new section inserted immediately before the existing "Quick Links" heading (~line 184) introducing the pickleball app, with a "Be a beta-tester" button that toggles the existing `ContactForm` island into view with `copy={{ subjectLabel: ..., subjectPlaceholder: 'Pickleball beta tester request' }}` — reusing the component, not forking it.

## Testing

- Unit: quota-check pure function (role, current active count, cap → allowed/blocked, `NULL` cap → always allowed); invite-token validation (expired, wrong email, already-accepted, not-found) as pure functions where the logic can be isolated from the D1-touching route handler.
- E2E (`tests/e2e/pickleball/`): super-admin issues an invite → a second test-login email accepts it and lands in a new org as its `ADMIN` → inviting one more operator of a capped role beyond its limit is rejected with the quota error → a suspended org 403s a member's request → the beta-tester CTA on `/services` reveals the contact form and a submission appears in the admin Leads list.

## Explicitly out of scope

- Any UI for editing quotas after an org already exists (only settable at invite-issue time, for now).
- Automatic conversion of a beta-tester lead into an invite (always a manual step).
- Any self-serve signup path that does *not* originate from a super-admin-issued invite.
- Deleting organizations (suspend is the only lifecycle action).

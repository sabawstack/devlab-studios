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
  - The cross-organization isolation test needs a *second* organization and an org-scoped scoring
    ruleset, neither of which any Phase 1 API can create. `scripts/pickleball/apply-e2e-fixtures.mjs`
    seeds them idempotently (`e2e-cross-org-b`, `org-b-admin@example.com`,
    `e2e-cross-org-b-ruleset`); `playwright.config.js` runs it as part of the `worker` project's
    `wrangler dev` command, so it happens automatically *before* the server opens the local D1.
    If you start `wrangler dev` yourself and let Playwright reuse it, run the script once by hand
    first: `node scripts/pickleball/apply-e2e-fixtures.mjs`.

## Demo data

`scripts/pickleball/seed/generate-demo-seed.mjs` prints a fresh-DB-only demo dataset (spec §13) —
mirrors `scripts/cms/generate-project-seed.mjs`'s pattern (print SQL, apply with `wrangler d1
execute --file=`), not idempotent (plain INSERTs, no `ON CONFLICT`). Produces 1 organization, 1
venue, 4 courts, 16 players, 1 DRAFT session, 1 LIVE session with a populated queue (8 players) and
two finished games, plus an extra completed history session whose games are there purely to give
different players eligible-games counts spanning all three OPI confidence tiers (PROVISIONAL,
DEVELOPING, ESTABLISHED). Also seeds one org-scoped custom scoring ruleset, demoing the Settings
page.

```bash
npm run pickleball:seed:demo -- your-email@example.com   # writes scripts/pickleball/seed/demo-seed.sql
npx wrangler d1 execute devlab-pickleball --local --file=scripts/pickleball/seed/demo-seed.sql
```

The email argument becomes the seeded organization's ADMIN `invited_email` (defaults to
`admin@example.com`) — sign in with that Google account to reach it. Only ever run this against a
database that doesn't already have `seed-org` in it.

## Platform admin

The platform admin & self-serve pilot org feature (spec
`2026-09-01-devlab-pickleball-platform-pilot-design.md`) lets a small set of
platform admins invite pilot clubs to self-serve create their own
organization, and suspend/reactivate any organization. There is no UI or API
to grant `users.is_platform_admin` itself — this is deliberate (spec
Decision 1): it's a platform-level bootstrap action, not something any
in-app role should be able to grant itself or anyone else.

### Promote the first platform admin

The only way to set the flag in production is a direct SQL statement against
the remote D1 database — the same pattern `scripts/pickleball/create-organization.mjs`
uses for org bootstrap, just inline since there's only one column to touch:

```bash
npx wrangler d1 execute devlab-pickleball --remote --command "UPDATE users SET is_platform_admin = 1 WHERE email = '<email>'"
```

The target user must already have signed in once (via Google OAuth) so their
`users` row exists — if the `UPDATE` matches zero rows, have them sign in
first, then re-run it. Locally, run the same command against the local DB
(drop `--remote`, or point at `devlab-pickleball-preview` for the preview
environment).

### Issue a pilot invite

A platform admin can invite a pilot either from the operator app's Platform
page (`/pickleball/app/platform`, visible only to `is_platform_admin`
sessions) or directly via the API:

```bash
curl -X POST http://localhost:8787/api/pickleball/platform/org-invites \
  -H 'Content-Type: application/json' \
  --cookie "<platform admin's session cookie>" \
  -d '{"invitedEmail": "pilot@example.com", "maxAdmins": 1, "maxFacilitators": 3, "maxScorekeepers": 5}'
```

`maxAdmins`/`maxFacilitators`/`maxScorekeepers` are optional and nullable —
omit any of them (or pass `null`) for an unlimited seat cap on that role. The
response's `acceptUrl` is what gets sent to the invitee; they sign in with
Google, land on the accept-invite page, and create their own club, which
carries the invite's seat caps onto the new `organizations` row.

### Suspend / reactivate an organization

From the Platform page's organizations list, or via the API:

```bash
# Suspend — 403s every org-scoped request against it. Its public spectator
# route is the one exception: it 404s instead, matching the same "not found"
# shape/status it already returns for an unknown or revoked code, so an
# anonymous spectator can't distinguish "suspended" from "doesn't exist"
curl -X POST http://localhost:8787/api/pickleball/platform/organizations/<organizationId>/suspend \
  -H 'Content-Type: application/json' --cookie "<platform admin's session cookie>" -d '{}'

# Reactivate
curl -X POST http://localhost:8787/api/pickleball/platform/organizations/<organizationId>/reactivate \
  -H 'Content-Type: application/json' --cookie "<platform admin's session cookie>" -d '{}'
```

Both routes authenticate via `requirePlatformAdmin` (Google identity +
`is_platform_admin`, no org membership required), so a platform admin can
suspend and later reactivate an organization even if it's the only org they
personally belong to. This no-lockout guarantee extends to the operator SPA
itself: `/auth/session` (session bootstrap, called on every page load) and
`/auth/switch-org` also recognize a platform admin whose `activeOrgId`
points at the SUSPENDED org and return a valid session with
`activeOrgId: null` instead of 403ing them out to the login page — so the
Platform page (gated only on `isPlatformAdmin`) stays reachable in-browser
to reactivate the org, not just via direct API calls.

## Free open play

Free, no-login sessions live in the `open_*` tables of `PICKLEBALL_DB`
(migration `0016_open_sessions.sql`). Production is `devlab-pickleball`;
preview is `devlab-pickleball-preview` (`--env preview`). Check which one a
command targets before running it.

### Apply migration 0016

```bash
# local
npx wrangler d1 migrations apply devlab-pickleball --local
# preview
npx wrangler d1 migrations apply devlab-pickleball-preview --remote --env preview
# production
npx wrangler d1 migrations apply devlab-pickleball --remote
```

Read back afterwards (use `--remote --env preview` for preview, `--local` for local):

```bash
npx wrangler d1 execute devlab-pickleball --remote --command "SELECT name FROM sqlite_master WHERE name LIKE 'open_%'"
```

Expect `open_sessions`, `open_courts`, `open_players`, `open_matches` and
`open_idempotency`, plus their indexes.

### Inspect a session by code

```sql
SELECT id, status, expires_at FROM open_sessions WHERE public_code = ?
```

Add `last_activity_at` or `version` when debugging a "my session vanished"
report. A row past `expires_at` is already treated as gone by the app, even
before the purge deletes it.

### Force-delete a session

Read it first, confirm it is the right one, then delete. Every child row
cascades.

```sql
SELECT id, name, status, expires_at FROM open_sessions WHERE public_code = ?;
DELETE FROM open_sessions WHERE public_code = ?;
```

Prefer the host's own delete (`DELETE /api/pickleball/open/s/:code/session`)
when the host is available. A direct SQL delete does not close the session's
Durable Object or its sockets; they linger until the object is evicted.

### Purge

A daily cron (`0 22 * * *` in production, `30 22 * * *` in preview) deletes
sessions whose `expires_at` has passed (7 days after last activity), up to
10,000 per run, and writes one line to Workers Logs:

```json
{"event":"pickleball_open.purge","outcome":"ok","purged":3}
```

`outcome` is `crashed` (with an `error` field) if the run threw; the next
day's run retries. Route failures log `pickleball_open.error` and WebSocket
failures `pickleball_open.ws_error`; clients only ever see a generic 500.

### Troubleshooting

- **Create returns 503:** the `RATE_LIMITER` binding is missing (create
  deliberately fails closed), or Turnstile verification is unavailable. A 429
  means the 10-per-IP-per-day limit was hit.
- **Board is stale:** the client falls back to polling `/state` every 5 s when
  the socket drops. Look for `pickleball_open.ws_error` log lines.
- **Host lost their link:** the host key cannot be recovered. The session
  expires on its own 7 days after its last activity.

## Notes

- `PICKLEBALL_TEST_AUTH_ENABLED` must never be set in `wrangler.jsonc`'s committed `vars` — it exists only for local/CI `.dev.vars`.
- Organization creation is invite-only by design — there is no unsolicited self-serve signup. New organizations are created either via `scripts/pickleball/create-organization.mjs`, or by a pilot accepting a platform admin's org invite (see "Platform admin" above).

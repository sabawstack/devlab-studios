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

### Apply migration 0017

Same commands as 0016 (the migrations folder applies pending files in order).
The preview Worker and D1 live in the personal Cloudflare account, so preview
commands need `CLOUDFLARE_ACCOUNT_ID` set inline to the preview account ID.
The preview deploy workflow does not apply D1 migrations: apply each one by
hand with `--env preview --remote`.

```bash
CLOUDFLARE_ACCOUNT_ID=<preview account ID> npx wrangler d1 migrations apply devlab-pickleball-preview --remote --env preview
```

Read back:

```sql
SELECT name FROM sqlite_master WHERE name = 'open_captains';
SELECT recorded_by FROM open_matches LIMIT 1;
```

### Captain links

Inspect a session's links:

```sql
SELECT id, label, court_id, created_at, revoked_at FROM open_captains WHERE session_id = (SELECT id FROM open_sessions WHERE public_code = ?)
```

To turn one off by hand, read it first, then:

```sql
UPDATE open_captains SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL
```

A running DO keeps its cached copy until it next reloads, so prefer the host's
"Turn off" button or `DELETE .../captains/{id}`.

### Apply migration 0018

Same commands as 0017. The preview Worker and D1 live in the personal
Cloudflare account, so preview needs `CLOUDFLARE_ACCOUNT_ID` inline, and the
preview deploy does not apply D1 migrations: apply it by hand.

```bash
CLOUDFLARE_ACCOUNT_ID=<preview account ID> npx wrangler d1 migrations apply devlab-pickleball-preview --remote --env preview
```

Read back (expect three rows):

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

### Apply migration 0019

Same commands as 0018. Preview's D1 lives in the personal Cloudflare account, so
it needs `CLOUDFLARE_ACCOUNT_ID` inline, and the preview deploy does not apply
D1 migrations.

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
`RESEND_FROM_EMAIL` (var). Never set `PICKLEBALL_TEST_AUTH_ENABLED` in any
deployed environment (preview or production): with it on, anyone can sign in as
any email and no export is mailed. It belongs only in local `.dev.vars`.

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

-- Look up a host by email (read first)
SELECT id, email, display_name, dupr_club_id, created_at, last_seen_at FROM hosts WHERE email = ?;
```

Do not edit `host_id` or `open_host_keys` by hand: a running DO keeps its own
copy. To remove an account on request, the host uses "Delete my account"; if
they cannot, look the host up by email (above), confirm it is the right row,
then `DELETE FROM hosts WHERE id = ?` (logins cascade, sessions unlink) and the
link disappears from a warm DO when it is next evicted.

For the owner: the privacy policy (CMS content) does not yet describe host
accounts (verified Google email, name, DUPR Club ID, news opt-in, kept until
the host deletes the account). Decide its wording and update it in the CMS.

### Check-in floods

Self check-in is anonymous. A 429 reads "Too many check-ins from this network"
(30 per 10 min per address, bucket `open-checkin-ip`) or "Lots of people are
checking in" (60 per 5 min per session, counted in the DO). A 503 means
`RATE_LIMITER` is missing (the address limit fails closed). A 409 on a name the
host removed is expected. Club Wi-Fi shares one address, so live connects are
allowed 300 per minute and `/state` reads 1200 per minute per address.

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
when the host is available, or let the purge remove it. A direct SQL delete
does not reach the session's Durable Object: until it hibernates or is evicted
it keeps serving its cached copy (board, host console, sockets), and a host
command in that window can fail on the missing rows. The app's "Delete now"
and the purge both close the object as well.

### Purge

A daily cron (`0 22 * * *` in production, `30 22 * * *` in preview) deletes
sessions whose `expires_at` has passed (7 days after last activity), up to
10,000 per run, and writes one line to Workers Logs:

```json
{"event":"pickleball_open.purge","outcome":"ok","purged":3}
```

The same run removes host logins older than 30 days, logged separately as `{"event":"pickleball_open.host_login_purge","outcome":"ok","logins":N}`.

Because it runs once a day, an expired row can stay in D1 for up to about
24 hours after `expires_at`. That is expected: every load already treats it as
not found, so nobody can see or change it in the meantime.

`outcome` is `crashed` (with an `error` field) if the run threw; the next
day's run retries. Route failures log `pickleball_open.error` and WebSocket
failures `pickleball_open.ws_error`; clients only ever see a generic 500.

### Troubleshooting

- **Create returns 503:** the `RATE_LIMITER` binding is missing (create
  deliberately fails closed), or Turnstile verification is unavailable. A 429
  means the 10-per-IP-per-day limit was hit.
- **Host commands return 429:** either the host's own address passed 120
  requests a minute across the host routes (`open-host-ip`), or the session
  passed 120 authorized commands a minute (counted in the Durable Object, so
  requests with a wrong key never use up the host's allowance).
- **Board is stale:** the client falls back to polling `/state` every 5 s when
  the socket drops. Look for `pickleball_open.ws_error` log lines.
- **Host lost their link:** the host key cannot be recovered. If the session
  was linked to Google for a DUPR export, the host signs in at
  `/pickleball/my-sessions` and reopens it (a new host link; at most 10 extra
  per session). Otherwise it expires on its own 7 days after its last activity.

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

## Notes

- `PICKLEBALL_TEST_AUTH_ENABLED` must never be set in `wrangler.jsonc`'s committed `vars` — it exists only for local/CI `.dev.vars`.
- Nobody needs an account to run or view a session. The only accounts are `hosts`, created when a host signs in with Google for the DUPR export.

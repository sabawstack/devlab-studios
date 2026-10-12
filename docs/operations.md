# Operations — Environment Variables & Bindings

Snapshot as of 2026-07-31, taken as Phase 0 of the Astro/CMS rebuild program (see the approved plan for context). Names only — no values. Source of truth for values is the Cloudflare dashboard (Workers & Pages → `devlab-studios` → Settings → Variables and Secrets) and `.dev.vars` locally (gitignored, never committed).

## Cloudflare bindings (`wrangler.jsonc`)

| Binding | Type | Resource |
|---|---|---|
| `DB` | D1 database | `devlab-studios-cms` |
| `MEDIA_BUCKET` | R2 bucket | `devlab-studios` |
| `ASSETS` | Static assets | `./dist` (SPA fallback) |
| `IMAGES` | Cloudflare Images | Responsive variants via `optimizeImage()` |
| `OPEN_SESSION` | Durable Object | `OpenSessionDO` (Pickleball, one per free session) |
| `RATE_LIMITER` | Durable Object | `RateLimiterDO` (shared limiter) |
| `AI` | Workers AI | Daily Insights digest summaries only |

Every one of these is repeated under `env.preview` in `wrangler.jsonc`. Nothing
at the top level is inherited by an environment.

### Cron triggers

| Environment | Schedule (UTC) | Handler |
|---|---|---|
| production | `0 22 * * *` | `scheduled()` in `src/worker.ts` → `runDailyDigest()` |
| preview | `30 22 * * *` | same, staggered so both environments do not hit the same feeds at once |

22:00 UTC is 06:00 in Manila, where this is operated. The first schedule was
06:00 UTC — 2pm local — which is not when anyone reads a daily digest.

See [ADR 0008](./architecture/decisions/0008-insights-daily-digest.md).

## Runtime variables (non-secret, in `wrangler.jsonc` → `vars`)

| Variable | Purpose |
|---|---|
| `ADMIN_AUTH_MODE` | `password` \| `disabled` — selects the admin auth strategy in `src/worker/middleware/adminAuth.js`. Currently `password`. `cloudflare-access` is **disabled** (see below); anything unrecognised, and any environment missing `ADMIN_SESSION_SECRET`/credentials, fails closed with a 503. |
| `R2_PUBLIC_BASE_URL` | Public base URL used to build absolute links to R2-hosted media. |
| `TURNSTILE_SITE_KEY` | Public runtime sitekey for the environment-specific contact-form widget. Preview and production use different keys. |
| `RESEND_FROM_EMAIL` | Sender address for the lead-notification email (defaults to `hello@devlabstudios.com`). |
| `LEAD_NOTIFICATION_EMAIL` | Recipient address for the lead-notification email (defaults to `hello@devlabstudios.com`). |

## Secrets (set via Cloudflare dashboard or `wrangler secret put` — never in the repo)

| Secret | Used by | Purpose |
|---|---|---|
| `RESEND_API_KEY` | `POST /api/contact` (background delivery, see below) | Resend API key used to send the lead-notification email. Intentionally unset in Preview. |
| `TURNSTILE_SECRET_KEY` | `POST /api/contact` | Environment-specific server-side verification secret. Deployed requests fail closed when it is unset. |
| `ADMIN_SESSION_SECRET` | `adminAuth.js` | HMAC key signing the admin session cookie. |
| `ADMIN_EMAIL` + `ADMIN_PASSWORD_HASH` | `adminAuth.js` | Single-admin credential pair (PBKDF2 hash format — see `scripts/cms/hash-admin-password.mjs`). |
| `ADMIN_USERS` | `adminAuth.js` | Alternative to the pair above — a JSON array of `{email, passwordHash, role}` for multiple admins. Only one of this or the pair above is needed. |
| `CLOUDFLARE_API_TOKEN` | CI / manual `wrangler` use only | Never referenced by the app at runtime — explicitly kept out of `.env.example` per its own warning comment. |

## Build-time / frontend variables (`.env.local`, not runtime secrets)

| Variable | Purpose |
|---|---|
| `VITE_CONTACT_API_URL` | Overrides the contact form's submit target; defaults to `/api/contact`. |

## Inquiry pipeline

`POST /api/inquiries` is the single public entry point for every structured
inquiry; `POST /api/lead-magnet` and the legacy `POST /api/contact` normalize
into the same shape and run through the same service
(`src/worker/inquiryService.js`). The order is fixed:

```
rate limit -> Turnstile -> normalize -> idempotency -> PERSIST
-> consent + attribution -> qualify -> background delivery
```

The visitor's success response is decided by the DATABASE WRITE, never by the
email. Delivery runs afterwards in `waitUntil()` against every configured
provider (internal notification, visitor confirmation, and the optional
outbound webhook), and each attempt is recorded in `delivery_attempts` with a
failure category. See
[ADR 0007](architecture/decisions/0007-business-inquiry-pipeline.md).

Optional outbound delivery is configured with `LEAD_WEBHOOK_URL` (and
optionally `LEAD_WEBHOOK_SECRET`, sent as `X-DevLab-Signature`). Both unset is
the default and the webhook provider is then completely inert — no third-party
CRM dependency is required.

Idempotency is server-computed from (inquiry type, email, message, 10-minute
bucket) and stored under a UNIQUE index, so a double-click or a replayed
request collapses into the original inquiry instead of sending a second
notification.

### Applying the business-first content migration

Two steps, Preview first, then Production.

Pass the BINDING (`DB`), not the database name, and select the environment
with `--env preview`. The preview database lives under `env.preview` and
nothing at the top level is inherited by an environment, so without
`--env preview` wrangler reports "Couldn't find a D1 DB with the name or
binding". Each command is a single line -- `\` is a POSIX shell continuation
and is a syntax error in PowerShell.

Preview first:

```powershell
# 1. Schema (additive; every existing lead row survives untouched)
npx wrangler d1 migrations apply DB --env preview --remote

# 2. Content. Run AFTER the migration -- it writes a recovery snapshot into
#    `content_versions`.
npx wrangler d1 execute DB --env preview --remote --file scripts/cms/updates/2026-09-17-business-first-content.sql
```

Then, once verified on the preview URL, production (no `--env`, since
production is the top-level config):

```powershell
npx wrangler d1 migrations apply DB --remote
npx wrangler d1 execute DB --remote --file scripts/cms/updates/2026-09-17-business-first-content.sql
```

The content script rebuilds the Home page's blocks (its composition genuinely
changed), and patches named rows for navigation, CTAs, SEO, and the
Solutions/Work/Insights/Contact copy. It never touches Projects, Work items,
Articles, Certifications, Media, or any lead data. Do **not** run the full
seed against a database that already has content.

## Leads backend (original Phase 5 notes)

`POST /api/contact` persists every submission to the `leads` table
*before* attempting delivery — this is the core reliability guarantee:
a Resend outage never loses a lead, it just leaves it in `status: failed`,
retryable from `/admin/leads`. The Resend delivery attempt itself runs
in the background via `Astro.locals.cfContext.waitUntil()` (Astro 6.2+'s
Cloudflare-forwarded `ExecutionContext.waitUntil`, not the older/removed
`locals.runtime.ctx` pattern), so the visitor's response doesn't wait on
it. Every attempt (the automatic first one and any manual admin retry)
is recorded in `delivery_attempts` — see `src/worker/leadDelivery.js`.

There's no Cloudflare Queue involved: `@astrojs/cloudflare`'s generated
Worker entry only exports `fetch`, with no hook for a `queue()` consumer
export, so genuine Queue-based retry would require a second,
independently-deployed Worker. Given this site's scale, `waitUntil` +
durable D1 persistence + manual retry was chosen instead — see the
git history around the Phase 5 commits for the fuller tradeoff.

Submissions with the same email + message within a 5-minute window are
treated as the same inquiry (`findRecentDuplicateLead`) — no new lead
or delivery attempt, so double-clicks and retry-after-timeout don't
spam Resend or the admin Leads list.

### Turnstile setup

The contact form uses explicit widget rendering with the action
`contact_form`. The backend validates every deployed token through
Siteverify and also verifies its hostname and action. Tokens are treated as
single-use, widget expiration and failures reset cleanly, and a short
Siteverify timeout prevents an upstream outage from hanging the form.

Provision two Managed widgets:

1. Preview: allow only `devlab-studios-preview.stpnrey-agustinez.workers.dev`.
2. Production: allow only the canonical production hostname(s).
3. Put each public sitekey in that environment's `wrangler.jsonc` `vars` as
   `TURNSTILE_SITE_KEY`.
4. Set each matching secret with `wrangler secret put TURNSTILE_SECRET_KEY`
   (add `--env preview` for Preview).

Deployed environments fail closed when either value is missing. Localhost
alone uses Cloudflare's published always-pass test sitekey and may omit the
secret so browser tests can run without production credentials.

Maintenance mode is a runtime check (`src/middleware.ts`), not a build-time flag: it reads the `maintenance_mode` key from the `site_settings` D1 table on every request to `/`, `/about`, `/experiences`, `/services`, `/portfolio`, `/profile`, and `/resources*`, rewriting to `/maintenance` when set. Toggle it with `wrangler d1 execute` against `site_settings` (or the future admin Site Settings screen) — no redeploy required.

## Keeping preview aligned with production

`npm run cms:mirror-preview` copies production CONTENT into the preview
database so preview can be used to visually check a change against real content
before it reaches production. Add `--dry-run` to produce the import SQL without
applying it.

It copies 19 content tables (pages, sections, projects and their gallery,
articles, services, SEO, navigation, footer settings, profile data, redirects).

It deliberately never copies: `leads`, `delivery_attempts`, `lead_attribution`,
`lead_consents`, `lead_activities` (real customer names, emails and messages --
copying PII into a second environment multiplies where it can leak from and you
cannot visually check a lead anyway), `admin_session_revocations`, `audit_log`,
`content_versions`, `media_assets` (an index of the PRODUCTION R2 bucket --
preview has its own), and `d1_migrations` (owned by wrangler).

The script re-checks the generated dump against an independent denylist and
aborts if an excluded table or a credential pattern appears, so the allowlist
and the denylist have to agree before anything is written.

Images still render on preview because content stores absolute, public
production R2 URLs.

**Caution when writing content UPDATE scripts:** match page sections by
`(page slug, section_type)`, not by id. `replacePage()` deletes and reinserts
every section with a fresh `crypto.randomUUID()` on each admin save, so the
bootstrap ids (`work-hero`, `services-hero`, ...) survive only until the first
CMS edit of that page. An `UPDATE ... WHERE id = 'work-hero'` silently matches
zero rows and still reports success -- this is exactly how the Work page was
left on its pre-rebuild copy while every other page moved
(`2026-09-17-work-page-copy-fix.sql`).

## Insights daily digest

The `/insights/daily` log is generated by the cron above. Design and rationale:
[ADR 0008](./architecture/decisions/0008-insights-daily-digest.md).

**Schema.** `migrations/0011_insights_digest.sql` creates `digests` and
`digest_items`. Apply it the same way as any other migration -- preview first:

```powershell
npx wrangler d1 migrations apply DB --env preview --remote
npx wrangler d1 migrations apply DB --remote
```

**Running it by hand.** The admin has a "Generate now" button at
`/admin/digests`, which runs exactly what the cron runs. Under `wrangler dev`
the scheduled handler is also reachable at
`http://localhost:8787/cdn-cgi/handler/scheduled` -- scheduled Workers are not
triggered automatically in local development, and wrangler prints this URL on
start.

**Workers AI does not run in local dev.** Wrangler warns that AI bindings access
remote resources, but a local call actually fails with `Binding AI needs to be
run remotely` -- so a local run publishes titles and links with no summaries,
which is the same degraded path as an exhausted allocation. That is useful for
checking everything *except* the summaries. To exercise the real model locally,
add `"remote": true` to the `ai` binding temporarily; it spends real neurons
against the account, so do not leave it on and do not loop it.

**When something looks wrong.** Every stage logs one JSON line, greppable in
`wrangler tail`:

| `event` | What it tells you |
|---|---|
| `digest_feed` | per feed: `ok` (with item count and body size), `no_items`, `too_large`, `http_error`, or `fetch_failed` |
| `digest_summary` | only on failure -- the AI call that did not return |
| `digest_summary` | only on a call that failed or returned nothing readable — `failed` vs `empty` are different problems |
| `digest_run` | the run: `published`, `empty` (nothing new; yesterday's edition stays up), `skipped`, or `crashed`. Carries `neurons`, `summarized`, `failed` and `empty` counts |
| `seo_lookup` | `no_record` — a page asked for an SEO slug the CMS does not have, and fell back to the static file |

An edition with `model: null` means **no summary was stored** — which is not
the same as "AI was unavailable", and the admin no longer claims it is. Check
`digest_summary`: `failed` means the call threw (allocation spent, model gone),
`empty` means it answered and the reply could not be read. The second one is how
the first production run burned neurons and published nothing, so the two are
deliberately reported apart.

`digest_run` carries `neurons`. The included allowance is 10,000/day and a run
costs a few dozen, so this is a fact in a log rather than an estimate in a
document.

**Removing something.** `/admin/digests` can unpublish a day (hides it from the
site, keeps the row) or delete it outright (items cascade). Retention removes
anything older than seven days on every run, including runs that publish
nothing.

`no_items` with a healthy `bytes` count means the feed parsed but had nothing
we could use; `no_items` with a tiny `bytes` count means we did not get a feed
at all. That distinction is why the byte count is logged.

**Feed size.** A feed body over 2MB is skipped and logged as `too_large` rather
than truncated: a partial XML document parses as nothing, which is
indistinguishable from a quiet feed. Cloudflare's own feed is ~350KB because it
inlines full post content, so the bound is set well above real-world sizes.

**Adding a feed.** `src/worker/digest/feeds.js`, in code, reviewed like code.
The run only ever fetches URLs from that list -- never one from a request, a CMS
field, or a feed's own contents.

## Insights library and SEO records

**The article library is code, seeded into D1.** `src/data/insights/{guides,aiUpdates,opsNotes}.js`
holds the fifteen articles; `src/data/resourcesContent.js` composes them and is
also the static fallback. `npm run cms:seed:insights` generates an idempotent
upsert from it:

Redirect `node` directly, NOT `npm run` — `npm run` prints its own two-line
banner to stdout, which lands at the top of the file and fails the import with
`near ">": syntax error`.

```powershell
node scripts/cms/generate-insights-seed.mjs > scripts/cms/updates/2026-09-18-insights-library.sql
npx wrangler d1 execute DB --env preview --remote --file scripts/cms/updates/2026-09-18-insights-library.sql
npx wrangler d1 execute DB --remote --file scripts/cms/updates/2026-09-18-insights-library.sql
```

The generator refuses to emit unless exactly one article is flagged featured and
every slug is unique. It never emits a DELETE: an article dropped from the
library stays in D1 for a human to unpublish, because a generated DELETE against
editorial content is the statement that should not exist.

**Reading time is derived, not stored.** `src/lib/content/readingTime.ts`
computes it from the body at load time. The stored column had drifted into
fiction — a 300-word post carrying "5 min read" — and a number the page cannot
evidence is the same class of problem as the digest's false "AI unavailable".

**Every public route needs an SEO record.** `src/config/publicRoutes.ts` is the
one list of canonical routes; the sitemap and `src/lib/content/seo.test.ts` both
read it. The test fails when a route has no record, which is how the four
missing ones (`/process`, `/privacy`, `/terms`, `/insights/daily`) were found.
`loadPageSeo` logs `seo_lookup no_record` when it falls back, so a slug that
drifts out of sync is visible instead of silent. See
[ADR 0009](./architecture/decisions/0009-solutions-route-rename.md).

## Local test/dev fixtures

- `.dev.vars` (gitignored): local-only `ADMIN_EMAIL`/`ADMIN_PASSWORD_HASH`/`ADMIN_SESSION_SECRET`/`RESEND_API_KEY` values used by `wrangler dev --local` and the Playwright `admin.spec.js` suite. `RESEND_API_KEY` is set to a deliberately-invalid placeholder so local/test runs never send a real email. Not real credentials — safe to regenerate at will via `npm run cms:hash-admin-password`.
- Local D1: `npx wrangler d1 migrations apply devlab-studios-cms --local` applies `migrations/*.sql` to a local SQLite file under `.wrangler/` (gitignored).
- **The admin login limiter bounds how often the e2e suite can run.** `/api/admin/login` allows 20 attempts per IP per 15 minutes, and a full `admin` + `digest` run uses one sign-in per Playwright worker. Two full runs inside the window exhaust it, and every subsequent test fails with a misleading "element not found" because the login returned 429 rather than the expected error. This is the limiter working; wait out the window rather than weakening it.
- **`wrangler dev` serves the BUILT worker** (`dist/server/wrangler.json`), not `src/`. A source change is invisible to a running `wrangler dev` until `npm run build`. Several minutes were spent diagnosing a "still broken" feed parser that had already been fixed on disk.

## Other non-secret, hardcoded values worth knowing about

- GA4 Measurement ID (`G-MD3PL91M9G`) is hardcoded in `index.html` — GA IDs are meant to be public, not a secret.
- `compatibility_date`/`compatibility_flags` in `wrangler.jsonc` are deployment config, not environment-specific.

## Switching admin auth to Cloudflare Access

> **This mode is currently disabled in code and cannot be enabled by
> configuration alone.** The old `cloudflare-access` branch authenticated on
> the `cf-access-authenticated-user-email` request header *alone*, without
> verifying the signed `Cf-Access-Jwt-Assertion` header that Access sends
> alongside it. Any caller able to set that header — i.e. anyone reaching the
> Worker on a hostname Access does not actually front — was therefore a full
> admin. Setting `ADMIN_AUTH_MODE=cloudflare-access` now returns 503 rather
> than trusting the header, and an unconfigured environment resolves to
> `unconfigured` (also 503) instead of silently falling back to this mode.
>
> **To reinstate it**, `requireAdmin` must verify `Cf-Access-Jwt-Assertion`
> against the team's Access JWKS (`https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`)
> — checking signature, `aud` against the Access application's AUD tag, `iss`,
> and expiry — and only then trust the email claim *from the verified token*.
> The header on its own is not evidence of anything. The Cloudflare-side
> setup below is still accurate and still necessary, but it is not
> sufficient on its own.

The Cloudflare-side configuration this repo can't perform on its own:

1. In the Cloudflare dashboard, go to **Zero Trust → Access → Applications**
   and add a **Self-hosted** application covering `admin.devlabstudios.com/*`
   or `www.devlabstudios.com/admin*` (and `/api/admin/*`) — whichever
   matches how `/admin` is actually served.
2. Add at least one **policy** (e.g. "Allow" for a specific email or your
   Google/GitHub identity) — Access enforces this at the edge, before any
   request reaches the Worker.
3. Set `ADMIN_AUTH_MODE=cloudflare-access` in `wrangler.jsonc`'s `vars`.
   (Leaving `ADMIN_AUTH_MODE` unset no longer selects this mode: an
   environment with no `ADMIN_SESSION_SECRET`/admin credentials resolves to
   `unconfigured` and is refused. The old fallback meant a missing secret
   silently switched the CMS to header-trust auth.)
4. Once Access is enforcing the policy, every request reaching the Worker
   already carries `cf-access-authenticated-user-email`, so
   `requireAdmin` passes and `GET /api/admin/session` returns immediately
   — the admin app's login screen is only ever seen if Access itself isn't
   actually in front of `/admin`, e.g. a misconfigured policy.
5. `ADMIN_EMAIL` (if still set) is used as an optional extra check against
   the Access-authenticated email — remove it if you want to allow anyone
   the Access policy admits, or keep it to additionally pin one specific
   admin address.

Verify locally is not meaningful for this mode — Cloudflare Access is an
edge product, not something `wrangler dev` can simulate. Verification has
to happen against the real deployed Worker after the Access application
and policy are in place.

## Preview/production isolation (Phase 6)

`wrangler.jsonc` now has an `env.preview` block with its own Worker name
(`devlab-studios-preview`), D1 database, and R2 bucket — separate from
production's `devlab-studios` in every way, so preview can never read,
write, or leak production leads, content, or secrets.

**The one-time provisioning is not done yet** — the API token available
when this was set up couldn't create D1 databases or R2 buckets
(`wrangler d1 create` / `wrangler r2 bucket create` both failed with a
permissions error), so `wrangler.jsonc`'s `env.preview.d1_databases[0].database_id`
and `env.preview.vars.R2_PUBLIC_BASE_URL` are still placeholders. See
`docs/deployment.md`'s "Preview environment setup" for the exact commands
to run once a sufficiently-privileged token is available, and
`docs/architecture/decisions/0005-preview-environment-build-time-env.md`
for why `CLOUDFLARE_ENV=preview` has to be set on the **build** command
rather than passed as `--env preview` to `wrangler deploy` — a
non-obvious consequence of how `@astrojs/cloudflare` bakes bindings in at
build time.

Preview needs its own values for every secret in the table above except
`RESEND_API_KEY`, which is intentionally left unset so preview and e2e
runs never send a real email (leads still persist to D1 with a failed
delivery attempt): `ADMIN_SESSION_SECRET`, `ADMIN_EMAIL`/`ADMIN_PASSWORD_HASH`,
`TURNSTILE_SECRET_KEY` — set with `wrangler secret
put <NAME> --env preview`, never copied from production. Turnstile must use a
separate Preview widget and secret, not the Production pair.

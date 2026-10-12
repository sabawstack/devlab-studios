# Security

Written as part of Phase 6 (deployment & hardening) of the Astro/CMS
rebuild program, against the codebase as it exists today. Supersedes
`docs/security/*.md`, which were written against the pre-rebuild Vite SPA
(and already carry a 2026-07-30 annotation pass noting what's since
changed) — kept for history, not as current guidance.

## Security headers

Every response now carries these headers, applied in `src/middleware.ts`
via `src/lib/securityHeaders.ts`:

| Header | Value | Why |
|---|---|---|
| `Content-Security-Policy` | see below | Restricts script/style/frame/connect sources |
| `X-Content-Type-Options` | `nosniff` | Blocks MIME-sniffing attacks |
| `X-Frame-Options` | `DENY` | This site is never meant to be framed by anyone |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Don't leak full URLs to third parties |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` | No use for any of these |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains; preload` | HTTPS is already enforced by `src/middleware.ts`'s canonical-domain redirect; this tells browsers to skip the plaintext round-trip entirely next time |
| `X-Robots-Tag` | `noindex, nofollow` on `/admin*` and `/api/admin/*`; `noindex, follow` on `/landing-sample-*` | Keep the admin surface and demo pages out of search results |

**Why middleware, not `public/_headers`**: `public/_headers` (Cloudflare
Pages-style headers file) only applies to responses served directly from
the static ASSETS binding. With `output: 'server'`, almost everything a
visitor actually loads — every real page, `/admin`, every `/api/*` route
— is server-rendered through Astro instead, so `_headers`' page-level
rules never reached them. This was confirmed directly: building and
curling the homepage showed zero security headers despite `_headers`
declaring a `/*` rule for exactly this. `_headers` still exists and still
correctly covers the genuinely-static leftovers (`/_astro/*` bundles,
`robots.txt`, `sitemap.xml`), kept in sync with the CSP in middleware as a
redundant safety net, not the source of truth.

### CSP allowances and why each exists

```
default-src 'self'
script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://challenges.cloudflare.com
connect-src 'self' https://*.zohopublic.com https://*.zoho.com https://www.google-analytics.com https://region1.google-analytics.com https://www.googletagmanager.com https://challenges.cloudflare.com
img-src 'self' data: https:
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com
font-src 'self' https://fonts.gstatic.com data:
frame-src 'self' https://challenges.cloudflare.com
object-src 'none'
base-uri 'self'
frame-ancestors 'none'
form-action 'self'
upgrade-insecure-requests
```

- `'unsafe-inline'` on `script-src`/`style-src`: the JSON-LD structured
  data block and Tailwind's inline critical styles aren't nonced. Tightening
  this would need a nonce/hash pipeline wired through Astro's SSR
  rendering — not done yet, tracked as a follow-up, not a silent gap.
- `googletagmanager.com` / `google-analytics.com`: GA4 (see
  `docs/operations.md` for the measurement ID).
  (The Resend delivery call happens server-side in
  `src/worker/leadDelivery.js` and isn't subject to browser CSP at all, so
  no `connect-src` entry is needed for it.)
- `challenges.cloudflare.com` on `script-src`, `connect-src`, and
  `frame-src`: Cloudflare Turnstile (see `docs/operations.md`'s "Turnstile
  setup"). Added in this pass — the original CSP predates Phase 5 and
  would have silently blocked the widget the first time headers actually
  applied to a real page load.

Confirmed via `tests/e2e/public-pages.spec.js`'s "security headers apply
to real, server-rendered responses" and "the contact form CSP allows
Turnstile to actually load" tests — the latter listens for CSP violation
console messages while the widget loads, so a future CSP regression here
fails a test instead of silently breaking the contact form.

## Authentication

- **Admin** (`/admin`, `/api/admin/*`): `ADMIN_AUTH_MODE=password` — a
  PBKDF2 hash (100,000 iterations, the Workers ceiling) plus an HMAC-signed
  session cookie, in `src/worker/middleware/adminAuth.js`. Every
  `/api/admin/*` route is gated by the same `requireAdmin` check in
  `src/middleware.ts`.
  - **Logout revokes the token, not just the cookie.** Sessions are
    stateless signed tokens, so clearing the cookie alone left a captured
    copy usable for the remainder of its 8-hour life. Each token carries a
    `jti` that logout records in `admin_session_revocations` (migration
    0008) and `requireAdmin` checks. That check fails *open* if the table
    is unreachable — deliberately, since failing closed would lock every
    admin out of the CMS over a transient D1 blip, and open is exactly the
    posture that shipped before revocation existed.
  - **Misconfiguration fails closed.** An environment with no
    `ADMIN_SESSION_SECRET` or admin credentials resolves to `unconfigured`
    and returns 503. It previously fell back to `cloudflare-access`, which
    combined with that mode's header trust (below) meant a missing secret
    silently granted admin to anyone.
  - **`cloudflare-access` mode is disabled.** It authenticated on the
    `cf-access-authenticated-user-email` header alone without verifying the
    signed `Cf-Access-Jwt-Assertion` that accompanies it, so any caller able
    to set that header was an admin. Reinstating it requires verifying that
    JWT against Access's JWKS — see `docs/operations.md`.
  - Only `pbkdf2_sha256` hashes are accepted. The retired single-round
    `sha256`/`sha256hex` formats are still *recognised* purely so a
    credential left on one reports a precise configuration error (503)
    instead of an undiagnosable "invalid password".
- **Public API**: no auth (by design — `/api/contact`, `/api/services`,
  etc. are meant to be publicly readable/submittable), protected instead
  by rate limiting and, for `/api/contact`, Turnstile + D1-backed dedup
  (see `docs/operations.md`'s "Leads backend" section).

## Secrets

Never committed — see `docs/operations.md`'s secrets table for the full
list and `.env.example` for local dev placeholders. Preview and
production must use **different** values for every secret (see
`docs/deployment.md`'s "Preview environment setup") — reusing production's
admin password in preview would defeat the entire point of having a
separate environment. `RESEND_API_KEY` is a special case: it is
intentionally left **unset** in Preview entirely, rather than given a
different value, so preview/e2e runs can never send a real email.

## Rate limiting

Every limit goes through `src/worker/rateLimit.js`, backed by `RateLimiterDO`
(a Durable Object), so the count is global rather than per-isolate. One module
for all of them, so a limiter can never again be "configured but not actually
enforcing" without it being visible in one place. The earlier in-memory per-IP
counter in `contact.ts` did not survive across isolates and is gone.

| Bucket | Identity | Limit |
|---|---|---|
| `admin-login` | `ip:email`, and separately the IP | 8 per 15 min per pair, 20 per 15 min per IP |
| `admin-password-change` | admin email | 10 per 15 min; cleared on success |
| `inquiry` / `contact` | client IP | 5 per 10 min |
| `admin-lead-retry` | admin email, else IP | 10 per 5 min |
| `admin-media-write` | admin email, else IP | 60 per 5 min |
| `digest-generate` | client IP | 4 per hour |
| `open-create` (Pickleball) | client IP | 10 per day; fails closed |
| `open-state` (Pickleball) | client IP | 1200 per min |
| `open-ws` (Pickleball) | client IP | 300 connects per min |
| `open-host-ip` (Pickleball) | client IP | 600 per min |
| `open-checkin-ip` (Pickleball) | client IP | 30 per 10 min; fails closed |
| `open-host-account` (Pickleball) | client IP | 120 per min |
| `open-host-signin` (Pickleball) | client IP | 20 per 10 min |

`clientIp()` prefers `cf-connecting-ip`, which Cloudflare's edge sets and a
caller cannot spoof; `x-forwarded-for` is only a fallback for non-edge contexts.

**The limiter FAILS OPEN.** If the Durable Object is unreachable, a request is
allowed rather than rejected — a limiter that takes the login page down with it
when it has a bad minute is worse than one that briefly stops counting. This
also means a MISSING `RATE_LIMITER` binding silently enforces nothing, which is
exactly what happened on preview before the binding was mirrored into
`env.preview`. Both environments must declare it.

`digest-generate` is limited despite being admin-only: each run makes four
outbound fetches and up to ten Workers AI calls against a daily allocation, so
an admin holding down the button should not be able to spend the day's neurons.

## Inquiry data handling

- **Validated at the boundary.** Every public submission is parsed with
  `src/lib/schemas/inquiry.ts` server-side. The React form imports the same
  schema, but client validation is never authoritative.
- **Bounded requests.** Bodies are capped at 32 KB and refused with a 413
  before parsing, so an unbounded POST never reaches Zod or D1.
- **Attribution is an allow-list.** Only the fields named in
  `attributionSchema` are stored, each length-capped. An unexpected key in the
  request body is dropped rather than silently widening what gets persisted.
- **No PII in logs.** Delivery logging records the lead id, target, attempt
  number, status code, and failure category — never the name, email, or
  message. Activity metadata records that a note was written and its length,
  never its text.
- **No PII in analytics.** `src/lib/analytics.ts` has no parameter for a name,
  email, phone, company, or message. The only identifier sent is a random
  first-party `anonymousId` that is not derived from anything about the
  visitor.
- **Consent is versioned.** `lead_consents` records the consent-text and
  privacy-policy VERSION a visitor agreed to, append-only, so changing the
  wording never rewrites history.
- **Bounded outbound calls.** Every provider request has an 8s timeout and a
  bounded in-invocation retry; the outbound webhook payload is an explicit
  allow-list, so a column added later is never accidentally shipped to a third
  party. Provider responses are not stored beyond a truncated error summary.
- **Safe CSV export.** Every cell is run through
  `src/lib/leads/csv.ts`: a value starting with `= + - @` or a control
  character is prefixed with an apostrophe so a spreadsheet displays it instead
  of executing it. The free-text message is deliberately excluded from the
  export — it stays in the access-controlled admin detail panel.
- **Authorized retry.** Retry sits behind the admin gate *and* a per-identity
  rate limit, so an authenticated operator (or a stolen session) cannot turn
  the button into an outbound email amplifier.
- **No public exposure.** Lead data is never served from a public content read
  path; every `/api/admin/*` route goes through `requireAdmin` in
  `src/middleware.ts`, not through hidden navigation.
- **Admin writes cannot rewrite visitor input.** `leadUpdateSchema` contains
  only `pipelineStatus`, `assignedOwner`, and `internalNotes`; there is no
  field through which a submitted value could be edited.

## Third-party feed content (daily digest)

The digest ingests text written by other people and passes it through a language
model, which is two separate trust problems:

- **SSRF.** The feed registry (`src/worker/digest/feeds.js`) is server-owned
  code. The run only ever fetches URLs from that list — never one from a
  request, a CMS field, or a feed's own contents. Each fetch is bounded by an
  8s timeout and the response is truncated at 256KB before parsing.
- **Prompt injection.** A headline is attacker-influenced input: anyone who can
  get a post onto a syndicated feed can attempt one. Feed text is fenced between
  explicit `<<<ITEM>>>` / `<<<END>>>` markers and the system prompt states that
  everything inside is quoted third-party material to be treated strictly as
  data, with any instruction-like text inside it ignored. A unit test asserts
  the attacker-controlled string appears only inside the fence and never in the
  system message.
- **Stored output.** Only the title, the source URL, and our own one-sentence
  summary are persisted. No source body text is stored or rendered, and every
  item links back to the publisher with `rel="noopener noreferrer nofollow"`.
- **Fabrication.** The model is instructed to summarize only what the supplied
  headline and excerpt state and to add no numbers, dates, versions or claims
  not present in them. When the model is unavailable the item publishes as a
  title and a link rather than an invented summary.

## Known gaps (tracked, not silently ignored)

- CSP `'unsafe-inline'` (see above) — would need a nonce pipeline.
- No WAF/bot-management rules configured beyond Turnstile on the one form
  that needs it — not needed at this site's current traffic scale.
- Preview environment isolation is documented and configured in
  `wrangler.jsonc`, but the actual Cloudflare resources (a second D1
  database and R2 bucket) haven't been provisioned yet — the API token
  available while writing this lacked the permissions to create them. See
  `docs/deployment.md`'s "One-time setup" for the exact commands to run
  once a sufficiently-privileged token is available.

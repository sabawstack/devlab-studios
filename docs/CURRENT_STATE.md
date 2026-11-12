# Current State

Snapshot as of 2026-09-17, after the business-first rebuild.

## Product positioning

DevLab Studios is presented primarily as a **business**: a software and
automation studio that designs reliable business systems. The central
proposition is "DevLab Studios builds reliable software and automation systems
for businesses", and the public hierarchy — homepage, navigation, featured
proof, and every primary call to action — is business-focused.

Visitors are never asked to classify themselves. There is no audience-selection
screen, modal, or homepage section.

Stephen Rey Agustinez is presented on the **Founder Profile** as Founder,
Full-Stack Developer, and AI Automation Architect — a first-class supporting
page for employers, recruiters, contract work, and technical evaluation.
Employment messaging lives there, not in the business funnel.

## Public experience

- **Home** follows the business journey: outcome hero → operational problems →
  four solution categories → verified project proof → delivery approach →
  reliability principles → insight and lead magnet → founder credibility → FAQ
  → final inquiry CTA.
- **Solutions** (`/solutions`; `/services` 301s to it) presents four business
  categories: Lead Intake and Follow-up Systems,
  Workflow and AI Automation, Custom Software and Operations Systems, and the
  Workflow Systems Audit entry offer. The CMS service catalogue is mapped
  underneath rather than replaced; an unmapped service group still renders.
- **Work** frames each project as business proof — the problem, the system
  designed for it, and what it verifiably does in operation — and states its
  evidence standard openly rather than showing invented metrics.
- **Founder Profile** keeps and strengthens name, role, summary, capabilities,
  education, certifications, experience, tools, selected projects, résumé,
  GitHub, LinkedIn, and availability, with its own CTAs (View Selected Work /
  Download Résumé / Contact Stephen).
- **Contact** is a structured two-step inquiry flow with an inquiry-type
  selector; CTA context preselects the type via `?type=`. Employers reach a
  separate short employment form and never the business qualification
  questions.
- **Insights** carries fifteen articles across three named topics — Guides, AI
  Updates, Operational Notes — with one featured and the rest in a filterable
  grid. Each card is a summary that links to the full article. Reading time is
  derived from the body rather than stored, because the stored values had
  drifted.
- **AI & Automation Daily** (`/insights/daily`) is a generated daily log: up to
  ten AI automation / AI advancement stories, each a title, a link to the
  publisher, and a one-sentence summary written from that publisher's own
  headline and excerpt. One permanent page with dated sections and
  `#YYYY-MM-DD` anchors — not a page per day. Seven-day retention. The latest
  edition previews on `/insights`.
- **Offers** (`/offers/[slug]`) are lead-magnet landing pages. The resource
  itself stays publicly readable in Insights — nothing is gated.
- Navigation is Home · Solutions · Work · Insights · About · Profile, with one
  header CTA ("Discuss Your System"). The Profile item is labelled Profile,
  never "Hire Me".
- The established dark-native visual system, tokens, components, and
  reduced-motion behavior are unchanged.

## Inquiry pipeline

`/api/inquiries` is the single public entry point; `/api/lead-magnet` and the
legacy `/api/contact` normalize into the same shape and run the same service.

An inquiry is persisted to D1 **before** any external delivery is attempted,
and the visitor's success response is decided by that write. Delivery runs
afterwards against every configured provider, and every attempt is recorded
with a failure category. Consent and attribution are stored alongside.
Qualification is deterministic and stores its reasons.

See [ADR 0007](architecture/decisions/0007-business-inquiry-pipeline.md).

## Daily digest

`scheduled()` in `src/worker.ts` runs once a day (production 22:00 UTC, preview
22:30 UTC — 06:00 and 06:30 in Manila) and does one pass: fetch four fixed feeds, drop anything stale or
already published in the trailing week, summarize with Workers AI, publish the
day, sweep anything older than seven days.

Every stage degrades rather than aborts. A dead feed costs that feed; an
exhausted AI allocation costs the summaries and the items still publish as
titles and links; a run that finds nothing new leaves yesterday's edition up
rather than replacing it with an empty section. The retention sweep is the one
stage that is not best-effort — it runs even when nothing published.

The feed registry is server-owned code, so the run can never fetch a URL that
came from a request, a CMS field, or a feed's own contents. Feed text is fenced
and passed to the model as quoted data, never as instructions.

See [ADR 0008](architecture/decisions/0008-insights-daily-digest.md).

## CMS and admin

- Page blocks gained `problemList` and `leadMagnet`; `cta` gained routing
  context (`inquiryType`, `formId`, `offerId`, `solutionId`).
- `/admin/leads` is now "Inquiries": filter by type, pipeline status,
  qualification, delivery state and free-text search; change status; assign an
  owner; add internal notes; view qualification reasons, attribution, consent,
  delivery attempts and activity; retry an eligible failed delivery; soft
  archive; export CSV.
- `/admin/digests` ("Daily Digests") covers the two controls that make sense
  over generated output — unpublish a day, delete a day — plus "Generate now",
  which runs exactly what the cron runs.
- Admin labels follow `src/config/publicSurfaces.js`, so CMS labels cannot
  drift from the routes visitors see.

## SEO

- Business pages target business-system search intent; the Founder Profile
  targets Stephen's verified individual capabilities, so the two no longer
  compete for the same query.
- `sitemap.xml` is generated at request time and lists only canonical,
  indexable URLs. The stale static file (which listed `/resources/*` redirect
  sources) was removed.
- Structured data: Organization, WebSite, Service per solution, Person on the
  Profile, Article on insights, BreadcrumbList, and FAQPage only where the
  questions are actually rendered. No LocalBusiness — the studio is remote.
- `src/config/publicRoutes.ts` is the single list of canonical routes. The
  sitemap and `src/lib/content/seo.test.ts` both read it, so a route added
  without an SEO record fails the suite rather than silently falling back.
- `/insights/daily` is one canonical URL listed once in the sitemap, not a
  generated page per edition. Every item links out to the publisher with
  `rel="noopener noreferrer nofollow"`.

## Deployment and branches

- `development` deploys to the isolated `devlab-studios-preview` Worker with
  Preview D1, R2, and secrets.
- `main` deploys production through Cloudflare Workers Builds.

## Verification baseline (2026-09-17)

- `npm run typecheck` — 0 errors
- `npm run build` — passes
- `npm run test:unit` — 581 passing across 48 files
- `npx eslint .` — 0 errors (1 pre-existing warning in `WorkPageManager.jsx`)
- Playwright site + admin (`public-pages`, `contact-form`, `image-weight`,
  `admin`, `digest`) — 177 passing, 2 failing. Both failures are the
  pre-existing `site settings` parallel-write race; both pass with `--workers=1`
- Playwright `pickleball` — **246 of 246 passing.** It was 117 of 246; see the
  Known limitations entry for what was wrong and what fixed it
- The AI summary fix was verified against the deployed preview Worker, not only
  in tests: `summarized: 10`, `model: @cf/meta/llama-3.1-8b-instruct-fp8`,
  `neurons: 36.3`
- The daily digest was run end to end against the live feeds from a local
  worker: all four feeds parsed, 16 candidates, 10 published, and a second run
  on the same day produced the same 10 rather than the leftovers
- Migration `0009` validated against a real SQLite database: pre-existing lead
  and delivery-attempt rows survive it untouched and backfill correctly
- Migration `0011` and the digest repository are covered by tests that run the
  real SQL against SQLite, including the retention boundary (a day exactly at
  the window is kept, the next one out is swept) and the cascade to items
- The retention assertion was mutation-tested: removing the sweep from the
  "nothing published" branch fails exactly one test, so the assertion is not
  vacuous

## Environment status

- Migrations `0009`, `0010` and `0011` are applied to **both** Preview and
  Production, along with `scripts/cms/updates/2026-09-17-business-first-content.sql`,
  `2026-09-17-work-page-copy-fix.sql`, `2026-09-18-solutions-route-and-seo-alignment.sql`
  and `2026-09-18-insights-library.sql`.
- Preview's `ADMIN_EMAIL` / `ADMIN_PASSWORD_HASH` secrets now match production,
  so preview is usable as real staging rather than public-pages-only. See [operations.md](operations.md).
- Both Workers declare the `AI` binding and a cron trigger (production 06:00
  UTC, preview 06:30 UTC). Workers AI is billed against the account's daily
  neuron allocation; ten short summaries a day sits far inside it.
- `LEAD_WEBHOOK_URL` / `LEAD_WEBHOOK_SECRET` are optional and unset; the
  outbound webhook provider stays inert until they are configured.
- `ADMIN_PASSWORD_HASH` was re-generated (the old value was a retired
  single-round SHA-256 hash that `verifyPassword` refuses) and set as a
  **Secret** on both Workers — it must never go into `wrangler.jsonc`, whose
  `vars` are plaintext and committed. The password can now be changed from
  `/admin/security` without regenerating a hash by hand; `admin_credentials`
  is empty until the first such change, so the env bootstrap is still in force.
  **The password handed over in chat must be changed at first sign-in.**
- `env.preview` now mirrors the top-level `RATE_LIMITER` Durable Object,
  `images` binding, and the two Resend vars. Nothing at the top level is
  inherited by an environment, and `checkRateLimit()` fails open when the
  binding is absent, so preview had been enforcing no rate limits at all.

## D1 migration state (checked 2026-11-12)

| Database | Applied through | How checked |
|---|---|---|
| `devlab-studios-cms-preview` | `0018_editorial_fields` (all) | `wrangler d1 migrations list … --remote --env preview` |
| `devlab-pickleball-preview` | `0020_drop_legacy_pickleball` (all) | same |
| `devlab-studios-cms` (production) | **unverified from the implementation session**; `0018_editorial_fields` known pending | needs the owner's token: `npx wrangler d1 migrations list devlab-studios-cms --remote` |
| `devlab-pickleball` (production) | unverified (confirm `0020`) | `npx wrangler d1 migrations list devlab-pickleball --remote` |

The preview deploy workflow now fails if either preview database has an
unapplied migration (OPS-06). Production migrations stay a manual, token-gated
step: list, apply, then read back.

## Known limitations and follow-ups

- The `site settings save round-trip` admin e2e test races with the versioning
  test under parallel workers — both write the same global `site_settings` row.
  Pre-existing; reproduced on the unmodified spec. Passes serially.
- **Resolved.** The Pickleball suite used to fail ~130 of 246 locally, on an
  unmodified tree as well (confirmed by stashing all work). Two causes, both in
  test infrastructure, neither in application code:
  1. A wrangler bug: the dev worker died inside wrangler's own `ProxyController`
     with an empty error message, cascading into ECONNREFUSED. Upgrading
     4.116.0 -> 4.134.0 took it to ~10 failures.
  2. Three spec files each shelled out to `wrangler d1 execute --local` to
     assert on tables with no read API. That second process opens the SQLite
     file miniflare holds **read-write**, producing `SQLITE_BUSY` in the reader
     and `D1_ERROR: internal error` inside the worker. Two of the three already
     had a cross-process lock and a retry; neither helps, because the
     contention is reader-vs-miniflare, not reader-vs-reader.
     `tests/e2e/pickleball/d1Read.js` replaces all three with one read-only
     `node:sqlite` connection — WAL allows concurrent readers alongside a
     writer, so no second process and no lock. Now 246/246.
- The admin login limiter (20/IP/15 min) bounds how often the e2e suite can be
  run. Two full runs inside the window exhaust it and every later test fails
  with a misleading "element not found". Locally, deleting
  `.wrangler/state/v3/do/devlab-studios-RateLimiterDO` resets the fixture; the
  limiter itself is unchanged and still covered by its own test.
- Delivery retry is bounded per invocation plus manual admin retry; there is no
  scheduled retry worker (see ADR 0003 for why there is no Queue).
- Case studies and testimonials collections remain backward-compatible but
  unused; Work write-ups are the proof surface.
- Production D1 content must be inspected directly before assuming it matches
  seed files or Preview.

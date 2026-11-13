# Implementation progress — B2B / CMS audit

Running log for `docs/plans/devlab-b2b-cms-architecture-audit.md`. Each phase
records its plan, then per requirement: status, commit, tests run, preview and
production evidence, deviations and blockers. The phase list and rules live in
`docs/plans/implementation-prompt.md`.

Owner instruction (2026-11-12): implement continuously without check-ins.
Section N defaults apply unless noted. Items that need the owner's token,
money, legal wording or a real data deletion are skipped and listed under
**Blockers** so the rest can proceed.

| # | Phase | Status |
|---|---|---|
| 1 | Guard rails | done (PR #44, production 2026-11-12 at `64c516d`) |
| 2 | CMS correctness + content model | done (PR #46, production at `a80df26`); production data steps blocked (Blockers 1–2) |
| 3 | Identity + personal data | done (PR #47, production at `0b0a2ab`) |
| 4 | Brand foundation | done (PR #48, production at `1a2f663`; `/brand` 404 in production); scenes S1–S6 approved by the owner 2026-11-12 |
| 5 | Pages I | done (PR #55, production at `033505f`, v2.4.0) |
| 6 | Pages II | done (PR #55, production at `033505f`, v2.4.0) |
| 7 | Routes + SEO | done (part 1 PR #51; routes, SEO-01/02 and sitemap in PR #55); production SEO rows wait on Blocker 15 |
| 8 | Ops + editorial | done (PR #49, production at `4183fb1`) |
| 9 | Performance | OPS-01 done (PR #50); SEC-07 done in PR #55 (hashed script CSP); TEST-06 (Lighthouse report) not yet run |
| 10 | Data-touching jobs | done (PR #52, production at `8d17eca`); going live needs owner setup (Blockers 10–12) |
| 11 | Product Worker split | not started: the redesign has shipped, so this is next once the Workers Paid plan decision (N7) is made |
| 12 | Docs + release | v2.3.0 (PR #53) and **v2.4.0 released 2026-11-12** (PR #55); ADRs 0011–0013; full docs refresh (OPS-08) still open |
| 13 | Blueprint rebrand | done (PR #57, production at `3874835`, v2.5.0 tagged; GitHub Release entry pending, see Phase 13 Open) |
| 14 | Brand, UX and architecture spec (`devlab-complete-b2b-brand-ux-architecture-spec.md`) | done: all nine groups, release 2.6.0 (2026-11-13; see Phase 14) |

## Blockers (owner)

1. ~~**Production D1 migrations `0018_editorial_fields` and `0019_job_runs`**~~ applied 2026-11-13 (Phase 14 OPS-01). (Phase 2, CMS-03). Additive columns only, already applied and verified on preview. The deployed code works without it, but the new project/article/SEO fields cannot be saved in production until it runs:
   `CLOUDFLARE_API_TOKEN=<fresh token> npx wrangler d1 migrations apply devlab-studios-cms --remote` (applies both; both additive, both verified on preview). Until `0019` runs, job runs are only logged, not stored.
2. **Production project reconciliation** (Phase 2, CMS-02). Production reads were not permitted in this session, so production keeps `PROJECTS_STATIC_MERGE=true` (today's behaviour). Run `node scripts/cms/static-projects-missing-from-d1.mjs --env production`, seed any project that should stay, then set the var to `"false"` in `wrangler.jsonc`. Preview: 0 static projects missing (checked).
3. **Branch protection** (OPS-02): enable "Require status checks" with the `validate` check on `main` and `development` (GitHub settings; see docs/testing.md).
4. **Production identity data cleanup** (Phase 3, optional): `scripts/cms/updates/2026-11-12-business-identity.sql` (applied to preview). Not urgent: public pages already enforce the rules on the read path.
5. **Owner inputs for Phase 3 defaults**: legal operator name for privacy/terms (N5; operator wording used now), and the Facebook page / LinkedIn company URL for `sameAs` (only the existing LinkedIn profile and GitHub are listed). Also check `public/resume.pdf` for personal details you no longer want public; it was not changed.
6. ~~Scene approval~~: done 2026-11-12 (all six approved; shipped in 2.4.0).
7. **Uptime monitor (N8):** point a free-tier monitor at `/` and `/api/health` (docs/operations.md).
8. **Production article tags** (Phase 7, after migration `0018`): `scripts/cms/updates/2026-11-12-article-problem-tags.sql` (applied to preview). Until then production's home page falls back to the first non-technical article from the static data rule.
10. **Backups (OPS-04):** create the private `devlab-backups` bucket with a 30-day lifecycle and add the `CLOUDFLARE_BACKUP_API_TOKEN` secret (D1 read + R2 edit), then run the workflow once with the drill (docs/operations.md "Backups").
11. **Retention (SEC-08, N6):** confirm the periods; after backups run, turn retention on (dry run first, attended first real run). Mailbox erasure for a data-subject request is manual for now.
12. **Media domain (OPS-07):** add `media.devlabstudios.com` (and a preview host) as R2 custom domains; then the rewrite script moves stored URLs (preview dry run: 41 URLs).
13. **Privacy page (SEC-03, N5):** legal review; if production has a stored privacy page row, apply `scripts/cms/updates/2026-11-12-privacy-page.sql` (no-op otherwise).
15. **Production SEO rows (SEO-01):** production still serves the old titles and descriptions for its existing pages (for example the home title is 61 characters, Solutions 79). Read the current rows first (an admin may have edited them), then apply `scripts/cms/updates/2026-11-12-seo-redesign.sql` with a fresh token: `CLOUDFLARE_API_TOKEN=<fresh token> npx wrangler d1 execute DB --remote --file scripts/cms/updates/2026-11-12-seo-redesign.sql`. Applied and verified on preview. New routes already use the new records.
16. **Copy review (BUS-01):** the marketing copy in `src/data/site/content.js` is cut down from the earlier site copy. Two lines are worth checking: the three "in exploration" product ideas on `/products`, and "One accountable engineer" in the home lead.
14. Observed, not changed: `/haosweetitis/` returns 404 on production and preview; only `/haosweetitis/index.html` loads. Share that URL, or ask for a route fix.

## Phase 1 — Guard rails

**Plan (order, tests first, rollback).**

1. Pre-existing fix: `listUnansweredReplies` compared row-insert times, so the
   unit suite failed on `main` (`93a5a35`). Fix + regression test. Rollback: revert.
2. OPS-02 CI gates: `ci.yml` runs lint, typecheck, unit, build, static
   Playwright, audit-ci on PRs and pushes to `development` and `main`.
   lint-staged covers `.ts`/`.astro`. Rollback: revert workflow.
3. LEAD-01 inquiry guarantee tests (persist-before-deliver, attempts recorded,
   Turnstile on deployed hosts, shared schema, confirmation cap).
4. TEST-01 guard tests that apply today (outbox bearer fail-closed, no
   `gmail.com` on public pages is deferred to Phase 3 where it is fixed;
   gradients/blur deferred to TEST-03 in Phase 4).
5. CMS-05 adapter boundary test + ARCHITECTURE.md note.
6. SEC-01 `.env.example` parity test, `backups/` ignored, stale Zoho script removed.
7. SEC-04 pickleball test-login loopback guard.
8. SEC-05 `readJsonBody` size cap (413).
9. TEST-07 fixture: `tests/fixtures/legacy-sitemap.txt` from the live sitemap.
10. TEST-04 baseline: screenshots of current production at three viewports.

**Log.**

| Req | Status | Commit | Evidence |
|---|---|---|---|
| Pre-existing unit failure | done | `bbfa468` | `listUnansweredReplies` compared insert times; now message times. 46/46 in the file, +1 regression test |
| Fresh-checkout e2e | done | `176ad3b` | Static suite could not start on a clean clone (empty local D1; remote AI proxy needing a login; Astro auto-backgrounding under an agent). Now 115 passed / 1 skipped locally |
| Fail-open public gates | done | `3be2070` | A D1 error in the maintenance/redirect reads 404'd every gated page. 6 unit tests |
| SEC-05 | done | `0f3c287` | `readJsonBody` 256 KB cap (413), bad JSON 400, `withAdmin` maps HttpError. 9 + 2 tests |
| OPS-02 | done | `5cdebe3` | CI on PR/push to `main` and `development`: lint, typecheck, unit, build, audit, static e2e. Deviation: ESLint for `.astro` deferred (needs `eslint-plugin-astro`, a new dependency; not blocking) |
| CMS-05 | done | `71113d5` | Boundary test over 80 public files; no violations existed |
| SEC-04 | done | `18eebc8` | Test login needs flag AND loopback host; 404 on prod/preview hosts tested |
| SEC-01 | done | `6431f1b` | `.env.example` parity test (63 cases), Zoho keys dropped, `backups/` ignored. Zoho names inside lead-engine runtime flags left untouched (Section L rule 7); document as legacy in OPS-08 |
| LEAD-01 | done | `b26ae94` | 18 unit guards + 1 e2e through the real pipeline (row + recorded failed attempt in the test D1) |
| Dependency advisories | done | `c848ec4` | CI audit found new high advisories (undici, postal-mime, fast-xml-parser); upgraded wrangler 4.160.1, astro 7.4.11, @astrojs/cloudflare 14.4.7, postal-mime 4.2.1. 2,336 unit tests + static e2e pass |
| TEST-01 | partial (by design) | `9122627` | Strict limiter on open-play writes, outbox bearer checks. Remaining guards land with their features: cache (OPS-01), preview token (CMS-04), nonce (SEC-07), no gmail (Phase 3), no gradients (TEST-03) |
| TEST-07 fixture | done | `783c590` | 31 live sitemap paths frozen; e2e checks each resolves (32 passed) |
| TEST-04 baseline | done (tooling) | `01dbf78` | Capture script + **Visual capture** workflow. Local production capture: 36 images OK. Screenshots NOT committed (profile shows personal data; public repo). Production baseline artifact to be run after merge, before Phase 4 |

Promotion: CI green on `64c516d` (merge of `main`'s #HaoSweetItIs commits, which had bypassed `development`) → `development` → preview deploy green; preview smoke 200 on all canonical routes → `main` → Workers Builds success; production smoke: 31/31 legacy URLs 200, `/admin` noindex + no-store, admin API 401 unauthenticated. Visual baseline workflow dispatched against production (run 43140161150).

## Phase 2 — CMS correctness + content model

**Plan.** CMS-01 (schema slugs, archived status, page restore) → CMS-02 (D1 source of truth, gated per environment) → LEAD-02 (new inquiry types) → LEAD-04 (qualification settings) → CMS-03 in two parts (registries + blocks; migration 0018 + editorial fields with column-aware repositories). Migration: preview applied by me; production needs the owner's token. Rollback: revert commits; 0018 columns are additive and unused if the code is reverted.

| Req | Status | Evidence |
|---|---|---|
| e2e worker suites on a fresh checkout | done | `scripts/e2e/write-dev-vars.mjs`; admin suite 48/49 locally (the SEO-editor test needs seeded local content; pre-existing) |
| CMS-01 | done | Solutions/Insights save; page restore incl. Work reference checks; archived removed from page UI; projects/services/etc. stored "archived" as published, now draft. 46 unit + 6 e2e |
| CMS-02 | done (code) | D1 is the source of truth; preview `PROJECTS_STATIC_MERGE=false` (0 missing), production `true` until reconciled (Blocker 2). Read-only reconciliation script |
| LEAD-02 | done | operations_care (business), product_interest/support (unscored, not in contact select). No DB CHECK on inquiry_type, so no migration |
| LEAD-04 | done | Settings panel + API, audited, invalid/non-descending refused, read failure falls back to defaults. 18 unit + 1 e2e |
| CMS-03 | done (code), preview migrated | Registries (scenes S1–S6, problem tags, audiences, OG variants, client types); blocks scene/proofStrip/offerCard; hero visualId/density; cta tone; migration 0018 applied to preview and verified (5/6/1 columns, data intact); production pending (Blocker 1) |
| Found along the way | fixed | CTA inquiry-type list was a stale copy; lead-engine schemaParity test assumed migration numbering |

Promotion: CI green on `a80df26` → `development` → preview deploy green, all canonical routes 200 → `main` → Workers Builds success; production smoke 31/31 legacy URLs + `/admin` 200; new admin API 401 unauthenticated.

## Phase 3 — Identity + personal data

| Req | Status | Evidence |
|---|---|---|
| BUS-05 | done | `src/config/company.js` is the single identity; footer, legal pages and maintenance use `hello@devlabstudios.com`; footer shows "Cebu, Philippines" and a one-line description (new copy, owner to review on preview); operator statement on privacy/terms |
| PROF-02 | done | Phone, DOB and street address removed from static data; read-path guard (`toPublicAbout`, `scrubPersonalContacts`) keeps them off public pages even while production D1 still holds them; preview D1 cleaned by the dated update (read back: no gmail/phone/DOB, city-level) |
| SEO-04 | done | Organization (`@id`, email, foundingDate, city address, founder `@id`), Person (`@id`, /profile, portrait, alumniOf, hasCredential, worksFor `@id`, no alternateName), WebSite without SearchAction. 7 unit tests |
| SEC-06 | done | HMAC-SHA256 of `timestamp.body`, `X-DevLab-Timestamp`; receivers documented. 3 unit tests |
| TEST-01 (no personal mailbox) | done | e2e over every legacy URL + `/maintenance`: no personal mailbox, no `tel:` link |

Promotion: CI green on `0b0a2ab` → `development` → preview: 0 personal-data hits across all frozen URLs, footer identity and Person `@id` verified → `main`.

## Phase 4 — Brand foundation

Decision: this phase adds the brand system without switching any live page (each phase ships to production; a half-converted look is worse than either). Pages switch in Phase 5 after scene approval, which is also when Google Fonts is removed and the CSP tightened (UX-01's "no request to fonts.googleapis.com" lands then).

| Req | Status | Evidence |
|---|---|---|
| UX-01 | done (tokens + fonts; page switch in Phase 5) | 101 KB business-page fonts, OFL licences, measured fallback metrics; contrast tests on paper and ink (ink-3 adjusted to #65615A: plan value was 4.42:1 on paper-2) |
| UX-02 | done, pending approval | 16 symbols, S1–S6 in code, all under byte budget (e2e); one wide crop per scene (tall crops deferred; noted in docs/brand/scenes.md); OG template is WEB-08 (Phase 6) |
| UX-03 | done | Button, Panel, Figure (+counter), FactList, ProofStrip, Disclosure, Tag, Table, Field; NavBar/Footer redesign is WEB-03 (Phase 5) |
| UX-13 | done for scenes | One-time draw-in, reduced-motion end state (e2e) |
| TEST-03 | partial | Grep test over brand sources; extends to all public components with UX-04 |
| TEST-05 | partial | axe (serious/critical = 0) on `/brand`; canonical routes added as pages migrate |
| TEST-04 | partial | `/brand` screenshots at 3 viewports attached to the e2e run |

## Phase 8 — Ops + editorial

| Req | Status | Evidence |
|---|---|---|
| OPS-06 | done | Preview deploy fails on unapplied preview migrations (warns only if the token cannot read D1); state recorded in docs/CURRENT_STATE.md (both preview DBs current) |
| OPS-03 | done (code); monitor is an owner action | Workers Logs on; `/api/health` checks DBs, bucket, DO (503 degraded, no error text); `job_runs` (0019, applied to preview); daily failed-job email. 4 + 8 unit tests |
| OPS-05 | done | GA4 id + off switch in Site Settings, default today's id. CF Web Analytics CSP entries kept (N12 default: enable at the zone) |
| CMS-04 | done | Preview links (derived key, `p1.` format, bound to one item, 1 h, no-store + noindex; refused as a session: tested); multiple admin logins (account must still exist on every request); rendered markdown preview |
| LEAD-05 | done | Funnel panel + daily unanswered-inquiry reminder (internal only, no message text). 4 unit + 1 e2e |
| SEC-07 | moved (now Phase 10, see Phase 9) | Astro 7's built-in `security.csp` hashes its own scripts but sets its own CSP header, which our middleware overwrites; merging them belongs with the HTML cache (OPS-01), where per-request policy and cached pages interact |

Admin e2e: 50 passed; the one failure is the pre-existing seed-dependent SEO-editor test.

Promotion: CI green on `4183fb1` → `development` (migration check ran: both preview DBs current) → preview: health all ok, bogus preview link no-store/noindex, new admin APIs 401 → `main` → Workers Builds success; production health all ok, 31/31 legacy URLs 200.

## Phase 9 — Performance

| Req | Status | Evidence |
|---|---|---|
| OPS-01 | done (code) | Cache API, generation key (`site_settings.html_cache_generation`, memo 2 s), bumped by any successful admin write and the digest; maintenance read memo 60 s; `CACHE_HTML` kill switch. 7 unit + 4 static e2e (HIT, tracking params, preview/admin/API never cached) + 1 worker e2e (save visible within 5 s). Baseline TTFB from the owner's location before the change: `/` 0.95 s, `/solutions` 0.64–0.91 s, `/about` 0.45–0.67 s |
| SEC-07 | moved to Phase 10 | Pages carry Astro island loaders, inlined component scripts, the GA bootstrap and the Google Fonts `onload` handler. Plan: adopt Astro 7's built-in `security.csp` (build-time hashes, so compatible with the HTML cache), move GA to an external same-origin script, and drop the Google Fonts handler when the brand fonts go live (Phase 5). The plan lists SEC-07 as depending on OPS-07, also Phase 10 |
| TEST-06 | partial | TTFB measured before/after from the owner's location; Lighthouse CI on preview needs the redesigned pages to set budgets against (Phase 5+) |

Production after Phase 9: MISS then HIT from the Singapore edge; preview TTFB on HIT 0.24–0.79 s from the owner's location (baseline 0.45–0.97 s; the audit's 2–11 s was measured from other regions).

## Phase 7 (part 1, page-independent)

| Req | Status | Evidence |
|---|---|---|
| WEB-02 / SEO-06 | done | `src/config/robots.ts` drives meta + header; daily digest, offers, crawler, maintenance, 404 noindex; removed from sitemap; legacy URLs still 200 |
| SEO-07 | partial | Pickleball 0.3–0.4; article lastmod from updatedAt. Category/audit/products/write-up priorities come with those routes (Phase 6) |
| SEO-03 | done | Article schema image fallback, dateModified, author/publisher `@id` |
| SEO-08 | done | 15 articles tagged (static + preview D1); home promotes owner articles only; briefs in docs/content/briefs.md. `site_settings.insights_featured_tag` not added: the audience rule covers the plan's intent without another setting |
| SEO-01, SEO-04 (rest), WEB-01 | pending | Depend on the new routes and page copy (Phases 5–6) |

## Phase 10 — Data-touching jobs

| Req | Status | Evidence |
|---|---|---|
| OPS-04 | done (inert until owner setup) | `backup.yml` nightly export + load check + upload; monthly/on-demand restore drill; `scripts/ops/restore-drill.mjs` verified on synthetic dumps (pass and missing-table fail) |
| SEC-08 | done (off by default) | Retention plan/apply with bounded batches, off + dry run until enabled; daily cron step recorded in `job_runs`; export/erase API + panel (audited by hash). 4 + 2 unit tests on SQLite, 1 e2e. Mailbox erasure: documented manual step |
| SEC-03 | done (pending legal review) | Factual privacy page from a code audit of every processing activity; generated guarded D1 update (dry-run verified); preview shows the static text (no stored row) |
| OPS-07 | script done; domain is an owner action | `media-domain-rewrite.mjs` dry-run on preview: 19 project images + 22 gallery images would move |
| SEC-07 | pending | After the Phase 5 font switch (removes the Google Fonts inline handler); then Astro `security.csp` hashes + external GA bootstrap |

Also fixed: two e2e races (cache warm-up assumed two requests suffice; the preview-link and cache tests both edit /process and now run serially).

## Release 2.3.0 (2026-11-12)

Everything above shipped: CI created `v2.3.0` and its GitHub Release; `main` and `development` both at `c6209aa` (`0 0`); production smoke 31/31 legacy URLs 200, health ok.

**Where the plan stands.** Done and live: Phases 1, 2, 3, 4 (pending scene approval), 7 part 1, 8, 9, 10 (inert until owner setup). Waiting on the owner: scene approval + copy review (Phases 5–6 and the rest of 7), the product-Worker split timing and plan (Phase 11), and the setup items in Blockers 1–13. SEC-07 follows Phase 5's font switch. OPS-08's full documentation refresh follows the remaining phases.

## Phases 5–6 + Phase 7 routes/SEO + SEC-07 — release 2.4.0 (2026-11-12)

PR #55 (`06501a8`, `37d736d`, release `033505f`); v2.4.0 tag and GitHub Release created by CI.

- **Pages (UX-04..UX-12, BUS-01/02/04, WEB-03..WEB-07, PROF-01..03, LEAD-03):** Home, Solutions plus three service-line pages and the audit, Work and `/work/<slug>`, Insights and articles, About, Profile, Products, Contact, Privacy, Terms and the 404 now run on BrandLayout. Copy is code-owned (ADR 0013); the page builder flags code-composed pages. `/process` → 301 `/about#how-we-work`; `/landing-sample-*` → 301 `/work`; the legacy SPA and `react-helmet-async` are removed.
- **SEO (SEO-01/02, WEB-01):** the static records meet the title and description limits, enforced by `seo.test.ts`. There is a per-page social card (32–54 KB; `og.png` went from 1.37 MB to 54 KB). The sitemap adds the service lines, `/products` and the write-ups. The update SQL was applied to preview after reading the rows (all still seeded values from 2026-09-18; 24 rows written; read back within limits).
- **SEC-07:** Astro `security.csp` hashes are merged into the middleware CSP, so rendered pages carry no `'unsafe-inline'` in `script-src`. GA moved to an external file.
- **Tests:**
  - lint (0 errors), typecheck (0), unit 2,615 passed, build OK.
  - Static e2e: 217 passed, including the new `redesign.spec.js`.
  - Worker e2e: all pass except two data-dependent tests: SEO slug editor (known before this branch), and Lead CRM sources (the local database has "No sources registered").
  - The `/process`-based admin preview and cache tests moved to `/work` with a synthetic project.
  - The digest sitemap test was corrected (the page has been noindex since 2.3.0).
- **Preview evidence:**
  - All routes answer 200, or 301 and 404 where expected, at 0.2–0.8 s.
  - Browser scan of 14 routes plus Contact: no site CSP violations. The only messages come from inside the Turnstile iframe, which has its own policy.
  - Turnstile loads; write-ups resolve (including the preview-only "Memory Preview" project); header is 61 px with no overflow at 320 px.
- **Production evidence (www, after deploy):**
  - Every new route returns 200; `/process`, `/landing-sample-react`, `/services` and `/resources` return 301 to their targets.
  - All 31 frozen legacy URLs resolve; the sitemap has 37 URLs; `/api/health` returns 200.
  - `script-src` is hashed; no site CSP violations.
  - Turnstile loads (the form was not submitted); GA loads (dataLayer present, gtag requested).
  - Personal-data scan of `/`, `/about`, `/profile`, `/contact` and `/work`: 0 hits.
- **Deviations:**
  - Pickleball left the Home and Solutions journey (G.1 allows removal); it lives in the footer and on `/products`.
  - `/products` shows the product's verified features instead of a screenshot, because no real screenshot with synthetic data exists yet (the OG card is marketing art, not a screenshot).
  - Styles keep `'unsafe-inline'` because server-rendered `style` attributes need it.
  - Google Fonts remain only on the legacy layout (pickleball, offers, daily log, crawler and maintenance pages).
- **Open:**
  - Blockers 15–16.
  - TEST-06 Lighthouse run against preview.
  - Pickleball shell on brand tokens (BR.16).
  - OPS-08 docs refresh.
  - Phase 11 (N7).

## Phase 13 — Blueprint rebrand (release 2.5.0, 2026-11-12)

**Plan.** Owner-approved "Blueprint" plan (2026-11-12): dark navy palette with
the logo gradient, self-hosted Space Grotesk + JetBrains Mono, sticky glass
shell, a new interactive home page, and Node as a secondary figure. Scope:
home page + shared shell; every brand-layout page changes colour through the
global tokens. Nav labels, header CTA label, routes, redirects and CMS data
are unchanged. Decision record: ADR 0014.

**Log.**

| Step | Req | Status | Commit | Evidence |
|---|---|---|---|---|
| 0 | Branch from `origin/main` (`2748372`) | done | — | `feat/blueprint-rebrand` |
| 1–3 | Token tests first, fonts, tokens, Tailwind, layout | done | `7e0e344` | Token test RED (20 failing) then 154/154. Fonts 22 KB + 40 KB = 62 KB. Visual pass on `/`, `/about`, `/contact`, a write-up and an article: readable on navy, scenes visible |
| 4 | Shell: sticky glass nav, SVG mark, magenta current underline, footer sign-off + location | done | `9ba2b53` | Company test RED→GREEN; schema tests updated; header ≤ 64 px at 320/390/820/1440; footer test green |
| 5 | NodeMascot (TDD) | done | `bcb1dc2` | 13 unit tests (role/title, decorative, states, distinct ids, slate + amber visor, packets only when active, ≤ 6 KB, no hex/script); `/brand` shows all states |
| 6 | Home copy + guards (TDD) | done | `096a645` | `homeContent.test.js` RED (8) → 11/11 |
| 7 | Home components + page | done | `096a645` | typecheck 0 errors, build OK; 1440 and 390 screenshots, no horizontal scroll |
| 8 | e2e updates + `home-interactive.spec.js` | done | `096a645` | Static suite 225 passed, 1 skipped (pre-existing: no-article skip) |
| 9 | Contact success state | done | `817f28b` | Assertions RED then contact-form 15/15 |
| 10 | Social cards, icons, manifest | done | `6a61fd5` | 12 cards 45–59 KB; redesign + brand specs 33/33 |
| 11 | Docs + changelog | done | this commit | ADR 0014, audit amendment, ADR 0012 status, scenes note, CHANGELOG `[Unreleased]` |
| 12 | Full verification, visual capture, Lighthouse | done | — | lint 0 errors (1 pre-existing warning in pickleball), typecheck 0, unit 2,756 passed / 1 skipped, build OK, static e2e 225 passed / 1 skipped. `capture.mjs` at 390/820/1440 for 12 routes. Lighthouse mobile on `/` (local preview, warm): performance 93 / 93 vs `origin/main` 93 / 91 under the same conditions; accessibility 100, best practices 100, CLS 0, LCP 2.9 s. Production 2.4.0 baseline: 92, LCP 3.1 s |
| 12b | Whole-branch review (fresh reviewer) and fix pass | done | this commit | Critical: the header's backdrop-filter clipped the fixed phone menu to 60 px on every page below 1024 px; the blur moved to `::before` (phone-menu e2e RED → GREEN). Important: endless animations (WCAG 2.2.2) now stop within 5 s (guard test RED → GREEN); the schema privacy test checks address shape instead of naming real address values. Static e2e 226 passed / 1 skipped |
| 13a | PR #57, CI, preview | done | `551fe7e` | CI `validate` green. `development` fast-forwarded, preview deployed. On the preview URL: h1 and primary CTA on the first screen at 390/820/1440 with no horizontal scroll; phone menu full height and navigates; outage toggle makes 0 `/api/` requests; JS off shows 4 panels and no toggle; reduced motion pauses all 12 animated SVGs; `/brand` 200 with 4 Node states; hashed `script-src`; no Google Fonts request; `og.png` 200. Lighthouse mobile on the preview: performance 97 / 97, accessibility 100, best practices 100, LCP 2.3 s, CLS 0. Visual capture: production before (Actions run 43188083910), preview after (run 43191020317) |
| 13b | Release 2.5.0, production smoke | done | `3874835` | Release commit (`package.json` and the two root `package-lock.json` fields only; `text-extensions@2.4.0` untouched). PR #57 checks green on the release commit, then `main` and `development` were fast-forwarded together. CI `validate` green; Workers Builds deployed. CI pushed tag `v2.5.0`, but `gh release create` got a GitHub 503, so the Release entry is missing (see Open). Production (www): all 31 frozen legacy URLs resolve (200, or 301 to a 200); `/` has the new h1 at 390/820/1440 with no horizontal scroll; the phone menu is full height and navigates; the outage toggle makes 0 `/api/` requests; JS off and reduced motion both pass; hashed `script-src` CSP; no Google Fonts request; `og.png` and `og/home.png` 200 (52 KB); `/api/health` 200; `/brand` 404 (by design). Personal-data scan of `/`, `/about`, `/profile`, `/contact`, `/work`, `/privacy` and `/terms`: 0 hits |

**Deviations (rulings).**

- The theme-color meta is exempt from the no-raw-hex guard (browsers read it before CSS).
- Gradient buttons carry a navy scrim: white on bare magenta is only 3.1:1.
- The inquiry form's submit button uses the gradient like every other primary action.
- The schema privacy guard now forbids barangay and postal code instead of the city name "Lapu-Lapu" (owner decision 8; PROF-02 is city-level only, and Lapu-Lapu City is a city).
- `Button.astro` wraps the global action classes; only `/brand` uses it.
- The reliability grid puts rule 01 in a tall left column beside the other three; a two-row span would orphan the fourth card. Card 01 carries a three-line delivery log so it is not empty.
- No `wide` prop on `PageHeader`: its aside grid is already 7/5.
- The reliability card texts are the spec's, verbatim (including "summarizes").
- The reduced-motion e2e uses `page.emulateMedia`: `test.use({ reducedMotion })` did not reach `matchMedia` in this config.
- The Bricolage and Martian font files were removed (unreferenced after the swap). The web manifest's description dropped the retired portfolio tagline.

- The About page's "Based in" fact and the profile's static fallback hard-coded "Cebu, Philippines"; both now read `COMPANY.locationLabel` (guarded by `company.test.js`). `/profile` shows the CMS profile row's own location, which was not changed (no D1 writes).

**Open.**

- **GitHub Release v2.5.0**: the tag exists, but CI's `gh release create` hit a GitHub 503 and the publish was not retried from this session. To publish it from the CHANGELOG section: `gh release create v2.5.0 --verify-tag --title v2.5.0 --notes-file <(awk -v ver=2.5.0 'BEGIN{h="## [" ver "]"} index($0,h)==1{f=1;next} f&&index($0,"## [")==1{exit} f{print}' CHANGELOG.md)`.
- Review minors (deferred): no visible pressed state on the outage toggle; the hero eyebrow's brackets and capitals are read aloud by screen readers; the schematic's small labels are about 9.5 px on a 390 px phone; with JS off the console panels keep `role="tabpanel"` and `tabindex`; NodeMascot's fallback id counter (every current call site passes `id`).
- Owner decisions: `COMPANY.operatorStatement` (privacy and terms legal text) still says "Cebu, Philippines" while the footer says Lapu-Lapu City. The home SEO title in the SEO record still reads "Operations software that holds up".
- **Pre-existing privacy issue (not from this branch):** `scripts/cms/seed/cms-content-seed.sql` in this public repository contains real personal data (phone, date of birth, personal mailbox, barangay/postal address), as noted by the reviewer. It needs its own ticket. Removing it from the files is simple; purging it from git history needs a rewrite and force-push, which is the owner's decision.


## Phase 14 — Brand, UX and architecture spec

Running log for `docs/plans/devlab-complete-b2b-brand-ux-architecture-spec.md`
(re-audit dated 2026-11-12 at `dd6b377`; owner decisions dated 2026-11-13 in
its preamble are binding). Work runs in nine requirement groups, one PR each,
through `development` → preview → owner sign-off → `main`.

| Group | Requirement IDs | Status |
|---|---|---|
| 1 Gates and guards | OPS-01, TEST-01, SEC-01, OPS-02 | done (PR #59, production at `15f93e4`, 2026-11-13) |
| 2 Brand foundation | BRAND-01, BRAND-02, BRAND-03, BRAND-05, MASCOT-01, MASCOT-02, MASCOT-03 | done (PR #60, production at `2a8c0ae`, 2026-11-13); art and Node pending owner review (Group 3) |
| 3 Review gate | `/brand` review of scenes and the Node redraw (MASCOT-04 fallback) | done: owner approved everything on preview `/brand`, 2026-11-13 |
| 4 Data | CMS-01, CMS-02, CMS-03 | done (PR #61, production at `4961cf6`, 2026-11-13) |
| 5 Pages I | UX-02, UX-01, WEB-03, CONTENT-01, CONTENT-02, CONTENT-03, CASE-01, CASE-02 | done (PR #64, production at `2185c6a`, 2026-11-13) |
| 6 Pages II | UX-03, UX-04, UX-05, CONTENT-04…06, CONVERT-01…04, WEB-02, BUS-01, BUS-02, BUS-05, PROFILE-01, CASE-03 | done (part 1 PR #65; part 2 in the 2.6.0 release PR) |
| 7 Shell consolidation | BRAND-04, WEB-01, WEB-05, SEC-03 | done (PR #66, production at `1b49cb4`) |
| 8 Conditional and owner items | BUS-03, BUS-04, CONVERT-05, CASE-04, WEB-04, SEO-01, SEO-04, MASCOT-05 | done (BUS-03 and WEB-04 resolved by decision; see log) |
| 9 Verification and release | TEST-02…05, OPS-03, OPS-04, CMS-04, release | done: release 2.6.0 |

### Drift since the spec (checked 2026-11-13)

- Code: none. `origin/main` and `origin/development` are both at `dd6b377` (`0 0`).
- **Production D1 is in the Cloudflare account named "Devlab Studios Development"** (`db49…`), the same account as preview; the account named "Devlab Studios" (`023a…`) does not hold it. Wrangler needs `CLOUDFLARE_ACCOUNT_ID=db49443cea6f0725d848254f17bcdab5` in non-interactive runs. `--env preview` (or its absence) still decides the database.
- **Production migrations confirmed behind** (read-only `SELECT` on `d1_migrations`, 2026-11-13): last applied `0017_confirmation_recipients.sql` (2026-10-13). `0018` and `0019` pending. Preview: `0019` applied.
- **Spec N.1 scrim value fails spec N.5's own contrast rule.** White over the magenta stop under a 10 % `#15142a` scrim is 4.40:1 (< 4.5). Measured: 11 % 4.47, 12 % 4.55, 18 % 5.05. Decision for BRAND-01: 12 % at rest (smallest passing value), 18 % on hover as N.5 says; the token test asserts ≥ 4.5 at the magenta end.
- v2.5.0 GitHub Release still missing (tag exists; `gh release view v2.5.0` → not found).

### Group 1 — Gates and guards (plan)

Branch `feat/brand-ux-1-gates-guards` from `main` (`dd6b377`). Order:

1. **OPS-01 Production migrations `0018`, `0019`** (owner token, one command).
   - Pre-check done (read-only): none of the 13 `0018` columns exist on production; no `job_runs` table; `projects` has 20 rows. Both migrations are additive (`ALTER TABLE … ADD COLUMN` with defaults, `CREATE … IF NOT EXISTS`).
   - Before: record the Time Travel bookmark (`wrangler d1 time-travel info devlab-studios-cms`), snapshot `/work` and the four write-ups' HTML on production.
   - Apply: `CLOUDFLARE_API_TOKEN=<fresh> CLOUDFLARE_ACCOUNT_ID=db49… npx wrangler d1 migrations apply devlab-studios-cms --remote` (no `--env` = production).
   - Read back: `d1_migrations` shows 18 and 19; `pragma_table_info` shows the columns; `job_runs` exists; `projects` still 20 rows; `/work`, write-ups, `/api/health` 200 and unchanged.
   - Risk: the column-aware project repository starts reading the new (empty) columns; Work pages could change. Rollback: the code ignores empty values (verified on preview since Phase 2); last resort `wrangler d1 time-travel restore` to the recorded bookmark.
2. **TEST-01 Guard tests, written first.** Guards the code already meets are plain tests. Guards that later groups make true land as expected failures (`it.fails` / `test.fail()`) tagged with the requirement that fixes them: they run in CI, prove the violation exists today, and turn red the moment the fix lands, which forces the flip to a plain test in that requirement's commit. CI stays green; nothing can be forgotten.
   - `src/data/site/contentGuards.test.js`: forbidden strings (spec C.3 + I.2) in `content.js` and the static legal data (`terms.js`, `privacy.js`) → expected failure until CONTENT-01/03; honesty labels (`VERIFIED ·`, `LIVE`, `NOMINAL`, `SYS-`) in brand components and pages → expected failure until UX-01; CTA allow-list (every `/contact` link label in `content.js`, the nav defaults in `siteSettingsContent.js`, the `BrandNav` fallback) → expected failure until CONTENT-02; eyebrows without `§`, `[`, `]`, `•` → expected failure until BRAND-02.
   - `src/styles/brandTokens.test.ts`: `var(--brand-gradient)` only in the four allowed selectors (mark, `.dl-button-primary`, `.hero-rule`, current-nav underline); contrast for `--link` on `--paper` (≥ 7:1), `--ink-3` on `--paper` (≥ 4.5:1), white over the gradient's magenta stop under the scrim (≥ 4.5:1); amber only inside `.ink-panel` rules → expected failures until BRAND-01/02 where today's values do not meet them.
   - `scripts/cms/seed/seedPrivacy.test.js`: scan every `scripts/cms/seed/*.sql` and `scripts/cms/updates/*.sql` for phone numbers, a `dateOfBirth` with a value, consumer mailboxes (gmail, yahoo, outlook, hotmail, icloud), barangay or postal-code addresses → expected failure in this commit, flipped by SEC-01.
   - `tests/e2e/redesign.spec.js`: `.node-mascot` count ≤ 2 on every public route → `test.fail()` for `/` (11 today) until MASCOT-03.
   - `src/lib/legacyUrlFixture.test.ts`: `tests/fixtures/legacy-sitemap.txt` pinned by SHA-256 and 31 entries.
   - Rollback: revert the commit (tests only).
3. **SEC-01 Seed file personal data** (Q-18: file only, no history rewrite). In `scripts/cms/seed/cms-content-seed.sql`, `profile_about`: drop `phone` and `dateOfBirth` (the same keys `2026-11-12-business-identity.sql` already removes from live databases), city-level location, business mailbox; `site_footer`: business mailbox. The founder's public name stays. Flip the seed scan to a plain test. Risk: a fresh environment seeded from this file shows no phone or birth date (intended). Rollback: n/a (file change only; no database touched).
4. **OPS-02 GitHub Release v2.5.0**: `gh release create v2.5.0 --verify-tag --title v2.5.0 --notes-file <CHANGELOG 2.5.0 section>`. Check `gh release view v2.5.0` after. Rollback: `gh release delete v2.5.0` (keeps the tag).
5. PR, CI, `development`, preview check (no visual change expected: tests and a seed file only), `main`, production smoke, PROGRESS evidence.

**Group 1 log.** Owner approved the plan and terminal work without check-ins (2026-11-13).

| Req | Status | Commit | Evidence |
|---|---|---|---|
| OPS-01 | done | — (no code) | Production restore point before the write: Time Travel bookmark `00005750-00000000-00005122-4ba814ce4a9a02bfa9b4fd989e6b683b`. Applied `0018_editorial_fields.sql` and `0019_job_runs.sql` with `npx wrangler d1 migrations apply devlab-studios-cms --remote` (account `db49…`; the existing Wrangler login, owner instruction not to stop for a token). Read back: `d1_migrations` ends at 18, 19; all 12 new columns present; `job_runs` exists; `projects` still 20 rows. `/work`, the four write-ups and `/api/health` 200 with identical `<main>` HTML before and after |
| TEST-01 | done | `265177e` | New: `src/data/site/contentGuards.test.js` (59 pass, 6 expected fail), `scripts/cms/seed/seedPrivacy.test.js`, `src/lib/legacyUrlFixture.test.ts` (2), Direction B block in `brandTokens.test.ts` (3 pass, 3 expected fail), Node-count e2e in `redesign.spec.js` (15 routes; `/` expected fail). Every expected failure was run as a plain test and failed for the reason the spec names (forbidden labels on `/`, Terms "illustrative purposes", `SYS-` cards, six off-list CTA labels, `§` eyebrows, `.dl-gradient-border`, missing `--link`, Node's amber outside `.ink-panel`, 11 Nodes on `/`) |
| SEC-01 | done | `7da059f` | Seed guard RED first (expected failure), then the fix turned it into "Expect test to fail" and it was flipped to a plain test: 19/19 SQL files clean. Changed only `profile_about` (removed `phone`, `dateOfBirth`; business mailbox; city-level location) and `site_footer` (business mailbox, email link). All migrations + the seed apply to an empty SQLite; both rows parse. No database touched; no history rewrite (Q-18) |
| OPS-02 | done | — | `gh release create v2.5.0 --verify-tag` from the tag's CHANGELOG section; `gh release list` shows v2.5.0 Latest (2026-11-13T02:51:25Z) |

Local verification before push: lint 0 errors (1 pre-existing pickleball warning), typecheck 0 errors, unit 2,883 passed / 9 expected fail / 1 skipped (203 files), build OK, static e2e 240 passed / 1 skipped.

Deviation: SEC-01 drops the phone and birth-date fields instead of filling synthetic values (matches the live-database cleanup in `2026-11-12-business-identity.sql`; a fake phone would render as data).

Group 1 promotion: PR #59 CI `validate` green; `development` fast-forwarded to `15f93e4`, `deploy-preview.yml` run 43355858919 green. Preview: 31/31 legacy URLs, `/api/health` 200, `/brand` 200, hashed `script-src` (13 hashes, no `unsafe-inline`), `/admin` `noindex, nofollow`. `main` fast-forwarded to `15f93e4` (PR #59 shows MERGED); `origin/main...origin/development` = `0 0`. Production after Workers Builds: 31/31 legacy URLs, `/api/health` 200, `/brand` 404 (by design), hashed `script-src`, `/admin` noindex, personal-data scan of `/`, `/about`, `/profile`, `/contact`, `/work`, `/privacy`, `/terms` = 0 hits.

### Group 2 — Brand foundation

**Plan.** BRAND-01 tokens (test first) → BRAND-02 actions, labels, fields → MASCOT-01/02 Node redraw and motion behind an approval gate → MASCOT-03 placements → BRAND-05 crops, S7, S8, D-1…D-4 (all unapproved) → BRAND-03 cards and icons. No data writes. Rollback per requirement: revert its commit (the art also has `artReady`/`tallArtReady`/`NODE_ART` switches). Branch `feat/brand-ux-2-brand-foundation` from `15f93e4`.

| Req | Status | Commit | Evidence |
|---|---|---|---|
| BRAND-01 | done | `1d299f7` | Token test rewritten to N.1 first (RED: exhibit tokens missing), then green. Measured contrast forced three changes, recorded in `brand.css`: `--ink-3` `#6b6984` (spec `#6d6b87` = 4.47:1), `--redline` `#b800d1` (spec `#c400de` = 4.17:1), button scrim 12 % at rest (spec 10 % = 4.40:1 for white at the magenta end) and 18 % on hover. `--link` `#4338ca` kept: 6.90:1 on stone (spec claimed ≥ 7; AA is the bar). Added `--exhibit-ok` `#4ade80` and `--exhibit-amber` `#f59e0b` (spec green/amber read 3.6:1 on graphite; axe caught it). Grid, radial glows and header blur removed; new e2e asserts stone body, no background image, no backdrop-filter on every brand route. Footer, phone menu and CTA bands moved off graphite (`.dl-band`); home hero band closed by `.hero-rule` |
| BRAND-02 | done | `b1fdec7` | Eyebrow guard and gradient-role guard switched on (were expected failures). `.label` is the plain text-face section label; mono only in figures, code and exhibits. Buttons in the text face; outline secondary 1.5 px ink; indigo links; current-nav gradient underline (in `brand.css`, allowed selector). Form labels sentence case, 44 px white fields, 2 px ink focus, `--danger` errors. e2e checks the underline and label styles |
| MASCOT-01/02 | done (pending owner review) | `c073e03` | New `NodeMascot.test.jsx` RED (missing config) → 36/36 incl. 12 snapshots (4 states × 3 tiers), ≤ 6 KB each, no SMIL/hex/gradient, lamp only, 1.6 plate ratio, CSS sequences ≤ 1.2 s and run once, reduced-motion and hidden-tab rules. `NODE_ART` gate: every state `false`, so public placements render nothing until the owner approves on `/brand`. 12 static exports in `public/branding/node/` (1.2–2.3 KB). `docs/brand/node.md` character sheet. `/brand` e2e: 24 renders, 2 silhouettes, replay runs once ≤ 1.2 s |
| MASCOT-03 | done | `dc87753` | Node-count guard switched on for `/` (0 today while unapproved; ≤ 2 once approved). Console rows lose Node; hero uses one Node (outage turns its lamp amber inside the exhibit) or a plain checkpoint while unapproved; audit card holding; 404 idle; success state confirming or a check mark. Amber guard switched on |
| BRAND-05 | done (pending owner review) | `0f39f19` | S7, S8, D-1…D-4 drawn from the symbol library; tall 4:5 crops for S1, S2, S3, S6, S7, S8, D-1…D-4; all `artReady`/`tallArtReady` false. D-x drawn from each write-up's own description (Memory Preview read from production D1, read-only); D-4 has no person or ledger because its write-up describes neither. `brand.spec.js`: tall-crop byte budgets, viewBox, titles; phone aspect switches to 4:5 on `/brand` |
| BRAND-03 | done | `c0ea23c` | 12 cards + `og.png` re-rendered on stone with a scene symbol (38–51 KB; spec said 45–60 KB, the lighter cards compress smaller, all far under the 200 KB test budget). Icons and favicon on stone; manifest colours `#f0eff3` |

Verification (local, before push): lint 0 errors (1 pre-existing warning), typecheck 0 errors, unit 2,925 passed / 5 expected fail / 1 skipped (203 files), build OK, static e2e 244 passed / 1 skipped. Worker + admin-auth: 317 passed / 7 failed / 1 skipped; the failing tests (outbox bearer checks, mailbox retry, Lead CRM sources, iPhone poster share, and on one run the Work draft-preview, Work editor and SEO slug tests) fail identically on `origin/main` (`15f93e4`) and `dd6b377`: pre-existing local-environment failures, not from this group. Legacy-layout routes (`/pickleball`, `/offers/lead-intake-checklist`, `/maintenance`) compared against production at 390 and 1440: visually identical (≤ 0.2 % pixels, local seed data in the footer).

Deviations: the contrast adjustments above; exhibit green/amber added; D-4 without a person or ledger; MASCOT-01 and MASCOT-02 share one commit (same component and stylesheet block); card sizes below the spec's range.

Owner actions opened by this group (Group 3 gate): approve or reject on `/brand` (preview) the Node redraw (silhouette test; else MASCOT-04), S7, S8, D-1…D-4, and the tall crops.

### Group 3 — Review gate (owner)

Open. On the preview `/brand`: approve or reject the Node redraw (24 px silhouette test; reject = MASCOT-04), S7, S8, D-1…D-4 and the tall crops. Approval = set `NODE_ART.states.*`, `artReady` and `tallArtReady` to `true` with the date in `docs/brand/node.md` and `docs/brand/scenes.md`. Work continues on groups that do not depend on it.

### Group 4 — Data (plan)

Owner instruction 2026-11-13: proceed without check-ins (covers the plan-approval gate and production data writes with the existing Wrangler login, as for OPS-01). Branch `feat/brand-ux-4-data` from the Group 2 head.

1. **CMS-01 migration `0020_writeup_fields`** (TDD: `editorialFields.test.js` for databases with and without `0020` first). Additive nullable-safe columns on `projects`: `situation`, `decisions_json`, `scope`, `in_operation_since`. Drift: the spec's `diagram_id` already exists as `system_diagram_id` (`0018`), so it is reused, not duplicated. Four places: repository (column-aware, refuses unsaved values naming `0020`), Zod schema + admin form, `workEntries.ts` read path, static fallback type. Apply to preview (`--env preview`), read back; then production (Time Travel bookmark first, read back). Rollback: columns unread; Time Travel restore as last resort.
2. **CMS-02 business settings** (TDD: `business.test.js`, schema test). One `site_business` row (`replyWindowDays`, `businessHours`, `timeZoneLabel`, `schedulingUrl`, `messengerUrl`, `whatsappUrl`, `auditPriceLine`), defaults in `src/config/business.js` = the owner's 2026-11-13 decisions; channels null. Schema, repository, `loadSiteSettings`, admin "Business details" fields, static fallback. No data write needed (defaults apply when the row is absent). Rollback: revert; the row is ignored.
3. **CMS-03 dated updates**: `scripts/cms/updates/2026-11-13-terms-screenshots.sql` with a guarded `UPDATE` of the Terms "illustrative purposes" sentence (Q-06 decided) and its paired revert, with the static `terms.js` changed in the same commit (CONTENT-03 legal guard switched on). Read production and preview rows first; apply preview, read back; then production, read back. The home SEO title, CTA labels and write-up leads wait for their copy (Groups 5–6) and get their own dated files then.

Group 2 promotion: PR #60 CI `validate` green. `development` → `2a8c0ae`, `deploy-preview.yml` run 43360430974 green. Preview: 31/31 legacy URLs, `/api/health` 200, `/brand` 200, theme colour `#f0eff3`, hero rule present, no Node on `/` (gated), hashed `script-src` (13). Visual capture of 12 routes × 3 widths on preview: 36 images OK (local scratch, not committed: the profile shows personal data). `main` → `2a8c0ae` (PR #60 MERGED); `0 0`. Production after Workers Builds: 31/31 legacy URLs, `/api/health` 200, `/brand` 404, hashed `script-src`, `/admin` noindex, theme `#f0eff3` and hero rule on `/`, personal-data scan 0 hits, `/og/home.png` 200 (44 KB).

**Group 4 log.**

| Req | Status | Commit | Evidence |
|---|---|---|---|
| CMS-01 | done | `bc2399f` | Repository tests RED (5) → 14/14; schema and read-path tests 4/4; admin API round-trip e2e (worker) passes with the four new fields and rejects a malformed date (400). Preview D1: `0020_writeup_fields` applied, 4 columns, 19 project rows intact. Production D1: Time Travel bookmark `0000575b-00000000-00005122-9da46301838b7085bc5a6540b7546412` recorded, `0020` applied, last migration `0020_writeup_fields.sql`, 4 columns, 20 rows intact; `/work`, `/work/memory-preview`, `/api/health` 200. `docs/CURRENT_STATE.md` migration table updated |
| CMS-02 | done | `a74fcda` | `business.test.js` RED (missing module) → 11/11 (defaults = owner decisions, field-by-field merge, https-only channels, sentence helpers, schema limits). Admin e2e: business details save, persist across reload and clear back to the defaults. No D1 write needed |
| CMS-03 | done (Terms) | `e922f8f` | Read first: neither D1 stores a `terms` or `privacy` page (0 rows), so `/terms` renders `terms.js`, fixed in the same commit; legal guard switched on. `scripts/cms/updates/2026-11-13-terms-screenshots.sql` (guarded, paired revert) ran on preview and production: `rows_written: 0` on both. Home SEO title, CTA labels and write-up leads deferred to their copy (Groups 5–6) |

Verification: lint 0 errors, typecheck 0, unit 2,947 passed / 4 expected fail / 1 skipped (205 files), build OK. Static e2e first run: 3 failures caused by leftover `smoke-*` projects and a replaced Work narrative in the local dev D1 (left by the pre-existing failing admin tests); the local state was moved aside to `.wrangler/state-backup-2026-11-13` (kept, not deleted) and the suite rerun on fresh state, as CI does: 244 passed / 1 skipped. Worker + admin-auth on fresh state: 321 passed / 4 failed / 1 skipped; the 4 (SEO slug editor, Lead CRM sources, two pickleball poster-share emulations) are the same pre-existing failures as on `main`.

Deviations: one `site_business` row instead of seven keys; spec `diagram_id` reuses the existing `system_diagram_id`; code defaults are the owner's decided values (the brief's no-hardcoding rule) rather than "not stated".

Group 4 promotion: PR #61 CI `validate` green. `development` → `4961cf6`, `deploy-preview.yml` run 43362376904 green (the migration check passed: preview D1 already at `0020`). Preview: 31/31 legacy URLs, `/terms` carries the new sentence and not the old one, `/api/health` and a write-up 200, `/api/admin/content/site-settings` 401 without a session. `main` → `4961cf6` (PR #61 MERGED); `0 0`. Production after Workers Builds: 31/31 legacy URLs, `/api/health` 200, `/brand` 404, `/terms` new sentence, hashed `script-src` (13), `/admin` noindex, personal-data scan 0 hits.

### Handoff for the next session (Group 5 — Pages I)

- **Start from** `main` = `development` = the commit after this note. Read this Phase 14 section first.
- **Owner gate:** Group 5 introduces the spec's proposed home copy (I.4, "proposed, not approved"). Build it, ship it to preview, and hold the production push until the owner has reviewed the home copy on preview.
- **WEB-03 finding (2026-11-13):** the home portrait is not broken. Every `/_image` variant (AVIF and WebP, 96 and 192 px) returns 200 on production; the audit's "empty frame" is the bordered box of a `loading="lazy"` image in a full-page screenshot. The founder strip (UX-01) should use spec N.7's 3:4 portrait and give the frame a paper fill so it never reads as empty while loading.
- **Guards waiting to be switched on** (expected failures, each turns red when its fix lands): `content.js` forbidden labels and clichés (CONTENT-01/03), the `SYS-` label in `CaseStudyShowcase.astro` (UX-01, then WEB-01 deletes the file), contact CTA labels (CONTENT-02), the home hero label (CONTENT-01).
- **Ready to use:** `loadSiteSettings().business` with `replyWindowLine()` and `businessHoursLine()` (`src/config/business.js`) for the home closing line, Contact and the receipt email; the write-up fields `situation`, `decisions`, `scope`, `inOperationSince` on `WorkEntry` for the K.2 layout; S8 and D-1…D-4 in the scene registry (unapproved until Group 3, so their frames show captions only).
- **Dated SQL still to write with their copy:** home SEO title (SEO-01), nav CTA labels in `site_ctas` (CONTENT-02), write-up leads and case-study texts (CONTENT-05, CASE-01). Read rows first; neither D1 stores a Terms or Privacy page.
- **Local environment:** the old local D1 state was moved to `.wrangler/state-backup-2026-11-13` (kept). Pre-existing worker e2e failures on `main` (SEO slug editor, Lead CRM sources, two pickleball poster-share emulations) are environment issues to fix separately; they are not caused by Phase 14.
- **Production D1:** both CMS databases are in the account `db49…`; set `CLOUDFLARE_ACCOUNT_ID` for non-interactive Wrangler runs. Production and preview are at `0020_writeup_fields`.

### Owner decisions, 2026-11-13 (afternoon)

1. Home copy of spec I.4 approved as written. 2. Per-group preview sign-off waived: promote to production once preview checks pass. 3. Markets: the Philippines, the United States and Australia may be named (Q-07). 4. "You own the code, the data and the accounts" may be stated on About and in the Terms (Q-11). 5. Node redraw, S7, S8, D-1…D-4 and the tall crops approved after review on preview `/brand` (Q-13; Group 3 done). 6. New design rule: no underlined text anywhere; the current nav item is a background and text-colour change (overrides spec N.5's underlines; saved as a standing preference).

Owner fixes PR #63 (no underlines, filled nav state, approved art): CI green; `development` and `main` → `53688d7` (MERGED); preview showed Node in both home placements and the filled current-nav item.

### Group 5 — Pages I (log)

Commit `1fb45ee` (one commit for the group: the copy, components and tests are interdependent; deviation from one-commit-per-requirement).

| Req | Evidence |
|---|---|
| UX-02 | `Exhibit.astro`; `InquiryFlowExhibit.astro` (was `HeroPipelineVisualizer`): title "(illustration)", statuses "In this simulation…", visible pressed state, Node "receive" once per click and on first view; e2e: 0 `/api/` requests, pressed background changes, runs once |
| UX-01, CONTENT-01 | Home in N.10 order with the approved I.4 copy; `homeContent.test.js` rewritten (shape, founder once, markets PH/US/AU, ≤ 600 words); content forbidden-word guard switched on |
| WEB-03 | Portrait served fine on production (all variants 200); the founder strip now uses a 3:4 crop with a paper fill; e2e: image loads |
| WEB-01 (part) | Deleted `FailureDiagnosticConsole`, `ReliabilityBentoGrid`, `CaseStudyShowcase`, `PrincipalSpotlight` (no references left). `ProofStrip` remains (used on `/brand`), legacy components wait for BRAND-04 |
| CONTENT-02 | `src/config/ctas.js`; CTA guard switched on; header "Talk to us" / phone "Contact". `2026-11-13-home-work-content.sql` read first (both D1s: stored labels "Discuss Your System", diagrams empty, stale home titles), applied: preview 6 rows, production 6 rows, read back. Also applied to the local dev D1 |
| CONTENT-03 | Contact lead no longer claims "Nothing is auto-replied and closed"; status-label guard on all components |
| SEO-01 (home) | Static record and D1 row: "Business systems that don't quietly lose work · DevLab" (55 chars; the spec's 62-character title exceeds the 60 limit) |
| CASE-01 | Write-ups in K.2 order with their own D-x diagram (no S5 fallback); results and scope fall back to "not published" lines. **Owner input needed:** the situation, decisions and scope texts per write-up (admin → Projects → Write-up details); nothing was invented |
| CASE-02 | White mounts, scope line when written, one destination per entry |

Verification: lint 0 errors, typecheck 0, unit 3,018 passed / 1 skipped (no expected failures left), build OK, static e2e 242 passed / 1 skipped. Screenshots of `/` and a write-up at 390 and 1440 reviewed (tall S1 crop on phones).

Group 5 promotion: PR #64 CI green; preview (31/31 legacy URLs; new hero, CTA, price line, reply window, markets present; no "VERIFIED" or "live schematic"; write-up shows D-2 and K.2 sections); `main` → `2185c6a` (MERGED); `0 0`.

### Group 6 — Pages II (log, part 1)

Done: CONVERT-01 (Contact aside: S8, reply window and hours from settings, email alternative, channels only when set; e2e), CONVERT-02 (graphite success exhibit, Node hand-off once, I.4 text with the visitor's own address; contact-form e2e updated), CONVERT-03 (receipt email reply window and hours; 3 new unit tests, 417 worker tests green incl. persist-before-deliver guards), BUS-01, BUS-05 (price line on the offer card, audit page and FAQ), BUS-02 (About "What working with us looks like"; Terms ownership line, owner-approved wording only), CONTENT-06 (delivery steps only on About), WEB-02 (footer hiring link, Insights audit link, offers CTA, digest label), PROFILE-01 (byline), CASE-03 (`CreativeWork`; 3 schema tests), CONVERT-04 (existing click events cover it; measurement note in `docs/operations.md`).

Remaining in Group 6: UX-03 figure sizing on Solutions and line pages, UX-04 (Products screenshot with synthetic data, Maintenance on the brand shell — joins BRAND-04), CONTENT-04 (Profile third person, merged tags, bullet grammar), CONTENT-05 (≤ 30-word write-up leads; needs the CMS narrative rows).

Group 6 part 1 promotion: PR #65 green; preview verified (Contact aside, audit price, About section, no "auto-replied"); `main` → `9d28af1` (MERGED); production smoke: 31/31 legacy, health 200, `/brand` 404, hashed CSP, noindex admin, 0 personal-data hits, Contact shows the reply window.

### Group 7 — Shell consolidation (log)

Owner (2026-11-13, mid-work): "ensure all sections and paths cover the new brand"; "remove the Who you work with section".

| Req | Evidence |
|---|---|
| BRAND-04, WEB-05 | Offers, daily digest, crawler, maintenance rebuilt with brand components; three pickleball marketing pages in the brand shell with a product band. New e2e visits every sitemap URL plus unlisted pages: all on the brand shell, 0 underlined elements, 0 Google Fonts requests (pickleball app screens exempt) |
| WEB-01 | Deleted `Layout.astro`, `Navbar`, `Footer`, `PublicBackdrop`, `VectorField`, `SectionHeader`, `ProofStrip` (no references). Earlier: console, bento, spec cards, spotlight. `PrimaryButton`, `GlassCard`, `AnimatedIcon` stay (forms and UI states use them) |
| SEC-03 | Plus Jakarta Sans self-hosted for the app shell; Google hosts removed from `securityHeaders.ts`, `public/_headers`, `astro.config.mjs`; tests RED → GREEN |
| UX-04 (maintenance) | Brand shell, no fixed return time |
| Owner change | Home founder strip removed; markets moved to About facts and `areaServed` (BUS-04, schema test) |

Verification: lint 0 errors, typecheck 0, unit 3,006 passed / 1 skipped, build OK, static e2e all green (incl. the every-path guard), worker e2e for pickleball, public pages and forms 52/52.

Group 7 promotion: PR #66 green; preview: migrated pages on the brand shell, CSP without Google hosts, no home founder strip; `main` → `1b49cb4` (MERGED); production smoke: 31/31 legacy, health 200, `/brand` 404, `script-src` hash-only (the one `unsafe-inline` is `style-src`, by design), `font-src 'self' data:`, admin noindex, 0 personal-data hits, `/pickleball/new` 200.

### Group 6 (part 2), Group 8 and Group 9 (log)

| Req | Evidence |
|---|---|
| UX-03 | Line pages: scene first on phones (`PageHeader asideFirst`); proof section with the write-up screenshot on a mount. `/solutions` figures are already ~560 px at the 72 rem container; delivery steps removed earlier (CONTENT-06) |
| UX-04 | Products: real board screenshot from a local sample session with synthetic names (capture script not committed). 404 Node idle and Maintenance done earlier |
| UX-05 | Header "Talk to us" / phone "Contact", stone bar, full-height menu, Escape closes; existing menu e2e green |
| CONTENT-04 | Bio third person, bullets fixed, one merged tag list, every bullet available (first four shown, the rest under "More from this role" to keep the 900-word budget). `2026-11-13-profile-voice.sql`: 3 rows on preview and production, read back (0 old phrases) |
| CONTENT-05 | Leads 19–26 words in D1 (`2026-11-13-writeup-leads.sql`, 4 rows each) and the static fallback; long description under Technical notes |
| Identity cleanup | Found during CONTENT-04: production `profile_about`/`site_footer` still stored personal data. `2026-11-13-identity-cleanup.sql`: production 2 rows, preview 1, read back clean. Values not repeated anywhere |
| BUS-03 | Resolved by owner default Q-08: no Operations Care page until the offer is defined. The inquiry type stays; FAQ says "available as Operations Care" by arrangement |
| BUS-04 | `MARKETS` (PH, US, AU) on About and `areaServed` (Organization, Person, Service); schema test |
| CONVERT-05 | Sample audit PDF (142 KB, fictional clinic, synthetic) + thumbnail on the audit page |
| CASE-04 | Consent register (docs + config + 4 tests); nobody named |
| WEB-04 | Resolved by decision: `/haosweetitis/` is the owner's personal invitation; removing it needs the owner to host it elsewhere first (Q-09). It stays noindex; nothing deleted |
| SEO-01 | Home title live (Group 5); Products fallback matches its record |
| SEO-04 | Live check of name, email, city, founding date; Privacy/Terms city aligned; checklist + owner steps in `docs/operations.md` |
| MASCOT-05 | Preliminary search recorded in `docs/brand/node.md` (NODE.JS reg. 5731344 and other NODE marks in classes 9/42); decision: no filing |
| TEST-02/03 | Unit and e2e suites updated throughout (Node, home, CTA, contact aside, success exhibit, receipt, schema, consent, every-path brand guard) |
| TEST-04 | axe clean on the redesigned and migrated pages; accessibility tree of `/` and `/contact` reads as words (automated stand-in for the VoiceOver pass); screenshots at 390/820/1440 via the new preview capture job |
| TEST-05 | Covered by the worker e2e on a local D1 (persisted row, delivery attempt, failure recording, retry, receipt cap, lead magnet). A live synthetic inquiry on preview is not automatable: preview runs real Turnstile, and receipts must not go to outside addresses |
| OPS-03, OPS-04 | `deploy-preview.yml` gains `performance-budget` and `visual-capture` jobs; budget logic unit-tested; dry run on production: 96–99 / 100, LCP 1.97–2.49 s, CLS 0 |
| CMS-04 | ADR 0015; ADR 0014 marked superseded in part; `CURRENT_STATE.md`, `scenes.md`, `node.md`, `operations.md` updated |

Verification: lint 0 errors, typecheck 0, unit 3,016 passed / 1 skipped (207 files), build OK, static e2e 246 passed / 1 skipped, worker + admin-auth 323 passed / 2 failed / 1 skipped. The two failures (SEO slug editor, Lead CRM sources) need seeded local data, fail the same on `main`, are outside this spec and are not run in CI; left as local-environment follow-ups.

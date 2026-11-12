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
| 13 | Blueprint rebrand | in progress on `feat/blueprint-rebrand` (target v2.5.0) |

## Blockers (owner)

1. **Production D1 migrations `0018_editorial_fields` and `0019_job_runs`** (Phase 2, CMS-03). Additive columns only, already applied and verified on preview. The deployed code works without it, but the new project/article/SEO fields cannot be saved in production until it runs:
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

## Phase 13 — Blueprint rebrand (target 2.5.0)

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
| 13 | PR, preview, release 2.5.0, production smoke | pending | | |

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

**Open.** Filled in at steps 12–13.


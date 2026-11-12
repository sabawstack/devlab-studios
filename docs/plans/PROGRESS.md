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
| 4 | Brand foundation | done (PR #48, production at `1a2f663`; `/brand` 404 in production); **scene approval needed before Phases 5–6** |
| 5 | Pages I | not started |
| 6 | Pages II | not started |
| 7 | Routes + SEO | not started |
| 8 | Ops + editorial | done (PR #49, production at `4183fb1`) |
| 9 | Performance | OPS-01 done in code; SEC-07 → Phase 10; TEST-06 partial |
| 10 | Data-touching jobs | not started |
| 11 | Product Worker split | not started |
| 12 | Docs + release | not started |

## Blockers (owner)

1. **Production D1 migrations `0018_editorial_fields` and `0019_job_runs`** (Phase 2, CMS-03). Additive columns only, already applied and verified on preview. The deployed code works without it, but the new project/article/SEO fields cannot be saved in production until it runs:
   `CLOUDFLARE_API_TOKEN=<fresh token> npx wrangler d1 migrations apply devlab-studios-cms --remote` (applies both; both additive, both verified on preview). Until `0019` runs, job runs are only logged, not stored.
2. **Production project reconciliation** (Phase 2, CMS-02). Production reads were not permitted in this session, so production keeps `PROJECTS_STATIC_MERGE=true` (today's behaviour). Run `node scripts/cms/static-projects-missing-from-d1.mjs --env production`, seed any project that should stay, then set the var to `"false"` in `wrangler.jsonc`. Preview: 0 static projects missing (checked).
3. **Branch protection** (OPS-02): enable "Require status checks" with the `validate` check on `main` and `development` (GitHub settings; see docs/testing.md).
4. **Production identity data cleanup** (Phase 3, optional): `scripts/cms/updates/2026-11-12-business-identity.sql` (applied to preview). Not urgent: public pages already enforce the rules on the read path.
5. **Owner inputs for Phase 3 defaults**: legal operator name for privacy/terms (N5; operator wording used now), and the Facebook page / LinkedIn company URL for `sameAs` (only the existing LinkedIn profile and GitHub are listed). Also check `public/resume.pdf` for personal details you no longer want public; it was not changed.
6. **Scene approval (gate for Phases 5–6):** review S1–S6 at `<preview>/brand`, then set `artReady: true` per approved scene (docs/brand/scenes.md), or send replacement art. Also confirm the "Working Drawings" direction (N1, default approve).
7. **Uptime monitor (N8):** point a free-tier monitor at `/` and `/api/health` (docs/operations.md).
8. Observed, not changed: `/haosweetitis/` returns 404 on production and preview; only `/haosweetitis/index.html` loads. Share that URL, or ask for a route fix.

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

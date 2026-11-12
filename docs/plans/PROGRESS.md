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
| 1 | Guard rails | in progress |
| 2 | CMS correctness + content model | not started |
| 3 | Identity + personal data | not started |
| 4 | Brand foundation | not started |
| 5 | Pages I | not started |
| 6 | Pages II | not started |
| 7 | Routes + SEO | not started |
| 8 | Ops + editorial | not started |
| 9 | Performance | not started |
| 10 | Data-touching jobs | not started |
| 11 | Product Worker split | not started |
| 12 | Docs + release | not started |

## Blockers (owner)

_None yet._

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

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

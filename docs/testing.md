# Testing

Written as part of Phase 6 (deployment & hardening) of the Astro/CMS
rebuild program.

> **Out of date since this was written.** It said "there is no unit test
> suite — this project's test coverage is entirely Playwright end-to-end".
> That was true of the Phase 6 CMS work and is no longer true of the
> repository: `npm run test:unit` runs over a thousand vitest tests covering
> the inquiry pipeline, the Insights digest, the pickleball app and the Lead
> Intelligence Engine. Run both suites. See
> [docs/lead-engine/testing.md](lead-engine/testing.md) for that engine's
> coverage specifically.

The reasoning below still holds for the CMS surface, and is why the e2e
suite exists alongside the unit tests rather than being replaced by them:
almost all of the logic worth verifying there is the interaction between
Astro SSR/middleware, D1, and the admin UI, which unit tests in isolation
wouldn't catch (several real bugs during that phase were only found because
a full e2e flow was exercised — see `docs/content-model.md`'s history and
git log for specifics).

## What CI runs

`.github/workflows/ci.yml` runs on every pull request and push to `main` and
`development`, in this order, and fails the run on the first red step:

1. `npm run lint`
2. `npm run typecheck` (`astro check`)
3. `npm run test:unit` (vitest)
4. `npm run build`
5. `npx audit-ci --config audit-ci.json` (production dependencies)
6. `npx playwright test --project=static` (Chromium is cached by Playwright
   version; traces are uploaded as an artifact when it fails)

The `worker`, `admin-auth` and Safari projects are not in CI yet: run them
locally when a change touches the admin, the Worker or pickleball.

**Branch protection (a GitHub setting, not code).** In *Settings → Branches*,
protect `main` and `development` with "Require status checks to pass before
merging" and select the `validate` check. Production promotion is a
fast-forward push of `main` (see `docs/branch-workflow.md`), so the check is
also enforced by process: push the branch, open the PR, and promote only the
commit whose `validate` run is green.

### Fresh checkout

The static suite works from a clean clone with no `.wrangler/state`: its web
server applies the CMS migrations to the local D1, snapshots the state, and
starts `astro preview` with remote bindings off (Workers AI is never called
by a public page, and a remote proxy needs a Cloudflare login).

## Suite layout

`tests/e2e/*.spec.js`, run via `npx playwright test`. Two Playwright
projects, each against a different running server (`playwright.config.js`):

| Project | Spec files | Server | Why |
|---|---|---|---|
| `static` | `public-pages.spec.js`, `contact-form.spec.js`, `image-weight.spec.js` | `astro build && astro preview` | These pages don't need the real auth/D1 CRUD path — `astro preview` is faster to boot and closer to a CDN-cached static response |
| `worker` | `admin.spec.js`, `digest.spec.js`, `lead-crm.spec.js`, `pickleball/*.spec.js` | `wrangler dev --local` | Exercises the real ported auth (`adminAuth.js`), D1 CRUD, and `waitUntil` background delivery — `astro preview` doesn't run a real `workerd` runtime, so this is the only way to test those for real |

`desktop-safari` and `mobile-safari` re-run the `static` specs against those
devices. A new spec file matches NO project until it is added to a
`testMatch` in `playwright.config.js` — Playwright reports "No tests found"
rather than an error, so a spec can silently never run.

Run everything: `npx playwright test --workers=1`. `--workers=1` isn't
required for correctness (tests are written to be independent) but keeps
output readable and avoids two Playwright workers racing to
build/rebuild `dist/` at once (see the Windows gotcha below).

## Patterns used here (and why)

- **`toPass()` instead of `networkidle`** for anything with an on-page
  widget that polls in the background (Turnstile) — `waitForLoadState('networkidle')`
  never resolves against continuous background requests, a
  documented Playwright anti-pattern. Wrap the assertion in
  `expect(async () => {...}).toPass({ timeout })` instead and let it retry.
- **Fill-inside-the-retry-block, not before it** for any form that clears
  itself on success — otherwise a `toPass()` retry after an
  already-succeeded-but-unobserved submission re-clicks an empty form and
  fails on client-side validation, which reads as a flaky test but is
  actually a real ordering bug in the test itself.
- **`page.request`, not `page.goto`, for verifying redirects that get
  deleted afterward** — a 301 response is aggressively cached by the
  browser; `page.goto`-ing the same URL again after deleting the redirect
  can serve the cached 301 instead of hitting the server, making a correct
  delete look broken. `page.request` doesn't share the browser's HTTP
  cache.
- **Repeat flaky-looking failures before dismissing them** — every
  Playwright-surfaced bug in this project's history (duplicate form-field
  ids, a `.nullable()` Zod mismatch, the two patterns above, a dedup false
  positive in a test's own fixture data) was found by treating
  `--repeat-each=3`-style flakiness as a signal of a real bug, not noise.
  Confirm a fix is real the same way: repeat it 2-3 times before trusting
  a single green run.
- **Clean up test-generated D1 rows before committing**, but only for
  data that would otherwise misrepresent real content (leads, redirects,
  smoke-test projects) — version/audit-log rows are meant to accumulate
  and are left alone.

## Known environment quirk (Windows only)

`astro build` intermittently fails with `EPERM`/`Assertion failed` errors
from a stale Windows file handle on `dist/client`, usually left behind by
a `wrangler dev` or `astro preview` process that wasn't fully torn down.
Fix: kill lingering Node/workerd/esbuild processes holding the handle,
then rebuild —
```powershell
Get-CimInstance Win32_Process | Where-Object { $_.Name -match "node|esbuild|wrangler|workerd" } | Stop-Process -Force
```
This isn't a code bug; it doesn't happen in Cloudflare's own CI (Linux),
only in local Windows dev.

## What's deliberately not covered

- Turnstile's actual challenge/scoring logic — the widget uses
  Cloudflare's published testing sitekey (always passes) in every test
  environment; there's no way to exercise real bot-scoring from an
  automated test, and no reason to (that's Cloudflare's surface, not
  this app's).
- Cross-browser matrix — `devices['Desktop Chrome']` only. This is a
  portfolio/lead-gen site with a small, known audience; the cost of a
  full browser matrix isn't justified yet.
- Load/performance testing — see `docs/performance/PERFORMANCE_FINDINGS.md`
  for the one-time Lighthouse-driven investigation that preceded this
  rebuild; nothing ongoing.

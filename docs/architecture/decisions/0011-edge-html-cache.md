# 11. Edge HTML cache with generation-based invalidation

**Status:** Accepted (B2B rebuild, Phase 9, 2026-11-12)

## Context

Every public page rendered server-side on every request, with a chain of D1
reads for blocks, settings, SEO and maintenance mode. The audit measured 2–11 s
time to first byte; from the owner's location it was 0.45–0.97 s. Content
changes a few times a week, while pages are read far more often.

## Decision

Cache rendered HTML for the business pages and articles in the Workers Cache
API (`src/lib/cache/htmlCache.ts`, wired in `src/middleware.ts`).

- **Key:** host + path + meaningful query (tracking parameters dropped) +
  a *generation* number stored in `site_settings.html_cache_generation`.
- **Invalidation:** any successful admin write, and the daily digest, increment
  the generation. Old entries are simply never asked for again and expire on
  their TTL. No purge-by-tag API (an Enterprise feature) and no list of URLs to
  maintain.
- **Order:** after the admin gate and the maintenance check (memoised 60 s),
  before rendering; security headers are applied to hits as to misses.
- **Never cached:** admin, API, pickleball, the daily digest, `?preview=`
  requests, Authorization headers, and any response that is not a plain 200
  HTML page, sets a cookie or says no-store/private.
- **Controls:** `CACHE_HTML=false` turns it off; `HTML_CACHE_TTL_SECONDS`
  (default 300) bounds staleness for D1 edits made outside the admin.

## Consequences

- Repeat views are served from the colo cache (verified `HIT` on production
  from Singapore). The first view per colo per generation still renders.
- A CMS save shows on the next request anywhere; a direct D1 edit outside the
  admin shows within the TTL or after the next admin save.
- The generation read is one D1 row, memoised for 2 s per isolate.
- Per-request content (nonces, personalisation) cannot go into cached pages.
  This is why the CSP work (SEC-07) uses build-time hashes, not nonces.

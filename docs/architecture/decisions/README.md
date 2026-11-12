# Architecture Decision Records

Lightweight ADRs for the non-obvious calls made during the Astro/CMS
rebuild program — written in Phase 6, capturing decisions made from
Phase 1 onward while the reasoning was still fresh. Format: Context /
Decision / Consequences. Not every decision in the rebuild gets one, only
the ones a future reader (including a future session) would otherwise
have to re-derive from git archaeology.

1. [Rewrite rendering with Astro + @astrojs/cloudflare](./0001-astro-cloudflare-rendering.md)
2. [Schema-driven CMS with Zod, versioning, and an audit log](./0002-schema-driven-cms.md)
3. [Leads delivery: waitUntil + manual retry, not a Cloudflare Queue](./0003-leads-delivery-waituntil.md)
4. [Enforce security headers in middleware, not \_headers](./0004-security-headers-in-middleware.md)
5. [Preview environment via CLOUDFLARE_ENV at build time, not wrangler --env](./0005-preview-environment-build-time-env.md)
6. [Durable Objects for Pickleball session coordination](./0006-pickleball-durable-objects.md)
7. [Business inquiry pipeline](./0007-business-inquiry-pipeline.md)
8. [Insights daily digest: a cron in our own Worker entrypoint](./0008-insights-daily-digest.md)
9. [Renaming /services to /solutions, and why the redirect is in code](./0009-solutions-route-rename.md)
11. [Edge HTML cache with generation-based invalidation](./0011-edge-html-cache.md)
12. ["Working Drawings" brand system and a code-owned scene registry](./0012-brand-system-and-scene-registry.md)
13. [Code-composed marketing pages; the CMS keeps the content that changes](./0013-code-composed-marketing-pages.md)
14. ["Blueprint" palette, interactive home page and the Node mascot](./0014-blueprint-palette.md)

(0010 is reserved for the product-Worker split, written with that change.)

# 13. Code-composed marketing pages; the CMS keeps the content that changes

**Status:** Accepted (B2B rebuild, Phases 5–6, 2026-11-12)

## Context

Before 2.4.0 every business page was assembled from CMS blocks, each with a
bundled fallback. The redesign has strict rules per page (BR.9 word budgets,
one h1, a fixed section order answering the buyer's five questions, numbered
figures, the founder named once), and the copy changes rarely. Keeping it in
generic blocks meant four places to keep in sync by hand (repository, admin
form, page read path, static fallback), and nothing stopped an edit from
breaking the rules.

## Decision

- Home, Solutions (index and the four `/solutions/<line>` pages), About,
  Products, Contact and the Insights frame are **composed in code**. Their copy
  lives in `src/data/site/content.js`; tests enforce the budgets and rules.
- The CMS keeps what changes often or belongs to an editor: **Work narratives
  and projects** (which become `/work/<slug>` write-ups and the Home Work
  section), **articles**, **SEO records**, **navigation and footer**, the
  **founder profile** and the **legal pages**.
- The page builder still opens the code-composed pages, with a notice that
  saved changes are kept in history but not shown (`codeComposed` in
  `src/config/publicSurfaces.js`). Nothing is deleted from the database.

## Consequences

- A copy change on a marketing page is a pull request, reviewed and tested,
  shipped through `development` → preview → `main` like any change.
- The four-places sync problem disappears for those pages; it remains for the
  content types the CMS still owns.
- If an editor later needs to change marketing copy without a deploy, the next
  step is to move `content.js` fields into site settings one section at a time,
  keeping the same tests.

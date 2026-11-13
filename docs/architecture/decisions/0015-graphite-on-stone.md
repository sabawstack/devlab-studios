# 15. "Graphite on stone" brand system, Node as a character, CMS retained

**Status:** Accepted (2026-11-13, release 2.6.0). Supersedes the palette,
home-page and mascot parts of ADR 0014. The scene registry and its approval
gate (ADR 0012) and code-composed marketing pages (ADR 0013) stand.

## Context

The 2.5.0 "Blueprint" surface (navy canvas, grid, gradient buttons, mono
`§01` eyebrows, "VERIFIED" lines, a tabbed console, a visored robot shown 11
times) read as a generic AI-agency template and spoke to engineers before
buyers. The brand, UX and architecture re-audit
(`docs/plans/devlab-complete-b2b-brand-ux-architecture-spec.md`) set
Direction B, "Graphite on stone"; the owner approved it on 2026-11-13,
together with the home copy, the reply window, the price line, the markets,
the Node redraw and the new scenes.

## Decision

- **Tokens (spec N.1), measured not assumed.** Stone canvas `#f0eff3`, graphite
  ink, indigo links, white mounts; `.ink-panel` is the graphite exhibit
  surface (home hero band, exhibits) and swaps every role. Where a spec value
  failed WCAG AA it was adjusted and the reason kept in `brand.css`
  (captions, redline, button scrim; light green and amber inside exhibits).
- **The gradient in three places only:** the logo mark, primary buttons and the
  3 px hero rule. Owner rule (2026-11-13): no underlined text anywhere; links
  are indigo and semi-bold; the current nav item is a filled pill
  (`--selected`). Guard tests enforce both.
- **Labels are words.** Section labels use the text face in sentence case; the
  mono face is kept for figure captions, code and exhibits.
- **Node is a character with an approval gate.** Lamp head instead of a visor,
  four states, three tiers, single-run CSS motion, at most two per page;
  `src/config/node.js` records the owner's approval (character sheet:
  `docs/brand/node.md`).
- **One brand shell.** Every public route uses `BrandLayout`; the legacy layout
  is deleted; the pickleball marketing pages keep the product's look in a band
  inside the shell; the pickleball app screens keep their own shell. All fonts
  are self-hosted, so Google Fonts is out of the CSP.
- **Business facts are settings.** Reply window, hours, time zone, price line
  and optional chat or scheduling links live in `site_settings.site_business`
  with the owner's decisions as code defaults (`src/config/business.js`); CTA
  labels live in `src/config/ctas.js`; markets in `COMPANY`/`MARKETS`.
- **CMS retained** (spec M.2). One additive migration, `0020_writeup_fields`,
  adds the case-study fields; content changes ship as dated, guarded SQL with
  paired reverts in `scripts/cms/updates/`.

## Consequences

- Visual regressions are caught by guard tests (tokens, gradient roles,
  underlines, eyebrows, Node count, every path on the brand shell) and by the
  preview jobs: the Lighthouse budget (performance ≥ 90, LCP ≤ 2.5 s, CLS ≤ 0.1,
  accessibility 100) and the visual capture.
- New art or a new Node state ships only after owner approval on `/brand`.
- Write-up texts the owner has not written (situation, decisions, scope) render
  as "not published" lines; nothing is invented.

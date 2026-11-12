# 12. "Working Drawings" brand system and a code-owned scene registry

**Status:** Accepted (B2B rebuild, Phase 4, 2026-11-12); all six scenes approved by the owner on 2026-11-12

## Context

The audit found the public site's look (gradients, glass, floating icons, one
default typeface) reads as a generic template, and chose Direction 1, "Working
Drawings", for the redesign. The redesign needs illustrations that explain real
operational problems, and an editor must be able to place them without being
able to publish arbitrary art.

## Decision

- **Tokens, not one-off styles:** `src/styles/brand.css` defines the paper/ink
  roles (inverting on `.ink-panel`), fluid type steps, radii and motion;
  Tailwind exposes them as `dl-*`, `font-display/label/longform` and
  `text-step-*`. Fonts are self-hosted (OFL) with fallbacks whose metrics are
  read from the font files.
- **Additive rollout:** nothing changes until a page opts in with `.brand`, so
  each phase can ship to production without a half-converted look.
- **Scene registry:** `src/config/scenes.ts` lists the scenes (id, caption, alt,
  aspect, byte budget, `artReady`). Art is drawn in code from one symbol library
  (`Glyph.astro`, `SceneArt.astro`), theme-aware via `currentColor` and tokens.
  The CMS selects scenes by id only; it never uploads SVG.
- **Approval gate:** a scene renders on public pages only when `artReady` is
  true; `/brand` (preview and localhost only, noindex) shows everything for
  review.
- **Enforcement:** tests check token contrast on paper and ink, forbid gradients,
  blur, glass and Google Fonts in brand sources, and check scene byte budgets,
  aspect ratios and accessibility on `/brand`.

## Consequences

- New scenes are composed from the library, not commissioned per page.
- The legacy tokens stay until every public component is migrated (UX-04), then
  are removed.
- Scene art can be replaced by an illustrator's work without touching the CMS or
  the pages: same ids, new drawing.

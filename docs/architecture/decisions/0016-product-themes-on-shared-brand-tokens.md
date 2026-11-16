# 16. Product themes on shared brand tokens

**Status:** Accepted (2026-11-16, Phase 15 Group 5; preview only until the
owner promotes it). Builds on ADR 0015 ("Graphite on stone"); changes no
palette value.

## Context

ADR 0015 put the public site on one token set, but the tokens lived inside
`brand.css` together with the public components (buttons, nav, forms, Node),
and neither the Admin nor the Pickleball app imported it. Each product kept its
own colours: the Admin a near-black sidebar, radial gradients, a blurred header
and a gradient bar on the active nav item, with a `--brand-gradient` in
`index.css` that differed from the brand's; the Pickleball app a legacy
`#4500ff` button. A brand change could not reach either product, and importing
`brand.css` would have pulled the public components in with it.

## Decision

- **One token file.** `src/styles/brand-tokens.css` holds the self-hosted font
  faces, the `:root` palette, type scale, radii and motion, and the graphite
  remap `.ink-panel`. It has no element selectors and no components (guarded).
  The public site's `brand.css` imports it; the built public CSS was
  byte-identical before and after the split.
- **Each product owns a semantic layer, scoped to its document.**
  - Public site: `brand.css` (unchanged, `.brand` and `dl-*`).
  - Admin ("DevLab Workspace"): `src/styles/admin.css`, scoped to
    `.admin-page`, defines `--ws-*`. Stone canvas, white surfaces, a graphite
    sidebar from the exhibit tokens, indigo actions and links, one focus ring,
    status colours `ok`, `warning`, `danger` and `info`. The current nav item
    is a fill in the selected token. No gradient, blur or decorative
    background. Space Grotesk, with JetBrains Mono (`.ws-mono`) for labels and
    identifiers.
  - Pickleball app screens: `src/styles/pickleball-app.css`, imported only by
    `PickleballAppShell`, scoped to `.pb-app`, defines `--pb-*`. Amended
    2026-11-16 (owner): the app no longer keeps the navy and lime of its first
    look. It sits on the brand's graphite surface (the exhibit tokens), its
    play colour is a light indigo and team B a magenta, the light ends of the
    brand gradient, chosen so the two teams also differ in lightness (1.65:1).
    The values live in `src/config/pickleballPalette.js`, which Tailwind
    (`pb-*` utilities), the SVG art and the results poster read; the CSS layer
    mirrors them and `pickleballPalette.test.js` keeps the two equal. The
    non-game primary action uses the brand indigo, and the type face is Space
    Grotesk (the TV fit and long-name checks pass with it). The public
    Pickleball marketing pages sit in the brand shell on `.ink-panel`, with the
    brand's own primary and outline buttons and the brand form styling.
- **What is inherited and what is product-specific.** Inherited, never
  redefined: font families, the palette roles, radii, motion durations. Each
  product maps them to its own roles (`--ws-action: var(--link)`,
  `--pb-action: var(--link)`). Product-specific, owned by the layer: the
  Pickleball court colours (play, team B, the illustration court), and on dark
  surfaces the focus ring (the brand rule for graphite is a light ring;
  Pickleball uses its light play colour).
- **The gradient stays public.** It appears in three public places only (ADR
  0015). The product layers are tested to contain no gradient, blur or
  backdrop.
- **Amber in the Admin.** On the public site amber lives only inside exhibits.
  In the Admin it is the `warning` status colour, always beside a word.

## How a brand change propagates

Change a value in `brand-tokens.css`. The public site, the Admin and the
Pickleball app pick it up at the next build through their layers. Guards:
`brandTokens.test.ts` pins the palette and its contrast; `productThemes.test.ts`
pins every semantic mapping, checks the products' contrast against the real
token values, and keeps a ratchet (`themeRatchet.json`) on raw hex values and
legacy colour utilities in `src/admin-app` and `src/pickleball-open`, which may
only go down. Existing `slate-*` utilities are not mass-replaced; pages move to
the semantic tokens as they adopt the Admin primitives (ADMIN-06).

## Consequences

- Admin and Pickleball can share the brand without importing public components.
- A new raw colour in either app fails CI. Removing one requires lowering the ratchet.
- `index.css` still carries legacy variables, including its own
  `--brand-gradient`, for legacy surfaces. The token file is imported after it
  wherever both load, so the brand value wins.

# 14. "Blueprint" palette, interactive home page and the Node mascot

**Status:** Accepted (2026-11-12, release 2.5.0). Supersedes the palette, type
and motion rules of ADR 0012; the scene registry and its approval gate stand.

## Context

Release 2.4.0 put the business site on the light "Working Drawings" system
(paper, ink, a red accent; Bricolage Grotesque and Martian Mono). The owner
then chose a dark "Blueprint" direction: a navy canvas, the logo's own
gradient (magenta → violet → blue) as the accent, amber for status, a grotesk
for display and a mono for labels; a home page built from interactive
engineering components; and a mascot, Node, as a secondary figure. Tokens are
global, so the palette had to change site-wide while only the home page and
the shared shell were restructured.

## Decision

- **Keep the role names, remap the values.** `--paper`, `--ink`, `--ink-2/3`,
  `--rule`, `--redline` and `--ok` keep their names (about twenty components
  and thirteen pages use the `dl-*` classes built on them) and now alias the
  spec's source tokens (`--bg-studio`, `--surface-card`, `--brand-magenta`…).
  `.ink-panel` becomes the raised navy card surface rather than a light
  inversion.
- **Contrast decides which colours may carry text.** On `#050B14`: ink 18.9:1,
  ink-3 7.7:1, magenta 5.3:1, amber 6.2:1, form-error red ~7:1. Blue (2.5:1)
  and violet (~2.6:1) are strokes and gradient stops only. The gradient is
  never applied to text. Primary buttons put white text on the gradient under
  a navy scrim (rest ~6:1, hover ~4.6:1 at the magenta end).
- **One gradient, one place.** `--brand-gradient` is defined in `brand.css`
  only; everything else uses `var(--brand-gradient)`. `brandTokens.test.ts`
  fails on a raw `linear-gradient(` outside `brand.css`, on `background-clip:
  text`, and on raw hex colours in brand components and pages (the
  `theme-color` meta is the one exception).
- **Fonts stay self-hosted.** Space Grotesk (variable, 300–700) for display
  and text, JetBrains Mono (variable) for labels: 62 KB together, under the
  120 KB budget, with metric-matched fallbacks. Newsreader stays for long-form.
  No Google Fonts request.
- **Interactive pieces are Astro components with hoisted scripts**, not React
  islands: the home page ships no React runtime, Astro hashes the scripts into
  the CSP, and the server-rendered markup works with JavaScript off. The hero
  outage toggle is client-side only and never calls the network.
- **Node is a hook-free React component** (`NodeMascot.jsx`) so it renders
  statically from `.astro` and inside the inquiry form island. Ids come from
  an `id` prop or a page-wide counter, never `useId` (each Astro render is its
  own React root, where `useId` would repeat). Node is secondary: the router
  in the hero schematic, beside the failure vectors and the audit card, and
  in the form's success state; never the hero's subject.
- **Motion.** ADR 0012's "nothing loops" gives way in two places only: Node's
  visor pulse and the data packets in Node and the hero schematic. Both stop
  by themselves within five seconds (three 1.6 s pulses; SMIL packets end at
  4.8 s), which WCAG 2.2.2 requires for motion that starts on its own;
  `brandTokens.test.ts` fails on any `infinite` CSS animation or endless SVG
  animation in brand sources. Under `prefers-reduced-motion` they do not run
  at all (CSS for the pulse and packet visibility; `src/lib/motion.ts` pauses
  SVG animation, re-applied at the load event because the SVG timeline
  starts there).
- **Header glass.** The sticky header's `::before` carries `backdrop-filter:
  blur(12px)` over 80 % navy, behind an `@supports` guard with a solid 96 %
  fallback. It is the only blur on the site. The blur is never on the header
  element itself: that would make the header the containing block for the
  fixed mobile menu inside it and clip the menu to the bar (caught in review;
  guarded by the phone-menu test in `redesign.spec.js`).

## Consequences

- Every brand-layout page changed colour in one release; the scenes needed no
  change because they draw with `currentColor` and tokens.
- Stack names may appear on `/`, only as CMS-sourced tags on system cards;
  `/solutions` keeps the no-stack rule. The home word budget is 900.
- The footer location is "Lapu-Lapu City, Cebu, Philippines" (still
  city-level per PROF-02; the schema guard now forbids barangay and postal
  code instead of the city name).
- Rollback is a revert of the release's merge commit; the tokens live in
  `brand.css` and `tailwind.config.js`.

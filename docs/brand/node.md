# Node, the DevLab router — character sheet

Source of truth: `src/components/brand/NodeMascot.jsx` (drawing),
`src/config/node.js` (states, tiers, approval), `src/styles/brand.css`
(`.node-*`, colours and motion). Static exports per state and tier:
`public/branding/node/node-<state>-<tier>.svg`, regenerated with
`node scripts/brand/export-node.mjs`. Specification: spec G.3 and G.4
(`docs/plans/devlab-complete-b2b-brand-ux-architecture-spec.md`).

## Who Node is

The part of every DevLab system that receives, holds, checks and hands off,
and never drops. In copy: "Node, the DevLab router" on first mention. Never
"assistant", "bot" or "agent". Node never speaks, types, points at a button or
covers content.

## Locked features

| Feature | Value (figure tier, 96 × 112 grid) |
|---|---|
| Body | Three plates from the logo's `< \| >` traces: left and right angled (chevrons), centre straight |
| Plate ratio | Centre plate 16 units wide; each side plate 10 units (centre = 1.6 × side) |
| Head | One round signal lamp, 14 units across (r = 7), centred above the centre plate on a 7-unit neck |
| Terminals | Two shoulder rings (r = 3) above the side plates |
| Hands | Two terminal dots (r = 2.5) at the side plates' apexes |
| Stroke | 1.5 units, round caps and joins (the scene library's `Glyph.astro` weight); 1.75 at the mark tier |
| Fill | Paper; the lamp is the only filled accent |
| Not allowed | A visor, eyes, a mouth, eyebrows, tears, a thumbs-up, gradients, shadows, blur |

## States (the lamp)

| State | Lamp | Prop |
|---|---|---|
| `idle` | Unlit (ink outline) | — |
| `holding` | Magenta (`--redline`) | A slate in the right hand, three lines |
| `confirming` | Green (`--ok`) | The slate stamped with the `check` mark |
| `needs-person` | Amber inside exhibits (`.ink-panel`); solid ink on stone (amber is an exhibit-only colour) | A small `person` beside the left hand |

## Tiers

| Tier | Base size | Drawing |
|---|---|---|
| `mark` | 24 px | Centre plate, lamp, two side strokes. No terminals, hands or props. 16 px is not allowed |
| `figure` | 96 px | The full figure with its state prop |
| `scene` | 240 px | The figure plus the dashed hand-off path to a `person` |

## Motion (spec G.4)

One run per trigger, never on its own; CSS only (no SMIL, no animation library).

- **receive** (600 ms): a packet enters along the centre plate. Home exhibit: once when it scrolls into view (IntersectionObserver, threshold 0.5) and once per click of the simulation toggle.
- **hand-off** (800 ms, scene tier): the packet moves to the person, then the lamp turns green (200 ms). Inquiry success: once on mount.
- The packet is drawn at its final position, so reduced motion and no-JS show the last frame. Sequences pause while the tab is hidden (`pauseWhenHidden` in `src/lib/motion.ts`).

## Placements (at most two per page)

Home exhibit (one, as the router), the audit offer card (one, holding), the
inquiry success state (one, confirming), the 404 page (one, idle). Optional:
a write-up's hand-off step. Never in headers, footers, navigation, buttons,
forms before success, repeated cards, favicons or social avatars, and never
implying a live support agent. Guarded by `redesign.spec.js` (count per route).

## Accessibility

Decorative by default (`aria-hidden`). `role="img"` with the state's title
only where the state says something the text does not.

## Approval record

The redraw ships only after the owner approves it on `/brand` (preview only;
`/brand` is 404 in production). Until then every placement renders nothing,
the success state shows a check mark and the home schematic a plain
checkpoint. If the 24 px silhouette review fails, MASCOT-04 applies (the
router glyph without the lamp, idle and confirming only).

| Date | Reviewer | Decision |
|---|---|---|
| 2026-11-13 | — | Redraw built and on preview for review (MASCOT-01) |
| 2026-11-13 | Owner | Approved on preview `/brand` after review: all four states and three tiers, including the 24 px silhouette ("i think its good"). MASCOT-04 not needed |

## Ownership and IP

Drawn in code in this repository by DevLab Studios; no third-party or
AI-generated artwork. Trademark search and any filing follow spec G.5 and
owner decision Q-14 (search yes, filing no until reviewed; MASCOT-05).

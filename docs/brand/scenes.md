# Scenes and symbols ("Working Drawings")

> Palette: "Graphite on stone" (spec N.1, 2026-11-13). Scenes draw with
> `currentColor` and the role tokens, so they render ink on stone and invert
> inside `.ink-panel` (graphite exhibits). `--redline` (magenta) and `--violet`
> appear only inside figures; scenes use no gradients.

The illustrated scenes the public site shows, how they are drawn, and how one is
approved. Source: audit sections BR.5 (Direction 1), BR.8 and BR.10.

## Where things live

| What | File |
|---|---|
| Scene registry (ids, titles, captions, alt text, aspect, byte budget, approval) | `src/config/scenes.ts` |
| Symbol library (16 line symbols) | `src/components/brand/Glyph.astro` |
| Scene art (S1–S8) and project diagrams (D-1…D-4), wide and tall crops | `src/components/brand/SceneArt.astro` |
| Frame, caption and one-time draw-in | `src/components/brand/SceneFrame.astro` |
| Review page (preview and localhost only, never indexed) | `/brand` (`src/pages/brand.astro`) |
| Tests: byte budget, title/desc, aspect at 390/820/1440, reduced motion, axe | `tests/e2e/brand.spec.js` |

The CMS never uploads art. A `scene` block, a hero `visualId`, an article
`heroVisualId` or a project `systemDiagramId` names a registry id.

## Drawing rules

- 48-unit symbol grid; strokes 1.5 units (2 for emphasis), round caps and joins.
- Strokes are `currentColor` or a brand token, so a scene inverts on an ink panel.
  Fills use `--paper` / `--paper-2` only. No gradients, shadows or blur.
- `--redline` marks only the item that is wrong or must be noticed (S1's
  after-hours clock and ownership note, S3's failed webhook, S4's unclear case,
  S6's numbered marks). `--ok` marks only a verified or connected state.
- Text inside the art is limited to short mono labels; the HTML caption carries
  the meaning, so the art is readable without them.
- Dashed lines mean "not connected". Dashed strokes are not drawn in.
- Motion: each solid stroke draws in once, 600 ms, when the figure first scrolls
  into view; nothing loops; `prefers-reduced-motion` shows the finished drawing.

## Symbols

inbox, chat, phone, sheet, note, form, ledger, api, process, person (with name
badge), clock, warning, check, envelope, retry, stamp.

## Approval gate

Every scene is drawn in code and starts as **pending approval**
(`artReady: false`). Until a scene is approved, a public page that names it
shows only the frame and caption. To approve:

1. Review it on the preview site at `/brand`, at phone and desktop widths and on
   the ink panel. Ask: does it depict our clients' real tools and people? Is the
   redline on the right thing? Would a buyer understand it without the caption?
2. Set `artReady: true` for that scene in `src/config/scenes.ts`, with a CHANGELOG
   entry, and ship it through `development` → preview → `main`.

| Scene | Status |
|---|---|
| S1 Fragmented intake | approved 2026-11-12 |
| S2 The connected system | approved 2026-11-12 |
| S3 Persist before deliver | approved 2026-11-12 |
| S4 Handoff to a person | approved 2026-11-12 |
| S5 Build in layers | approved 2026-11-12 |
| S6 Workflow audit | approved 2026-11-12 |
| S7 Human-controlled automation | drawn 2026-11-13 (BRAND-05), pending approval |
| S8 The receipt | drawn 2026-11-13 (BRAND-05), pending approval |
| D-1 Memory Preview | drawn 2026-11-13 from the write-up, pending approval |
| D-2 Lead qualification | drawn 2026-11-13 from the write-up, pending approval |
| D-3 Buyer intelligence | drawn 2026-11-13 from the write-up, pending approval |
| D-4 Messenger agent | drawn 2026-11-13 from the write-up, pending approval (no person or ledger: the write-up describes neither, so none is drawn) |

Tall (4:5) phone crops have their own approval, `tallArtReady`. Drawn
2026-11-13 for S1, S2, S3, S6, S7, S8 and D-1…D-4 (S4 is square; S5's layers
already read at phone width), all pending. Until a crop is approved, phones
show the wide drawing at full width. `/brand` previews every crop.

## Known limits (for the reviewer)

- Project diagrams are drawn from each write-up's own description (the CMS
  narrative or `src/data/projectRecords.js`); a step a write-up does not state
  is not drawn. They are linear chains, so they share one renderer.
- AI-generated drafts are never committed as production art.

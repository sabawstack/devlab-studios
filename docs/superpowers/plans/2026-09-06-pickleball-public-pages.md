# Devlab Pickleball Public Pages Implementation Plan

> **Superseded (2026-10-12).** This describes the logged-in operator app, retired in 2.0.0 by Phase 5 of `docs/superpowers/specs/2026-10-11-pickleball-free-open-play-design.md`. Kept as history: the routes, tables and files it names no longer exist.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `/pickleball` from a 20-line centred block into a full marketing page with original artwork, add a `/pickleball/how-it-works` visual guide, and give a would-be operator a way to request access instead of hitting a dead end.

**Architecture:** Astro pages on the existing dark public shell (`Layout.astro`), with hand-authored SVG art as React `.jsx` components rendered **statically** — imported into `.astro` with no client directive, exactly as `src/pages/index.astro` already renders `src/components/ServiceGraphic.jsx`. Zero JavaScript ships for artwork. The only hydrated island is the request-access `ContactForm`, mounted `client:visible`.

**Tech Stack:** Astro 4 (`output: 'server'`, Cloudflare adapter), React 18 (static render), Tailwind, Playwright (`worker` project against `wrangler dev`).

**Spec:** `docs/superpowers/specs/2026-09-06-pickleball-pages-pairs-tournaments-design.md` — Part A (§1.1–§1.8). Parts B and C get their own plans.

## Global Constraints

- **Original artwork only.** Every SVG is hand-authored. No third-party vector asset, no traced reference image, nothing derived from any competitor's site. This is the rule already documented in `src/pickleball-app/components/illustrations/PickleballHeroGraphic.jsx`.
- **No competitor is named and no comparative claim is made** anywhere in page copy — no comparison table, no "unlike other tools".
- **Every claim must map to code that exists in this repository.**
- **Do not document fixed pairs or tournaments.** They are inert today (`SessionCoordinatorDO.assignCourt` refuses any non-`OPEN_PLAY` session). Spec §1.7.
- **Do not modify** `src/pages/api/pickleball/auth/google/callback.ts`. Its no-membership branch is rate-limited because it is an email-enumeration oracle. Task 7 is copy-only, in `LoginPage.jsx`. Spec §1.5.
- Art components take `{ className }`, return one `<svg viewBox>`, are `aria-hidden="true"`, and use `currentColor` plus at most `text-brand` for an accent — so one component works on both the dark shell and inside a `light-artifact` panel.
- Astro files import `.jsx` art with **no** `client:*` directive.
- Public-shell theming is automatic: `.public-shell` remaps `text-slate-900/800` to light text, and remaps them back to dark inside `light-artifact` / `bg-white*` containers. Use those classes rather than hand-picking colours.

---

## File Structure

**Create:**

| Path | Responsibility |
|---|---|
| `src/components/pickleball/art/CourtSceneArt.jsx` | Hero scene — two courts, players, waiting strip |
| `src/components/pickleball/art/QueueFlowArt.jsx` | Queue resolving onto a court |
| `src/components/pickleball/art/ScoreboardArt.jsx` | Live score, serving indicator |
| `src/components/pickleball/art/StandingsArt.jsx` | Ranked list with bars |
| `src/components/pickleball/art/ShareLiveArt.jsx` | Phone, TV, QR |
| `src/components/pickleball/art/Step1CreateArt.jsx` … `Step8CompleteArt.jsx` | One per guide step |
| `src/pages/pickleball/how-it-works.astro` | The guide page |
| `tests/e2e/pickleball/pickleball-public-pages.spec.js` | E2E for both pages |

**Modify:**

| Path | Change |
|---|---|
| `src/pages/pickleball/index.astro` | Full rewrite (currently 20 lines) |
| `src/pickleball-app/pages/LoginPage.jsx:4-10` | `no_access` gains a request-access link |
| `src/pages/services.astro:200-215` | Secondary "See how it works" button |

### A note on artwork in this plan

For every file with logic or integration risk — pages, form plumbing, tests, the LoginPage and services edits — this plan contains the complete code.

For the SVG art it contains the **exact shared template**, one **fully-written worked example** (Task 1), and a per-component composition spec (viewBox, elements, stroke weights). SVG path geometry is drawn, not derived; transcribing thirteen sets of invented path coordinates into a plan would be false precision. The template plus composition spec is the real contract, and Task 2's checklist enforces it.

---

## Task 1: Landing page shell, hero, and the art template

**Files:**
- Create: `src/components/pickleball/art/CourtSceneArt.jsx`
- Create: `tests/e2e/pickleball/pickleball-public-pages.spec.js`
- Modify: `src/pages/pickleball/index.astro` (full rewrite)

**Interfaces:**
- Consumes: `src/layouts/Layout.astro` (prop `title: string`), `src/pickleball-app/pickleball.css`
- Produces: `CourtSceneArt({ className }: { className?: string })` — the art template every later art component copies. Landing page section ids `#request-access` (Task 6) anchor here.

- [ ] **Step 1: Write the failing test**

Create `tests/e2e/pickleball/pickleball-public-pages.spec.js`:

```javascript
import { test, expect } from '@playwright/test'

// The public pickleball pages are anonymous — no login helper needed. They
// are served by the worker (astro `output: 'server'`), so this file matches
// the `worker` Playwright project via the pickleball/ path convention.

test.describe('Pickleball public pages', () => {
  test('the landing page renders a hero with both calls to action', async ({ page }) => {
    const response = await page.goto('/pickleball')
    expect(response.status()).toBe(200)

    await expect(page.getByRole('heading', { level: 1 })).toContainText('Devlab Pickleball')
    await expect(page.getByRole('link', { name: 'Operator sign in' })).toHaveAttribute('href', '/pickleball/app')
    await expect(page.getByRole('link', { name: 'See how it works' })).toHaveAttribute('href', '/pickleball/how-it-works')
  })

  test('every decorative illustration is hidden from assistive technology', async ({ page }) => {
    await page.goto('/pickleball')

    const svgs = page.locator('main svg')
    const count = await svgs.count()
    expect(count).toBeGreaterThan(0)
    for (let index = 0; index < count; index += 1) {
      await expect(svgs.nth(index)).toHaveAttribute('aria-hidden', 'true')
    }
  })

  test('the landing page ships no artwork JavaScript', async ({ page }) => {
    // Art is rendered statically (no client: directive), so the hero must be
    // in the server HTML rather than appearing after hydration.
    const response = await page.request.get('/pickleball')
    const html = await response.text()
    expect(html).toContain('Operator sign in')
    expect(html).toContain('<svg')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test --project=worker --workers=1 tests/e2e/pickleball/pickleball-public-pages.spec.js`

Expected: FAIL — the "See how it works" link does not exist, and `main svg` finds zero elements.

Note: if the whole run dies with `ECONNREFUSED ::1:8787`, that is a known local `wrangler dev` proxy crash under parallel load, not your change. Always pass `--workers=1` for this file.

- [ ] **Step 3: Write CourtSceneArt — the template every other art component follows**

Create `src/components/pickleball/art/CourtSceneArt.jsx`:

```jsx
// Original, hand-authored SVG — not copied from any reference image and not
// derived from any third-party vector asset, matching the rule set by
// src/pickleball-app/components/illustrations/PickleballHeroGraphic.jsx.
//
// Drawn in `currentColor` with one optional accent, so the same component
// reads correctly on the dark public shell AND inside a `light-artifact`
// panel with no variant. Purely decorative: aria-hidden, no embedded text.
//
// THIS FILE IS THE TEMPLATE for every component in this directory. Copy its
// shape: one default export, `{ className }`, one <svg viewBox>, aria-hidden.

/**
 * @param {Object} props
 * @param {string} [props.className]
 */
export default function CourtSceneArt({ className = '' }) {
  return (
    <svg viewBox="0 0 320 200" fill="none" className={className} aria-hidden="true">
      {/* Two courts in perspective: outer bounds, net, kitchen line. */}
      <path d="M18 150 60 54h116l-14 96Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M30 118h124M46 82h104" stroke="currentColor" strokeWidth="1.5" opacity="0.55" />
      <path d="M160 150 174 54h116l42 96Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" opacity="0.45" />

      {/* Four players on the near court. */}
      <circle cx="64" cy="132" r="6" fill="currentColor" />
      <circle cx="126" cy="132" r="6" fill="currentColor" />
      <circle cx="78" cy="70" r="5" fill="currentColor" opacity="0.6" />
      <circle cx="140" cy="70" r="5" fill="currentColor" opacity="0.6" />

      {/* Ball in flight, with the perforations that make it read as a pickleball. */}
      <circle cx="196" cy="40" r="12" stroke="currentColor" strokeWidth="2" className="text-brand" />
      <circle cx="196" cy="33" r="1.4" fill="currentColor" />
      <circle cx="190" cy="40" r="1.4" fill="currentColor" />
      <circle cx="202" cy="40" r="1.4" fill="currentColor" />

      {/* Waiting strip — the queue, the thing this product is actually about. */}
      <rect x="18" y="168" width="284" height="20" rx="10" stroke="currentColor" strokeWidth="1.5" opacity="0.45" />
      <circle cx="38" cy="178" r="5" fill="currentColor" />
      <circle cx="56" cy="178" r="5" fill="currentColor" opacity="0.75" />
      <circle cx="74" cy="178" r="5" fill="currentColor" opacity="0.5" />
      <circle cx="92" cy="178" r="5" fill="currentColor" opacity="0.3" />
    </svg>
  )
}
```

- [ ] **Step 4: Rewrite the landing page hero**

Replace the entire contents of `src/pages/pickleball/index.astro`:

```astro
---
import Layout from '../../layouts/Layout.astro'
import CourtSceneArt from '../../components/pickleball/art/CourtSceneArt.jsx'
import '../../pickleball-app/pickleball.css'
---

<Layout title="Devlab Pickleball">
  <main class="mx-auto max-w-6xl px-6 py-16 sm:py-20">
    <section class="grid items-center gap-10 lg:grid-cols-[1.05fr_0.95fr]">
      <div>
        <p class="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Session management</p>
        <h1 class="mt-2 text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl">Devlab Pickleball</h1>
        <div class="pb-rule mt-3 h-[3px] w-11 rounded-full"></div>
        <p class="mt-5 max-w-xl text-lg leading-relaxed text-slate-600">
          Run open play from one screen — check-in, queueing, court assignment, live scoring,
          and a scoreboard your players can watch from their own phones.
        </p>
        <div class="mt-8 flex flex-wrap gap-3">
          <a href="/pickleball/app" class="pb-btn-primary inline-flex rounded-lg px-5 py-3 text-sm">
            Operator sign in
          </a>
          <a
            href="/pickleball/how-it-works"
            class="inline-flex items-center rounded-lg bg-white/[0.92] px-5 py-3 text-sm font-semibold text-brand-ink ring-1 ring-slate-200 transition hover:ring-brand/35"
          >
            See how it works
          </a>
        </div>
      </div>
      <div class="light-artifact rounded-[1.75rem] bg-gradient-to-br from-[#fff9ff] via-[#fbf9ff] to-[#f2efff] p-6 shadow-[0_18px_38px_rgba(48,28,114,0.12)] sm:p-8">
        <CourtSceneArt className="h-auto w-full text-brand-ink" />
      </div>
    </section>
  </main>
</Layout>
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx playwright test --project=worker --workers=1 tests/e2e/pickleball/pickleball-public-pages.spec.js`

Expected: the hero and aria-hidden tests PASS. The "See how it works" link resolves to a 404 page for now — that is fine, the test only asserts the `href`; Task 4 creates the page.

- [ ] **Step 6: Commit**

```bash
git add src/components/pickleball/art/CourtSceneArt.jsx src/pages/pickleball/index.astro tests/e2e/pickleball/pickleball-public-pages.spec.js
git commit -m "feat: give the pickleball landing page a real hero with original court artwork"
```

---

## Task 2: Feature grid and its four art components

**Files:**
- Create: `src/components/pickleball/art/QueueFlowArt.jsx`, `ScoreboardArt.jsx`, `StandingsArt.jsx`, `ShareLiveArt.jsx`
- Modify: `src/pages/pickleball/index.astro`, `tests/e2e/pickleball/pickleball-public-pages.spec.js`

**Interfaces:**
- Consumes: the art template from Task 1.
- Produces: four components with the identical signature `({ className }: { className?: string })`.

**Composition spec.** Each uses `viewBox="0 0 160 120"`, `stroke-width` 2 for primary shapes and 1.5 for secondary, `currentColor` throughout, `aria-hidden="true"`, and copies Task 1's file header comment adjusted for its subject. Keep each under 20 drawn elements.

| Component | Draws |
|---|---|
| `QueueFlowArt` | A vertical stack of four rounded "player" pills on the left, an arrow, and a court rectangle on the right holding four dots |
| `ScoreboardArt` | Two large score panels side by side, a serving dot on the left panel, and a small "0-0-2" style three-segment bar beneath |
| `StandingsArt` | Five rows: rank numeral, name bar, and a horizontal value bar of decreasing length; top row accented `text-brand` |
| `ShareLiveArt` | A phone outline and a wider TV outline side by side, both showing a mini score, plus a QR square of nine cells |

- [ ] **Step 1: Write the failing test**

Add to `tests/e2e/pickleball/pickleball-public-pages.spec.js`, inside the existing `describe`:

```javascript
  test('the landing page explains the product with a four-card feature grid', async ({ page }) => {
    await page.goto('/pickleball')

    const grid = page.getByTestId('pb-feature-grid')
    await expect(grid).toBeVisible()
    await expect(grid.locator('> article')).toHaveCount(4)

    for (const heading of ['Fair queueing', 'Rally scoring', 'Live standings', 'Share it live']) {
      await expect(grid.getByRole('heading', { name: heading })).toBeVisible()
    }
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test --project=worker --workers=1 tests/e2e/pickleball/pickleball-public-pages.spec.js -g "feature grid"`

Expected: FAIL — `pb-feature-grid` does not exist.

- [ ] **Step 3: Write the four art components**

Create each of the four files following Task 1's template exactly and the composition table above. Example — `src/components/pickleball/art/QueueFlowArt.jsx`:

```jsx
// Original, hand-authored SVG — see CourtSceneArt.jsx for the shared rules
// this file follows (currentColor, aria-hidden, no third-party asset).
// Subject: the waiting queue resolving onto a court.

/**
 * @param {Object} props
 * @param {string} [props.className]
 */
export default function QueueFlowArt({ className = '' }) {
  return (
    <svg viewBox="0 0 160 120" fill="none" className={className} aria-hidden="true">
      {/* Four queued players, front of the queue at the top. */}
      <rect x="8" y="14" width="44" height="16" rx="8" stroke="currentColor" strokeWidth="2" />
      <rect x="8" y="38" width="44" height="16" rx="8" stroke="currentColor" strokeWidth="1.5" opacity="0.7" />
      <rect x="8" y="62" width="44" height="16" rx="8" stroke="currentColor" strokeWidth="1.5" opacity="0.5" />
      <rect x="8" y="86" width="44" height="16" rx="8" stroke="currentColor" strokeWidth="1.5" opacity="0.3" />

      {/* Selection arrow. */}
      <path d="M62 22h26m0 0-7-6m7 6-7 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-brand" />

      {/* The court they land on. */}
      <rect x="96" y="30" width="56" height="60" rx="4" stroke="currentColor" strokeWidth="2" />
      <path d="M96 60h56" stroke="currentColor" strokeWidth="1.5" opacity="0.55" />
      <circle cx="112" cy="46" r="4.5" fill="currentColor" />
      <circle cx="136" cy="46" r="4.5" fill="currentColor" />
      <circle cx="112" cy="74" r="4.5" fill="currentColor" opacity="0.6" />
      <circle cx="136" cy="74" r="4.5" fill="currentColor" opacity="0.6" />
    </svg>
  )
}
```

Write `ScoreboardArt.jsx`, `StandingsArt.jsx` and `ShareLiveArt.jsx` to the same template and their rows in the composition table.

- [ ] **Step 4: Add the feature grid to the landing page**

Add the four imports to the frontmatter of `src/pages/pickleball/index.astro`:

```astro
import QueueFlowArt from '../../components/pickleball/art/QueueFlowArt.jsx'
import ScoreboardArt from '../../components/pickleball/art/ScoreboardArt.jsx'
import StandingsArt from '../../components/pickleball/art/StandingsArt.jsx'
import ShareLiveArt from '../../components/pickleball/art/ShareLiveArt.jsx'
```

Add below the frontmatter's imports, still in the fence:

```astro
const features = [
  { Art: QueueFlowArt, title: 'Fair queueing', body: 'Fewest games played first, longest wait next. The app picks the match and tells you why it picked it.' },
  { Art: ScoreboardArt, title: 'Rally scoring', body: 'One tap per rally. Side-out, server number and the official score call are all derived, never typed in.' },
  { Art: StandingsArt, title: 'Live standings', body: 'Every checked-in player ranked from the first minute, filling in as games finish.' },
  { Art: ShareLiveArt, title: 'Share it live', body: 'A QR code puts the live scoreboard on every player’s phone, and on the TV in the hall.' },
]
```

Then add this section inside `<main>`, after the hero section:

```astro
    <section class="mt-20">
      <h2 class="text-3xl font-semibold text-slate-900">Built for the person running the session</h2>
      <div class="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4" data-testid="pb-feature-grid">
        {features.map(({ Art, title, body }) => (
          <article class="light-artifact rounded-2xl bg-white/[0.92] p-5 shadow-[0_12px_28px_rgba(60,28,120,0.08)] ring-1 ring-slate-200">
            <Art className="h-24 w-full text-brand-ink" />
            <h3 class="mt-4 font-semibold text-brand-ink">{title}</h3>
            <p class="mt-2 text-sm leading-relaxed text-slate-600">{body}</p>
          </article>
        ))}
      </div>
    </section>
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx playwright test --project=worker --workers=1 tests/e2e/pickleball/pickleball-public-pages.spec.js`

Expected: PASS, including the existing aria-hidden test now covering five illustrations.

- [ ] **Step 6: Commit**

```bash
git add src/components/pickleball/art src/pages/pickleball/index.astro tests/e2e/pickleball/pickleball-public-pages.spec.js
git commit -m "feat: add the pickleball feature grid with four original illustrations"
```

---

## Task 3: Differentiators, flow teaser, players section, FAQ, closing CTA

**Files:**
- Modify: `src/pages/pickleball/index.astro`, `tests/e2e/pickleball/pickleball-public-pages.spec.js`

**Interfaces:**
- Consumes: art components from Tasks 1–2 (re-used at larger size).
- Produces: the finished landing page apart from the request-access section (Task 6).

Every claim below maps to real code. Do not add claims beyond these three without checking the source first.

- [ ] **Step 1: Write the failing test**

```javascript
  test('the landing page backs its claims with sections a reader can scan', async ({ page }) => {
    await page.goto('/pickleball')

    await expect(page.getByRole('heading', { name: 'Every match-up explains itself' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Nothing is ever lost' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Standings from the first minute' })).toBeVisible()
    await expect(page.getByTestId('pb-faq').locator('> details')).toHaveCount(5)
  })

  test('the landing page names no competitor', async ({ page }) => {
    const html = (await (await page.request.get('/pickleball')).text()).toLowerCase()
    expect(html).not.toContain('pickleq')
    expect(html).not.toContain('unlike other')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test --project=worker --workers=1 tests/e2e/pickleball/pickleball-public-pages.spec.js -g "backs its claims"`

Expected: FAIL — no such headings.

- [ ] **Step 3: Add the differentiator blocks**

Add to the frontmatter fence of `src/pages/pickleball/index.astro`:

```astro
const differentiators = [
  {
    Art: QueueFlowArt,
    title: 'Every match-up explains itself',
    body: 'The queue picks on fewest games played, then longest wait, and avoids putting the same partners together twice in a row. Each recommendation carries the reasons it was chosen, so you can answer “why them?” without guessing.',
  },
  {
    Art: ScoreboardArt,
    title: 'Nothing is ever lost',
    body: 'Undo the last rally at any point. Reopen and correct a finished game long after it ended — statistics are recomputed from scratch rather than layered on top of the old ones, and every change lands in the audit log.',
  },
  {
    Art: StandingsArt,
    title: 'Standings from the first minute',
    body: 'The board is populated the moment players check in. Everyone is listed with their record and point differential, ranked as soon as they have enough games to qualify.',
  },
]

const faqs = [
  { q: 'Do players need an account?', a: 'No. Players never sign in — they scan a QR code to watch the live scoreboard. Only the person running the session signs in.' },
  { q: 'How many courts can I run?', a: 'As many as your venue has. Courts are set up once per venue and every session picks them up automatically.' },
  { q: 'What scoring does it use?', a: 'Side-out scoring driven by a ruleset you control — target score and win-by are configurable, not hardcoded to 11.' },
  { q: 'What happens if I make a scoring mistake?', a: 'Undo the last rally straight away, or reopen and correct the game after it has finished. Statistics are recomputed, never patched.' },
  { q: 'Is OPI an official rating?', a: 'No. OPI is a Devlab-original performance index, not a USA Pickleball rating, DUPR, UTR-P or Elo system.' },
]
```

Add these sections inside `<main>` after the feature grid:

```astro
    <section class="mt-20 space-y-6">
      {differentiators.map(({ Art, title, body }, index) => (
        <article class="light-artifact overflow-hidden rounded-[1.75rem] bg-white/[0.92] shadow-[0_18px_38px_rgba(48,28,114,0.10)] ring-1 ring-slate-200">
          <div class="grid items-center gap-0 lg:grid-cols-2">
            <div class={['flex justify-center p-8 lg:p-10', index % 2 === 0 ? 'lg:order-1' : 'lg:order-2'].join(' ')}>
              <Art className="h-40 w-full max-w-sm text-brand-ink" />
            </div>
            <div class={['p-8 lg:p-10', index % 2 === 0 ? 'lg:order-2' : 'lg:order-1'].join(' ')}>
              <h2 class="text-2xl font-semibold text-brand-ink">{title}</h2>
              <p class="mt-3 leading-relaxed text-slate-600">{body}</p>
            </div>
          </div>
        </article>
      ))}
    </section>

    <section class="mt-20">
      <h2 class="text-3xl font-semibold text-slate-900">A session in three moves</h2>
      <div class="mt-8 grid gap-5 sm:grid-cols-3">
        <article class="rounded-2xl bg-white/[0.92] p-5 ring-1 ring-slate-200">
          <p class="pb-score text-2xl text-brand">1</p>
          <h3 class="mt-2 font-semibold text-brand-ink">Open for check-in</h3>
          <p class="mt-2 text-sm text-slate-600">Create the session, pick your courts and ruleset, and let players check in.</p>
        </article>
        <article class="rounded-2xl bg-white/[0.92] p-5 ring-1 ring-slate-200">
          <p class="pb-score text-2xl text-brand">2</p>
          <h3 class="mt-2 font-semibold text-brand-ink">Assign and score</h3>
          <p class="mt-2 text-sm text-slate-600">The app proposes the next four players. Confirm, then tap who won each rally.</p>
        </article>
        <article class="rounded-2xl bg-white/[0.92] p-5 ring-1 ring-slate-200">
          <p class="pb-score text-2xl text-brand">3</p>
          <h3 class="mt-2 font-semibold text-brand-ink">Finish and repeat</h3>
          <p class="mt-2 text-sm text-slate-600">Finishing a game frees the court, updates the standings, and requeues the players.</p>
        </article>
      </div>
      <p class="mt-6">
        <a href="/pickleball/how-it-works" class="text-sm font-semibold text-brand underline underline-offset-4">
          Read the full walkthrough
        </a>
      </p>
    </section>

    <section class="mt-20">
      <h2 class="text-3xl font-semibold text-slate-900">What your players see</h2>
      <div class="mt-8 grid gap-5 sm:grid-cols-3">
        <article class="rounded-2xl bg-white/[0.92] p-5 ring-1 ring-slate-200">
          <h3 class="font-semibold text-brand-ink">A QR code</h3>
          <p class="mt-2 text-sm text-slate-600">Share one code. No app to install and no account to create.</p>
        </article>
        <article class="rounded-2xl bg-white/[0.92] p-5 ring-1 ring-slate-200">
          <h3 class="font-semibold text-brand-ink">The live view</h3>
          <p class="mt-2 text-sm text-slate-600">Scores update on their phones as the rallies happen.</p>
        </article>
        <article class="rounded-2xl bg-white/[0.92] p-5 ring-1 ring-slate-200">
          <h3 class="font-semibold text-brand-ink">A TV display</h3>
          <p class="mt-2 text-sm text-slate-600">A full-screen scoreboard for a screen in the hall.</p>
        </article>
      </div>
    </section>

    <section class="mt-20">
      <h2 class="text-3xl font-semibold text-slate-900">Questions</h2>
      <div class="mt-8 grid gap-3 lg:grid-cols-2" data-testid="pb-faq">
        {faqs.map(({ q, a }) => (
          <details class="rounded-2xl bg-white/[0.92] p-5 ring-1 ring-slate-200">
            <summary class="cursor-pointer font-semibold text-brand-ink">{q}</summary>
            <p class="mt-2 text-sm leading-relaxed text-slate-600">{a}</p>
          </details>
        ))}
      </div>
    </section>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx playwright test --project=worker --workers=1 tests/e2e/pickleball/pickleball-public-pages.spec.js`

Expected: PASS, all landing-page tests.

- [ ] **Step 5: Commit**

```bash
git add src/pages/pickleball/index.astro tests/e2e/pickleball/pickleball-public-pages.spec.js
git commit -m "feat: explain the pickleball product on the landing page with FAQ and flow teaser"
```

---

## Task 4: The guide page and its eight step illustrations

**Files:**
- Create: `src/components/pickleball/art/Step1CreateArt.jsx` … `Step8CompleteArt.jsx`
- Create: `src/pages/pickleball/how-it-works.astro`
- Modify: `tests/e2e/pickleball/pickleball-public-pages.spec.js`

**Interfaces:**
- Consumes: the art template from Task 1.
- Produces: `/pickleball/how-it-works`, the target of the "See how it works" links added in Tasks 1 and 8.

**Composition spec.** All eight use `viewBox="0 0 120 90"`, the Task 1 template, and at most 12 drawn elements each — these sit at ~96px so detail is wasted.

| Component | Draws |
|---|---|
| `Step1CreateArt` | A form card with three field bars and a court icon |
| `Step2OpenArt` | A door-like panel with a status pill and a tick |
| `Step3CheckInArt` | Three player pills, two ticked |
| `Step4QueueArt` | An ordered stack of four pills with a numeral column |
| `Step5AssignArt` | Two pills flowing into a court rectangle holding four dots |
| `Step6ScoreArt` | Two score panels and two large tap targets beneath |
| `Step7FinishArt` | A finished scoreline with a trophy-ish chevron and a ranked list of three |
| `Step8CompleteArt` | A court going quiet — dashed outline — with a summary card |

- [ ] **Step 1: Write the failing test**

```javascript
  test('the guide page walks through all eight steps', async ({ page }) => {
    const response = await page.goto('/pickleball/how-it-works')
    expect(response.status()).toBe(200)

    await expect(page.getByRole('heading', { level: 1 })).toContainText('How Devlab Pickleball works')
    await expect(page.getByTestId('pb-guide-steps').locator('> article')).toHaveCount(8)

    for (const step of [
      'Create a session',
      'Open it for check-in',
      'Check players in',
      'The queue fills',
      'Assign a court',
      'Score the game',
      'Finish the game',
      'Complete the session',
    ]) {
      await expect(page.getByRole('heading', { name: step })).toBeVisible()
    }
  })

  test('the guide does not document features that do not work yet', async ({ page }) => {
    // Fixed pairs and tournaments are inert today — assignCourt refuses any
    // session whose type is not OPEN_PLAY. Documenting them would be a lie.
    const html = (await (await page.request.get('/pickleball/how-it-works')).text()).toLowerCase()
    expect(html).not.toContain('fixed pair')
    expect(html).not.toContain('tournament')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test --project=worker --workers=1 tests/e2e/pickleball/pickleball-public-pages.spec.js -g "eight steps"`

Expected: FAIL — `/pickleball/how-it-works` returns 404.

- [ ] **Step 3: Write the eight art components**

Create each following Task 1's template and the composition table above.

- [ ] **Step 4: Write the guide page**

Create `src/pages/pickleball/how-it-works.astro`:

```astro
---
import Layout from '../../layouts/Layout.astro'
import Step1CreateArt from '../../components/pickleball/art/Step1CreateArt.jsx'
import Step2OpenArt from '../../components/pickleball/art/Step2OpenArt.jsx'
import Step3CheckInArt from '../../components/pickleball/art/Step3CheckInArt.jsx'
import Step4QueueArt from '../../components/pickleball/art/Step4QueueArt.jsx'
import Step5AssignArt from '../../components/pickleball/art/Step5AssignArt.jsx'
import Step6ScoreArt from '../../components/pickleball/art/Step6ScoreArt.jsx'
import Step7FinishArt from '../../components/pickleball/art/Step7FinishArt.jsx'
import Step8CompleteArt from '../../components/pickleball/art/Step8CompleteArt.jsx'
import '../../pickleball-app/pickleball.css'

const steps = [
  {
    Art: Step1CreateArt,
    title: 'Create a session',
    body: 'Pick the venue, name the session, choose a scoring ruleset and set the scheduled times. Every court at that venue is added to the session automatically and starts out available.',
    sees: ['A new session in Draft', 'One row per venue court', 'The ruleset you chose'],
  },
  {
    Art: Step2OpenArt,
    title: 'Open it for check-in',
    body: 'Move the session from Draft to Open for check-in. Players can now be registered and checked in, but nothing can be assigned to a court until you take it live.',
    sees: ['Status moves to Open for check-in', 'The check-in page becomes useful'],
  },
  {
    Art: Step3CheckInArt,
    title: 'Check players in',
    body: 'Check players in one at a time or in bulk as they arrive. Someone who registered but has not arrived is never picked for a court. A late arrival is checked in exactly the same way.',
    sees: ['A running checked-in count', 'Each player’s availability', 'Anyone who has left marked as such'],
  },
  {
    Art: Step4QueueArt,
    title: 'The queue fills',
    body: 'A checked-in, available player joins the queue and waits. Going temporarily unavailable takes them out; coming back puts them at the back with a fresh wait time rather than holding their old place.',
    sees: ['The queue in order', 'How long each player has waited', 'How many games each has played'],
  },
  {
    Art: Step5AssignArt,
    title: 'Assign a court',
    body: 'Take the session live and the app proposes the next four players for a free court — fewest games first, then longest wait, avoiding an immediate repeat of the last partners. It shows you the reason behind each pick, and you confirm.',
    sees: ['A recommended match-up', 'The reasons behind it', 'Both sides balanced by performance'],
  },
  {
    Art: Step6ScoreArt,
    title: 'Score the game',
    body: 'There are two buttons: which side won the rally. The app works out whether that was a point, a change of server, or a side out, and calls the score. Undo reverses the last rally whenever you need it.',
    sees: ['Both team scores side by side', 'Who is serving and which server', 'The official score call'],
  },
  {
    Art: Step7FinishArt,
    title: 'Finish the game',
    body: 'Finish once the score is a valid final under your ruleset. The court is released, the players return to the queue, and the standings update. Got it wrong? Reopen the game, correct it, and finish again — the statistics are recomputed from scratch.',
    sees: ['The final score locked in', 'Updated standings', 'The court free again'],
  },
  {
    Art: Step8CompleteArt,
    title: 'Complete the session',
    body: 'When play is over, complete the session. The standings become the final record, the public view stops expecting changes, and nothing further can be assigned.',
    sees: ['Final standings', 'A public view that reads as finished'],
  },
]

const troubles = [
  { title: 'You tapped the wrong side', body: 'Undo the last rally. It is always beside the two rally buttons, and it reverses exactly one action.' },
  { title: 'You noticed a mistake much later', body: 'Reopen the finished game, correct the score, serving side and server number together, then finish it again.' },
  { title: 'Someone has to swap out mid-game', body: 'Replace the assigned player. The player who comes off returns to whatever state they are actually in — they are not auto-requeued if they are leaving.' },
  { title: 'A court becomes unusable', body: 'Mark it out of service. A game already on it is not cancelled behind your back — you decide whether to abandon it or move it.' },
  { title: 'A game cannot be finished', body: 'Abandon it. The court is released and the game is excluded from performance statistics.' },
]
---

<Layout title="How it works — Devlab Pickleball">
  <main class="mx-auto max-w-5xl px-6 py-16">
    <p class="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Guide</p>
    <h1 class="mt-2 text-4xl font-extrabold tracking-tight text-slate-900">How Devlab Pickleball works</h1>
    <div class="pb-rule mt-3 h-[3px] w-11 rounded-full"></div>
    <p class="mt-5 max-w-2xl text-lg leading-relaxed text-slate-600">
      A full run through one session, from creating it to closing it — written for the person
      holding the tablet. Your players never need to read any of this.
    </p>

    <section class="mt-12 rounded-2xl bg-white/[0.92] p-6 ring-1 ring-slate-200">
      <h2 class="font-semibold text-brand-ink">Before you start</h2>
      <p class="mt-2 text-sm leading-relaxed text-slate-600">
        You need a venue with its courts added, and a scoring ruleset. Both are set up once and
        reused by every session afterwards.
      </p>
    </section>

    <section class="mt-12 space-y-6" data-testid="pb-guide-steps">
      {steps.map(({ Art, title, body, sees }, index) => (
        <article class="light-artifact overflow-hidden rounded-2xl bg-white/[0.92] ring-1 ring-slate-200">
          <div class="grid gap-0 sm:grid-cols-[0.8fr_1.2fr]">
            <div class="flex items-center justify-center bg-gradient-to-br from-[#fff9ff] to-[#f2efff] p-6">
              <Art className="h-24 w-full text-brand-ink" />
            </div>
            <div class="p-6">
              <p class="pb-score text-sm text-brand">Step {index + 1}</p>
              <h2 class="mt-1 text-xl font-semibold text-brand-ink">{title}</h2>
              <p class="mt-2 text-sm leading-relaxed text-slate-600">{body}</p>
              <ul class="mt-4 space-y-1 text-sm text-slate-600">
                {sees.map((item) => (
                  <li class="flex gap-2"><span class="text-brand" aria-hidden="true">•</span>{item}</li>
                ))}
              </ul>
            </div>
          </div>
        </article>
      ))}
    </section>

    <section class="mt-16">
      <h2 class="text-3xl font-semibold text-slate-900">When something goes wrong</h2>
      <div class="mt-8 grid gap-4 lg:grid-cols-2">
        {troubles.map(({ title, body }) => (
          <article class="rounded-2xl bg-white/[0.92] p-5 ring-1 ring-slate-200">
            <h3 class="font-semibold text-brand-ink">{title}</h3>
            <p class="mt-2 text-sm leading-relaxed text-slate-600">{body}</p>
          </article>
        ))}
      </div>
    </section>

    <section class="mt-16">
      <h2 class="text-3xl font-semibold text-slate-900">What your players see</h2>
      <div class="mt-8 grid gap-4 sm:grid-cols-3">
        <article class="rounded-2xl bg-white/[0.92] p-5 ring-1 ring-slate-200">
          <h3 class="font-semibold text-brand-ink">Scan a QR code</h3>
          <p class="mt-2 text-sm text-slate-600">Share one code for the session. No sign-in, no install.</p>
        </article>
        <article class="rounded-2xl bg-white/[0.92] p-5 ring-1 ring-slate-200">
          <h3 class="font-semibold text-brand-ink">Follow it live</h3>
          <p class="mt-2 text-sm text-slate-600">Courts and scores update as you record them.</p>
        </article>
        <article class="rounded-2xl bg-white/[0.92] p-5 ring-1 ring-slate-200">
          <h3 class="font-semibold text-brand-ink">Watch on the TV</h3>
          <p class="mt-2 text-sm text-slate-600">A full-screen display for a screen in the hall.</p>
        </article>
      </div>
    </section>

    <section class="mt-16 rounded-2xl bg-white/[0.92] p-6 ring-1 ring-slate-200">
      <h2 class="font-semibold text-brand-ink">Who can do what</h2>
      <ul class="mt-3 space-y-2 text-sm text-slate-600">
        <li><strong class="text-brand-ink">Admin</strong> — everything, plus operators, rulesets and the audit log.</li>
        <li><strong class="text-brand-ink">Facilitator</strong> — runs sessions: check-in, queue, courts, scoring, corrections.</li>
        <li><strong class="text-brand-ink">Scorekeeper</strong> — scores games on an assigned court.</li>
      </ul>
    </section>

    <div class="mt-16 flex flex-wrap gap-3">
      <a href="/pickleball/app" class="pb-btn-primary inline-flex rounded-lg px-5 py-3 text-sm">Operator sign in</a>
      <a href="/pickleball/methodology" class="inline-flex items-center rounded-lg bg-white/[0.92] px-5 py-3 text-sm font-semibold text-brand-ink ring-1 ring-slate-200">How OPI works</a>
    </div>
  </main>
</Layout>
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx playwright test --project=worker --workers=1 tests/e2e/pickleball/pickleball-public-pages.spec.js`

Expected: PASS, all tests including the "no unbuilt features" guard.

- [ ] **Step 6: Commit**

```bash
git add src/components/pickleball/art src/pages/pickleball/how-it-works.astro tests/e2e/pickleball/pickleball-public-pages.spec.js
git commit -m "feat: add a visual how-it-works guide for pickleball operators"
```

---

## Task 5: Verify the roles section against the real permission matrix

**Files:**
- Modify: `src/pages/pickleball/how-it-works.astro` (only if the check finds a mismatch)

This task exists because Task 4 wrote role descriptions from memory of the domain, and the Global Constraints require every claim to map to real code.

- [ ] **Step 1: Read the real matrix**

Run: `sed -n '1,80p' src/lib/pickleball/permissions.ts`

- [ ] **Step 2: Compare and correct**

Check each of the three bullets in the "Who can do what" section against the actual permission sets. Correct any claim the matrix does not support. If a role can do something materially different from what the page says, fix the page — never the matrix.

- [ ] **Step 3: Re-run the suite**

Run: `npx playwright test --project=worker --workers=1 tests/e2e/pickleball/pickleball-public-pages.spec.js`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/pages/pickleball/how-it-works.astro
git commit -m "docs: align the guide's role descriptions with the real permission matrix"
```

If nothing needed changing, skip the commit and record that the check passed.

---

## Task 6: Request early access

**Files:**
- Modify: `src/pages/pickleball/index.astro`, `tests/e2e/pickleball/pickleball-public-pages.spec.js`

**Interfaces:**
- Consumes: `ContactForm({ siteKey = '', copy = {} })` from `src/components/islands/ContactForm.jsx`. Recognised `copy` keys: `nameLabel`, `namePlaceholder`, `emailLabel`, `emailPlaceholder`, `subjectLabel`, `subjectPlaceholder`, `messageLabel`, `messagePlaceholder`, `submitLabel`, `helperText`.
- Produces: the `#request-access` anchor that Task 7 links to.

- [ ] **Step 1: Write the failing test**

```javascript
  test('the landing page offers a way to request access', async ({ page }) => {
    await page.goto('/pickleball')

    const section = page.locator('#request-access')
    await expect(section).toBeVisible()
    await expect(section.getByRole('heading', { name: 'Request early access' })).toBeVisible()
    await expect(section.getByLabel('Your name')).toBeVisible({ timeout: 10000 })
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test --project=worker --workers=1 tests/e2e/pickleball/pickleball-public-pages.spec.js -g "request access"`

Expected: FAIL — `#request-access` does not exist.

- [ ] **Step 3: Add the Turnstile plumbing**

Add to the frontmatter fence of `src/pages/pickleball/index.astro`:

```astro
import ContactForm from '../../components/islands/ContactForm.jsx'
import { getEnv } from '../../lib/env'

// Same resolution as src/pages/services.astro — a local request uses
// Cloudflare's documented always-passes test key so the form is usable in
// development without a real site key.
const env = getEnv()
const requestHostname = new URL(Astro.request.url).hostname
const isLocalRequest = requestHostname === 'localhost' || requestHostname === '127.0.0.1'
const turnstileSiteKey = isLocalRequest ? '1x00000000000000000000AA' : env.TURNSTILE_SITE_KEY || ''

const accessFormCopy = {
  nameLabel: 'Your name',
  subjectLabel: 'Your club or venue',
  subjectPlaceholder: 'Pickleball early access request',
  messageLabel: 'Tell us about your open play',
  messagePlaceholder: 'How many players and courts, how often you run open play, and what you want out of the app.',
  submitLabel: 'Request access',
  helperText: 'We review every request personally.',
}
```

- [ ] **Step 4: Add the section**

Add inside `<main>`, after the FAQ section:

```astro
    <section id="request-access" class="mt-20 scroll-mt-24">
      <h2 class="text-3xl font-semibold text-slate-900">Request early access</h2>
      <p class="mt-3 max-w-2xl text-slate-600">
        We are piloting with a small group of clubs before opening this up. If you run open play
        and want in, tell us a little about your sessions.
      </p>
      <div class="mt-8 rounded-2xl bg-white/[0.92] p-6 ring-1 ring-slate-200">
        <ContactForm client:visible siteKey={turnstileSiteKey} copy={accessFormCopy} />
      </div>
    </section>
```

`client:visible` is deliberate: the form's JavaScript and the Turnstile script are not fetched until a visitor scrolls to it, so the hero's render cost is unchanged.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx playwright test --project=worker --workers=1 tests/e2e/pickleball/pickleball-public-pages.spec.js`

Expected: PASS. Note the aria-hidden test now also covers the icons the form renders — if it fails, scope its locator to `main > section:not(#request-access) svg` rather than removing the assertion.

- [ ] **Step 6: Commit**

```bash
git add src/pages/pickleball/index.astro tests/e2e/pickleball/pickleball-public-pages.spec.js
git commit -m "feat: let a prospective operator request pickleball access from the landing page"
```

---

## Task 7: Give the blocked sign-in an exit

**Files:**
- Modify: `src/pickleball-app/pages/LoginPage.jsx`
- Modify: `tests/e2e/pickleball/pickleball-public-pages.spec.js`

**Do not modify `callback.ts`.** Its no-membership branch is rate-limited specifically because it is an email-enumeration oracle. This task adds a link to a page that already renders; it discloses nothing new.

- [ ] **Step 1: Write the failing test**

```javascript
  test('a blocked sign-in offers a way to request access', async ({ page }) => {
    await page.goto('/pickleball/app?error=no_access')

    await expect(page.getByRole('alert')).toContainText('no active Pickleball membership')
    await expect(page.getByRole('link', { name: 'Request access' })).toHaveAttribute(
      'href',
      '/pickleball#request-access',
    )
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test --project=worker --workers=1 tests/e2e/pickleball/pickleball-public-pages.spec.js -g "blocked sign-in"`

Expected: FAIL — no such link.

- [ ] **Step 3: Add the exit**

In `src/pickleball-app/pages/LoginPage.jsx`, after the `errorMessage` block, add:

```jsx
        {error === 'no_access' && (
          <p className="mb-4 text-sm text-slate-300">
            Not part of a club on Devlab Pickleball yet?{' '}
            <a href="/pickleball#request-access" className="font-semibold text-white underline underline-offset-4">
              Request access
            </a>
          </p>
        )}
```

The existing `ERROR_MESSAGES` map is unchanged — the message still explains the situation; this only adds the action.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx playwright test --project=worker --workers=1 tests/e2e/pickleball/pickleball-public-pages.spec.js`

Expected: PASS.

- [ ] **Step 5: Confirm nothing else regressed**

Run: `npx playwright test --project=worker --workers=1 tests/e2e/pickleball/pickleball-auth.spec.js`

Expected: PASS — the auth flow is untouched.

- [ ] **Step 6: Commit**

```bash
git add src/pickleball-app/pages/LoginPage.jsx tests/e2e/pickleball/pickleball-public-pages.spec.js
git commit -m "fix: give a blocked pickleball sign-in a way to request access"
```

---

## Task 8: Services page CTA

**Files:**
- Modify: `src/pages/services.astro` (the block around lines 200–215)
- Modify: `tests/e2e/pickleball/pickleball-public-pages.spec.js`

- [ ] **Step 1: Write the failing test**

```javascript
  test('the services page links to the pickleball product', async ({ page }) => {
    await page.goto('/services')

    await expect(page.getByRole('button', { name: 'Be a beta-tester' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'See how it works' })).toHaveAttribute('href', '/pickleball')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test --project=worker --workers=1 tests/e2e/pickleball/pickleball-public-pages.spec.js -g "services page"`

Expected: FAIL — no such link.

- [ ] **Step 3: Add the button**

In `src/pages/services.astro`, replace the `<div class="mt-4">` wrapper around `#beta-tester-cta` with a flex row holding both, leaving the button and its inline script exactly as they are:

```astro
        <div class="mt-4 flex flex-wrap gap-3">
          <button
            id="beta-tester-cta"
            type="button"
            class="inline-flex items-center gap-2 rounded-xl bg-brand px-5 py-3 text-sm font-semibold text-white hover:brightness-95"
          >
            Be a beta-tester
          </button>
          <a
            href="/pickleball"
            class="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-semibold text-brand-ink ring-1 ring-slate-300 transition hover:ring-brand/40"
          >
            See how it works
          </a>
          <script>
            document.getElementById('beta-tester-cta')?.addEventListener('click', () => {
              const el = document.getElementById('beta-tester-form')
              if (el) {
                el.hidden = false
                el.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }
            })
          </script>
        </div>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx playwright test --project=worker --workers=1 tests/e2e/pickleball/pickleball-public-pages.spec.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pages/services.astro tests/e2e/pickleball/pickleball-public-pages.spec.js
git commit -m "feat: link the services page to the pickleball product page"
```

---

## Task 9: Full verification

- [ ] **Step 1: Lint and typecheck**

```bash
npx eslint src/components/pickleball src/pages/pickleball src/pickleball-app/pages/LoginPage.jsx tests/e2e/pickleball/pickleball-public-pages.spec.js
npx tsc --noEmit
```

Expected: both clean.

- [ ] **Step 2: Unit suite**

Run: `npx vitest run`

Expected: PASS. Nothing in this plan touches unit-tested code, so a failure here means something unrelated broke.

- [ ] **Step 3: Pickleball E2E, serially**

```bash
npx playwright test --project=worker --workers=1 tests/e2e/pickleball/pickleball-public-pages.spec.js
npx playwright test --project=worker --workers=1 tests/e2e/pickleball/pickleball-operator-ui.spec.js
```

Expected: PASS. Use `--workers=1`; `wrangler dev --local` crashes under parallel load on Windows with an empty-message `ProxyController` error, which is pre-existing and unrelated to this work.

- [ ] **Step 4: Visual pass**

Load `/pickleball` and `/pickleball/how-it-works` at 1440px and 390px widths. Confirm: no section is a lone centred paragraph in an empty viewport, no horizontal scrollbar at 390px, artwork is legible at both sizes, and text inside `light-artifact` panels is dark while text on the shell is light.

- [ ] **Step 5: Update the architecture doc**

Add to `docs/pickleball/architecture.md`'s "Foundational pieces": a line recording that the public pages live at `/pickleball` and `/pickleball/how-it-works`, that their artwork is hand-authored SVG under `src/components/pickleball/art/` rendered statically, and that the guide deliberately documents only shipped behaviour.

- [ ] **Step 6: Commit**

```bash
git add docs/pickleball/architecture.md
git commit -m "docs: record the pickleball public pages in the architecture doc"
```

---

## Self-Review

**Spec coverage.** §1.2 illustration system → Tasks 1, 2, 4. §1.3 landing page → Tasks 1, 2, 3, 6. §1.4 guide → Tasks 4, 5. §1.5 request access and sign-in exit → Tasks 6, 7. §1.6 services → Task 8. §1.7 accuracy rule → enforced by a test in Task 4 and the check in Task 5. §1.8 testing → Tasks 1–8 plus Task 9. No gaps.

**Placeholder scan.** No TBD, no "add error handling", no "similar to Task N". The one intentional non-literal is SVG path geometry for twelve of the thirteen art components, which is covered by a stated template, a complete worked example in Task 1, a second complete example in Task 2, and a per-component composition table — the rationale is recorded under File Structure.

**Type consistency.** Every art component is `({ className })` returning one `<svg viewBox>`; `ContactForm` is called with the real signature `{ siteKey, copy }` verified against `src/components/islands/ContactForm.jsx:108`; `Layout` is called with `title` only; `getEnv()` matches the usage in `src/pages/services.astro`. The `#request-access` anchor produced in Task 6 is the exact href consumed in Task 7.

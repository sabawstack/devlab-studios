# DevLab Studios — Complete B2B Brand, UX and Architecture Specification (re-audit, 2026-11-12)

**Document type:** independent buyer-perspective re-audit and implementation-ready specification for a Claude Opus implementation session.
**Repository:** `sabawstack/devlab-studios`, `main` at `dd6b377` (release 2.5.0, 2026-11-12). **Production:** https://www.devlabstudios.com. **Audit date:** 2026-11-12.
**Status:** audit, research, creative direction and planning only. Nothing in the repository, the databases, the configuration or production was changed. Screenshots and fetched HTML live only in this session's scratch directory.
**Intended final location:** `docs/plans/devlab-complete-b2b-brand-ux-architecture-spec.md` (writing there is not permitted in this audit-only session, so the content is delivered here; the first Opus step copies it unchanged).

**Evidence standard.** VERIFIED = read in the repository at `dd6b377` or observed on the production site on 2026-11-12 (file:line, URL or screenshot). INFERRED = a conclusion from verified facts. HYPOTHESIS = needs market or owner validation. UNKNOWN = not accessible. The buyer simulation in Section A and C is an **expert heuristic simulation**, not user testing; no conversion figures or visitor behaviour are claimed anywhere in this document.

**What was actually inspected.** Live text and links of `/`, `/solutions`, `/solutions/lead-intake-and-follow-up`, `/solutions/workflow-systems-audit`, `/work`, `/work/memory-preview`, `/about`, `/profile`, `/contact`, `/products`, `/insights`, `/insights/daily`, `/offers/lead-intake-checklist`, `/pickleball`, `/privacy`, a 404 URL, `robots.txt`, `sitemap.xml`, response headers and the served HTML of `/`. Full-page desktop (1440 px) screenshots of `/`, `/solutions`, `/work`, `/work/memory-preview`, `/contact`, `/about`, `/profile`, `/solutions/workflow-systems-audit`, with crops of the hero schematic and the Node figure. Phone-width screenshots could not be captured (the device-emulation run failed in this environment), so phone findings below are from the code's breakpoints and the release log's own 390 px evidence, marked INFERRED. Repository: every public page, the data files behind them, `brand.css`, `NodeMascot.jsx`, `HeroPipelineVisualizer.astro`, `FailureDiagnosticConsole.astro`, `content.js`, `company.js`, `publicRoutes.ts`, `offers.js`, the inquiry endpoint and delivery messages, ADRs 0007/0012/0013/0014, `docs/brand/scenes.md`, `docs/CURRENT_STATE.md`, `docs/plans/PROGRESS.md`, and the prior audit (`docs/plans/devlab-b2b-cms-architecture-audit.md`, dated 2026-11-12 at `93a5a35`).

**Owner decisions recorded 2026-11-13 (binding for Opus).** Q-01 palette: Direction B in the "Graphite on stone" variant (cool stone canvas, graphite-indigo ink, indigo links, the logo gradient as the only strong colour, a graphite hero band on the home page); density "Balanced". Gradient permitted only on: the logo mark, primary buttons (white text over a 10 % dark scrim), the 3 px hero rule and the current-nav underline. Q-13 direction: refine Node (the redraw itself is still reviewed on `/brand` before shipping). Q-02: audit price line reads "Quoted after a 30-minute call". Q-04: reply within 1 business day, Monday–Friday 9:00–18:00 Philippine time (UTC+8). Q-05: email and form only (no scheduling or chat links). Q-06: fix the Terms wording now; the Privacy "pending legal review" note stays until a lawyer reviews it. Q-18: fix the seed file only; no history rewrite. All other Q items keep their stated defaults.

**Relationship to the prior audit and to Gemini's proposals.** The prior audit's verified inventory (Section B there) and its CMS matrix are retained where this re-audit re-confirmed them; its findings that releases 2.3–2.5 have since fixed (TTFB, identity leaks, Google Fonts, schema gaps, the missing audit page) are recorded as fixed. Gemini's proposals (blueprint identity, three typefaces, neon circuit gradient, Node, interactive failure diagnostics, simulated outage, site-wide refactor) were implemented in release 2.5.0; each is assessed on its merits in Sections D, G and K rather than preserved or discarded by default.

---

## A. Executive buyer verdict

**Would a qualified business owner trust, contact, shortlist and potentially hire DevLab from the current site?**

- **Shortlist:** yes for a technical buyer (Persona B/D), conditionally for an operations buyer (Persona C), unlikely for a non-technical Philippine owner (Persona A).
- **Book a discovery call or request the audit:** a technical buyer probably would; the other three personas are slowed by the absence of a price anchor, a stated response window, a time zone, a scheduling path, and any outside evidence (client voice, named outcomes, third-party profile).
- **Authorise a paid audit or a small project:** plausible for Persona B after one reply; not from the site alone.
- **Award a large contract without further information:** no, and no studio site should expect that. The site's job is to earn the first conversation, and today it earns it only with the most technical visitor.

**Why.** The site is now honest, fast and engineered with real discipline: a persist-before-deliver inquiry pipeline that it accurately describes, hashed CSP, self-hosted fonts, Lighthouse 92–97 mobile, a code-owned copy budget, and real production screenshots. Those are rare for a studio of this size and they are the foundation this specification builds on. But the first impression contradicts the business goal in three ways:

1. **It looks like the thing the brief says to avoid.** Navy canvas, blueprint grid, magenta-to-blue gradient buttons, mono eyebrows (`[ DEVLAB STUDIOS • SYSTEMS ARCHITECTURE ]`, `§01 FAILURE MODES`), spec-sheet cards (`SYS-01`, `AUTOMATION`), `VERIFIED ·` status lines, a "LIVE SCHEMATIC", a tabbed "console", and a small visored robot figure. Every one of these is a recognisable 2025–26 AI-agency template device. The engineering under it is real; the surface reads as generated (VERIFIED by screenshot; Section D).
2. **It speaks engineer to a buyer who is not one.** "Deterministic route", "SQL persist", "typed integration contracts", "zero re-keying on the audited path", "Failure vector", "Node verification": the home page explains DevLab's reliability philosophy before it explains what a buyer gets, and Personas A and C cannot map any of it to their problem (VERIFIED in `content.js:134–242`).
3. **Trust devices are self-issued.** "VERIFIED" badges, "Systems in production", "Live schematic" and "Nominal" are produced by DevLab about DevLab, on a client-side drawing. There is no outside voice (client, partner, reviewer, directory) anywhere on the site. The Terms page simultaneously calls the Work screenshots "illustrative", which undercuts the Work page's "verifiably does" framing (VERIFIED `terms.js:43` vs `content.js:331–332`).

**What would move the verdict.** Keep the engineering and the honesty; change the surface and the sequence. Lead with the buyer's problem and outcome in plain language, make the written delivery promise concrete (what the audit costs or at least its range, when a person replies, in which hours, in which time zone), replace self-issued badges with evidence a visitor can check (dated change logs, links to the open products, a named client or two with consent, the founder's public profiles), and turn the generic dark-dashboard surface into a distinctive, calm, printed-drawing identity that the site's own scene library already points toward. The Node figure can stay as DevLab's signature only if it is redrawn to pass a 24 px silhouette test without a robot visor and used a tenth as often.

---

## B. Evidence inventory

### B.1 Repository and deployment state (VERIFIED)

| Item | State |
|---|---|
| Version | `package.json` 2.5.0; CHANGELOG release 2.5.0 (2026-11-12); GitHub Release entry missing (CI `gh release create` 503, PROGRESS.md "Open") |
| Framework | Astro 7.4.x, `@astrojs/cloudflare` 14.4.x, React 19.2 islands, Tailwind, Zod 4; one Worker `devlab-studios` with `scheduled`, `email` handlers and two Durable Objects (`OpenSessionDO`, `RateLimiterDO`) (`wrangler.jsonc:2,42,46–92`) |
| Data | D1 `devlab-studios-cms` (binding `DB`), D1 `devlab-pickleball`, R2 `devlab-studios` (public media) and `devlab-mailbox` (private), Workers AI, Images; migrations `0001`–`0019` for the CMS database; preview environment fully isolated |
| Deploy | `main` → Cloudflare Workers Builds (production); `development` → `deploy-preview.yml` (preview Worker); CI runs lint, typecheck, unit, build; preview deploy fails on unapplied migrations (OPS-06) |
| Production D1 | migrations `0018` and `0019` "known pending" on production per `docs/CURRENT_STATE.md:190` — UNKNOWN whether applied since; must be listed before any schema-dependent release |
| Tests | Vitest 2,756 passing; Playwright `static` 226 passing / 1 skipped (release log); projects `static`, `admin-auth`, `worker`, `desktop-safari`, `mobile-safari`; axe in `brand.spec.js`; word-budget and brand-token guard tests (`redesign.spec.js`, `brandTokens.test.ts`) |
| Performance | Edge HTML cache (ADR 0011); TTFB 0.31 s for `/` from this session's vantage (curl, 2026-11-12); Lighthouse mobile on preview 97/100/100, LCP 2.3 s, CLS 0; production 2.4.0 baseline 92, LCP 3.1 s (PROGRESS.md Phase 13 rows 12–13a) |
| Security | HSTS preload, `X-Frame-Options: DENY`, hashed `script-src` with no `'unsafe-inline'`, Turnstile, rate-limiter DO, PBKDF2 admin credentials, session revocation (headers VERIFIED by curl; code per prior audit) |
| Fonts | Self-hosted Space Grotesk, JetBrains Mono, Newsreader (62 KB for the first two) on BrandLayout; Google Fonts still requested by the seven legacy-Layout routes |
| Layout split | BrandLayout: `/`, `/solutions*`, `/work*`, `/products`, `/insights`, `/insights/[slug]`, `/about`, `/profile`, `/contact`, `/privacy`, `/terms`, `/404`. Legacy Layout: `/offers/*`, `/insights/daily`, `/crawler`, `/maintenance`, `/pickleball`, `/pickleball/how-it-works`, `/pickleball/rotation`. PickleballAppShell: the app screens |

### B.2 Production route inventory (VERIFIED on 2026-11-12)

| Route | Purpose | Words (body, approx.) | Layout | Notes |
|---|---|---|---|---|
| `/` | Business home | ~700 (580 with one console tab open) | Brand | H1 "Systems that don't silently fail."; Organization + WebSite schema |
| `/solutions` | Service lines index | ~410 | Brand | 3 lines + audit band + 4 delivery steps; 3 Service schemas |
| `/solutions/lead-intake-and-follow-up`, `/workflow-and-ai-automation`, `/custom-software-and-operations` | Service line pages | ~250 each | Brand | Scene figure, includes list, one proof card, 2 FAQs, Service + FAQPage schema |
| `/solutions/workflow-systems-audit` | Entry offer | ~270 | Brand | Price "quoted after the intake call"; 3 FAQs |
| `/work` | Proof index | ~265 | Brand | 4 write-ups, real screenshots, evidence note |
| `/work/[slug]` ×4 | Write-ups | ~250–420 | Brand | Problem / What was built / What it verifiably does; no outcome statements in static data; Breadcrumb schema only |
| `/products` | Owned products | ~190 | Brand | Pickleball (live, free) + 3 "in exploration" ideas |
| `/insights`, `/insights/[slug]` ×15 | Articles | ~700 / 800–1,050 | Brand | Article schema; byline "DevLab Studios" while schema author is the founder |
| `/insights/daily` | Generated digest | ~150 + items | Legacy | noindex; honest machine-generation disclosure |
| `/offers/lead-intake-checklist` | Lead magnet | ~240 | Legacy | noindex; sends a link to an already-public article |
| `/about` | Studio | ~245 | Brand | Founded March 2026; principles; how we work |
| `/profile` | Founder | ~850 | Brand | Person schema; résumé PDF; employment CTAs |
| `/contact` | Inquiry | ~110 (step 1) | Brand | 2-step `InquiryForm`, 8 inquiry types, Turnstile on step 2 |
| `/privacy`, `/terms` | Legal | ~900 / ~350 | Brand | Privacy "pending legal review"; Terms "illustrative purposes" |
| `/404`, `/[...all]` | Error | ~40 | Brand | Four recovery tiles |
| `/pickleball`, `/how-it-works`, `/rotation`, `/new`, app screens | Product | ~650–1,100 | Legacy / App shell | Separate visual system; indexed at low priority |
| `/crawler`, `/maintenance`, `/brand` | Operational | — | Legacy / standalone | noindex; `/brand` 404 in production by design |
| Redirects | `/services`→`/solutions`, `/process`→`/about#how-we-work`, `/resources*`→`/insights*`, five `/landing-sample-*`→`/work`, D1 table for `/experiences`, `/portfolio` | | | `middleware.ts:37–66`, `0004_content_model_v2.sql:126–129` |

Sitemap: 37 URLs (18 static routes + 4 write-ups + 15 articles). `/insights/daily`, `/offers/*`, `/crawler` excluded by design.

### B.3 Visual observations (VERIFIED by screenshot, 1440 px)

- **Home.** Navy canvas with a faint 24 px grid on every section; every section opens with a mono eyebrow (`§01 FAILURE MODES`); the hero's right column is a bordered "INQUIRY PIPELINE · LIVE SCHEMATIC" panel with a green `NOMINAL` label, four squares on a violet spine, a magenta branch to a `WEBHOOK` box with a green LED, and the Node figure at 48 px as checkpoint 03. The failure console is a two-column tabbed panel with three mono-labelled rows per tab. The reliability grid is four bordered cards, one tall, containing a fake three-line delivery log. The work section is four bordered "spec cards" with `SYS-01…04` and `AUTOMATION` / `PRODUCT · LIVE` tags. The "Principal engineer" card shows an **empty bordered square where a portrait should be** (a visible defect at 1440 px; the `Portrait` component renders a frame with no image on production).
- **Solutions.** The strongest page visually: three service lines, each with a captioned line-drawn figure (`Fig. 01–04`) from the scene library. Figures sit inside large dark panels with much empty space; Fig. 02 is nearly empty (a dashed line, two small boxes, one person glyph). Buttons repeat the gradient pattern.
- **Work.** Four real screenshots (n8n canvases, a light-themed Memory Preview diagram). The n8n canvases are unreadable at card size; the light diagrams clash with the navy page but are the most credible content on the site.
- **Write-up.** Long single column of prose; the `Fig. 01` is the generic "Build in layers" scene reused from About; the two screenshots are light-themed and large; "TECHNICAL NOTES" is a collapsed box. The founder line "Designed and built by…" is small.
- **Contact.** Clean two-column form; mono uppercase labels; the aside promises persistence; no response window, hours or time zone.
- **About.** Hero + four principles + figure + four steps; the "Founded March 2026" fact is prominent.
- **Profile.** Dense but orderly; a real portrait photo; 24 skill tags + 29 tool tags (some duplicated: Git, GitHub, Vercel, Postman, n8n, Zapier, Make appear in both).
- **Node figure.** At 48 px in the hero: three thin vertical plates (magenta, gradient, blue), a dark visor slit with a white line, six ring terminals, four dot "hands". It reads as a small insect-like robot with a visor; at 28 px (console rows) it is an indistinct coloured glyph. Count on the home page: 2 (hero, nominal/outage) + 8 (console, two per tab) + 1 (audit card) = 11 instances, plus the inquiry success state.

### B.4 Unknowns

- Phone rendering of the current release was not captured in this session (device emulation failed); the release log's own 390 px checks (no horizontal scroll, header ≤ 64 px, full-height menu) are the evidence used.
- Production D1 migration state (`0018`, `0019`) and whether the production `profile` row still carries the older location string.
- Real inquiry volume, mix, and reply times (no analytics access in this session).
- Whether any client will consent to being named or quoted (owner question).
- Whether a registered business name exists for the legal pages (prior audit N5, still open).

---

## C. Commercial positioning audit

### C.1 Buyer simulation (expert heuristic; four personas)

**Persona A — Philippine business owner (non-technical).**
- First seconds: a dark, technical screen; "Systems that don't silently fail" is a good promise but the next line ("Custom web interfaces, backend services, and AI workflows engineered end-to-end by one senior architect. No outsourced handoffs. No brittle wrappers.") lists things I do not buy by name.
- What I think they sell: "software, and something about AI."
- Earns trust: the Cebu location, the founder's name and face on Profile, the plain-language solution problems ("Inquiries arrive, then sit."), the audit as a small first step.
- Hesitation: no price or range anywhere; no indication of who they work with (any Philippine business? what size?); no business registration or legal name on the privacy page ("pending legal review"); no phone, no Viber/WhatsApp, no Messenger entry despite the Messenger case study.
- Missing: an example in my world (a clinic, a distributor, a school, a contractor), a "what it costs to start" line, hours and reply window.
- Excessive or artificial: the hero schematic and the "VERIFIED" lines; I cannot tell what they verify.
- Would shortlist: maybe, from the Solutions page. Would book: unlikely without a price anchor. Would pay for an audit: not from the site alone.

**Persona B — US founder needing a backend/CRM/automation partner.**
- First seconds: this is a competent engineer's site. Dark theme and mono labels are familiar.
- Trust: the inquiry pipeline description (and the fact that the form really does save first), real n8n/MCP screenshots, hashed CSP, a free product that is actually running, a founder with GitHub and LinkedIn.
- Hesitation: no second person or escalation path (what happens if Stephen is sick?), no stated support arrangement, no mention of contracts, IP ownership, confidentiality, data residency, or how US payments work; "Founded March 2026" without a prior track record framing; case studies have no client, no scope boundary, no outcome, and the Terms page calls their screenshots illustrative.
- Would shortlist: yes. Would book: yes, if the reply window and time-zone overlap were stated. Would pay for an audit: after one call. Large contract: no.

**Persona C — Australian operations manager with disconnected tools.**
- First seconds: "another AI automation shop", because of the look; the headline is good, the copy under it is engineering.
- Trust: "Inquiries arrive, then sit. Follow-up depends on someone remembering." is exactly my problem, as is "Every delivery attempt is recorded." The solution figures help.
- Hesitation: cannot distinguish DevLab from n8n/Zapier freelancers except by the reliability rules, which read as philosophy; no retainer or "Operations Care" page even though the contact form lists it; no SLA-like statement at all; no handover and documentation sample.
- Would shortlist: conditionally. Would book: possibly via the audit. Would pay: after seeing a sample audit deliverable.

**Persona D — technical evaluator / recruiter.**
- Finds the Profile from the nav in one click; GitHub, LinkedIn, résumé, certifications, experience, four write-ups, and a clear employment CTA. This journey works.
- Hesitation: the Background paragraph is first person while the page is third person; the two tag clouds repeat tools; Article schema names the founder as author while bylines say "DevLab Studios"; GitHub is linked but no repositories are surfaced on the site.
- Would shortlist for a role: yes.

### C.2 Positioning verdict

- **Value clarity:** the promise ("systems that don't silently fail") is distinctive and true to the engineering, but the home page explains *how DevLab engineers* before *what the buyer gets*. The three service lines are right; their names are fine; their problems are stated well on `/solutions` and badly on `/`.
- **Differentiation:** the real differentiators are (1) persist-before-deliver and visible failures as a design rule, (2) the founder does the work and answers the email, (3) a written audit before a build, (4) running products on the same stack. All four exist on the site; none is presented as evidence a buyer can check.
- **Acquisition barriers (ranked):** no price anchor; no reply window, hours or time zone; no outside voice; generic surface; engineering vocabulary on `/`; "pending legal review" on Privacy; Terms contradicting Work; no retainer page; no scheduling path; footer "Hiring? Contact Stephen" linking to the profile, not the form.

### C.3 Honesty and label review (Section 11 of the brief)

| Label (where) | Class | Supported? | Required change |
|---|---|---|---|
| "INQUIRY PIPELINE · LIVE SCHEMATIC" (`content.js` `pipeline.caption`, hero) | Illustrative animation | No: it is a client-side drawing that never calls the network (`HeroPipelineVisualizer.astro:139–150`) | Relabel "How an inquiry moves through a DevLab system (illustration)"; remove "LIVE" and "NOMINAL" |
| "Nominal" / "Outage" mode badges and "Simulate outage" | Interactive simulation | Simulation is honest only if labelled as one | Keep the toggle if retained; label "Simulated outage"; status text starts "In this simulation…" |
| "VERIFIED · one record per inquiry…" ×4 (`content.js:169–190`) | Architectural design intention, self-attested | Not verified by anyone outside DevLab; "zero re-keying on the audited path" is a promise about future audits | Replace with "How we build it:" and a link to the thing a visitor can check (this site's own form behaviour, the write-up, the ADR) |
| "Systems in production" / "running today" / "Product · live" (`content.js:212–215`) | Recorded production evidence | Pickleball is verifiably live; the three automation write-ups are client systems with no public endpoint; "running today" is unverifiable | "Systems we have built"; keep "live" only for the product with a link |
| "Persist Before Delivery / Outages leave work queued, never lost" (`content.js:205`) | Design intention backed by this site's code (ADR 0007) | True for this site; "never" is absolute | "Work is queued and retried, not dropped" and link to the live behaviour (success state text) |
| "Nothing is auto-replied and closed." (`content.js:325`, `[slug].astro:132`) | Process claim | A confirmation email is sent automatically (`messages.js:148–173`) | "You get an automatic receipt; the reply itself comes from a person." |
| "What it verifiably does in operation" (`work/[slug].astro:98`) vs Terms "illustrative purposes" (`terms.js:43`) | Evidence framing | Contradictory | Terms: "Screenshots are of real systems, shown with client data removed or synthetic"; Work: keep the evidence note |
| "Lapu-Lapu City, Cebu, Philippines · remote-first" | Fact | Yes | Keep; add time zone |
| Privacy "pending legal review and does not claim compliance" (`privacy.js:23`) | Legal hedge | True, but it publicly announces non-compliance | Owner decision: complete the review, then remove the line (Q-06) |

---

## D. Current visual identity assessment

### D.1 What works (keep)

- **Token discipline.** One gradient defined once, contrast-checked text colours, no raw hex in components, guard tests (`brandTokens.test.ts`), fluid type steps, metric-matched font fallbacks (`brand.css:1–140`). This is the right engineering shape for any direction.
- **The scene library.** Six line-drawn scenes composed from 16 symbols, drawn with `currentColor`, captioned, byte-budgeted, approved by the owner, one-time draw-in, reduced-motion safe (`docs/brand/scenes.md`). This is the one visual asset that is original, explains the business, and does not look generated. It is under-used and under-sized.
- **Real screenshots on Work.** Credible, unusual for a studio this size.
- **Motion rules.** Nothing loops beyond 5 s; reduced-motion honoured in CSS and by `src/lib/motion.ts`; hoisted Astro scripts, no React runtime on the home page.
- **Space Grotesk as a display face** is acceptable; **JetBrains Mono** is acceptable as a label face if used sparingly.
- **Honest copy on Solutions, Work, Audit, Contact** (problem sentences, evidence note, "a person reads it").

### D.2 What fails (the generic-AI inventory, VERIFIED by screenshot and code)

| Device | Where | Carries information? | Verdict |
|---|---|---|---|
| Navy canvas `#050b14` + blueprint grid `--grid-line` on every section | all BrandLayout pages | No | Remove the grid; the all-dark canvas is the single biggest "AI agency" signal |
| Magenta→violet→blue gradient on every primary button, the logo, and as the all-page accent family | site-wide | Brand only | Keep the gradient as the one strong colour, in four places only: the mark, primary buttons (one per screen), the hero rule, the current-nav underline; never on text, backgrounds, cards or diagrams (owner decision 2026-11-13) |
| Mono uppercase eyebrows with `§01`, brackets, bullets (`[ DEVLAB STUDIOS • SYSTEMS ARCHITECTURE ]`) | home, every page header | No; read aloud by screen readers (release log "minors") | Replace with plain-text section labels in the text face |
| Spec-sheet cards (`SYS-01`, `AUTOMATION`, stack tags) | home §03 | Weakly | Replace with evidence cards: one real screenshot, problem, what changed |
| `VERIFIED ·` mono status lines in green | home console | Misleading | Remove (Section C.3) |
| "LIVE SCHEMATIC", `NOMINAL`, LED dot, `WEBHOOK` box | hero | Illustrative | Keep as an illustration only if relabelled and redrawn in the scene language |
| Tabbed "diagnostic console" | home §01 | Yes (four problems) but hides three of four | Replace with four short problem→outcome pairs visible at once |
| Bento grid with a fake delivery log | home §02 | Partly | Replace with one captioned scene (S3 "Persist before deliver") and four one-line rules |
| Bordered panel inside bordered panel inside bordered section | everywhere | No | Reduce to one container level; let whitespace separate |
| Small visored robot figure at 28–48 px, 11 instances on one page | home, success state | Weakly | Redraw and reduce to ≤ 2 per page (Section G) |
| Empty portrait frame | home "Principal engineer" | Defect | Fix: real portrait or no frame |
| Seven legacy-layout routes with Google Fonts and the older blue/glass style | offers, daily, crawler, maintenance, pickleball | Inconsistent | Migrate the public ones to the brand shell (pickleball keeps its own app surface inside) |
| Two headings per hero (eyebrow + H1 + lead + two buttons) as the only page opener pattern | every page | Repetitive | Vary: contact and legal pages open with the H1 and the form or the contents list |

### D.3 Typography and colour observations

- Display and body share one face (Space Grotesk); long-form uses Newsreader only on articles. Body text on navy at `--ink-2 #cbd5e1` is readable but the screenshots show low differentiation between heading levels on dense pages (Profile, write-ups).
- Magenta `#e100ff` is text-safe on navy (5.3:1 per ADR 0014) but is used for links, eyebrows, focus rings, numerals and the gradient, so it carries no hierarchy.
- Amber `#d97706` for "status" and green `#4ade80` for "ok" are UI-console colours imported into marketing copy, which is where the "dashboard" feel comes from.

---

## E. Competitive design research (what credible engineering firms actually do)

Observed 2026-11-12 by fetching the home pages; interpretation is judgment.

| Reference | What it does that matters here | Source |
|---|---|---|
| thoughtbot | H1 "When the stakes are high, experience matters."; ~40 words before the first case study; client logo wall; testimonial with a headshot; one CTA "Let's talk" repeated; flat illustration plus real photography; the robot mark is a logo, not a character on the page | https://thoughtbot.com |
| Test Double | H1 "Software problems are human problems."; services as question-led cards; testimonials with names, titles and headshots; playful props (rubber ducks) on a clean light layout; CTA "Ready to solve a real problem?" | https://testdouble.com |
| 8th Light | Declarative all-caps H1, four service blocks each with a verb-led hook, client and partner logo rows, dark background used with restraint; no team photos (a weakness for trust) | https://8thlight.com |
| PostHog | A B2B dev-tool brand carried by hedgehog characters used in hero art and docs, on a light, dense, witty layout; the character is a cast, drawn in one consistent illustration style, never a UI widget | https://posthog.com |
| Mailchimp (Freddie, 2018 Collins redesign) | The mascot was simplified for silhouette and small-size reproduction, kept central, and used in product moments (loading, errors, success) rather than everywhere; a hand-drawn illustration system sits beside it | It's Nice That, Design Week, Fast Company coverage (links in Appendix R-2) |
| GitLab (Tanuki) | A geometric logomark that doubles as the character; strict rules (full colour by default, one-colour alternatives, no strokes, no recolouring, brand-team approval for anything else) | https://design.gitlab.com/brand-logo/logomark |
| B2B mascot census (stfo.io, 2026) | Of ~30,000 B2B SaaS brands, 105 have a recurring mascot (fewer than 1 in 441 commercial brands); 61 % are animals, 13 are robots/AI personas; evidence supports "memory-efficient brand recall", not "wins deals"; "Strategy first. Mascot second." | https://www.stfo.io/research/b2b-mascot-census |

**What the references share.** A light or restrained canvas; one strong declarative headline about the client's situation; proof in the first screen (logos, a named testimonial, or a real artefact); one CTA wording; humans visible; illustration in one consistent hand; the mascot (where one exists) as a drawn character in a cast, not a UI badge. None of them uses a blueprint grid, a "live" status panel, or self-issued verification lines.

**Philippine and regional context (judgment).** Local SME buyers respond to a visible person, a visible place, a clear starting price or "from" range, and chat-first contact (Messenger, Viber, WhatsApp). International buyers respond to process clarity, time-zone overlap, written deliverables and contracts. The site should show both without pretending to be a larger firm.

## F. Brand identity strategy: three directions and the recommendation

All three directions keep: the scene library and its drawing rules, the token role names (`--paper`, `--ink`, `--ink-2/3`, `--rule`, `--redline`, `--ok`), the self-hosted font pipeline, the motion rules, the code-composed page model (ADR 0013), the inquiry pipeline, and the logo mark. They differ in canvas, accent use, illustration treatment and the role of the figure.

### F.1 Direction A — "Blueprint, edited" (refine what shipped in 2.5.0)

- **Thesis:** keep the dark engineering room, remove every template device.
- **Personality:** precise, nocturnal, confident. **Tone:** operations control room without the dashboard theatre.
- **Type:** Space Grotesk display and text; JetBrains Mono limited to figure captions and code.
- **Colour:** navy canvas without the grid; gradient only in the mark; buttons solid magenta with white text (needs a scrim or a darker magenta to pass 4.5:1, ADR 0014 notes 3.1:1 bare); amber and green return to UI-only.
- **Home composition:** problem-led hero with a static scene; four problem→outcome pairs; evidence strip with one real screenshot; audit offer; founder; one CTA.
- **Illustration:** the six scenes inverted on navy (they already draw with `currentColor`).
- **Mascot compatibility:** Node redrawn (Section G) survives on dark well.
- **Navigation:** as now, minus the glass blur.
- **Case study:** light screenshots framed in a paper-coloured plate.
- **Service pages:** unchanged structure, larger figures.
- **Contact:** unchanged form; add reply window, hours, time zone.
- **Responsive / accessibility:** already acceptable; dark canvas keeps the existing contrast budget.
- **Engineering complexity:** low (token values, five components, copy). **Maintenance:** low.
- **Commercial credibility:** improves, but stays inside the visual family of hundreds of AI-agency sites; Personas A and C still read "dev shop" before "business partner". Light screenshots keep clashing.

### F.2 Direction B — "Graphite on stone" (light, minimal, logo-aligned; dark hero band and exhibits) — RECOMMENDED AND CHOSEN (2026-11-13)

- **Thesis:** DevLab's identity is the precise working drawing: a calm, minimal engineer's sheet where the business problem is drawn, the system is drawn, and the evidence is pinned on. The drawings are clean geometric line diagrams on a grid, not sketches. The dark "engineering room" becomes a contained device (the home hero band and the exhibits) rather than the whole site, so technical authenticity is shown where it is real and the page itself stays approachable. The logo gradient is the only strong colour, so it stays special.
- **Personality:** careful, direct, precise, quietly confident; gender-neutral. **Tone:** a senior engineer's proposal, not a SaaS landing page.
- **Type:** Space Grotesk (display 500–600, text 400 at generous leading); Newsreader only for long-form; JetBrains Mono only inside figures, captions ("Fig. 03") and code. Three faces maximum, two on most pages.
- **Colour (locked, see N.1):** canvas cool stone `#f0eff3` (not white, not lavender), surfaces white, ink graphite-indigo `#15142a`, links and current state indigo `#4338ca`, the logo gradient on primary buttons, the hero rule and the nav underline; magenta appears alone only as the diagram redline, violet alone only as diagram numerals; `--ok` green for verified states; amber only inside exhibits. The home hero and the exhibits sit on graphite `#14122b`.
- **Homepage composition (storyboard in Section H):** a graphite hero band with the H1, one sentence, one gradient button on the left and the S1 scene (light strokes) on the right, closed by a 3 px gradient rule; below on stone, "Four ways work gets lost" as four short pairs with 24 px symbols; then one exhibit (the inquiry schematic, relabelled as an illustration) beside one real screenshot on a white mount; then three service lines as plain columns; then the audit offer card ("Quoted after a 30-minute call"); then a founder strip with a real photo; then a single closing CTA with the reply window. Density "Balanced": one idea per laptop screen, section rhythm 4–7 rem.
- **Illustration:** the existing symbol library and six scenes unchanged, drawn ink-on-paper at their native proportions; add the tall 4:5 phone crops that `scenes.md` lists as not yet drawn; two new scenes (Section H).
- **Mascot compatibility:** Node redrawn as an ink-line figure with one accent and a lamp head reads naturally in this language (Section G).
- **Navigation:** paper header, no blur, logo mark + wordmark, five links, one solid primary button; phone menu full-height paper.
- **Case study design:** exhibit layout: problem (plain), the drawing of the system (scene or project diagram), the real screenshot on a paper mount with a caption and a "what you are looking at" line, what changed, scope and responsibility line, one CTA.
- **Service pages:** the current structure with the figure first on phones, includes list, a single proof exhibit, FAQs as a plain list.
- **Contact:** paper form, dark success exhibit (the receipt with Node), reply window and time zone beside the form, Messenger/WhatsApp optional (owner decision).
- **Responsive:** phone shows the H1, one sentence, the button, then the scene; figures become full-width; exhibits scroll horizontally only inside their frame.
- **Accessibility:** paper/ink pairs are ≥ 12:1; accent pairs are verified by the token test; no colour-only status (every status also has a word or symbol).
- **Engineering complexity:** medium: token remap (one release did this in 2.5.0), button and nav restyle, five home components replaced or relabelled, scene crops, legacy routes migrated. No new runtime dependencies.
- **Maintenance:** low; one illustration language, no gradients to manage, screenshots fit the canvas.
- **Commercial credibility:** highest of the three for Personas A and C (light, readable, drawn like a proposal), unchanged for B and D (the exhibits keep the engineering voice), and clearly differentiated from the dark-AI-agency pattern.
- **Why it would or would not appeal to the target market:** Philippine SMEs and operations buyers read paper-and-ink as professional service material (proposals, audits); US and Australian technical buyers read dark exhibits as authentic. The risk is a perceived loss of "premium" if whitespace is not disciplined; the specification in Section N sets the grid and rhythm to prevent that.

### F.3 Direction C — "Field notes" (warm, human, photographic)

- **Thesis:** the studio as a person and a place: real photographs of the founder, the desk, Cebu; warm neutrals; a humanist serif; drawings as marginalia.
- **Type:** a serif display (e.g., Newsreader at display sizes) with a grotesk for UI.
- **Colour:** warm paper, charcoal, one terracotta or deep green accent.
- **Composition:** editorial, magazine-like; photography-led heroes.
- **Mascot compatibility:** low; a character sits oddly next to photography.
- **Complexity:** medium-high (photography production, art direction of real shots, image optimisation). **Maintenance:** high (every new page needs a photograph).
- **Credibility:** strong for local and relationship-driven buyers; weaker for technical buyers who want to see systems; risks reading as a consultancy rather than an engineering studio.

### F.4 Evaluation and recommendation

| Criterion (1–5) | A Blueprint, edited | B Drafting table | C Field notes |
|---|---|---|---|
| Visual originality | 2 | 4 | 4 |
| B2B credibility across all four personas | 3 | 5 | 3 |
| Clear messaging support | 3 | 5 | 4 |
| Memorable identity | 3 | 4 | 4 |
| Technical authenticity | 4 | 5 | 2 |
| Usability and accessibility | 4 | 5 | 4 |
| Engineering cost (5 = lowest) | 5 | 4 | 2 |
| Maintenance cost (5 = lowest) | 4 | 5 | 2 |
| **Total** | **28** | **37** | **25** |

**Recommendation: Direction B.** It keeps everything the 2.5.0 release got right (tokens, scenes, motion rules, code-owned pages, exhibits), removes everything that reads as generated, and gives the business a surface that the scene library was designed for. It is the only direction where the real screenshots, the drawn scenes and the dark exhibits all sit naturally on one page.

**Owner decision (Q-01, resolved 2026-11-13).** Direction B in the "Graphite on stone" variant is approved, with the gradient kept on primary buttons, the hero rule and the nav underline, a graphite hero band on the home page, and "Balanced" density. Direction A is no longer a fallback.

---

## G. Mascot decision

### G.1 Assessment of the existing Node (VERIFIED from `NodeMascot.jsx`, `brand.css:426–452`, screenshots)

| Aspect | Finding |
|---|---|
| Concept | "The DevLab routing engine": three plates derived from the logo's angle-bracket traces, ring terminals, a visor, four terminal "hands", data packets (file header). The concept is on-strategy: a router that holds, checks and hands off. |
| Connection to the logo | Real: the plate silhouette is the logo mark extruded. This is a genuine asset. |
| Silhouette | Weak. Three thin vertical shapes with a horizontal slit; at 48 px the figure is a coloured blur, at 28 px it is indistinguishable from an icon. Fails the solid-black silhouette test (a symmetric hexagonal bundle). |
| Colours | Magenta, gradient, blue plates; amber visor for "diagnostic"; white packets. On navy it depends on colour to read. |
| Face / expression | A visor slit with a white line. This is the generic AI-robot cue the brief forbids ("must not resemble a generic AI robot"). No eyes, no expression range beyond visor colour and a slate prop. |
| States | idle, active (visor pulse ×3, three packets for 4.8 s), diagnostic (amber visor + slate). Technically meaningful, visually subtle. |
| Animation | Honest and bounded (stops ≤ 5 s; reduced motion hides packets; `motion.ts` pauses SVG). Good engineering. |
| Accessibility | `role="img"` + title, or decorative. Good. |
| Hydration | None on Astro pages (static SVG); inside the React inquiry form island only. Good. |
| Usage | 11 instances on the home page; one in the form success state; none on other pages. Over-used where it appears, absent where it could carry meaning. |
| Consistency | One component, one drawing. Consistent by construction. |
| Professionalism | Reads as a small insect-robot; neither childish nor premium. |
| Memorability | Low at current size and detail. |
| Tests | 13 unit tests (roles, states, ids, byte budget, no hex). |

**Classification:** a useful starting point that needs artistic refinement. The logo-derived body and the router role are worth keeping; the head, the size tiers, the expression system and the usage rules are not yet a character system.

### G.2 Three directions compared

| Criterion | A Refine Node | B New technical character | C No character (symbol system) |
|---|---|---|---|
| Originality | Medium (logo-derived, unusual body) | Unknown until drawn; high risk of animal/robot convergence (61 % of B2B mascots are animals, 13 are robots) | Medium (the scene language is already original) |
| Brand recall | Medium–high if redrawn | Medium | Low–medium |
| B2B credibility | High if used sparingly | Depends | Highest |
| International suitability | High (abstract, culture-neutral) | Depends | High |
| Approachability | Medium (needs a face that is not a visor) | High | Low |
| Visual flexibility | High (three tiers possible) | High | High |
| Production cost | Low–medium (redraw in code, same component) | High (concepting, rounds, redraw) | Lowest |
| Accessibility | Proven | New | Proven |
| Scalability to SaaS products | High (each product gets a "Node at work" state) | High | Medium |
| Legal risk | "Node" as a word is generic and collides with Node.js; the figure is registrable as a figurative mark only | New name search needed | None |

**Recommendation: Direction A, refine Node, under four conditions.** (1) Redraw the head: replace the visor slit with a single round signal lamp (a ring terminal seen face-on) so expression comes from one lamp state, not a robot visor. (2) Define three fidelity tiers (24, 96, 240 px) and pass the solid-silhouette test at 24 px before any page uses it. (3) Cap usage at two instances per page and remove it from the console rows. (4) Keep the name "Node" as the character's name in copy ("Node, the DevLab router") but never as a standalone word mark; search and, if desired, register the **figure** only. If the redraw fails condition (2) in review, fall back to Direction C: keep the router glyph as the brand symbol without a face.

### G.3 Character design system (for Opus and an illustrator)

- **Name:** Node. In copy: "Node, the DevLab router" on first mention. Never "assistant", "bot", "agent".
- **Brand meaning:** the part of every DevLab system that receives, holds, checks and hands off, and never drops. Node is the embodiment of "persist before deliver" and "a person reads it": it holds the packet until a person takes it.
- **Shape language:** the logo's three plates (left and right angled, centre straight) form the body; proportions 96:112 as now; the centre plate is 1.6× the width of each side plate; ring terminals become the head lamp (one, centred, 14 units in diameter at the 96 tier) and two shoulder terminals; hands remain terminal dots.
- **Distinctive silhouette:** a tall narrow body with a single round head lamp and two angled side plates, like a lantern between two bookends. Test: fill black at 24 px; it must not read as a bug, a key, or a USB plug.
- **Primary form:** front-facing. **Three-quarter:** the near side plate widens by 20 %, the far one narrows by 20 %; the lamp stays centred. **Simplified (24 px):** centre plate + lamp + two side strokes, no terminals, no hands.
- **Colour rules:** ink lines on paper; the lamp is the only filled accent. Lamp states: unlit (ink outline) = idle; magenta (`--redline`) = holding/working; green (`--ok`) = handed off/confirmed; amber = needs a person. Never the gradient. On dark exhibits the lines invert to paper.
- **Expressions / states:** idle, holding (lamp lit, slate in hand), confirming (lamp green, slate stamped with the `check` symbol), needs-a-person (lamp amber, the `person` symbol beside). No mouths, no eyebrows, no tears, no thumbs-up.
- **Behaviour:** Node does one of three things: receives (a packet enters), holds (packet beside the body with a hand on it), hands off (packet moves to a `person` symbol). Node never speaks, never types, never points at a button, never covers content.
- **Illustration style:** 1.5-unit round-capped strokes from `Glyph.astro`, same grid as the scenes; no gradients, no shadows, no blur.
- **Approved placements:** home hero exhibit (one, as the router), audit offer card (one, holding the slate), inquiry success state (one, confirming), 404 page (one, idle), the future SaaS products' empty states. Optional: the Work write-up's "what it does" section (one, at the handoff).
- **Unacceptable uses:** headers, footers, nav, buttons, forms before success, cards in repetition, every console row, favicons (the logo mark is the favicon), social avatars, anything implying a live support agent.
- **Small-size variants:** 24 px simplified; 16 px not allowed.
- **Static variants:** every state has a static drawing; animation is additive.
- **Accessibility:** decorative by default (`aria-hidden`); `role="img"` with a state-specific title only where the state carries meaning the text does not ("Your inquiry has been saved" already says it, so the success Node stays decorative).
- **SaaS reuse:** each product may show Node in one state per screen family (empty, success, needs-attention); the same component, the same tiers.
- **Production and maintenance:** redrawn in code in `NodeMascot.jsx` (hook-free, same props: `state`, `size`, `tier` added); a static SVG export per state and tier in `public/branding/node/`; a one-page character sheet in `docs/brand/node.md` listing the locked features (plate ratio, lamp diameter, stroke weight, hand dots, no visor).

### G.4 Motion and interaction specification (additional requirement)

| Topic | Specification |
|---|---|
| Idle appearance | Static. No breathing, blinking, floating or hovering. |
| Recognisable movements | Three only: **receive** (a 2-unit packet travels into the body along the centre plate, 600 ms, `--ease-draw`); **lamp change** (lamp fill transitions 200 ms); **hand-off** (the packet moves from the body to the adjacent `person` symbol, 800 ms, then the lamp turns green). |
| Triggers | Initial appearance: none (static). Home exhibit: "receive" runs once when the exhibit scrolls into view (IntersectionObserver, threshold 0.5), and once more per click of the simulation toggle. Audit card: static. Inquiry success: "hand-off" runs once when the success state mounts. 404: static. |
| Timing | Each sequence ≤ 1.2 s; never repeats on its own; total motion per page view ≤ 3 s; no `repeatCount="indefinite"` even with an `end` (replace the current SMIL loops with single runs). |
| Stop conditions | Sequence end; `prefers-reduced-motion: reduce` (sequence does not start, final frame shown); page hidden (`visibilitychange` pauses). |
| Placement | Home hero exhibit (right column, desktop; below the H1 and button on phones), audit card, success state, 404. Nowhere else. |
| Technical implementation | Static SVG inline from `NodeMascot.jsx` (no hydration on Astro pages); state via `data-state`; lamp transitions in CSS; packet motion as CSS `offset-path` on a `<circle>` (preferred over SMIL for pause/reduced-motion control and CSP consistency) with the existing `respectReducedMotion()` helper; inside the React form island the same component renders with `state="confirming"` after the server-confirmed write. No animation library. |
| Accessibility | `aria-hidden` unless the state carries meaning; the success message text, not the figure, announces the result (`aria-live="polite"` already on the status); no focusable parts; the figure never overlaps form controls or the primary CTA; the home exhibit keeps its `<title>`. |
| Brand consistency | One component, one drawing per state and tier, a snapshot test per state and tier (SVG markup), a byte budget ≤ 6 KB per state, the token test forbidding hex and `infinite`. |

### G.5 Intellectual property and originality

- Run preliminary searches before any registration or heavy investment: WIPO Global Brand Database (https://branddb.wipo.int) for the word "Node" and for figurative marks in Nice classes 42 (software services) and 9; IPOPHL's trademark search (WIPO Publish, linked from https://www.ipophil.gov.ph) for Philippine marks; a plain web and app-store search for "Node" mascots in developer tooling (expect collisions with Node.js and NodeBB).
- Expect the word "Node" alone to be unregistrable or weak for software services; protect the **figure** (figurative mark) and the **combined** "DevLab Studios + figure" lock-up instead, filed through IPOPHL eTMfile (the filing date is the date full payment is made; multi-class fees multiply by class per IPOPHL's FAQ).
- Get a written assignment of rights for any illustrator's work; keep the SVG source in the repository with a `docs/brand/node.md` ownership note. AI-generated drafts are not committed as production assets (existing rule in `scenes.md`).
- When to involve a practitioner: before filing, before using the figure on merchandise or a SaaS product, and if any search returns a visually similar figure in classes 9/42.

---

## H. Visual storytelling specification

### H.1 Scene inventory and reuse

Existing (approved 2026-11-12, `src/config/scenes.ts`, drawn in `SceneArt.astro`): S1 Fragmented intake, S2 The connected system, S3 Persist before deliver, S4 Handoff to a person, S5 Build in layers, S6 Workflow audit. Current reuse problem: S5 "Build in layers" is the figure on About, on the custom-software line, and as `Fig. 01` of every write-up without a project diagram (VERIFIED on `/work/memory-preview`). Rule: a scene appears once per page and a write-up uses its own project diagram or none.

New scenes required (same symbol library, same rules):
- **S7 Human-controlled automation:** a row of `process` symbols with `check` marks, one `warning` item leaving the row to a `person` with a name badge, and returning stamped. Objective: show where automation acts and where a person decides.
- **S8 The receipt:** a `form` symbol → `ledger` row with a `stamp` → `envelope` to a `person`. Objective: what happens after you send an inquiry (used on Contact and in the confirmation email as a static PNG).
- **Project diagrams D-1…D-4:** one per write-up, drawn from the real architecture (Memory Preview: ChatGPT → MCP bridge → proposal → human approval → GitHub; lead qualification: intake → normalise → Retell call → sheet → human follow-up; buyer intelligence: sources → geocode → rank → shortlist → review; Messenger agent: message → rules → AI reply draft → handoff). Each shows the human step with the `person` symbol and the persistence step with the `ledger`.
- **Phone crops:** the 4:5 crops that `scenes.md` lists as not drawn, for S1–S4 and S6.

### H.2 Storyboards

**Home, screen 1 (hero).**
- Sees: H1 "Business systems that don't quietly lose work." (proposed copy, Section I), one sentence, one solid button, and to the right the S1 scene at 560 px: four inboxes (form, email, chat, phone) feeding four separate places with a redline on the one with no owner.
- Represents: the buyer's current state.
- Composition: 7/5 columns; the scene is not in a panel; the caption sits under it in small text.
- Brand: ink on paper, one redline.
- Interaction: none (draw-in once, 600 ms).
- Understands afterwards: "they fix the problem of work falling between tools."
- Phone: H1, sentence, button, then the 4:5 crop full width.
- Accessibility: `role="img"` with the registry alt text; caption in HTML.
- Production: existing S1 plus the phone crop.

**Home, screen 2 (four ways work gets lost).**
- Sees: four short pairs side by side (phone: stacked), each with a 24 px symbol (`inbox`, `clock`, `sheet`, `form`), a one-line problem and a one-line "what we do instead".
- Interaction: none (replaces the tabbed console).
- Production: existing symbols.

**Home, screen 3 (the exhibit).**
- Sees: on the left a dark exhibit panel titled "How an inquiry moves through a DevLab system (illustration)" with the four checkpoints and Node at the route step; a "Show what happens when a webhook fails" toggle; on the right the real inquiry-admin screenshot (synthetic data) captioned "The same rule running this site's own form."
- Represents: reliability and recovery (brief scene D), truthfully labelled.
- Interaction: the toggle (kept from 2.5.0, relabelled; one "receive" run per click).
- Production: existing `HeroPipelineVisualizer` moved out of the hero and relabelled; one new screenshot with synthetic rows.

**Home, screen 4 (three service lines).** Three plain columns, each with its scene's 24 px symbol, the problem sentence, and a link. No cards.

**Home, screen 5 (the audit).** A printed offer card on paper: title, what you receive (three lines), "from" price or range (Q-02), "A written recommendation whether or not you build with us", button. Node holding a slate at 96 px, right-aligned.

**Home, screen 6 (the founder).** Real portrait (fix the empty frame), two sentences, links to Profile, LinkedIn and GitHub.

**Home, screen 7 (closing).** One line, one button, the reply window and time zone beside it.

**Solutions line pages.** Hero with the line's scene first on phones; includes; one proof exhibit (write-up screenshot on a paper mount); FAQs.

**Workflow audit page.** S6 at the top; "what you receive" as a numbered list with a sample page thumbnail of a real (redacted or synthetic) audit document (Q-03); price line; three steps; FAQs.

**Work write-ups.** D-x diagram first, then the real screenshot on a paper mount with a "what you are looking at" caption, then text; Node at the hand-off step only if the diagram has one.

**Contact.** S8 beside the form on desktop (under it on phones); after a saved inquiry, the dark success exhibit with Node confirming and the exact next steps.

### H.3 Artwork guidelines (binding)

- 48-unit grid, 1.5-unit strokes (2 for emphasis), round caps and joins; fills only `--paper`/`--paper-2`; no gradients, shadows, blur, or raster effects.
- Redline marks one wrong thing per scene; `--ok` marks one verified thing per scene.
- Text inside art: mono labels ≤ 12 characters; meaning in the HTML caption.
- Byte budget per scene ≤ 12 KB (registry field); project diagrams ≤ 16 KB.
- Every scene: desktop (16:10 or 3:2) and phone (4:5) crops; alt text ≤ 160 characters; caption ≤ 140 characters.
- Screenshots: real systems only, client data removed or replaced with synthetic rows, exported at 2× for a 720 px display width, WebP ≤ 180 KB, with a visible "data shown is synthetic" line when applicable.
- Motion: draw-in once on first view (600 ms); nothing loops; reduced motion shows the finished drawing.

## I. Website content and copy audit

### I.1 Findings (VERIFIED)

- **Volume is already disciplined** (home ~700 words against a 900 budget; most pages 200–450). The problem is not length but **register and sequence**: the home page spends its first 400 words on engineering rules before a buyer's outcome.
- **Jargon on `/`** (quote, `content.js`): "No brittle wrappers", "Failure vector", "Node verification", "deterministic sync", "typed integration contracts", "SQL persist", "unmonitored black box", "zero re-keying on the audited path". None of this appears on `/solutions`, which is written for buyers. The two pages were written for different readers.
- **Six wordings for one action** ("Discuss Your System", "Discuss your system", "Discuss your intake/workflow/build", "Discuss a similar system", "Discuss something similar", "Discuss an Automation") and three for the audit ("Request a Workflow Audit", "Request the audit", "Start with the audit"); "Request the audit" on `/insights` opens the details page, not the form (`insights.astro:72`).
- **Repeated explanations:** the four delivery steps appear on `/solutions` and `/about`; the four principles appear on `/` (bento) and `/about`; "a person reads every inquiry" appears on seven pages.
- **Mono eyebrows read aloud** ("section sign zero one failure modes", "left bracket devlab studios bullet…"), release log minors.
- **Profile** mixes first and third person; experience bullets include "Troubleshooted" and "applying creative, technologically advanced solutions" (`experiences.js:17,63,66`); the two tag clouds repeat tools.
- **Write-up leads** are 70-word architecture sentences used as both lead and meta description (`work.ts:29`).
- **Legal pages:** Privacy's "pending legal review" and Terms' "illustrative purposes" lines (Section C.3).
- **Missing content:** reply window, hours and time zone; what the audit costs or its range; what "Operations Care" is (listed in the form, described nowhere); scope and responsibility boundaries on write-ups; a retainer/maintenance page; a sample deliverable.

### I.2 Writing standards (binding)

Outcome before mechanism. Short declarative sentences. No "unlock", "revolutionize", "cutting-edge", "empower", "seamless", "next-generation", "supercharge", "leverage", "robust", "brittle wrappers", "black box", "deterministic" (outside Technical notes), "failure vector". Numbers only where evidenced. The founder is named once per page (existing rule). One primary CTA label site-wide (Section K). Section labels are plain words in the text face ("The problem", "What we build"), not numbered mono tags. Legal pages and articles keep whatever length they need.

### I.3 Page-by-page copy strategy

| Page | Heading (proposed) | Supporting explanation | Key benefit | Proof needed | Primary CTA | Secondary CTA | Remove or relocate | Visual |
|---|---|---|---|---|---|---|---|---|
| `/` | "Business systems that don't quietly lose work." | "We design, build and run the software that connects your inquiries, records and tools, and we make sure nothing falls between them." | Work does not get lost; someone always owns it | One real screenshot; one scene; founder photo; the audit offer with a price line | "Talk to us about your system" | "See the work" | The console tabs, the bento, `VERIFIED` lines, `SYS-` cards, the hero eyebrow; move the reliability rules to About; move "Three service lines" lower | S1 hero; four symbols; one exhibit + screenshot; Node on the audit card |
| `/solutions` | "Three kinds of system, one way of working." | Keep the current problem sentences | Pick the line that matches your problem | Each line's write-up screenshot | "Talk to us about your intake/workflow/build" | "What this includes" | The four delivery steps (keep on About only) | S1, S2/S4, S5 figures at 560 px |
| `/solutions/<line>` | Keep | Keep | Keep | One exhibit, not a card | Line CTA | "Read the write-up" | Second CTA paragraph duplication | Figure first on phones |
| `/solutions/workflow-systems-audit` | "A written plan for one workflow, before you build anything." | Keep "what you receive" | Decide with evidence; use the plan with anyone | A sample page thumbnail (Q-03); price line (Q-02) | "Request the audit" | "Ask a question first" | — | S6; Node holding the slate |
| `/work` | "Systems we have built, described honestly." | Keep the evidence note | Real systems, real screenshots | Screenshots on paper mounts; a scope line per entry | "Read the write-up" | "Talk to us about something similar" | The second CTA on every card (keep on the write-up) | D-x thumbnails |
| `/work/<slug>` | Project title | "Who it was for (type of business), what was wrong, what we built, what it does now, what we were and were not responsible for" | Outcome where evidenced; otherwise "what it verifiably does" | Diagram, 1–3 screenshots, a dated "in operation since" line if true | "Talk to us about something similar" | "Back to work" | The 70-word architecture lead (move to Technical notes) | D-x, screenshots |
| `/about` | "A small studio that runs the systems it builds." | Founded, where, who, how; the four principles in plain words; how a project runs; what is and is not offered (Section K.2) | Clear expectations | Founder photo; "what working with us looks like" list | "Talk to us about your system" | "Founder profile" | — | S5 |
| `/profile` | Name | Third person throughout; one tag cloud; four roles with all bullets; links | Evaluable in two minutes | GitHub, LinkedIn, résumé, write-ups | "Contact Stephen about a role" | "Discuss a contract or collaboration" | Duplicated tags; "Troubleshooted"; "creative, technologically advanced" | Portrait |
| `/contact` | "Tell us what is going wrong. A person reads it." | "You get a receipt right away; the reply itself comes from Stephen, within N business days, Monday–Friday, 9:00–18:00 Philippine time (UTC+8)." (Q-04) | Nothing lost; a real reply | S8; the saved-first promise | "Send" | mailto; optional Messenger/WhatsApp (Q-05) | "Nothing is auto-replied and closed" | S8; success exhibit |
| `/products` | Keep | Keep | Live product proves the practice | Link to the product; a real screenshot with synthetic data | "Open Devlab Pickleball" | "Register interest" | — | Product screenshot |
| `/insights` | Keep | Keep | — | — | "Request the audit" → the form (fix) | "Get the checklist" | — | — |
| `/privacy`, `/terms` | Keep | Complete legal review (Q-06); align Terms with Work | Trust | Legal name | — | — | "pending legal review"; "illustrative purposes" | Contents list |
| `/404` | "That page is not here." | One line; four links | Recovery | — | "Home" | Solutions, Work, Contact | — | Node idle |

### I.4 Production-ready sample copy (PROPOSED, not approved; no facts invented)

**Home hero**
> **Business systems that don't quietly lose work.**
> We design, build and run the software that connects your inquiries, records and tools, so nothing falls between them and someone always owns the next step.
> [Talk to us about your system] [See the work]

**Home, four ways work gets lost**
> **An inquiry comes in and sits.** We record every inquiry once, give it an owner, and keep it visible until it is handled.
> **A scheduled job fails at night.** We log every attempt and alert a person, so a failure is found by you, not by a customer.
> **Three tools hold three versions of the customer.** We keep one system of record and move data between tools by code.
> **The same details are typed in twice.** We let people approve what needs approval and never re-type what the system already knows.

**Home, the exhibit caption**
> **How an inquiry moves through a DevLab system (illustration).** It is saved first, then delivered, then handed to a person. If a delivery fails, the inquiry is kept and retried, and someone is told. This site's own form works this way.

**Home, the audit card**
> **Workflow Systems Audit.** A fixed-scope review of one workflow, ending in a written recommendation you can act on, with or without us. [price line per Q-02] [Request the audit] [What you receive]

**Home, founder strip**
> **Stephen Rey Agustinez** designs the system, writes the code, documents the failure paths and answers your email. DevLab Studios is his studio in Cebu, Philippines, working with businesses in the Philippines, the United States and Australia [Q-07: confirm the markets that can be stated].

**Contact aside** (Q-04 resolved: 1 business day)
> You get an automatic receipt as soon as your inquiry is saved. The reply comes from Stephen within one business day. Hours: Monday to Friday, 9:00–18:00 Philippine time (UTC+8); calls in US and Australian hours by arrangement.

**Success state**
> **Saved.** Your inquiry is recorded and a receipt is on its way to [email]. Stephen reads it next and replies by email with the clearest next step: usually a short call or a scoped recommendation.

---

## J. Complete page architecture

### J.1 Route classification

| Route | Class | Justification |
|---|---|---|
| `/` | 2 Substantially redesign | Register, sequence, surface (Sections C, D, I) |
| `/solutions` | 1 Retain and refine | Structure right; figures larger; delivery steps removed |
| `/solutions/<line>` ×3 | 1 Retain and refine | Exhibit instead of proof card; phone figure order |
| `/solutions/workflow-systems-audit` | 1 Retain and refine | Add price line, sample thumbnail |
| `/solutions/operations-care` (new) | New | The form lists "Operations Care"; no page describes it (Q-08 to confirm the offer) |
| `/work` | 1 Retain and refine | Paper mounts, scope lines, one CTA per card |
| `/work/<slug>` ×4 | 2 Substantially redesign | Exhibit layout, own diagram, scope section, Article/CreativeWork schema |
| `/about` | 1 Retain and refine | Absorb the reliability rules; add "what working with us looks like" |
| `/profile` | 1 Retain and refine | Voice, tags, bullets |
| `/contact` | 1 Retain and refine | Copy, reply window, S8, success exhibit; the form and pipeline untouched |
| `/products` | 1 Retain and refine | Screenshot |
| `/insights`, `/insights/<slug>` | 1 Retain and refine | Byline/schema alignment; fix the audit link |
| `/insights/daily` | 3 Consolidate onto the brand shell | Keep the route and noindex; migrate from the legacy layout |
| `/offers/<slug>` | 3 Consolidate onto the brand shell | Keep; migrate; the form is unchanged |
| `/privacy`, `/terms` | 1 Retain and refine | Legal review (Q-06) |
| `/404`, `/maintenance` | 1 Retain and refine | Maintenance moves to the brand shell; remove the fixed "within the next few hours" promise |
| `/pickleball`, `/how-it-works`, `/rotation` | 4 Preserve as a product experience | Product marketing pages move to the brand shell (nav/footer) while the app screens keep `PickleballAppShell` |
| `/crawler` | 1 Retain | Plain and factual; migrate shell |
| `/brand` | 1 Retain (internal) | Add Node tiers and states |
| `public/haosweetitis/` | 5 Retire from the business domain | A personal invitation served from the company host (noindex, but discoverable); move to a personal domain (Q-09) |
| `/resources*`, `/services`, `/process`, `/landing-sample-*` | Redirects, retain | Frozen legacy URL fixture (`tests/fixtures/legacy-sitemap.txt`) |

### J.2 Navigation

- Header: logo mark + "DevLab Studios"; Solutions · Work · About · Insights · Profile (About before Insights: buyers look for the company before articles); one solid primary button "Talk to us" (phones: "Contact"). Products stays in the footer.
- Footer: identity line, email, location with time zone; Explore (Solutions, Work, About, Insights, Contact); Products; Connect (LinkedIn, GitHub; Facebook only if the page is maintained, Q-10); "Hiring? Contact Stephen" → `/contact?type=employment_opportunity` (fix); Privacy, Terms.
- Breadcrumbs on write-ups, articles and solution lines (already present).

### J.3 Global components (shared)

`BrandLayout`, `BrandNav`, `BrandFooter`, `PageHeader`, `Section`, `Figure`/`SceneFrame`, `Exhibit` (new: the dark panel wrapper with a title, caption and optional toggle), `ProofMount` (new: screenshot on a paper mount with caption and "what you are looking at"), `OfferCard` (new: the audit card), `FounderStrip` (new), `Button` (solid primary, outline secondary, text link), `Field`/`InquiryForm` (unchanged logic), `Tag` (reserved for Technical notes), `NodeMascot` (redrawn), `FaqList`, `Disclosure`, `Table`, `LegalPage`.

Removed from public pages: `FailureDiagnosticConsole`, `ReliabilityBentoGrid`, `CaseStudyShowcase` (replaced by `ProofMount` lists), `ProofStrip`, the grid background, the header blur. `HeroPipelineVisualizer` becomes the home exhibit content.

## K. Trust and conversion strategy

### K.1 What the site must explain (and how, without inventing SLAs)

| Topic | Today | Required (plain statement, no guarantee language) | Where |
|---|---|---|---|
| Service scope | Three lines, stated | Keep; add "what we do not do" (no staffing/outsourcing, no generic marketing, no unmanaged AI chatbots) | About |
| Types of business served | Implied | Sector examples drawn from the real write-ups (real estate operations, service businesses, clubs); markets stated only where true (Q-07) | Home founder strip, About |
| Engagement model | Audit → build in phases → hand over | Keep; add that the audit is fixed-scope and quoted, builds are quoted per phase, and ongoing support is a separate arrangement | Audit page, About |
| Discovery and requirements | "Map the workflow" | Say what the first call is (30–45 minutes, free, no deck) and what the client prepares (access to the people who run the process) | Audit page, Contact |
| Architecture and implementation | Rules | "A written recommendation with a drawing before code; each phase tested before the next depends on it" | About |
| Delivery and acceptance | "Hand it over" | "Each phase ends with a walkthrough and a written list of what is now true" | About |
| Documentation, ownership and handover | Implied | "You own the code, the data and the accounts; we hand over documentation and the failure paths written down" (confirm ownership terms, Q-11) | About, Terms |
| Maintenance and support | Absent | Describe "Operations Care" honestly: monitoring, a monthly check, fixes within agreed hours; no uptime figure unless measured (Q-08) | New page |
| Change management | Absent | "Changes are proposed in writing, agreed, then shipped through a preview you can see" | About |
| Confidentiality and data handling | Absent | "NDA on request; client data is removed from anything we publish; production access is scoped and revoked at handover" | About, Privacy |
| Commercial communication | Email only | Reply window, hours, time zone; optional scheduling link (Q-05) | Contact |
| Risk management | "Failure paths written down" | Keep; add "one person runs this studio; for continuity every system is documented so another engineer can take it over" | About |

### K.2 Case-study layout (binding for `/work/<slug>`)

1. Title and one-sentence plain summary (who it was for, in type, and what it does).
2. **The situation:** 2–3 sentences, the business context.
3. **The problem:** what was going wrong, in the client's terms.
4. **What we built:** the D-x diagram, then 3–5 sentences.
5. **Decisions that mattered:** 2–4 bullets (why rules not AI for routing, why a sheet not a CRM, etc.).
6. **What it does now:** verified functional statements; an outcome only with evidence and consent; otherwise "Operational results are the client's and are not published."
7. **Screenshots:** 1–3 on paper mounts, each with "what you are looking at".
8. **Scope and responsibility:** what DevLab built, what the client or other vendors own, what is maintained and by whom.
9. **Technical notes:** collapsed; stack tags live here.
10. **CTA:** "Talk to us about something similar".

### K.3 Primary conversion action

- **Recommendation:** one site-wide primary label, **"Talk to us about your system"** (header short form "Talk to us"; phones "Contact"), linking to `/contact?type=business_system`; the audit keeps its own label **"Request the audit"** everywhere and always links to the form with `type=workflow_audit`. Reasons: "Discuss Your System" assumes the visitor has a "system"; "Request a Workflow Review" narrows to the audit; "Book an Initial Consultation" promises a booking flow that does not exist; "Get a Project Assessment" implies a paid deliverable. "Talk to us" commits the visitor to a conversation, which is what the pipeline actually delivers.
- **Measurement:** the existing `inquiry_persisted` GA4 event (server-confirmed) is the conversion. Add `cta_click` with `label` and `page` parameters on every primary CTA (already partly present via attribution `formId`), and compare persisted-inquiry rate per 1,000 sessions for the four weeks before and after the label change; the label is reverted if the rate falls. Wording alone is not assumed to lift conversion; the change is bundled with the price line, the reply window and the trust copy, and attribution records which page and CTA the inquiry came from (`lead_attribution`, already stored).

### K.4 Contact accessibility for Philippine and international prospects

- Business email (`hello@`), the form, LinkedIn and GitHub: present. Add the time zone, hours and the one-business-day reply window. Q-05 resolved: email and form only; no scheduling or chat links in this release. The `scheduling_url`, `messenger_url` and `whatsapp_url` settings (CMS-02) are still created, nullable, so a channel can be switched on later without code.
- Anti-spam: Turnstile on step 2, rate limiting, idempotency (keep). Fallback: `mailto:` and the receipt email.
- Confirmation: the on-screen success state and the receipt email already say the right things; add the reply window once decided.
- Never publish a personal phone or address (existing rule in `company.js`).

### K.5 Preserve the inquiry architecture (binding)

Unchanged by this specification: `/api/inquiries`, `/api/contact`, `/api/lead-magnet`, `submitInquiry()` order (rate limit → anti-spam → normalise → idempotency → persist → consent + attribution → qualify → background delivery), `inquiry.ts` shared schema, `delivery_attempts`, admin retry, confirmation recipients, the Lead Intelligence Engine, the mailbox, the cron. The redesign touches only `InquiryForm.jsx` presentation (labels, success exhibit), `contact.astro`, and the confirmation email's wording for the reply window. Guard tests in `tests/` that assert the persist-before-deliver order must stay green.

---

## L. SEO and discoverability

### L.1 Technical state (VERIFIED)

Canonical host and HTTPS redirects; per-route robots meta and header; request-time sitemap with 37 URLs; Organization (with address, email, founding date, founder `@id`), WebSite, Service, Person, Article, BreadcrumbList, FAQPage; per-page social cards 45–59 KB; hashed CSP; Lighthouse 92–97 mobile; edge HTML cache. The technical base is sound. Gaps: write-ups carry only BreadcrumbList; the `/products` SEO record and code fallback disagree; the home SEO title in the record still reads "Operations software that holds up" (release log); Article `author` is the founder while the byline says "DevLab Studios"; Google Search Console ownership is UNKNOWN (not verifiable from the repo).

### L.2 Strategy (prioritised; no blog-volume play)

1. **Search Console and Business Profile.** Verify the domain in Search Console; create a Google Business Profile as a service-area business in Cebu (no storefront), matching `company.js` exactly (name, email, city); this is the single highest-leverage local step and costs nothing (owner action, Q-12).
2. **Buyer-intent pages, not more articles.** The three service lines and the audit already target intent. Add `/solutions/operations-care` (maintenance intent) and, only when there is a real write-up to anchor each, two sector pages drawn from the work ("real estate operations automation", "service business lead intake"); each must link to a write-up and must not claim a regional office.
3. **Write-up schema.** `CreativeWork` or `Article` with `about`, `dateCreated`, `author` → Person, `publisher` → Organization, plus `ImageObject` for the screenshot.
4. **Consistency.** One name, one email, one city, one founding date across site, schema, LinkedIn company page, GitHub organisation profile, Facebook page, Clutch/GoodFirms listings (only if the owner maintains them, Q-10).
5. **Founder visibility.** Profile keeps Person schema; LinkedIn and GitHub profiles should link back to `/profile` and `/`; GitHub organisation `stpn-dev` should pin the public product repositories if any are public (UNKNOWN).
6. **Internal linking.** Every write-up links to its service line and vice versa (partly present); every article's "related service" sidebar stays; the home links to all four write-ups.
7. **Insights.** Keep the fifteen problem-led articles; add only articles that document a real operational problem seen in the work; keep the daily digest noindex.
8. **Directories and communities (owner actions):** Clutch/GoodFirms listing with the real write-ups; Philippine startup and SME communities; n8n community showcase for the automation write-ups; nothing paid without a decision.

---

## M. CMS and technical architecture

### M.1 Current dependencies (VERIFIED, re-confirmed against the prior audit's Section B.3)

One Worker, one CMS database shared by five systems: marketing CMS tables (`pages`, `page_sections`, `projects`, `project_gallery_images`, `articles`, `resources`, `service_groups`, `faqs`, `certifications`, `experiences`, `skills`, `tools`, `workflow_items`, `navigation_items`, `site_settings`, `seo_metadata`, `redirects`, `media_assets`, `content_versions`, `testimonials`, `case_studies`), shared `audit_log`, admin auth (`admin_session_revocations`, `admin_credentials`), inquiries (`leads`, `delivery_attempts`, `lead_attribution`, `lead_consents`, `lead_activities`, `confirmation_recipients`), 22 `lead_*` Lead Intelligence tables, 5 `mailbox_*` tables with hard foreign keys into `lead_*`, `digests`/`digest_items`, `job_runs`. Middleware reads `site_settings.maintenance_mode` and `redirects`. The lead engine and mailbox reference no CMS table. Since 2.4.0 the marketing copy for Home, Solutions, About, Products, Contact and the Insights frame is **code-owned** (`content.js`, ADR 0013); the CMS owns Work narratives and projects, articles, SEO records, navigation and footer, the founder profile and the legal pages.

### M.2 Decision matrix (revalidated 2026-11-12)

| Option | Fit with Astro + Workers + D1/R2 | Editing need met | Migration risk | Cost | Verdict |
|---|---|---|---|---|---|
| **Retain the custom CMS** (control) | Native | Yes for everything the CMS still owns; marketing copy is code by design | None | $0 beyond current Workers usage | **Retain** |
| EmDash (Cloudflare's open-source Astro CMS, 1.0 Sept 2026, D1 + R2) | Native, same stack | Yes for editorial; no draft preview parity verified; small plugin ecosystem; reviewers disagree on D1 for production | Medium: two admin surfaces or a rewrite of the operational admin; `audit_log`, auth and middleware coupling | Free software; Workers Paid for sandboxed plugins | Conditional second choice (unchanged from the prior audit) |
| Payload | Needs Next.js; Cloudflare template requires Workers Paid; D1 via a Cloudflare-built adapter; 2026 deployment pause reported by one source | Yes | High (separate app) | Paid plan | Reject |
| Directus / Strapi | Separate Node service or cloud plan; Postgres | Yes | High | Monthly cloud fee | Reject |
| Keystatic | Git-based; Workers OAuth issues reported; no D1 | Partly | Medium | Free | Reject for this operating model |

**Decision: retain the custom CMS.** The redesign needs no new editable content types; the four-place sync problem is already contained by ADR 0013; the operational systems share the database and admin; and the only reachable editorial gaps (markdown preview, draft links) were closed in releases 2.3–2.4. Re-open the EmDash option only if the triggers in the prior audit's Section E.2 occur (a second editor, weekly copy changes, or a product needing its own CMS).

### M.3 What the redesign changes in the CMS (minimal)

- `projects` / work narratives: add `scope` (text), `decisions` (list), `situation` (text), `inOperationSince` (date, nullable), `diagramId` (scene registry id) through migration `0020` (additive, nullable); admin form fields; read path; static fallback. Four places, one change.
- `site_settings`: add `reply_window_days`, `business_hours`, `time_zone_label`, `scheduling_url`, `messenger_url`, `whatsapp_url`, `audit_price_line` (all nullable; defaults in code = today's "not stated"). These are business settings, not code.
- `seo_metadata`: update the home title and the products description through a dated guarded `UPDATE` script applied preview-first.
- Nothing moves, nothing is dropped; the full seed is never run against a populated database (AGENTS.md).

### M.4 Target technical architecture (unchanged in shape; refined)

Public marketing layer (Astro pages, brand shell, edge HTML cache) → content layer (custom CMS in `/admin`, D1, R2) → operations layer (inquiries, lead engine, mailbox, digests; untouched) → product layer (Pickleball in the same Worker today; the prior audit's product-Worker split remains a separate, owner-gated decision) → infrastructure (CI, preview, backups, migration check). This specification adds: a `tier` and `state` snapshot test for Node, a visual-regression capture job on preview for twelve routes at three widths (the `capture.mjs` script exists), and a Lighthouse CI budget on preview.

### M.5 Migration safety and rollback

Every token change is a commit in `brand.css` and `tailwind.config.js` (rollback = revert). Every component replacement keeps the old component in the tree until the page tests pass, then deletes it in a separate commit. Migration `0020` is additive; its rollback is "stop reading the columns". Settings rows are inserted with `INSERT … WHERE NOT EXISTS`. Production D1 writes require the owner's token for that one command, read-before-write, read-after-write (AGENTS.md).

---

## N. Design-system specification (Direction B, "Graphite on stone"; owner-approved 2026-11-13)

### N.1 Tokens (`src/styles/brand.css`; names unchanged, values new)

```css
:root {
  --paper: #f0eff3;        /* canvas: cool stone, not white, not lavender */
  --paper-2: #ffffff;      /* mounts, form fields */
  --ink: #15142a;          /* graphite indigo: headings, body (≥ 14:1 on paper) */
  --ink-2: #3f3d5a;        /* secondary text (≥ 8:1) */
  --ink-3: #6d6b87;        /* captions, labels (≥ 4.6:1; verify) */
  --rule: #d5d3df;         /* hairlines */
  --redline: #c400de;      /* diagram redline only (the one wrong thing); verify ≥ 4.5:1 on paper for the few label uses */
  --link: #4338ca;         /* links, current nav item, focus ring (≥ 7:1 on paper) */
  --violet: #7b2cbf;       /* diagram numerals and secondary strokes only */
  --ok: #1f7a4d;           /* verified / connected */
  --amber: #b45309;        /* exhibits only */
  --brand-gradient: linear-gradient(135deg, #e100ff 0%, #7b2cbf 50%, #0048ba 100%);
  /* gradient use is limited to: the logo mark, .dl-button-primary, .hero-rule, the current-nav underline */
  --button-scrim: rgba(21, 20, 42, 0.10); /* over the gradient so white text passes 4.5:1 at the magenta end (2.5.0 measured ~6:1 rest) */
  /* graphite surface for the home hero band and exhibits, applied by .ink-panel */
  --exhibit-paper: #14122b; --exhibit-paper-2: #1d1b36; --exhibit-ink: #f2f1f6; --exhibit-ink-2: #c6c4d6; --exhibit-ink-3: #9492ad; --exhibit-rule: #2b2947; --exhibit-link: #a5b4fc;
  --font-display: 'Space Grotesk', 'Space Grotesk Fallback', system-ui, sans-serif;
  --font-label: 'JetBrains Mono', 'JetBrains Mono Fallback', ui-monospace, monospace;
  --font-longform: 'Newsreader', 'Newsreader Fallback', Georgia, serif;
  /* type scale unchanged: --step--1 … --step-5 */
  --section-rhythm: clamp(4rem, 7vw, 7rem);   /* "Balanced" density */
  --container: 72rem; --gutter: 1rem;
  --radius-xs: 2px; --radius-s: 4px; --radius-m: 6px;
  --duration-ui: 200ms; --duration-draw: 600ms; --ease-draw: cubic-bezier(0.2, 0.7, 0.2, 1);
}
.ink-panel { --paper: var(--exhibit-paper); --paper-2: var(--exhibit-paper-2); --ink: var(--exhibit-ink); --ink-2: var(--exhibit-ink-2); --ink-3: var(--exhibit-ink-3); --rule: var(--exhibit-rule); --link: var(--exhibit-link); }
.hero-rule { height: 3px; background: var(--brand-gradient); } /* closes the home hero band */
```

Removed: `--grid-size`, `--grid-line`, the body grid background, the header `backdrop-filter`. `brandTokens.test.ts` keeps its rules (gradient defined once, never on text, no raw hex in components, no `infinite`) and adds: the gradient may be referenced only by the four allowed selectors (mark, primary button, hero rule, nav underline); contrast assertions for `--link` on `--paper`, `--ink-3` on `--paper`, `#fff` over the gradient with the scrim; `--amber` only inside `.ink-panel` selectors; `--redline` and `--violet` only inside figure and scene selectors.

### N.2 Typography

| Role | Face | Size | Weight | Leading | Notes |
|---|---|---|---|---|---|
| H1 | display | `--step-4` (home `--step-5` at ≥ 1024 px) | 600 | 1.05 | max 2 lines on desktop, 3 on phone; sentence case |
| H2 | display | `--step-3` | 600 | 1.1 | one per section |
| H3 | display | `--step-1` | 600 | 1.2 | |
| Lead | display | `--step-1` | 400 | 1.45 | ≤ 2 sentences |
| Body | display | `--step-0` | 400 | 1.6 | measure 60–70 ch |
| Long-form body (articles, write-up prose) | longform | `--step-0` | 400 | 1.65 | |
| Section label | display | `--step--1` | 500 | 1.3 | plain words, `--ink-3`, no `§`, no brackets |
| Caption / Fig. label | label | 0.8125rem | 500 | 1.4 | "Fig. 03" + caption text in display face |
| Code / Technical notes | label | 0.875rem | 400 | 1.5 | |

### N.3 Colour roles and contrast rules

Text: `--ink` on `--paper` (≥ 14:1), `--ink-2`, `--ink-3` only at ≥ 0.875rem; `--link` for links, the current nav item (with the gradient underline) and focus rings; the gradient for primary buttons, the hero rule and the nav underline, nothing else; `--redline` and `--violet` only inside diagrams; `--ok` only beside the word it qualifies; never colour alone for status. The home hero band and exhibits invert via `.ink-panel`; inside them the same rules apply to the exhibit values. The result is deliberately gender-neutral: no page carries magenta or blue alone as "the brand colour"; the gradient is the brand colour.

### N.4 Spacing and grid

12-column grid, 72 rem container, 1 rem gutter (1.5 rem ≥ 768 px, 2 rem ≥ 1280 px); section rhythm `--section-rhythm` between sections, half inside; hero columns 7/5; two-column content 7/5 or 6/6; one container level per section (no card in a card); hairline rules separate list items; whitespace, not borders, separates sections.

### N.5 Buttons and controls

- Primary: the logo gradient under `--button-scrim`, white text, 44 px min height, 1.25 rem horizontal padding, radius `--radius-s`, one per screen, no icon except the arrow in the form "Continue"; hover raises the scrim to 18 %; focus ring 2 px `--link` offset 2 px (on exhibits: 2 px white). Contrast is measured at the magenta end by the token test.
- Secondary: outline `--ink` 1.5 px, text `--ink`; hover fills `--paper-2`.
- Text link: underline 1 px, `--link`; hover `--ink`. Current nav item: `--ink` text with a 2 px gradient underline.
- Toggle (exhibit): outline on exhibit values, `aria-pressed`, visible pressed state (fills `--exhibit-paper`).
- Form fields: 44 px, `--paper-2` background, 1 px `--rule` border, 2 px `--ink` on focus, label above in display face sentence case (not mono uppercase), helper text `--ink-3`, error text `#9f1239` with the `warning` symbol and an `aria-describedby` link; the error summary pattern in `InquiryForm.jsx` stays.
- Tabs: none on public pages.
- Disclosure (FAQ, Technical notes): plain `<details>` with a `+`/`−` symbol, no card.

### N.6 Cards, mounts and exhibits

- `ProofMount`: `--paper-2` surface, 1 px `--rule`, 8 px padding, the screenshot at its aspect, caption below in display face with "Fig. 0N" in label face; optional "what you are looking at" line in `--ink-3`.
- `OfferCard`: `--paper-2`, 1 px `--rule`, 2 rem padding, title, three lines with numerals in `--redline`, price line, two actions; Node 96 px top-right on ≥ 768 px, hidden below.
- `Exhibit`: `.ink-panel`, radius `--radius-m`, title row in label face, body, optional toggle row; never nested in another panel; never the first element in the viewport on phones.
- No other cards on marketing pages; lists use rules.

### N.7 Images and illustration

Section H.3 rules. Logo mark: SVG with the gradient; wordmark in display 600; favicon = mark on paper. Social cards regenerated on paper with the mark, the page title and one scene symbol (the existing 12-card generator with new tokens). Portrait: a real photograph, 3:4, 480 px wide, WebP ≤ 60 KB, on the home founder strip and Profile.

### N.8 Component behaviour and motion

- Draw-in once per figure (600 ms); Node sequences per Section G.4; hover and focus transitions 200 ms; page transitions none (no View Transitions API); no parallax, no scroll-jacking, no auto-playing carousels (Embla stays only in the admin if used there).
- Reduced motion: figures render finished; Node static; exhibit toggle switches states without transition.
- With JavaScript off: all content visible, exhibit shows the nominal state and hides the toggle (existing behaviour), FAQs open as plain `<details>`.

### N.9 Responsive states

Breakpoints 640 / 768 / 1024 / 1280 px. Phone: single column, figure after the H1 block, exhibits full-bleed inside a scroll container (no horizontal page scroll), header 56–64 px with mark, "Contact" button and menu; menu full-height paper with the five links and the primary action; tap targets ≥ 44 px. Tablet: 6/6 columns. Desktop: 7/5 heroes, three-column service lines.

### N.10 Page compositions (section order)

- **Home:** graphite hero band (H1, sentence, gradient primary button, text secondary link, S1 in light strokes; 3 px gradient rule at the base) → four ways work gets lost → exhibit + screenshot → three service lines → offer card → founder strip → closing CTA with reply window. Only the home page has a hero band; every other page opens on stone.
- **Solutions:** header → three lines with figures → offer band → (no delivery steps).
- **Line page:** header + figure → what changes → includes → proof mount → FAQ → CTA.
- **Audit:** header + S6 → who it is for → what you receive (+ sample thumbnail) → price line → three steps → FAQ → CTA.
- **Work:** header → entries (title, problem, what it does, proof mount, scope line, one link) → evidence note.
- **Write-up:** K.2 order.
- **About:** header + facts + portrait → principles (four plain rules) → S5 → how a project runs → what working with us looks like (K.1 list) → products line → CTA.
- **Profile:** as now, voice and tags fixed.
- **Contact:** H1 → form + aside (S8, saved-first line, reply window, alternatives) → success exhibit.
- **Products:** header → live product with screenshot → in exploration list.
- **Legal:** H1 → contents → sections.
- **404:** H1 → line → four links → Node idle.

### N.11 Accessibility (WCAG 2.2 AA targets)

Skip link (present); landmarks; one H1 per page; heading order; focus visible everywhere (2 px ring); 44 px targets (2.5.8); no motion that cannot be paused and none longer than 5 s (2.2.2); reduced motion honoured; colour never the only indicator; form errors described and focusable; `aria-pressed` on toggles; figures with alt and captions; no text in images except mono labels mirrored in captions; axe clean on every public route in `brand.spec.js` and `public-pages.spec.js`; screen-reader pass of the home page with VoiceOver (eyebrows no longer read symbols).

## O. Implementation backlog (for Opus)

**How to read.** Every requirement has: ID · Priority (Critical / High / Medium / Low) · Evidence · Current · Required · Design spec · Modules · Dependencies · Constraints · Acceptance · Verification · Rollback. "Standard rollback" = revert the requirement's commit; no data change. Direction B is assumed; under Q-01 = dark, the same IDs apply with inverted role tokens. No calendar phases; the dependency spine is BRAND-01 → BRAND-02 → (MASCOT, WEB, CASE) → CONTENT → CONVERT → SEO → TEST-04 gate → release.

### BUS — Business positioning

**BUS-01 Reply window, hours and time zone** · Critical · Evidence: no reply window, hours or time zone anywhere (C.1, `/contact` fetch) · Current: "A person reads it" only · Required: a settings-backed statement on Contact, the home closing section and the receipt email: hours, time zone label "Philippine time (UTC+8)", reply window in business days (Q-04) · Design: Contact aside and closing-CTA line per N.10 · Modules: `site_settings` (CMS-02), `content.js` `CONTACT_PAGE`, `src/worker/delivery/messages.js` `buildConfirmationEmail`, `SiteSettingsManager.jsx` · Deps: CMS-02 · Constraints: no promise that cannot be met; email keeps no personal data and no greeting by name (security F4/M5 note in `messages.js`) · Acceptance: the three surfaces show the same values from settings; unset values render the current wording unchanged · Verification: unit test for the email builder with and without settings; e2e `contact-form.spec.js` asserts the aside text · Rollback: standard; settings rows stay unread.

**BUS-02 "What working with us looks like"** · High · Evidence: K.1 gaps (ownership, confidentiality, support, continuity, change process) · Required: an About section with the K.1 statements, in plain words, with Q-11/Q-08 answers; no SLA numbers · Modules: `content.js` `ABOUT`, `about.astro`, `homeContent.test.js` budgets (About budget rises from 450 to 650) · Deps: Q-08, Q-11 · Acceptance: the section renders the agreed statements; budget test updated · Rollback: standard.

**BUS-03 Operations Care page** · High · Evidence: inquiry type "Operations Care" exists in `inquiry.ts` with no page · Required: `/solutions/operations-care` describing monitoring, a monthly review, fix hours, and how it is quoted (Q-08); listed in `PUBLIC_ROUTES`, SEO record, Service schema, sitemap, nav untouched · Modules: `content.js` `SERVICE_LINES` (fourth entry flagged `support: true`), `solutions/[slug].astro`, `publicRoutes.ts`, `seoContent.js`, `seo.test.ts` · Deps: BUS-02 · Acceptance: route 200, SEO coverage test green, schema valid · Rollback: standard plus a 301 to `/solutions` if the page is retired later.

**BUS-04 Markets and sectors statement** · Medium · Evidence: Person schema says "Worldwide"; home says nothing · Required: a founder-strip sentence naming only markets with real work (Q-07) and sector examples from the write-ups · Modules: `content.js` `HOME.principal`, `schema.js` `areaServed` · Acceptance: statement matches Q-07; schema `areaServed` lists the same countries · Rollback: standard.

**BUS-05 Audit price line** · High · Evidence: "price quoted after the intake call" is the only price signal · Required: a settings-backed `audit_price_line` ("from ₱… / from US$…", a range, or "quoted after a 30-minute call" if the owner declines a figure, Q-02) shown on the offer card, the audit page and the FAQ answer · Modules: CMS-02, `content.js` `OFFER_AUDIT`, `AUDIT_PAGE.faq` · Deps: CMS-02, Q-02 · Acceptance: one value, three places; unset = current wording · Rollback: standard.

### BRAND — Visual identity

**BRAND-01 Token remap to Direction B** · Critical · Evidence: D.2 · Current: navy canvas, grid, gradient buttons (`brand.css:93–131`) · Required: N.1 values; grid and header blur removed; `.ink-panel` becomes the exhibit surface; `tailwind.config.js` follows · Design: N.1, N.3 · Modules: `brand.css`, `tailwind.config.js`, `brandTokens.test.ts`, `BrandLayout.astro`, `BrandNav.astro` · Deps: Q-01 · Constraints: admin and pickleball app surfaces must not change (they do not use `.brand`); the one-gradient rule stays; theme-color meta updated · Acceptance: token test green with the new contrast assertions; every BrandLayout page renders on paper; no `backdrop-filter`, no grid background in computed styles · Verification: `brandTokens.test.ts`; `redesign.spec.js` computed-style checks; screenshots at 390/820/1440 for 12 routes · Rollback: revert `brand.css` + `tailwind.config.js` (one commit, as in 2.5.0).

**BRAND-02 Buttons, links, labels, fields** · Critical · Evidence: D.2 rows 2, 3; N.5 · Required: gradient primary with scrim (one per screen), outline secondary, indigo text links, gradient nav underline, `.hero-rule`, sentence-case field labels, plain section labels; remove `§`, brackets and bullets from eyebrows · Modules: `brand.css` action classes, `Button.astro`, `BrandNav.astro`, `PageHeader.astro`, `Section.astro`, `Field.astro`, `InquiryForm.jsx` label classes, `content.js` eyebrow strings · Deps: BRAND-01 · Acceptance: the gradient appears only through the four allowed selectors (token test); white-on-gradient contrast ≥ 4.5:1 at the magenta end; axe contrast clean; VoiceOver reads section labels as words · Verification: unit test on `content.js` forbidding `§`, `[`, `•` in eyebrows; e2e computed styles · Rollback: standard.

**BRAND-03 Logo mark, favicon, social cards** · Medium · Evidence: cards generated for navy · Required: regenerate the 12 cards and icons on paper with the mark; `og.png` and manifest updated · Modules: `scripts/brand/*` (card generator), `public/og/*`, `site.webmanifest`, `apple-touch-icon.png`, `icon-*.png` · Deps: BRAND-01 · Acceptance: each card 45–60 KB, 1200×630, title legible at 600 px · Rollback: restore the previous PNGs (binary revert).

**BRAND-04 Legacy routes onto the brand shell** · High · Evidence: seven routes on the legacy Layout with Google Fonts (B.1) · Required: `/offers/[slug]`, `/insights/daily`, `/crawler`, `/maintenance`, `/pickleball`, `/pickleball/how-it-works`, `/pickleball/rotation` use `BrandLayout`; `Layout.astro`, `Navbar.astro`, `Footer.astro`, `GlassCard`, `PrimaryButton`, `VectorField`, `PublicBackdrop` deleted when unreferenced; Google Fonts removed from the CSP `style-src`/`font-src` once no route needs them · Modules: the seven pages, `src/layouts/Layout.astro`, `cspSources.js`, `LeadMagnetForm.jsx` classes · Deps: BRAND-02 · Constraints: `PickleballAppShell` and the app screens unchanged; the lead-magnet form logic unchanged; maintenance mode still gates the routes in `middleware.ts` · Acceptance: no public route requests `fonts.googleapis.com`; nav and footer identical across all public routes; `legacy-urls.spec.js` 31/31 · Rollback: standard per route.

**BRAND-05 Scene crops and new scenes** · High · Evidence: H.1 · Required: 4:5 phone crops for S1–S4, S6; new S7, S8; D-1…D-4 project diagrams; registry entries with `artReady: false` until owner approval on `/brand` · Modules: `scenes.ts`, `SceneArt.astro`, `Glyph.astro` (new symbols only if needed), `docs/brand/scenes.md`, `brand.spec.js` byte budgets · Deps: BRAND-01 · Constraints: H.3 rules; AI-generated drafts never committed · Acceptance: each scene within budget, alt and caption present, aspect correct at 390/820/1440, draw-in once, reduced-motion static · Verification: `brand.spec.js` extended; owner approval recorded in `scenes.md` · Rollback: `artReady: false`.

### MASCOT — Character system

**MASCOT-01 Redraw Node** · High · Evidence: G.1 (visor, silhouette, size) · Required: G.3 drawing: lamp head replaces the visor; three tiers (`tier="mark" | "figure" | "scene"` → 24 / 96 / 240 px bases); states `idle | holding | confirming | needs-person`; ink-line rendering on paper and inverted inside `.ink-panel`; static SVG exports per state and tier in `public/branding/node/`; `docs/brand/node.md` character sheet with locked features · Modules: `NodeMascot.jsx`, `NodeMascot.test.jsx`, `brand.css` `.node-*`, `brand.astro` review page · Deps: BRAND-01 · Constraints: hook-free; ≤ 6 KB per state; no hex; no `infinite`; ids prefixed · Acceptance: silhouette test passed and recorded in `node.md` (a 24 px solid-black render reviewed by the owner on `/brand`); 13 existing tests updated plus snapshot per state and tier · Verification: unit; `/brand` on preview; owner sign-off (Q-13) · Rollback: standard; if the redraw fails review, MASCOT-04.

**MASCOT-02 Motion per G.4** · High · Evidence: current SMIL loops with `end`, visor pulse ×3 · Required: CSS `offset-path` packet sequences (receive 600 ms, hand-off 800 ms), lamp transition 200 ms, one run per trigger, IntersectionObserver trigger for the home exhibit, mount trigger for the success state, `visibilitychange` pause, reduced-motion static, no SMIL · Modules: `NodeMascot.jsx`, `brand.css`, `src/lib/motion.ts`, `HeroPipelineVisualizer.astro` (exhibit), `InquiryForm.jsx` · Deps: MASCOT-01 · Acceptance: no animation exceeds 1.2 s; none repeats; reduced motion shows the final frame; `brandTokens.test.ts` passes · Verification: `home-interactive.spec.js` timing assertions; `contact-form.spec.js` success-state assertion · Rollback: standard.

**MASCOT-03 Placement rules** · Critical · Evidence: 11 instances on `/` · Required: ≤ 2 per page: home exhibit (1) + offer card (1); success state (1); 404 (1); removed from console rows (the console itself is removed by WEB-02) · Modules: `index.astro`, `404.astro`, `InquiryForm.jsx` · Deps: MASCOT-01 · Acceptance: a unit/e2e count of `.node-mascot` per route ≤ 2 · Verification: `redesign.spec.js` count assertion · Rollback: standard.

**MASCOT-04 Fallback: symbol only** · Conditional · Trigger: owner rejects the redraw at Q-13 · Required: Node rendered without the lamp as the "router glyph" at the same placements, no states beyond idle/confirming (lamp colour replaced by a `check` symbol beside it) · Acceptance: same tests with the reduced state set.

**MASCOT-05 IP search record** · Medium · Evidence: G.5 · Required: a dated note in `docs/brand/node.md` recording the WIPO Global Brand Database and IPOPHL searches for "Node" (word) and the figure in classes 9 and 42, with screenshots in the repo's docs (no personal data), and the decision on whether to file (Q-14) · Deps: MASCOT-01 · Constraints: no filing or spend without the owner · Acceptance: note present; owner decision recorded.

### UX — Experience

**UX-01 Home page recomposition** · Critical · Evidence: A, D.2, H.2 · Required: N.10 home order with the components in J.3; the console, bento and spec cards removed; the exhibit relabelled; the offer card; the founder strip with a real portrait · Modules: `index.astro`, `content.js` `HOME`, new `Exhibit.astro`, `ProofMount.astro`, `OfferCard.astro`, `FounderStrip.astro`; `homeContent.test.js` rules (word budget stays 900; add: no `VERIFIED`, no `LIVE`, no `SYS-`) · Deps: BRAND-02, BRAND-05, MASCOT-01, CONTENT-01 · Constraints: no React runtime on `/`; hoisted scripts only; CSP hashes regenerate · Acceptance: screenshot review at three widths; LCP ≤ 2.5 s on preview mobile; the H1 and primary CTA on the first screen at 390 px; axe clean · Verification: `home-interactive.spec.js` rewritten for the exhibit; Lighthouse on preview · Rollback: standard (the 2.5.0 components stay in git history).

**UX-02 Exhibit component** · High · Required: `Exhibit.astro` (`.ink-panel`, title row, body slot, optional toggle with `aria-pressed` and visible pressed state, never first in the phone viewport); the inquiry schematic moved into it with the caption from I.4 · Modules: new component; `HeroPipelineVisualizer.astro` becomes `InquiryFlowExhibit.astro` · Deps: BRAND-01 · Acceptance: toggle makes 0 network requests (existing test); pressed state visible; JS-off shows nominal · Rollback: standard.

**UX-03 Solutions and line pages refinement** · High · Required: figures at 560 px on desktop and first on phones; delivery steps removed from `/solutions`; proof card → `ProofMount`; single CTA label per line · Modules: `solutions.astro`, `solutions/[slug].astro`, `content.js` · Deps: BRAND-02, BRAND-05 · Acceptance: word budgets hold; figures visible without a panel · Rollback: standard.

**UX-04 About, Products, 404, Maintenance refinement** · Medium · Required: About order per N.10 (BUS-02 content); Products with a product screenshot (synthetic data); 404 with Node idle; Maintenance on the brand shell without the fixed "within the next few hours" line (`errorMessages.js:27`) · Modules: `about.astro`, `products.astro`, `404.astro`, `maintenance.astro`, `errorMessages.js` · Deps: BRAND-04, MASCOT-01 · Acceptance: screenshots; budgets · Rollback: standard.

**UX-05 Phone menu and header** · High · Evidence: header blur workaround (ADR 0014) · Required: paper header without blur; 56–64 px; full-height menu; "Contact" short label; focus trap and Escape to close; `redesign.spec.js` phone-menu test kept · Modules: `BrandNav.astro`, `brand.css` · Deps: BRAND-01 · Acceptance: existing menu tests green; no `backdrop-filter` · Rollback: standard.

### WEB — Pages and shared components

**WEB-01 Remove public components no longer used** · Medium · Required: delete `FailureDiagnosticConsole.astro`, `ReliabilityBentoGrid.astro`, `CaseStudyShowcase.astro`, `ProofStrip.astro` after UX-01 ships; delete legacy components after BRAND-04 · Deps: UX-01, BRAND-04 · Acceptance: `grep` finds no references; build green · Rollback: standard.

**WEB-02 Fix broken and inconsistent links** · Critical · Evidence: `insights.astro:72` "Request the audit" → details page; footer "Hiring? Contact Stephen" → `/profile`; offers page "Discuss Your System" → `type=workflow_audit` · Required: audit label always → the form with `type=workflow_audit`; footer hiring link → `/contact?type=employment_opportunity`; offers CTA → `type=business_system&insight=…` with the label "Talk to us about your intake" · Modules: `insights.astro`, `BrandFooter.astro`, `offers/[slug].astro` · Acceptance: e2e link assertions · Rollback: standard.

**WEB-03 Empty portrait defect** · Critical · Evidence: B.3 home screenshot · Required: the founder strip renders the real portrait (the Profile already has one) or no frame; `Portrait.astro` renders nothing when the image is missing · Modules: `Portrait.astro`, `PrincipalSpotlight.astro` (or its replacement), `index.astro` · Acceptance: no empty frame on `/` at any width · Rollback: standard.

**WEB-04 Personal invitation off the business domain** · Medium · Evidence: `public/haosweetitis/index.html` served from the company host (noindex) · Required: remove from `public/` after the owner moves it (Q-09); add a 301 or 410 if it had been shared · Modules: `public/`, `middleware.ts` · Deps: Q-09 · Acceptance: route returns 301/410 · Rollback: restore the folder.

**WEB-05 Offers page as a brand page** · Medium · Required: `/offers/[slug]` on the brand shell with the `LeadMagnetForm` unchanged; consent text unchanged · Deps: BRAND-04 · Acceptance: form posts and succeeds on preview (synthetic data) · Rollback: standard.

### CONTENT — Copy and IA

**CONTENT-01 Home copy** · Critical · Evidence: I.1 · Required: I.4 hero, four pairs, exhibit caption, offer card, founder strip, closing; mono eyebrows replaced; forbidden words test (I.2 list) · Modules: `content.js` `HOME`, `homeContent.test.js` · Deps: Q-02, Q-04, Q-07 for the variable lines (ship with settings placeholders rendering the current wording when unset) · Acceptance: budget ≤ 900; forbidden-word test green; owner review on preview · Rollback: standard.

**CONTENT-02 Site-wide CTA labels** · Critical · Evidence: six wordings · Required: "Talk to us about your system" (header "Talk to us", phone "Contact"); line variants "Talk to us about your intake / workflow / build"; write-ups "Talk to us about something similar"; audit "Request the audit"; profile labels unchanged; `site_settings` nav CTA default updated through a dated guarded `UPDATE` (preview first) · Modules: `content.js`, `siteSettingsContent.js`, `scripts/cms/updates/2026-xx-xx-cta-labels.sql`, `BrandNav.astro` fallback · Deps: Q-15 (owner approves the label) · Acceptance: a unit test enumerating allowed CTA labels; e2e checks header, home, solutions, work · Rollback: standard; SQL has a paired revert statement.

**CONTENT-03 Honesty labels** · Critical · Evidence: C.3 · Required: every row's "Required change" applied: no "LIVE", "NOMINAL", "VERIFIED ·", "Systems in production", "never lost", "Nothing is auto-replied and closed"; Terms line replaced; Work evidence note kept · Modules: `content.js`, `solutions/[slug].astro:132`, `terms.js:43` (+ dated guarded D1 update for the `terms` page row, preview first), `work.ts` · Deps: Q-06 for Terms wording · Acceptance: a guard test forbidding the listed strings in `content.js` and the static legal data · Rollback: standard; SQL revert.

**CONTENT-04 Profile voice and tags** · Medium · Required: third person throughout; one merged tag list (skills and tools deduplicated, grouped: languages, frameworks, platforms, automation tools, AI); experience bullets edited for grammar; all bullets shown · Modules: `about.js`, `skills.js`, `tools.js`, `experiences.js`, `profile.astro:95` · Constraints: CMS profile row on production may override the static text; read it first and apply a matching dated update if it carries the same strings · Acceptance: budget ≤ 900; no duplicated tag · Rollback: standard.

**CONTENT-05 Write-up leads and meta** · High · Required: a ≤ 30-word plain summary per write-up as lead and meta description; the architecture sentence moves to Technical notes; add the K.2 situation and scope texts (CASE-01) · Modules: `work.ts`, `projectRecords.js`, CMS work narrative rows (dated update, preview first) · Deps: CASE-01 · Acceptance: `seo.test.ts` description length; e2e · Rollback: standard; SQL revert.

**CONTENT-06 Remove duplicated sections** · Medium · Required: delivery steps only on About; principles only on About; "a person reads every inquiry" at most once per page · Modules: `solutions.astro`, `content.js` · Acceptance: grep-based unit test · Rollback: standard.

### CONVERT — Lead conversion

**CONVERT-01 Contact page copy and aside** · Critical · Required: I.3/I.4 contact copy; S8 beside the form; reply window, hours, time zone (BUS-01); optional scheduling and chat links (Q-05) rendered only when set · Modules: `contact.astro`, `content.js` `CONTACT_PAGE`, `InquiryForm.jsx` presentation only · Deps: BUS-01, CMS-02, BRAND-05 · Constraints: form logic, schema, endpoint, Turnstile, idempotency unchanged · Acceptance: `contact-form.spec.js` 15/15 plus new aside assertions; a real submission on preview persists and delivers · Rollback: standard.

**CONVERT-02 Success exhibit** · High · Required: after the server-confirmed write, the dark exhibit with Node confirming (MASCOT-02 hand-off once), the I.4 success text with the submitted email, and the receipt note · Modules: `InquiryForm.jsx:640–660` · Deps: MASCOT-01/02 · Acceptance: e2e success-state assertions; `aria-live` announces the text, not the figure · Rollback: standard.

**CONVERT-03 Receipt email wording** · High · Required: add the reply window and hours from settings; keep no greeting by name, no message echo (security note); subject unchanged · Modules: `messages.js` · Deps: BUS-01 · Acceptance: unit tests; a preview send to `LEAD_NOTIFICATION_EMAIL` only · Constraints: no new send path; no real recipients · Rollback: standard.

**CONVERT-04 CTA measurement** · Medium · Required: `cta_click` GA4 event with `label`, `page`, `inquiryType` on primary CTAs (consent-gated as today); a short `docs/operations.md` note on reading persisted-inquiry rate per 1,000 sessions before/after · Modules: `BrandLayout.astro` script, `analytics.js` · Constraints: CSP hashes; no PII · Acceptance: event visible in GA4 DebugView on preview · Rollback: standard.

**CONVERT-05 Audit sample deliverable** · Medium · Required: a two-page sample (synthetic workflow) as a PDF in `public/` and a thumbnail on the audit page (Q-03) · Deps: Q-03 · Acceptance: PDF ≤ 500 KB; thumbnail with alt · Rollback: remove the file and the link.

### CASE — Portfolio proof

**CASE-01 Write-up structure (K.2)** · Critical · Required: the ten-part layout; new fields (CMS-01); D-x diagram first; `ProofMount` screenshots with "what you are looking at"; scope section; founder line; Technical notes · Modules: `work/[slug].astro`, `work.ts`, `workEntries.ts`, `ProjectEditorialFields.jsx`, `projects.ts` repository, migration `0020` · Deps: CMS-01, BRAND-05 · Acceptance: each of the four write-ups renders all ten parts (scope may say "not published"); `work-pages` e2e; budgets (write-up budget 900) · Rollback: standard; columns unread.

**CASE-02 Work index** · High · Required: paper mounts, scope line, one link per card, "Talk to us about something similar" moved to the write-up; evidence note kept · Modules: `work.astro`, `content.js` `WORK_INDEX` · Deps: CASE-01 · Acceptance: budget ≤ 500; screenshots · Rollback: standard.

**CASE-03 Write-up schema** · Medium · Required: `CreativeWork` with `author` → Person `@id`, `publisher` → Organization `@id`, `dateCreated`, `image`, `about` (service line) · Modules: `schema.js`, `work/[slug].astro` · Acceptance: Rich Results test on preview; `schema.test.js` · Rollback: standard.

**CASE-04 Client consent register** · Medium · Required: `docs/content/consent.md` recording, per write-up, whether the client may be named or quoted (Q-16); the page shows a name or quote only when the register says yes · Deps: Q-16 · Acceptance: a unit test that a named client in content has a register entry · Rollback: remove names.

### PROFILE — Founder discoverability

**PROFILE-01 Byline and schema alignment** · Medium · Evidence: Article author Person vs byline "DevLab Studios" · Required: byline "Stephen Rey Agustinez, DevLab Studios" where the schema author is the founder; otherwise author Organization · Modules: `insights/[slug].astro:72–74`, `schema.js:251` · Acceptance: `schema.test.js`; e2e byline · Rollback: standard.

**PROFILE-02 Profile links and GitHub surfacing** · Low · Required: Profile links to the GitHub organisation and, if any product repository is public, a "public code" list (UNKNOWN; Q-17) · Rollback: standard.

**PROFILE-03 Keep the two journeys distinct** · Constraint (no change) · The business nav never says "Hire me"; the profile keeps its own CTAs; the footer hiring link goes to the employment form (WEB-02).

### CMS — Content management

**CMS-01 Migration 0020: write-up editorial fields** · High · Required: additive nullable columns on the work narrative/projects path: `situation`, `decisions` (JSON list), `scope`, `in_operation_since`, `diagram_id`; Zod schema; admin form; read path; static fallback (four places) · Modules: `migrations/0020_writeup_fields.sql`, `src/lib/schemas/*`, `ProjectEditorialFields.jsx`, `projects.ts`, `work.ts` · Constraints: preview first; production apply needs the owner token; `0018`/`0019` must be confirmed applied on production first (B.1) · Acceptance: migration test on SQLite; preview `d1 migrations list` shows `0020`; round-trip e2e in `admin.spec.js` · Rollback: columns unread; no drop.

**CMS-02 Business settings** · Critical · Required: `site_settings` keys `reply_window_days`, `business_hours`, `time_zone_label`, `scheduling_url`, `messenger_url`, `whatsapp_url`, `audit_price_line`, each nullable with code defaults = "not stated"; admin Site Settings fields; `loadSiteSettings` exposes them · Modules: `siteSettings.ts`, `SiteSettingsManager.jsx`, `siteSettingsContent.js`, schema · Constraints: no hardcoded values in pages · Acceptance: round-trip e2e; pages render defaults when unset · Rollback: keys ignored.

**CMS-03 Dated content updates** · High · Required: `scripts/cms/updates/<date>-redesign-content.sql` with guarded `UPDATE`s for the home SEO title, products description, terms line, CTA label, write-up leads; applied to preview, read back, then production with the owner token · Constraints: AGENTS.md D1 rules · Acceptance: read-back output recorded in PROGRESS.md · Rollback: paired revert statements in the same file.

**CMS-04 Decision record** · Low · Required: ADR 0015 "Drafting-table brand system, Node character system, CMS retained" superseding the palette parts of ADR 0014; `docs/CURRENT_STATE.md`, `docs/brand/scenes.md`, `docs/brand/node.md` updated · Acceptance: docs reviewed in the PR.

### SEO — Search visibility

**SEO-01 Record fixes** · High · Required: home title "DevLab Studios · Business systems that don't quietly lose work"; products description aligned; Operations Care record; `seo.test.ts` coverage · Modules: `seoContent.js`, CMS-03 · Rollback: SQL revert.

**SEO-02 Search Console and Business Profile** · High (owner action) · Required: domain verification; a service-area Business Profile matching `company.js`; recorded in `docs/operations.md` · Deps: Q-12.

**SEO-03 Sector pages (conditional)** · Low · Required only when a write-up exists per sector; no regional claims · Deps: CASE-01, Q-07.

**SEO-04 Consistency sweep** · Medium · Required: a checklist in `docs/operations.md` comparing name, email, city, founding date across site, schema, LinkedIn, GitHub, Facebook, directories; owner fixes the external ones · Acceptance: checklist completed.

### SEC — Security and privacy

**SEC-01 Seed file personal data** · Critical (pre-existing, noted in PROGRESS.md) · Required: remove real personal data from `scripts/cms/seed/cms-content-seed.sql` (replace with synthetic); decide on a history rewrite (Q-18, owner; destructive) · Constraints: never force-push without the owner's explicit decision · Acceptance: a guard test scanning seeds for phone/DOB/address patterns · Rollback: n/a for the file change.

**SEC-02 Legal review of Privacy and Terms** · High (owner action) · Required: remove "pending legal review" after review; registered name (Q-06, N5) · Acceptance: owner-approved text applied via CMS-03.

**SEC-03 CSP after the shell migration** · Medium · Required: drop `fonts.googleapis.com` / `fonts.gstatic.com` from the CSP once BRAND-04 lands; keep hashed `script-src` · Modules: `cspSources.js`, `securityHeaders.ts` · Acceptance: `security.*.spec.js`; browser console clean on 14 routes · Rollback: standard.

### OPS — Reliability

**OPS-01 Production migration state** · Critical (gate) · Required: list production migrations before any schema-dependent release; apply `0018`, `0019`, then `0020` with the owner token; read back · Acceptance: `wrangler d1 migrations list devlab-studios-cms --remote` recorded.

**OPS-02 GitHub Release v2.5.0** · Low · Required: publish the missing release entry with the command in PROGRESS.md · Acceptance: release exists.

**OPS-03 Visual capture on preview** · High · Required: the existing `capture.mjs` run in CI on preview for 12 routes × 3 widths, artefacts uploaded, before/after compared by a reviewer · Acceptance: artefacts attached to the PR.

**OPS-04 Lighthouse CI budget** · Medium · Required: mobile performance ≥ 90, LCP ≤ 2.5 s, CLS ≤ 0.1, accessibility 100 on `/`, `/solutions`, `/work/<slug>`, `/contact` on preview; fails the PR below budget · Acceptance: CI job green.

### TEST — Verification

**TEST-01 Guard tests (write first)** · Critical · Required: forbidden-word test for `content.js` (I.2 + C.3 strings); CTA allow-list test; Node-count-per-route test; eyebrow symbol test; `--amber` inside `.ink-panel` only; contrast assertions for the new accent; seed personal-data scan; legacy-URL fixture unchanged.

**TEST-02 Unit updates** · High · `NodeMascot.test.jsx` (states, tiers, snapshots, byte budget, no SMIL), `homeContent.test.js` budgets and rules, `company.test.js`, `schema.test.js` (CreativeWork, areaServed), email builder tests.

**TEST-03 E2E updates** · Critical · `redesign.spec.js` (computed styles, counts, menu), `home-interactive.spec.js` (exhibit toggle, 0 network calls, timing), `contact-form.spec.js` (aside, success exhibit, persisted write), `public-pages.spec.js` (all routes 200, axe), `brand.spec.js` (scenes, Node tiers), `admin.spec.js` (settings and write-up fields round-trip), `legacy-urls.spec.js`.

**TEST-04 Visual and accessibility gate** · Critical · Screenshots at 390/820/1440 for 12 routes before and after; axe clean; VoiceOver pass on `/` and `/contact` recorded in PROGRESS.md; owner sign-off on preview before `main`.

**TEST-05 Functional integration** · Critical · One synthetic inquiry per form type on preview: persisted row, delivery attempt, receipt to the notification address only, admin visibility; lead-magnet flow; no change in `delivery_attempts` semantics.

---

## P. Verification specification

| Layer | What | Command / evidence | Gate |
|---|---|---|---|
| Lint, types, unit, build | all | `npm run lint && npm run typecheck && npm run test:unit && npm run build` | every push |
| Static e2e | public pages, redesign, home exhibit, brand, legacy URLs, html cache, image weight | `npx playwright test --project=static` | every push to either branch |
| Worker e2e | admin settings and write-up fields, contact form persistence, security headers | `npx playwright test --project=worker --project=admin-auth` | PRs touching admin, settings, forms, middleware |
| Accessibility | axe on every public route; VoiceOver manual pass on `/`, `/contact` | `brand.spec.js`, `public-pages.spec.js`; recorded notes | before preview sign-off |
| Visual | 12 routes × 3 widths, before/after | `capture.mjs` in CI (OPS-03) | before preview sign-off |
| Performance | Lighthouse mobile on preview (OPS-04); TTFB sample from two regions | CI job; curl | before `main` |
| Functional integration | synthetic inquiries, lead magnet, receipt email to the notification address | manual on preview, recorded | before `main` |
| Regression | the 31 frozen legacy URLs; sitemap count ≥ 37 (+ new routes); `/api/health`; admin login noindex | `legacy-urls.spec.js`; production smoke after deploy | after every `main` push |
| Data | preview `d1 migrations list`; read-back of every dated update | recorded in PROGRESS.md | before and after production writes |

Release sequence (AGENTS.md): branch → commits with CHANGELOG `[Unreleased]` → PR → CI green → fast-forward `development` → preview verification (the gates above) → owner sign-off on preview → fast-forward `main` → Workers Builds → production smoke → `development` and `main` in sync → release bump when the owner says so.

---

## Q. Risks and decisions

### Q.1 Verified blockers and risks

| Risk | Where | Mitigation |
|---|---|---|
| Production D1 behind on `0018`/`0019` | B.1 | OPS-01 gate before CMS-01 |
| Token remap touches every brand page at once | BRAND-01 | One commit, screenshot diff, revert path as in 2.5.0 |
| Node redraw may not pass the silhouette test | MASCOT-01 | MASCOT-04 fallback decided at the `/brand` review |
| Light screenshots previously clashed; now dark exhibits must not look like the old theme | UX-02 | Exhibits never first in the viewport; ≤ 1 per section |
| Owner may not want to publish a price | BUS-05 | The settings value may be "quoted after a 30-minute call"; the line still exists |
| Reply-window promise | BUS-01 | Stated in business days with hours; measured against real replies after a month |
| The CTA label change could reduce inquiries | CONTENT-02 | Measured (CONVERT-04); revertible SQL |
| Seed file history rewrite is destructive | SEC-01 | Owner decision; never force-push without it |
| Legal text changes are compliance statements | SEC-02 | Owner and counsel approve wording; code only applies it |
| Rate limits on the implementation session's own tooling (this audit lost two exploration agents to a 5-hour limit) | process | Opus should work in small commits and record progress in PROGRESS.md after each requirement |

### Q.2 Decisions required from the owner (defaults stated)

| ID | Decision | Default if silent |
|---|---|---|
| Q-01 | Direction | **Decided 2026-11-13:** Direction B, "Graphite on stone", gradient on mark + primary buttons + hero rule + nav underline, graphite home hero band, "Balanced" density |
| Q-02 | Audit price line | **Decided:** "Quoted after a 30-minute call" |
| Q-03 | Produce a synthetic sample audit PDF | Yes, two pages |
| Q-04 | Reply window and hours | **Decided:** 1 business day; Mon–Fri 9:00–18:00 Philippine time (UTC+8) |
| Q-05 | Scheduling link; Messenger / WhatsApp | **Decided:** email and form only; settings stay nullable for later |
| Q-06 | Legal pages | **Decided:** fix the Terms wording now; the Privacy "pending legal review" note stays until a lawyer reviews it; registered name still open |
| Q-07 | Markets that may be named (PH, US, AU) | Name only those with completed work |
| Q-08 | Operations Care offer definition and whether it is sold today | Describe honestly as "by arrangement"; no page until defined |
| Q-09 | Move the personal invitation off the domain | Yes |
| Q-10 | Keep Facebook and directory listings | Keep only those maintained |
| Q-11 | Code, data and account ownership terms | Client owns; stated in About and Terms |
| Q-12 | Search Console and Business Profile set-up | Yes, owner action |
| Q-13 | Node | **Decided:** refine Node (Direction A in G.2); the redraw itself is still approved on `/brand` before it ships, with MASCOT-04 as the fallback if it fails the silhouette review |
| Q-14 | Trademark search and filing for the figure | Search yes; filing no until reviewed |
| Q-15 | Primary CTA label "Talk to us about your system" | Yes |
| Q-16 | Client naming/quotes consent per write-up | None named |
| Q-17 | Public repositories to surface on Profile | None |
| Q-18 | Seed personal data | **Decided:** fix the file only; no history rewrite |
| Q-19 | Product-Worker split timing (prior audit N10) | Out of scope for this spec |

---

## R. Final Opus handoff

**Written for:** the Claude Opus implementation session.

**Model and effort (checked against the current lineup on 2026-11-12):** Claude Opus 5.5 (`claude-opus-5-5`) at effort `xhigh` for implementation; set effort explicitly because this model's default is `medium`. Use Claude Fable 5.2 only for a fresh design review of the redrawn Node and the home composition on preview, if the owner wants a second opinion. Start in plan mode for the first session (it must read this specification, verify drift against the repository, and present the first PR plan), then execute requirement by requirement.

**Instruction block (copy into the Opus session):**

> You are the senior engineer implementing the approved specification in `docs/plans/devlab-complete-b2b-brand-ux-architecture-spec.md` for DevLab Studios. Read it in full, then `AGENTS.md`, `CHANGELOG.md` (policy), `docs/branch-workflow.md`, `docs/deployment.md`, `docs/testing.md`, `docs/plans/PROGRESS.md`, ADRs 0007, 0012, 0013, 0014, `docs/brand/scenes.md`. Re-check the repository at `main` for drift since `dd6b377` and trust the code over the document; note drift in PROGRESS.md.
>
> Business positioning (Section C, I), the brand direction (Section F, Direction B "Graphite on stone" as decided on 2026-11-13), the mascot decision (Section G, refine Node), the page architecture (Section J), the design system (Section N) and the CMS decision (Section M) are approved inputs, as are the owner decisions recorded in the preamble (price line, reply window, contact channels, legal handling, seed file). Do not reinterpret them. Make code-level engineering decisions yourself and state each in one line.
>
> Order of work: OPS-01 (production migration state, owner token) → TEST-01 guard tests (write them first, watch them fail) → SEC-01 (seed file fix) → BRAND-01/02 → BRAND-05, MASCOT-01/02/03 (then the `/brand` review of the redraw) → UX-02, UX-01, CASE-01, CMS-01/02 → CONTENT-01…06, CONVERT-01…03, WEB-02/03, UX-03/04/05 → BRAND-04, WEB-01, SEC-03 → SEO-01, CASE-03, PROFILE-01 → CMS-03 dated updates → TEST-02…05, OPS-03/04 → docs (CMS-04) → release. Every requirement is one commit with its tests, CHANGELOG `[Unreleased]` entry and doc updates; one PR per coherent group; `development` → preview → owner sign-off → `main`.
>
> Binding safety rules: no production D1 write without a fresh owner token used inline for one command, read-before and read-after; additive migrations only; never run the full seed on a populated database; dormant lead-engine automations stay off; no new email send path; synthetic data only in tests, fixtures, screenshots and PRs; never commit AI-generated art as production assets; never force-push; the inquiry pipeline's persist-before-deliver order and its guard tests must stay green; the admin and pickleball app surfaces must not visually regress. Owner decisions Q-01…Q-19 use the stated defaults except money (Q-02), legal (Q-06), destructive history (Q-18), the Node approval (Q-13) and trademark filing (Q-14), which wait for the owner.
>
> Expected output per PR: Issue (with requirement IDs and the evidence section cited) · Fix · Testing (commands, counts, screenshots at 390/820/1440, axe, Lighthouse) · Done so far / next · Risk and rollback · Deviations · ends with the Claude Code attribution line. Update PROGRESS.md with evidence for every requirement. Stop any local server you started.

**Appendix R-1. Files this specification expects Opus to touch** (verified paths): `src/styles/brand.css`, `tailwind.config.js`, `src/styles/brandTokens.test.ts`, `src/layouts/BrandLayout.astro`, `src/components/brand/{BrandNav,BrandFooter,PageHeader,Section,Button,Field,Portrait,PrincipalSpotlight,SceneArt,SceneFrame,Glyph,HeroPipelineVisualizer,FailureDiagnosticConsole,ReliabilityBentoGrid,CaseStudyShowcase,ProofStrip}.astro`, `src/components/brand/NodeMascot.jsx` (+ test), `src/components/islands/{InquiryForm,LeadMagnetForm}.jsx`, `src/pages/{index,solutions,work,about,products,contact,insights,profile,404,maintenance,crawler,brand}.astro`, `src/pages/solutions/[slug].astro`, `src/pages/work/[slug].astro`, `src/pages/insights/{[slug],daily}.astro`, `src/pages/offers/[slug].astro`, `src/pages/pickleball/{index,how-it-works,rotation}.astro`, `src/data/site/content.js` (+ `homeContent.test.js`), `src/data/{about,skills,tools,experiences,seoContent,siteSettingsContent}.js`, `src/data/pages/{work.ts,terms.js}`, `src/config/{company,schema,offers,publicRoutes,cspSources,errorMessages,scenes}.*`, `src/lib/content/{siteSettings,work,workEntries,projects,seo}.ts`, `src/lib/schemas/*`, `src/worker/delivery/messages.js`, `src/components/admin/{SiteSettingsManager,projects/ProjectEditorialFields}.jsx`, `migrations/0020_*.sql`, `scripts/cms/updates/*.sql`, `scripts/cms/seed/cms-content-seed.sql`, `public/{og,branding,site.webmanifest}`, `tests/e2e/*.spec.js`, `docs/{CURRENT_STATE.md,brand/scenes.md,brand/node.md,architecture/decisions/0015-*.md,plans/PROGRESS.md,operations.md,content/consent.md}`.

**Appendix R-2. Sources used.**
- Repository files and docs listed in the preamble; live site fetches and screenshots dated 2026-11-12.
- Prior audit `docs/plans/devlab-b2b-cms-architecture-audit.md` (Sections B, D, M, N) for the dependency map, CMS matrix and costs; revalidated here.
- thoughtbot https://thoughtbot.com; Test Double https://testdouble.com; 8th Light https://8thlight.com; PostHog https://posthog.com (home pages, 2026-11-12).
- GitLab logomark rules https://design.gitlab.com/brand-logo/logomark; GitLab trademarks https://handbook.gitlab.com/handbook/legal/trademarks-at-gitlab/.
- Mailchimp/Collins 2018 coverage: https://www.itsnicethat.com/news/mailchimp-collins-brand-system-graphic-design-270918, https://www.designweek.co.uk/issues/1-7-october-2018/mailchimp-rebrand-aims-to-unify-bran, https://www.fastcompany.com/90241616/see-mailchimps-weird-new-branding.
- B2B mascot census https://www.stfo.io/research/b2b-mascot-census.
- Mascot craft (silhouette test, small-size variants, locked features): https://labmarcel.substack.com/p/what-makes-brand-characters-stick, https://madegooddesigns.com/mascot-logo-design/.
- IPOPHL eTMfile FAQ https://www.ipophil.gov.ph/help-and-support/trademark/etmfile-for-trademarks-faqs/; WIPO Global Brand Database https://branddb.wipo.int.
- EmDash reviews (1.0, Sept 2026; D1 + R2): https://www.bitdoze.com/emdash-cms-review/, https://kompozy.io/reviews/emdash-1-0, https://developers.cloudflare.com/workers/framework-guides/web-apps/emdash/; Payload on Cloudflare https://payloadcms.com/posts/blog/deploy-payload-onto-cloudflare-in-a-single-click; Keystatic on Workers pitfalls https://pa1ar.pages.dev/p/fixing-keystatic-github-oauth-on-cloudflare-workers.
- Claude model lineup from the `claude-api` skill reference (cached 2026-11-03): Opus 5.5 default `medium` effort; Fable 5.2 most capable.

**Fact versus judgment.** Facts: everything marked VERIFIED, the quoted copy, file paths, measurements, vendor facts with URLs. Judgment: the persona verdicts, the direction scores, the Node assessment, the copy proposals, the CTA recommendation, and every "Required" line. Hypotheses needing the owner: Q-01…Q-19.

---

## Plan-mode note (how this file is used)

This document is the complete deliverable requested by the brief. The only action to take after approval is to save it unchanged as `docs/plans/devlab-complete-b2b-brand-ux-architecture-spec.md` (no commit, no other change), so the Opus session can read it from the repository.

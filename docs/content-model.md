# Content Model

Updated 2026-09-17 for the business-first rebuild. This document describes current D1
storage, validation, editor ownership, and public read behavior.

## Cross-cutting history and audit

- `content_versions` stores append-only snapshots for versioned content writes.
  Restoring an older value creates a new current version; history is not
  rewritten.
- `audit_log` records actor, action, entity type/id, metadata, and timestamp for
  supported create, update, publication, deletion, and restore operations.
- Generic page and collection routes use the shared version/audit path. Several
  older bespoke editors still use their established repositories and should be
  migrated deliberately rather than assumed to have identical coverage.

## Singleton content

| Content | Storage | Public/admin behavior |
|---|---|---|
| Home, About, Services, Work, Insights, Profile, Process, Contact | `pages` + `page_sections` plus their established collections | Public surfaces use the same labels in Admin. Controlled presentation blocks edit visible copy and ordering while specialized records remain in their owning libraries. |
| Site settings | `site_settings` | Brand, availability, URLs, and global configuration |
| Navigation | `navigation_items` | Published items populate the public shell; static navigation protects unavailable CMS reads |
| Footer | `site_settings` key `site_footer` | Brand, Explore, Connect, legal, and contact content |
| Profile | `site_settings` key `profile_about` plus `experiences`, `skills`, `tools`, and `workflow_items` | Dedicated profile editor and public static fallback |
| Contact | `pages` + `page_sections` | Only the hero framing is CMS content. The inquiry form's fields, labels, conditional logic, validation, Turnstile, and routing are application code (`src/components/islands/InquiryForm.jsx` + `/api/inquiries`) — the old field-label rows are unpublished, not deleted. |
| Privacy and Terms | `pages`/`page_sections` or bundled fallback | Rich-text legal content without arbitrary executable markup |

## Approved page blocks

`src/lib/schemas/blocks.ts` defines Zod-validated block types. Case Study and Testimonial blocks remain backward-compatible schema types but are not offered in the normal page editor.

- `hero`
- `richText`
- `stats`
- `processSteps`
- `experienceTimeline`
- `servicesGrid`
- `featuredProjects`
- `workProjectShowcase`
- `featuredCaseStudies`
- `testimonials`
- `faq`
- `problemList`
- `leadMagnet`
- `resourceCards`
- `imageGallery`
- `cta`

Blocks accept structured props only. CMS users cannot inject arbitrary HTML,
JavaScript, CSS, or SVG. Decorative motifs use approved icon keys.

`problemList` holds the operational problems the Home page names. `leadMagnet`
references an offer by `offerId` only — the title and destination URL are
resolved server-side from `src/config/offers.js`, so the CMS can select which
offer is promoted but can never redirect what gets emailed.

`cta` additionally carries routing context: `inquiryType` preselects the
contact form's type so a visitor arriving from a solution page never has to
classify themselves, and `formId` / `offerId` / `solutionId` travel with the
submission as attribution. None of them are rendered.

## Collections

| Collection | Storage | Notes |
|---|---|---|
| Projects | `projects` + `project_gallery_images` | Owns reusable facts and an ordered multi-image gallery; the thumbnail is a *selection* from that gallery (`project_gallery_images.is_thumbnail`), not a separate upload — `projects.image_url`/`image_filename` are derived server-side from whichever gallery row is flagged, and fall back to the logo when none is. Gallery image uploads are staged client-side and only persisted (and uploaded to R2) when the project is saved. Deletion is blocked while referenced by Work |
| Services | `service_groups` | Service category content and related project patterns |
| Articles | `articles` | Insight/article records served through `/insights` and article API routes |
| Resources | `resources` | Download, checklist, template, or external-link records; distinct from Articles |
| Experiences | `experiences` | Profile timeline entries |
| Certifications | `certifications` | Platform and professional certification metadata and image references |
| Case Studies | `case_studies` | Retained for backward compatibility but hidden from normal Admin navigation and not added to public pages |
| Testimonials | `testimonials` | Retained for backward compatibility but hidden from normal Admin navigation and not added to public pages |
| FAQs | `faqs` | Context/page-specific questions and answers |
| Redirects | `redirects` | Consulted by middleware only after a real 404; do not duplicate a D1 redirect with a hardcoded page redirect |
| Inquiries | `leads` + `lead_attribution` + `lead_consents` + `lead_activities` + `delivery_attempts` | Operational, never editorial. See "Inquiries and operational data" below. |

## Work and Project ownership

Work is a curated presentation of existing Projects, not a second upload path.
A `workProjectShowcase` item stores:

- `projectId`
- independent Work `description`
- `challenge`
- `architecture`
- `deliveryValue`
- ordering and publication state

Selecting a Project copies its description once as an initial editable value.
Later Project description changes do not overwrite Work wording unless an
editor explicitly resets it. Public rendering resolves the latest Project
title, stack, links, cover image, and ordered gallery while preserving Work's
independent narrative.

The Work API validates references and publication prerequisites. A published
Work item requires its referenced Project to exist and be published. Project
deletion returns a conflict while the Project is featured on Work.

## Articles and Resources

Migration `0004_content_model_v2.sql` renamed the original article-shaped
`resources` table to `articles` and created a new `resources` table for actual
download/reference material. Public article routes are `/insights` and
`/insights/[slug]`. Legacy `/resources` URLs redirect through the repository's
redirect behavior.

Some repository function names retain historical `Resources` wording while
querying `articles`; treat the D1 table and current Astro route names as the
public source of truth when extending this area.

## Insights taxonomy

Articles carry one of three `content_type` values, defined in
`src/config/insightTopics.js`:

| id | label |
|---|---|
| `guide` | Guides |
| `ai-update` | AI Updates |
| `ops-note` | Operational Notes |

The labels are not derivable from the ids — the page used to capitalize the raw
value, which was fine while every value was a single word and renders
"Ai-update" once they are not. `normalizeTopicId()` also maps the pre-taxonomy
values `news` and `insight` onto the new ids, so a row that was never migrated
still lands in a real bucket instead of disappearing from every filter.

The library lives in `src/data/insights/` split by topic, is composed by
`src/data/resourcesContent.js`, and is seeded into D1 by
`npm run cms:seed:insights`. Exactly one article is featured, enforced by the
generator rather than hoped for: the page picks the first featured post and
silently falls back to the newest when there is none, so both zero and two
would render something plausible and wrong.

`reading_time_minutes` exists as a column but is **not read at runtime**.
`src/lib/content/readingTime.ts` derives it from the body, because the stored
values had drifted — a 300-word post claiming a five-minute read.

## Generated content: the daily digest

`migrations/0011_insights_digest.sql` adds two tables that are **not** content
collections and have no CMS editor:

| Table | Holds | Notes |
|---|---|---|
| `digests` | One row per day | `digest_date` is UNIQUE, which is what makes a re-run replace the day rather than duplicate it. `model` is NULL when the run degraded to titles-and-links because Workers AI was unavailable. |
| `digest_items` | Title, source name, source URL, and OUR OWN one-sentence summary | No source body text is ever stored. `ON DELETE CASCADE` from `digests`. |

Deliberately separate from `articles`. Articles are evergreen, hand-written and
permanent; a digest is generated, ephemeral, and swept by a `DELETE` with a date
predicate. Sharing a table would put real editorial content one bad `WHERE`
clause away from that sweep.

Nothing here is authored, so the admin surface (`/admin/digests`) offers only
what an operator needs over generated output: unpublish a day, delete a day, or
run the job now. Retention removes anything older than seven days.

Rationale and constraints: [ADR 0008](./architecture/decisions/0008-insights-daily-digest.md).

## Media and R2

R2 stores uploaded bytes. `media_assets` stores the CMS metadata index:

- R2 key and public URL
- original filename and content type
- byte size
- alt text
- logical folder

`GET /api/admin/media` inventories the actual R2 bucket and joins optional D1
metadata. Admin accepts JPG, PNG, WebP, and AVIF in the browser, constrains
dimensions, and converts the result to WebP. The Worker independently enforces
the byte limit and verifies the WebP file signature before writing to R2.

Replacement writes a new immutable R2 key, updates known D1 content references,
records metadata and audit details, and then retires the old key. Deletion is
blocked while a known content reference exists. R2-only legacy objects remain
visible and can be replaced or deleted under the same safeguards.

## Validation sources

Shared Zod schemas live under `src/lib/schemas/`:

- `shared.ts` — statuses, slugs, SEO, and shared primitives
- `blocks.ts` — block-composed page types, including Work
- `singletons.ts` — singleton page/settings shapes
- `collections.ts` — collection record shapes
- `inquiry.ts` — public inquiry, lead-magnet, and admin lead-update shapes.
  Imported by BOTH the React forms and the API routes, so a field cannot drift
  between what the browser validates and what the server accepts.

Admin field descriptors define safe editor controls and previews; Zod remains
the write-validation authority. When a content shape changes, update all four
manual surfaces together: D1 repository/write path, Admin form, public read and
render path, and static fallback.

## Seeds and live databases

Seed files bootstrap a fresh environment and are not a live database mirror.
Never run the destructive full seed against an existing Preview or Production
database. Inspect current rows, apply a targeted idempotent update, and verify
the destination afterward.


## Code-composed pages vs. CMS content (2.4.0)

Since the 2.4.0 redesign (ADR 0013), Home, Solutions (the index and
`/solutions/<line>`), About, Products, Contact and the Insights frame are
composed in code. Their copy lives in `src/data/site/content.js` and their
rules (word budgets, headings, founder mentions) are enforced by
`tests/e2e/redesign.spec.js`. The page builder marks these pages
(`codeComposed` in `src/config/publicSurfaces.js`): edits are kept in history
but not shown.

The CMS still owns:

- **Work narratives + projects.** Each published narrative on the Work page,
  joined to its project, is a write-up at `/work/<slug>` (the project's slug,
  else its id without the `pN-` prefix) and may appear on Home, a service-line
  page and the profile (`src/lib/content/work.ts`). Starter templates
  (`clientType: template` or a `/landing-sample-*` address) never appear.
- **Articles**, with their problem tag, audience and header scene.
- **SEO records**, one per route (titles ≤ 60 characters, descriptions 120–160).
- **Navigation, footer, profile, certifications and the legal pages.**

The Service Catalog content type is no longer shown publicly; it is kept for
reference and history.

## Entry offers and lead magnets

`src/config/offers.js` is a server-owned registry. A form posts only an
`offerId`; everything about what is delivered is resolved from that file. The
lead-intake checklist's destination is the existing published Insights
article, not a fabricated download.

Lead-magnet landing pages live at `/offers/[slug]`. They are deliberately NOT
under `/resources/[slug]`, which is an existing permanent redirect into
`/insights/[slug]` — two meanings for one path would leave one silently
shadowing the other.

## Inquiries and operational data

Operational lead data is kept strictly out of the content collections. Five
tables, all covered by `migrations/0009_business_inquiry_platform.sql`:

| Table | Holds | Notes |
|---|---|---|
| `leads` | The inquiry itself | `status` is DELIVERY state (pending/delivered/failed); `pipeline_status` is the human workflow state. They answer different questions and are deliberately separate columns. |
| `lead_attribution` | Entry/source page, referrer, first- and latest-touch, UTMs, form/offer/solution/case-study/insight ids, anonymous id | One row per inquiry. Separate so it can be dropped for a privacy request without deleting the inquiry. |
| `lead_consents` | What the visitor agreed to, by VERSION | Append-only. Changing the consent wording later never rewrites what past visitors consented to. |
| `lead_activities` | Received, qualified, delivered, status change, assignment, note, retry | Safe summary metadata only — never message bodies, names, or note text. |
| `delivery_attempts` | One row per attempt, per target, never overwritten | Carries `error_category` (transient / permanent / configuration), which is what makes the admin's Retry button meaningful. |

Qualification is deterministic (`src/lib/leads/qualification.ts`) and stores
the reasons behind its result, so an admin can always see why a lead was
tiered. It is never shown to the visitor.

The admin surface is `/admin/leads` ("Inquiries"): filter by type, pipeline
status, qualification, delivery state and free-text search; change status;
assign an owner; add internal notes; view attribution, consent and activity;
retry an eligible failed delivery; soft archive; and export CSV. Every route
sits behind the blanket `/api/admin/*` gate in `src/middleware.ts`.

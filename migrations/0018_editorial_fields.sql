-- 0018: editorial fields for the B2B redesign (audit CMS-03).
--
-- ADDITIVE ONLY: new nullable/defaulted columns, no data rewritten, nothing
-- dropped. Safe to apply before or after the code that uses them: the
-- repositories check which columns exist (src/worker/repositories/columns.js)
-- and read/write the new ones only when present, so the site keeps working on
-- a database this has not reached yet.
--
-- Apply to preview first, verify, then production with the owner's token:
--   npx wrangler d1 migrations apply devlab-studios-cms-preview --remote --env preview
--   npx wrangler d1 migrations apply devlab-studios-cms --remote

-- Projects: write-up depth without invented numbers.
ALTER TABLE projects ADD COLUMN slug TEXT;
ALTER TABLE projects ADD COLUMN client_type TEXT NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN outcome_statements_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE projects ADD COLUMN system_diagram_id TEXT NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN evidence_note TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_slug ON projects(slug) WHERE slug IS NOT NULL AND slug <> '';

-- Articles: problem-led organisation, header art and per-article SEO.
ALTER TABLE articles ADD COLUMN audience TEXT NOT NULL DEFAULT '';
ALTER TABLE articles ADD COLUMN problem_tag TEXT NOT NULL DEFAULT '';
ALTER TABLE articles ADD COLUMN hero_visual_id TEXT NOT NULL DEFAULT '';
ALTER TABLE articles ADD COLUMN seo_title TEXT NOT NULL DEFAULT '';
ALTER TABLE articles ADD COLUMN seo_description TEXT NOT NULL DEFAULT '';
ALTER TABLE articles ADD COLUMN og_variant TEXT NOT NULL DEFAULT '';

-- SEO records: which social-card template to generate.
ALTER TABLE seo_metadata ADD COLUMN og_image_variant TEXT NOT NULL DEFAULT '';

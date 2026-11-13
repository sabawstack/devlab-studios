-- 2026-11-13: Terms of Service, "Portfolio and case studies" (spec C.3,
-- CMS-03; owner decision Q-06, approved 2026-11-13). The Work pages describe
-- real systems; the Terms called the same screenshots "illustrative". This
-- aligns the Terms with the Work evidence note.
--
-- Read first (2026-11-13): neither production nor preview stores a `terms`
-- page (0 rows in pages and page_sections), so /terms renders the static
-- src/data/pages/terms.js, changed in the same commit. This guarded update
-- touches only a stored section that still carries the old sentence, so it
-- is a no-op today and safe to re-run.
--
-- Apply: npx wrangler d1 execute <DB> [--env preview] --remote --file <this file>

UPDATE page_sections
SET content_json = REPLACE(
      content_json,
      'Project descriptions, screenshots, and outcomes shown on this site are presented for illustrative purposes. Specific results are not guaranteed for future engagements, since every project''s scope and constraints differ.',
      'Project descriptions and screenshots on this site are of real systems, shown with client data removed or replaced with synthetic data. Specific results are not guaranteed for future engagements, since every project''s scope and constraints differ.'
    ),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE page_id IN (SELECT id FROM pages WHERE slug = 'terms')
  AND INSTR(content_json, 'presented for illustrative purposes') > 0;

-- Revert (paired; run only to undo):
-- UPDATE page_sections
-- SET content_json = REPLACE(content_json,
--       'Project descriptions and screenshots on this site are of real systems, shown with client data removed or replaced with synthetic data. Specific results are not guaranteed for future engagements, since every project''s scope and constraints differ.',
--       'Project descriptions, screenshots, and outcomes shown on this site are presented for illustrative purposes. Specific results are not guaranteed for future engagements, since every project''s scope and constraints differ.'),
--     updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
-- WHERE page_id IN (SELECT id FROM pages WHERE slug = 'terms')
--   AND INSTR(content_json, 'shown with client data removed or replaced with synthetic data') > 0;

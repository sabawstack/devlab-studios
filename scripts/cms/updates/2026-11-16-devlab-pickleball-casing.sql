-- 2026-11-16: product casing "DevLab Pickleball" (owner decision 2 of the
-- Admin and Pickleball alignment spec, BRAND-04). The static fallbacks
-- (src/data/seoContent.js, src/data/pages/privacy.js) change in the same
-- commit; this brings stored rows in line. Display text only: no slug, key
-- or route changes.
--
-- Read first. INSTR is case-sensitive (LIKE is not), so only rows that still
-- say "Devlab Pickleball" change, and re-running is a no-op.
--   preview  (2026-11-16): see docs/plans/PROGRESS.md, Phase 15 Group 5
--   production: not applied; waits for the owner's approval with the release.
--
-- Apply: npx wrangler d1 execute <DB> [--env preview] --remote --file <this file>

UPDATE seo_metadata SET
    meta_title = REPLACE(meta_title, 'Devlab Pickleball', 'DevLab Pickleball'),
    meta_description = REPLACE(meta_description, 'Devlab Pickleball', 'DevLab Pickleball'),
    og_title = REPLACE(og_title, 'Devlab Pickleball', 'DevLab Pickleball'),
    og_description = REPLACE(og_description, 'Devlab Pickleball', 'DevLab Pickleball'),
    twitter_title = REPLACE(twitter_title, 'Devlab Pickleball', 'DevLab Pickleball'),
    twitter_description = REPLACE(twitter_description, 'Devlab Pickleball', 'DevLab Pickleball'),
    updated_at = CURRENT_TIMESTAMP
WHERE INSTR(meta_title, 'Devlab Pickleball') > 0 OR INSTR(meta_description, 'Devlab Pickleball') > 0 OR INSTR(og_title, 'Devlab Pickleball') > 0 OR INSTR(og_description, 'Devlab Pickleball') > 0 OR INSTR(twitter_title, 'Devlab Pickleball') > 0 OR INSTR(twitter_description, 'Devlab Pickleball') > 0;

UPDATE site_settings
SET value_json = REPLACE(value_json, 'Devlab Pickleball', 'DevLab Pickleball'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE INSTR(value_json, 'Devlab Pickleball') > 0;

UPDATE page_sections
SET content_json = REPLACE(content_json, 'Devlab Pickleball', 'DevLab Pickleball'), title = REPLACE(title, 'Devlab Pickleball', 'DevLab Pickleball'),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE INSTR(content_json, 'Devlab Pickleball') > 0 OR INSTR(title, 'Devlab Pickleball') > 0;

-- Revert (paired; run only to undo; it also lowers rows that were already "DevLab"):
-- UPDATE seo_metadata SET
--     meta_title = REPLACE(meta_title, 'DevLab Pickleball', 'Devlab Pickleball'),
--     meta_description = REPLACE(meta_description, 'DevLab Pickleball', 'Devlab Pickleball'),
--     og_title = REPLACE(og_title, 'DevLab Pickleball', 'Devlab Pickleball'),
--     og_description = REPLACE(og_description, 'DevLab Pickleball', 'Devlab Pickleball'),
--     twitter_title = REPLACE(twitter_title, 'DevLab Pickleball', 'Devlab Pickleball'),
--     twitter_description = REPLACE(twitter_description, 'DevLab Pickleball', 'Devlab Pickleball'),
--     updated_at = CURRENT_TIMESTAMP
-- WHERE INSTR(meta_title, 'DevLab Pickleball') > 0 OR INSTR(meta_description, 'DevLab Pickleball') > 0 OR INSTR(og_title, 'DevLab Pickleball') > 0 OR INSTR(og_description, 'DevLab Pickleball') > 0 OR INSTR(twitter_title, 'DevLab Pickleball') > 0 OR INSTR(twitter_description, 'DevLab Pickleball') > 0;
-- UPDATE site_settings SET value_json = REPLACE(value_json, 'DevLab Pickleball', 'Devlab Pickleball') WHERE INSTR(value_json, 'DevLab Pickleball') > 0;
-- UPDATE page_sections SET content_json = REPLACE(content_json, 'DevLab Pickleball', 'Devlab Pickleball'), title = REPLACE(title, 'DevLab Pickleball', 'Devlab Pickleball')
--   WHERE INSTR(content_json, 'DevLab Pickleball') > 0 OR INSTR(title, 'DevLab Pickleball') > 0;

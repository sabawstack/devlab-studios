-- 2026-11-13: home and Work content for the redesign (CMS-03; CONTENT-02,
-- SEO-01, CASE-01; copy approved by the owner 2026-11-13).
--
-- Read first (2026-11-13), production and preview:
--   site_settings.site_ctas = {"navbarContactLabel":"Discuss Your System","mobileContactLabel":"Discuss Your System"}
--     (overrides the new code defaults, so it must change with them)
--   projects.system_diagram_id = '' for the four write-ups (they fell back to S5)
--   seo_metadata(home).meta_title = 'DevLab Studios - Software & Automation Systems for Businesses' (production)
--                                   'DevLab Studios · Operations software that holds up' (preview)
-- Each UPDATE is guarded to rows still holding an old value, so it is a no-op
-- after an admin edit and safe to re-run. Paired reverts at the end.
--
-- Apply: npx wrangler d1 execute <DB> [--env preview] --remote --file <this file>

-- CONTENT-02: header labels "Talk to us" (phones: "Contact").
UPDATE site_settings
SET value_json = '{"navbarContactLabel":"Talk to us","mobileContactLabel":"Contact"}',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE key = 'site_ctas'
  AND json_extract(value_json, '$.navbarContactLabel') = 'Discuss Your System';

-- CASE-01 / spec H.1: each write-up shows its own system diagram.
UPDATE projects SET system_diagram_id = 'diagram-memory-preview' WHERE id = 'memory-preview' AND system_diagram_id = '';
UPDATE projects SET system_diagram_id = 'diagram-lead-qualification' WHERE id = 'p10-automated-lead-qualification' AND system_diagram_id = '';
UPDATE projects SET system_diagram_id = 'diagram-buyer-intelligence' WHERE id = 'p11-wholesaling-buyer-intelligence' AND system_diagram_id = '';
UPDATE projects SET system_diagram_id = 'diagram-messenger-agent' WHERE id = 'p6-messenger-ai-agent' AND system_diagram_id = '';

-- SEO-01: the home title and description follow the approved hero.
UPDATE seo_metadata
SET meta_title = 'Business systems that don''t quietly lose work · DevLab',
    og_title = 'Business systems that don''t quietly lose work · DevLab',
    twitter_title = 'Business systems that don''t quietly lose work · DevLab',
    meta_description = 'We design, build and run the software that connects your inquiries, records and tools, so nothing falls between them and someone always owns the next step.',
    og_description = 'We design, build and run the software that connects your inquiries, records and tools, so nothing falls between them and someone always owns the next step.',
    twitter_description = 'We design, build and run the software that connects your inquiries, records and tools, so nothing falls between them and someone always owns the next step.',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE page_slug = 'home'
  AND meta_title IN ('DevLab Studios - Software & Automation Systems for Businesses', 'DevLab Studios · Operations software that holds up');

-- Revert (paired; run only to undo):
-- UPDATE site_settings SET value_json = '{"navbarContactLabel":"Discuss Your System","mobileContactLabel":"Discuss Your System"}', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE key = 'site_ctas' AND json_extract(value_json, '$.navbarContactLabel') = 'Talk to us';
-- UPDATE projects SET system_diagram_id = '' WHERE id IN ('memory-preview', 'p10-automated-lead-qualification', 'p11-wholesaling-buyer-intelligence', 'p6-messenger-ai-agent') AND system_diagram_id LIKE 'diagram-%';
-- UPDATE seo_metadata SET meta_title = '<previous title read above>', og_title = '<same>', twitter_title = '<same>' WHERE page_slug = 'home' AND meta_title = 'Business systems that don''t quietly lose work · DevLab';

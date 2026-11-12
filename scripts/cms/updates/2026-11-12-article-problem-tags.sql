-- Problem tags and audiences for the 15 existing articles (audit SEO-08).
--
-- Targeted and idempotent: one UPDATE per article, matched by slug, and only
-- where the article has no tag yet, so an editor's later choice is never
-- overwritten. Needs migration 0018_editorial_fields (the columns).
--
-- Preview first, then production with the owner's token:
--   npx wrangler d1 execute devlab-studios-cms-preview --remote --env preview --file scripts/cms/updates/2026-11-12-article-problem-tags.sql
--   npx wrangler d1 execute devlab-studios-cms --remote --file scripts/cms/updates/2026-11-12-article-problem-tags.sql

UPDATE articles SET problem_tag = 'choosing-tools', audience = 'owner', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE slug = 'ai-automation-small-business-workflows' AND problem_tag = '' AND audience = '';
UPDATE articles SET problem_tag = 'lead-intake', audience = 'owner', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE slug = 'lead-intake-automation-checklist' AND problem_tag = '' AND audience = '';
UPDATE articles SET problem_tag = 'choosing-tools', audience = 'ops', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE slug = 'zapier-make-n8n-comparison' AND problem_tag = '' AND audience = '';
UPDATE articles SET problem_tag = 'data-consistency', audience = 'ops', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE slug = 'preparing-business-data-for-automation' AND problem_tag = '' AND audience = '';
UPDATE articles SET problem_tag = 'choosing-tools', audience = 'ops', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE slug = 'ai-agents-vs-workflow-automations' AND problem_tag = '' AND audience = '';
UPDATE articles SET problem_tag = 'handoffs', audience = 'ops', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE slug = 'writing-automation-runbooks' AND problem_tag = '' AND audience = '';
UPDATE articles SET problem_tag = 'choosing-tools', audience = 'technical', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE slug = 'what-better-ai-models-change-for-ops' AND problem_tag = '' AND audience = '';
UPDATE articles SET problem_tag = 'choosing-tools', audience = 'technical', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE slug = 'small-models-are-often-the-right-call' AND problem_tag = '' AND audience = '';
UPDATE articles SET problem_tag = 'integration-maintenance', audience = 'technical', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE slug = 'structured-output-changed-integration-work' AND problem_tag = '' AND audience = '';
UPDATE articles SET problem_tag = 'integration-maintenance', audience = 'technical', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE slug = 'inference-at-the-edge-what-it-changes' AND problem_tag = '' AND audience = '';
UPDATE articles SET problem_tag = 'data-consistency', audience = 'technical', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE slug = 'retrieval-is-plumbing-not-a-feature' AND problem_tag = '' AND audience = '';
UPDATE articles SET problem_tag = 'lead-intake', audience = 'owner', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE slug = 'why-website-speed-and-automation-now-overlap' AND problem_tag = '' AND audience = '';
UPDATE articles SET problem_tag = 'integration-maintenance', audience = 'ops', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE slug = 'what-breaks-first-in-an-automation' AND problem_tag = '' AND audience = '';
UPDATE articles SET problem_tag = 'silent-failures', audience = 'owner', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE slug = 'the-cost-of-a-silent-failure' AND problem_tag = '' AND audience = '';
UPDATE articles SET problem_tag = 'choosing-tools', audience = 'owner', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE slug = 'choosing-what-not-to-automate' AND problem_tag = '' AND audience = '';

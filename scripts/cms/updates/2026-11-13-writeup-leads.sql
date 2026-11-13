-- 2026-11-13: write-up leads of 30 words or fewer (CONTENT-05; spec I.1, I.3).
-- Read first (production and preview): each Work narrative item's
-- `description` (the write-up lead and meta description) was a 40–70-word
-- architecture sentence. The leads below restate only what each write-up
-- already says; the long architecture text stays on the project record and
-- is shown under Technical notes. Guarded: only rows still holding a
-- different lead. Revert: restore from content_versions (the admin keeps a
-- version of every saved page), or re-save the previous text in the admin.

UPDATE page_sections
SET content_json = json_set(content_json,
      '$.items[' || (SELECT key FROM json_each(page_sections.content_json, '$.items') WHERE json_extract(value, '$.projectId') = 'memory-preview') || '].description',
      'A knowledge system where ChatGPT proposes project memory, a person approves it, and approved knowledge is kept, versioned, in GitHub.'),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE page_id = (SELECT id FROM pages WHERE slug = 'work')
  AND json_valid(content_json)
  AND EXISTS (SELECT 1 FROM json_each(page_sections.content_json, '$.items') WHERE json_extract(value, '$.projectId') = 'memory-preview' AND json_extract(value, '$.description') <> 'A knowledge system where ChatGPT proposes project memory, a person approves it, and approved knowledge is kept, versioned, in GitHub.');

UPDATE page_sections
SET content_json = json_set(content_json,
      '$.items[' || (SELECT key FROM json_each(page_sections.content_json, '$.items') WHERE json_extract(value, '$.projectId') = 'p10-automated-lead-qualification') || '].description',
      'A real estate lead system that cleans new leads, calls them with an AI voice agent, records the result, and hands qualified sellers to a person.'),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE page_id = (SELECT id FROM pages WHERE slug = 'work')
  AND json_valid(content_json)
  AND EXISTS (SELECT 1 FROM json_each(page_sections.content_json, '$.items') WHERE json_extract(value, '$.projectId') = 'p10-automated-lead-qualification' AND json_extract(value, '$.description') <> 'A real estate lead system that cleans new leads, calls them with an AI voice agent, records the result, and hands qualified sellers to a person.');

UPDATE page_sections
SET content_json = json_set(content_json,
      '$.items[' || (SELECT key FROM json_each(page_sections.content_json, '$.items') WHERE json_extract(value, '$.projectId') = 'p11-wholesaling-buyer-intelligence') || '].description',
      'A deal-intake system that geocodes a property, looks up likely cash buyers, ranks them with AI, and puts the shortlist in a sheet for review.'),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE page_id = (SELECT id FROM pages WHERE slug = 'work')
  AND json_valid(content_json)
  AND EXISTS (SELECT 1 FROM json_each(page_sections.content_json, '$.items') WHERE json_extract(value, '$.projectId') = 'p11-wholesaling-buyer-intelligence' AND json_extract(value, '$.description') <> 'A deal-intake system that geocodes a property, looks up likely cash buyers, ranks them with AI, and puts the shortlist in a sheet for review.');

UPDATE page_sections
SET content_json = json_set(content_json,
      '$.items[' || (SELECT key FROM json_each(page_sections.content_json, '$.items') WHERE json_extract(value, '$.projectId') = 'p6-messenger-ai-agent') || '].description',
      'A Messenger agent that filters incoming messages, fetches context, drafts a reply with AI, and runs the follow-up actions.'),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE page_id = (SELECT id FROM pages WHERE slug = 'work')
  AND json_valid(content_json)
  AND EXISTS (SELECT 1 FROM json_each(page_sections.content_json, '$.items') WHERE json_extract(value, '$.projectId') = 'p6-messenger-ai-agent' AND json_extract(value, '$.description') <> 'A Messenger agent that filters incoming messages, fetches context, drafts a reply with AI, and runs the follow-up actions.');

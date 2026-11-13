-- 2026-11-13: Profile voice and grammar (CONTENT-04; spec I.1, I.3).
-- Read first (production and preview): profile_about.about ends in the first
-- person ("I connect every layer…") on a third-person page; two experience
-- bullets read "Troubleshooted…" (ai-automation-specialist) and "…applying
-- creative, technologically advanced solutions" (manufacturing-engineer).
-- Guarded REPLACEs: no-op once applied. Paired reverts below.

UPDATE site_settings
SET value_json = json_set(value_json, '$.about', REPLACE(json_extract(value_json, '$.about'), ' I connect every layer from customer experience to operational handoff so systems remain useful, reliable, and maintainable.', ' He connects every layer, from customer experience to operational handoff, so systems stay useful, reliable and maintainable.')),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE key = 'profile_about' AND json_valid(value_json) AND INSTR(json_extract(value_json, '$.about'), ' I connect every layer') > 0;

UPDATE experiences
SET bullets = REPLACE(bullets, 'Troubleshooted broken workflows, identified bottlenecks, and rebuilt processes for improved reliability and scalability.', 'Diagnosed broken workflows, identified bottlenecks, and rebuilt processes for reliability and scale.'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE INSTR(bullets, 'Troubleshooted broken workflows') > 0;

UPDATE experiences
SET bullets = REPLACE(bullets, 'Actively participated in continuous enhancement of manufacturing processes by applying creative, technologically advanced solutions.', 'Took part in continuous improvement of manufacturing processes, introducing practical technical fixes.'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE INSTR(bullets, 'creative, technologically advanced solutions') > 0;

-- Revert (paired; run only to undo):
-- UPDATE site_settings SET value_json = json_set(value_json, '$.about', REPLACE(json_extract(value_json, '$.about'), ' He connects every layer, from customer experience to operational handoff, so systems stay useful, reliable and maintainable.', ' I connect every layer from customer experience to operational handoff so systems remain useful, reliable, and maintainable.')) WHERE key = 'profile_about';
-- UPDATE experiences SET bullets = REPLACE(bullets, 'Diagnosed broken workflows, identified bottlenecks, and rebuilt processes for reliability and scale.', 'Troubleshooted broken workflows, identified bottlenecks, and rebuilt processes for improved reliability and scalability.') WHERE INSTR(bullets, 'Diagnosed broken workflows') > 0;
-- UPDATE experiences SET bullets = REPLACE(bullets, 'Took part in continuous improvement of manufacturing processes, introducing practical technical fixes.', 'Actively participated in continuous enhancement of manufacturing processes by applying creative, technologically advanced solutions.') WHERE INSTR(bullets, 'introducing practical technical fixes') > 0;

-- 2026-11-13: remove personal data from the stored profile and footer rows
-- (SEC-01 follow-up, SEO-04 consistency). Read first (2026-11-13, production,
-- values not repeated here): profile_about held a phone number, a date of
-- birth, a personal mailbox and a street-level address; site_footer held a
-- personal mailbox (also in its email link). Public pages already scrubbed
-- these on the read path; this removes them from the database itself.
-- Business values replace them: hello@devlabstudios.com and the city-level
-- location used everywhere on the site (COMPANY.locationLabel).
-- Guarded: each statement only touches a row that still holds a personal
-- value, so it is a no-op once applied. Revert: not provided on purpose (the
-- removed values are personal data that must not be restored from a script).

UPDATE site_settings
SET value_json = json_set(
      json_remove(value_json, '$.phone', '$.dateOfBirth'),
      '$.email', 'hello@devlabstudios.com',
      '$.location', 'Lapu-Lapu City, Cebu, Philippines'
    ),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE key = 'profile_about'
  AND json_valid(value_json)
  AND (json_type(value_json, '$.phone') IS NOT NULL
       OR json_type(value_json, '$.dateOfBirth') IS NOT NULL
       OR json_extract(value_json, '$.email') <> 'hello@devlabstudios.com'
       OR json_extract(value_json, '$.location') <> 'Lapu-Lapu City, Cebu, Philippines');

UPDATE site_settings
SET value_json = json_set(
      value_json,
      '$.email', 'hello@devlabstudios.com',
      '$.location', 'Lapu-Lapu City, Cebu, Philippines',
      '$.socialLinks', COALESCE((
        SELECT json_group_array(
          CASE
            WHEN json_extract(link.value, '$.href') LIKE 'mailto:%'
              THEN json_set(link.value, '$.href', 'mailto:hello@devlabstudios.com')
            ELSE json(link.value)
          END
        )
        FROM json_each(site_settings.value_json, '$.socialLinks') AS link
      ), json('[]'))
    ),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE key = 'site_footer'
  AND json_valid(value_json)
  AND INSTR(value_json, '@gmail') > 0;

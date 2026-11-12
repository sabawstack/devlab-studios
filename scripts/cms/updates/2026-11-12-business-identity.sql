-- Business identity and personal-data cleanup (audit BUS-05 / PROF-02).
--
-- Targeted and idempotent: two site_settings rows, matched by key; re-running
-- changes nothing further. Nothing is deleted except the two personal keys
-- inside profile_about.
--
-- The public pages already enforce this on the read path (src/config/company.js
-- scrubPersonalContacts / publicContactEmail, src/lib/content/publicAbout.ts),
-- so this only brings the stored data in line with what is shown.
--
-- Preview first, then production with the owner's token:
--   npx wrangler d1 execute devlab-studios-cms-preview --remote --env preview --file scripts/cms/updates/2026-11-12-business-identity.sql
--   npx wrangler d1 execute devlab-studios-cms --remote --file scripts/cms/updates/2026-11-12-business-identity.sql
-- Read back afterwards:
--   SELECT key, value_json FROM site_settings WHERE key IN ('site_footer', 'profile_about');

-- 1. Footer: the business address, city-level location, no retired tagline,
--    and any personal "Email" social link pointed at the business address.
UPDATE site_settings
SET value_json = json_set(
      value_json,
      '$.email', 'hello@devlabstudios.com',
      '$.location', 'Cebu, Philippines',
      '$.tagline', '',
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
  AND json_valid(value_json);

-- 2. Founder profile: no phone or date of birth; business address; city-level location.
UPDATE site_settings
SET value_json = json_set(
      json_remove(value_json, '$.phone', '$.dateOfBirth'),
      '$.email', 'hello@devlabstudios.com',
      '$.location', 'Cebu, Philippines'
    ),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE key = 'profile_about'
  AND json_valid(value_json);

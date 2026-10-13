-- Per-recipient cap on visitor confirmation emails (security audit F4 / M5).
--
-- The contact, inquiry and lead-magnet forms send a confirmation to whatever
-- address the visitor typed. Without a cap, anyone who can pass Turnstile can
-- point DevLab-branded, DKIM-signed mail at an arbitrary inbox as often as the
-- per-IP limiter allows. One confirmation per address per 24 hours bounds that
-- to a nuisance, while the owner notification for every submission is
-- unaffected.
--
-- The address is stored ONLY as a SHA-256 hash (of a fixed prefix plus the
-- normalized address) — this table needs to answer "did we write to this
-- address recently", never "who did we write to".
--
-- One row per address, overwritten on each send. No CHECK constraints and no
-- INSERT OR IGNORE: the claim is an upsert whose WHERE clause decides, and its
-- change count is read back explicitly (see src/worker/delivery/confirmationCap.js).

CREATE TABLE IF NOT EXISTS confirmation_recipients (
  address_hash TEXT PRIMARY KEY,
  last_sent_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_confirmation_recipients_last_sent
  ON confirmation_recipients (last_sent_at);

-- migrations/pickleball/0019_hosts.sql
-- Free sessions, Phase 4: Google-verified hosts for the DUPR export
-- (spec 2026-10-11-pickleball-free-open-play-design.md §3.2, §9).
--
-- hosts is account data a host chose to create. It is NOT subject to the
-- 7-day session expiry; "Delete my account" removes it. marketing_opt_in
-- defaults to 0 (unticked) and is only ever set by the host.
--
-- host_logins: one row per signed-in browser. The devlab_pb_host cookie holds
-- a random token; only its SHA-256 is stored, like the session host key. A
-- login cascades away with its host, so deleting an account signs it out
-- everywhere at once. Expired rows are removed by the daily cron.
--
-- open_sessions.host_id: set once, by a claim made with the session's host key
-- (§9.2). ON DELETE SET NULL, so deleting an account unlinks its sessions but
-- leaves them running and expiring exactly like any other session. ADD COLUMN
-- with a REFERENCES clause is allowed on SQLite/D1 because its default is NULL;
-- only table rebuilds are dangerous on D1.
--
-- open_host_keys: extra host links minted for a signed-in host who reopens a
-- claimed session from another device (§9.5, the lost-link recovery path).
-- Only hashes are stored. They cascade from open_sessions, so the purge
-- removes them.
--
-- open_dupr_exports: one row per DUPR email sent, for the 5-per-session-per-day
-- limit (§9.6). No host or recipient column: the limit is per session, and
-- the log needs no personal data. Cascades from open_sessions.

CREATE TABLE hosts (
  id               TEXT PRIMARY KEY,
  google_sub       TEXT NOT NULL UNIQUE,
  email            TEXT NOT NULL,
  display_name     TEXT NOT NULL,
  dupr_club_id     TEXT,
  marketing_opt_in INTEGER NOT NULL DEFAULT 0 CHECK (marketing_opt_in IN (0, 1)),
  created_at       TEXT NOT NULL,
  last_seen_at     TEXT NOT NULL
);

CREATE TABLE host_logins (
  token_hash TEXT PRIMARY KEY,
  host_id    TEXT NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_host_logins_host ON host_logins(host_id);
CREATE INDEX idx_host_logins_expires_at ON host_logins(expires_at);

ALTER TABLE open_sessions ADD COLUMN host_id TEXT REFERENCES hosts(id) ON DELETE SET NULL;
CREATE INDEX idx_open_sessions_host ON open_sessions(host_id);

CREATE TABLE open_host_keys (
  id         TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES open_sessions(id) ON DELETE CASCADE,
  key_hash   TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_open_host_keys_session ON open_host_keys(session_id);

CREATE TABLE open_dupr_exports (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL REFERENCES open_sessions(id) ON DELETE CASCADE,
  sent_at       TEXT NOT NULL,
  game_count    INTEGER NOT NULL,
  skipped_count INTEGER NOT NULL
);
CREATE INDEX idx_open_dupr_exports_session ON open_dupr_exports(session_id, sent_at);

-- migrations/pickleball/0017_open_captains.sql
-- Free open play, Phase 2 (spec 2026-10-11-pickleball-free-open-play-design.md §3.2, §3.3).
--
-- open_captains: one row per court-captain link. Only the SHA-256 of the
-- link's secret is stored. A revoked link keeps its row (revoked_at set) so
-- the host's history makes sense; everything cascades from open_sessions, so
-- the 7-day purge still removes it.
--
-- open_matches.recorded_by: who saved a result ('Host' or a captain's label),
-- so a second save can say "This game was already saved by Court 2 captain."
-- (spec §3.4).
-- ADD COLUMN is safe on D1; only table rebuilds are not. No CHECK here: the
-- value is free text by design, so there is nothing to widen later.

CREATE TABLE open_captains (
  id         TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES open_sessions(id) ON DELETE CASCADE,
  court_id   TEXT NOT NULL REFERENCES open_courts(id) ON DELETE CASCADE,
  key_hash   TEXT NOT NULL UNIQUE,
  label      TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX idx_open_captains_session ON open_captains(session_id);
-- court_id is a cascading foreign key too, so it gets an index like session_id.
CREATE INDEX IF NOT EXISTS idx_open_captains_court ON open_captains(court_id);

ALTER TABLE open_matches ADD COLUMN recorded_by TEXT;

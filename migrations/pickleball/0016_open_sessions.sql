--
-- Free, no-login open play (spec 2026-10-11-pickleball-free-open-play-design.md §3.2).
-- No user or organization columns: a session is owned by whoever holds its host
-- secret, and everything below cascades from open_sessions so the 7-day purge
-- is one DELETE. Enum CHECKs are deliberately wider than Phase 1 uses -- a
-- CHECK cannot be widened on D1 later (docs/pickleball/architecture.md).

CREATE TABLE open_sessions (
  id                TEXT PRIMARY KEY,
  public_code       TEXT NOT NULL UNIQUE,
  host_key_hash     TEXT NOT NULL,
  kind              TEXT NOT NULL CHECK (kind IN ('OPEN_PLAY', 'TOURNAMENT')),
  name              TEXT NOT NULL,
  host_display_name TEXT NOT NULL,
  location          TEXT,
  settings_json     TEXT NOT NULL,
  status            TEXT NOT NULL CHECK (status IN ('ACTIVE', 'ENDED')),
  version           INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL,
  last_activity_at  TEXT NOT NULL,
  expires_at        TEXT NOT NULL
);
CREATE INDEX idx_open_sessions_expires_at ON open_sessions(expires_at);

CREATE TABLE open_courts (
  id         TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES open_sessions(id) ON DELETE CASCADE,
  label      TEXT NOT NULL,
  position   INTEGER NOT NULL,
  enabled    INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1))
);
CREATE INDEX idx_open_courts_session ON open_courts(session_id);

CREATE TABLE open_players (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL REFERENCES open_sessions(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  skill         REAL,
  dupr_id       TEXT,
  status        TEXT NOT NULL CHECK (status IN ('ACTIVE', 'BREAK', 'LEFT')),
  games_offset  INTEGER NOT NULL DEFAULT 0,
  joined_at     TEXT NOT NULL,
  waiting_since TEXT NOT NULL,
  position      INTEGER NOT NULL
);
CREATE INDEX idx_open_players_session ON open_players(session_id);

CREATE TABLE open_matches (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL REFERENCES open_sessions(id) ON DELETE CASCADE,
  court_id    TEXT NOT NULL REFERENCES open_courts(id) ON DELETE CASCADE,
  seq         INTEGER NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('PROPOSED', 'IN_PROGRESS', 'FINISHED', 'ABANDONED')),
  team_a_json TEXT NOT NULL,
  team_b_json TEXT NOT NULL,
  score_a     INTEGER,
  score_b     INTEGER,
  winner      TEXT CHECK (winner IN ('A', 'B')),
  fixture_id  TEXT,
  proposed_at TEXT NOT NULL,
  started_at  TEXT,
  finished_at TEXT
);
CREATE INDEX idx_open_matches_session ON open_matches(session_id, seq);

CREATE TABLE open_idempotency (
  session_id    TEXT NOT NULL REFERENCES open_sessions(id) ON DELETE CASCADE,
  key           TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  PRIMARY KEY (session_id, key)
);

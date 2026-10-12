-- migrations/pickleball/0018_open_tournaments.sql
-- Free sessions, Phase 3: doubles tournaments (spec 2026-10-11-pickleball-free-open-play-design.md §3.2, §6).
--
-- A tournament is an open_sessions row with kind = 'TOURNAMENT' (that CHECK
-- was written wide in 0016 for exactly this). It reuses the session's courts,
-- players, matches (open_matches.fixture_id, also from 0016), captains and
-- the 7-day purge: every table below cascades from open_sessions.
--
-- CHECKs: format, bracket and fixture status mirror the reused generator
-- (src/lib/pickleball/tournament/generateFixtures.ts), whose values the spec
-- fixes ("unchanged", §6.2). pairing, seeding and phase are this product's own
-- and may grow, so they carry no CHECK and are normalized on read. A CHECK
-- cannot be widened on D1 later (docs/pickleball/architecture.md, "Schema
-- constraint").
--
-- Rows have no order column: the engine keeps entrants sorted by seed and
-- fixtures in one canonical order (tournament/order.ts), and the loader reads
-- them back in that same order.
--
-- Entrant and fixture ids reference each other only as text: a regenerated
-- draft deletes and re-inserts both in one batch, and the pure engine is what
-- keeps them consistent (drawEdits.ts validates every change).

CREATE TABLE open_tournaments (
  session_id TEXT PRIMARY KEY REFERENCES open_sessions(id) ON DELETE CASCADE,
  format     TEXT NOT NULL CHECK (format IN ('ROUND_ROBIN', 'POOL_TO_BRACKET', 'SINGLE_ELIMINATION', 'DOUBLE_ELIMINATION')),
  pairing    TEXT NOT NULL,
  seeding    TEXT NOT NULL,
  phase      TEXT NOT NULL,
  started_at TEXT
);

CREATE TABLE open_tournament_entrants (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL REFERENCES open_sessions(id) ON DELETE CASCADE,
  player_a_id TEXT NOT NULL,
  player_b_id TEXT NOT NULL,
  seed        INTEGER NOT NULL,
  pool_label  TEXT
);
CREATE INDEX idx_open_tournament_entrants_session ON open_tournament_entrants(session_id, seed);

CREATE TABLE open_tournament_fixtures (
  id                TEXT PRIMARY KEY,
  session_id        TEXT NOT NULL REFERENCES open_sessions(id) ON DELETE CASCADE,
  bracket           TEXT NOT NULL CHECK (bracket IN ('POOL', 'MAIN', 'LOSERS')),
  pool_label        TEXT,
  round_number      INTEGER NOT NULL,
  position          INTEGER NOT NULL,
  entrant_a_id      TEXT,
  entrant_b_id      TEXT,
  source_a          TEXT,
  source_b          TEXT,
  winner_entrant_id TEXT,
  status            TEXT NOT NULL CHECK (status IN ('PENDING', 'READY', 'IN_PROGRESS', 'FINISHED', 'BYE'))
);
CREATE INDEX idx_open_tournament_fixtures_session ON open_tournament_fixtures(session_id);

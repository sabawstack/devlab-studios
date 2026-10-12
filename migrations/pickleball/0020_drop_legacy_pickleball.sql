-- migrations/pickleball/0020_drop_legacy_pickleball.sql
-- Free sessions, Phase 5: retire the logged-in operator app's data
-- (spec 2026-10-11-pickleball-free-open-play-design.md §12).
--
-- Drops the 27 tables of migrations 0001-0015 and their one trigger. The
-- open_* tables, hosts and host_logins (0016-0019) are not touched.
--
-- Order matters: children before parents. D1 enforces foreign keys, and
-- DROP TABLE first runs an implicit DELETE, so dropping a table that a
-- remaining table still references with rows would fail the migration.
-- src/worker/repositories/pickleball/open/dropLegacy.test.ts checks this order
-- against the real foreign keys of 0001-0015.
--
-- IF EXISTS everywhere, so the file is a no-op for anything already gone. DROP
-- TABLE is safe on D1; only table rebuilds are dangerous (docs/pickleball/
-- architecture.md, "Schema constraint"). Take a `wrangler d1 export` backup
-- first (docs/pickleball/runbook.md, "Retire the legacy tables").

DROP TRIGGER IF EXISTS trg_session_pairs_one_active_pair_per_player;

DROP TABLE IF EXISTS audit_events;
DROP TABLE IF EXISTS player_performance_snapshots;
DROP TABLE IF EXISTS player_game_stats;
DROP TABLE IF EXISTS matchmaking_history;
DROP TABLE IF EXISTS idempotency_keys;
DROP TABLE IF EXISTS score_events;
DROP TABLE IF EXISTS game_participants;
DROP TABLE IF EXISTS tournament_fixtures;
DROP TABLE IF EXISTS tournament_entrants;
DROP TABLE IF EXISTS games;
DROP TABLE IF EXISTS team_members;
DROP TABLE IF EXISTS teams;
DROP TABLE IF EXISTS queue_entries;
DROP TABLE IF EXISTS session_pairs;
DROP TABLE IF EXISTS session_players;
DROP TABLE IF EXISTS session_operator_grants;
DROP TABLE IF EXISTS public_session_tokens;
DROP TABLE IF EXISTS session_courts;
DROP TABLE IF EXISTS pickleball_sessions;
DROP TABLE IF EXISTS scoring_rulesets;
DROP TABLE IF EXISTS courts;
DROP TABLE IF EXISTS venues;
DROP TABLE IF EXISTS players;
DROP TABLE IF EXISTS organization_invites;
DROP TABLE IF EXISTS organization_memberships;
DROP TABLE IF EXISTS organizations;
DROP TABLE IF EXISTS users;

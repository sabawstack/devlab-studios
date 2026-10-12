# Devlab Pickleball — Schema

D1 database `PICKLEBALL_DB` (production `devlab-pickleball`, preview
`devlab-pickleball-preview`), migrations in `migrations/pickleball/`. Every
session-owned table cascades from `open_sessions`, so the daily purge deletes a
session with one `DELETE` (`src/worker/pickleball/open/purge.ts`). Rules: a
CHECK cannot be widened later, `ALTER TABLE … ADD COLUMN` is safe, never
rebuild a table (`architecture.md`, "Schema constraint"). Timestamps are ISO
8601 text; ids are random UUIDs unless noted.

## Migration files

| File | What it does |
|---|---|
| `0001`–`0015` | The retired operator app's schema. Kept because D1 records applied migrations by file name; never edit them. Their tables are gone (0020). |
| `0016_open_sessions.sql` | `open_sessions`, `open_courts`, `open_players`, `open_matches`, `open_idempotency` |
| `0017_open_captains.sql` | `open_captains`; `open_matches.recorded_by` |
| `0018_open_tournaments.sql` | `open_tournaments`, `open_tournament_entrants`, `open_tournament_fixtures` |
| `0019_hosts.sql` | `hosts`, `host_logins`, `open_sessions.host_id`, `open_host_keys`, `open_dupr_exports` |
| `0020_drop_legacy_pickleball.sql` | Drops the 27 tables of 0001–0015 and their trigger, children first |

## Sessions

### `open_sessions`

| Column | Notes |
|---|---|
| `id` | primary key |
| `public_code` | UNIQUE, 10 characters, in the board URL `/pickleball/s/{code}` |
| `host_key_hash` | SHA-256 of the host secret (the secret is never stored) |
| `kind` | `OPEN_PLAY` or `TOURNAMENT` (CHECK), fixed at creation |
| `name`, `host_display_name`, `location` | free text; `location` nullable |
| `settings_json` | mode, target, scoring style, keep-together/apart rules (read through `normalizeSettings`) |
| `status` | `ACTIVE` or `ENDED` (CHECK) |
| `version` | bumped by every command; persisted so it survives hibernation |
| `created_at`, `last_activity_at`, `expires_at` | `expires_at` = last activity + 7 days; indexed for the purge |
| `host_id` | nullable, `REFERENCES hosts(id) ON DELETE SET NULL`: the Google account that claimed the session (0019) |

### `open_courts`
`id`, `session_id` (cascade), `label`, `position`, `enabled` (0/1).

### `open_players`
`id`, `session_id` (cascade), `name`, `skill` (nullable real), `dupr_id` (nullable),
`status` (`ACTIVE` | `BREAK` | `LEFT`), `games_offset` (a late player's starting
count), `joined_at`, `waiting_since`, `position`.

### `open_matches`
`id`, `session_id` (cascade), `court_id` (cascade), `seq`, `status`
(`PROPOSED` | `IN_PROGRESS` | `FINISHED` | `ABANDONED`), `team_a_json`,
`team_b_json` (player id pairs), `score_a`, `score_b`, `winner` (`A` | `B`),
`fixture_id` (a tournament game's fixture, text), `proposed_at`, `started_at`,
`finished_at`, `recorded_by` (`Host` or a captain's label, 0017).

### `open_idempotency`
Primary key (`session_id`, `key`); `response_json`, `created_at`. Replays a retried command's response.

### `open_captains` (0017)
`id`, `session_id` (cascade), `court_id` (cascade), `key_hash` (UNIQUE), `label`,
`created_at`, `revoked_at` (a revoked link keeps its row).

## Tournaments (0018)

### `open_tournaments`
`session_id` (primary key, cascade), `format` (`ROUND_ROBIN` | `POOL_TO_BRACKET` |
`SINGLE_ELIMINATION` | `DOUBLE_ELIMINATION`), `pairing`, `seeding`, `phase`
(no CHECK; normalized on read), `started_at`.

### `open_tournament_entrants`
`id`, `session_id` (cascade), `player_a_id`, `player_b_id`, `seed`, `pool_label`.

### `open_tournament_fixtures`
`id`, `session_id` (cascade), `bracket` (`POOL` | `MAIN` | `LOSERS`), `pool_label`,
`round_number`, `position`, `entrant_a_id`, `entrant_b_id`, `source_a`,
`source_b`, `winner_entrant_id`, `status` (`PENDING` | `READY` | `IN_PROGRESS` |
`FINISHED` | `BYE`). Rows have no order column: `tournament/order.ts` is the one
order. Entrant and fixture ids reference each other only as text.

## Hosts and the DUPR export (0019)

### `hosts`
`id`, `google_sub` (UNIQUE), `email` (verified Google address), `display_name`,
`dupr_club_id`, `marketing_opt_in` (0/1, default 0), `created_at`,
`last_seen_at`. Not subject to the 7-day expiry; removed by "Delete my account".

### `host_logins`
`token_hash` (primary key, SHA-256 of the `devlab_pb_host` cookie's token),
`host_id` (cascade from `hosts`), `created_at`, `expires_at` (30 days; the daily
cron deletes expired rows).

### `open_host_keys`
`id`, `session_id` (cascade), `key_hash` (UNIQUE), `created_at`: extra host links
minted when a signed-in host reopens a claimed session (at most 10).

### `open_dupr_exports`
`id`, `session_id` (cascade), `sent_at`, `game_count`, `skipped_count`: one row per
export email, for the 5-per-24-hours limit. No personal data.

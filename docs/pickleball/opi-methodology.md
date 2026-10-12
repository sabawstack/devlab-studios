# Devlab Pickleball — OPI Methodology

> **Retired (2.0.0).** OPI and its public page (`/pickleball/methodology`) were removed with the logged-in app. One idea survives: free-session standings break ties by the same per-game share of points won (`src/lib/pickleball/open/standings.ts`). The rest of this document is history.

OPI (Open Play Performance Index) is a Devlab-original performance metric.
It is **not** an official USA Pickleball rating, DUPR, UTR-P, or Elo system,
and the software computing it is not USA-Pickleball-certified — this
disclaimer appears on the public `/pickleball/methodology` page verbatim and
must never be contradicted elsewhere in the UI or in this document.

## Formula

For a single finished, eligible game, a player's **game performance** is:

```
game_performance = (points_for / (points_for + points_against)) * 100
```

A player's **OPI** for a given scope (a single session, or all-time) is the
mean of their `game_performance` across every eligible finished game in that
scope:

```
opi = performance_sum / eligible_games_count
```

Canonical worked examples (from `src/lib/pickleball/opi.test.ts`, the single
source of truth this document must never drift from — re-read that file if
these numbers ever look wrong):

- 11-7 → 61.111...
- 9-11 → 45
- 11-5 → 68.75
- Mean of those three games → 58.287..., displayed rounded to 58.29

## Eligibility

A game contributes to OPI only if `player_game_stats.eligible_for_opi` is
true for that player/game row. A game abandoned (`status = 'ABANDONED'`) is
excluded (§57 edge case #18). A correction or reopen fully invalidates and
recomputes every affected player's stats and snapshots from scratch — see
§7/§57 edge cases #20-21 and `SessionCoordinatorDO.ts`'s `reopenGame`/
`correctGame` methods, which delete and rebuild `player_game_stats`,
`matchmaking_history`, and `player_performance_snapshots` rows inside the
same D1 batch as the correction itself, never incrementing/decrementing.

## Confidence tiers

| Tier | Eligible games |
|---|---|
| Provisional | 0-2 |
| Developing | 3-9 |
| Established | 10+ |

Exact thresholds: `src/lib/pickleball/opi.ts`'s `confidenceTier()` function
(`>= 10` → `ESTABLISHED`, `>= 3` → `DEVELOPING`, else `PROVISIONAL`) — this
document's table must match that function exactly, not the other way around.

## Storage: `player_performance_snapshots`

Snapshots are maintained incrementally on game finalization/correction for
read performance, but are always fully rebuildable from `player_game_stats`
(itself rebuildable from the append-only `score_events` log via
`rebuildGameProjection`). Two scope types: `SESSION` (one row per session a
player has an eligible game in, `scope_id` = that session's id) and
`ALL_TIME` (`scope_id` = the literal string `'ALL_TIME'`, not `NULL` —
SQLite's `UNIQUE` index treats every `NULL` as distinct from every other
`NULL`, so a `NULL` `scope_id` could never actually enforce "at most one
all-time row per player"). `opi_version` defaults to `'OPI_V1_SCORE_SHARE'`,
reserved for a hypothetical future formula change.

## Team pairing (`balanceTeams`)

Separate from the OPI formula itself: once the queue engine has selected
which players will play (by fairness, not OPI — see the queue engine's own
rules), `balanceTeams` decides how to split them into two competitive sides
by brute-forcing every into-two-sides partition (exactly 3 for 4 players,
trivial for 2) and picking the one minimizing the OPI-sum difference between
sides.

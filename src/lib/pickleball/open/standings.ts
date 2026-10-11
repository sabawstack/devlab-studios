// src/lib/pickleball/open/standings.ts
import type { OpenMatch, OpenPlayer } from './types'

export interface StandingRow {
  playerId: string
  name: string
  played: number
  wins: number
  losses: number
  pointsFor: number
  pointsAgainst: number
  scoredGames: number
  winRate: number | null
  avgDiff: number | null
  avgFor: number | null
  rank: number | null
}

const EPSILON = 1e-9

interface Tally { played: number; wins: number; losses: number; pointsFor: number; pointsAgainst: number; scoredGames: number }
const EMPTY: Tally = { played: 0, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0, scoredGames: 0 }

function tallies(matches: readonly OpenMatch[]): ReadonlyMap<string, Tally> {
  return matches.reduce((acc, match) => {
    const scored = match.scoreA !== null && match.scoreB !== null
    const sides = [
      { team: match.teamA, won: match.winner === 'A', pf: match.scoreA ?? 0, pa: match.scoreB ?? 0 },
      { team: match.teamB, won: match.winner === 'B', pf: match.scoreB ?? 0, pa: match.scoreA ?? 0 },
    ]
    const next = new Map(acc)
    for (const side of sides) {
      for (const id of side.team) {
        const t = next.get(id) ?? EMPTY
        next.set(id, {
          played: t.played + 1,
          wins: t.wins + (side.won ? 1 : 0),
          losses: t.losses + (side.won ? 0 : 1),
          pointsFor: t.pointsFor + (scored ? side.pf : 0),
          pointsAgainst: t.pointsAgainst + (scored ? side.pa : 0),
          scoredGames: t.scoredGames + (scored ? 1 : 0),
        })
      }
    }
    return next
  }, new Map<string, Tally>())
}

function toRow(p: OpenPlayer, t: Tally): StandingRow {
  return {
    playerId: p.id, name: p.name, ...t,
    winRate: t.played ? t.wins / t.played : null,
    avgDiff: t.scoredGames ? (t.pointsFor - t.pointsAgainst) / t.scoredGames : null,
    avgFor: t.scoredGames ? t.pointsFor / t.scoredGames : null,
    rank: null,
  }
}

/** Descending; a null sorts after any number. */
function desc(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  return Math.abs(a - b) < EPSILON ? 0 : b - a
}

function compareCore(a: StandingRow, b: StandingRow): number {
  return desc(a.winRate, b.winRate) || desc(a.avgDiff, b.avgDiff) || desc(a.avgFor, b.avgFor)
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

/** Reorders a fully tied group by head-to-head wins if every pair met (spec §5.3 rule 4); else by name. */
function breakTie(group: StandingRow[], finished: readonly OpenMatch[]): StandingRow[] {
  const byName = [...group].sort((a, b) => a.name.localeCompare(b.name))
  if (group.length < 2) return byName
  const ids = new Set(group.map((row) => row.playerId))
  const met = new Set<string>()
  const h2h = new Map(group.map((row) => [row.playerId, 0]))
  for (const match of finished) {
    for (const a of match.teamA) {
      for (const b of match.teamB) {
        if (!ids.has(a) || !ids.has(b)) continue
        met.add(pairKey(a, b))
        const winnerId = match.winner === 'A' ? a : b
        h2h.set(winnerId, (h2h.get(winnerId) ?? 0) + 1)
      }
    }
  }
  const allMet = byName.every((a, i) => byName.slice(i + 1).every((b) => met.has(pairKey(a.playerId, b.playerId))))
  if (!allMet) return byName
  return byName.sort((a, b) => (h2h.get(b.playerId) ?? 0) - (h2h.get(a.playerId) ?? 0))
}

export function computeStandings(players: readonly OpenPlayer[], matches: readonly OpenMatch[]): StandingRow[] {
  const finished = matches.filter((m) => m.status === 'FINISHED' && m.winner !== null)
  const byPlayer = tallies(finished)
  const rows = players
    .map((p) => toRow(p, byPlayer.get(p.id) ?? EMPTY))
    .filter((row) => row.played > 0 || players.find((p) => p.id === row.playerId)?.status !== 'LEFT')

  const ranked = rows.filter((row) => row.played > 0).sort(compareCore)
  const unranked = rows.filter((row) => row.played === 0).sort((a, b) => a.name.localeCompare(b.name))

  const ordered: StandingRow[] = []
  let i = 0
  while (i < ranked.length) {
    let j = i + 1
    while (j < ranked.length && compareCore(ranked[i], ranked[j]) === 0) j += 1
    ordered.push(...breakTie(ranked.slice(i, j), finished))
    i = j
  }
  return [...ordered.map((row, index) => ({ ...row, rank: index + 1 })), ...unranked]
}

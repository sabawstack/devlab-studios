// src/lib/pickleball/open/tournament/drawRules.ts
// The rules every draw must keep (spec §6.4), checked after every edit:
// - every pair is two different players, and nobody is in two pairs;
// - no pair is twice in one round;
// - round robin and each pool: every pair plays every other pair of its group exactly once
//   (so every pair keeps its fixture count), and a pool keeps at least 2 pairs;
// - knockout brackets keep their shape: the same games, fed from the same places,
//   with every pair placed exactly once.
import type { OpenPlayer } from '../types'
import { pairName, roundLabel } from './labels'
import type { TournamentEntrant, TournamentFixture, TournamentState } from './types'

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)

function nameOf(t: TournamentState, players: readonly OpenPlayer[], entrantId: string): string {
  const entrant = t.entrants.find((e) => e.id === entrantId)
  return entrant ? pairName(entrant, players) : 'A pair'
}

function checkPlayers(t: TournamentState, players: readonly OpenPlayer[]): string | null {
  const seen = new Map<string, string>()
  for (const entrant of t.entrants) {
    const [a, b] = entrant.playerIds
    if (a === b) return 'A pair needs two different players.'
    for (const id of entrant.playerIds) {
      const player = players.find((p) => p.id === id)
      if (!player) return 'That player is not in this session.'
      if (seen.has(id)) return `${player.name} would be in two pairs.`
      seen.set(id, entrant.id)
    }
  }
  return null
}

function slotsOf(f: TournamentFixture): string[] {
  return [f.entrantAId, f.entrantBId].filter((id): id is string => id !== null)
}

function checkRounds(t: TournamentState, players: readonly OpenPlayer[]): string | null {
  const byRound = new Map<string, TournamentFixture[]>()
  for (const f of t.fixtures) {
    const key = `${f.bracket}:${f.poolLabel ?? ''}:${f.roundNumber}`
    byRound.set(key, [...(byRound.get(key) ?? []), f])
  }
  for (const round of byRound.values()) {
    const seen = new Set<string>()
    for (const f of round) {
      if (f.entrantAId !== null && f.entrantAId === f.entrantBId) return `${nameOf(t, players, f.entrantAId)} can't play themselves.`
      for (const id of slotsOf(f)) {
        if (seen.has(id)) return `${nameOf(t, players, id)} would play twice in ${roundLabel(t.format, t.fixtures, f)}.`
        seen.add(id)
      }
    }
  }
  return null
}

/** One round-robin group: these pairs, these fixtures, every pair meets every other exactly once. */
function checkGroup(t: TournamentState, players: readonly OpenPlayer[], members: readonly TournamentEntrant[], fixtures: readonly TournamentFixture[]): string | null {
  const inGroup = new Set(members.map((e) => e.id))
  const met = new Map<string, number>()
  for (const f of fixtures) {
    for (const id of slotsOf(f)) if (!inGroup.has(id)) return `${nameOf(t, players, id)} isn't in ${f.poolLabel ? `Pool ${f.poolLabel}` : 'this round robin'}.`
    if (f.entrantAId && f.entrantBId) met.set(pairKey(f.entrantAId, f.entrantBId), (met.get(pairKey(f.entrantAId, f.entrantBId)) ?? 0) + 1)
  }
  for (let i = 0; i < members.length; i += 1) {
    for (let j = i + 1; j < members.length; j += 1) {
      const times = met.get(pairKey(members[i].id, members[j].id)) ?? 0
      const names = `${pairName(members[i], players)} and ${pairName(members[j], players)}`
      if (times > 1) return `${names} would play each other twice.`
      if (times === 0) return `${names} would never play each other.`
    }
  }
  return null
}

function checkRoundRobins(t: TournamentState, players: readonly OpenPlayer[]): string | null {
  if (t.format === 'ROUND_ROBIN') return checkGroup(t, players, t.entrants, t.fixtures)
  if (t.format !== 'POOL_TO_BRACKET') return null
  const loose = t.entrants.find((e) => !e.poolLabel)
  if (loose) return `${pairName(loose, players)} isn't in a pool.`
  const labels = new Set([
    ...t.fixtures.filter((f) => f.bracket === 'POOL').map((f) => f.poolLabel as string),
    ...t.entrants.map((e) => e.poolLabel as string),
  ])
  for (const label of [...labels].sort()) {
    const members = t.entrants.filter((e) => e.poolLabel === label)
    if (members.length < 2) return `Pool ${label} would be left with ${members.length === 1 ? '1 pair' : 'no pairs'}. A pool needs at least 2.`
    const reason = checkGroup(t, players, members, t.fixtures.filter((f) => f.bracket === 'POOL' && f.poolLabel === label))
    if (reason) return reason
  }
  return null
}

/** The bracket's games and where each side comes from, ignoring who sits in a placed slot. */
function shape(t: TournamentState): string {
  return t.fixtures
    .filter((f) => f.bracket !== 'POOL')
    .map((f) => [f.id, f.bracket, f.roundNumber, f.position, f.sourceA ?? '', f.sourceB ?? ''].join(':'))
    .sort()
    .join('|')
}

function checkPlacement(t: TournamentState, players: readonly OpenPlayer[]): string | null {
  if (t.format !== 'SINGLE_ELIMINATION' && t.format !== 'DOUBLE_ELIMINATION') return null
  // A placed slot is one with no source: filled at generation, never by a result.
  const placed = t.fixtures.flatMap((f) => [
    f.sourceA === null ? f.entrantAId : null,
    f.sourceB === null ? f.entrantBId : null,
  ]).filter((id): id is string => id !== null)
  for (const entrant of t.entrants) {
    const count = placed.filter((id) => id === entrant.id).length
    if (count === 0) return `${pairName(entrant, players)} would have no place in the bracket.`
    if (count > 1) return `${pairName(entrant, players)} would be in the bracket twice.`
  }
  return null
}

/** Why `after` is not a valid draw, or null. `before` is the draw the edit started from. */
export function drawViolation(before: TournamentState, after: TournamentState, players: readonly OpenPlayer[]): string | null {
  if (shape(before) !== shape(after)) return 'That change would alter the shape of the bracket.'
  return checkPlayers(after, players) ?? checkRounds(after, players) ?? checkRoundRobins(after, players) ?? checkPlacement(after, players)
}

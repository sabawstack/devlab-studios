// src/lib/pickleball/open/rules.ts
// Keep-together / keep-apart (spec §5.4). Every mode picks its four through
// pickFour and splits through honoursTogether, so no mode can break a rule:
// when no four fits, the court is left unproposed and proposalBlocker says why.
import { pairKey } from './fairness'
import type { OpenSessionState, PairRule, Team } from './types'

export interface ActiveRules {
  /** Keep-together partner of each player, only while BOTH are ACTIVE (not on break, not left). */
  partnerOf: ReadonlyMap<string, string>
  /** pairKey of every keep-apart pair. */
  apart: ReadonlySet<string>
}

export const NO_RULES: ActiveRules = { partnerOf: new Map(), apart: new Set() }

/** Only units among the first SEARCH_UNITS candidates are searched: C(20, 4) = 4,845 combinations at most. */
export const SEARCH_UNITS = 20

export function activeRules(state: OpenSessionState): ActiveRules {
  const active = new Set(state.players.filter((p) => p.status === 'ACTIVE').map((p) => p.id))
  const partnerOf = new Map<string, string>()
  const apart = new Set<string>()
  for (const rule of state.settings.rules) {
    const [a, b] = rule.playerIds
    if (rule.kind === 'APART') apart.add(pairKey(a, b))
    else if (active.has(a) && active.has(b)) {
      partnerOf.set(a, b)
      partnerOf.set(b, a)
    }
  }
  return { partnerOf, apart }
}

function setKey(ids: readonly string[]): string {
  return [...ids].sort().join('|')
}

function clashes(unit: readonly string[], chosen: readonly string[], rules: ActiveRules): boolean {
  return unit.some((x) => chosen.some((y) => rules.apart.has(pairKey(x, y))))
}

/**
 * The first four players, in `order`'s preference, that keep every rule: a
 * keep-together pair joins as one unit (at its first member's place), a player
 * whose partner is not available waits, and no keep-apart pair shares the four.
 * `exclude` (Skip) asks for any other four; if there is none, the same four is
 * offered again rather than leaving the court empty.
 */
export function pickFour(
  order: readonly string[],
  rules: ActiveRules,
  exclude?: readonly string[],
  available: ReadonlySet<string> = new Set(order),
): string[] | null {
  const units: string[][] = []
  const placed = new Set<string>()
  for (const id of order) {
    if (placed.has(id)) continue
    const partner = rules.partnerOf.get(id)
    if (partner !== undefined && !available.has(partner)) continue
    const unit = partner === undefined ? [id] : [id, partner]
    unit.forEach((x) => placed.add(x))
    units.push(unit)
  }
  const pool = units.slice(0, SEARCH_UNITS)
  const banned = exclude ? setKey(exclude) : null
  const search = (start: number, chosen: string[], skip: string | null): string[] | null => {
    if (chosen.length === 4) return skip !== null && setKey(chosen) === skip ? null : chosen
    for (let i = start; i < pool.length; i += 1) {
      const unit = pool[i]
      if (chosen.length + unit.length > 4 || clashes(unit, chosen, rules)) continue
      const found = search(i + 1, [...chosen, ...unit], skip)
      if (found) return found
    }
    return null
  }
  return search(0, [], banned) ?? (banned === null ? null : search(0, [], null))
}

/** True when no keep-together pair in these teams is split across the net. */
export function honoursTogether(teamA: Team, teamB: Team, rules: ActiveRules): boolean {
  return [teamA, teamB].every((team) => team.every((id) => {
    const partner = rules.partnerOf.get(id)
    return partner === undefined || team.includes(partner)
  }))
}

/** True when this lineup keeps every active rule (used for host edits). */
export function keepsRules(teamA: Team, teamB: Team, rules: ActiveRules): boolean {
  const four = [...teamA, ...teamB]
  const apartOk = four.every((x, i) => four.slice(i + 1).every((y) => !rules.apart.has(pairKey(x, y))))
  return apartOk && honoursTogether(teamA, teamB, rules)
}

/** The rule a lineup breaks, in words, for the host; null when it breaks none. */
export function ruleViolation(teamA: Team, teamB: Team, state: OpenSessionState): string | null {
  const rules = activeRules(state)
  if (keepsRules(teamA, teamB, rules)) return null
  const name = (id: string) => state.players.find((p) => p.id === id)?.name ?? 'A player'
  const four = new Set([...teamA, ...teamB])
  const broken = state.settings.rules.find((rule: PairRule) => {
    const [a, b] = rule.playerIds
    if (rule.kind === 'APART') return four.has(a) && four.has(b)
    if (rules.partnerOf.get(a) !== b || (!four.has(a) && !four.has(b))) return false
    return !(teamA.includes(a) && teamA.includes(b)) && !(teamB.includes(a) && teamB.includes(b))
  })
  if (!broken) return 'That lineup breaks a keep-together or keep-apart rule.'
  const [a, b] = broken.playerIds
  return broken.kind === 'APART'
    ? `${name(a)} and ${name(b)} are kept apart. Remove that rule first.`
    : `${name(a)} and ${name(b)} always play together. Remove that rule first.`
}

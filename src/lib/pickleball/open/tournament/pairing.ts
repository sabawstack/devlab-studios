// Pair formation and seeding (spec §6.1, §6.3). Pure: randomness is passed in
// (the Durable Object supplies crypto.getRandomValues), so tests are exact.
import type { OpenPlayer } from '../types'
import type { PairingMethod, RandomInt, SeedingMethod } from './types'

export type PairIds = readonly [string, string]

export interface PairingResult {
  pairs: PairIds[]
  /** Left over with an odd count: flagged for the host to resolve (spec §6.1). */
  unpaired: string[]
}

/** Skill used when a player gave none: the middle of the self-reported 1–5 scale. */
export const NEUTRAL_SKILL = 3

const skillOf = (player: Pick<OpenPlayer, 'skill'>): number => player.skill ?? NEUTRAL_SKILL

/** Fisher–Yates on a copy. Every order is equally likely when random is uniform. */
export function shuffle<T>(items: readonly T[], random: RandomInt): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = random(i + 1)
    const swap = out[i]
    out[i] = out[j]
    out[j] = swap
  }
  return out
}

function consecutive(ids: readonly string[]): PairingResult {
  const pairs: PairIds[] = []
  for (let i = 0; i + 1 < ids.length; i += 2) pairs.push([ids[i], ids[i + 1]])
  return { pairs, unpaired: ids.length % 2 ? [ids[ids.length - 1]] : [] }
}

function needRandom(random: RandomInt | undefined): RandomInt {
  if (!random) throw new Error('A random source is required for random pairing or seeding.')
  return random
}

/**
 * RANDOM: a shuffle, then neighbours pair up.
 * BALANCED: snake by skill, strongest with weakest; the middle player is left over when the count is odd.
 * MANUAL: the roster in list order, 1st with 2nd, 3rd with 4th (paste your pairs in order), then edit the draft.
 */
export function formPairs(players: readonly OpenPlayer[], method: PairingMethod, random?: RandomInt): PairingResult {
  const ordered = [...players].sort((a, b) => a.position - b.position)
  if (method === 'RANDOM') return consecutive(shuffle(ordered, needRandom(random)).map((p) => p.id))
  if (method === 'MANUAL') return consecutive(ordered.map((p) => p.id))
  const bySkill = [...ordered].sort((a, b) => skillOf(b) - skillOf(a) || a.name.localeCompare(b.name))
  const half = Math.floor(bySkill.length / 2)
  const pairs: PairIds[] = []
  for (let i = 0; i < half; i += 1) pairs.push([bySkill[i].id, bySkill[bySkill.length - 1 - i].id])
  return { pairs, unpaired: bySkill.length % 2 ? [bySkill[half].id] : [] }
}

/** Mean of the two players' skills (spec §6.3 "mean pair skill"). */
export function pairSkill(pair: PairIds, players: readonly OpenPlayer[]): number {
  const skills = pair.map((id) => skillOf(players.find((p) => p.id === id) ?? { skill: null }))
  return (skills[0] + skills[1]) / 2
}

/**
 * Pairs in seed order, best seed first. RANDOM shuffles (the generator takes
 * entrants in seed order, so this is the whole of random seeding); BY_SKILL is
 * mean pair skill, ties kept in formation order; MANUAL keeps formation order
 * for the host to rearrange in the draft.
 */
export function seedPairs(pairs: readonly PairIds[], method: SeedingMethod, players: readonly OpenPlayer[], random?: RandomInt): PairIds[] {
  if (method === 'RANDOM') return shuffle(pairs, needRandom(random))
  if (method === 'MANUAL') return [...pairs]
  return pairs
    .map((pair, index) => ({ pair, index, skill: pairSkill(pair, players) }))
    .sort((a, b) => b.skill - a.skill || a.index - b.index)
    .map((entry) => entry.pair)
}

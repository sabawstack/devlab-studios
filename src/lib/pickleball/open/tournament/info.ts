// Labels and one-line explanations, shared by the console, the create form
// and the public guide so the wording never drifts.
import { minimumEntrants } from '../../tournament/generateFixtures'
import type { PairingMethod, SeedingMethod, TournamentFormat } from './types'

export const FORMAT_INFO: Record<TournamentFormat, { label: string; summary: string }> = {
  ROUND_ROBIN: { label: 'Round robin', summary: 'Every pair plays every other pair once. Most wins takes it.' },
  POOL_TO_BRACKET: { label: 'Pools, then bracket', summary: 'Round robin in pools A, B and so on. The top 2 of each pool go into a knockout bracket.' },
  SINGLE_ELIMINATION: { label: 'Single elimination', summary: 'Lose once and you are out. Top seeds get any byes.' },
  DOUBLE_ELIMINATION: { label: 'Double elimination', summary: 'A first loss drops you to the losers bracket; a second knocks you out. One game decides the grand final.' },
}

export const PAIRING_INFO: Record<PairingMethod, { label: string; summary: string }> = {
  RANDOM: { label: 'Random', summary: 'Partners are drawn at random.' },
  BALANCED: { label: 'Balanced', summary: 'Strongest with weakest by skill, so the pairs come out even.' },
  MANUAL: { label: 'In list order', summary: '1st with 2nd, 3rd with 4th, as on the player list. Swap anyone in the draft.' },
}

export const SEEDING_INFO: Record<SeedingMethod, { label: string; summary: string }> = {
  RANDOM: { label: 'Random', summary: 'The draw order is shuffled.' },
  BY_SKILL: { label: 'By skill', summary: 'Pairs with the highest mean skill are seeded first and kept apart.' },
  MANUAL: { label: 'You choose', summary: 'Pairs keep the order they were made in. Swap any two in the draft.' },
}

export const FORMAT_ORDER: readonly TournamentFormat[] = ['ROUND_ROBIN', 'POOL_TO_BRACKET', 'SINGLE_ELIMINATION', 'DOUBLE_ELIMINATION']

/** "Pools, then bracket needs at least 4 pairs (8 players)." */
export function minimumMessage(format: TournamentFormat): string {
  const pairs = minimumEntrants(format)
  return `${FORMAT_INFO[format].label} needs at least ${pairs} pairs (${pairs * 2} players).`
}

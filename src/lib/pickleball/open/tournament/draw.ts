// Generate (spec §6.4): pairs → seeds → the reused generateFixtures, unchanged.
// The generator's local keys are swapped for real ids here, so every
// WINNER_OF:/LOSER_OF: source names a fixture id from then on.
import { generateFixtures, minimumEntrants, type GeneratedFixture } from '../../tournament/generateFixtures'
import type { OpenPlayer } from '../types'
import { minimumMessage } from './info'
import { sortEntrants, sortFixtures } from './order'
import { formPairs, seedPairs } from './pairing'
import type {
  PairingMethod, RandomInt, SeedingMethod, TournamentEntrant, TournamentFixture, TournamentFormat, TournamentState,
} from './types'

export interface DrawOptions {
  format: TournamentFormat
  pairing: PairingMethod
  seeding: SeedingMethod
}

export interface DrawContext {
  newId: () => string
  random?: RandomInt
}

export type DrawResult = { ok: true; tournament: TournamentState } | { ok: false; reason: string }

/** Generated fixtures with real ids; sources rewritten from generator keys to those ids. */
export function withIds(generated: readonly GeneratedFixture[], newId: () => string): TournamentFixture[] {
  const ids = new Map(generated.map((g) => [g.key, newId()]))
  const rewrite = (source: string | null) => {
    if (!source) return null
    const link = /^(WINNER_OF|LOSER_OF):(.+)$/.exec(source)
    return link ? `${link[1]}:${ids.get(link[2]) ?? link[2]}` : source
  }
  // Key order is the repository loader's (diffState compares JSON).
  return generated.map((g) => ({
    id: ids.get(g.key) as string, bracket: g.bracket, poolLabel: g.poolLabel, roundNumber: g.roundNumber, position: g.position,
    entrantAId: g.entrantAId, entrantBId: g.entrantBId, sourceA: rewrite(g.sourceA), sourceB: rewrite(g.sourceB),
    winnerEntrantId: null, status: g.status,
  }))
}

/** A fresh round robin for one pool, from its pairs in seed order. */
export function poolFixtures(label: string, entrants: readonly TournamentEntrant[], newId: () => string): TournamentFixture[] {
  const seeded = sortEntrants(entrants).map((e) => ({ entrantId: e.id, seed: e.seed }))
  return withIds(generateFixtures('ROUND_ROBIN', seeded), newId).map((f) => ({ ...f, bracket: 'POOL', poolLabel: label }))
}

/** Players who can be drawn: present, not on a break, in list order. */
export function drawablePlayers(players: readonly OpenPlayer[]): OpenPlayer[] {
  return players.filter((p) => p.status === 'ACTIVE').sort((a, b) => a.position - b.position)
}

export function generateDraw(players: readonly OpenPlayer[], options: DrawOptions, ctx: DrawContext, maxFixtures: number): DrawResult {
  const needsRandom = options.pairing === 'RANDOM' || options.seeding === 'RANDOM'
  if (needsRandom && !ctx.random) return { ok: false, reason: 'Random pairing or seeding is not available right now. Try again, or pick another method.' }
  const { pairs } = formPairs(drawablePlayers(players), options.pairing, ctx.random)
  if (pairs.length < minimumEntrants(options.format)) return { ok: false, reason: minimumMessage(options.format) }
  const seeded = seedPairs(pairs, options.seeding, players, ctx.random)
  const entrants: TournamentEntrant[] = seeded.map((playerIds, index) => ({ id: ctx.newId(), playerIds, seed: index + 1, poolLabel: null }))
  const fixtures = withIds(generateFixtures(options.format, entrants.map((e) => ({ entrantId: e.id, seed: e.seed }))), ctx.newId)
  if (fixtures.length > maxFixtures) {
    return { ok: false, reason: `That draw needs ${fixtures.length} games, more than this session can hold (${maxFixtures}). ${options.format === 'POOL_TO_BRACKET' ? 'Use fewer pairs.' : 'Use pools, or fewer pairs.'}` }
  }
  const poolOf = new Map<string, string>()
  for (const f of fixtures) {
    if (f.bracket !== 'POOL' || !f.poolLabel) continue
    if (f.entrantAId) poolOf.set(f.entrantAId, f.poolLabel)
    if (f.entrantBId) poolOf.set(f.entrantBId, f.poolLabel)
  }
  return {
    ok: true,
    tournament: {
      format: options.format, pairing: options.pairing, seeding: options.seeding, phase: 'DRAFT', startedAt: null,
      entrants: sortEntrants(entrants.map((e) => ({ ...e, poolLabel: poolOf.get(e.id) ?? null }))),
      fixtures: sortFixtures(fixtures),
    },
  }
}

/** ACTIVE players in no pair: the odd one out, a late arrival, or a substitute in waiting. */
export function unpairedPlayers(t: TournamentState, players: readonly OpenPlayer[]): OpenPlayer[] {
  const paired = new Set(t.entrants.flatMap((e) => e.playerIds))
  return drawablePlayers(players).filter((p) => !paired.has(p.id))
}

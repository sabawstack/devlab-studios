// Human names for pairs, rounds and the slots still waiting on a result.
import type { OpenPlayer } from '../types'
import type { TournamentEntrant, TournamentFixture, TournamentFormat, TournamentState } from './types'

export function pairName(entrant: Pick<TournamentEntrant, 'playerIds'>, players: readonly OpenPlayer[]): string {
  return entrant.playerIds.map((id) => players.find((p) => p.id === id)?.name ?? '—').join(' & ')
}

export function entrantName(t: TournamentState, entrantId: string | null, players: readonly OpenPlayer[]): string | null {
  const entrant = entrantId ? t.entrants.find((e) => e.id === entrantId) : undefined
  return entrant ? pairName(entrant, players) : null
}

function maxRound(fixtures: readonly TournamentFixture[], bracket: TournamentFixture['bracket']): number {
  return fixtures.filter((f) => f.bracket === bracket).reduce((max, f) => Math.max(max, f.roundNumber), 0)
}

function eliminationRound(round: number, last: number): string {
  if (round === last) return 'Final'
  if (round === last - 1) return 'Semi-final'
  if (round === last - 2) return 'Quarter-final'
  return `Round ${round}`
}

/** "Pool A · Round 2", "Round 3", "Semi-final", "Winners round 1", "Losers final", "Grand final". */
export function roundLabel(format: TournamentFormat, fixtures: readonly TournamentFixture[], fixture: TournamentFixture): string {
  if (fixture.bracket === 'POOL') return `Pool ${fixture.poolLabel} · Round ${fixture.roundNumber}`
  if (format === 'ROUND_ROBIN') return `Round ${fixture.roundNumber}`
  const lastMain = maxRound(fixtures, 'MAIN')
  if (format !== 'DOUBLE_ELIMINATION') return eliminationRound(fixture.roundNumber, lastMain)
  if (fixture.bracket === 'LOSERS') {
    return fixture.roundNumber === maxRound(fixtures, 'LOSERS') ? 'Losers final' : `Losers round ${fixture.roundNumber}`
  }
  if (fixture.roundNumber === lastMain) return 'Grand final'
  if (fixture.roundNumber === lastMain - 1) return 'Winners final'
  return `Winners round ${fixture.roundNumber}`
}

/**
 * The round label, numbered when that round has more than one game. Named
 * elimination rounds take a bare number ("Semi-final 2"); numbered rounds take
 * a game number ("Round 1 · Game 2", "Pool A · Round 1 · Game 2").
 */
export function fixtureLabel(t: Pick<TournamentState, 'format' | 'fixtures'>, fixture: TournamentFixture): string {
  const label = roundLabel(t.format, t.fixtures, fixture)
  const sameRound = t.fixtures
    .filter((f) => f.bracket === fixture.bracket && f.poolLabel === fixture.poolLabel && f.roundNumber === fixture.roundNumber)
    .sort((a, b) => a.position - b.position)
  if (sameRound.length < 2) return label
  const game = sameRound.findIndex((f) => f.id === fixture.id) + 1
  return /round \d+$/i.test(label) ? `${label} · Game ${game}` : `${label} ${game}`
}

/** What fills an empty slot: "Winner of Semi-final 1", "Loser of Winners round 1 · Game 2", "Pool B winner", "Pool A runner-up". */
export function sourceLabel(t: Pick<TournamentState, 'format' | 'fixtures'>, source: string | null): string | null {
  if (!source) return null
  const pool = /^POOL_RANK:([A-H]):(\d+)$/.exec(source)
  if (pool) return `Pool ${pool[1]} ${pool[2] === '1' ? 'winner' : 'runner-up'}`
  const link = /^(WINNER_OF|LOSER_OF):(.+)$/.exec(source)
  const from = link ? t.fixtures.find((f) => f.id === link[2]) : undefined
  if (!link || !from) return null
  return `${link[1] === 'WINNER_OF' ? 'Winner' : 'Loser'} of ${fixtureLabel(t, from)}`
}

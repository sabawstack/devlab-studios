// src/lib/pickleball/open/tournament/progress.ts
// What a game's start, result, undo, edit or abandon does to the draw. Later
// slots fill through the reused advanceBracket (resolveAdvancement /
// unadvanceBracket) and resolvePoolQualifiers, unchanged (spec §6.5).
import { resolveAdvancement, unadvanceBracket, type BracketOp } from '../../tournament/advanceBracket'
import { resolvePoolQualifiers } from '../../tournament/resolvePoolQualifiers'
import type { OpenMatch, OpenPlayer, Side } from '../types'
import { fixtureLabel } from './labels'
import { overallStandings, standingsInputs } from './standings'
import type { EditResult, TournamentEntrant, TournamentFixture, TournamentState } from './types'

const POOL_RANK = /^POOL_RANK:([A-H]):\d+$/

function update(t: TournamentState, fixtureId: string, patch: Partial<TournamentFixture>): TournamentState {
  return { ...t, fixtures: t.fixtures.map((f) => (f.id === fixtureId ? { ...f, ...patch } : f)) }
}

/** Applies advancement ops. A game already on court or played keeps its status (a pool can re-report its qualifiers). */
export function applyOps(fixtures: readonly TournamentFixture[], ops: readonly BracketOp[]): TournamentFixture[] {
  return ops.reduce<TournamentFixture[]>((acc, op) => acc.map((f) => {
    if (f.id !== op.fixtureId) return f
    if (op.kind === 'FINISH') return { ...f, status: 'FINISHED', winnerEntrantId: op.winnerEntrantId }
    if (op.kind === 'VACATE') return op.side === 'A' ? { ...f, entrantAId: null, sourceA: null } : { ...f, entrantBId: null, sourceB: null }
    const status = f.status === 'IN_PROGRESS' || f.status === 'FINISHED' ? f.status : op.status
    return op.side === 'A' ? { ...f, entrantAId: op.entrantId, status } : { ...f, entrantBId: op.entrantId, status }
  }), [...fixtures])
}

function settled(fixtures: readonly TournamentFixture[]): boolean {
  return fixtures.every((f) => f.status === 'FINISHED' || f.status === 'BYE')
}

const statusOf = (t: TournamentState, fixtureId: string) => t.fixtures.find((f) => f.id === fixtureId)?.status

/** Only a READY game can start; anything else is left as it is. */
export function fixtureStarted(t: TournamentState, fixtureId: string): TournamentState {
  return statusOf(t, fixtureId) === 'READY' ? update(t, fixtureId, { status: 'IN_PROGRESS' }) : t
}

/** Only a game on court can be abandoned back to READY; anything else is left as it is. */
export function fixtureAbandoned(t: TournamentState, fixtureId: string): TournamentState {
  return statusOf(t, fixtureId) === 'IN_PROGRESS' ? update(t, fixtureId, { status: 'READY' }) : t
}

function poolOps(t: TournamentState, fixtures: TournamentFixture[], matches: readonly OpenMatch[], players: readonly OpenPlayer[]): BracketOp[] {
  const poolGames = fixtures.filter((f) => f.bracket === 'POOL')
  return resolvePoolQualifiers(fixtures, standingsInputs({ ...t, fixtures }, poolGames, matches, players))
}

/** A result is saved: the fixture finishes and its winner (and, in double elimination, its loser) moves on. */
export function fixtureFinished(
  t: TournamentState, fixtureId: string, winner: Side, matches: readonly OpenMatch[], players: readonly OpenPlayer[],
): TournamentState {
  const fixture = t.fixtures.find((f) => f.id === fixtureId)
  if (!fixture || !fixture.entrantAId || !fixture.entrantBId) return t
  const winnerId = winner === 'A' ? fixture.entrantAId : fixture.entrantBId
  const loserId = winner === 'A' ? fixture.entrantBId : fixture.entrantAId
  const done = t.fixtures.map((f) => (f.id === fixtureId ? { ...f, status: 'FINISHED' as const, winnerEntrantId: winnerId } : f))
  const ops = fixture.bracket === 'POOL' ? poolOps(t, done, matches, players) : resolveAdvancement(done, fixtureId, winnerId, loserId)
  const fixtures = applyOps(done, ops)
  return { ...t, fixtures, phase: settled(fixtures) ? 'FINISHED' : 'RUNNING' }
}

/** The bracket games a pool's finishing positions feed. */
function poolConsumers(t: TournamentState, label: string): Array<{ fixture: TournamentFixture; side: 'A' | 'B' }> {
  return t.fixtures.flatMap((f) => (['A', 'B'] as const)
    .filter((side) => POOL_RANK.exec((side === 'A' ? f.sourceA : f.sourceB) ?? '')?.[1] === label)
    .map((side) => ({ fixture: f, side })))
}

const started = (f: TournamentFixture) => f.status === 'IN_PROGRESS' || f.status === 'FINISHED'

/**
 * The slot (if any) a result sent a pair into that no longer holds that pair.
 * Clearing it would take the wrong pair out of the bracket, so reopening is
 * refused instead. An empty slot is harmless and is not reported.
 */
function movedSlot(t: TournamentState, fixture: TournamentFixture, updates: ReadonlyArray<{ fixtureId: string; side: 'A' | 'B' }>): TournamentFixture | null {
  const loserId = fixture.winnerEntrantId === fixture.entrantAId ? fixture.entrantBId : fixture.entrantAId
  for (const u of updates) {
    const consumer = t.fixtures.find((f) => f.id === u.fixtureId)
    if (!consumer) continue
    const source = u.side === 'A' ? consumer.sourceA : consumer.sourceB
    const holder = u.side === 'A' ? consumer.entrantAId : consumer.entrantBId
    const expected = source?.startsWith('LOSER_OF:') ? loserId : fixture.winnerEntrantId
    if (holder !== null && holder !== expected) return consumer
  }
  return null
}

/**
 * Takes a saved result back out of the draw (undo, or the first half of an
 * edit that changes who won). Refused, with the reason, when a later game
 * that depends on it has already started.
 */
export function reopenFixture(t: TournamentState, fixtureId: string): EditResult {
  const fixture = t.fixtures.find((f) => f.id === fixtureId)
  if (!fixture || fixture.status !== 'FINISHED') return { ok: false, reason: 'Only a saved result can be taken back.' }
  let fixtures: TournamentFixture[]
  if (fixture.bracket === 'POOL') {
    const label = fixture.poolLabel as string
    const consumers = poolConsumers(t, label)
    const filled = consumers.filter(({ fixture: f, side }) => (side === 'A' ? f.entrantAId : f.entrantBId) !== null)
    const blocking = filled.find(({ fixture: f }) => started(f))
    if (blocking) return { ok: false, reason: `Pool ${label}'s top two have already started ${fixtureLabel(t, blocking.fixture)}. Change that game first.` }
    const clear = new Map(filled.map(({ fixture: f, side }) => [`${f.id}:${side}`, true]))
    fixtures = t.fixtures.map((f) => {
      const a = clear.has(`${f.id}:A`)
      const b = clear.has(`${f.id}:B`)
      if (!a && !b) return f
      return { ...f, entrantAId: a ? null : f.entrantAId, entrantBId: b ? null : f.entrantBId, status: 'PENDING' }
    })
  } else {
    const undone = unadvanceBracket([...t.fixtures], fixtureId)
    if (!undone.ok) {
      const blocking = t.fixtures.find((f) => f.id === undone.blockingFixtureId)
      return { ok: false, reason: `${blocking ? fixtureLabel(t, blocking) : 'The next game'} has already started with this result. Change that game first.` }
    }
    const moved = movedSlot(t, fixture, undone.updates)
    if (moved) return { ok: false, reason: `${fixtureLabel(t, moved)} no longer has the pair this result sent there, so it cannot be taken back.` }
    fixtures = t.fixtures.map((f) => {
      const changes = undone.updates.filter((u) => u.fixtureId === f.id)
      return changes.reduce((acc, u) => (u.side === 'A' ? { ...acc, entrantAId: null, status: u.status } : { ...acc, entrantBId: null, status: u.status }), f)
    })
  }
  return {
    ok: true,
    tournament: { ...t, phase: 'RUNNING', fixtures: fixtures.map((f) => (f.id === fixtureId ? { ...f, status: 'IN_PROGRESS', winnerEntrantId: null } : f)) },
  }
}

/** Same pool qualifiers, in the same slots? Then a pool score edit changes nothing downstream. */
function sameQualifiers(t: TournamentState, fixtures: TournamentFixture[], matches: readonly OpenMatch[], players: readonly OpenPlayer[]): boolean {
  return poolOps(t, fixtures, matches, players).every((op) => {
    if (op.kind !== 'FILL') return true
    const f = t.fixtures.find((x) => x.id === op.fixtureId)
    return (op.side === 'A' ? f?.entrantAId : f?.entrantBId) === op.entrantId
  })
}

/**
 * A saved result is changed. Only the score: nothing moves (unless it is a
 * pool game that changes who goes through). A different winner: the old
 * result is taken back out of the draw and the new one put in, if nothing
 * that depends on it has started.
 */
export function editFixtureResult(
  t: TournamentState, fixtureId: string, winner: Side, matchesAfter: readonly OpenMatch[], players: readonly OpenPlayer[],
): EditResult {
  const fixture = t.fixtures.find((f) => f.id === fixtureId)
  if (!fixture || !fixture.entrantAId || !fixture.entrantBId) return { ok: false, reason: 'Game not found in the draw.' }
  if (fixture.status !== 'FINISHED') return { ok: false, reason: 'Only a saved result can be edited.' }
  const winnerId = winner === 'A' ? fixture.entrantAId : fixture.entrantBId
  if (fixture.bracket !== 'POOL' && winnerId === fixture.winnerEntrantId) return { ok: true, tournament: t }
  const relabelled = t.fixtures.map((f) => (f.id === fixtureId ? { ...f, winnerEntrantId: winnerId } : f))
  if (fixture.bracket === 'POOL' && sameQualifiers(t, relabelled, matchesAfter, players)) return { ok: true, tournament: { ...t, fixtures: relabelled } }
  const reopened = reopenFixture(t, fixtureId)
  if (!reopened.ok) return reopened
  return { ok: true, tournament: fixtureFinished(reopened.tournament, fixtureId, winner, matchesAfter, players) }
}

/** The winning pair once every game is played: top of the table, or the winner of the last game. */
export function champion(t: TournamentState, matches: readonly OpenMatch[], players: readonly OpenPlayer[]): TournamentEntrant | null {
  if (t.phase !== 'FINISHED') return null
  if (t.format === 'ROUND_ROBIN') {
    const top = overallStandings(t, matches, players)[0]
    return t.entrants.find((e) => e.id === top?.entrantId) ?? null
  }
  const consumed = new Set(t.fixtures.flatMap((f) => [f.sourceA, f.sourceB]).filter((s): s is string => Boolean(s?.startsWith('WINNER_OF:'))).map((s) => s.slice('WINNER_OF:'.length)))
  const final = t.fixtures.find((f) => f.bracket === 'MAIN' && !consumed.has(f.id))
  return t.entrants.find((e) => e.id === final?.winnerEntrantId) ?? null
}
